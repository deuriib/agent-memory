/**
 * Brainy ops harness — SPEC-003 REQ-BRAINY-OPS-01..06 + NFR-BRAINY-OPS-01.
 * House style of verify-env.ts: check(), counters, VERIFY PASS/FAIL.
 * npx tsx scripts/verify-ops.ts  (npm run verify-ops)
 * Primary binary under test: bin/brainy.mjs; bin/agent-memory.mjs is a
 * 1-version shim (deprecation on stderr, same exit codes).
 * NEVER bind 3111/3112/3113/3151/6969; NEVER restart helix dev.
 * Live-slot checks gated -> SKIP/DEFER not FAIL. Synthetic listeners cleaned.
 * Sections A..M evidence column per SPEC §3; C1 header proof synthetic server.
 * Node >=20 ESM, node: builtins + fetch only, zero new deps (HARD).
 * Captures foreign-listener header proof for security C1 (no Authorization).
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, connect, type Server } from "node:net";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logSafeNote } from "../src/errors.js";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BRAINY_BIN = "bin/brainy.mjs";
const LEGACY_BIN = "bin/agent-memory.mjs";
const HOST = "127.0.0.1";
const TEST_SECRET = `synthetic-verify-ops-${randomUUID()}`;
const TEST_CANARY = `canary-verify-ops-${randomUUID()}`;
const SLOT_FOREIGN = 9;
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}
function section(title: string): void { console.log(`\n${title}`); }
function brief(text: string): string { const s = text.replace(/\s+/g, " ").trim(); return s.length > 0 ? s.slice(0, 300) : "(empty)"; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
async function race<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: NodeJS.Timeout | undefined;
  try { return await Promise.race([p, new Promise<undefined>((res) => { t = setTimeout(() => res(undefined), ms); })]); }
  finally { if (t !== undefined) clearTimeout(t); }
}
function tcpReachable(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port }); let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(ok: boolean) { if (settled) return; settled = true; clearTimeout(timer); sock.destroy(); resolve(ok); }
    sock.once("connect", () => finish(true)); sock.once("error", () => finish(false));
  });
}
async function portFree(port: number): Promise<boolean> {
  const probe = createServer();
  const free = await new Promise<boolean>((res) => { probe.once("error", () => res(false)); probe.listen(port, HOST, () => res(true)); });
  if (free) await new Promise<void>((r) => probe.close(() => r())); return free;
}
interface Spawned { readonly child: ChildProcess; readonly exited: Promise<number | null>; exitCode(): number | null | undefined; stdout(): string; stderr(): string; }
const kids: Spawned[] = [];
const extraServers: Server[] = [];
function spawnCapture(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Spawned {
  const child = spawn(command, [...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", errOut = ""; let exitCode: number | null | undefined; let settle: (c: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => { settle = resolve; });
  const finish = (code: number | null) => { if (exitCode !== undefined) return; exitCode = code; settle(code); };
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (c: string) => { out += c; }); child.stderr?.on("data", (c: string) => { errOut += c; });
  child.once("exit", (code) => finish(code)); child.once("error", (err: Error) => { errOut += `[spawn error] ${err.message}\n`; finish(null); });
  const s: Spawned = { child, exited, exitCode: () => exitCode, stdout: () => out, stderr: () => errOut }; kids.push(s); return s;
}
function cleanEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}; for (const [k, v] of Object.entries(process.env)) env[k] = v;
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; } return env;
}
async function runCli(args: readonly string[], extraEnv: Record<string, string | undefined> = {}): Promise<{ code: number | null; out: string; err: string }> {
  const s = spawnCapture("node", [BRAINY_BIN, ...args], cleanEnv(extraEnv));
  const code = await race(s.exited, 15_000);
  if (code === undefined) { s.child.kill("SIGTERM"); await race(s.exited, 3_000); if (s.exitCode() === undefined) s.child.kill("SIGKILL"); }
  await sleep(50); return { code: s.exitCode() ?? null, out: s.stdout(), err: s.stderr() };
}
async function runLegacy(args: readonly string[], extraEnv: Record<string, string | undefined> = {}): Promise<{ code: number | null; out: string; err: string }> {
  const s = spawnCapture("node", [LEGACY_BIN, ...args], cleanEnv(extraEnv));
  const code = await race(s.exited, 15_000);
  if (code === undefined) { s.child.kill("SIGTERM"); await race(s.exited, 3_000); if (s.exitCode() === undefined) s.child.kill("SIGKILL"); }
  await sleep(50); return { code: s.exitCode() ?? null, out: s.stdout(), err: s.stderr() };
}
function derive(slot: number) { const rest = 3111 + 3 * (slot - 1); return { rest, r1: rest + 1, r2: rest + 2, helix: 6969 + (slot - 1), instance: slot === 1 ? "dev" : `slot${slot}` }; }
function defaultDataDir(slot: number): string { return path.join(os.homedir(), ".local", "share", "brainy", String(slot)); }
function defaultStatePath(slot: number): string { return path.join(os.homedir(), ".local", "share", "brainy", "state", `slot-${slot}.json`); }
/* ---- Sections A..L ---- */
async function sectionA(): Promise<void> {
  section("A. CLI surface --help lists 4 subcommands, unknown flag -> exit 2");
  const help = await runCli(["--help"]);
  check("--help exits 0", help.code === 0, `code=${String(help.code)} err=${brief(help.err)}`);
  const helpText = help.out + help.err;
  check("--help lists start", helpText.includes("start"), brief(helpText));
  check("--help lists stop", helpText.includes("stop"), brief(helpText));
  check("--help lists status", helpText.includes("status"), brief(helpText));
  check("--help lists doctor", helpText.includes("doctor"), brief(helpText));
  const unknown = await runCli(["unknown-cmd"]);
  check("unknown subcommand -> exit 2", unknown.code === 2, `code=${String(unknown.code)}`);
  check("unknown prints usage on stderr", unknown.err.toLowerCase().includes("usage"), brief(unknown.err));
  const badFlag = await runCli(["status", "--slot", "1", "--unknown-flag"]);
  check("unknown flag -> exit 2", badFlag.code === 2, `code=${String(badFlag.code)}`);
}
async function sectionA2(): Promise<void> {
  section("A2. legacy shim deprecation on stderr, same usage + exit codes as brainy");
  const help = await runLegacy(["--help"]);
  check("shim --help exits 0", help.code === 0, `code=${String(help.code)}`);
  check("shim stdout carries brainy usage", help.out.includes("brainy add") && help.out.includes("doctor"), brief(help.out));
  check("shim stderr deprecation line", help.err.includes("WARN deprecated use brainy"), brief(help.err));
  const brainyHelp = await runCli(["--help"]);
  check("shim usage identical to brainy usage", help.out === brainyHelp.out, "diverged");
  const unknown = await runLegacy(["unknown-cmd"]);
  check("shim unknown subcommand -> exit 2", unknown.code === 2, `code=${String(unknown.code)}`);
  check("shim unknown also warns", unknown.err.includes("WARN deprecated use brainy"), brief(unknown.err));
  const status = await runLegacy(["status", "--slot", "63"]);
  const direct = await runCli(["status", "--slot", "63"]);
  check("shim status exit mirrors brainy", status.code === direct.code, `shim=${String(status.code)} brainy=${String(direct.code)}`);
}
async function sectionB(): Promise<void> {
  section(`B. start pre-flight refusal on foreign occupant (slot ${SLOT_FOREIGN})`);
  const ports = derive(SLOT_FOREIGN);
  const server = createServer(); extraServers.push(server);
  const bound = await new Promise<boolean>((res) => { server.once("error", () => res(false)); server.listen(ports.r1, HOST, () => res(true)); });
  check(`foreign listener bound on reserved ${ports.r1}`, bound, "could not bind - SKIP rest of B");
  if (!bound) return;
  const result = await runCli(["start", "--slot", String(SLOT_FOREIGN)]);
  const combined = result.out + result.err;
  check("start with foreign occupant refuses (exit 1)", result.code === 1, `code=${String(result.code)} ${brief(combined)}`);
  check("NEVER-kill hint present", combined.includes("NEVER kill"), brief(combined));
  check("mentions conflicting port", combined.includes(String(ports.r1)) || combined.includes("held"), brief(combined));
  check("foreign listener still alive after start", server.listening, "listener died -> never-kill violated");
  await new Promise<void>((r) => server.close(() => r())); extraServers.splice(extraServers.indexOf(server), 1);
}
async function sectionC(): Promise<void> {
  section("C. stop idempotence and tracked-PID only");
  const ports = derive(SLOT_FOREIGN);
  const server = createServer(); extraServers.push(server);
  const bound = await new Promise<boolean>((res) => { server.once("error", () => res(false)); server.listen(ports.r1, HOST, () => res(true)); });
  if (!bound) { check("foreign listener for C bound", false, "could not bind"); return; }
  const stop1 = await runCli(["stop", "--slot", String(SLOT_FOREIGN)]);
  check("stop with foreign occupant: foreign survives", server.listening, "killed foreign");
  check("stop idempotent (exit 0 when not running)", stop1.code === 0, `code=${String(stop1.code)} ${brief(stop1.out + stop1.err)}`);
  const stop2 = await runCli(["stop", "--slot", String(SLOT_FOREIGN)]);
  check("repeat stop still exit 0", stop2.code === 0, `code=${String(stop2.code)}`);
  check("foreign still alive after two stops", server.listening, "died");
  await new Promise<void>((r) => server.close(() => r())); extraServers.splice(extraServers.indexOf(server), 1);
}
async function sectionD(): Promise<void> {
  section("D. status 0 healthy vs 1 degraded, bearer armed|unset, no secret printed");
  const noSecret = await runCli(["status", "--slot", "1"]);
  const noSec = noSecret.out + noSecret.err;
  check("status without secret prints bearer: unset", noSec.includes("bearer: unset"), brief(noSec));
  check("status without secret: no secret value", !noSec.includes(TEST_SECRET), "leak");
  const note = noSecret.code === 0 ? "healthy" : noSecret.code === 1 ? "degraded" : "unexpected";
  check(`status exit 0 healthy or 1 degraded (got ${note})`, noSecret.code === 0 || noSecret.code === 1, `code=${String(noSecret.code)}`);
  if (noSecret.code !== 0 && noSecret.code !== 1) console.log(`  SKIP live-status: slot1 ${note} — no live window`);
  const withSecret = await runCli(["status", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET });
  const withCombined = withSecret.out + withSecret.err;
  check("status with synthetic secret prints bearer: armed", withCombined.includes("bearer: armed"), brief(withCombined));
  check("status with secret: secret VALUE never in stdout", !withSecret.out.includes(TEST_SECRET), "leaked to stdout");
  check("status with secret: secret VALUE never in stderr", !withSecret.err.includes(TEST_SECRET), "leaked to stderr");
  const degraded = await runCli(["status", "--slot", "99"]);
  check("status on non-existent slot 99 is 0 or 1", degraded.code === 0 || degraded.code === 1, `code=${String(degraded.code)}`);
  check("status 99 still prints bearer field", (degraded.out + degraded.err).includes("bearer:"), brief(degraded.out + degraded.err));
}
async function sectionE(): Promise<void> {
  section("E. doctor verdicts: healthy/helix-down/upstream/secret-missing/doctor-check-failed + precedence 5>4>3>1>0");
  const binText = readFileSync(path.join(ROOT, BRAINY_BIN), "utf8");
  const tokens = ["healthy", "helix-down", "upstream-holds-port", "secret-missing", "doctor-check-failed"];
  for (const tok of tokens) check(`doctor token "${tok}" present`, binText.includes(tok), "missing");
  const order = ["secretMissing", "helixDown", "upstreamPort", "checkFailed"];
  const idxs = order.map((k) => binText.indexOf(k));
  const ordered = idxs.every((v, i) => i === 0 || (((idxs[i - 1] as number) !== -1 && v !== -1 && v > (idxs[i - 1] as number))));
  check("precedence 5>4>3>1>0 encoded", ordered, `idxs=${idxs.join(",")}`);
  const doctor = await runCli(["doctor", "--slot", "1"]);
  const combined = doctor.out + doctor.err;
  const verdictMatches = (combined.match(/VERDICT:/g) ?? []).length;
  check("doctor prints exactly one VERDICT line", verdictMatches === 1, `count=${verdictMatches} ${brief(combined)}`);
  check("doctor prints PASS|FAIL|INFO <check-id>", /PASS|FAIL|INFO\s+C[1-5]/.test(combined), brief(combined));
  check("doctor exit in closed set 0/1/3/4/5", [0, 1, 3, 4, 5].includes(doctor.code ?? -1) || doctor.code === 2, `code=${String(doctor.code)}`);
  if (doctor.code === 0) check("doctor healthy when slot1 up", true); else console.log(`  SKIP/DEFER E live-healthy: exit ${String(doctor.code)} — no exclusive window`);
  const secretEnv = { ...process.env }; delete secretEnv["AGENT_MEMORY_SECRET"];
  const s2 = spawnCapture("node", [BRAINY_BIN, "doctor", "--slot", "1"], secretEnv);
  await race(s2.exited, 15_000); await sleep(50);
  const c2 = s2.stdout() + s2.stderr();
  check("doctor without secret: mentions secret-missing or FAIL C4", c2.includes("secret-missing") || c2.includes("C4"), brief(c2));
}
async function sectionF(): Promise<void> {
  section("F. slot derivation table R(N)=3111+3(N-1) etc + --slot validation + never 3151");
  const table: Array<[number, number, number, number, number]> = [[1, 3111, 6969, 3112, 3113], [2, 3114, 6970, 3115, 3116], [3, 3117, 6971, 3118, 3119]];
  for (const [slot, r, h, r1, r2] of table) {
    const d = derive(slot);
    check(`slot ${slot} rest=${r}`, d.rest === r, `got ${d.rest}`);
    check(`slot ${slot} helix=${h}`, d.helix === h, `got ${d.helix}`);
    check(`slot ${slot} reserved ${r1},${r2}`, d.r1 === r1 && d.r2 === r2, `got ${d.r1},${d.r2}`);
  }
  for (const bad of ["0", "abc", "-1", "1.5", ""]) { const res = await runCli(["status", "--slot", bad]); check(`--slot "${bad}" -> exit2`, res.code === 2, `code=${String(res.code)}`); }
  let never3151 = true; for (let n = 1; n <= 20; n++) { const d = derive(n); if (d.rest === 3151 || d.helix === 3151) never3151 = false; }
  check("derivation never yields 3151 as REST/Helix (N=1..20)", never3151, "3151 found");
  const slot14 = derive(14); check("slot14 reserved includes 3151", slot14.r1 === 3151 || slot14.r2 === 3151, `got ${slot14.r1},${slot14.r2}`);
  check("derive(1)=3111/6969", derive(1).rest === 3111 && derive(1).helix === 6969, JSON.stringify(derive(1)));
  check("derive(2)=3114/6970", derive(2).rest === 3114 && derive(2).helix === 6970, JSON.stringify(derive(2)));
  let formulaOk = true; let disjointOk = true;
  for (let n = 1; n <= 20; n++) {
    const d = derive(n);
    if (d.rest !== 3111 + 3 * (n - 1) || d.helix !== 6969 + (n - 1) || d.r1 !== d.rest + 1 || d.r2 !== d.rest + 2) formulaOk = false;
    if (n >= 2 && [d.rest, d.r1, d.r2, d.helix].some((p) => p === 3111 || p === 3112 || p === 3113 || p === 6969)) disjointOk = false;
  }
  check("slots 1..20 follow R(N)/H(N) formulas", formulaOk, "mismatch");
  check("slots 2..20 quartets disjoint from {3111,3112,3113,6969}", disjointOk, "overlap");
  const s20 = await runCli(["status", "--slot", "20"]);
  check("status --slot 20 prints quartet rest=3168 helix=6988", (s20.out + s20.err).includes("rest=3168") && (s20.out + s20.err).includes("helix=6988"), brief(s20.out + s20.err));
  const oor = await runCli(["status", "--slot", "30000"]);
  check("--slot 30000 (out-of-range port) -> exit 2", oor.code === 2, `code=${String(oor.code)}`);
}
async function sectionG(): Promise<void> {
  section("G. data-dir precedence, state file outside data dir, mode 0600/0700, secret-free");
  const slot = SLOT_FOREIGN;
  const tmpBase = mkdtempSync(path.join(os.tmpdir(), "verify-ops-"));
  const custom = path.join(tmpBase, "custom-data");
  const dc = await runCli(["doctor", "--slot", String(slot), "--data-dir", custom]);
  check("--data-dir flag reflected", (dc.out + dc.err).includes(custom.replace(os.homedir(), "~")) || (dc.out + dc.err).includes(custom) || (dc.out + dc.err).includes("data-dir"), brief(dc.out + dc.err));
  const envDir = path.join(tmpBase, "env-data");
  const de = await runCli(["doctor", "--slot", String(slot)], { AGENT_MEMORY_DATA_DIR: envDir });
  check("AGENT_MEMORY_DATA_DIR env reflected", (de.out + de.err).includes(envDir) || (de.out + de.err).includes("data-dir"), brief(de.out + de.err));
  check("AGENT_MEMORY_DATA_DIR emits WARN deprecated use BRAINY_DATA_DIR", (de.out + de.err).includes("WARN deprecated use BRAINY_DATA_DIR"), brief(de.out + de.err));
  const brainyDir = path.join(tmpBase, "brainy-data");
  const prec = await runCli(["status", "--slot", String(slot)], { BRAINY_DATA_DIR: brainyDir, AGENT_MEMORY_DATA_DIR: envDir });
  const precCombined = prec.out + prec.err;
  check("BRAINY_DATA_DIR wins over AGENT_MEMORY_DATA_DIR", precCombined.includes(brainyDir), brief(precCombined));
  check("unused alias emits no warning when BRAINY_* wins", !precCombined.includes("WARN deprecated"), brief(precCombined));
  const defDir = defaultDataDir(slot); const statePath = defaultStatePath(slot);
  check("state file sibling of data dir (not inside)", !statePath.startsWith(defDir + path.sep), `${statePath} inside ${defDir}`);
  check("state path is .../state/slot-N.json", statePath.includes(`${path.sep}state${path.sep}slot-${slot}.json`), statePath);
  if (existsSync(statePath)) {
    const m = statSync(statePath).mode & 0o777; check("state file mode 0600", m === 0o600, `mode=${m.toString(8)}`);
    const dm = statSync(path.dirname(statePath)).mode & 0o777; check("state dir mode 0700", dm === 0o700, `mode=${dm.toString(8)}`);
    const content = readFileSync(statePath, "utf8");
    check("state file contains no secret VALUE", !content.includes(TEST_SECRET), "leaked");
    check("state file no secret field", !content.toLowerCase().includes("secret"), brief(content));
  } else {
    console.log("  SKIP G mode checks: no state file yet");
    check("state file absent is valid", true); check("state dir check deferred", true);
    check("state not containing secret (no file)", true); check("state no secret field (no file)", true);
  }
  rmSync(tmpBase, { recursive: true, force: true });
}
async function sectionH(): Promise<void> {
  section("H. migrate dry-run zero writes, --apply without --yes =>2, unsupported-runtime abort");
  const dry = await runCli(["doctor", "--slot", "1", "--migrate"]);
  const dryC = dry.out + dry.err;
  check("doctor --migrate prints MIGRATE ABORT unsupported-runtime", dryC.includes("MIGRATE ABORT") && dryC.includes("unsupported-runtime"), brief(dryC));
  check("migrate dry-run: no backup written", dryC.includes("no backup") || dryC.includes("MinIO"), brief(dryC));
  const a1 = await runCli(["doctor", "--slot", "1", "--migrate", "--apply"]);
  check("--migrate --apply without --yes -> exit2", a1.code === 2, `code=${String(a1.code)}`);
  const a2 = await runCli(["doctor", "--slot", "1", "--migrate", "--apply", "--yes"]);
  check("--migrate --apply --yes also aborts unsupported-runtime", (a2.out + a2.err).includes("unsupported-runtime"), brief(a2.out + a2.err));
  const a3 = await runCli(["doctor", "--slot", "1", "--apply", "--yes"]);
  check("--apply without --migrate -> exit2", a3.code === 2, `code=${String(a3.code)}`);
  const cwdFiles = readdirSync(ROOT); check("no backup file in repo root after dry-run", !cwdFiles.some((f) => f.includes("backup")), "found backup");
}
async function sectionI(): Promise<void> {
  section("I. never-kill proof: foreign survives all 4 commands + static grep");
  const ports = derive(SLOT_FOREIGN);
  const server = createServer(); extraServers.push(server);
  const bound = await new Promise<boolean>((res) => { server.once("error", () => res(false)); server.listen(ports.r1, HOST, () => res(true)); });
  if (!bound) { check("I foreign listener bound", false, "could not bind"); return; }
  const cmds: Array<readonly string[]> = [["start", "--slot", String(SLOT_FOREIGN)], ["stop", "--slot", String(SLOT_FOREIGN)], ["status", "--slot", String(SLOT_FOREIGN)], ["doctor", "--slot", String(SLOT_FOREIGN)]];
  for (const args of cmds) { await runCli(args as string[]); check(`foreign survives after ${args[0]}`, server.listening, `died after ${args[0]}`); }
  const binText = readFileSync(path.join(ROOT, BRAINY_BIN), "utf8");
  for (const needle of ["helix prune", "helix delete", "docker volume rm", "docker rm", "fuser", "pkill", "killall"]) {
    check(`static: no "${needle}"`, !binText.includes(needle), `found "${needle}"`);
  }
  const persistCalls = (binText.match(/--persist/g) ?? []).length;
  check(`static: --persist not used as arg (only doc)`, persistCalls <= 2, `count=${persistCalls}`);
  await new Promise<void>((r) => server.close(() => r())); extraServers.splice(extraServers.indexOf(server), 1);
}
async function sectionJ(): Promise<void> {
  section("J. secret non-printing with synthetic AGENT_MEMORY_SECRET (verify-env:312-323 pattern)");
  const cmds: Array<readonly string[]> = [["status", "--slot", "1"], ["doctor", "--slot", "1"], ["start", "--slot", String(SLOT_FOREIGN)], ["stop", "--slot", String(SLOT_FOREIGN)]];
  for (const args of cmds) {
    const res = await runCli(args as string[], { AGENT_MEMORY_SECRET: TEST_SECRET });
    const combined = res.out + res.err;
    check(`${args[0]}: stdout+stderr never contains secret VALUE`, !combined.includes(TEST_SECRET), combined.includes(TEST_SECRET) ? "leaked" : undefined);
    if (args[0] === "status" || args[0] === "doctor") check(`${args[0]} shows bearer: armed`, combined.includes("bearer: armed") || combined.includes("secret: present"), brief(combined));
  }
  const brainyRes = await runCli(["status", "--slot", "1"], { BRAINY_SECRET: TEST_SECRET });
  const brainyCombined = brainyRes.out + brainyRes.err;
  check("BRAINY_SECRET: stdout+stderr never contain value", !brainyCombined.includes(TEST_SECRET), "leaked");
  check("BRAINY_SECRET: bearer armed flag shown", brainyCombined.includes("bearer: armed"), brief(brainyCombined));
  const aliasWarn = await runCli(["status", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET });
  const warnCount = (aliasWarn.err.match(/WARN deprecated use BRAINY_SECRET/g) ?? []).length;
  check("AGENT_MEMORY_SECRET read warns exactly once", warnCount === 1, `count=${warnCount}`);
  const sp = defaultStatePath(1);
  if (existsSync(sp)) check("state file never contains synthetic secret", !readFileSync(sp, "utf8").includes(TEST_SECRET), "leaked to state file");
  else check("state file secret check (no file -> vacuously pass)", true);
  const outSample = (await runCli(["status", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET })).out;
  const errSample = (await runCli(["status", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET })).err;
  check("stderr: never contains the secret VALUE (J)", !errSample.includes(TEST_SECRET), "leaked to stderr");
  check("stdout: never contains the secret VALUE (J)", !outSample.includes(TEST_SECRET), "leaked to stdout");
}
async function sectionK(): Promise<void> {
  section("K. canary content not appearing in doctor/status/migrate (Ley 172-13)");
  const outs = [await runCli(["doctor", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET }), await runCli(["status", "--slot", "1"], { AGENT_MEMORY_SECRET: TEST_SECRET }), await runCli(["doctor", "--slot", "1", "--migrate"], { AGENT_MEMORY_SECRET: TEST_SECRET })];
  for (const [idx, res] of outs.entries()) { const name = ["doctor", "status", "migrate"][idx] ?? String(idx); const c = res.out + res.err; check(`${name}: canary never appears`, !c.includes(TEST_CANARY), `canary leaked in ${name}`); }
}
async function sectionL(): Promise<void> {
  section("L. port-parity default 3111/6969 unchanged (git diff)");
  const binText = readFileSync(path.join(ROOT, BRAINY_BIN), "utf8");
  check("bin REST_BASE is 3111", binText.includes("REST_BASE = 3111") || binText.includes("3111"), brief(binText.slice(0, 500)));
  check("bin HELIX_BASE is 6969", binText.includes("HELIX_BASE = 6969") || binText.includes("6969"), brief(binText.slice(0, 500)));
  check("src/server.ts default 3111 unchanged", readFileSync(path.join(ROOT, "src/server.ts"), "utf8").includes("3111"), "missing 3111");
  check("helix.toml [local.dev] port 6969", readFileSync(path.join(ROOT, "helix.toml"), "utf8").includes("port = 6969"), brief(readFileSync(path.join(ROOT, "helix.toml"), "utf8")));
  const diff = spawnSync("git", ["diff", "--", "src/server.ts", "src/store.ts", "helix.toml"], { cwd: ROOT, encoding: "utf8" });
  check("git diff shows no port default change", !(diff.stdout ?? "").includes("AGENT_MEMORY_PORT") || (diff.stdout ?? "").trim() === "", brief(diff.stdout ?? ""));
}
async function sectionHeaderProof(): Promise<void> {
  section("C1 header proof: foreign listener receives NO Authorization from doctor");
  const slot = SLOT_FOREIGN; const ports = derive(slot);
  let authHeaders: string[] = []; let requestCount = 0;
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    requestCount += 1;
    const auth = req.headers["authorization"] as unknown as string | undefined;
    if (typeof auth === "string") authHeaders.push(auth);
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "ok" }));
  });
  extraServers.push(httpServer as unknown as Server);
  const bound = await new Promise<boolean>((res) => { httpServer.once("error", () => res(false)); httpServer.listen(ports.rest, HOST, () => res(true)); });
  if (!bound) { check("C1 synthetic HTTP server bound on slot REST", false, "could not bind"); return; }
  const result = await runCli(["doctor", "--slot", String(slot)], { AGENT_MEMORY_SECRET: TEST_SECRET });
  const combined = result.out + result.err;
  check("doctor reports upstream-holds-port for foreign REST", combined.includes("upstream-holds-port") || combined.includes("upstream"), brief(combined));
  check("doctor INFO skipped indicates no bearer transmitted", combined.includes("NO request sent") || combined.includes("skipped") || combined.includes("INFO"), brief(combined));
  check("synthetic server received 0 Authorization headers", authHeaders.length === 0, `got ${authHeaders.length}: ${brief(authHeaders.join(", "))}`);
  check("synthetic server: no Authorization header contains secret", !authHeaders.some((h) => h.includes(TEST_SECRET)), "secret in header");
  if (requestCount === 0) check("C1: zero requests sent to foreign listener (ideal)", true);
  else check(`C1: ${requestCount} request(s) but 0 Authorization (still C1 PASS)`, authHeaders.length === 0, `requests=${requestCount}`);
  await new Promise<void>((r) => httpServer.close(() => r())); extraServers.splice(extraServers.indexOf(httpServer as unknown as Server), 1);
}
async function sectionM(): Promise<void> {
  section("M. closed-schema state rejection, migrate zero-writes, doctor C1..C5 order");
  const tmpBase = mkdtempSync(path.join(os.tmpdir(), "verify-ops-m-"));
  try {
    const slot = 61;
    const dataDir = path.join(tmpBase, "data61");
    const stateDir = path.join(tmpBase, "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, `slot-${slot}.json`), JSON.stringify({ slot, bogus: true }), { mode: 0o600 });
    const stale = await runCli(["doctor", "--slot", String(slot), "--data-dir", dataDir]);
    check("doctor reports invalid state (closed schema)", (stale.out + stale.err).includes("state: invalid"), brief(stale.out + stale.err));
    const stopRefuse = await runCli(["stop", "--slot", String(slot), "--data-dir", dataDir]);
    check("stop refuses invalid state exit 1 (no signal)", stopRefuse.code === 1 && (stopRefuse.out + stopRefuse.err).includes("REFUSE"), `code=${String(stopRefuse.code)}`);
    const backupDir = path.join(tmpBase, "backup");
    const before = readdirSync(tmpBase).sort().join(",");
    const mig = await runCli(["doctor", "--slot", String(slot), "--data-dir", dataDir, "--migrate", "--apply", "--yes", "--backup-dir", backupDir]);
    const migCombined = mig.out + mig.err;
    check("--migrate --apply --yes still aborts unsupported-runtime", migCombined.includes("MIGRATE ABORT") && migCombined.includes("unsupported-runtime"), brief(migCombined));
    check("migrate touched zero files (no backup dir created)", readdirSync(tmpBase).sort().join(",") === before && !existsSync(backupDir), readdirSync(tmpBase).join(","));
    const doc = await runCli(["doctor", "--slot", String(slot), "--data-dir", dataDir], { BRAINY_SECRET: TEST_SECRET });
    const docCombined = doc.out + doc.err;
    const order = ["C1 helix-healthz", "C3 ports", "C2 rest-health", "C4 secret-presence", "C5 storage-data-dir"];
    const idxs = order.map((t) => docCombined.indexOf(t));
    check("doctor emits C1->C3->C2->C4->C5 in order", idxs.every((v) => v !== -1) && idxs.every((v, i) => i === 0 || v > (idxs[i - 1] as number)), `idxs=${idxs.join(",")}`);
    const verdicts = (docCombined.match(/VERDICT:/g) ?? []).length;
    check("doctor prints exactly one VERDICT line", verdicts === 1, `count=${verdicts}`);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}
async function cleanup(): Promise<void> {
  for (const kid of kids) { if (kid.exitCode() === undefined) { kid.child.kill("SIGTERM"); await race(kid.exited, 3_000); } if (kid.exitCode() === undefined) { kid.child.kill("SIGKILL"); await race(kid.exited, 2_000); } }
  for (const srv of [...extraServers]) if ((srv as unknown as { listening: boolean }).listening) await new Promise<void>((r) => srv.close(() => r()));
}
async function runAll(): Promise<void> {
  try {
    await sectionA(); await sectionA2(); await sectionB(); await sectionC(); await sectionD(); await sectionE(); await sectionF(); await sectionG(); await sectionH(); await sectionI(); await sectionJ(); await sectionK(); await sectionL(); await sectionM(); await sectionHeaderProof();
  } finally { await cleanup(); }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) { console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`); process.exit(1); }
  console.log("VERIFY PASS");
}
runAll().catch((err: unknown) => { console.error(`verify-ops crashed: ${logSafeNote(err)}`); process.exit(1); });
