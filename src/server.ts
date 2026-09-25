/**
 * agent-memory REST server (contract §3, frozen route table).
 *
 * - dependency-free `node:http` — no Express/Fastify (contract requirement)
 * - every inbound body/query is `unknown` first, then narrowed with zod
 * - bearer guard: active only when AGENT_MEMORY_SECRET is non-empty; every
 *   route except `livez` requires `Authorization: Bearer <secret>`;
 *   mismatch -> 401. The secret value is never logged or echoed.
 * - binds 127.0.0.1 by default (AGENT_MEMORY_HOST overrides); port from
 *   AGENT_MEMORY_PORT, default 3111.
 * - EADDRINUSE prints the port-ownership + `AGENT_MEMORY_PORT=3151` reroute
 *   hint (never-kill-upstream) before exiting (REQ-P0-6).
 * - access log: method, path, status, duration only — never bodies,
 *   query strings, headers, or secrets.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { isBearerAuthorized, secretFromEnv } from "./auth.js";
import { buildDigestLines } from "./digest.js";
import { failureSignal, logSafeNote } from "./errors.js";
import { bm25Search, hybridSearch } from "./search.js";
import { createDefaultStore, type MemoryStore } from "./store.js";

const ROUTE_PREFIX = "/memory";
const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
const DEFAULT_ORIGIN = "rest";
/** `/memory/lesson` forces this origin (contract §3, P3.1). */
const LESSON_ORIGIN = "lesson";
const MAX_BODY_BYTES = 1_048_576; // 1 MiB

/* ------------------------------------------------------------------ */
/* Boundary validation (every input starts as `unknown`)                */
/* ------------------------------------------------------------------ */

const contentSchema = z.string().trim().min(1).max(200_000);
const projectSchema = z.string().trim().min(1).max(200);
const sessionIdSchema = z.string().trim().min(1).max(200);
const originSchema = z.string().trim().min(1).max(100);
const conceptsSchema = z.array(z.string().trim().min(1).max(200)).max(64);
const queryTextSchema = z.string().trim().min(1).max(10_000);
const limitSchema = z.number().int().min(1).max(100);
const importanceSchema = z.number().min(0).max(1);
const memoryIdSchema = z.string().trim().min(1).max(200);
/**
 * Governance-delete `memoryId`/`reason` are interpolated verbatim into the
 * single-line governance log, so collapse whitespace runs to one space FIRST
 * and apply the bounds to the normalized value: an embedded `\n` can no longer
 * forge a second log line (CWE-117). Bounds are declared on BOTH sides — the
 * input side rejects empty/over-long input early and the post-normalize
 * `.pipe()` bounds keep whitespace-only input a 400 — and the shape mirrors
 * `src/mcp.ts` so the two lanes cannot drift (C3-R17). Collapsing is a no-op
 * for real UUIDs; memory content is NOT normalized (newlines are legitimate
 * there) and content is never logged.
 */
const deleteMemoryIdSchema = z
  .string()
  .min(1)
  .max(200)
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(200));
const deleteReasonSchema = z
  .string()
  .min(1)
  .max(1000)
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(1000));

const rememberBodySchema = z
  .object({
    content: contentSchema,
    concepts: conceptsSchema.optional(),
    project: projectSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    origin: originSchema.optional(),
    importance: importanceSchema.optional(),
  })
  .strict();

const searchBodySchema = z
  .object({
    query: queryTextSchema,
    project: projectSchema.optional(),
    limit: limitSchema.optional(),
  })
  .strict();

const smartSearchBodySchema = z
  .object({
    query: queryTextSchema,
    concepts: conceptsSchema.optional(),
    project: projectSchema.optional(),
    limit: limitSchema.optional(),
  })
  .strict();

const forgetBodySchema = z.object({ memoryId: memoryIdSchema }).strict();

/** Recap and handoff share this body (contract §3, P3.1). */
const recapBodySchema = z
  .object({
    project: projectSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    limit: limitSchema.optional(),
  })
  .strict();

/** Lesson = remember without an `origin` field — origin is forced server-side. */
const lessonBodySchema = z
  .object({
    content: contentSchema,
    concepts: conceptsSchema.optional(),
    project: projectSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    importance: importanceSchema.optional(),
  })
  .strict();

/** Governance delete: `reason` required, no `project` field. */
const deleteBodySchema = z
  .object({
    memoryId: deleteMemoryIdSchema,
    reason: deleteReasonSchema,
  })
  .strict();

const listQuerySchema = z.object({
  project: projectSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const healthQuerySchema = z.object({ project: projectSchema.optional() });

/* Todos — follow-ups: decisions to revisit, files to inspect, tasks blocked on input */
const todoPrioritySchema = z.enum(["low", "medium", "high"]);
const todoStatusSchema = z.enum(["pending", "active", "done", "blocked"]);
const parentIdSchema = z.string().trim().min(1).max(200);

const createTodoBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(5000).optional(),
    priority: todoPrioritySchema.optional(),
    status: todoStatusSchema.optional(),
    project: projectSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    parentId: parentIdSchema.optional(),
  })
  .strict();

const updateTodoBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(5000).optional(),
    priority: todoPrioritySchema.optional(),
    status: todoStatusSchema.optional(),
    parentId: z.union([parentIdSchema, z.null()]).optional(),
  })
  .strict();

const listTodosQuerySchema = z.object({
  project: projectSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: todoStatusSchema.optional(),
  priority: todoPrioritySchema.optional(),
  search: z.string().trim().max(500).optional(),
  frontier: z.coerce.boolean().optional(),
  parentId: parentIdSchema.optional(),
});

const frontierQuerySchema = z.object({
  project: projectSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/* Brainy v1 Schemas */
const noteTitleSchema = z.string().trim().min(1).max(500);
const noteContentSchema = z.string().trim().min(1).max(200_000);
const noteTagsSchema = z.array(z.string().trim().min(1).max(100)).max(64);
const paraCategorySchema = z.enum(["project", "area", "resource", "archive"]);

const createNoteBodySchema = z
  .object({
    title: noteTitleSchema,
    content: noteContentSchema,
    tags: noteTagsSchema.optional(),
    project: projectSchema.optional(),
    paraCategory: paraCategorySchema.optional(),
    paraTarget: z.string().trim().min(1).max(200).optional(),
    sessionId: sessionIdSchema.optional(),
  })
  .strict();

const getNoteQuerySchema = z
  .object({
    project: projectSchema.optional(),
  })
  .strict();

const searchNotesBodySchema = z
  .object({
    query: queryTextSchema,
    project: projectSchema.optional(),
    include_graph: z.boolean().optional(),
    max_depth: z.number().int().min(1).max(3).optional(),
    vector_top_k: z.number().int().min(1).max(20).optional(),
    limit: limitSchema.optional(),
  })
  .strict();

const legacyMemoryBodySchema = z
  .object({
    statement: contentSchema.optional(),
    content: contentSchema.optional(),
    concepts: conceptsSchema.optional(),
    project: projectSchema.optional(),
    sessionId: sessionIdSchema.optional(),
    memory_type: z.string().trim().max(100).optional(),
    origin: originSchema.optional(),
    importance: importanceSchema.optional(),
  })
  .strict()
  .refine(
    (data) =>
      (data.content !== undefined && data.content.trim().length > 0) ||
      (data.statement !== undefined && data.statement.trim().length > 0),
    { message: "either statement or content is required" },
  );

const contextQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const linkNodesBodySchema = z
  .object({
    fromId: z.string().trim().min(1).max(200),
    toId: z.string().trim().min(1).max(200),
    type: z.enum(["REFERENCES", "BELONGS_TO", "RELATES_TO"]),
    project: projectSchema.optional(),
  })
  .strict();

const distillNoteBodySchema = z
  .object({
    summary: z.string().trim().min(1).max(200_000).optional(),
    project: projectSchema.optional(),
  })
  .strict();

const moveNoteBodySchema = z
  .object({
    to: paraCategorySchema,
    name: z.string().trim().min(1).max(500),
    project: projectSchema.optional(),
  })
  .strict();


/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** 400: validation details; 405: allowed methods (also -> Allow header). */
    readonly details?: string,
  ) {
    super(code);
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new HttpError(400, "invalid_request", details);
  }
  return result.data;
}

function queryRecord(url: URL): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of url.searchParams) record[key] = value;
  return record;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "application/json required");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) throw new HttpError(400, "invalid_json_body", "empty body");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json_body", "body is not valid JSON");
  }
  return parsed;
}

function requireMethod(actual: string, expected: string): void {
  if (actual !== expected) throw new HttpError(405, "method_not_allowed", expected);
}

function decodeSegment(segment: string | undefined): string {
  if (segment === undefined || segment === "") throw new HttpError(404, "not_found");
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "invalid_path_encoding");
  }
}

function pathnameOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const cut = raw.indexOf("?");
  return cut === -1 ? raw : raw.slice(0, cut);
}

/* ------------------------------------------------------------------ */
/* Routing (frozen table, contract §3)                                 */
/* ------------------------------------------------------------------ */

async function routeRequest(
  store: MemoryStore,
  secret: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<number> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://memory.local"); // inbound parsing only
  let path = url.pathname;

  // Compat: image shows POST http://localhost:3111/agentmemory/todos — support /agentmemory/* alias for todos/frontier
  const isAgentMemoryAlias = path.startsWith("/agentmemory/");
  if (isAgentMemoryAlias && (path.startsWith("/agentmemory/todos") || path.startsWith("/agentmemory/frontier"))) {
    path = path.replace("/agentmemory/", "/memory/");
  }

  // 1-version /memory/* legacy deprecation alias adds X-Deprecated header
  if (path.startsWith("/memory/")) {
    res.setHeader("X-Deprecated", "use /v1/*");
  }

  // Routes must start with /memory/ or /v1/
  if (!path.startsWith("/memory/") && !path.startsWith("/v1/")) throw new HttpError(404, "not_found");

  // livez is exempt on both /memory/livez and /v1/livez
  const isLivez = path === "/memory/livez" || path === "/v1/livez";
  if (!isLivez && !isBearerAuthorized(req.headers.authorization, secret)) {
    res.setHeader("www-authenticate", "Bearer");
    sendJson(res, 401, { error: "unauthorized" });
    return 401;
  }

  // GET /v1/livez
  if (path === "/v1/livez") {
    requireMethod(method, "GET");
    sendJson(res, 200, { status: "ok" });
    return 200;
  }

  // POST /v1/notes
  if (path === "/v1/notes") {
    requireMethod(method, "POST");
    const body = parseOr400(createNoteBodySchema, await readJsonBody(req));
    if (typeof store.saveNote !== "function") {
      throw new HttpError(501, "not_implemented", "saveNote not supported by store");
    }
    const result = await store.saveNote({
      title: body.title,
      content: body.content,
      tags: body.tags,
      project: body.project ?? DEFAULT_PROJECT,
      paraCategory: body.paraCategory,
      paraTarget: body.paraTarget,
      sessionId: body.sessionId,
    });
    sendJson(res, 201, result);
    return 201;
  }

  // POST /v1/notes/:id/distill
  if (path.startsWith("/v1/notes/") && path.endsWith("/distill")) {
    requireMethod(method, "POST");
    const id = decodeSegment(path.slice("/v1/notes/".length, -"/distill".length));
    const body = parseOr400(distillNoteBodySchema, await readJsonBody(req));
    if (typeof store.distillNote !== "function") {
      throw new HttpError(501, "not_implemented", "distillNote not supported by store");
    }
    const result = await store.distillNote({
      id,
      project: body.project ?? DEFAULT_PROJECT,
      summary: body.summary,
    });
    sendJson(res, 201, { note: result });
    return 201;
  }

  // POST /v1/notes/:id/move (REQ-BRAINY-ENG-06, ADR-0003 — must precede the
  // generic GET /v1/notes/:id block below, which would otherwise 405 it)
  if (path.startsWith("/v1/notes/") && path.endsWith("/move")) {
    requireMethod(method, "POST");
    const id = decodeSegment(path.slice("/v1/notes/".length, -"/move".length));
    const body = parseOr400(moveNoteBodySchema, await readJsonBody(req));
    const query = parseOr400(getNoteQuerySchema, queryRecord(url));
    const project = body.project ?? query.project ?? DEFAULT_PROJECT;
    if (typeof store.moveNote !== "function") {
      throw new HttpError(501, "not_implemented", "moveNote not supported by store");
    }
    // SC-MOVE-03: same-tenant verification before any edge write — mirror the
    // POST /v1/link C8 pattern. A scoped miss that exists under another tenant
    // is a cross-tenant move attempt, not a 404; zero writes in that case.
    if (typeof store.getNoteById === "function") {
      const scoped = await store.getNoteById(id, project);
      if (!scoped || scoped.note.project !== project) {
        const anyTenant = await store.getNoteById(id);
        if (anyTenant && anyTenant.note.project !== project) {
          throw new HttpError(400, "invalid_tenant_link", "Note and target must belong to the same project tenant");
        }
        sendJson(res, 404, { error: "note_not_found" });
        return 404;
      }
    }
    let moved: boolean;
    try {
      moved = await store.moveNote({
        id,
        toCategory: body.to,
        toTarget: body.name,
        project,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("para_target_not_found")) {
        sendJson(res, 404, { error: "para_target_not_found" });
        return 404;
      }
      if (msg.includes("invalid_tenant_link")) {
        throw new HttpError(400, "invalid_tenant_link", msg);
      }
      throw err;
    }
    if (!moved) {
      sendJson(res, 404, { error: "note_not_found" });
      return 404;
    }
    const labelByCategory = {
      project: "Project",
      area: "Area",
      resource: "Resource",
      archive: "Archive",
    } as const;
    sendJson(res, 200, { id, para: { label: labelByCategory[body.to], name: body.name } });
    return 200;
  }

  // GET /v1/notes/:id
  if (path.startsWith("/v1/notes/")) {
    requireMethod(method, "GET");
    const id = decodeSegment(path.slice("/v1/notes/".length));
    const query = parseOr400(getNoteQuerySchema, queryRecord(url));
    if (typeof store.getNoteById !== "function") {
      throw new HttpError(501, "not_implemented", "getNoteById not supported by store");
    }
    const result = await store.getNoteById(id, query.project ?? DEFAULT_PROJECT);
    if (!result) {
      sendJson(res, 404, { error: "not_found" });
      return 404;
    }
    sendJson(res, 200, result);
    return 200;
  }

  // POST /v1/search
  if (path === "/v1/search") {
    requireMethod(method, "POST");
    const body = parseOr400(searchNotesBodySchema, await readJsonBody(req));
    const envelope = await hybridSearch(store, {
      query: body.query,
      project: body.project ?? DEFAULT_PROJECT,
      limit: body.limit ?? DEFAULT_LIMIT,
      include_graph: body.include_graph,
      max_depth: body.max_depth,
      vector_top_k: body.vector_top_k,
    });
    sendJson(res, 200, envelope);
    return 200;
  }

  // POST /v1/memory (compat translating statement to content)
  if (path === "/v1/memory") {
    requireMethod(method, "POST");
    const body = parseOr400(legacyMemoryBodySchema, await readJsonBody(req));
    const content = (body.content ?? body.statement)!;
    const result = await store.remember({
      content,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      sessionId: body.sessionId ?? randomUUID(),
      origin: body.origin ?? DEFAULT_ORIGIN,
      importance: body.importance,
    });
    sendJson(res, 201, {
      id: result.id,
      sessionId: result.sessionId,
      project: result.project,
      concepts: result.concepts,
      deduped: result.deduped,
    });
    return 201;
  }

  // GET /v1/context/:project
  if (path.startsWith("/v1/context/")) {
    requireMethod(method, "GET");
    const project = decodeSegment(path.slice("/v1/context/".length));
    const query = parseOr400(contextQuerySchema, queryRecord(url));
    const limit = query.limit ?? DEFAULT_LIMIT;
    const notes = typeof store.listNotes === "function" ? await store.listNotes({ project, limit }) : [];
    let memories: unknown[] = [];
    try {
      memories = await store.searchByText({ q: "*", project, k: limit });
    } catch {
      memories = [];
    }

    const graph = {
      project,
      notesCount: notes.length,
      memoriesCount: memories.length,
    };
    sendJson(res, 200, { project, notes, memories, graph });
    return 200;
  }

  // POST /v1/link
  if (path === "/v1/link") {
    requireMethod(method, "POST");
    const body = parseOr400(linkNodesBodySchema, await readJsonBody(req));
    const project = body.project ?? DEFAULT_PROJECT;
    // Condition C8: Verify both nodes belong to the same project tenant
    if (typeof store.getNoteById === "function") {
      const fromNote = await store.getNoteById(body.fromId, project);
      const toNote = await store.getNoteById(body.toId, project);
      if (!fromNote || !toNote || fromNote.note.project !== toNote.note.project) {
        throw new HttpError(400, "invalid_tenant_link", "Nodes must belong to the same project tenant");
      }
    }
    if (typeof store.linkNodes === "function") {
      try {
        await store.linkNodes({
          fromId: body.fromId,
          toId: body.toId,
          type: body.type,
          project,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("invalid_tenant_link")) {
          throw new HttpError(400, "invalid_tenant_link", msg);
        }
        throw err;
      }
    }
    sendJson(res, 201, { edge: { fromId: body.fromId, toId: body.toId, type: body.type } });
    return 201;

  }

  // GET /memory/livez
  if (path === "/memory/livez") {
    requireMethod(method, "GET");
    sendJson(res, 200, { status: "ok" });
    return 200;
  }


  // GET /memory/health?project=
  if (path === "/memory/health") {
    requireMethod(method, "GET");
    const query = parseOr400(healthQuerySchema, queryRecord(url));
    const counts = await store.healthCounts(query.project ?? DEFAULT_PROJECT);
    sendJson(res, 200, { status: "ok", counts });
    return 200;
  }

  // POST /memory/remember
  if (path === "/memory/remember") {
    requireMethod(method, "POST");
    const body = parseOr400(rememberBodySchema, await readJsonBody(req));
    const result = await store.remember({
      content: body.content,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      sessionId: body.sessionId ?? randomUUID(),
      origin: body.origin ?? DEFAULT_ORIGIN,
      // REQ-P1-4: pass the raw optional — absent importance is DERIVED in
      // the store (deriveWriteImportance), never flattened to 0.5 here.
      importance: body.importance,
    });
    sendJson(res, 201, result);
    return 201;
  }

  // POST /memory/search
  if (path === "/memory/search") {
    requireMethod(method, "POST");
    const body = parseOr400(searchBodySchema, await readJsonBody(req));
    const envelope = await bm25Search(store, {
      query: body.query,
      project: body.project ?? DEFAULT_PROJECT,
      limit: body.limit ?? DEFAULT_LIMIT,
    });
    sendJson(res, 200, envelope);
    return 200;
  }

  // POST /memory/smart-search
  if (path === "/memory/smart-search") {
    requireMethod(method, "POST");
    const body = parseOr400(smartSearchBodySchema, await readJsonBody(req));
    const envelope = await hybridSearch(store, {
      query: body.query,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      limit: body.limit ?? DEFAULT_LIMIT,
    });
    sendJson(res, 200, envelope);
    return 200;
  }

  // GET /memory/sessions
  // GET /memory/sessions/:sessionId/memories
  if (path === "/memory/sessions" || path.startsWith("/memory/sessions/")) {
    const segments = path.split("/"); // ["", "memory", "sessions", …]
    if (segments.length === 3) {
      requireMethod(method, "GET");
      const query = parseOr400(listQuerySchema, queryRecord(url));
      const sessions = await store.listSessions({
        project: query.project ?? DEFAULT_PROJECT,
        limit: query.limit ?? DEFAULT_LIMIT,
      });
      sendJson(res, 200, { sessions });
      return 200;
    }
    if (segments.length === 5 && segments[4] === "memories") {
      requireMethod(method, "GET");
      const query = parseOr400(listQuerySchema, queryRecord(url));
      const sessionId = decodeSegment(segments[3]);
      const memories = await store.sessionMemories({
        sessionId,
        project: query.project ?? DEFAULT_PROJECT,
        limit: query.limit ?? DEFAULT_LIMIT,
      });
      sendJson(res, 200, { memories });
      return 200;
    }
    throw new HttpError(404, "not_found");
  }

  // POST /memory/forget
  if (path === "/memory/forget") {
    requireMethod(method, "POST");
    const body = parseOr400(forgetBodySchema, await readJsonBody(req));
    const forgotten = await store.forget(body.memoryId);
    if (!forgotten) {
      sendJson(res, 404, { error: "not_found" });
      return 404;
    }
    sendJson(res, 200, { forgotten: true });
    return 200;
  }

  // POST /memory/recap
  if (path === "/memory/recap") {
    requireMethod(method, "POST");
    const body = parseOr400(recapBodySchema, await readJsonBody(req));
    const digest = await buildDigestLines(store, body);
    sendJson(res, 200, {
      recap: digest.lines.join("\n"),
      sessionId: body.sessionId ?? null,
      count: digest.count,
      signals: digest.signals,
    });
    return 200;
  }

  // POST /memory/handoff (body identical to recap)
  if (path === "/memory/handoff") {
    requireMethod(method, "POST");
    const body = parseOr400(recapBodySchema, await readJsonBody(req));
    const digest = await buildDigestLines(store, body);
    const signals = digest.signals;
    let counts: { memories: number; sessions: number } = { memories: 0, sessions: 0 };
    try {
      counts = await store.healthCounts(body.project ?? DEFAULT_PROJECT);
    } catch (err) {
      signals.push(`counts: ${failureSignal(err)}`);
    }
    const project = body.project ?? DEFAULT_PROJECT;
    const header = `project=${project} memories=${counts.memories} sessions=${counts.sessions} recent:`;
    sendJson(res, 200, {
      handoff: [header, ...digest.lines].join("\n"),
      sessionId: body.sessionId ?? null,
      counts,
      signals,
    });
    return 200;
  }

  // POST /memory/lesson — remember with origin forced to "lesson"
  if (path === "/memory/lesson") {
    requireMethod(method, "POST");
    const body = parseOr400(lessonBodySchema, await readJsonBody(req));
    const result = await store.remember({
      content: body.content,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      sessionId: body.sessionId ?? randomUUID(),
      origin: LESSON_ORIGIN,
      // REQ-P1-4: raw optional — the store derives lesson importance when absent.
      importance: body.importance,
    });
    sendJson(res, 201, result);
    return 201;
  }

  // POST /memory/delete — governance delete (reason required)
  if (path === "/memory/delete") {
    requireMethod(method, "POST");
    const body = parseOr400(deleteBodySchema, await readJsonBody(req));
    const deleted = await store.forget(body.memoryId);
    if (!deleted) {
      sendJson(res, 404, { error: "not_found" });
      return 404;
    }
    const deletedAt = new Date().toISOString();
    // One governance line: memoryId/reason arrive already collapsed to a
    // single line by the schema (log-forgery guard); reason is caller-supplied
    // metadata only — never memory content, never the secret. The access log
    // below is unchanged.
    console.log(
      `[agentmemory] delete governance memoryId=${body.memoryId} reason=${body.reason} at=${deletedAt}`,
    );
    sendJson(res, 200, { deleted: true, receipt: { memoryId: body.memoryId, deletedAt } });
    return 200;
  }

  // ---- Todos ----------------------------------------------------
  // POST /memory/todos — create
  if (path === "/memory/todos") {
    if (method === "POST") {
      const body = parseOr400(createTodoBodySchema, await readJsonBody(req));
      try {
        const todo = await store.createTodo({
          title: body.title,
          description: body.description,
          priority: body.priority,
          status: body.status,
          project: body.project ?? DEFAULT_PROJECT,
          sessionId: body.sessionId,
          parentId: body.parentId,
        });
        sendJson(res, 201, { todo });
        return 201;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("parent todo not found")) throw new HttpError(400, "invalid_request", msg);
        throw err;
      }
    }
    if (method === "GET") {
      const query = parseOr400(listTodosQuerySchema, queryRecord(url));
      const todos = await store.listTodos({
        project: query.project ?? DEFAULT_PROJECT,
        limit: query.limit ?? DEFAULT_LIMIT,
        status: query.status,
        priority: query.priority,
        search: query.search,
        frontier: query.frontier,
        parentId: query.parentId,
      });
      sendJson(res, 200, { todos });
      return 200;
    }
    throw new HttpError(405, "method_not_allowed", "GET, POST");
  }

  // GET /memory/frontier — unblocked ready to pick (pending ∪ active, priority-ordered)
  if (path === "/memory/frontier") {
    requireMethod(method, "GET");
    const query = parseOr400(frontierQuerySchema, queryRecord(url));
    const todos = await store.frontierTodos({ project: query.project ?? DEFAULT_PROJECT, limit: query.limit ?? DEFAULT_LIMIT });
    sendJson(res, 200, { frontier: todos, count: todos.length });
    return 200;
  }

  // /memory/todos/:todoId
  if (path.startsWith("/memory/todos/")) {
    const todoId = decodeSegment(path.slice("/memory/todos/".length));
    if (method === "GET") {
      const todo = await store.getTodo(todoId);
      if (todo === undefined) {
        sendJson(res, 404, { error: "not_found" });
        return 404;
      }
      sendJson(res, 200, { todo });
      return 200;
    }
    if (method === "PATCH") {
      const body = parseOr400(updateTodoBodySchema, await readJsonBody(req));
      try {
        const updated = await store.updateTodo(todoId, body as never);
        if (updated === undefined) {
          sendJson(res, 404, { error: "not_found" });
          return 404;
        }
        sendJson(res, 200, { todo: updated });
        return 200;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("parent todo not found") || msg.includes("cannot be its own parent") || msg.includes("title is required")) {
          throw new HttpError(400, "invalid_request", msg);
        }
        throw err;
      }
    }
    if (method === "DELETE") {
      const deleted = await store.deleteTodo(todoId);
      if (!deleted) {
        sendJson(res, 404, { error: "not_found" });
        return 404;
      }
      sendJson(res, 200, { deleted: true });
      return 200;
    }
    throw new HttpError(405, "method_not_allowed", "GET, PATCH, DELETE");
  }

  throw new HttpError(404, "not_found");
}

function respondToError(req: IncomingMessage, res: ServerResponse, err: unknown): number {
  if (err instanceof HttpError) {
    if (err.status === 405 && err.details !== undefined && !res.headersSent) {
      res.setHeader("allow", err.details);
    }
    if (!res.headersSent) {
      const payload: { error: string; details?: string } = { error: err.code };
      if (err.details !== undefined && err.status !== 405) payload.details = err.details;
      sendJson(res, err.status, payload);
    } else if (!res.writableEnded) {
      res.end();
    }
    return err.status;
  }
  if (!res.headersSent) {
    sendJson(res, 500, { error: "internal_error" });
  } else if (!res.writableEnded) {
    res.end();
  }
  console.error(
    `[agentmemory] ${req.method ?? "?"} ${pathnameOf(req)} -> 500: ${logSafeNote(err)}`,
  );
  return 500;
}

export interface BrainyServerOptions {
  store?: MemoryStore;
  /** Non-empty secret arms the bearer guard; undefined leaves routes open. */
  secret?: string | undefined;
}

export type AgentMemoryServerOptions = BrainyServerOptions;

export function createBrainyServer(options: BrainyServerOptions = {}): Server {
  const store = options.store ?? createDefaultStore();
  const secret = options.secret;
  return createServer((req, res) => {
    const started = Date.now();
    routeRequest(store, secret, req, res)
      .then(
        (status) => status,
        (err: unknown) => respondToError(req, res, err),
      )
      .then((status) => {
        // Access log: method, path, status, duration — no bodies, no headers.
        console.log(`${req.method ?? "?"} ${pathnameOf(req)} ${status} ${Date.now() - started}ms`);
      })
      .catch((err: unknown) => {
        // Client vanished mid-response; keep the server alive, log safely.
        console.error(`[brainy] response failed: ${logSafeNote(err)}`);
      });
  });
}

export const createAgentMemoryServer = createBrainyServer;

function parsePort(raw: string | undefined): number {
  const value = raw === undefined ? 3111 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  return value;
}

/** Non-empty env read: unset or empty -> undefined. */
function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Narrow structural read of a Node system error's `code` — typeof/`in`
 * narrowing only, no `any`, no cast (strict-TS rule).
 */
function systemErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if (!("code" in err)) return undefined;
  const code: unknown = err.code; // err narrowed to object & Record<"code", unknown>
  return typeof code === "string" ? code : undefined;
}

/** Reroute port README/CONTRACT prescribe when upstream holds 3111/3112/3113. */
const REROUTE_PORT = 3151;

/**
 * Actionable EADDRINUSE hint (REQ-P0-6 / INV-003), two lines on stderr before exit:
 *   1. port-ownership statement — upstream agentmemory (iii) may hold
 *      3111/3112/3113, NEVER kill it, start ours elsewhere with the 3151
 *      example;
 *   2. the client instruction — point clients at the port ours runs on via
 *      BRAINY_URL.
 * Commands and ports only; no env values and never the secret.
 */
function portInUseHint(port: number): string {
  return [
    `[brainy] port ${port} is already in use — if the upstream agentmemory (iii) holds ` +
      `3111/3112/3113, NEVER kill it; start ours elsewhere: ` +
      `BRAINY_PORT=${REROUTE_PORT} npm run dev`,
    `[brainy] then point clients at the port ours runs on: ` +
      `BRAINY_URL=http://127.0.0.1:${REROUTE_PORT} (example)`,
  ].join("\n");
}

function main(): void {
  const port = parsePort(process.env["BRAINY_PORT"] ?? process.env["AGENT_MEMORY_PORT"]);
  const host = nonEmptyEnv("BRAINY_HOST") ?? nonEmptyEnv("AGENT_MEMORY_HOST") ?? "127.0.0.1";
  const secret = secretFromEnv();

  // Condition C1: warn if non-loopback host with unauthenticated access
  if (host !== "127.0.0.1" && host !== "localhost" && secret === undefined) {
    console.warn(`WARN INSECURE: Server listening on non-loopback host ${host} with authentication disabled`);
  }

  const server = createBrainyServer({ secret });
  server.on("error", (err: Error) => {
    console.error(`[brainy] server error: ${logSafeNote(err)}`);
    if (systemErrorCode(err) === "EADDRINUSE") {
      console.error(portInUseHint(port));
    }
    process.exit(1);
  });
  server.listen(port, host, () => {
    // Never print the secret value — only whether the guard is armed.
    console.log(
      `brainy REST on http://${host}:${port} (auth: ${secret === undefined ? "open" : "bearer-required"})`,
    );
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);

  process.on("SIGTERM", shutdown);
}

// Start only when executed directly (npx tsx src/server.ts), not on import.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
