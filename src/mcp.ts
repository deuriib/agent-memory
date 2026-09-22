/**
 * agent-memory MCP server over stdio (contract §3).
 *
 * - official `@modelcontextprotocol/sdk`, 7 frozen core tools
 * - backed by the SAME MemoryStore implementation as the REST server
 * - same bearer rule: when AGENT_MEMORY_SECRET is non-empty, every tool call
 *   must carry `_meta.authorization = "Bearer <secret>"` (stdio has no HTTP
 *   headers; `_meta` is the per-request metadata channel). Mismatch ->
 *   MCP error `unauthorized`. The secret value is never logged or echoed.
 * - stdout carries ONLY the MCP protocol — all diagnostics go to stderr,
 *   sanitized (no secrets, no memory content, no remote message bodies).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isMetaAuthorized, secretFromEnv } from "./auth.js";
import { logSafeNote } from "./errors.js";
import { bm25Search, hybridSearch } from "./search.js";
import { createDefaultStore, type MemoryStore } from "./store.js";

const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
/** Default origin for MCP writes (the REST route defaults to "rest"). */
const DEFAULT_ORIGIN = "mcp";
const DEFAULT_IMPORTANCE = 0.5;

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

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function failed(payload: { error: string }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

function registerTools(mcp: McpServer, store: MemoryStore, secret: string | undefined): void {
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
          importance: args.importance ?? DEFAULT_IMPORTANCE,
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
}

async function main(): Promise<void> {
  const store = createDefaultStore();
  const secret = secretFromEnv();
  const mcp = new McpServer({ name: "agent-memory", version: "0.1.0" });
  registerTools(mcp, store, secret);
  // stdout is the protocol channel: never console.log from here.
  await mcp.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  console.error(`[agent-memory mcp] fatal: ${logSafeNote(err)}`);
  process.exit(1);
});
