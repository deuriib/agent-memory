# Readability Review: SPEC-P4-OPS — P4 ops control plane

**Reviewer:** review-readability (engineering domain, R1 — independent, not the author)
**Date:** 2026-09-24
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md / HARD:subagents / GATE:implementation done / DOMAINS:R1`
**Inputs read:** `bin/agent-memory.mjs` (1,378 lines — full read), `scripts/verify-ops.ts` (300 lines — full read), `README.md` ops section `## Operations — P4 control plane` (lines 601–784), `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` (142 lines), `docs/specs/20_backlog/SPEC-P4-OPS.md` (§4.1–§4.5), `frame-ship/skills/quality-gate/references/engineering/readability-review.md` (7-item checklist), prior `docs/specs/50_archive/P1R-P32/readability.md` and `docs/specs/50_archive/P1-P21/review-readability.md` (calibration)
**Scope:** lane `f8e29f1..974f5c4` — CLI binary + verify-ops harness + README ops docs; lens = naming / single-responsibility / nesting / comment-WHY / docs / dead-code / style, plus the 5 packet checks: CLI help clarity, slot-math comments, error-message allowlist (`oneLine`+`collapse`), no secret/PII in outputs, README table readability
**Verdict:** ✅ **PASS** — 3 Low hygiene observations; zero Medium/High/Critical; no gate-blocking finding

## Checklist (per `frame-ship/skills/quality-gate/references/engineering/readability-review.md`)

- [x] **Naming is intention-revealing (no `data`, `tmp`, `x`)**
- [x] **Functions have single responsibility**
- [x] **Nesting depth <= 3** — met except one isolated depth-4 loop (RD-P4-002, Low)
- [x] **Comments explain WHY, not WHAT**
- [x] **Public APIs documented**
- [x] **No dead code or commented-out blocks** — one dead no-op branch noted (RD-P4-001, Low)
- [x] **Consistent style with surrounding code**

Extended packet checks (all pass):

- [x] **CLI help clarity** — `USAGE` lists 4 subcommands, slot formula, reserved-port note, closed exit codes, precedence (see §1)
- [x] **Slot-math comments** — constants + `derive()` + `NEVER_BIND` + USAGE together state `R(N)=3111+3(N-1)` / `H(N)=6969+(N-1)` with invariants (see §2)
- [x] **Error messages allowlisted `oneLine`+`collapse`** — every `err()`/`reportRefusal()` path goes through `oneLine(…,max)` + `collapse(~)`; child output captured-not-replayed (see §3)
- [x] **No secret/PII in outputs** — only `bearer: armed|unset`, ports, PIDs, `~`-collapsed paths, status codes, VERDICT token, static never-kill hint (see §4)
- [x] **README table readable** — slot table + CLI block + exit-code matrix + backup declaration render cleanly in markdown (see §5)

## 1. CLI help clarity

`bin/agent-memory.mjs:164-184` — `USAGE` constant:

```
agent-memory — ops control plane (P4)

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
               (fixed precedence 5 > 4 > 3 > 1 > 0, one VERDICT line)
```

- All 4 subcommands present; `--slot N` defaults to `1` explained at `bin/agent-memory.mjs:254-255` (`--slot` fail-closed `^[1-9][0-9]{0,4}$` else usage exit 2).
- `doctor` flag grammar `--migrate [--apply --yes] [--backup-dir]` stated, then enforced at `bin/agent-memory.mjs:251-253` (`--apply requires --migrate`, `--migrate --apply requires --yes`, `--backup-dir requires --migrate` else exit 2) — reader can predict the exit-2 gates from help alone.
- Slot formula `R(N)=3111+3(N-1)` / `H(N)=6969+(N-1)` appears identically in `bin/agent-memory.mjs:174-177` help, `README.md:615-620` table, and `SPEC-P4-OPS.md:224-231` — no drift.
- Reserved-port note "never bound, never signaled" appears in help (line 176), in `bin/agent-memory.mjs:788-802` defense-in-depth comment, and in `README.md:625` invariant sentence.
- `parseArgs` help path at `bin/agent-memory.mjs:211-214` — `--help`/`-h` anywhere → `out(USAGE)` exit 0; unknown subcommand/flag → `usageError` with `oneLine(detail,200)` + `USAGE` on stderr exit 2 — matches `src/server.ts:479-481` fail-closed style cited in `PROPOSED_CHANGES.md:21`.
- No finding; help is intention-revealing and symmetrical with README.

## 2. Slot-math comments

- `bin/agent-memory.mjs:61-77` banner `Constants and pure slot derivation (REQ-P4-OPS-06, §4.2)` + trace to spec; constants `REST_BASE=3111`, `HELIX_BASE=6969`, `NEVER_BIND=[3111,3112,3113,3151,6969]` (line 76) named for intent, not bare literals.
- `bin/agent-memory.mjs:102-113` `derive(slot)` — pure function, 4 lines, JSDoc `@returns {{rest,r1,r2,helix,instanceName}}`, formula `rest=REST_BASE+3*(slot-1)`, `helix=HELIX_BASE+(slot-1)`, `r1=rest+1`, `r2=rest+2`, `instanceName=slot===1?"dev":`slot${slot}`` — single responsibility, testable, reused by `cmdStart`/`cmdStop`/`cmdStatus`/`cmdDoctor` and mirrored by `scripts/verify-ops.ts:75` `derive()` for harness goldens.
- `bin/agent-memory.mjs:65-69` `READINESS_MS=30_000`, `TERM_GRACE_MS=5_000`, `KILL_WAIT_MS=3_000` — named timeouts replace magic numbers in `cmdStart:924-935` and `cmdStop:1057/1067`.
- `README.md:608-625` slot section restates the same math in a 6-column markdown table plus the 4 invariant bullets (`N≥1 else exit 2`, `N≥2 ⇒ quartet ∩ {3111,3112,3113,6969}=∅`, `never 3151`, `reserved never bound`) — table renders without wrapping on GitHub, values align with binary.
- Short names `r1`/`r2` are the only terse identifiers; they are defined once in `derive()` and immediately documented in USAGE as `reserved R+1/R+2` — Low hygiene only (RD-P4-003).

## 3. Error messages — allowlisted `oneLine`+`collapse`

- `bin/agent-memory.mjs:119-130` — `oneLine(value,max=400)` collapses `\s+` → `" "`, trims, truncates with `…` (CWE-117); `collapse(value)` maps `$HOME` → `~` — the sole renderer for every variable string per runbook §4b.
- Every `err()` / `reportRefusal()` site composes those two: `reportRefusal` at `bin/agent-memory.mjs:709-712` does `err("REFUSE — "+oneLine(detail,300))` + `neverKillHint()`; `usageError` at `bin/agent-memory.mjs:195-200` does `err("usage: "+oneLine(detail,200))`; start path refusals at `bin/agent-memory.mjs:728-757` use `collapse(data.path)` + `oneLine(error?.code,60)`; catch-all at `bin/agent-memory.mjs:1372-1376` does `collapse(oneLine(error.message,200))` + conditional `VERDICT: doctor-check-failed`.
- Child output is captured-and-dropped, never replayed: `runHelix` at `bin/agent-memory.mjs:640-656` uses `spawnSync` `stdio: ["ignore","pipe","pipe"]` and returns only `{found,code}`; readiness help at `bin/agent-memory.mjs:956` does `HINT: server log ~-collapsed (read it yourself; never replayed here)`.
- `scripts/verify-ops.ts:28` `brief()` mirrors the same collapse+truncate for harness assertions; no test bypasses the allowlist.
- No raw `Error` stack, no env dump, no `JSON.stringify(process.env)` in any output path — grep for `process.env` in `bin/agent-memory.mjs` shows reads only at `resolveDataDir:275`, `resolveOnPath:604`, `helixEnv:631` (strip), `serverEnv:886` (derive), `status:1157` (presence flag) — never interpolated into `out()`/`err()`.

## 4. No secret / PII in outputs

- `AGENT_MEMORY_SECRET` is read as presence only: `bin/agent-memory.mjs:1157` `bearer: ${nonEmpty(secret)?"armed":"unset"}` (status), `bin/agent-memory.mjs:1288-1289` `secret: present|missing` (doctor C4) — value never assigned to an output variable.
- `helixEnv()` at `bin/agent-memory.mjs:627-635` strips `AGENT_MEMORY_SECRET` from every `helix` child (`runHelix` at `bin/agent-memory.mjs:647` uses it); the only spawn that inherits the secret is `npx tsx src/server.ts` via `serverEnv` at `bin/agent-memory.mjs:885-909` (intended — the server is the guard).
- `doctor` C2 bearer construction at `bin/agent-memory.mjs:1267` lives strictly inside the `if (restOwned)` branch (`bin/agent-memory.mjs:1260-1284`); foreign/unverified listeners emit `INFO skipped (NO request sent, no bearer transmitted)` and never construct a header — header proof in `scripts/verify-ops.ts:265-287` asserts `authHeaders.length===0` on a synthetic foreign listener.
- Paths are always `collapse()`-ed (`~`-collapsed) before print: `statePathOf`/`data.path`/`logPath`/`backupDir` all go through `collapse()` (e.g. `bin/agent-memory.mjs:729`, `774`, `782-783`, `903`, `956`, `983-984`, `1004`, `1099`, `1316-1318`).
- No memory content, prompt text, or canary appears in outputs: `scripts/verify-ops.ts:250-254` §K asserts canary `canary-verify-ops-<uuid>` 0 occurrences in `doctor`/`status`/`migrate`; `TEST_MATRIX.md` bar #2 K green.
- State file `bin/agent-memory.mjs:356-364` writes `JSON.stringify({slot,pids,helixInstance,dataDir,startedAt,cliVersion})` with `mode 0o600` in `0700` dir — no secret field, verified by `scripts/verify-ops.ts:193-196` (no `secret` field, `!includes(TEST_SECRET)`).

## 5. README table readability

`README.md:601-784` ops section — inspected rendered:

- Slot derivation table `README.md:615-620` — 6 columns (`Slot | REST R(N) | Helix H(N) | Reserved R+1 | Reserved R+2 | instance name`), backticked formulas/ports, slot-1 row shows `3111 (default parity, untouched)` + `6969` + `3112/3113` + `dev`; N row shows generic `3111+3(N-1)` / `6969+(N-1)` / `R(N)+1` / `R(N)+2` / `slotN` — aligns with `SPEC-P4-OPS.md:224-231` and `bin/agent-memory.mjs:174-177`.
- CLI usage block `README.md:632-638` — indented bash fences, one subcommand per line, `doctor` second-line continuation indented under `--slot`, identical to `USAGE`.
- Exit-code matrix `README.md:646-651` — 6-column `| Subcommand | 0 | 1 | 2 | 3 | 4 | 5 |` with `doctor` row spelling `3 upstream-holds-port · 4 helix-down · 5 secret-missing` and precedence note `(5 > 4 > 3 > 1 > 0)` below — matches `bin/agent-memory.mjs:182-184` verbatim.
- Data-dir layout `README.md:683-686` — code fence tree `~/.local/share/agent-memory/<slot>/` + `state/slot-<N>.json` with comment `never inside HELIX_DATA_DIR` — sibling relationship visible.
- Backup declaration `README.md:717-726` — 2-column `Field | Value` table (`Purpose | DR of memory data`, `Storage location | <target>.backup-<UTC-timestamp> under --backup-dir (~-collapsed)`, `TTL / expiry | Deleted after verified migration + operator confirmation`, `Deletion procedure | rm -rf <backup-path>`, `Content handling | 0600/0700, never printed`) — satisfies `REQ-P4-OPS-09` Ley 172-13 declaration.
- No wrapping violation: all tables use `|---|` separator and terminate with blank line; no column requires horizontal scroll on GitHub at 1200 px.

## Findings

| ID | Severity | Location | Finding | Evidence | Owner |
|----|----------|----------|---------|----------|-------|
| **RD-P4-001** | Low | `bin/agent-memory.mjs:842-844` | Dead no-op branch with self-contradictory condition `raw.includes(slotHeader) && !raw.includes(`${slotHeader}`)` — the template literal equals `slotHeader`, so the conjunction is always false; block is `/* no-op — real check below */` kept `to keep raw in scope`. It preserves `raw` but as a confusing tautological `if` that the next maintainer will re-read as a bug. | `bin/agent-memory.mjs:840-861` — `raw` read at line 841, immediate contradictory `if` at 842, then `text` re-read at 846; `git diff --stat src/ db/` empty confirms it is not protecting a `src/` edit | R1 `general(vasquez)` — backlog hygiene |
| **RD-P4-002** | Low | `bin/agent-memory.mjs:786-822` (`cmdStart` pre-flight loop) | Nesting depth 4 in the quartet-occupancy loop: `for (role of quartet)` → `if (!probe.free)` → `if (kind==="helix" && binding.registered)` → `if (health===200)` → `continue`; the `≤3` guardrail is exceeded by one level, isolated to this single loop (the only depth-4 site in `bin/agent-memory.mjs`). Readability impact is local — the three branches map one-to-one to `NEVER_BIND` / helix-owned / foreign — but it trips the checklist's shallow-nesting expectation. | Count: `for(1)→if(2)→if(3)→if(4)` at lines 791/804/805/807; all other functions in `bin/agent-memory.mjs` (e.g. `parseArgs` max depth 3 at `bin/agent-memory.mjs:221-256`, `cmdDoctor` emits sequential not nested) stay ≤3; prior lanes (P1-P21 RD-005) cleared the same single-site depth-4 as Low | R1 — backlog; no functional change suggested |
| **RD-P4-003** | Low | `bin/agent-memory.mjs:102-113` `derive()` return `{r1,r2}` | Terse reserved-port names `r1`/`r2`. Meaning is defined once in the JSDoc and in `USAGE` (`reserved R+1 / R+2`), and every call site (e.g. `bin/agent-memory.mjs:788-822`, `README.md:615`) labels them `reserved`, but a lone `r1`/`r2` outside that context would not self-explain; `reserved1`/`reserved2` would be grep-friendlier (same nit as `P1-P21 RD-007` `MAX_CONCEPTS` collision — naming hygiene, not gate-blocking). | `bin/agent-memory.mjs:108-109` `r1: rest+1, r2: rest+2` vs `scripts/verify-ops.ts:75` `derive` returns `r1,r2` identically — short names propagated to harness for test parity; `README.md:625` invariant sentence spells out `reserved ports reserve address space only` mitigating the terseness | R1 — optional rename; no gate impact |

No Medium/High/Critical findings. The 4 earlier checklist lenses (single-responsibility, WHY comments, public-API docs, style) hold without observation — see Evidence below.

## Evidence

- **Naming (lens):** domain-revealing identifiers throughout: `REST_BASE`/`HELIX_BASE`/`NEVER_BIND`/`SYSTEM_ROOTS` (`bin/agent-memory.mjs:65-100`), `derive`/`oneLine`/`collapse`/`neverKillHint`/`usageError`/`parseArgs`/`resolveDataDir`/`stateDirOf`/`statePathOf`/`ensureDir0700`/`readState`/`isValidState`/`writeState`/`appendAudit`/`verifyOwnedPid`/`signalOwned`/`waitUntilDead`/`probePort`/`httpStatus`/`statusToken`/`resolveNpx`/`resolveHelix`/`helixEnv`/`runHelix`/`localInstances`/`instanceBinding`/`reportRefusal`/`cmdStart`/`cmdStop`/`cmdStatus`/`cmdDoctor` (`bin/agent-memory.mjs:102-1378`), `SLOT_FOREIGN`/`TEST_SECRET`/`TEST_CANARY`/`spawnCapture`/`runCli`/`defaultDataDir`/`defaultStatePath`/`sectionA..L`/`sectionHeaderProof` (`scripts/verify-ops.ts:21-287`). Repo-wide grep for bare `data`/`tmp`/`x` as domain names → no hits outside the literal `dataDir` domain term and `os.tmpdir()` at `scripts/verify-ops.ts:178`. Short harness names (`s` in `spawnCapture` closure, `r` in `sleep`) are scoped lambda params, not domain names — documented in prior `docs/specs/50_archive/P1R-P32/readability.md` as acceptable.

- **Single responsibility:** every new function does one job: `derive` = pure port math; `oneLine` = collapse+truncate; `collapse` = `$HOME→~`; `out`/`err` = single `writeSync`; `neverKillHint` = static string; `usageError` = message+usage+exit; `parseArgs` = fail-closed argv parse (exit 2 gates at `bin/agent-memory.mjs:251-253`); `resolveDataDir` = precedence + refusal set; `ensureDir0700` = `mkdir 0700`+`chmod`; `readState`/`isValidState`/`writeState` = closed-schema validate/read/write; `appendAudit` = one allowlisted line to `state/audit.log`; `verifyOwnedPid` = single shared identity check (alive + `src/server.ts` in cmdline + `cwd===ROOT`); `probePort` = one port probe; `runHelix` = one `spawnSync` + code-only return. Command drivers `cmdStart`/`cmdStop`/`cmdStatus`/`cmdDoctor` are linear orchestrators that delegate to those helpers — same procedural convention as pre-existing `scripts/verify.ts`.

- **Nesting depth ≤3:** worst case measured at depth 4 in exactly one loop (`cmdStart` lines 791/804/805/807 per RD-P4-002); all other sites ≤3: `parseArgs` `while(1)→if(2)→if(3)` at `bin/agent-memory.mjs:221-248`, `cmdDoctor` emits sequential `if(c1ok)` / `if(restProbe.free)` / `for(reserved)` at `bin/agent-memory.mjs:1189-1257`, `isValidState` at `bin/agent-memory.mjs:337-354` is a flat guard chain (`if(typeof… ) return false` ×6). Depth-4 is the single exception, not the norm.

- **Comments = WHY:** every section banner ties code to spec/HARD rule: file header `bin/agent-memory.mjs:2-37` enumerates the three HARD rules (Never-kill INV-003, Secret hygiene INV-004, Defaults untouched INV-005) + Probe A3 FAIL narrative with packet reference; `Allowlist rendering (security C7 / S-013, runbook §4b)` at line 116 explains `oneLine`'s `CWE-117` bound; `Fail-closed argument parsing (REQ-P4-OPS-01, §4.1; src/server.ts:479)` at 161 explains the exit-2 contract; `Path refusal set (security C4/S-004): refuse /, system roots and $HOME itself` at 269; `State file: closed schema + permissions (security C3 / S-012)` at 323; `Governance audit line (security C6 / S-006)` at 367; `Process identity (shared verifyOwnedPid — security C3, C10)` at 395 with block doc `The single identity check shared by stop (pre-SIGTERM and again pre-SIGKILL) and by doctor C3`; `HTTP probes (read-only; the ONLY Authorization header in this CLI lives in doctor C2 …)` at 573; `Child spawning: absolute resolution + env minimization (security C8)` at 593. No comment merely restates the next line.

- **Public APIs documented:** `derive` JSDoc at `bin/agent-memory.mjs:102`, `resolveDataDir` JSDoc at `bin/agent-memory.mjs:269-273` with `@returns {{path,explicit,reason,origin}}`, `isValidState` closed-schema predicate at `bin/agent-memory.mjs:337-354` with sort-joined key check, `cmdStart`/`cmdStop`/`cmdStatus`/`cmdDoctor` each carry a block doc stating the REQ it satisfies + HARD-rule citation + exit contract (e.g. `cmdDoctor` at `bin/agent-memory.mjs:1162-1172` lists execution order `C1→C3→C2→C4→C5` and `precedence 5>4>3>1>0`); `USAGE` at `bin/agent-memory.mjs:164-184` is itself the user-facing contract doc; `scripts/verify-ops.ts:1-10` header documents sections A..L + C1 proof + port guard.

- **No dead code / commented-out blocks:** repo-wide grep for commented-out statements (`// const|let|return|if|function|await|import`) across `bin/`+`scripts/` matches only the intentional no-op at `bin/agent-memory.mjs:843` (RD-P4-001) and the comment `never a signal, never a bind on kept ports` at `bin/agent-memory.mjs:481` — no commented-out logic; grep for `TODO`/`@ts-ignore`/`FIXME`/`HACK` → zero hits in `bin/agent-memory.mjs` and `scripts/verify-ops.ts`; `npm run typecheck` exit 0 per `TEST_MATRIX.md` bar #1 (`bin` is `.mjs` outside the TS program, correctly excluded).

- **Consistent style:** new files reuse the repo's `/* --- */` banner sections and the `check`/`brief`/`race` assertion plumbing verbatim from `scripts/verify-env.ts` (acknowledged at `scripts/verify-ops.ts:1-9` header `House style of verify-env.ts`); `bin/agent-memory.mjs` mirrors `src/server.ts:479-481` fail-closed parse shape and `src/errors.ts` `oneLine` renderer; `README.md` ops section (601–784) uses the same markdown table/bold/tilde-collapse conventions as the existing `README.md:401-560` Known-limitations + auth sections; `PROPOSED_CHANGES.md` carries the lane's `SPEC/HARD/GATE/DOMAINS` packet reference-only line matching the template in `docs/specs/50_archive/P1R-P32/readability.md:5`.

## Verdict Rationale

**PASS.** All seven checklist items hold across the ~1.7 k added lines: names reveal intent (only `r1`/`r2` is terse and it is defined once in `derive()` with `reserved` labelling everywhere it is consumed — RD-P4-003 Low), every function is cohesive with worst-case nesting of 4 in a single isolated loop (RD-P4-002 Low) and ≤3 elsewhere, comments consistently explain contract/fail-closed/determinism WHYs rather than restating code, all new surfaces (CLI `USAGE`, `derive`, `resolveDataDir`, `isValidState`, `verifyOwnedPid`, `probePort`, `runHelix`, `cmd*` drivers) are documented with JSDoc or banner traces, the diff introduced zero dead or commented-out code except one intentional no-op guard (RD-P4-001 Low) and zero `any`/`@ts-ignore`/`TODO` (typecheck exit 0), and style matches the surrounding codebase (banner sections, assertion plumbing, slot derivation, never-kill wording class `src/server.ts:514-522`).

The five packet checks all pass as standalone: CLI help is intention-revealing and symmetrical with README; slot-math derivation is pure, tested, and traceable to spec §4.2; every error path is `oneLine`+`collapse` with child output dropped; no subcommand prints a secret value, env value, memory content, or raw PII; README tables render cleanly and carry the correct port/parity invariants.

Candidates examined and rejected as noise: `ONE`-vs-`many` slot naming (`slotN` vs `dev` — required by `helix add local` registration, not a drift), `USAGE` second-line indentation under `doctor --slot` (aligned for terminal width, readable), and `OUT`/`ERR` uppercase helpers (they wrap `writeSync` and never throw — name matches prior `verify-ops` plumbing). No finding without evidence was raised; verdict is ✅ **PASS** with 3 Low hygiene observations for the backlog.

## Sign-off

- [x] **readability reviewer (engineering, R1):** PASS with 3 Low observations (RD-P4-001..003) for backlog; no Medium/High, no gate-blocking condition. No implementation file was touched — edits limited to this artifact (`docs/specs/40_workspace/quality-gate/P4-OPS/readability.md`) as mandated. A3-FAIL abort path and `~`-collapse rendering were verified by code read + harness grep, not by re-running Helix-port probes that would collide with the live slot-2 window.
