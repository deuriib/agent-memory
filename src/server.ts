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

const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
const DEFAULT_ORIGIN = "rest";
/** `/agentmemory/lesson` forces this origin (contract §3, P3.1). */
const LESSON_ORIGIN = "lesson";
const DEFAULT_IMPORTANCE = 0.5;
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
 * forge a second log line (CWE-117). Collapsing is a no-op for real UUIDs;
 * memory content is NOT normalized (newlines are legitimate there) and content
 * is never logged.
 */
const deleteMemoryIdSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(200));
const deleteReasonSchema = z
  .string()
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
  const url = new URL(req.url ?? "/", "http://agentmemory.local"); // inbound parsing only
  const path = url.pathname;

  // Everything under /agentmemory/ is guarded; `livez` alone is exempt.
  if (!path.startsWith("/agentmemory/")) throw new HttpError(404, "not_found");
  if (path !== "/agentmemory/livez" && !isBearerAuthorized(req.headers.authorization, secret)) {
    res.setHeader("www-authenticate", "Bearer");
    sendJson(res, 401, { error: "unauthorized" });
    return 401;
  }

  // GET /agentmemory/livez
  if (path === "/agentmemory/livez") {
    requireMethod(method, "GET");
    sendJson(res, 200, { status: "ok" });
    return 200;
  }

  // GET /agentmemory/health?project=
  if (path === "/agentmemory/health") {
    requireMethod(method, "GET");
    const query = parseOr400(healthQuerySchema, queryRecord(url));
    const counts = await store.healthCounts(query.project ?? DEFAULT_PROJECT);
    sendJson(res, 200, { status: "ok", counts });
    return 200;
  }

  // POST /agentmemory/remember
  if (path === "/agentmemory/remember") {
    requireMethod(method, "POST");
    const body = parseOr400(rememberBodySchema, await readJsonBody(req));
    const result = await store.remember({
      content: body.content,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      sessionId: body.sessionId ?? randomUUID(),
      origin: body.origin ?? DEFAULT_ORIGIN,
      importance: body.importance ?? DEFAULT_IMPORTANCE,
    });
    sendJson(res, 201, result);
    return 201;
  }

  // POST /agentmemory/search
  if (path === "/agentmemory/search") {
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

  // POST /agentmemory/smart-search
  if (path === "/agentmemory/smart-search") {
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

  // GET /agentmemory/sessions
  // GET /agentmemory/sessions/:sessionId/memories
  if (path === "/agentmemory/sessions" || path.startsWith("/agentmemory/sessions/")) {
    const segments = path.split("/"); // ["", "agentmemory", "sessions", …]
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

  // POST /agentmemory/forget
  if (path === "/agentmemory/forget") {
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

  // POST /agentmemory/recap
  if (path === "/agentmemory/recap") {
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

  // POST /agentmemory/handoff (body identical to recap)
  if (path === "/agentmemory/handoff") {
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

  // POST /agentmemory/lesson — remember with origin forced to "lesson"
  if (path === "/agentmemory/lesson") {
    requireMethod(method, "POST");
    const body = parseOr400(lessonBodySchema, await readJsonBody(req));
    const result = await store.remember({
      content: body.content,
      concepts: body.concepts ?? [],
      project: body.project ?? DEFAULT_PROJECT,
      sessionId: body.sessionId ?? randomUUID(),
      origin: LESSON_ORIGIN,
      importance: body.importance ?? DEFAULT_IMPORTANCE,
    });
    sendJson(res, 201, result);
    return 201;
  }

  // POST /agentmemory/delete — governance delete (reason required)
  if (path === "/agentmemory/delete") {
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

export interface AgentMemoryServerOptions {
  store?: MemoryStore;
  /** Non-empty secret arms the bearer guard; undefined leaves routes open. */
  secret?: string | undefined;
}

export function createAgentMemoryServer(options: AgentMemoryServerOptions = {}): Server {
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
        console.error(`[agentmemory] response failed: ${logSafeNote(err)}`);
      });
  });
}

function parsePort(raw: string | undefined): number {
  const value = raw === undefined ? 3111 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("AGENT_MEMORY_PORT must be an integer between 1 and 65535");
  }
  return value;
}

function main(): void {
  const port = parsePort(process.env["AGENT_MEMORY_PORT"]);
  const host = process.env["AGENT_MEMORY_HOST"] ?? "127.0.0.1";
  const secret = secretFromEnv();

  const server = createAgentMemoryServer({ secret });
  server.on("error", (err) => {
    console.error(`[agentmemory] server error: ${logSafeNote(err)}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    // Never print the secret value — only whether the guard is armed.
    console.log(
      `agent-memory REST on http://${host}:${port} (auth: ${secret === undefined ? "open" : "bearer-required"})`,
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
