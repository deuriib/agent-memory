/**
 * Brainy MCP server over stdio (contract §3).
 *
 * - official `@modelcontextprotocol/sdk`, 4 native Brainy tools
 *   (`brainy_search`, `brainy_capture`, `brainy_link`, `brainy_reality_check`)
 * - backed by the SAME store implementation as the REST server
 * - 11 legacy `memory_*` tools + 6 `memory_todo_*` tools kept as
 *   1-version backwards-compatible aliases (each carries a deprecation note)
 * - same bearer rule: when BRAINY_SECRET (fallback AGENT_MEMORY_SECRET) is
 *   non-empty, every tool call must carry `_meta.authorization =
 *   "Bearer <secret>"` (stdio has no HTTP headers; `_meta` is the
 *   per-request metadata channel). Mismatch -> MCP error `unauthorized`.
 *   The secret value is never logged or echoed.
 * - stdout carries ONLY the MCP protocol — all diagnostics go to stderr,
 *   sanitized single-line (no secrets, no memory content, no remote bodies).
 */
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isMetaAuthorized, secretFromEnv } from "./auth.js";
import { buildDigestLines } from "./digest.js";
import { failureSignal, logSafeNote } from "./errors.js";
import { bm25Search, hybridSearch } from "./search.js";
import { createDefaultStore, type MemoryStore } from "./store.js";

const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
/** Default origin for MCP writes (the REST route defaults to "rest"). */
const DEFAULT_ORIGIN = "mcp";
/** `memory_lesson` forces this origin (contract §3, P3.1). */
const LESSON_ORIGIN = "lesson";

const projectSchema = z.string().trim().min(1).max(200);
const limitSchema = z.number().int().min(1).max(100);
const conceptsSchema = z.array(z.string().trim().min(1).max(200)).max(64);

const rememberInput = {
  content: z.string().trim().min(1).max(200_000),
  concepts: conceptsSchema.optional(),
  project: projectSchema.optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  origin: z.string().trim().min(1).max(100).optional(),
  importance: z.number().min(0).max(1).optional(),
};

const searchInput = {
  query: z.string().trim().min(1).max(10_000),
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
};

const smartSearchInput = {
  ...searchInput,
  concepts: conceptsSchema.optional(),
};

const sessionsInput = {
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
};

const sessionMemoriesInput = {
  sessionId: z.string().trim().min(1).max(200),
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
};

const forgetInput = {
  memoryId: z.string().trim().min(1).max(200),
};

/** Recap and handoff share this input (contract §3, P3.1). */
const recapInput = {
  project: projectSchema.optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  limit: limitSchema.optional(),
};

/** Lesson = memory_save without an `origin` field — origin is forced. */
const lessonInput = {
  content: z.string().trim().min(1).max(200_000),
  concepts: conceptsSchema.optional(),
  project: projectSchema.optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  importance: z.number().min(0).max(1).optional(),
};

/**
 * Governance delete: `reason` required, no `project` field. Bounds are declared
 * on BOTH sides of the normalize: the INPUT side (`z.string().min().max()`
 * before `.transform()`) is what the MCP SDK's zod→JSON-schema conversion
 * reads for `tools/list`, so `minLength`/`maxLength` stay advertised (C3-R17);
 * the POST-normalize `.pipe()` bounds keep the COND-001 guarantee — both fields
 * are collapsed to a single line BEFORE those bounds, so an embedded `\n`
 * cannot forge a second line in the governance log (CWE-117) and whitespace-only
 * input still rejects. Whitespace-heavy input that exceeds the raw bound rejects
 * earlier now (pre-normalize), which only tightens validation. No-op for real
 * UUIDs.
 */
const deleteInput = {
  memoryId: z
    .string()
    .min(1)
    .max(200)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(200)),
  reason: z
    .string()
    .min(1)
    .max(1000)
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(1000)),
};

const todoPrioritySchema = z.enum(["low", "medium", "high"]);
const todoStatusSchema = z.enum(["pending", "active", "done", "blocked"]);
const todoCreateInput = {
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(5000).optional(),
  priority: todoPrioritySchema.optional(),
  status: todoStatusSchema.optional(),
  project: projectSchema.optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  parentId: z.string().trim().min(1).max(200).optional(),
};
const todoUpdateInput = {
  todoId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  priority: todoPrioritySchema.optional(),
  status: todoStatusSchema.optional(),
  parentId: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
};
const todoListInput = {
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
  status: todoStatusSchema.optional(),
  priority: todoPrioritySchema.optional(),
  search: z.string().trim().max(500).optional(),
  frontier: z.boolean().optional(),
  parentId: z.string().trim().min(1).max(200).optional(),
};
const todoGetInput = {
  todoId: z.string().trim().min(1).max(200),
};
const todoFrontierInput = {
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
};

/**
 * 1-version alias window (INV-001): every legacy `memory_*` / `memory_todo_*`
 * tool description carries this suffix. The tools keep working unchanged
 * until the next major version removes them.
 */
const DEPRECATED_ALIAS_SUFFIX =
  " (Deprecated alias — use the brainy_* tools; this alias will be removed in the next major version.)";

const brainySearchInput = {
  query: z.string().trim().min(1).max(10_000),
  project: projectSchema.optional(),
  limit: limitSchema.optional(),
  include_graph: z.boolean().optional(),
  max_depth: z.number().int().min(1).max(3).optional(),
  vector_top_k: z.number().int().min(1).max(20).optional(),
};

const brainyCaptureInput = {
  content: z.string().trim().min(1).max(200_000),
  title: z.string().trim().min(1).max(500).optional(),
  project: projectSchema.optional(),
  tags: conceptsSchema.optional(),
};

const brainyLinkInput = {
  fromId: z.string().trim().min(1).max(200),
  toId: z.string().trim().min(1).max(200),
  type: z.enum(["REFERENCES", "BELONGS_TO", "RELATES_TO"]),
  project: projectSchema.optional(),
};

const brainyRealityCheckInput = {
  project: projectSchema.optional(),
};

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function failed(payload: { error: string }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

/* Recap/handoff digest assembly lives in `src/digest.ts` — shared with the
 * REST lane so the frozen REST↔MCP mirror cannot drift (contract §3). */

/* Exported (COND-QA-02 / CE-003): tests wire these tools onto an
 * in-memory transport to assert the adapter's importance pass-through —
 * 4 native Brainy tools plus the 17 legacy aliases. */
export function registerTools(mcp: McpServer, store: MemoryStore, secret: string | undefined): void {
  /**
   * Uniform gate + error boundary: auth first (throws an MCP `unauthorized`
   * error on mismatch), then the store operation; unexpected failures become
   * an `isError` tool result with a sanitized log line — a dead Helix never
   * crashes the MCP process.
   */
  async function handle(
    name: string,
    meta: unknown,
    op: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    if (!isMetaAuthorized(meta, secret)) {
      throw new McpError(ErrorCode.InvalidRequest, "unauthorized");
    }
    try {
      return await op();
    } catch (err) {
      console.error(`[brainy mcp] ${name}: ${logSafeNote(err)}`);
      return failed({ error: "internal_error" });
    }
  }

  mcp.registerTool(
    "memory_save",
    {
      description:
        "Persist one memory (content + optional concepts) into the agent memory graph. Returns the generated memory id and effective session/project." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: rememberInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) =>
      handle("memory_save", extra._meta, async () => {
        const result = await store.remember({
          content: args.content,
          concepts: args.concepts ?? [],
          project: args.project ?? DEFAULT_PROJECT,
          sessionId: args.sessionId ?? crypto.randomUUID(),
          origin: args.origin ?? DEFAULT_ORIGIN,
          // REQ-P1-4: raw optional — absent importance is DERIVED in the store.
          importance: args.importance,
        });
        return ok(result);
      }),
  );

  mcp.registerTool(
    "memory_search",
    {
      description:
        "Keyword (BM25) search over memories in a project. Degrades to empty results with a signals list when the text index is unavailable." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: searchInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_search", extra._meta, async () =>
        ok(
          await bm25Search(store, {
            query: args.query,
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
          }),
        ),
      ),
  );

  mcp.registerTool(
    "memory_smart_search",
    {
      description:
        "Hybrid search: vector + BM25 + optional concept graph, fused with Reciprocal Rank Fusion. Each row carries its source and the signals list records any degraded upstream source." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: smartSearchInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_smart_search", extra._meta, async () =>
        ok(
          await hybridSearch(store, {
            query: args.query,
            concepts: args.concepts ?? [],
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
          }),
        ),
      ),
  );

  mcp.registerTool(
    "memory_sessions",
    {
      description: "List sessions of a project, newest activity first as stored." + DEPRECATED_ALIAS_SUFFIX,
      inputSchema: sessionsInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_sessions", extra._meta, async () =>
        ok({
          sessions: await store.listSessions({
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
          }),
        }),
      ),
  );

  mcp.registerTool(
    "memory_session_memories",
    {
      description: "List the memories recorded under one sessionId." + DEPRECATED_ALIAS_SUFFIX,
      inputSchema: sessionMemoriesInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_session_memories", extra._meta, async () =>
        ok({
          memories: await store.sessionMemories({
            sessionId: args.sessionId,
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
          }),
        }),
      ),
  );

  mcp.registerTool(
    "memory_forget",
    {
      description:
        "Hard-delete one memory by its memory id. Returns {forgotten:true}, or an isError result with error not_found when the id does not exist." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: forgetInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_forget", extra._meta, async () => {
        const forgotten = await store.forget(args.memoryId);
        return forgotten ? ok({ forgotten: true }) : failed({ error: "not_found" });
      }),
  );

  mcp.registerTool(
    "memory_health",
    {
      description: "Service liveness plus memory/session counts for a project." + DEPRECATED_ALIAS_SUFFIX,
      inputSchema: { project: projectSchema.optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_health", extra._meta, async () => {
        const counts = await store.healthCounts(args.project ?? DEFAULT_PROJECT);
        return ok({ status: "ok", counts });
      }),
  );

  mcp.registerTool(
    "memory_recap",
    {
      description:
        "Recap recent memories as text bullets for one sessionId, or for every session of a project. Degrades to partial output with a signals list when the store fails; never errors on store failure." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: recapInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_recap", extra._meta, async () => {
        const digest = await buildDigestLines(store, args);
        return ok({
          recap: digest.lines.join("\n"),
          sessionId: args.sessionId ?? null,
          count: digest.count,
          signals: digest.signals,
        });
      }),
  );

  mcp.registerTool(
    "memory_handoff",
    {
      description:
        "Handoff text: a project/memory/session counts header plus the recap bullets, for one sessionId or a whole project. Degrades like memory_recap — failed counts land in signals." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: recapInput, // body identical to recap (contract §3)
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_handoff", extra._meta, async () => {
        const digest = await buildDigestLines(store, args);
        const signals = digest.signals;
        let counts: { memories: number; sessions: number } = { memories: 0, sessions: 0 };
        try {
          counts = await store.healthCounts(args.project ?? DEFAULT_PROJECT);
        } catch (err) {
          signals.push(`counts: ${failureSignal(err)}`);
        }
        const project = args.project ?? DEFAULT_PROJECT;
        const header = `project=${project} memories=${counts.memories} sessions=${counts.sessions} recent:`;
        return ok({
          handoff: [header, ...digest.lines].join("\n"),
          sessionId: args.sessionId ?? null,
          counts,
          signals,
        });
      }),
  );

  mcp.registerTool(
    "memory_lesson",
    {
      description:
        "Persist a lesson: memory_save with origin forced to \"lesson\" (no caller-supplied origin). Returns the generated memory id and effective session/project." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: lessonInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) =>
      handle("memory_lesson", extra._meta, async () => {
        const result = await store.remember({
          content: args.content,
          concepts: args.concepts ?? [],
          project: args.project ?? DEFAULT_PROJECT,
          sessionId: args.sessionId ?? crypto.randomUUID(),
          origin: LESSON_ORIGIN,
          // REQ-P1-4: raw optional — the store derives lesson importance when absent.
          importance: args.importance,
        });
        return ok(result);
      }),
  );

  mcp.registerTool(
    "memory_delete",
    {
      description:
        "Governance delete: hard-delete one memory by id with a required reason (emits a governance log line). Returns {deleted:true, receipt:{memoryId, deletedAt}}, or an isError result with error not_found when the id does not exist." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: deleteInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_delete", extra._meta, async () => {
        const deleted = await store.forget(args.memoryId);
        if (!deleted) return failed({ error: "not_found" });
        const deletedAt = new Date().toISOString();
        // stderr, not stdout: stdout carries ONLY the MCP protocol. memoryId
        // and reason arrive already single-line from the schema (log-forgery
        // guard); reason is caller-supplied metadata — never memory content,
        // never the secret.
        console.error(
          `[brainy] delete governance memoryId=${args.memoryId} reason=${args.reason} at=${deletedAt}`,
        );
        return ok({ deleted: true, receipt: { memoryId: args.memoryId, deletedAt } });
      }),
  );

  // ---- Todos (follow-ups) — renamed from actions, never "actions" naming ----
  mcp.registerTool(
    "memory_todo_create",
    {
      description:
        "Create a todo (follow-up: decision to revisit, file to inspect, task blocked on input). Status flows pending → active → done/blocked; frontier marks what is unblocked and ready. Returns the created todo." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoCreateInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) =>
      handle("memory_todo_create", extra._meta, async () => {
        try {
          const todo = await store.createTodo({
            title: args.title,
            description: args.description,
            priority: args.priority,
            status: args.status,
            project: args.project ?? DEFAULT_PROJECT,
            sessionId: args.sessionId,
            parentId: args.parentId,
          });
          return ok({ todo });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("parent todo not found") || msg.includes("title is required")) return failed({ error: msg });
          throw err;
        }
      }),
  );

  mcp.registerTool(
    "memory_todo_list",
    {
      description:
        "List todos with optional filters: status, priority, search (title/description substring + BM25), frontier (pending|active only), parentId. Sorted high→low priority then newest first." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoListInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_todo_list", extra._meta, async () =>
        ok({
          todos: await store.listTodos({
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
            status: args.status,
            priority: args.priority,
            search: args.search,
            frontier: args.frontier,
            parentId: args.parentId,
          }),
        }),
      ),
  );

  mcp.registerTool(
    "memory_todo_get",
    {
      description: "Get one todo by its todoId." + DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoGetInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_todo_get", extra._meta, async () => {
        const todo = await store.getTodo(args.todoId);
        return todo !== undefined ? ok({ todo }) : failed({ error: "not_found" });
      }),
  );

  mcp.registerTool(
    "memory_todo_update",
    {
      description:
        "Update a todo (title/description/priority/status/parentId). Status flow pending→active→done/blocked; parentId null clears the parent." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoUpdateInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) =>
      handle("memory_todo_update", extra._meta, async () => {
        try {
          const todo = await store.updateTodo(args.todoId, {
            title: args.title,
            description: args.description,
            priority: args.priority,
            status: args.status,
            parentId: args.parentId as string | null | undefined,
          });
          return todo !== undefined ? ok({ todo }) : failed({ error: "not_found" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("parent todo not found") || msg.includes("cannot be its own parent") || msg.includes("title is required"))
            return failed({ error: msg });
          throw err;
        }
      }),
  );

  mcp.registerTool(
    "memory_todo_delete",
    {
      description: "Delete one todo by its todoId." + DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoGetInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_todo_delete", extra._meta, async () => {
        const deleted = await store.deleteTodo(args.todoId);
        return deleted ? ok({ deleted: true }) : failed({ error: "not_found" });
      }),
  );

  mcp.registerTool(
    "memory_frontier",
    {
      description:
        "Frontier: unblocked todos ready to pick up next (pending ∪ active, priority-ordered). Same as todo_list frontier=true." +
          DEPRECATED_ALIAS_SUFFIX,
      inputSchema: todoFrontierInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("memory_frontier", extra._meta, async () =>
        ok({
          frontier: await store.frontierTodos({ project: args.project ?? DEFAULT_PROJECT, limit: args.limit ?? DEFAULT_LIMIT }),
        }),
      ),
  );

  // ---- Brainy v1 native tools (REQ-BRAINY-ENG-10) ----
  mcp.registerTool(
    "brainy_search",
    {
      description:
        "Hybrid retrieval over 1536-dim vector, graph, and BM25 with RRF (k=60) scoring. Degraded sources land in signals, never a protocol error.",
      inputSchema: brainySearchInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("brainy_search", extra._meta, async () =>
        ok(
          await hybridSearch(store, {
            query: args.query,
            project: args.project ?? DEFAULT_PROJECT,
            limit: args.limit ?? DEFAULT_LIMIT,
            include_graph: args.include_graph,
            max_depth: args.max_depth,
            vector_top_k: args.vector_top_k,
          }),
        ),
      ),
  );

  mcp.registerTool(
    "brainy_capture",
    {
      description:
        "Fast capture with automatic PARA classification and RELATES_TO linking. Returns the note id, project, and PARA target.",
      inputSchema: brainyCaptureInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args, extra) =>
      handle("brainy_capture", extra._meta, async () => {
        const project = args.project ?? DEFAULT_PROJECT;
        const tags = args.tags ?? [];
        if (typeof store.saveNote === "function") {
          return ok(
            await store.saveNote({
              title: args.title ?? args.content.slice(0, 80),
              content: args.content,
              project,
              tags,
              origin: DEFAULT_ORIGIN,
            }),
          );
        }
        // Legacy store without Note support: fall back to the memory path.
        const result = await store.remember({
          content: args.title === undefined ? args.content : `${args.title}\n${args.content}`,
          concepts: tags,
          project,
          sessionId: crypto.randomUUID(),
          origin: DEFAULT_ORIGIN,
        });
        return ok({ ...result, fallback: "memory" });
      }),
  );

  mcp.registerTool(
    "brainy_link",
    {
      description:
        "Explicit graph edge creation between two notes in the same project tenant (REFERENCES, BELONGS_TO, or RELATES_TO). Cross-project links are rejected.",
      inputSchema: brainyLinkInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("brainy_link", extra._meta, async () => {
        if (typeof store.linkNodes !== "function") {
          return failed({ error: "unsupported" });
        }
        try {
          const linked = await store.linkNodes({
            fromId: args.fromId,
            toId: args.toId,
            type: args.type,
            project: args.project ?? DEFAULT_PROJECT,
          });
          return linked
            ? ok({ linked: true, edge: { fromId: args.fromId, toId: args.toId, type: args.type } })
            : failed({ error: "not_found" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("invalid_tenant_link")) return failed({ error: "invalid_tenant_link" });
          throw err;
        }
      }),
  );

  mcp.registerTool(
    "brainy_reality_check",
    {
      description:
        "Grounding tool: project counts plus recent notes and sessions so the agent answers from active project context, not stale memory.",
      inputSchema: brainyRealityCheckInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) =>
      handle("brainy_reality_check", extra._meta, async () => {
        const project = args.project ?? DEFAULT_PROJECT;
        const signals: string[] = [];
        let counts: { memories: number; sessions: number } = { memories: 0, sessions: 0 };
        try {
          counts = await store.healthCounts(project);
        } catch (err) {
          signals.push(`counts: ${failureSignal(err)}`);
        }
        let notes: unknown[] = [];
        if (typeof store.listNotes === "function") {
          try {
            notes = await store.listNotes({ project, limit: 10 });
          } catch (err) {
            signals.push(`notes: ${failureSignal(err)}`);
          }
        }
        let sessions: unknown[] = [];
        try {
          sessions = await store.listSessions({ project, limit: 5 });
        } catch (err) {
          signals.push(`sessions: ${failureSignal(err)}`);
        }
        return ok({ project, counts, notes, sessions, signals });
      }),
  );
}

async function main(): Promise<void> {
  const store = createDefaultStore();
  const secret = secretFromEnv();
  const mcp = new McpServer({ name: "brainy", version: "1.0.0" });
  registerTools(mcp, store, secret);
  // stdout is the protocol channel: never console.log from here.
  await mcp.connect(new StdioServerTransport());
}

/* Entrypoint guard: run stdio main() ONLY when this file is the process
 * entrypoint (`npx tsx src/mcp.ts`, relative or absolute — argv[1] resolves
 * to the same file URL as import.meta.url under tsx, proven in all README
 * launch forms). Importing this module for tests must NEVER hijack stdout —
 * stdio carries the MCP protocol, so an import-triggered connect would eat
 * the test runner's output channel. */
const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((err: unknown) => {
    console.error(`[brainy mcp] fatal: ${logSafeNote(err)}`);
    process.exit(1);
  });
}
