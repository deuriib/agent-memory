/**
 * Env + port-conflict evidence (T-005 / T-006 -> REQ-P0-5 / REQ-P0-6),
 * written in the style of scripts/verify.ts
 * (sections, check(), counters, VERIFY PASS/FAIL, exit code).
 *
 *   npx tsx scripts/verify-env.ts        (npm run verify-env)
 *
 * Everything is observed on REAL spawned processes — nothing unit-mocked:
 *
 *   A. new-env boot. Spawns `src/server.ts` (npx tsx) with AGENT_MEMORY_PORT /
 *      _HOST / _SECRET set, then proves: it boots on the configured port
 *      (3199), /memory/livez answers 200 WITHOUT a bearer (route exempt),
 *      /memory/health answers 401 without and 200 with
 *      `Bearer <secret>`, and the secret's VALUE never reaches stderr
 *      or stdout.
 *   B. zero-output hook guarantee. Spawns hooks/capture.mjs under
 *      AGENT_MEMORY_* names with no server listening: exit 0 and BOTH
 *      stdout/stderr empty.
 *   C. EADDRINUSE reroute hint. Binds the test port with a second listener,
 *      spawns the server again, and asserts stderr names the conflicting
 *      port, the never-kill-upstream rule (3111/3112/3113), the
 *      `AGENT_MEMORY_PORT=3151` example and the AGENT_MEMORY_URL client
 *      instruction — plus exit code 1.
 *   D. legacy names ignored. Spawns the server with AGENT_MEMORY_PORT set
 *      plus stale AGENTMEMORY_* names present, and proves the legacy names
 *      have no effect: it listens on the new port and the legacy secret
 *      does not arm the guard.
 *
 * Ports: ONLY 3199 is used. Never 3111/3112/3113 (upstream agentmemory —
 * NEVER killed here), never 3151 (documented reroute), never 6969 (Helix,
 * which is only PROBED read-only via TCP).
 *
 * Helix at localhost:6969 must be up for the health->200 assertion; a
 * refused TCP probe there is reported as a REAL failure (start it with
 * `helix start dev --disk --persist`).
 *
 * Exit 0 only when every check passes; all children are killed in `finally`.
 */
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { logSafeNote } from "../src/errors.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
/** Dedicated non-conflicting test port — never 3111/3112/3113/3151/6969. */
const TEST_PORT = 3199;
const TEST_URL = `http://${HOST}:${TEST_PORT}/`;
const REROUTE_PORT = 3151;
const HELIX_HOST = "127.0.0.1";
const HELIX_PORT = 6969;
/** Synthetic, random per run — proves the secret value never leaks. */
const TEST_SECRET = `synthetic-verify-env-${randomUUID()}`;
const BOOT_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Assertion plumbing (verify.ts style)                                */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function brief(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > 0 ? single.slice(0, 300) : "(empty)";
}

/* ------------------------------------------------------------------ */
/* Small async helpers                                                 */
/* ------------------------------------------------------------------ */

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

function tcpReachable(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(ok: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    }
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** True when nothing binds HOST:port (probe bind + immediate close). */
async function portFree(port: number): Promise<boolean> {
  const probe = createServer();
  const free = await new Promise<boolean>((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => resolve(true));
  });
  if (free) await new Promise<void>((resolve) => probe.close(() => resolve()));
  return free;
}

async function getStatus(path: string, headers: Record<string, string> = {}): Promise<number> {
  try {
    const response = await fetch(new URL(path, TEST_URL), {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    return response.status;
  } catch {
    return -1;
  }
}

/* ------------------------------------------------------------------ */
/* Child process capture (stdout/stderr accumulated, exit observed)    */
/* ------------------------------------------------------------------ */

interface Spawned {
  readonly child: ChildProcess;
  /** Resolves on `exit` or spawn `error` — never left pending. */
  readonly exited: Promise<number | null>;
  /** `undefined` until the child terminates; null = killed by signal / spawn error. */
  exitCode(): number | null | undefined;
  stdout(): string;
  stderr(): string;
}

interface CaptureOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: "ignore" | "pipe";
}

const kids: Spawned[] = [];

function spawnCapture(
  command: string,
  args: readonly string[],
  options: CaptureOptions,
): Spawned {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin, "pipe", "pipe"],
  });
  let out = "";
  let errOut = "";
  let exitCode: number | null | undefined;
  let settle: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => {
    settle = resolve;
  });
  const finish = (code: number | null): void => {
    if (exitCode !== undefined) return;
    exitCode = code;
    settle(code);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    errOut += chunk;
  });
  child.once("exit", (code) => finish(code));
  child.once("error", (error: Error) => {
    errOut += `[spawn error] ${error.message}\n`;
    finish(null);
  });
  const spawned: Spawned = {
    child,
    exited,
    exitCode: () => exitCode,
    stdout: () => out,
    stderr: () => errOut,
  };
  kids.push(spawned);
  return spawned;
}

/** Spawn src/server.ts with AGENT_MEMORY_* names for our config. */
function spawnServer(extraEnv: Record<string, string> = {}): Spawned {
  return spawnCapture("npx", ["tsx", "src/server.ts"], {
    cwd: ROOT,
    env: cleanEnv({
      AGENT_MEMORY_PORT: String(TEST_PORT),
      AGENT_MEMORY_HOST: HOST,
      AGENT_MEMORY_SECRET: TEST_SECRET,
      ...extraEnv,
    }),
    stdin: "ignore",
  });
}

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

async function waitUntilListening(target: Spawned, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (target.exitCode() !== undefined) return false; // died — never listened
    try {
      const response = await fetch(new URL("memory/livez", TEST_URL), {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 200) return target.exitCode() === undefined;
    } catch {
      // Not up yet (npx/tsx cold start): keep polling.
    }
    await sleep(250);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

let blocker: Server | undefined;

/** Returns false only on a FATAL condition that makes the rest meaningless. */
async function sectionA(): Promise<boolean> {
  section(`A. new-env boot: AGENT_MEMORY_PORT/HOST/SECRET`);

  const free = await portFree(TEST_PORT);
  check(
    `preflight: test port ${TEST_PORT} is free`,
    free,
    `occupied — free ${TEST_PORT} (never touch 3111/3112/3113/3151), then re-run`,
  );
  if (!free) return false;

  const helixUp = await tcpReachable(HELIX_HOST, HELIX_PORT);
  check(
    `helix: localhost:${HELIX_PORT} reachable (required by health -> 200)`,
    helixUp,
    helixUp ? undefined : "REAL FAILURE — Helix down or mid-restart; run: helix start dev --disk --persist",
  );

  const server = spawnServer();
  const booted = await waitUntilListening(server, BOOT_TIMEOUT_MS);
  check(
    `server: boots and listens on AGENT_MEMORY_PORT=${TEST_PORT}`,
    booted,
    booted
      ? undefined
      : `${server.exitCode() === undefined ? "never answered livez" : `exited code=${String(server.exitCode())}`} — stderr: ${brief(server.stderr())}`,
  );
  if (!booted) return false;

  const livez = await getStatus("memory/livez");
  check("livez: 200 WITHOUT bearer (route exempt)", livez === 200, `got ${livez}`);

  const noAuth = await getStatus("memory/health");
  check("health: 401 WITHOUT bearer (secret armed the guard)", noAuth === 401, `got ${noAuth}`);

  const withAuth = await getStatus("memory/health", {
    authorization: `Bearer ${TEST_SECRET}`,
  });
  check(
    "health: 200 WITH Bearer <secret>",
    withAuth === 200,
    withAuth === 500
      ? "got 500 — Helix at localhost:6969 unreachable/mid-restart (REAL failure, not an auth defect)"
      : `got ${withAuth}`,
  );

  const out = server.stdout();
  const err = server.stderr();
  check(
    "stderr: never contains the secret VALUE",
    !err.includes(TEST_SECRET),
    "the synthetic secret leaked into stderr",
  );
  check(
    "stdout: never contains the secret VALUE",
    !out.includes(TEST_SECRET),
    "the synthetic secret leaked into stdout",
  );

  // Free the test port for sections B, C and D.
  server.child.kill("SIGTERM");
  await race(server.exited, 5_000);
  if (server.exitCode() === undefined) server.child.kill("SIGKILL");
  return true;
}

async function sectionB(): Promise<void> {
  section("B. zero-output guarantee: hooks/capture.mjs stays silent");

  const hook = spawnCapture(process.execPath, ["hooks/capture.mjs", "PostToolUse"], {
    cwd: ROOT,
    env: cleanEnv({
      // Nothing listens on the test port now: the POST fails, gets swallowed.
      AGENT_MEMORY_URL: `http://${HOST}:${TEST_PORT}`,
      AGENT_MEMORY_SECRET: TEST_SECRET,
      AGENT_MEMORY_PROJECT: "verify-env",
    }),
    stdin: "pipe",
  });
  hook.child.stdin?.end(
    JSON.stringify({ tool_name: "Read", cwd: ROOT, session_id: "verify-env" }),
  );
  const code = await race(hook.exited, 15_000);
  check(
    "hook: exits 0 under AGENT_MEMORY_* env",
    code === 0,
    code === undefined ? "did not exit within 15s" : `exit code ${code}`,
  );
  const out = hook.stdout();
  const err = hook.stderr();
  check("hook: stdout EMPTY (zero-output contract)", out.length === 0, `stdout: ${brief(out)}`);
  check("hook: stderr EMPTY (zero-output contract)", err.length === 0, `stderr: ${brief(err)}`);
}

async function sectionC(): Promise<void> {
  section(`C. EADDRINUSE reroute hint (test port ${TEST_PORT} held by a second listener)`);

  const listener = createServer();
  blocker = listener;
  const bound = await new Promise<boolean>((resolve) => {
    listener.once("error", () => resolve(false));
    listener.listen(TEST_PORT, HOST, () => resolve(true));
  });
  check(
    `blocker: second listener bound on ${TEST_PORT}`,
    bound,
    `could not bind ${TEST_PORT} — conflict test impossible`,
  );
  if (!bound) return;

  const server = spawnServer();
  const code = await race(server.exited, EXIT_TIMEOUT_MS);
  check(
    "server: exits 1 when the port is already in use",
    code === 1,
    code === undefined ? "did not exit within 30s" : `exit code ${code}`,
  );

  const err = server.stderr();
  check(
    `hint: names the conflicting port ("port ${TEST_PORT} is already in use")`,
    err.includes(`port ${TEST_PORT} is already in use`),
    `stderr: ${brief(err)}`,
  );
  check(
    "hint: never-kill-upstream (NEVER kill + 3111/3112/3113)",
    err.includes("NEVER kill") && err.includes("3111/3112/3113"),
    `stderr: ${brief(err)}`,
  );
  check(
    `hint: 3151 reroute example (AGENT_MEMORY_PORT=${REROUTE_PORT} npm run dev)`,
    err.includes(`AGENT_MEMORY_PORT=${REROUTE_PORT} npm run dev`),
    `stderr: ${brief(err)}`,
  );
  check(
    `hint: client instruction (AGENT_MEMORY_URL=http://127.0.0.1:${REROUTE_PORT})`,
    err.includes(`AGENT_MEMORY_URL=http://127.0.0.1:${REROUTE_PORT}`),
    `stderr: ${brief(err)}`,
  );

  // Release the blocker so section D can bind the test port.
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  blocker = undefined;
}

async function sectionD(): Promise<void> {
  section("D. legacy AGENTMEMORY_* names are ignored");

  const free = await portFree(TEST_PORT);
  check(`preflight: test port ${TEST_PORT} is free`, free);
  if (!free) return;

  const staleSecret = `stale-legacy-${randomUUID()}`;
  const server = spawnServer({
    AGENTMEMORY_PORT: "3999",
    AGENTMEMORY_HOST: HOST,
    AGENTMEMORY_SECRET: staleSecret,
  });
  const booted = await waitUntilListening(server, BOOT_TIMEOUT_MS);
  check(
    `server: listens on AGENT_MEMORY_PORT=${TEST_PORT} (stale AGENTMEMORY_PORT ignored)`,
    booted,
    booted ? undefined : `stderr: ${brief(server.stderr())}`,
  );
  if (!booted) {
    server.child.kill("SIGTERM");
    await race(server.exited, 5_000);
    return;
  }

  const staleAuth = await getStatus("memory/health", {
    authorization: `Bearer ${staleSecret}`,
  });
  check(
    "health: stale legacy secret does NOT authenticate (401)",
    staleAuth === 401,
    `got ${staleAuth}`,
  );

  const openAuth = await getStatus("memory/health", {
    authorization: `Bearer ${TEST_SECRET}`,
  });
  check("health: current secret still authenticates (200)", openAuth === 200, `got ${openAuth}`);

  server.child.kill("SIGTERM");
  await race(server.exited, 5_000);
  if (server.exitCode() === undefined) server.child.kill("SIGKILL");
}

/* ------------------------------------------------------------------ */
/* Cleanup + summary                                                   */
/* ------------------------------------------------------------------ */

async function cleanup(): Promise<void> {
  for (const kid of kids) {
    if (kid.exitCode() === undefined) {
      kid.child.kill("SIGTERM");
      await race(kid.exited, 5_000);
    }
    if (kid.exitCode() === undefined) {
      kid.child.kill("SIGKILL");
      await race(kid.exited, 2_000);
    }
  }
  const listener = blocker;
  if (listener !== undefined && listener.listening) {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}

async function runAll(): Promise<void> {
  try {
    const continueAfterA = await sectionA();
    if (continueAfterA) {
      await sectionB();
      await sectionC();
      await sectionD();
    }
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY PASS");
}

runAll().catch((err: unknown) => {
  console.error(`verify-env crashed: ${logSafeNote(err)}`);
  process.exit(1);
});
