/**
 * REQ-P2-1 / T-104 — hook coverage breadth (7 events + negatives).
 *
 *   npx tsx scripts/verify-capture.ts
 *
 * Integration test, CI-runnable, NO Helix: a local HTTP server COUNTS and
 * RECORDS every request (method/path/headers/body) — the same pattern as
 * scripts/verify-injection.ts — and hooks/capture.mjs is spawned as a real
 * child process per case with synthetic stdin payloads and AGENT_MEMORY_URL
 * pointed at that server. Silence (stdout/stderr) and exit codes are
 * OBSERVED on the spawned process, never assumed.
 *
 * Sections:
 *   A. the 7 supported events — exactly 1 POST /memory/remember each,
 *      exit 0, stdout AND stderr EMPTY, content EXACTLY the allowlisted
 *      string, origin `hook:<event>`, project from AGENT_MEMORY_PROJECT,
 *      sessionId from the host payload.
 *   B. privacy canaries (Ley 172-13): the UserPromptSubmit prompt text and
 *      the PreCompact trigger/payload fields never reach the POSTed body
 *      or the child's output; cwd-name project fallback without env.
 *   C. negatives — PostToolUseFailure without a usable tool_name (missing /
 *      empty / non-string), an unsupported event, malformed JSON and empty
 *      stdin all store 0 memories and still exit 0 in silence;
 *      AGENT_MEMORY_SECRET rides only in the Authorization header, never
 *      in output.
 *   D. plugin helper `captureToolStart` — fire-and-forget POST
 *      (`tool started: <name>`, origin `hook:tool.execute.before`), the
 *      `memory*` skip, and dead-backend fail-soft (no throw, no unhandled
 *      rejection).
 *   E. server DOWN — the hook still exits 0 in silence.
 *
 * Ports: only an ephemeral listen(0) on 127.0.0.1 plus 127.0.0.1:1 (dead —
 * nothing ever binds tcpmux). NEVER 3111/3112/3113 (upstream agentmemory —
 * never touched), never 3151 (documented reroute), never 6969 (Helix —
 * not used here at all). The only "secret" values are synthetic canaries
 * proving they never leak.
 *
 * Exit 0 only when every check passes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { captureToolStart, config } from "../plugins/opencode/plugins/agent-memory";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PROJECT = "verify-capture";
const SESSION = "sess-verify-capture";
const PLUGIN_SESSION = "sess-plugin";
const PROMPT_CANARY = "USER_PROMPT_CANARY_xyz secret";
const TRIGGER_CANARY = "PRECOMPACT_TRIGGER_CANARY_xyz";
const SECRET_CANARY = "synthetic-capture-secret-canary-17213";
/** Dead port: tcpmux, never bound here — connection refused is instant. */
const DEAD_PORT = 1;
const CHILD_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Assertion plumbing (verify-injection style)                         */
/* ------------------------------------------------------------------ */

let total = 0;
const failures: string[] = [];
let unhandledRejections = 0;
process.on("unhandledRejection", () => {
  unhandledRejections += 1;
});

function check(name: string, condition: boolean, detail?: unknown): void {
  total += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` -> ${render(detail)}`}`);
  }
}

function render(detail: unknown): string {
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Race a promise against a timeout; `undefined` means the timeout won. */
async function race<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(25);
  }
  return condition();
}

/* ------------------------------------------------------------------ */
/* Counting/recording local server                                     */
/* ------------------------------------------------------------------ */

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

const recorded: Recorded[] = [];
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    // Recorded BEFORE the response: the hook child can only exit after the
    // response lands, so by the time runHook resolves this is complete.
    recorded.push({
      method: req.method ?? "",
      path: req.url ?? "",
      authorization:
        typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});

await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("counting server has no TCP address");
}
const LIVE_URL = `http://${HOST}:${address.port}`;

let serverClosed = false;
async function closeServer(): Promise<void> {
  if (serverClosed) return;
  serverClosed = true;
  // Destroy idle keep-alive sockets (in-process fetch) or close() would hang.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/* ------------------------------------------------------------------ */
/* Child-process runner for hooks/capture.mjs                          */
/* ------------------------------------------------------------------ */

interface HookRun {
  /** `0`/`null` observed; `undefined` = did not exit within the timeout. */
  readonly code: number | null | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

const kids: ChildProcess[] = [];

/**
 * Inherited env MINUS every AGENT_MEMORY_ and AGENTMEMORY_ prefixed key
 * (so no stray config leaks in), plus exactly the vars the caller wants.
 */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("AGENT_MEMORY_") || key.startsWith("AGENTMEMORY_")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

async function runHook(
  args: readonly string[],
  stdinPayload: string,
  extraEnv: Record<string, string>,
): Promise<HookRun> {
  const child = spawn(process.execPath, ["hooks/capture.mjs", ...args], {
    cwd: ROOT,
    env: cleanEnv({ AGENT_MEMORY_URL: LIVE_URL, AGENT_MEMORY_PROJECT: PROJECT, ...extraEnv }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  kids.push(child);

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("close", (code) => resolve(code)); // "close" = stdio drained
    child.once("error", () => resolve(null));
  });

  // capture.mjs drains stdin fully before checking the event — pipe anyway.
  child.stdin?.end(stdinPayload);

  const code = await race(closed, CHILD_TIMEOUT_MS);
  if (code === undefined) child.kill("SIGKILL");
  return { code, stdout, stderr };
}

/** A negative path: the hook must store nothing, exit 0 and stay silent. */
async function expectNoStore(
  label: string,
  args: readonly string[],
  stdinPayload: string,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const before = recorded.length;
  const run = await runHook(args, stdinPayload, extraEnv);
  check(`${label}: 0 requests`, recorded.length === before, recorded.length - before);
  check(`${label}: exit 0`, run.code === 0, run.code);
  check(`${label}: stdout EMPTY`, run.stdout.length === 0, run.stdout.slice(0, 200));
  check(`${label}: stderr EMPTY`, run.stderr.length === 0, run.stderr.slice(0, 200));
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    return isBag(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

interface EventSpec {
  readonly event: string;
  readonly payload: Record<string, unknown>;
  readonly content: string;
}

/** Raw POSTed body + observed run per event (consumed by the privacy pass). */
const bodyByEvent = new Map<string, string>();
const runByEvent = new Map<string, HookRun>();

const EVENTS: readonly EventSpec[] = [
  {
    event: "SessionStart",
    payload: { cwd: ROOT, session_id: SESSION },
    content: "agent session started",
  },
  {
    event: "PostToolUse",
    payload: { tool_name: "Read", cwd: ROOT, session_id: SESSION },
    content: "tool used: Read",
  },
  { event: "Stop", payload: { cwd: ROOT, session_id: SESSION }, content: "agent session stopped" },
  {
    event: "PostToolUseFailure",
    payload: { tool_name: "Bash", cwd: ROOT, session_id: SESSION },
    content: "tool failed: Bash",
  },
  {
    event: "PreCompact",
    // Trigger/payload carry canaries: none of it may reach the observation.
    payload: { trigger: TRIGGER_CANARY, payload: { note: TRIGGER_CANARY }, cwd: ROOT, session_id: SESSION },
    content: "context compaction requested",
  },
  { event: "SessionEnd", payload: { cwd: ROOT, session_id: SESSION }, content: "agent session ended" },
  {
    event: "UserPromptSubmit",
    payload: { prompt: PROMPT_CANARY, cwd: ROOT, session_id: SESSION },
    content: "user prompt submitted",
  },
];

async function sectionA(): Promise<void> {
  section("A. the 7 supported events: 1 POST each, exit 0, silence, exact content");

  for (const spec of EVENTS) {
    const before = recorded.length;
    const run = await runHook([spec.event], JSON.stringify(spec.payload), {});
    runByEvent.set(spec.event, run);
    const mine = recorded.slice(before);
    const rec = mine[0];
    bodyByEvent.set(spec.event, rec?.body ?? "");

    check(`${spec.event}: exactly 1 request`, mine.length === 1, mine.length);
    check(
      `${spec.event}: POST /memory/remember`,
      rec !== undefined && rec.method === "POST" && rec.path === "/memory/remember",
      rec === undefined ? "no request" : `${rec.method} ${rec.path}`,
    );
    check(`${spec.event}: exit 0`, run.code === 0, run.code);
    check(`${spec.event}: stdout EMPTY`, run.stdout.length === 0, run.stdout.slice(0, 200));
    check(`${spec.event}: stderr EMPTY`, run.stderr.length === 0, run.stderr.slice(0, 200));

    const bag = parseBody(rec?.body ?? "");
    check(`${spec.event}: content exactly "${spec.content}"`, bag.content === spec.content, bag.content);
    check(`${spec.event}: origin hook:${spec.event}`, bag.origin === `hook:${spec.event}`, bag.origin);
    check(`${spec.event}: project from AGENT_MEMORY_PROJECT`, bag.project === PROJECT, bag.project);
    check(
      `${spec.event}: sessionId == payload session_id (non-empty)`,
      typeof bag.sessionId === "string" && bag.sessionId === SESSION,
      bag.sessionId,
    );
  }
}

async function sectionB(): Promise<void> {
  section("B. privacy canaries (Ley 172-13) + cwd-name project derivation");

  const upBody = bodyByEvent.get("UserPromptSubmit") ?? "";
  const upRun = runByEvent.get("UserPromptSubmit");
  check("UserPromptSubmit: prompt canary absent from POSTed body", !upBody.includes(PROMPT_CANARY));
  check(
    "UserPromptSubmit: prompt canary absent from stdout",
    !(upRun?.stdout ?? "").includes(PROMPT_CANARY),
    upRun?.stdout,
  );
  check(
    "UserPromptSubmit: prompt canary absent from stderr",
    !(upRun?.stderr ?? "").includes(PROMPT_CANARY),
    upRun?.stderr,
  );

  const preBody = bodyByEvent.get("PreCompact") ?? "";
  check("PreCompact: trigger canary absent from POSTed body", !preBody.includes(TRIGGER_CANARY));

  // No AGENT_MEMORY_PROJECT: project must fall back to the payload cwd name.
  const before = recorded.length;
  const derive = await runHook(
    ["SessionStart"],
    JSON.stringify({ cwd: "/tmp/host-workspace/derive-me", session_id: SESSION }),
    { AGENT_MEMORY_PROJECT: "" },
  );
  const deriveRec = recorded[before];
  check("cwd fallback: exactly 1 request", recorded.length - before === 1, recorded.length - before);
  check("cwd fallback: exit 0", derive.code === 0, derive.code);
  const deriveBag = parseBody(deriveRec?.body ?? "");
  check("cwd fallback: project == last cwd segment", deriveBag.project === "derive-me", deriveBag.project);
}

async function sectionC(): Promise<void> {
  section("C. negatives: 0 stores, exit 0, silence; secret only in Authorization");

  await expectNoStore(
    "PostToolUseFailure without tool_name",
    ["PostToolUseFailure"],
    JSON.stringify({ cwd: ROOT, session_id: SESSION }),
  );
  await expectNoStore(
    "PostToolUseFailure with empty tool_name",
    ["PostToolUseFailure"],
    JSON.stringify({ tool_name: "", cwd: ROOT, session_id: SESSION }),
  );
  await expectNoStore(
    "PostToolUseFailure with non-string tool_name",
    ["PostToolUseFailure"],
    JSON.stringify({ tool_name: 42, cwd: ROOT, session_id: SESSION }),
  );
  await expectNoStore(
    "unsupported event",
    ["SessionNap"],
    JSON.stringify({ cwd: ROOT, session_id: SESSION }),
  );
  await expectNoStore("malformed JSON stdin", ["SessionStart"], '{"broken":');
  await expectNoStore("empty stdin", ["SessionStart"], "");

  // Secret handling: header present, value never in output.
  const before = recorded.length;
  const run = await runHook(
    ["Stop"],
    JSON.stringify({ cwd: ROOT, session_id: SESSION }),
    { AGENT_MEMORY_SECRET: SECRET_CANARY },
  );
  const rec = recorded[before];
  check("secret: exactly 1 request", recorded.length - before === 1, recorded.length - before);
  check(
    "secret: Authorization Bearer <canary> header present",
    rec?.authorization === `Bearer ${SECRET_CANARY}`,
    rec?.authorization,
  );
  check("secret: exit 0", run.code === 0, run.code);
  check("secret: canary absent from stdout", !run.stdout.includes(SECRET_CANARY), run.stdout.slice(0, 200));
  check("secret: canary absent from stderr", !run.stderr.includes(SECRET_CANARY), run.stderr.slice(0, 200));
}

async function sectionD(): Promise<void> {
  section("D. plugin helper captureToolStart (execute.before semantics)");

  const location = {
    directory: "/mnt/DATA/GitHub/agent-memory",
    project: { canonical: "/mnt/DATA/GitHub/agent-memory" },
  };
  const pluginCfg = config({ options: { url: LIVE_URL, project: PROJECT }, location });

  // Fire-and-forget POST of `tool started: <name>`.
  const before = recorded.length;
  let threw: unknown = null;
  try {
    captureToolStart(pluginCfg, "bash", PLUGIN_SESSION);
  } catch (error) {
    threw = error;
  }
  check("tool start: helper never throws synchronously", threw === null, threw);
  await waitFor(() => recorded.length === before + 1, 2_000);
  const rec = recorded[before];
  check("tool start: exactly 1 request", recorded.length === before + 1, recorded.length - before);
  check(
    "tool start: POST /memory/remember",
    rec !== undefined && rec.method === "POST" && rec.path === "/memory/remember",
    rec === undefined ? "no request" : `${rec.method} ${rec.path}`,
  );
  const bag = parseBody(rec?.body ?? "");
  check("tool start: content 'tool started: bash'", bag.content === "tool started: bash", bag.content);
  check(
    "tool start: origin hook:tool.execute.before",
    bag.origin === "hook:tool.execute.before",
    bag.origin,
  );
  check("tool start: project from cfg", bag.project === PROJECT, bag.project);
  check("tool start: sessionId from event", bag.sessionId === PLUGIN_SESSION, bag.sessionId);

  // Our own namespace is never observed (no self-observation loop).
  const skipBefore = recorded.length;
  let skipThrew: unknown = null;
  try {
    captureToolStart(pluginCfg, "memory_save", PLUGIN_SESSION);
  } catch (error) {
    skipThrew = error;
  }
  await sleep(150);
  check("memory_save: helper never throws", skipThrew === null, skipThrew);
  check(
    "memory_save: 0 requests (self-observation loop skipped)",
    recorded.length === skipBefore,
    recorded.length - skipBefore,
  );

  // Dead backend: fail-soft proof — no sync throw, no unhandled rejection.
  const deadCfg = config({ options: { url: `http://${HOST}:${DEAD_PORT}`, project: PROJECT }, location });
  let deadThrew: unknown = null;
  try {
    captureToolStart(deadCfg, "bash", PLUGIN_SESSION);
  } catch (error) {
    deadThrew = error;
  }
  await sleep(300); // let the detached fetch reject and be swallowed
  check("dead backend: no synchronous throw", deadThrew === null, deadThrew);
  check("dead backend: no unhandled rejection", unhandledRejections === 0, unhandledRejections);
}

async function sectionE(): Promise<void> {
  section("E. memory server DOWN: exit 0 and silence");

  await closeServer();

  const before = recorded.length;
  const run = await runHook(["Stop"], JSON.stringify({ cwd: ROOT, session_id: SESSION }), {});
  check("down: 0 requests", recorded.length === before, recorded.length - before);
  check("down: exit 0", run.code === 0, run.code);
  check("down: stdout EMPTY", run.stdout.length === 0, run.stdout.slice(0, 200));
  check("down: stderr EMPTY", run.stderr.length === 0, run.stderr.slice(0, 200));
}

/* ------------------------------------------------------------------ */
/* Run + summary                                                       */
/* ------------------------------------------------------------------ */

try {
  await sectionA();
  await sectionB();
  await sectionC();
  await sectionD();
  await sectionE();
} finally {
  await closeServer();
  for (const child of kids) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

check("no unhandledRejection during the run", unhandledRejections === 0, unhandledRejections);

console.log(`\n${total} checks, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`FAILURE(S):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("ALL PASS");
process.exit(0);
