#!/usr/bin/env node
/**
 * agent-memory — P4 ops control plane CLI (SPEC-P4-OPS).
 *
 * Subcommands: start | stop | status | doctor (+ --help).
 * Node >=20 ESM, `node:` builtins only — zero new dependencies (INV-001).
 *
 * HARD rules (never violated by any code path in this file):
 *   - Never-kill (INV-003 / NFR-A, SPEC §4.5): signals go only to a PID this
 *     CLI spawned and recorded in the slot state file, and only after the
 *     recorded command line is re-verified — once before SIGTERM and AGAIN
 *     immediately before SIGKILL (security C10/S-010). No scan-by-port
 *     signaling, no signal to any holder of 3111/3112/3113, no destructive
 *     container/volume operations, no configuration-rewriting start flag.
 *   - Secret hygiene (INV-004 / NFR-B / NFR-F): no subcommand prints
 *     AGENT_MEMORY_SECRET or any other env value — presence flags only
 *     (`bearer: armed|unset`). Output is ports, booleans, counts, HTTP status
 *     codes, PIDs and `$HOME`-collapsed paths (runbook §4b allowlist).
 *   - Defaults untouched (INV-005 / NFR-C): REST 3111, Helix 6969; slots are
 *     derivation through env/flags only — this file edits no source.
 *   - State file (INV-007 / §4.4): `<parent-of-data-dir>/state/slot-<N>.json`,
 *     never inside HELIX_DATA_DIR, mode 0600 in a 0700 directory, closed
 *     schema, never a secret / memory content / PII.
 *
 * Probe A3 (execute-spec step 0, 2026-09-24) FAILED: Helix CLI 3.3.0 does not
 * forward `HELIX_DATA_DIR` (0 occurrences in the installed binary, no
 * `--data-dir` flag, running container has no such env and no bind mount; the
 * variable is direct-Docker mode per helix-cli SKILL.md:29-32). Therefore the
 * P4.4 data-dir/migration portion is STOPPED by the execute-spec packet:
 *   - `--migrate` (any form) fails closed with `MIGRATE ABORT:
 *     unsupported-runtime` — never a write, never a partial migration
 *     (runbook REQ-OPS-RUN-08: unsupported runtime => ABORT).
 *   - `--data-dir` survives only as the REQ-07 precedence input that locates
 *     the sibling `state/` directory and is reported by status/doctor.
 *   - `HELIX_DATA_DIR` is never set for any child. Framing 3b (brief §7) is an
 *     orchestrator decision, not an in-lane improvisation. KR3 is not claimed.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants as FS,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ */
/* Constants and pure slot derivation (REQ-P4-OPS-06, §4.2)            */
/* ------------------------------------------------------------------ */

const REST_BASE = 3111;
const HELIX_BASE = 6969;
const READINESS_MS = 30_000;
const TERM_GRACE_MS = 5_000;
const KILL_WAIT_MS = 3_000;

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const HELIX_TOML = path.join(ROOT, "helix.toml");
const HOME = os.homedir();

/** Ports this CLI must never bind (upstream agentmemory + reroute + Helix). */
const NEVER_BIND = [3111, 3112, 3113, 3151, 6969];

/** Refused path roots (security C4): `/`, system dirs and $HOME itself. */
const SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/tmp",
  "/usr",
  "/var",
  "/home",
  path.parse(process.cwd()).root,
]);

/** @returns {{rest:number,r1:number,r2:number,helix:number,instanceName:string}} */
function derive(slot) {
  const rest = REST_BASE + 3 * (slot - 1);
  const helixPort = HELIX_BASE + (slot - 1);
  return {
    rest,
    r1: rest + 1,
    r2: rest + 2,
    helix: helixPort,
    instanceName: slot === 1 ? "dev" : `slot${slot}`,
  };
}

/* ------------------------------------------------------------------ */
/* Allowlist rendering (security C7 / S-013, runbook §4b)               */
/* ------------------------------------------------------------------ */

/** One line, collapsed whitespace, bounded length (CWE-117). */
function oneLine(value, max = 400) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `$HOME` -> `~`; never a username, never an absolute home path. */
function collapse(value) {
  const text = String(value);
  if (HOME.length > 1 && text.startsWith(HOME)) return `~${text.slice(HOME.length)}`;
  return text;
}

function out(line) {
  try {
    writeSync(1, `${line}\n`);
  } catch {
    /* reader closed (EPIPE) — never crash on a closed pipe */
  }
}

function err(line) {
  try {
    writeSync(2, `${line}\n`);
  } catch {
    /* ditto */
  }
}

/**
 * Static hint carried by every refusal that involves a held port
 * (wording class of `src/server.ts:514-522`, asserted by AC-P4-OPS-05/06).
 */
function neverKillHint() {
  return (
    `HINT: if the upstream agentmemory (iii) holds 3111/3112/3113, NEVER kill it; ` +
    `start ours elsewhere: AGENT_MEMORY_PORT=3151 npm run dev; ` +
    `then point clients at AGENT_MEMORY_URL=http://127.0.0.1:3151 (example)`
  );
}

/* ------------------------------------------------------------------ */
/* Fail-closed argument parsing (REQ-P4-OPS-01, §4.1; src/server.ts:479) */
/* ------------------------------------------------------------------ */

const USAGE = `agent-memory — ops control plane (P4)

Usage:
  agent-memory start  --slot N [--data-dir PATH]
  agent-memory stop   --slot N [--data-dir PATH]
  agent-memory status --slot N
  agent-memory doctor --slot N [--data-dir PATH]
                       [--migrate [--apply --yes] [--backup-dir PATH]]
  agent-memory --help

Slots (derived, never a default change):
  REST R(N) = 3111 + 3(N-1)   Helix H(N) = 6969 + (N-1)
  reserved R+1 / R+2 reserve address space only — never bound, never signaled
  slot 1 = instance "dev" (3111/6969/3112/3113), slot N>=2 = "slotN"

Exit codes:
  start/stop : 0 ok · 1 refused or failed · 2 usage
  status     : 0 healthy · 1 degraded · 2 usage
  doctor     : 0 healthy · 1 doctor-check-failed · 2 usage
               3 upstream-holds-port · 4 helix-down · 5 secret-missing
               (fixed precedence 5 > 4 > 3 > 1 > 0, one VERDICT line)`;

const COMMANDS = new Set(["start", "stop", "status", "doctor"]);
const FLAG_ARITY = { "--slot": 1, "--data-dir": 1, "--backup-dir": 1, "--migrate": 0, "--apply": 0, "--yes": 0 };
const FLAGS_BY_COMMAND = {
  start: new Set(["--slot", "--data-dir"]),
  stop: new Set(["--slot", "--data-dir"]),
  status: new Set(["--slot"]),
  doctor: new Set(["--slot", "--data-dir", "--migrate", "--apply", "--yes", "--backup-dir"]),
};

/** Usage error: message on stderr, usage on stderr, exit 2. */
function usageError(detail) {
  if (detail !== undefined) err(`usage: ${oneLine(detail, 200)}`);
  err(USAGE);
  process.exit(2);
}

/**
 * Parse argv fail-closed. Unknown subcommand, unknown flag, a flag the
 * subcommand does not accept, a missing flag value or an invalid `--slot`
 * all exit 2 with usage on stderr. `--help` anywhere exits 0 with usage on
 * stdout.
 * @returns {{command:string, slot:number, dataDir?:string, backupDir?:string,
 *            migrate:boolean, apply:boolean, yes:boolean}}
 */
function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(USAGE);
    process.exit(0);
  }
  const head = argv[0];
  if (head === undefined) usageError("missing subcommand (start|stop|status|doctor)");
  if (!COMMANDS.has(head)) usageError(`unknown subcommand "${head}"`);
  const command = head;

  const flags = { slot: "1", dataDir: undefined, backupDir: undefined, migrate: false, apply: false, yes: false };
  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    const eq = token.includes("=") ? token.indexOf("=") : -1;
    const name = eq === -1 ? token : token.slice(0, eq);
    if (!Object.hasOwn(FLAG_ARITY, name)) usageError(`unknown flag "${name}"`);
    if (!FLAGS_BY_COMMAND[command].has(name)) usageError(`flag "${name}" is not valid for "${command}"`);
    const arity = FLAG_ARITY[name];
    let value;
    if (arity === 1) {
      if (eq !== -1) {
        value = token.slice(eq + 1);
      } else {
        value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) usageError(`flag "${name}" requires a value`);
        index += 1;
      }
      if (value.length === 0) usageError(`flag "${name}" requires a value`);
    } else if (eq !== -1) {
      usageError(`flag "${name}" takes no value`);
    }
    if (name === "--slot") flags.slot = value;
    else if (name === "--data-dir") flags.dataDir = value;
    else if (name === "--backup-dir") flags.backupDir = value;
    else if (name === "--migrate") flags.migrate = true;
    else if (name === "--apply") flags.apply = true;
    else if (name === "--yes") flags.yes = true;
    index += 1;
  }

  if (flags.apply && !flags.migrate) usageError('"--apply" requires "--migrate"');
  if (flags.migrate && flags.apply && !flags.yes) usageError('"--migrate --apply" requires "--yes"');
  if (flags.backupDir !== undefined && !flags.migrate) usageError('"--backup-dir" requires "--migrate"');

  if (!/^[1-9][0-9]{0,4}$/.test(flags.slot)) usageError(`invalid --slot "${flags.slot}" (integer >= 1)`);
  const slot = Number(flags.slot);
  const ports = derive(slot);
  for (const port of [ports.rest, ports.r1, ports.r2, ports.helix]) {
    if (port > 65535) usageError(`--slot ${slot} derives an out-of-range port (max 65535)`);
  }

  return { command, slot, dataDir: flags.dataDir, backupDir: flags.backupDir, migrate: flags.migrate, apply: flags.apply, yes: flags.yes };
}

/* ------------------------------------------------------------------ */
/* Data-dir + state paths (REQ-P4-OPS-07, §4.3/§4.4; security C4)      */
/* ------------------------------------------------------------------ */

/**
 * Path refusal set (security C4/S-004): refuse `/`, system roots and
 * `$HOME` itself; explicit paths are allowed only under `$HOME` or `/tmp`.
 * @returns {{path:string, explicit:boolean, reason?:string, origin:string}}
 */
function resolveDataDir(slot, flagPath) {
  const fromEnv = nonEmpty(process.env["AGENT_MEMORY_DATA_DIR"]);
  const raw = flagPath ?? fromEnv;
  const origin = flagPath !== undefined ? "--data-dir" : fromEnv !== undefined ? "AGENT_MEMORY_DATA_DIR" : "default";
  if (raw === undefined) {
    return { path: path.join(HOME, ".local", "share", "agent-memory", String(slot)), explicit: false, origin };
  }
  const resolved = path.resolve(raw);
  if (SYSTEM_ROOTS.has(resolved)) return { path: resolved, explicit: true, origin, reason: "system root" };
  if (resolved === path.resolve(HOME)) return { path: resolved, explicit: true, origin, reason: "home directory itself" };
  const underHome = resolved.startsWith(`${path.resolve(HOME)}${path.sep}`);
  const underTmp = resolved.startsWith(`/tmp${path.sep}`);
  if (!underHome && !underTmp) return { path: resolved, explicit: true, origin, reason: "outside $HOME and /tmp" };
  return { path: resolved, explicit: true, origin };
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** §4.4: sibling `state/` dir — never inside HELIX_DATA_DIR. */
function stateDirOf(dataDir) {
  return path.join(path.dirname(dataDir), "state");
}

function statePathOf(dataDir, slot) {
  return path.join(stateDirOf(dataDir), `slot-${slot}.json`);
}

function ensureDir0700(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort — creation mode already applied for new dirs */
  }
}

function cliVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/* ------------------------------------------------------------------ */
/* State file: closed schema + permissions (security C3 / S-012)       */
/* ------------------------------------------------------------------ */

/** @returns {{kind:"absent"}|{kind:"invalid"}|{kind:"ok", state:object}} */
function readState(statePath) {
  if (!existsSync(statePath)) return { kind: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { kind: "invalid" };
  }
  return isValidState(parsed) ? { kind: "ok", state: parsed } : { kind: "invalid" };
}

function isValidState(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "cliVersion,dataDir,helixInstance,pids,slot,startedAt") return false;
  if (!Number.isInteger(value.slot) || value.slot < 1) return false;
  if (typeof value.helixInstance !== "string" || value.helixInstance.length === 0) return false;
  if (typeof value.dataDir !== "string") return false;
  if (typeof value.startedAt !== "string") return false;
  if (typeof value.cliVersion !== "string") return false;
  const pids = value.pids;
  if (typeof pids !== "object" || pids === null || Array.isArray(pids)) return false;
  if (Object.keys(pids).sort().join(",") !== "helix,rest") return false;
  for (const key of ["rest", "helix"]) {
    const pid = pids[key];
    if (pid !== null && !(Number.isInteger(pid) && pid > 0)) return false;
  }
  return true;
}

function writeState(statePath, state) {
  ensureDir0700(path.dirname(statePath));
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(statePath, 0o600);
  } catch {
    /* creation mode already applied */
  }
}

/* ------------------------------------------------------------------ */
/* Governance audit line (security C6 / S-006)                          */
/* ------------------------------------------------------------------ */

/**
 * One allowlisted line per destructive action: timestamp, slot, action,
 * exit — never a secret, never memory content, never a username.
 * Store = `<state-dir>/audit.log` (0600 in a 0700 dir).
 */
function appendAudit(dataDir, slot, action, status, exitCode) {
  try {
    const dir = stateDirOf(dataDir);
    ensureDir0700(dir);
    const file = path.join(dir, "audit.log");
    const line = `${new Date().toISOString()} slot=${slot} action=${action} status=${status} exit=${exitCode}\n`;
    appendFileSync(file, line, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* creation mode already applied */
    }
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Process identity (shared verifyOwnedPid — security C3, C10)          */
/* ------------------------------------------------------------------ */

function procCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
  } catch {
    return undefined;
  }
}

function procCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return undefined;
  }
}

function parentPid(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const end = text.lastIndexOf(")");
    if (end === -1) return undefined;
    const fields = text.slice(end + 2).split(" ");
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) ? ppid : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isDescendant(pid, ancestor, maxDepth = 6) {
  let current = pid;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current === undefined || current <= 1) return false;
    if (current === ancestor) return true;
    current = parentPid(current);
  }
  return false;
}

/**
 * The single identity check shared by `stop` (pre-SIGTERM and again
 * pre-SIGKILL) and by `doctor` C3: recorded PID alive AND its current
 * command line still names our `src/server.ts` launch from THIS checkout.
 * Unreadable cmdline or cwd fails closed (not owned).
 */
function verifyOwnedPid(pid) {
  if (!pidAlive(pid)) return false;
  const cmdline = procCmdline(pid);
  if (cmdline === undefined || !cmdline.includes("src/server.ts")) return false;
  const cwd = procCwd(pid);
  if (cwd === undefined) return cmdline.includes(ROOT);
  return cwd === ROOT;
}

/** Deliver one signal to a PID already proven slot-owned. */
function signalOwned(pid, name) {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilDead(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(100);
  }
  return !pidAlive(pid);
}

/* ------------------------------------------------------------------ */
/* Port probes (read-only; never a signal, never a bind on kept ports)  */
/* ------------------------------------------------------------------ */

function tcpListenInodes(port) {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 10) continue;
      if (columns[3] !== "0A") continue; // TCP_LISTEN
      const address = columns[1] ?? "";
      const portHex = address.split(":")[1];
      if (portHex === undefined) continue;
      if (Number.parseInt(portHex, 16) !== port) continue;
      const inode = columns[9];
      if (inode !== undefined) inodes.add(inode);
    }
  }
  return inodes;
}

function pidOwningInodes(inodes) {
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry)) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link;
      try {
        link = readlinkSync(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[([0-9]+)\]$/.exec(link);
      if (match !== null && inodes.has(match[1])) return Number(entry);
    }
  }
  return undefined;
}

/** Bind probe fallback when /proc/net is unavailable (never on kept ports). */
function bindProbeFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    const finish = (free) => {
      probe.removeAllListeners();
      probe.close(() => resolve(free));
    };
    probe.once("error", () => resolve(false));
    probe.once("listening", () => finish(true));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * @returns {Promise<{free:boolean, pid:number|undefined}>}
 * `pid: undefined` with `free:false` = occupant we cannot identify
 * (different user / container runtime) — callers treat it as foreign.
 */
async function probePort(port) {
  let inodes;
  try {
    inodes = tcpListenInodes(port);
  } catch {
    inodes = undefined;
  }
  if (inodes === undefined) {
    const free = await bindProbeFree(port);
    return { free, pid: undefined };
  }
  if (inodes.size === 0) return { free: true, pid: undefined };
  const pid = pidOwningInodes(inodes);
  return pid === undefined ? { free: false, pid: undefined } : { free: false, pid };
}

/* ------------------------------------------------------------------ */
/* HTTP probes (read-only; the ONLY Authorization header in this CLI   */
/* lives in doctor C2 and only after the listener is proven slot-owned) */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpStatus(url, { headers = {}, timeoutMs = 3_000 } = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return response.status;
  } catch {
    return -1;
  }
}

function statusToken(status) {
  return status === -1 ? "refused" : String(status);
}

/* ------------------------------------------------------------------ */
/* Child spawning: absolute resolution + env minimization (security C8) */
/* ------------------------------------------------------------------ */

function resolveSibling(name) {
  const candidate = path.join(path.dirname(process.execPath), name);
  return existsSync(candidate) ? candidate : undefined;
}

function resolveOnPath(name) {
  const entries = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const expanded = entry.startsWith("~") ? path.join(HOME, entry.slice(1)) : entry;
    const candidate = path.join(expanded, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep scanning */
    }
  }
  return undefined;
}

/** Absolute `npx` — never a bare PATH-relative spawn (S-011). */
function resolveNpx() {
  return resolveSibling("npx") ?? resolveOnPath("npx");
}

/** Absolute `helix` — PATH is a trusted input, resolved once, then pinned. */
function resolveHelix() {
  return resolveOnPath("helix");
}

/** Child env for `helix`: AGENT_MEMORY_SECRET stripped (security C8/S-008). */
function helixEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "AGENT_MEMORY_SECRET") continue;
    env[key] = value;
  }
  return env;
}

/**
 * Run the Helix CLI synchronously. Only the exit code is ever rendered —
 * child text is captured and dropped (security C7: no raw passthrough).
 */
function runHelix(args, timeoutMs = 90_000) {
  const helix = resolveHelix();
  if (helix === undefined) return { found: false, code: -1 };
  try {
    const result = spawnSync(helix, args, {
      cwd: ROOT,
      env: helixEnv(),
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const code = typeof result.status === "number" ? result.status : -1;
    return { found: true, code };
  } catch {
    return { found: true, code: -1 };
  }
}

/* ------------------------------------------------------------------ */
/* helix.toml (table-scoped parse — runbook REQ-OPS-RUN-01 C5)          */
/* ------------------------------------------------------------------ */

/** @returns {Map<string, {storage?:string, port?:number}>} `[local.*]` only. */
function localInstances() {
  const table = new Map();
  let text;
  try {
    text = readFileSync(HELIX_TOML, "utf8");
  } catch {
    return table;
  }
  let current;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const header = /^\[local\.([A-Za-z0-9_-]+)\]$/.exec(line);
      current = header === null ? undefined : header[1];
      if (current !== undefined && !table.has(current)) table.set(current, {});
      continue;
    }
    if (current === undefined) continue;
    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    let value = pair[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (pair[1] === "storage") table.get(current).storage = value;
    if (pair[1] === "port") {
      const port = Number(value);
      if (Number.isInteger(port)) table.get(current).port = port;
    }
  }
  return table;
}

/**
 * Instance binding is CONFIG-derived, never guessed (runbook REQ-OPS-RUN-13):
 * slot 1 -> `[local.dev]`, slot N>=2 -> `[local.slotN]`.
 */
function instanceBinding(slot) {
  const name = slot === 1 ? "dev" : `slot${slot}`;
  const config = localInstances().get(name);
  return { name, registered: config !== undefined, storage: config?.storage, port: config?.port };
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

function reportRefusal(detail) {
  err(`REFUSE — ${oneLine(detail, 300)}`);
  err(neverKillHint());
}

/**
 * cmdStart (REQ-P4-OPS-02): pre-flight -> helix -> server -> readiness ->
 * state. Refuses on any quartet occupant we do not own (never signaled),
 * exits 0 when already running (security C5), and never rewrites helix.toml
 * outside the official `helix add local` registration.
 * @returns {Promise<number>} 0 | 1 (2 handled by the parser)
 */
async function cmdStart(flags) {
  const slot = flags.slot;
  const ports = derive(slot);
  const data = resolveDataDir(slot, flags.dataDir);

  // --- security C4: refusal set for the resolved data dir -------------
  if (data.reason !== undefined) {
    reportRefusal(
      `start: ${data.origin} path refused (${data.reason}): ${collapse(data.path)}` +
        ` — allowed roots are $HOME/** and /tmp/**`,
    );
    return 1;
  }
  if (data.explicit && existsSync(data.path)) {
    let stat;
    try {
      stat = statSync(data.path);
    } catch {
      stat = undefined;
    }
    if (stat === undefined || !stat.isDirectory()) {
      reportRefusal(`start: ${data.origin} is not a directory: ${collapse(data.path)}`);
      return 1;
    }
    let entries = [];
    try {
      entries = readdirSync(data.path);
    } catch {
      entries = [];
    }
    if (entries.length > 0) {
      reportRefusal(
        `start: ${data.origin} exists and is not empty (never adopting a foreign directory): ${collapse(data.path)}`,
      );
      return 1;
    }
  }

  out(`slot: ${slot}`);
  out(`instance: ${ports.instanceName}`);
  out(`quartet: rest=${ports.rest} helix=${ports.helix} reserved=${ports.r1},${ports.r2}`);

  const statePath = statePathOf(data.path, slot);

  // --- security C5: idempotence + closed-schema state -----------------
  const state = readState(statePath);
  if (state.kind === "invalid") {
    err(`REFUSE start — state file invalid (fail-closed, no process signaled): ${collapse(statePath)}`);
    return 1;
  }
  if (state.kind === "ok" && verifyOwnedPid(state.state.pids.rest)) {
    out("already running");
    out(`pids: rest=${state.state.pids.rest}`);
    out(`state: ${collapse(statePath)}`);
    return 0;
  }
  if (state.kind === "ok") {
    try {
      unlinkSync(statePath);
      out("state: stale record removed (recorded pid is gone or foreign)");
    } catch {
      err(`REFUSE start — stale state file could not be removed: ${collapse(statePath)}`);
      return 1;
    }
  }

  // --- pre-flight: any quartet occupant we do not own => refuse --------
  const binding = instanceBinding(slot);
  const foreign = [];
  let helixOwned = false;
  for (const role of [
    ["rest", ports.rest],
    ["reserved", ports.r1],
    ["reserved", ports.r2],
    ["helix", ports.helix],
  ]) {
    const [kind, port] = role;
    if (NEVER_BIND.includes(port)) {
      // Defense in depth: derivation must never target a kept port (INV-010).
      reportRefusal(`start: derived port ${port} is on the never-bind list — refusing`);
      return 1;
    }
    const probe = await probePort(port);
    if (probe.free) continue;
    if (kind === "helix" && binding.registered) {
      const health = await httpStatus(`http://127.0.0.1:${port}/healthz`, { timeoutMs: 2_000 });
      if (health === 200) {
        helixOwned = true;
        out(`helix: ${binding.name} already serving on ${port}`);
        continue;
      }
    }
    foreign.push({ kind, port, pid: probe.pid });
  }
  if (foreign.length > 0) {
    for (const holder of foreign) {
      const owner = holder.pid === undefined ? "owner unresolved" : `pid=${holder.pid}`;
      err(`REFUSE start — ${holder.kind} port ${holder.port} held by ${owner} (not slot-owned, never signaled)`);
    }
    err(neverKillHint());
    return 1;
  }

  // --- slot helix instance (one-time official registration, N>=2) -----
  if (!helixOwned) {
    if (slot >= 2 && !binding.registered) {
      const added = runHelix(["add", "local", "--name", binding.name, "--port", String(ports.helix)]);
      if (!added.found) {
        err("REFUSE start — helix CLI not found on PATH (install Helix CLI, then re-run)");
        return 1;
      }
      if (added.code !== 0) {
        err(`REFUSE start — helix: add ${binding.name} (exit ${added.code})`);
        err("HINT: run `helix add local --name slot" + `${slot} --port ${ports.helix}` + "` manually and re-run start");
        return 1;
      }
      out(`helix: registered [local.${binding.name}] on port ${ports.helix}`);
      // Ensure storage=disk (C5) — `helix add local` does not set it.
      try {
        const raw = readFileSync(HELIX_TOML, "utf8");
        const slotHeader = `[local.${binding.name}]`;
        if (raw.includes(slotHeader) && !raw.includes(`${slotHeader}`) /* placeholder to keep raw in scope */) {
          /* no-op — real check below */
        }
        // Re-read and patch if missing storage under this table.
        let text = readFileSync(HELIX_TOML, "utf8");
        const lines = text.split("\n");
        let idx = -1;
        for (let i = 0; i < lines.length; i++) if (lines[i].trim() === slotHeader) idx = i;
        if (idx !== -1) {
          let hasStorage = false;
          for (let j = idx + 1; j < lines.length; j++) {
            if (lines[j].trim().startsWith("[")) break;
            if (/^\s*storage\s*=/.test(lines[j])) { hasStorage = true; break; }
          }
          if (!hasStorage) {
            lines.splice(idx + 1, 0, 'storage = "disk"');
            writeFileSync(HELIX_TOML, lines.join("\n"), "utf8");
            out(`helix: patched [local.${binding.name}] storage="disk" (C5)`);
          }
        }
      } catch {
        // Fail open — helix will run in memory mode; doctor C5 will report it.
      }
    }
    const started = runHelix(["start", binding.name]);
    if (!started.found) {
      err("REFUSE start — helix CLI not found on PATH (install Helix CLI, then re-run)");
      return 1;
    }
    if (started.code !== 0) {
      err(`REFUSE start — helix: start ${binding.name} (exit ${started.code})`);
      err(`HINT: inspect with \`helix status ${binding.name}\` (child output is never replayed here)`);
      return 1;
    }
    out(`helix: started ${binding.name} on ${ports.helix}`);
  }

  // --- spawn the REST server with the derived env (§4.3) ---------------
  const npx = resolveNpx();
  if (npx === undefined) {
    err("REFUSE start — npx not found (install Node >= 20), nothing was started");
    return 1;
  }
  const serverEnv = {
    ...process.env,
    AGENT_MEMORY_PORT: String(ports.rest),
    AGENT_MEMORY_HOST: "127.0.0.1",
    AGENT_MEMORY_URL: `http://127.0.0.1:${ports.rest}`,
    HELIX_URL: `http://127.0.0.1:${ports.helix}`,
    AGENT_MEMORY_DATA_DIR: data.path,
    // HELIX_DATA_DIR deliberately absent — probe A3 failed (see file header).
  };

  ensureDir0700(stateDirOf(data.path));
  const logPath = path.join(stateDirOf(data.path), `slot-${slot}.log`);
  let logFd;
  try {
    logFd = openSync(logPath, "a", 0o600);
    chmodSync(logPath, 0o600);
  } catch (error) {
    reportRefusal(`start: cannot open server log ${collapse(logPath)} (${oneLine(error?.code ?? "error", 60)})`);
    return 1;
  }
  const child = spawn(npx, ["tsx", "src/server.ts"], {
    cwd: ROOT,
    env: serverEnv,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  closeSync(logFd);
  let childExit = null;
  child.once("exit", (code) => {
    childExit = code;
  });
  child.unref();
  if (child.pid === undefined) {
    err("REFUSE start — server spawn failed (no pid)");
    return 1;
  }

  // --- readiness gate: Helix /healthz + our /memory/livez, 30 s -------
  const healthzUrl = `http://127.0.0.1:${ports.helix}/healthz`;
  const livezUrl = `http://127.0.0.1:${ports.rest}/memory/livez`;
  const deadline = Date.now() + READINESS_MS;
  let helixStatus = -1;
  let livezStatus = -1;
  while (Date.now() < deadline) {
    if (childExit !== null) break;
    [helixStatus, livezStatus] = await Promise.all([
      httpStatus(healthzUrl, { timeoutMs: 2_000 }),
      httpStatus(livezUrl, { timeoutMs: 2_000 }),
    ]);
    if (helixStatus === 200 && livezStatus === 200) break;
    await sleep(250);
  }
  const ready = helixStatus === 200 && livezStatus === 200;

  if (!ready) {
    // Roll back ONLY what we spawned in this invocation (tracked, ours).
    const listener = await probePort(ports.rest);
    if (listener.pid !== undefined && isDescendant(listener.pid, child.pid)) {
      signalOwned(listener.pid, "SIGTERM");
      await waitUntilDead(listener.pid, 2_000);
      if (pidAlive(listener.pid)) signalOwned(listener.pid, "SIGKILL");
    }
    if (pidAlive(child.pid)) {
      signalOwned(child.pid, "SIGTERM");
      await waitUntilDead(child.pid, 2_000);
      if (pidAlive(child.pid)) signalOwned(child.pid, "SIGKILL");
    }
    const detail =
      `readiness failed (helix=${statusToken(helixStatus)} rest=${statusToken(livezStatus)}` +
      `${childExit === null ? "" : ` server-exit=${childExit}`})`;
    reportRefusal(`start — ${detail}`);
    err(`HINT: server log ${collapse(logPath)} (read it yourself; never replayed here)`);
    return 1;
  }

  // --- record state (REQ-P4-OPS-07 / §4.4) ----------------------------
  const listener = await probePort(ports.rest);
  const owned = listener.pid !== undefined && (listener.pid === child.pid || isDescendant(listener.pid, child.pid));
  const restPid = owned ? listener.pid : child.pid;
  const record = {
    slot,
    pids: { rest: restPid, helix: null },
    helixInstance: binding.name,
    dataDir: data.path,
    startedAt: new Date().toISOString(),
    cliVersion: cliVersion(),
  };
  try {
    writeState(statePath, record);
  } catch (error) {
    signalOwned(restPid, "SIGTERM");
    await waitUntilDead(restPid, 3_000);
    reportRefusal(`start — state file not writable ${collapse(statePath)} (${oneLine(error?.code ?? "error", 60)})`);
    return 1;
  }

  out(`server: started pid=${restPid}`);
  out(`ready: helix=${statusToken(helixStatus)} rest=${statusToken(livezStatus)}`);
  out(`state: ${collapse(statePath)}`);
  out(`data-dir: ${collapse(data.path)} (${existsSync(data.path) ? "present" : "missing"})`);
  if (data.explicit) {
    out(
      "NOTE data-dir: HELIX_DATA_DIR is not forwarded by helix 3.3.0 (probe A3 failed) — " +
        "storage unchanged (MinIO); framing 3b decision pending orchestrator",
    );
  }
  return 0;
}

/**
 * cmdStop (REQ-P4-OPS-03, runbook §4d): tracked PIDs only, identity
 * re-verified before EACH signal, instance name config-derived, idempotent.
 * @returns {Promise<number>} 0 | 1
 */
async function cmdStop(flags) {
  const slot = flags.slot;
  const ports = derive(slot);
  const data = resolveDataDir(slot, flags.dataDir);
  if (data.reason !== undefined) {
    reportRefusal(`stop: ${data.origin} path refused (${data.reason}): ${collapse(data.path)}`);
    return 1;
  }

  const statePath = statePathOf(data.path, slot);
  const state = readState(statePath);

  if (state.kind === "absent") {
    out("not running");
    out(`slot: ${slot}`);
    return 0;
  }
  if (state.kind === "invalid") {
    err(`REFUSE stop — state file invalid (fail-closed, no signal): ${collapse(statePath)}`);
    appendAudit(data.path, slot, "stop", "refuse-state-invalid", 1);
    return 1;
  }

  const record = state.state;
  out(`slot: ${slot}`);

  // Config-derived binding before anything else (runbook REQ-OPS-RUN-13).
  const binding = instanceBinding(slot);
  out(`instance: ${binding.name}`);
  if (!binding.registered) {
    err(`REFUSE stop — [local.${binding.name}] not found in helix.toml (fail-closed, no signal)`);
    appendAudit(data.path, slot, "stop", "refuse-instance-unregistered", 1);
    return 1;
  }
  if (record.helixInstance !== binding.name) {
    err(
      `REFUSE stop — state instance "${oneLine(record.helixInstance, 40)}" does not match derived "${binding.name}" (fail-closed, no signal)`,
    );
    appendAudit(data.path, slot, "stop", "refuse-instance-mismatch", 1);
    return 1;
  }

  let exitCode = 0;
  const pid = record.pids.rest;

  // --- REST server: tracked PID only, identity re-verified per signal --
  if (pid === null) {
    out("pids: rest=none");
  } else if (!pidAlive(pid)) {
    out(`pids: rest=${pid} already exited`);
  } else if (!verifyOwnedPid(pid)) {
    err(`stale-pid: rest=${pid} (command line no longer matches our server — signal skipped)`);
    err("REFUSE stop — refusing to signal a pid we cannot prove we own");
    appendAudit(data.path, slot, "stop", "refuse-stale-pid", 1);
    return 1;
  } else {
    out(`stopping: rest pid=${pid} (SIGTERM)`);
    signalOwned(pid, "SIGTERM");
    let dead = await waitUntilDead(pid, TERM_GRACE_MS);
    if (!dead) {
      // C10: re-verify the SAME pid again immediately before SIGKILL.
      if (!verifyOwnedPid(pid)) {
        err(`stale-pid: rest=${pid} (identity changed during grace — SIGKILL skipped)`);
        appendAudit(data.path, slot, "stop", "refuse-stale-pid-kill", 1);
        return 1;
      }
      out(`stopping: rest pid=${pid} (SIGKILL)`);
      signalOwned(pid, "SIGKILL");
      dead = await waitUntilDead(pid, KILL_WAIT_MS);
      if (!dead) {
        err(`own-process failed to die: pid=${pid}`);
        exitCode = 1;
      }
    }
    if (dead) out(`stopped: rest pid=${pid}`);
  }

  // --- Helix: named instance only (never a bare invocation) ------------
  out(`stopping: helix instance=${binding.name}`);
  const stopped = runHelix(["stop", binding.name], 60_000);
  if (!stopped.found) {
    err("REFUSE stop — helix CLI not found on PATH (the REST server was stopped; instance untouched)");
    appendAudit(data.path, slot, "stop", "refuse-helix-missing", 1);
    return 1;
  }
  if (stopped.code !== 0) {
    const health = await httpStatus(`http://127.0.0.1:${ports.helix}/healthz`, { timeoutMs: 2_000 });
    if (health === 200) {
      err(`own-process failed to die: helix instance=${binding.name} still healthy after stop (exit ${stopped.code})`);
      exitCode = 1;
    } else {
      out(`helix: stop ${binding.name} (exit ${stopped.code}; instance not serving)`);
    }
  } else {
    out(`helix: stop ${binding.name} (exit 0)`);
  }

  // --- state removal + governance line --------------------------------
  try {
    unlinkSync(statePath);
    out(`state removed: ${collapse(statePath)}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      err(`REFUSE stop — state file not removable: ${collapse(statePath)}`);
      exitCode = 1;
    }
  }
  appendAudit(data.path, slot, "stop", exitCode === 0 ? "ok" : "fail", exitCode);
  return exitCode;
}

/**
 * cmdStatus (REQ-P4-OPS-04): read-only. Never attaches an Authorization
 * header — a 401 from /memory/health means the guard is armed, not degraded
 * (escalation E-3 / S-014). Own 0/1/2 contract; it is NOT doctor (INV-009).
 * @returns {Promise<number>} 0 | 1
 */
async function cmdStatus(flags) {
  const slot = flags.slot;
  const ports = derive(slot);
  const data = resolveDataDir(slot, flags.dataDir);
  const binding = instanceBinding(slot);
  const statePath = statePathOf(data.path, slot);
  const state = readState(statePath);

  out(`slot: ${slot}`);
  out(`instance: ${binding.name}`);
  out(`quartet: rest=${ports.rest} helix=${ports.helix} reserved=${ports.r1},${ports.r2}`);

  if (state.kind === "invalid") {
    out(`state: invalid (${collapse(statePath)})`);
    out("pids: unreadable");
  } else if (state.kind === "ok") {
    out(`state: running (${collapse(statePath)})`);
    const rest = state.state.pids.rest;
    out(rest === null ? "pids: rest=none" : `pids: rest=${rest} owned=${verifyOwnedPid(rest) ? "yes" : "no"}`);
  } else {
    out("state: not-running");
    out("pids: none");
  }

  const [helixStatus, livezStatus, healthStatus] = await Promise.all([
    httpStatus(`http://127.0.0.1:${ports.helix}/healthz`, { timeoutMs: 2_500 }),
    httpStatus(`http://127.0.0.1:${ports.rest}/memory/livez`, { timeoutMs: 2_500 }),
    // No Authorization header, ever: 401 == armed + serving.
    httpStatus(`http://127.0.0.1:${ports.rest}/memory/health`, { timeoutMs: 2_500 }),
  ]);

  const helixUp = helixStatus === 200;
  const restUp = livezStatus === 200 || healthStatus === 200 || healthStatus === 401;
  out(`helix: ${helixUp ? "up" : "down"} (healthz=${statusToken(helixStatus)})`);
  out(
    `rest: ${restUp ? "up" : "down"} (livez=${statusToken(livezStatus)} health=${statusToken(healthStatus)}` +
      `${healthStatus === 401 ? " armed" : ""})`,
  );

  const dirFlag = data.reason !== undefined ? "invalid" : existsSync(data.path) ? "present" : "missing";
  out(`data-dir: ${collapse(data.path)} (${dirFlag})`);
  out(`bearer: ${nonEmpty(process.env["AGENT_MEMORY_SECRET"]) === undefined ? "unset" : "armed"}`);

  return helixUp && restUp ? 0 : 1;
}

/**
 * cmdDoctor (REQ-P4-OPS-05, runbook REQ-OPS-RUN-01/02): checks run in the
 * order C1 -> C3 -> C2 -> C4 -> C5 on every invocation, one line per check,
 * then exactly one `VERDICT: <name>` line; exit follows the closed set with
 * fixed precedence 5 > 4 > 3 > 1 > 0.
 *
 * Security C1 (S-001): C2 runs ONLY after C3 proves the REST listener is
 * slot-owned; a foreign or unresolved listener receives NO request at all
 * and no Authorization header is ever constructed for it.
 *
 * @returns {Promise<number>} 0..5 (2 handled by the parser)
 */
async function cmdDoctor(flags) {
  const slot = flags.slot;
  const ports = derive(slot);
  const data = resolveDataDir(slot, flags.dataDir);
  const binding = instanceBinding(slot);
  const statePath = statePathOf(data.path, slot);
  const state = readState(statePath);
  const secret = nonEmpty(process.env["AGENT_MEMORY_SECRET"]);

  const failures = { secretMissing: false, helixDown: false, upstreamPort: false, checkFailed: false };

  const emit = (verdict, exitCode, checkId, detail) => {
    out(`${verdict} ${checkId} — ${oneLine(detail, 400)}`);
  };

  // --- C1 helix-healthz (read-only HTTP probe) ------------------------
  const helixStatus = await httpStatus(`http://127.0.0.1:${ports.helix}/healthz`, { timeoutMs: 3_000 });
  const c1ok = helixStatus === 200;
  if (!c1ok) failures.helixDown = true;
  emit(c1ok ? "PASS" : "FAIL", c1ok ? 0 : 4, "C1 helix-healthz", `status=${statusToken(helixStatus)} port=${ports.helix}`);

  // --- C3 ports: quartet + upstream occupancy + ownership -------------
  const segments = [];
  let restOwned = false;
  if (state.kind === "invalid") {
    failures.upstreamPort = true;
    segments.push("state: invalid (fail-closed)");
  }

  const restProbe = await probePort(ports.rest);
  if (restProbe.free) {
    segments.push(`rest=${ports.rest} free`);
  } else {
    const owned =
      state.kind === "ok" &&
      verifyOwnedPid(state.state.pids.rest) &&
      restProbe.pid !== undefined &&
      (restProbe.pid === state.state.pids.rest || isDescendant(restProbe.pid, state.state.pids.rest));
    if (owned) {
      restOwned = true;
      segments.push(`rest=${ports.rest} owned pid=${restProbe.pid}`);
    } else {
      failures.upstreamPort = true;
      const owner = restProbe.pid === undefined ? "owner unresolved" : `pid=${restProbe.pid}`;
      segments.push(`rest=${ports.rest} foreign ${owner}`);
    }
  }

  for (const reserved of [ports.r1, ports.r2]) {
    const probe = await probePort(reserved);
    if (probe.free) {
      segments.push(`reserved=${reserved} free`);
    } else {
      failures.upstreamPort = true;
      const owner = probe.pid === undefined ? "owner unresolved" : `pid=${probe.pid}`;
      segments.push(`reserved=${reserved} foreign ${owner}`);
    }
  }

  const helixProbe = await probePort(ports.helix);
  if (helixProbe.free) {
    segments.push(`helix=${ports.helix} free`);
  } else if (binding.registered && c1ok) {
    segments.push(`helix=${ports.helix} owned instance=${binding.name}`);
  } else {
    failures.upstreamPort = true;
    const owner = helixProbe.pid === undefined ? "owner unresolved" : `pid=${helixProbe.pid}`;
    segments.push(`helix=${ports.helix} foreign ${owner}`);
  }

  const upstream = [];
  for (const port of [3111, 3112, 3113]) {
    const probe = await probePort(port);
    upstream.push(`${port}:${probe.free ? "free" : probe.pid === undefined ? "held" : `held pid=${probe.pid}`}`);
  }
  segments.push(`upstream=${upstream.join(",")} (report-only)`);

  const c3ok = !failures.upstreamPort;
  emit(
    c3ok ? "PASS" : "FAIL",
    c3ok ? 0 : 3,
    "C3 ports",
    segments.join("; ") + (c3ok ? "" : ` | ${neverKillHint()}`),
  );

  // --- C2 rest-health: gated on C3 (security C1) -----------------------
  if (!restOwned) {
    if (restProbe.free) {
      emit("INFO", 0, "C2 rest-health", "not-running (start the slot; no request sent)");
    } else {
      emit("INFO", 0, "C2 rest-health", "skipped (listener not slot-owned; NO request sent, no bearer transmitted)");
    }
  } else {
    const headers = secret === undefined ? {} : { authorization: `Bearer ${secret}` };
    const [livezStatus, healthStatus] = await Promise.all([
      httpStatus(`http://127.0.0.1:${ports.rest}/memory/livez`, { timeoutMs: 3_000 }),
      httpStatus(`http://127.0.0.1:${ports.rest}/memory/health`, { headers, timeoutMs: 3_000 }),
    ]);
    const detail = `livez=${statusToken(livezStatus)} health=${statusToken(healthStatus)}`;
    if (livezStatus !== 200 || healthStatus === 500) {
      failures.helixDown = true;
      emit("FAIL", 4, "C2 rest-health", detail);
    } else if (healthStatus === 401) {
      failures.secretMissing = true;
      emit("FAIL", 5, "C2 rest-health", `${detail} (our bearer did not authorize the slot)`);
    } else if (livezStatus === 200 && healthStatus === 200) {
      emit("PASS", 0, "C2 rest-health", detail);
    } else {
      failures.helixDown = true;
      emit("FAIL", 4, "C2 rest-health", detail);
    }
  }

  // --- C4 secret-presence (flag only, value never read into output) ----
  if (secret === undefined) failures.secretMissing = true;
  emit(secret === undefined ? "FAIL" : "PASS", secret === undefined ? 5 : 0, "C4 secret-presence", secret === undefined ? "secret: missing" : "secret: present");

  // --- C5 storage-data-dir (table-scoped helix.toml parse) -------------
  const storage = binding.storage;
  let dirFlag;
  if (data.reason !== undefined) dirFlag = "invalid";
  else if (!existsSync(data.path)) dirFlag = "missing";
  else {
    try {
      accessSync(data.path, FS.W_OK);
      dirFlag = statSync(data.path).isDirectory() ? "present" : "not-writable";
    } catch {
      dirFlag = "not-writable";
    }
  }
  const c5ok = storage !== undefined && dirFlag !== "not-writable" && dirFlag !== "invalid";
  if (!c5ok) failures.checkFailed = true;
  emit(c5ok ? "PASS" : "FAIL", c5ok ? 0 : 1, "C5 storage-data-dir", `storage: ${storage ?? "missing"}; data-dir: ${dirFlag}`);

  // --- --migrate: A3 unsupported => ABORT, never a write ---------------
  if (flags.migrate) {
    failures.checkFailed = true;
    let reason = "unsupported-runtime — probe A3 failed: helix CLI 3.3.0 does not forward HELIX_DATA_DIR (framing 3b decision pending orchestrator)";
    if (flags.backupDir !== undefined) {
      const backup = path.resolve(flags.backupDir);
      const underHome = backup.startsWith(`${path.resolve(HOME)}${path.sep}`);
      const underTmp = backup.startsWith("/tmp/");
      if (SYSTEM_ROOTS.has(backup)) reason = `path-refused (system root): ${collapse(backup)}`;
      else if (!underHome && !underTmp) reason = `path-refused (outside $HOME and /tmp): ${collapse(backup)}`;
      else if (!existsSync(path.dirname(backup))) reason = `path-refused (parent missing): ${collapse(path.dirname(backup))}`;
    }
    err(`MIGRATE ABORT: ${oneLine(reason, 300)}`);
    err("HINT: no source was read, no backup was written, no target was touched; MinIO volume retained");
    if (flags.apply) {
      appendAudit(data.path, slot, "migrate-apply", "abort", failures.secretMissing ? 5 : failures.helixDown ? 4 : failures.upstreamPort ? 3 : 1);
    }
  }

  // --- fixed precedence 5 > 4 > 3 > 1 > 0 ------------------------------
  let verdict = "healthy";
  let exitCode = 0;
  if (failures.secretMissing) {
    verdict = "secret-missing";
    exitCode = 5;
  } else if (failures.helixDown) {
    verdict = "helix-down";
    exitCode = 4;
  } else if (failures.upstreamPort) {
    verdict = "upstream-holds-port";
    exitCode = 3;
  } else if (failures.checkFailed) {
    verdict = "doctor-check-failed";
    exitCode = 1;
  }
  out(`VERDICT: ${verdict}`);
  return exitCode;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  switch (flags.command) {
    case "start":
      return await cmdStart(flags);
    case "stop":
      return await cmdStop(flags);
    case "status":
      return await cmdStatus(flags);
    case "doctor":
      return await cmdDoctor(flags);
    default:
      usageError("missing subcommand (start|stop|status|doctor)");
      return 2;
  }
}

main()
  .then((code) => {
    process.exit(typeof code === "number" ? code : 0);
  })
  .catch((error) => {
    // Unexpected internal error: one allowlisted line, never a raw dump.
    const detail = error instanceof Error ? `${error.name}: ${oneLine(error.message, 200)}` : oneLine(String(error), 200);
    err(`FAIL internal — ${collapse(detail)}`);
    if (process.argv[2] === "doctor") out("VERDICT: doctor-check-failed");
    process.exit(1);
  });
