/**
 * OpenCode V2 plugin: agent-memory.
 *
 * Two halves:
 *
 *  1. FIVE TOOLS (`memory_save` / `memory_search` / `memory_smart_search` /
 *     `memory_forget` / `memory_health`) — a native mirror of the stdio MCP
 *     surface in `src/mcp.ts`, reaching the REST service in `src/server.ts`.
 *
 *  2. AUTOMATIC CONTEXT — three session hooks that enrich every model request
 *     with durable memories, without the agent having to ask:
 *
 *       prompt      → captures the newest user text as the recall query
 *       context     → auto-runs hybrid search and injects the marked block
 *       compaction  → re-seeds that block so recall survives compression
 *       tool.execute.after → invalidates the cache after save/forget
 *
 *     Injection is guarded by a single marker so it is IDEMPOTENT: if the
 *     block is already in `system`, we do not add a second one. One marker is
 *     used for BOTH the context and compaction hooks deliberately —
 *     `SessionCompaction extends SessionContext`, so both can target the same
 *     `system` array, and two markers would risk injecting the same body
 *     twice. This matches the production pattern in
 *     `~/.config/opencode/plugins/guardrails.ts`. The two blocks differ only
 *     in their prose, so you can still tell which path seeded them.
 *
 * Design rules — all deliberate:
 *
 *   - HTTP ONLY. No `@helix-db/helix-db` or embedder imports, so the plugin
 *     runtime stays dependency-light beyond `@opencode/plugin`, and it reuses
 *     the REST bearer guard, boundary validation and RRF fusion that already
 *     exist server-side. One implementation of the rules, not two.
 *
 *   - FAIL SOFT, EVERYWHERE. A dead or slow memory service must NEVER block
 *     the agent — least of all from an automatic hook, where a throw would
 *     abort the whole turn. Network errors, timeouts, 4xx/5xx and malformed
 *     bodies all degrade to "no injection" plus a note in `lastError` (read
 *     back by `memory_health`). Same contract as `hooks/capture.mjs`.
 *
 *   - BOUNDED COST. Auto-recall runs inside the hot path of every model
 *     request, so: 1.5s cap (vs the 2s tool cap), a TTL+LRU cache so
 *     tool-loop iterations re-push cached text for free, a row/char budget on
 *     the block, and a per-session query store with a fixed ceiling.
 *
 *   - NEVER logs, echoes or returns `AGENT_MEMORY_SECRET`. It rides only in the
 *     `Authorization` header; no error message includes it.
 *
 *   - STRICT bodies. `/remember` and `/search*` are zod `.strict()` on the
 *     server, so request bodies are built field-by-field — never spread from
 *     raw tool input — and every optional field is defaulted before sending.
 *
 *   - CONFIG precedence: plugin option > environment variable > default.
 *     `project` falls back to the workspace directory name (same derivation as
 *     `hooks/capture.mjs`) so hook captures and plugin saves share a tenant key.
 *
 * VERSION is kept in lockstep with package.json by hand (there is no shared
 * module here, unlike `~/.config/opencode/plugins/shared.ts`).
 */
import { Plugin } from "@opencode/plugin";

const VERSION = "0.2.0";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_BASE = "http://127.0.0.1:3111";
const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
const DEFAULT_ORIGIN = "opencode-plugin";
const DEFAULT_IMPORTANCE = 0.5;
const TIMEOUT_MS = 2_000;

/** Auto-recall runs on every model request — tighter than the tool cap. */
const AUTO_TIMEOUT_MS = 1_500;

/* Injection defaults (option > env > these). */
const DEFAULT_INJECT = true;
const DEFAULT_INJECT_LIMIT = 8;
const INJECT_LIMIT_MIN = 1;
const INJECT_LIMIT_MAX = 20;
const DEFAULT_INJECT_TTL_MS = 45_000;
const INJECT_TTL_MIN_MS = 1_000;
const INJECT_TTL_MAX_MS = 600_000;

/** Bounds mirrored from `src/server.ts` zod schemas (contract §3). */
const MAX_CONTENT = 200_000;
const MAX_CONCEPTS = 64;
const MAX_CONCEPT = 200;
const MAX_PROJECT = 200;
const MAX_SESSION = 200;
const MAX_ORIGIN = 100;
const MAX_QUERY = 10_000;
const MAX_MEMORY_ID = 200;

/** Bounds for the automatic path (token budget + embedding sanity). */
const MIN_AUTO_QUERY = 3;
const MAX_AUTO_QUERY = 500;
const CLIP_QUERY = 160;
const CLIP_CONTENT = 240;
const CLIP_NOTE = 120;
const MAX_BLOCK_CHARS = 4_000;
const MAX_SIGNALS_SHOWN = 3;
const MAX_CACHE_ENTRIES = 64;
const MAX_QUERY_TRACKED = 64;
const MAX_ERROR_CHARS = 300;
const SCORE_DECIMALS = 4;
const IMPORTANCE_DECIMALS = 2;
const SHORT_ID_CHARS = 8;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** Idempotency token. Shared by the context AND compaction hooks (see header). */
export const MARKER = `[agent-memory v${VERSION}]`;

const RECALL_HINT =
  "Recall deeper: memory_smart_search (hybrid RRF); keyword-only: memory_search; " +
  "persist durable facts: memory_save; remove one: memory_forget.";

const TRUE_TOKENS = new Set(["1", "true", "yes", "on"]);
const FALSE_TOKENS = new Set(["0", "false", "no", "off"]);

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

interface Config {
  readonly base: string;
  readonly secret: string | undefined;
  readonly project: string;
  readonly inject: boolean;
  readonly injectLimit: number;
  readonly injectTtlMs: number;
}

/** Read a non-blank string plugin option. */
function option(options: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value: unknown = options[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function env(name: string): string | undefined {
  const value: string | undefined = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const token = value.trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  return undefined;
}

/**
 * Raw plugin option. Unlike `option()` this keeps booleans and numbers intact —
 * opencode.json carries `"inject": false` as a JSON boolean, not a string, and
 * string-only access would silently ignore it.
 */
function rawOption(options: Readonly<Record<string, unknown>>, key: string): unknown {
  return options[key];
}

/** Numeric plugin option, accepting either a JSON number or a numeric string. */
function intOption(
  options: Readonly<Record<string, unknown>>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = options[key];
  if (typeof value === "number") return integer(value, min, max);
  if (typeof value === "string" && value.trim().length > 0) return integer(Number(value), min, max);
  return undefined;
}

/** Mirror of `z.number().int().min(min).max(max)`. */
function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function envInt(name: string, min: number, max: number): number | undefined {
  const raw = env(name);
  return raw === undefined ? undefined : integer(Number(raw), min, max);
}

/** Last path segment — the same tenant derivation `hooks/capture.mjs` uses. */
function workspaceName(path: string): string | undefined {
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  return typeof last === "string" && last.length > 0 ? last : undefined;
}

export function config(context: {
  options: Readonly<Record<string, unknown>>;
  location: { directory: string; project: { canonical?: string } };
}): Config {
  const location = context.location;
  const secret = option(context.options, "secret") ?? env("AGENT_MEMORY_SECRET");
  return {
    base: option(context.options, "url") ?? env("AGENT_MEMORY_URL") ?? DEFAULT_BASE,
    secret: secret !== undefined && secret.length > 0 ? secret : undefined,
    project:
      option(context.options, "project") ??
      env("AGENT_MEMORY_PROJECT") ??
      workspaceName(location.project.canonical ?? location.directory) ??
      DEFAULT_PROJECT,
    inject:
      parseBool(rawOption(context.options, "inject")) ??
      parseBool(env("AGENT_MEMORY_INJECT")) ??
      DEFAULT_INJECT,
    injectLimit:
      intOption(context.options, "injectLimit", INJECT_LIMIT_MIN, INJECT_LIMIT_MAX) ??
      envInt("AGENT_MEMORY_INJECT_LIMIT", INJECT_LIMIT_MIN, INJECT_LIMIT_MAX) ??
      DEFAULT_INJECT_LIMIT,
    injectTtlMs:
      intOption(context.options, "injectTtlMs", INJECT_TTL_MIN_MS, INJECT_TTL_MAX_MS) ??
      envInt("AGENT_MEMORY_INJECT_TTL_MS", INJECT_TTL_MIN_MS, INJECT_TTL_MAX_MS) ??
      DEFAULT_INJECT_TTL_MS,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP — bounded, authenticated, never throws                         */
/* ------------------------------------------------------------------ */

type Outcome = { readonly ok: true; readonly body: string } | { readonly ok: false; readonly note: string };

/** Relative join keeps any path prefix in `AGENT_MEMORY_URL` intact (see `hooks/capture.mjs`). */
function endpoint(base: string, path: string): URL | undefined {
  try {
    return new URL(path, base.endsWith("/") ? base : `${base}/`);
  } catch {
    return undefined;
  }
}

/** Origin only — never the path, query or credentials. Safe to show in diagnostics. */
function safeOrigin(base: string): string | undefined {
  try {
    return new URL(base).origin;
  } catch {
    return undefined;
  }
}

export async function call(
  cfg: Config,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Outcome> {
  const url = endpoint(cfg.base, path);
  if (url === undefined) return { ok: false, note: "invalid AGENT_MEMORY_URL" };

  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cfg.secret !== undefined) headers["authorization"] = `Bearer ${cfg.secret}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Network error or timeout. Deliberately says nothing about the URL or
    // headers: an error string must never become a secret exfiltration path.
    return { ok: false, note: "unreachable — start it with `npm run dev` (or set AGENT_MEMORY_URL)" };
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, note: `HTTP ${response.status}` };
  return { ok: true, body: text };
}

/* ------------------------------------------------------------------ */
/* Output helpers                                                      */
/* ------------------------------------------------------------------ */

function ok(body: string): { content: string; metadata: { ok: true } } {
  let rendered = body;
  try {
    const parsed: unknown = JSON.parse(body);
    rendered = JSON.stringify(parsed, null, 2) ?? body;
  } catch {
    // Not JSON (should not happen for these routes): show it verbatim.
  }
  return { content: rendered, metadata: { ok: true } };
}

function failed(note: string): { content: string; metadata: { ok: false; error: string } } {
  return { content: `agent-memory: ${note}`, metadata: { ok: false, error: note } };
}

function invalid(what: string): { content: string; metadata: { ok: false; error: string } } {
  return failed(`invalid input: ${what}`);
}

function asJson(body: string): unknown {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    return body;
  }
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

/* ------------------------------------------------------------------ */
/* Input narrowing — every tool input arrives as `unknown`             */
/* ------------------------------------------------------------------ */

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mirror of `z.string().trim().min(1).max(max)`: trim, then bound. */
function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
}

/** Mirror of `z.array(z.string().trim().min(1).max(len)).max(items)`. */
function strList(value: unknown, items: number, len: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > items) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const entry = str(item, len);
    if (entry === undefined) return undefined;
    out.push(entry);
  }
  return out;
}

/** Lenient slice: takes up to `max` usable strings, skipping junk (unlike strList). */
function strSlice(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= max) break;
    if (typeof item === "string" && item.trim().length > 0) out.push(item.trim());
  }
  return out;
}

/** Mirror of `z.number().min(min).max(max)` (rejects NaN / Infinity, allows fractions). */
function fraction(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/* ------------------------------------------------------------------ */
/* Automatic recall: marker, cache, enrichment                         */
/*                                                                       */
/* MARKER / hasMarker / parseRecall / formatRecall / autoRecall / config   */
/* and call are exported (beyond the default Plugin export) so that the    */
/* idempotency guard, the block's size budget and the fail-soft recall     */
/* path can be verified directly — OpenCode only consumes `export default`. */
/* ----------------------------------------------------------------------- */
/* ------------------------------------------------------------------ */

interface RecallRow {
  readonly memoryId: string;
  readonly content: string;
  readonly score: number;
  readonly source: string;
  readonly createdAt: string;
  readonly importance: number | undefined;
}

interface RecallHit {
  readonly rows: readonly RecallRow[];
  readonly signals: readonly string[];
}

interface RecallEntry {
  /** `null` = we searched and there was nothing worth injecting (or it failed). */
  readonly block: string | null;
  /** Fetch time — drives TTL (freshness), independent of LRU position. */
  readonly at: number;
}

/** Newest user text per session — the query for auto-recall. Recency-ordered. */
const lastPrompt = new Map<string, string>();

/** sessionID + query → rendered block. Bounded, LRU-ordered. */
const recallCache = new Map<string, RecallEntry>();

/** Last failure, surfaced by `memory_health`. Never contains the secret. */
let lastError: string | undefined;

/**
 * Marker guard. Accepts either raw strings or `{type:"text",text}` parts, so
 * idempotency holds across the context and compaction hooks and across retries.
 */
function textOf(part: object): unknown {
  // `in` narrows to `object & Record<"text", unknown>` — no cast needed.
  return "text" in part ? part.text : undefined;
}

export function hasMarker(parts: unknown): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((part) => {
    if (typeof part === "string") return part.includes(MARKER);
    if (part !== null && typeof part === "object") {
      const text = textOf(part);
      return typeof text === "string" && text.includes(MARKER);
    }
    return false;
  });
}

/** Reads rows + envelope signals out of a `/smart-search` or `/search` body. */
export function parseRecall(body: string): RecallHit | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isBag(raw) || !Array.isArray(raw.results)) return undefined;

  const rows: RecallRow[] = [];
  for (const item of raw.results) {
    if (!isBag(item)) continue;
    const content = typeof item.content === "string" ? item.content : "";
    if (content.trim().length === 0) continue;
    rows.push({
      memoryId: typeof item.memoryId === "string" ? item.memoryId : "",
      content,
      score: fraction(item.score, -Infinity, Infinity) ?? 0,
      source: typeof item.source === "string" && item.source.length > 0 ? item.source : "?",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      importance: fraction(item.importance, 0, 1),
    });
  }
  return { rows, signals: strSlice(raw.signals, MAX_SIGNALS_SHOWN) };
}

function ageOf(createdAt: string): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s ago`;
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY * 2) return `${hours}h ago`;
  return `${Math.round(hours / HOURS_PER_DAY)}d ago`;
}

/**
 * Render the enriched block. Returns `null` when there is nothing to inject,
 * so an empty result never costs the model any tokens.
 */
export function formatRecall(cfg: Config, query: string, hit: RecallHit): string | null {
  const rows = hit.rows.slice(0, cfg.injectLimit);
  if (rows.length === 0) return null;

  const lines: string[] = [
    `Auto-recalled from agent-memory (project "${cfg.project}", hybrid RRF, ` +
      `${rows.length} of ${hit.rows.length} hits) for: "${clip(query, CLIP_QUERY)}"`,
  ];

  rows.forEach((row, index) => {
    const meta: string[] = [row.source, `score ${row.score.toFixed(SCORE_DECIMALS)}`];
    if (row.importance !== undefined) meta.push(`imp ${row.importance.toFixed(IMPORTANCE_DECIMALS)}`);
    const age = ageOf(row.createdAt);
    if (age.length > 0) meta.push(age);
    const id = row.memoryId.length > 0 ? ` (id=${row.memoryId.slice(0, SHORT_ID_CHARS)})` : "";
    lines.push(`${index + 1}. [${meta.join(" · ")}] ${clip(row.content, CLIP_CONTENT)}${id}`);
  });

  if (hit.signals.length > 0) {
    lines.push(`Signals (recall is partial): ${hit.signals.map((s) => clip(s, CLIP_NOTE)).join("; ")}`);
  }
  lines.push(RECALL_HINT);

  const block = lines.join("\n");
  return clip(block, MAX_BLOCK_CHARS);
}

function rememberQuery(sessionID: string, text: string): void {
  // delete + set keeps Map order == recency order for the LRU below.
  lastPrompt.delete(sessionID);
  lastPrompt.set(sessionID, text);
  while (lastPrompt.size > MAX_QUERY_TRACKED) {
    const oldest = lastPrompt.keys().next();
    if (oldest.done) break;
    lastPrompt.delete(oldest.value);
  }
}

function evictOldest(cache: Map<string, RecallEntry>, max: number): void {
  while (cache.size > max) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Hybrid search for `query`, cached by (session, query).
 * Returns the markerless body, or `null` when there is nothing to inject.
 * Never throws — auto-recall runs inside the request hot path.
 */
export async function autoRecall(cfg: Config, sessionID: string, query: string): Promise<string | null> {
  const key = `${sessionID}\u0000${query}`;
  const now = Date.now();
  const cached = recallCache.get(key);
  if (cached !== undefined && now - cached.at < cfg.injectTtlMs) {
    // Refresh LRU position only; `at` stays the fetch time so TTL = freshness.
    recallCache.delete(key);
    recallCache.set(key, cached);
    return cached.block;
  }

  const outcome = await call(
    cfg,
    "POST",
    "agentmemory/smart-search",
    { query, concepts: [], project: cfg.project, limit: cfg.injectLimit },
    AUTO_TIMEOUT_MS,
  );

  let block: string | null = null;
  if (!outcome.ok) {
    // Cached too: a dead service is retried once per TTL, not once per turn.
    lastError = clip(`auto-recall: ${outcome.note}`, MAX_ERROR_CHARS);
  } else {
    const hit = parseRecall(outcome.body);
    if (hit === undefined) {
      lastError = clip("auto-recall: unexpected response shape", MAX_ERROR_CHARS);
    } else {
      lastError = undefined;
      block = formatRecall(cfg, query, hit);
    }
  }

  recallCache.set(key, { block, at: now });
  evictOldest(recallCache, MAX_CACHE_ENTRIES);
  return block;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export default Plugin.define({
  id: "agent-memory",

  async setup(context) {
    const cfg = config(context);
    const registrations: Array<() => Promise<void>> = [];

    await context.tool.transform((editor) => {
      editor.namespace({
        name: "memory",
        description:
          "Persistent agent memory backed by HelixDB (graph + vector + BM25 hybrid retrieval). Save durable facts, then recall them with hybrid search.",
      });

      editor.add({
        name: "save",
        description:
          "Persist one memory (content + optional concept labels) into the agent memory graph. Returns the generated memory id, effective session and project.",
        input: {
          type: "object",
          properties: {
            content: {
              type: "string",
              minLength: 1,
              maxLength: MAX_CONTENT,
              description: "The memory text to persist.",
            },
            concepts: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: MAX_CONCEPT },
              maxItems: MAX_CONCEPTS,
              description:
                "Optional concept labels. These become Concept nodes and power the graph branch of hybrid search.",
            },
            project: {
              type: "string",
              minLength: 1,
              maxLength: MAX_PROJECT,
              description: "Tenant/scope key. Defaults to the workspace name.",
            },
            sessionId: {
              type: "string",
              minLength: 1,
              maxLength: MAX_SESSION,
              description: "Groups memories into a session. Defaults to the current OpenCode session.",
            },
            origin: {
              type: "string",
              minLength: 1,
              maxLength: MAX_ORIGIN,
              description: "Provenance tag. Defaults to opencode-plugin.",
            },
            importance: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "0..1 tie-break weight used when fused ranks are equal. Defaults to 0.5.",
            },
          },
          required: ["content"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        // Input arrives `unknown` (JSON Schema has no static type): narrow it
        // explicitly rather than casting. Context supplies the session default.
        execute: async (raw: unknown, toolContext) => {
          const input = isBag(raw) ? raw : {};
          const content = str(input.content, MAX_CONTENT);
          if (content === undefined) return invalid("`content` must be a non-empty string");

          const concepts = strList(input.concepts, MAX_CONCEPTS, MAX_CONCEPT) ?? [];
          const project = str(input.project, MAX_PROJECT) ?? cfg.project;
          const sessionId = str(input.sessionId, MAX_SESSION) ?? String(toolContext.sessionID);
          const origin = str(input.origin, MAX_ORIGIN) ?? DEFAULT_ORIGIN;
          const importance = fraction(input.importance, 0, 1) ?? DEFAULT_IMPORTANCE;

          const outcome = await call(cfg, "POST", "agentmemory/remember", {
            content,
            concepts,
            project,
            sessionId,
            origin,
            importance,
          });
          return outcome.ok ? ok(outcome.body) : failed(outcome.note);
        },
      });

      editor.add({
        name: "search",
        description:
          "Keyword (BM25) search over memories in a project. Degrades to empty results with a signals list when the text index is unavailable.",
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: MAX_QUERY,
              description: "Keywords to match against stored memory content.",
            },
            project: {
              type: "string",
              minLength: 1,
              maxLength: MAX_PROJECT,
              description: "Tenant/scope key. Defaults to the workspace name.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              description: "Maximum rows to return. Defaults to 10.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (raw: unknown) => {
          const input = isBag(raw) ? raw : {};
          const query = str(input.query, MAX_QUERY);
          if (query === undefined) return invalid("`query` must be a non-empty string");

          const outcome = await call(cfg, "POST", "agentmemory/search", {
            query,
            project: str(input.project, MAX_PROJECT) ?? cfg.project,
            limit: integer(input.limit, 1, 100) ?? DEFAULT_LIMIT,
          });
          return outcome.ok ? ok(outcome.body) : failed(outcome.note);
        },
      });

      editor.add({
        name: "smart_search",
        description:
          "Hybrid search: vector + BM25 + optional concept graph, fused with Reciprocal Rank Fusion. Each row carries its source and the signals list records any degraded upstream source. Preferred over plain search for recall.",
        input: {
          type: "object",
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: MAX_QUERY,
              description: "Natural-language query to embed and match.",
            },
            concepts: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: MAX_CONCEPT },
              maxItems: MAX_CONCEPTS,
              description: "Optional concept labels that add the graph branch to the fusion.",
            },
            project: {
              type: "string",
              minLength: 1,
              maxLength: MAX_PROJECT,
              description: "Tenant/scope key. Defaults to the workspace name.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              description: "Maximum rows to return. Defaults to 10.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (raw: unknown) => {
          const input = isBag(raw) ? raw : {};
          const query = str(input.query, MAX_QUERY);
          if (query === undefined) return invalid("`query` must be a non-empty string");

          const outcome = await call(cfg, "POST", "agentmemory/smart-search", {
            query,
            concepts: strList(input.concepts, MAX_CONCEPTS, MAX_CONCEPT) ?? [],
            project: str(input.project, MAX_PROJECT) ?? cfg.project,
            limit: integer(input.limit, 1, 100) ?? DEFAULT_LIMIT,
          });
          return outcome.ok ? ok(outcome.body) : failed(outcome.note);
        },
      });

      editor.add({
        name: "forget",
        description:
          "Hard-delete one memory by its memory id. Returns {forgotten:true}, or reports error not_found when the id does not exist.",
        input: {
          type: "object",
          properties: {
            memoryId: {
              type: "string",
              minLength: 1,
              maxLength: MAX_MEMORY_ID,
              description: "The memory id returned by save.",
            },
          },
          required: ["memoryId"],
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (raw: unknown) => {
          const input = isBag(raw) ? raw : {};
          const memoryId = str(input.memoryId, MAX_MEMORY_ID);
          if (memoryId === undefined) return invalid("`memoryId` must be a non-empty string");

          const outcome = await call(cfg, "POST", "agentmemory/forget", { memoryId });
          return outcome.ok ? ok(outcome.body) : failed(outcome.note);
        },
      });

      editor.add({
        name: "health",
        description:
          "Service liveness, the endpoint being contacted, and memory/session counts for a project. Use to diagnose a failed save or search.",
        input: {
          type: "object",
          properties: {
            project: {
              type: "string",
              minLength: 1,
              maxLength: MAX_PROJECT,
              description: "Tenant/scope key. Defaults to the workspace name.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "memory", codemode: true },
        execute: async (raw: unknown) => {
          const input = isBag(raw) ? raw : {};
          const project = str(input.project, MAX_PROJECT) ?? cfg.project;

          const outcome = await call(cfg, "GET", `agentmemory/health?project=${encodeURIComponent(project)}`, undefined);
          if (!outcome.ok) return failed(outcome.note);

          // `origin` strips any path, query or credentials before display.
          const payload = JSON.stringify(
            {
              endpoint: safeOrigin(cfg.base) ?? "invalid",
              response: asJson(outcome.body),
              // Diagnoses the automatic half without needing a log file.
              injection: {
                enabled: cfg.inject,
                marker: MARKER,
                limit: cfg.injectLimit,
                ttlMs: cfg.injectTtlMs,
                cacheEntries: recallCache.size,
                trackedSessions: lastPrompt.size,
                lastError: lastError ?? null,
              },
            },
            null,
            2,
          );
          return { content: payload ?? "{}", metadata: { ok: true } };
        },
      });
    });

    /* ---- 1. Capture the newest user text as the recall query ---- */
    registrations.push(
      (await context.session.hook("prompt", (event) => {
        const raw: unknown = event.prompt?.text;
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text.length < MIN_AUTO_QUERY) return;
        rememberQuery(String(event.sessionID), text.slice(0, MAX_AUTO_QUERY));
      })).dispose,
    );

    /* ---- 2. Inject auto-recalled context behind the marker ---- */
    registrations.push(
      (await context.session.hook("context", async (event) => {
        if (!cfg.inject) return;
        if (hasMarker(event.system)) return; // idempotent — no duplication
        const query = lastPrompt.get(String(event.sessionID));
        if (query === undefined) return; // nothing asked yet
        try {
          const body = await autoRecall(cfg, String(event.sessionID), query);
          if (body === null) return; // empty or failed — inject nothing
          event.system.push({ type: "text", text: `${MARKER} ${body}` });
        } catch (error) {
          // A throwing hook would abort the turn: record and move on.
          lastError = clip(`context hook: ${String(error)}`, MAX_ERROR_CHARS);
        }
      })).dispose,
    );

    /* ---- 3. Re-seed behind the same marker so recall survives compaction ---- */
    registrations.push(
      (await context.session.hook("compaction", async (event) => {
        if (hasMarker(event.system)) return;
        const query = lastPrompt.get(String(event.sessionID));
        try {
          // Search only when injection is on AND we have a query; otherwise the
          // static reminder still lands for free (zero latency, zero tokens-ish).
          const body = cfg.inject && query !== undefined
            ? await autoRecall(cfg, String(event.sessionID), query)
            : null;

          const intro =
            `${MARKER} Durable memories survive context compaction (project "${cfg.project}"). ` +
            (query !== undefined ? `Last request: "${clip(query, CLIP_QUERY)}". ` : "") +
            RECALL_HINT;
          const text = body === null ? intro : `${intro}\n${body}`;
          event.system.push({ type: "text", text });
        } catch (error) {
          lastError = clip(`compaction hook: ${String(error)}`, MAX_ERROR_CHARS);
        }
      })).dispose,
    );

    /* ---- 4. Writes invalidate the cache so new memories surface next turn ---- */
    registrations.push(
      (await context.tool.hook("execute.after", (event) => {
        if (event.status !== "completed") return;
        if (event.tool !== "memory_save" && event.tool !== "memory_forget") return;
        recallCache.clear();
      })).dispose,
    );

    return async () => {
      for (const dispose of registrations) {
        try {
          await dispose();
        } catch (error) {
          lastError = clip(`dispose: ${String(error)}`, MAX_ERROR_CHARS);
        }
      }
      registrations.length = 0;
      recallCache.clear();
      lastPrompt.clear();
    };
  },
});
