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
 *   - P2.2 file-edit marker: PostToolUse whose tool name looks like an edit
 *     (edit/write/patch/apply/replace, case-insensitive) stores
 *     `file edited via <tool>` instead of `tool used: <tool>` — still the
 *     tool NAME only, never paths or content, unless the explicit opt-in
 *     AGENT_MEMORY_CAPTURE_PATHS=basename appends the sanitized BASENAME
 *     (`file edited via <tool>: <basename>`, basename ≤80 chars, no dirs).
 *     Full paths are never stored. Default OFF = fixed strings only.
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
  // code, or user data, none of which this hook is allowed to capture
  // (P2.2 basename opt-in below is the SOLE exception, and it stores the
  // basename only, never a full path or content).
  const tool = typeof hook.tool_name === "string" ? clean(hook.tool_name, 80) : "";
  if (tool.length === 0) return null; // no usable tool_name -> store nothing
  // Gate P2-COMPLETE refuter: a tool NAME carrying path separators is not a
  // tool name (host payload anomaly) — fail closed, store NOTHING, so a
  // hostile `tool_name: "/etc/.../x"` can never land a full path in storage
  // via the tool-name field ("full paths never stored" holds by default).
  if (tool.includes("/") || tool.includes("\\")) return null;
  if (event === "PostToolUseFailure") return `tool failed: ${tool}`;
  if (event !== "PostToolUse") return null;
  // P2.2: file-edit marker — edit-like tool names produce an edit
  // observation so "an edited file produces an observation" without ever
  // storing paths/content by default.
  if (!isEditTool(tool)) return `tool used: ${tool}`;
  const basename = basenameOptIn(hook);
  return basename === null ? `file edited via ${tool}` : `file edited via ${tool}: ${basename}`;
}

/**
 * P2.2 edit-tool heuristic (name only, never payload).
 * Matches edit/write/patch/apply/replace, case-insensitive — covers
 * Edit, Write, NotebookEdit, ApplyPatch, StrReplace and host equivalents
 * while leaving Read/Bash/Grep/Glob untouched.
 */
function isEditTool(tool) {
  return /edit|write|patch|apply|replace/i.test(tool);
}

/**
 * P2.2 basename opt-in: AGENT_MEMORY_CAPTURE_PATHS=basename appends the
 * sanitized BASENAME of the edited file (no directories, ≤80 chars).
 * Anything else (unset, empty, any other value) -> null = no path stored.
 * Payload search is generic across hosts: tool_input/toolInput/input bags,
 * keys file_path/filePath/path/filename/file (first non-empty string wins).
 */
function basenameOptIn(hook) {
  if (process.env.AGENT_MEMORY_CAPTURE_PATHS !== "basename") return null;
  const bags = [hook.tool_input, hook.toolInput, hook.input];
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
  if (content !== null && content.length > 0) {
    const payload = {
      content,
      project: projectFor(hook),
      sessionId: sessionIdFor(hook),
      origin: `hook:${event}`, // frozen origin format from contract §3
    };

    const base = process.env.AGENT_MEMORY_URL ?? "http://127.0.0.1:3111";
    let url;
    try {
      url = new URL("memory/remember", base.endsWith("/") ? base : `${base}/`);
    } catch {
      // misconfigured base url handled below for todos as well
      url = null;
    }
    if (url !== null) {
      const headers = { "content-type": "application/json" };
      const secret = process.env.AGENT_MEMORY_SECRET;
      if (typeof secret === "string" && secret.length > 0) headers.authorization = `Bearer ${secret}`;
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
    }
  }

  // Todos auto-extract (#3) — long session bodies → follow-ups (no blocking)
  const todos = extractTodos(event, hook);
  if (todos.length > 0) {
    const base = process.env.AGENT_MEMORY_URL ?? "http://127.0.0.1:3111";
    let url;
    try {
      url = new URL("memory/todos", base.endsWith("/") ? base : `${base}/`);
    } catch {
      return;
    }
    const headers = { "content-type": "application/json" };
    const secret = process.env.AGENT_MEMORY_SECRET;
    if (typeof secret === "string" && secret.length > 0) headers.authorization = `Bearer ${secret}`;
    const project = projectFor(hook);
    const sessionId = sessionIdFor(hook);
    // Fire-and-forget up to 3 todos, each bounded, never throws
    for (const t of todos.slice(0, 3)) {
      await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: t.title, description: t.description, priority: t.priority, project, sessionId }),
        signal: AbortSignal.timeout(1500),
      }).catch(() => undefined);
    }
  }
}

function extractTodos(event, hook) {
  // Only on session-end / stop / compaction where a long body may be present
  if (event !== "Stop" && event !== "SessionEnd" && event !== "PreCompact" && event !== "PostToolUse") return [];
  const body = collectBody(hook);
  if (body.length < 400) return [];
  // Heuristics: lines containing TODO/FIXME/decision/revisit/inspect/blocked
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 12 && l.length <= 200);
  const hits = [];
  for (const line of lines) {
    if (/^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b/i.test(line)) {
      hits.push({ title: clean(line.slice(0, 120), 120), description: "auto-extracted from session", priority: "medium" });
    } else if (line.length > 60 && /\b(should|need to|must|blocked|revisit)\b/i.test(line)) {
      hits.push({ title: clean(line.slice(0, 120), 120), description: "auto-extracted from session", priority: "low" });
    }
    if (hits.length >= 5) break;
  }
  // Deterministic dedup by title
  const seen = new Set();
  return hits.filter((h) => {
    const k = h.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function collectBody(hook) {
  const candidates = [
    hook.transcript,
    hook.session_body,
    hook.body,
    hook.content,
    hook.prompt?.text,
    hook.tool_output,
    hook.result,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length >= 400) return c;
    if (Array.isArray(c)) {
      const joined = c.map((x) => (typeof x === "string" ? x : typeof x?.text === "string" ? x.text : "")).join("\n");
      if (joined.length >= 400) return joined;
    }
  }
  // fallback: stringify hook and scan for long text values
  try {
    const flat = JSON.stringify(hook);
    return flat.length > 800 ? flat.slice(0, 4000) : "";
  } catch {
    return "";
  }
}

main()
  .catch(() => undefined) // swallow everything: exit code stays 0
  .finally(() => process.exit(0));
