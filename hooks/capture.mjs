#!/usr/bin/env node
/**
 * agent-memory capture hook (contract §3).
 *
 * Plain Node ESM, ZERO dependencies. Reads the host's hook JSON on stdin,
 * takes the event name from argv[2] (supported: SessionStart, PostToolUse,
 * Stop, PostToolUseFailure, PreCompact, SessionEnd, UserPromptSubmit), and
 * POSTs ONE small observation to /memory/remember with
 * origin="hook:<event>".
 *
 * Hard rules:
 *   - ALWAYS exits 0 — a dead or slow memory server must never block the
 *     coding agent. No exceptions, no retries, no output.
 *   - NEVER prints anything at all: no memory content, no hook payload,
 *     no bearer secret (stdout/stderr stay empty by construction).
 *   - Content allowlist per event: fixed strings only, except the two tool
 *     events (PostToolUse / PostToolUseFailure) which carry the tool NAME.
 *     `UserPromptSubmit` NEVER reads the prompt text (user PII — Ley
 *     172-13); `PreCompact` never reads its trigger/payload fields.
 *   - Only a tiny, host-agnostic summary is stored (event + tool name);
 *     hook payloads can carry file paths and command output, which are
 *     deliberately NOT captured.
 *   - AGENT_MEMORY_URL default: http://127.0.0.1:3111 — the agent-memory
 *     REST service. (docs/CONTRACT.md §3 says :6969 here, but that port is
 *     the raw Helix instance, which serves no /memory/* route — posting
 *     there could never store anything. 3111 matches src/server.ts's default;
 *     override with AGENT_MEMORY_URL either way.)
 */
import { randomUUID } from "node:crypto";

const SUPPORTED = new Set([
  "SessionStart",
  "PostToolUse",
  "Stop",
  "PostToolUseFailure",
  "PreCompact",
  "SessionEnd",
  "UserPromptSubmit",
]);
const MAX_HOOK_BYTES = 1_048_576;

// Belt and braces: whatever happens, the agent's hook pipeline keeps flowing.
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

/** Strip control characters and bound the length of anything we store. */
function clean(value, max) {
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function observationFor(event, hook) {
  // Fixed-string events: no payload field is ever read into content.
  if (event === "SessionStart") return "agent session started";
  if (event === "Stop") return "agent session stopped";
  if (event === "PreCompact") return "context compaction requested";
  if (event === "SessionEnd") return "agent session ended";
  // The prompt text itself is PII (Ley 172-13): only this fixed string is
  // stored — hook.prompt is deliberately never touched here. Project and
  // sessionId still derive from the host payload, as for every event.
  if (event === "UserPromptSubmit") return "user prompt submitted";
  // Tool events: only the tool NAME — inputs/outputs may contain paths,
  // code, or user data, none of which this hook is allowed to capture.
  const tool = typeof hook.tool_name === "string" ? clean(hook.tool_name, 80) : "";
  if (tool.length === 0) return null; // no usable tool_name -> store nothing
  if (event === "PostToolUseFailure") return `tool failed: ${tool}`;
  return event === "PostToolUse" ? `tool used: ${tool}` : null;
}

function projectFor(hook) {
  const override = process.env.AGENT_MEMORY_PROJECT;
  if (typeof override === "string" && override.trim().length > 0) {
    const cleaned = clean(override, 200);
    if (cleaned.length > 0) return cleaned;
  }
  const cwd = typeof hook.cwd === "string" && hook.cwd.length > 0 ? hook.cwd : process.cwd();
  const segments = cwd.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const name = clean(segments.length > 0 ? segments[segments.length - 1] : "", 100);
  return name.length > 0 ? name : "default";
}

function sessionIdFor(hook) {
  if (typeof hook.session_id === "string") {
    const cleaned = clean(hook.session_id, 200);
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
  if (process.stdin.isTTY) return; // manual run, nothing piped in

  const raw = await readStdin(); // always drain the pipe first

  const event = process.argv[2];
  if (event === undefined || !SUPPORTED.has(event)) return;

  let hook;
  try {
    hook = JSON.parse(raw);
  } catch {
    return; // malformed host payload: ignore, never block
  }
  if (typeof hook !== "object" || hook === null || Array.isArray(hook)) return;

  const content = observationFor(event, hook);
  if (content === null || content.length === 0) return;

  const payload = {
    content,
    project: projectFor(hook),
    sessionId: sessionIdFor(hook),
    origin: `hook:${event}`, // frozen origin format from contract §3
  };

  const base = process.env.AGENT_MEMORY_URL ?? "http://127.0.0.1:3111";
  let url;
  try {
    // URL API does the joining — no hand-built request strings, and the
    // trailing slash keeps any path prefix in AGENT_MEMORY_URL intact.
    url = new URL("memory/remember", base.endsWith("/") ? base : `${base}/`);
  } catch {
    return; // misconfigured base URL: ignore
  }

  const headers = { "content-type": "application/json" };
  const secret = process.env.AGENT_MEMORY_SECRET;
  if (typeof secret === "string" && secret.length > 0) {
    headers.authorization = `Bearer ${secret}`; // same guard as REST, never logged
  }

  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000), // a hung server must not hang the agent
  });
}

main()
  .catch(() => undefined) // swallow everything: exit code stays 0
  .finally(() => process.exit(0));
