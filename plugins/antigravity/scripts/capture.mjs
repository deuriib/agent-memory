#!/usr/bin/env node
/**
 * agent-memory capture hook — Google Antigravity adapter.
 *
 * Plain Node ESM, ZERO dependencies. Reads Antigravity's hook JSON on stdin
 * (camelCase: conversationId, workspacePaths, toolCall.name, ...), takes the
 * event name from argv[2] (supported: PostToolUse, Stop), and POSTs ONE small
 * observation to /memory/remember with origin="hook:<event>".
 *
 * Output contract (Antigravity hooks read stdout as JSON):
 *   - PostToolUse -> {}          (empty object, as documented)
 *   - Stop        -> {"decision":"stop"}   (any value except "continue"
 *                     allows the loop to terminate; required field)
 *
 * Hard rules — same guarantees as hooks/capture.mjs:
 *   - ALWAYS exits 0 with valid contract output, even with the memory server
 *     down, malformed stdin, or an unsupported event. A dead memory server
 *     must never block the coding agent.
 *   - NEVER prints memory content, the hook payload, or the bearer secret;
 *     stdout carries only the contract object, stderr stays empty.
 *   - Only a tiny, host-agnostic summary is stored (event + tool NAME).
 *     Tool args may contain file paths, commands, and user data — they are
 *     deliberately NOT captured (P2.2 basename opt-in below is the SOLE
 *     exception: AGENT_MEMORY_CAPTURE_PATHS=basename appends the sanitized
 *     BASENAME only, never a full path or content; default OFF).
 *   - P2.2 file-edit marker: PostToolUse whose tool name looks like an edit
 *     (edit/write/patch/apply/replace, case-insensitive) stores
 *     `file edited via <tool>` instead of `tool used: <tool>`.
 *   - AGENT_MEMORY_URL default: http://127.0.0.1:3111 (the REST service).
 */
import { randomUUID } from "node:crypto";

const SUPPORTED = new Set(["PostToolUse", "Stop"]);
const MAX_HOOK_BYTES = 1_048_576;
const TIMEOUT_MS = 2_000;

/** Stdout for each event — printed on EVERY exit path. */
function contractOutput(event) {
  if (event === "Stop") return '{"decision":"stop"}';
  return "{}";
}

let printed = false;

function finish(event) {
  if (printed) return;
  printed = true;
  try {
    process.stdout.write(`${contractOutput(event)}\n`);
  } catch {
    // stdout closed: nothing left to do, exit code still matters only.
  }
  process.exit(0);
}

// Belt and braces: whatever happens, the agent's hook pipeline keeps flowing.
process.on("uncaughtException", () => finish(process.argv[2]));
process.on("unhandledRejection", () => finish(process.argv[2]));

/** Strip control characters and bound the length of anything we store. */
function clean(value, max) {
  return String(value)
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function observationFor(event, payload) {
  if (event === "Stop") return "agent session stopped";
  // PostToolUse: only the tool NAME — inputs/outputs may contain paths,
  // code, or user data, none of which this hook is allowed to capture
  // (P2.2 basename opt-in is the sole exception: basename only).
  const name = payload?.toolCall?.name;
  const tool = typeof name === "string" ? clean(name, 80) : "";
  if (tool.length === 0) return null;
  // Gate P2-COMPLETE refuter: path-bearing tool names fail closed (mirror of
  // hooks/capture.mjs) — a hostile name can never store a full path.
  if (tool.includes("/") || tool.includes("\\")) return null;
  if (!isEditTool(tool)) return `tool used: ${tool}`;
  const basename = basenameOptIn(payload);
  return basename === null ? `file edited via ${tool}` : `file edited via ${tool}: ${basename}`;
}

/** P2.2 edit-tool heuristic (name only) — mirrors hooks/capture.mjs. */
function isEditTool(tool) {
  return /edit|write|patch|apply|replace/i.test(tool);
}

/**
 * P2.2 basename opt-in: AGENT_MEMORY_CAPTURE_PATHS=basename appends the
 * sanitized BASENAME of the edited file (no directories, ≤80 chars).
 * Searches payload.toolCall args/input/arguments bags for
 * file_path/filePath/path/filename/file (first non-empty string wins).
 */
function basenameOptIn(payload) {
  if (process.env.AGENT_MEMORY_CAPTURE_PATHS !== "basename") return null;
  const call = payload?.toolCall;
  if (typeof call !== "object" || call === null) return null;
  const bags = [call.args, call.input, call.arguments, call.tool_input];
  const keys = ["file_path", "filePath", "path", "filename", "file"];
  for (const bag of bags) {
    if (typeof bag !== "object" || bag === null || Array.isArray(bag)) continue;
    for (const key of keys) {
      const raw = bag[key];
      if (typeof raw !== "string" || raw.trim().length === 0) continue;
      const cleaned = clean(raw, 256);
      if (cleaned.length === 0) continue;
      const segments = cleaned.split(/[\\/]+/).filter((s) => s.length > 0);
      const last = segments[segments.length - 1] ?? "";
      const base = clean(last, 80);
      if (base.length === 0 || base === "." || base === "..") continue;
      return base;
    }
  }
  return null;
}

/** Tenant key: env override > first workspace dir name > "default". */
function projectFor(payload) {
  const override = process.env.AGENT_MEMORY_PROJECT;
  if (typeof override === "string" && override.trim().length > 0) {
    const cleaned = clean(override, 200);
    if (cleaned.length > 0) return cleaned;
  }
  const paths = Array.isArray(payload?.workspacePaths) ? payload.workspacePaths : [];
  const first = paths.find((entry) => typeof entry === "string" && entry.length > 0);
  if (typeof first === "string") {
    const segments = first.split(/[\\/]+/).filter((segment) => segment.length > 0);
    const name = clean(segments.length > 0 ? segments[segments.length - 1] : "", 100);
    if (name.length > 0) return name;
  }
  return "default";
}

/** Stable session: Antigravity's conversationId, else a fresh UUID. */
function sessionIdFor(payload) {
  if (typeof payload?.conversationId === "string") {
    const cleaned = clean(payload.conversationId, 200);
    if (cleaned.length > 0) return cleaned;
  }
  return randomUUID();
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

async function main() {
  const event = process.argv[2];
  if (process.stdin.isTTY) return finish(event); // manual run, nothing piped

  const raw = await readStdin(); // always drain the pipe first
  if (event === undefined || !SUPPORTED.has(event)) return finish(event);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return finish(event); // malformed host payload: ignore, never block
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return finish(event);
  }

  const content = observationFor(event, payload);
  if (content === null || content.length === 0) return finish(event);

  const body = {
    content,
    project: projectFor(payload),
    sessionId: sessionIdFor(payload),
    origin: `hook:${event}`, // frozen origin format from contract §3
  };

  const base = process.env.AGENT_MEMORY_URL ?? "http://127.0.0.1:3111";
  let url;
  try {
    // URL API does the joining — no hand-built request strings, and the
    // trailing slash keeps any path prefix in AGENT_MEMORY_URL intact.
    url = new URL("memory/remember", base.endsWith("/") ? base : `${base}/`);
  } catch {
    return finish(event); // misconfigured base URL: ignore
  }

  const headers = { "content-type": "application/json", accept: "application/json" };
  const secret = process.env.AGENT_MEMORY_SECRET;
  if (typeof secret === "string" && secret.length > 0) {
    headers.authorization = `Bearer ${secret}`; // same guard as REST, never logged
  }

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS), // a hung server must not hang the agent
    });
  } catch {
    // Server down or slow: swallow. Exit code and contract output stay valid.
  }
}

main()
  .catch(() => undefined) // swallow everything: exit code stays 0
  .finally(() => finish(process.argv[2]));
