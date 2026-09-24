/**
 * agent-memory MCP server over stdio (contract §3).
 *
 * - official `@modelcontextprotocol/sdk`, 11 frozen core tools
 * - backed by the SAME MemoryStore implementation as the REST server
 * - same bearer rule: when AGENT_MEMORY_SECRET is non-empty, every tool call
 *   must carry `_meta.authorization = "Bearer <secret>"` (stdio has no HTTP
 *   headers; `_meta` is the per-request metadata channel). Mismatch ->
 *   MCP error `unauthorized`. The secret value is never logged or echoed.
 * - stdout carries ONLY the MCP protocol — all diagnostics go to stderr,
 *   sanitized (no secrets, no memory content, no remote message bodies).
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

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function failed(payload: { error: string }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

/* Recap/handoff digest assembly lives in `src/digest.ts` — shared with the
 * REST lane so the frozen REST↔MCP mirror cannot drift (contract §3). */

/* Exported (COND-QA-02 / CE-003): tests wire these 11 frozen tools onto an
 * in-memory transport to assert the adapter's importance pass-through. */
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
      console.error(`[agent-memory mcp] ${name}: ${logSafeNote(err)}`);
      return failed({ error: "internal_error" });
    }
  }

  mcp.registerTool(
    "memory_save",
    {
      description:
        "Persist one memory (content + optional concepts) into the agent memory graph. Returns the generated memory id and effective session/project.",
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
        "Keyword (BM25) search over memories in a project. Degrades to empty results with a signals list when the text index is unavailable.",
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
        "Hybrid search: vector + BM25 + optional concept graph, fused with Reciprocal Rank Fusion. Each row carries its source and the signals list records any degraded upstream source.",
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
      description: "List sessions of a project, newest activity first as stored.",
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
      description: "List the memories recorded under one sessionId.",
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
        "Hard-delete one memory by its memory id. Returns {forgotten:true}, or an isError result with error not_found when the id does not exist.",
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
      description: "Service liveness plus memory/session counts for a project.",
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
        "Recap recent memories as text bullets for one sessionId, or for every session of a project. Degrades to partial output with a signals list when the store fails; never errors on store failure.",
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
        "Handoff text: a project/memory/session counts header plus the recap bullets, for one sessionId or a whole project. Degrades like memory_recap — failed counts land in signals.",
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
        "Persist a lesson: memory_save with origin forced to \"lesson\" (no caller-supplied origin). Returns the generated memory id and effective session/project.",
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
        "Governance delete: hard-delete one memory by id with a required reason (emits a governance log line). Returns {deleted:true, receipt:{memoryId, deletedAt}}, or an isError result with error not_found when the id does not exist.",
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
          `[agentmemory] delete governance memoryId=${args.memoryId} reason=${args.reason} at=${deletedAt}`,
        );
        return ok({ deleted: true, receipt: { memoryId: args.memoryId, deletedAt } });
      }),
  );
}

async function main(): Promise<void> {
  const store = createDefaultStore();
  const secret = secretFromEnv();
  const mcp = new McpServer({ name: "agent-memory", version: "0.8.0" });
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
    console.error(`[agent-memory mcp] fatal: ${logSafeNote(err)}`);
    process.exit(1);
  });
}
