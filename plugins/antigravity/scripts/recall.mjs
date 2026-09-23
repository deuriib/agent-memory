#!/usr/bin/env node
/**
 * agent-memory auto-recall hook — Google Antigravity PreInvocation handler.
 *
 * Plain Node ESM, ZERO dependencies. Reads the PreInvocation JSON on stdin,
 * derives the recall query from the LAST USER MESSAGE in `transcriptPath`,
 * runs one bounded hybrid search against the agent-memory REST service, and
 * prints injectSteps so recalled memories reach the model without the agent
 * having to ask. This is the Antigravity analogue of the OpenCode plugin's
 * `context` hook (plugins/opencode/plugins/agent-memory.ts).
 *
 * Output contract:
 *   - hit  -> {"injectSteps":[{"ephemeralMessage":"[agent-memory] ..."}]}
 *   - none -> {}   (empty results, disabled, no query, failure, or a query
 *                   already injected within the TTL)
 *
 * Design rules — all deliberate:
 *   - FAIL SOFT, EVERYWHERE. A dead or slow memory service must NEVER block
 *     the agent. Network errors, timeouts, 4xx/5xx, and malformed bodies all
 *     degrade to `{}`. stdout stays valid contract JSON on every path.
 *   - BOUNDED COST. Runs inside the request hot path: 1.5s search cap,
 *     bounded transcript read (last 256 KiB), row/char budgets on the block,
 *     and an on-disk TTL cache so repeated invocations inject once per TTL.
 *   - NEVER logs, echoes or returns AGENT_MEMORY_SECRET; stderr stays empty.
 *   - Config: env-only, same names as the OpenCode plugin (AGENT_MEMORY_URL /
 *     _SECRET / _PROJECT / _INJECT / _INJECT_LIMIT / _INJECT_TTL_MS). Legacy
 *     AGENTMEMORY_* equivalents are accepted as a SILENT fallback (new name
 *     wins) — deliberately no deprecation warning: stderr stays empty, ever.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_BASE = "http://127.0.0.1:3111";
const AUTO_TIMEOUT_MS = 1_500;
const DEFAULT_INJECT_LIMIT = 8;
const DEFAULT_INJECT_TTL_MS = 45_000;
const MAX_HOOK_BYTES = 1_048_576;
const MAX_TRANSCRIPT_BYTES = 262_144; // tail read — last messages only
const MIN_QUERY = 3;
const MAX_QUERY = 500;
const CLIP_QUERY = 160;
const CLIP_CONTENT = 240;
const CLIP_NOTE = 120;
const MAX_BLOCK_CHARS = 4_000;
const MAX_SIGNALS_SHOWN = 3;
const MAX_ROWS_SHOWN = 20;
const SCORE_DECIMALS = 4;
const IMPORTANCE_DECIMALS = 2;
const SHORT_ID_CHARS = 8;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const RECALL_HINT =
  "Recall deeper: memory_smart_search (hybrid RRF); keyword-only: memory_search; " +
  "persist durable facts: memory_save; remove one: memory_forget.";

const TRUE_TOKENS = new Set(["1", "true", "yes", "on"]);
const FALSE_TOKENS = new Set(["0", "false", "no", "off"]);

const OUT_NONE = "{}";

let printed = false;

/** stdout contract — printed exactly once, on EVERY exit path. */
function finish(value = OUT_NONE) {
  if (printed) return;
  printed = true;
  try {
    process.stdout.write(`${value}\n`);
  } catch {
    // stdout closed: exit code is all that is left to control.
  }
  process.exit(0);
}

process.on("uncaughtException", () => finish());
process.on("unhandledRejection", () => finish());

/* ----------------------------- helpers ----------------------------- */

function clean(value, max) {
  return String(value)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const NEW_PREFIX = "AGENT_MEMORY_";

/** AGENT_MEMORY_FOO -> AGENTMEMORY_FOO; passthrough for any other name. */
function legacyName(name) {
  return name.startsWith(NEW_PREFIX) ? `AGENTMEMORY_${name.slice(NEW_PREFIX.length)}` : name;
}

/**
 * Read one config var with a SILENT legacy fallback: AGENT_MEMORY_X -> falls
 * back to AGENTMEMORY_X when the new name is unset/empty (new name wins).
 * Deliberately prints NOTHING — this hook's contract is empty stderr on every
 * path, so the server-style deprecation warning must never happen here.
 * envBool()/envInt() route through this helper, so INJECT, INJECT_LIMIT,
 * INJECT_TTL_MS, PROJECT, URL and SECRET all inherit the fallback.
 */
function env(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) return value;
  const legacy = process.env[legacyName(name)];
  return typeof legacy === "string" && legacy.length > 0 ? legacy : undefined;
}

function envBool(name) {
  const value = env(name);
  if (value === undefined) return undefined;
  const token = value.trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) return true;
  if (FALSE_TOKENS.has(token)) return false;
  return undefined;
}

function envInt(name, min, max) {
  const raw = env(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function clip(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function isBag(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_HOOK_BYTES) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Expand a leading ~ and reject empty paths. */
function resolvePath(raw) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if (raw === "~") return homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homedir(), raw.slice(2));
  return raw;
}

/* ------------------- transcript -> recall query ------------------- */

/**
 * Extract the last usable user message from Antigravity's transcript.jsonl.
 * The exact record shape is host-version dependent, so several field shapes
 * are tried defensively: {message:{content}}, {content}, {text}, {parts}.
 * Returns undefined when nothing usable is found — never throws.
 */
function lastUserText(transcriptPath) {
  const path = resolvePath(transcriptPath);
  if (path === undefined) return undefined;

  let text;
  try {
    const buf = readFileSync(path);
    // Tail only: the last user message is what recall needs, not history.
    const tail =
      buf.length > MAX_TRANSCRIPT_BYTES ? buf.subarray(buf.length - MAX_TRANSCRIPT_BYTES) : buf;
    text = tail.toString("utf8");
  } catch {
    return undefined; // missing/unreadable transcript: inject nothing
  }

  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // partial first line of a tail read, or non-JSON noise
    }
    if (!isBag(record)) continue;
    const candidate = userTextOf(record);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/** True when the record looks user-authored (role/type discriminator). */
function isUserRecord(record) {
  const role = record.role ?? record.type ?? record.author ?? record.sender;
  if (typeof role !== "string") return true; // no discriminator: allow content probe
  const token = role.toLowerCase();
  return token.includes("user") || token === "human";
}

/** Pull plain text out of the common Gemini/OpenCode/Claude record shapes. */
function userTextOf(record) {
  if (!isUserRecord(record)) return undefined;
  const raw = record.message?.content ?? record.content ?? record.text ?? record.parts;
  let text;
  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    const pieces = [];
    for (const part of raw) {
      if (typeof part === "string") pieces.push(part);
      else if (isBag(part) && typeof part.text === "string") pieces.push(part.text);
    }
    text = pieces.join(" ");
  }
  if (typeof text !== "string") return undefined;
  const query = clean(text, MAX_QUERY);
  return query.length >= MIN_QUERY ? query : undefined;
}

/* ------------------------- recall formatting ------------------------- */

function ageOf(createdAt) {
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

/** Render the injected block; null when there is nothing worth injecting. */
function formatRecall(project, limit, query, body) {
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined; // unexpected shape -> caller treats as failure
  }
  if (!isBag(raw) || !Array.isArray(raw.results)) return undefined;

  const rows = [];
  for (const item of raw.results) {
    if (!isBag(item)) continue;
    const content = typeof item.content === "string" ? item.content : "";
    if (content.trim().length === 0) continue;
    if (rows.length >= MAX_ROWS_SHOWN) break;
    rows.push({
      memoryId: typeof item.memoryId === "string" ? item.memoryId : "",
      content,
      score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
      source: typeof item.source === "string" && item.source.length > 0 ? item.source : "?",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      importance:
        typeof item.importance === "number" && item.importance >= 0 && item.importance <= 1
          ? item.importance
          : undefined,
    });
  }
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return null;

  const lines = [
    `Auto-recalled from agent-memory (project "${project}", hybrid RRF, ` +
      `${shown.length} of ${raw.results.length} hits) for: "${clip(query, CLIP_QUERY)}"`,
  ];
  shown.forEach((row, index) => {
    const meta = [row.source, `score ${row.score.toFixed(SCORE_DECIMALS)}`];
    if (row.importance !== undefined) meta.push(`imp ${row.importance.toFixed(IMPORTANCE_DECIMALS)}`);
    const age = ageOf(row.createdAt);
    if (age.length > 0) meta.push(age);
    const id = row.memoryId.length > 0 ? ` (id=${row.memoryId.slice(0, SHORT_ID_CHARS)})` : "";
    lines.push(`${index + 1}. [${meta.join(" · ")}] ${clip(row.content, CLIP_CONTENT)}${id}`);
  });

  const signals = Array.isArray(raw.signals)
    ? raw.signals.filter((s) => typeof s === "string").slice(0, MAX_SIGNALS_SHOWN)
    : [];
  if (signals.length > 0) {
    lines.push(`Signals (recall is partial): ${signals.map((s) => clip(s, CLIP_NOTE)).join("; ")}`);
  }
  lines.push(RECALL_HINT);
  return clip(lines.join("\n"), MAX_BLOCK_CHARS);
}

/* ----------------------- on-disk TTL cache ----------------------- */
/*
 * The hook process is short-lived, so a module-level Map (the OpenCode
 * approach) would never survive between invocations. A tiny JSON file in the
 * temp dir keys on (conversationId, query) and records whether we already
 * injected — bounding repeat cost to one search per TTL. Cache write/read
 * failures are ignored: the cache is an optimization, never a dependency.
 */

function cachePath(conversationId) {
  const digest = createHash("sha256").update(conversationId).digest("hex").slice(0, 16);
  return join(tmpdir(), `agent-memory-recall-${digest}.json`);
}

function cacheGet(path, conversationId, query, ttlMs) {
  try {
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (!isBag(record)) return false;
    if (record.conversationId !== conversationId || record.query !== query) return false;
    const at = typeof record.at === "number" ? record.at : 0;
    return Date.now() - at < ttlMs;
  } catch {
    return false;
  }
}

function cachePut(path, conversationId, query) {
  try {
    writeFileSync(path, JSON.stringify({ conversationId, query, at: Date.now() }), { mode: 0o600 });
  } catch {
    // Best effort only.
  }
}

/* ------------------------------- main ------------------------------- */

async function main() {
  if (process.stdin.isTTY) return finish(); // manual run, nothing piped in
  const raw = await readStdin();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return finish(); // malformed host payload: inject nothing
  }
  if (!isBag(payload)) return finish();

  if (envBool("AGENT_MEMORY_INJECT") === false) return finish();

  const limit = envInt("AGENT_MEMORY_INJECT_LIMIT", 1, 20) ?? DEFAULT_INJECT_LIMIT;
  const ttlMs = envInt("AGENT_MEMORY_INJECT_TTL_MS", 1_000, 600_000) ?? DEFAULT_INJECT_TTL_MS;

  const conversationId =
    typeof payload.conversationId === "string" && payload.conversationId.length > 0
      ? payload.conversationId
      : "default";

  // Tenant key: same derivation as capture.mjs (env > workspace dir > default).
  let project = "default";
  const override = env("AGENT_MEMORY_PROJECT");
  if (override !== undefined) {
    project = clean(override, 200) || "default";
  } else if (Array.isArray(payload.workspacePaths)) {
    const first = payload.workspacePaths.find((p) => typeof p === "string" && p.length > 0);
    if (typeof first === "string") {
      const segments = first.split(/[\\/]+/).filter((s) => s.length > 0);
      const name = clean(segments.length > 0 ? segments[segments.length - 1] : "", 100);
      if (name.length > 0) project = name;
    }
  }

  const query = lastUserText(payload.transcriptPath);
  if (query === undefined) return finish(); // nothing asked yet

  const file = cachePath(conversationId);
  if (cacheGet(file, conversationId, query, ttlMs)) return finish(); // already injected

  const base = env("AGENT_MEMORY_URL") ?? DEFAULT_BASE;
  let url;
  try {
    url = new URL("agentmemory/smart-search", base.endsWith("/") ? base : `${base}/`);
  } catch {
    return finish(); // misconfigured base URL: inject nothing
  }

  const headers = { "content-type": "application/json", accept: "application/json" };
  const secret = env("AGENT_MEMORY_SECRET");
  if (secret !== undefined) headers.authorization = `Bearer ${secret}`;

  let body;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, concepts: [], project, limit }),
      signal: AbortSignal.timeout(AUTO_TIMEOUT_MS),
    });
    if (!response.ok) {
      cachePut(file, conversationId, query); // dead service: retried once per TTL
      return finish();
    }
    body = await response.text();
  } catch {
    cachePut(file, conversationId, query);
    return finish();
  }

  const block = formatRecall(project, limit, query, body);
  if (block === undefined || block === null) {
    cachePut(file, conversationId, query); // nothing to inject: cache that too
    return finish();
  }

  cachePut(file, conversationId, query);
  finish(
    JSON.stringify({
      injectSteps: [{ ephemeralMessage: `[agent-memory] ${block}` }],
    }),
  );
}

main()
  .catch(() => finish()) // swallow everything: exit code stays 0
  .finally(() => finish());
