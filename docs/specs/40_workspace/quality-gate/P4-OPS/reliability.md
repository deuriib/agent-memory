# Reliability Review: SPEC-P4-OPS — P4 ops control plane

**Reviewer:** reliability-reviewer (engineering, R1 — failure modes / retries / timeouts / durability)
**Date:** 2026-09-24
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#NFR-D / HARD:subagents+<zero new deps, frozen src/db, never kill upstream, default 3111 untouched> / GATE:implementation done / DOMAINS:R1`
**Inputs read:** `bin/agent-memory.mjs` (1,378 lines — full read, readiness gate, waitUntilDead, helix start error handling, typecheck boundary), `IMPLEMENTATION_PLAN.md` Step 0 A3 FAIL + Steps 2/6 + Rollback Points, `TEST_MATRIX.md` ## P4 OPS + per-command bar #1-10 + ## Gate-remediation bar, `scripts/verify-ops.ts` (§G durability + §B/C live window), `helix.toml`, `package.json`
**Verdict:** **PASS** — all bounded-timeout and durability invariants landed as code and evidenced; zero Critical/High open. No index drift. A3 revert is complete.

## Checklist (per `frame-ship/skills/quality-gate/references/engineering/reliability-review.md`)

- [x] **Error paths handled explicitly** — fail-closed on every storage and helix path (see FM-004/FM-006)
- [x] **No swallowed exceptions** — catches re-render via `oneLine`+`collapse` or propagate to `REFUSE`/`FAIL internal`; child text dropped, never raw
- [x] **Input validation at boundaries** — `--slot` fail-closed, `isValidState` closed schema, path refusal set, `helix.toml` table-scoped parse
- [x] **Deterministic behavior (no hidden state)** — `derive(slot)` pure, `READINESS_MS`/`TERM_GRACE_MS`/`KILL_WAIT_MS` named constants, no hidden retry state
- [x] **Edge cases tested (empty, null, max, boundary)** — invalid slot 0/abc, out-of-range port >65535, non-empty foreign data-dir, missing state, stale pid, invalid state
- [x] **Idempotency where required** — `start` already-running exit 0, `stop` not-running exit 0, repeat stop exit 0
- [x] **Timeouts on external calls** — every I/O bounded (readiness 30 s, TERM_GRACE 5 s, KILL_WAIT 3 s, http probes 2–3 s, helix spawn 60–90 s, waitUntilDead 100 ms poll)

Packet checks (all PASS):

- [x] **Readiness 30 s bounded** — `bin/agent-memory.mjs:67` + `:922-935`
- [x] **TERM_GRACE 5 s + KILL_WAIT 3 s** — `bin/agent-memory.mjs:68-69` + `:1057`/`:1067`
- [x] **No unbounded retry** — both poll loops carry a deadline/timeout
- [x] **Fail-closed on storage** — `bin/agent-memory.mjs:974-979` + `:767-784` + `:1009-1039`
- [x] **A3 revert** — probe A3 FAIL before code, `HELIX_DATA_DIR` never set (`:892`), `--migrate` abort-only (`:1308-1325`), zero residue
- [x] **Verify 243 green** — `TEST_MATRIX.md:129` bar #7 `243 passed, 0 failed` on `3151`
- [x] **No index drift** — bootstrap `OK (8 indexes ensured)` before remember (`TEST_MATRIX.md:132`), `helix.toml` additive only

## Bounded Timeouts — Code Citations

| Invariant | Constant | Call site | Evidence |
|-----------|----------|-----------|----------|
| **Readiness 30 s** | `bin/agent-memory.mjs:67` `READINESS_MS = 30_000` | `bin/agent-memory.mjs:925` `deadline = Date.now()+READINESS_MS` → `bin/agent-memory.mjs:928-935` `while(Date.now()<deadline){ httpStatus(helix)+httpStatus(livez) Promise.all 2s timeout; sleep 250; break on 200/200 }` → `:938` `ready = helix 200 && livez 200` else rollback | `scripts/verify-ops.ts` §B + live bar `TEST_MATRIX.md:132` `ready 200/200` on slot2:3114/6970 |
| **TERM_GRACE 5 s** | `bin/agent-memory.mjs:68` `TERM_GRACE_MS = 5_000` | `bin/agent-memory.mjs:1057` `waitUntilDead(pid, TERM_GRACE_MS)` after `SIGTERM` (`:1056`) | `bin/agent-memory.mjs:1058-1063` then C10 re-verify before `SIGKILL` |
| **KILL_WAIT 3 s** | `bin/agent-memory.mjs:69` `KILL_WAIT_MS = 3_000` | `bin/agent-memory.mjs:1067` `waitUntilDead(pid, KILL_WAIT_MS)` after `SIGKILL` (`:1066`) | `TEST_MATRIX.md:132` live `stop --slot 2` completes, idempotent second stop 0 |
| **httpStatus probes 2–3 s** | inline per call | `bin/agent-memory.mjs:928-932` readiness `2_000`, `bin/agent-memory.mjs:1140-1144` status `2_500`, `bin/agent-memory.mjs:1189-1193` doctor C1 `3_000`, `bin/agent-memory.mjs:581-588` `AbortSignal.timeout(timeoutMs)` with `httpStatus` `catch → -1` | `scripts/verify-ops.ts` headerProof synthetic server on 3135 receives 0 auth headers — probes bounded |
| **helix spawn 60–90 s** | `bin/agent-memory.mjs:641` `timeoutMs=90_000` default, `bin/agent-memory.mjs:1078` `60_000` for stop | `bin/agent-memory.mjs:644-646` `spawnSync(helix, args, {timeout:timeoutMs})` then `{found,code}` only | `TEST_MATRIX.md:132` `helix: started slot2 on 6970` / `helix: stop slot2 (exit 0)` |
| **waitUntilDead poll** | `bin/agent-memory.mjs:471-478` | `bin/agent-memory.mjs:472` `deadline=Date.now()+timeoutMs` → `while(Date.now()<deadline){ !pidAlive→true; await sleep(100) }` → `return !pidAlive(pid)` | Used at `:944-948` (readiness rollback 2 s), `:957-958` (state-write fail 3 s), `:1057`/`:1067` (stop 5 s/3 s) |

No unbounded loop exists: both `while` sites carry a `deadline` or `timeoutMs`; `sleep` is `100 ms` or `250 ms` bounded; no `while(true)` without exit.

## Helix Start Error Handling

| Path | Code | Behavior |
|------|------|----------|
| helix CLI not found | `bin/agent-memory.mjs:827-831` + `:866-869` | `resolveHelix()===undefined` → `REFUSE helix CLI not found on PATH` exit 1, nothing started |
| `helix add local` fails (slot N≥2 registration) | `bin/agent-memory.mjs:827-836` | non-zero `added.code` → `REFUSE helix: add slotN (exit N)` exit 1, hint `helix add local --name slotN --port H(N)` manually |
| `helix start <instance>` fails | `bin/agent-memory.mjs:865-876` | non-zero `started.code` → `REFUSE helix: start slotN (exit N)` + hint `helix status slotN` exit 1 |
| child text | `bin/agent-memory.mjs:640-656` `runHelix` | `spawnSync stdio pipe` + `found/code` only — child stdout/stderr captured and dropped (security C7), never replayed |
| pre-flight foreign occupant | `bin/agent-memory.mjs:790-822` | `probePort` quartet; any foreign (including helix non-200) → `REFUSE … held by pid (not slot-owned, never signaled)` + `neverKillHint()` exit 1, no signal |

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? | Evidence |
|----|--------------|-------------------|----------|----------|
| FM-001 | Helix `dev` on 6969 down during `start` readiness | poll helix `/healthz` + rest `/memory/livez` every 250 ms until 30 s deadline; if not `200/200` → rollback only our child (SIGTERM 2 s then SIGKILL if descendant) + `REFUSE readiness failed helix=… rest=… server-exit=` exit 1 | **yes** | `bin/agent-memory.mjs:922-958` deadline+poll+rollback; `TEST_MATRIX.md:132` `ready 200/200` green on slot2 |
| FM-002 | REST never binds (child crash before listen) | `childExit !== null` breaks readiness loop (`:929`); `ready=false` → rollback probe + `server-exit` in REFUSE detail (`:952-955`) | **yes** | `bin/agent-memory.mjs:928-955` `child.once exit` + `childExit` in detail |
| FM-003 | Child stays alive but port hijacked after bind | readiness rollback verifies `isDescendant(listenerPid, child.pid)` before TERM (`:942`), then `pidAlive(child.pid)` before TERM (`:947`) | **yes** | `bin/agent-memory.mjs:940-951` descendant check |
| FM-004 | State file not writable after readiness (disk full / permission) | SIGTERM tracked `restPid` then `waitUntilDead 3 s` then `REFUSE state file not writable ~-collapsed` exit 1 — no orphan server left serving without state | **yes** — fail-closed on storage | `bin/agent-memory.mjs:974-979` `catch → signalOwned+waitUntilDead+reportRefusal return 1` |
| FM-005 | State file invalid (forged / partial write) | `readState` → `invalid` → `REFUSE start/stop — state file invalid (fail-closed, no signal)` exit 1; `stop` appends audit `refuse-state-invalid` | **yes** | `bin/agent-memory.mjs:767-769` start invalid→REFUSE; `:1016-1020` stop invalid→REFUSE+audit |
| FM-006 | `--data-dir` is `/` / system root / `$HOME` itself / outside `$HOME && /tmp` | `resolveDataDir` returns `reason` → `REFUSE … path refused (system root|home itself|outside… ) — allowed roots are $HOME/** and /tmp/**` exit 1 | **yes** — fail-closed on storage path | `bin/agent-memory.mjs:274-288` refusal set; `:727-732` start checks `data.reason` |
| FM-007 | `--data-dir` exists and is non-empty foreign dir | refuse `never adopting a foreign directory` exit 1 | **yes** | `bin/agent-memory.mjs:750-757` `readdir` non-empty → REFUSE |
| FM-008 | `--data-dir` explicit but not a directory | refuse `is not a directory` exit 1 | **yes** | `bin/agent-memory.mjs:740-744` `!stat.isDirectory()` → REFUSE |
| FM-009 | `stop` PID reuse / stale pid between check and signal | `verifyOwnedPid` before SIGTERM (`:1049`); C10 re-verify `verifyOwnedPid` again immediately before SIGKILL (`:1060`) — mismatch → `stale-pid … SIGKILL skipped` audit+exit 1 | **yes** (narrowed to ms) | `bin/agent-memory.mjs:1049-1063` dual verify; `security-reviewer.md` residual #1 |
| FM-010 | `stop` against wrong instance (state `helixInstance` ≠ derived) | fail-closed `REFUSE stop — state instance "…" does not match derived "…" (fail-closed, no signal)` audit `refuse-instance-mismatch` exit 1; unregistered `[local.slotN]` → `refuse-instance-unregistered` | **yes** | `bin/agent-memory.mjs:1026-1039` `instanceBinding(slot)` re-derive |
| FM-011 | Helix `stop slotN` still healthy after exit 0 / non-zero | if `stopped.code!==0` and `httpStatus(helix/healthz 2s)===200` → `own-process failed to die helix instance=slot2 still healthy` exitCode 1; else `helix: stop slot2 (exit N; instance not serving)` | **yes** | `bin/agent-memory.mjs:1084-1094` health re-probe |
| FM-012 | `helix start` forwarded `HELIX_DATA_DIR` unsupported (A3) | probe A3 FAIL before code; `HELIX_DATA_DIR` never set (`serverEnv` comment `:892`); any `--migrate` → `MIGRATE ABORT: unsupported-runtime — probe A3 failed … framing 3b decision pending orchestrator` + `MinIO volume retained`, `checkFailed=true` → doctor 1; `--apply` appends audit | **yes** — fail-closed abort, zero writes | `IMPLEMENTATION_PLAN.md:24-44` Step 0 table 0 hits + docker inspect + skill docs; `bin/agent-memory.mjs:25-37` header narrative; `:1308-1325` abort first-branch; `TEST_MATRIX.md:109` partial DONE* |
| FM-013 | Parallel lane collision on `dev` 6969 / 3111 | slot2 window `3114/3115/3116/6970` instance `slot2` exclusive, `dev` 3111/6969 read-only probes only; `verify` on `3151` never 3111 | **yes** | `IMPLEMENTATION_PLAN.md:54` ports `3114/6970` vs `dev` read-only; `TEST_MATRIX.md:119` bar header; `bin/agent-memory.mjs:787-811` helix `already serving` path |
| FM-014 | Index drift (new index added by P4 lane) | P4 lane adds no `db/**`; `helix.toml` change limited to `[local.slot2] storage="disk"` additive; bootstrap `OK (8 indexes ensured)` before remember | **yes — no drift** | `git diff --stat src/ db/ hooks/ plugins/` empty (`TEST_MATRIX.md:130` bar #8); `helix.toml:12-16` additive only; `TEST_MATRIX.md:132` `bootstrap 6970 OK (8 indexes ensured)` |
| FM-015 | Harness / test-code hang | `waitUntilDead` 100 ms poll with timeout, readiness `sleep 250`, `httpStatus AbortSignal.timeout 2-3 s`, `spawnSync 60-90 s` — no unbounded await; children reaped via `finally` in harness house style | **yes** | `bin/agent-memory.mjs:577-588` `AbortSignal.timeout`; `:641` `timeout`; `:471-478` bounded poll |

## Durability — NFR-D (data written survives restart)

| Claim (SPEC NFR-D via packet) | Landed code | Evidence |
|-------------------------------|-------------|----------|
| Save → `helix restart <instance>` → search | Helix instance uses `storage="disk"` (`helix.toml:12-16` patched if missing at `bin/agent-memory.mjs:838-862`); durability is Helix disk mode + explicit data-dir sibling state path | `scripts/verify-ops.ts` §G + `TEST_MATRIX.md:109-110` `T-P4OPS-07/08 DONE* partial — state-path precedence + state secret-free proven; HELIX_DATA_DIR forwarding not claimed (A3 FAIL)` — harness §G proves state-path durability (remember→search survives state-path), HELIX_DATA_DIR restart not claimed while A3 FAIL (fail-closed abort) |
| Save → `stop --slot N` → `start --slot N` → search | `cmdStart` writes `state/slot-N.json 0600` in `0700` dir (`:356-364`), reads it on `stop` (`:1009`), removes on `stop` (`:1098`), re-creates on `start`; idempotent `already running` (`:771-775`) and `not running` (`:1011-1014`) prevent orphan | `TEST_MATRIX.md:132` live `remember→search 1 result bm25 score 0.86 signals:[]` on 3114 then `stop exit 0 + second stop exit 0 idempotent`; `scripts/verify-ops.ts` §G `state …/slot-N.json 0600 0700 secret-free` |
| State file never inside HELIX_DATA_DIR | `bin/agent-memory.mjs:294-301` `stateDirOf(dataDir)=dirname(dataDir)/state` — sibling, never child; `statePathOf` `:299-301` | `scripts/verify-ops.ts:177-201` §G `state path sibling outside HELIX_DATA_DIR` |
| MinIO volume never destroyed | no `prune`/`delete`/`volume rm`/`docker rm|kill`/`--persist` primitive in source | `scripts/verify-ops.ts:217-232` §I static grep 0 + live foreign survives; `bin/agent-memory.mjs:1320-1322` `HINT: MinIO volume retained` |

A3 FAIL carves out P4.4 HELIX_DATA_DIR forwarding/migration from NFR-D: `HELIX_DATA_DIR` is deliberately absent (`:892` comment), `doctor --migrate` aborts fail-closed (`:1308-1325`) with zero writes — no data moved, no volume created, reversible by construction (`IMPLEMENTATION_PLAN.md:81-82`). Framing 3b pending orchestrator.

## Typecheck + Suites + No Index Drift

| Check | Spec | Result | Evidence |
|-------|------|--------|----------|
| `npm run typecheck` | HARD | **0 errors** — `bin/agent-memory.mjs` is `.mjs` outside TS program | `TEST_MATRIX.md:123` bar #1 `exit 0 (0 errors) — bin .mjs outside TS program` |
| `npx tsx scripts/verify-ops.ts` | REQ-01..08 | **99 passed, 0 failed** / VERIFY PASS | `TEST_MATRIX.md:124` bar #2 |
| `npm run verify-env` | NFR-C port guard | **21 passed** | `TEST_MATRIX.md:125` bar #3 |
| `npm run verify-lifecycle` | lifecycle goldens | **123 passed** (117 prior +6) | `TEST_MATRIX.md:126` bar #4 |
| `npm run verify-capture` | capture | **137 passed** | `TEST_MATRIX.md:127` bar #5 |
| `npm run verify-skills -- --structural` | structural | **73 passed** | `TEST_MATRIX.md:128` bar #6 |
| `npm run verify` | RL001-F01 + P4 | **243 passed, 0 failed** on `3151` never 3111 | `TEST_MATRIX.md:129` bar #7 |
| `git diff --stat src/ db/ hooks/ plugins/` | frozen | **empty (0 files)** | `TEST_MATRIX.md:130` bar #8 |
| `git diff package-lock.json` | zero new deps | **empty (0 lines)** | `TEST_MATRIX.md:131` bar #9 |
| `bootstrap 6970` indexes | no drift | **OK (8 indexes ensured)** before remember on slot2 | `TEST_MATRIX.md:132` live window |
| `helix.toml` drift | NFR-D | **`[local.dev] port 6969 storage="disk" tag v0.0.6` frozen**; `[local.slot2] port 6970 storage="disk"` additive only | `helix.toml:6-16` |

All seven suites green with counts pasted verbatim; no suite weakened, no CI gate weakened (`automation-reviewer.md` §4 `ci.yml` diff empty).

## A3 Revert

| Item | Evidence | Result |
|------|----------|--------|
| Probe A3 FAIL before code | `IMPLEMENTATION_PLAN.md:24-44` — CLI 3.3.0 binary 0 hits `HELIX_DATA_DIR`, `helix start --help` no `--data-dir`, `docker inspect helix-agent-memory-dev` env no `HELIX_DATA_DIR` / `Mounts: []` / only MinIO volume, skill `SKILL.md:29-32` direct-Docker mode; Verdict **A3 FAILS** | **PASS** — falsifiable probe recorded, reversible call framing 3b escalated |
| `HELIX_DATA_DIR` never set | `bin/agent-memory.mjs:892` `// HELIX_DATA_DIR deliberately absent — probe A3 failed` | **PASS** — `serverEnv` (`:885-893`) forwards only `AGENT_MEMORY_DATA_DIR` as state-path input |
| `--migrate` abort-only | `bin/agent-memory.mjs:1308-1325` — first branch on `flags.migrate` → `checkFailed=true`, `reason=unsupported-runtime — probe A3 failed…`, `MIGRATE ABORT: …` + `HINT: no source was read, no backup was written, no target was touched; MinIO volume retained`; `--backup-dir` validated `SYSTEM_ROOTS`/outside `$HOME && /tmp`/parent missing → `path-refused` | **PASS** — zero writes before abort, `--backup-dir` path-refused before any write |
| Zero residue | No data moved, no volume created, `HELIX_DATA_DIR` unset, migration path stopped | `IMPLEMENTATION_PLAN.md:81-82` `A3/deferred scope: no data is moved, no volume is created` |
| Config/code revert immediate | Delete `bin/agent-memory.mjs` + `scripts/verify-ops.ts`, revert two `package.json` rows, `git checkout -- helix.toml` removes `[local.slot2]` | `IMPLEMENTATION_PLAN.md:71-77` Rollback Points — ETA immediate, `post-revert proof = typecheck + five suites` |
| P4.4 rows honest DONE* | `TEST_MATRIX.md:109-110` T-P4OPS-07/08 + `115` T-P4OPS-13 `DONE* partial — abort path proven; no data moved per A3` + `*Notes:` paragraph | **PASS** — not silent PASS, escalated to orchestrator |

## Findings

| ID | Severity | Finding | Location | Evidence | Owner |
|----|----------|---------|----------|----------|-------|
| — | — | **No Medium/High/Critical.** All bounded-timeout, durability, and no-unbounded-retry invariants land as code with the line citations above and are evidenced by the 99/0 `verify-ops` bar + 243 `verify` bar + live slot2 window. | §§ Bounded Timeouts / Failure Modes / Durability | cited | — |
| REL-OBS-01 | Low (observation) | Readiness rollback grace is `2 s` (`:944` `waitUntilDead … 2_000`) not the `TERM_GRACE 5 s / KILL_WAIT 3 s` used by `stop` — narrower than the dedicated stop grace but still bounded and descendant-gated. Not a defect (rollback kills only the just-spawned child, not a tracked PID), but the grace differs between paths. | `bin/agent-memory.mjs:940-951` readiness rollback | `bin/agent-memory.mjs:68-69` vs `:944` | R1 `general(vasquez)` — backlog if uniform grace desired |
| REL-OBS-02 | Low (accepted residual) | PID-reuse TOCTOU between `verifyOwnedPid` and `SIGTERM` — narrowed to ms by cmdline re-verification and by C10 re-verify before `SIGKILL` (`:1060-1063`); window not eliminable without `pidfd`/`start-time` pinning. Blast radius local single-user. | `bin/agent-memory.mjs:1049,1060-1063` `waitUntilDead` | `security-reviewer.md` #1 + `resilience.md` #1 | R1 — re-review if PID namespace changes |

No findings block the gate. Security C10 and PATH residuals are owned by `security-reviewer.md`; blast-radius/rollback is owned by `resilience.md`; QA traceability is owned by `quality-assurance.md`.

## Verdict Rationale

- **Readiness is provably bounded at 30 s** — `READINESS_MS=30_000` (`:67`) drives a `deadline` (`:925`) with `sleep 250` + `Promise.all(httpStatus 2 s)` polling (`:928-935`); non-ready → descendant-gated rollback (`:940-951`) + `REFUSE readiness failed` (`:955`) exit 1 — not a hung start, not an orphan.
- **Termination is bounded at 5 s + 3 s** — `TERM_GRACE_MS=5_000` (`:68`) and `KILL_WAIT_MS=3_000` (`:69`) are the sole arguments to `waitUntilDead` in `stop` (`:1057`/`:1067`), each `waitUntilDead` is `deadline=now+timeoutMs` + `sleep 100` polling (`:471-478`) — no unbounded `while`, no kill-by-port.
- **No unbounded retry exists** — both poll loops carry a timeout/deadline; `httpStatus` carries `AbortSignal.timeout`; `spawnSync` carries `timeout 60–90 s` (`:641`/`:1078`) and never retries — any helix or HTTP failure surfaces as a single `REFUSE` or `FAIL` with the `oneLine`+`collapse` renderer.
- **Fail-closed on storage holds** — invalid state → `REFUSE … invalid (fail-closed, no signal)` (`:767-769`/`:1016-1020`); non-writable state after readiness → `SIGTERM+wait 3 s` then `REFUSE state file not writable` (`:974-979`); path refusals (`:727-757`) and stale-pid/mismatch refusals (`:1049-1052`/`:1033-1039`) are all exit 1 with audit lines (`:1018`/`:1030`/`:1052`/`:1062`/`:1106`/`:1323`) and zero foreign signals.
- **A3 revert is complete** — probe A3 FAIL recorded before any code (`IMPLEMENTATION_PLAN.md:24-44`), `HELIX_DATA_DIR` never set (`:892`), any `--migrate` aborts fail-closed with `MIGRATE ABORT: unsupported-runtime` and `MinIO volume retained` as the first branch (`:1308-1325`), `--backup-dir` validated before any write (`:1312-1318`) — zero residue, framing 3b escalated, three P4.4 rows honestly `DONE* partial`.
- **243 green + no index drift** — `TEST_MATRIX.md:123-132` per-command bar pastes `typecheck 0` + `verify-ops 99` + `verify-env 21` + `verify-lifecycle 123` + `verify-capture 137` + `verify-skills 73` + `verify 243` on `3151` never 3111, `git diff src/ db/ … empty` + `package-lock.json empty` + `helix.toml` only `[local.slot2] storage="disk"` additive, `bootstrap 6970 OK (8 indexes ensured)` before remember — no suite weakened, no index added, port guard `NEVER_BIND=[3111,3112,3113,3151,6969]` intact.

## Sign-off

- [x] **reliability reviewer (engineering, R1):** **PASS**. Bounded timeouts (30 s readiness, 5 s TERM_GRACE + 3 s KILL_WAIT, no unbounded retry) landed at `bin/agent-memory.mjs:67-69,471-478,640-656,922-979,1049-1067`; fail-closed on storage (invalid/non-writable state, path refusal, stale-pid) exit 1 with no orphan and no foreign signal; helix start errors `REFUSE` fail-closed with child text dropped; A3 revert zero-residue with `--migrate` abort-only (`:1308-1325`) and `HELIX_DATA_DIR` never set (`:892`); `verify 243` green on `3151` with `typecheck 0` and no index drift (`bootstrap 8 indexes`, `git diff src/db empty`, `helix.toml` additive only). Residuals explicit with owner+expiry. This review touched only this file — no implementation file modified.
