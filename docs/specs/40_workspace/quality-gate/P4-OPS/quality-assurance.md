# Quality Assurance Review: P4 OPS control plane — SPEC-P4-OPS / SPEC-P4-OPS-RUNBOOK

**Reviewer:** quality-assurance (independent engineering-domain QA — REQ→test→artifact traceability, never approves without evidence)
**Date:** 2026-09-24
**Spec:** `docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` + `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md#REQ-OPS-RUN-01..15`
**Harness:** `scripts/verify-ops.ts` (§A–L + C1 header proof) + live slot-2 window (3114/6970, instance `slot2`, `dev` 6969 read-only)
**Packet:** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F / HARD:subagents+<zero new deps, frozen src/db, port guard 3111/3112/3113/3151/6969> / GATE:implementation done (bin+verify-ops+README+TEST_MATRIX) / DOMAINS:R1 engineering (QA lens)`
**Verdict:** ✅ PASS — with 3 explicit partial-by-design rows for P4.4 (A3 FAIL, framing 3b pending orchestrator); zero Critical/High, no silent PASS

Scope: lane `f8e29f1..974f5c4` (5 commits: `f8e29f1` bin, `bd65360` harness, `9212a70` plan/matrix, `8d6ae81` storage=disk patch, `974f5c4` README + live bar), lens = REQ-ID→test→artifact traceability for all 15 TEST_MATRIX rows `T-P4OPS-01..15`, AC assertion matching, published-count reconciliation, forbidden-primitive scan, A3 FAIL handling, commit-column audit. Review-only: no fixes anywhere except this file. Port guard 3111/3112/3113/3151/6969 verified never bound by harness. `helix dev` (6969) never restarted in harness — only live slot-2 window touches `slot2` (6970).

## Checklist (per `frame-ship/skills/quality-gate/references/engineering/quality-assurance.md` — recovered from archive shape)

- [x] **All acceptance criteria have tests** — 15/15 REQ/NFR rows mapped to a harness section (§A–L + header proof) or live window bar #10; 12/15 fully proven DONE, 3/15 DONE* partial by explicit A3-FAIL design (T-P4OPS-07/08/13 — HELIX_DATA_DIR forwarding unsupported, no data moved; §1.3).
- [x] **All REQ-IDs traceable to test IDs** — 15/15 rows exist in `TEST_MATRIX.md##P4 OPS` with Evidence ID `T-P4OPS-01..15`, Description, Type, Status, Commit; no orphan REQ, no orphan evidence (trace table §1).
- [x] **Unit + integration + e2e coverage as appropriate** — unit (derive goldens §F, stat mode checks §G, secret-leak pattern §J, canary §K), integration (probePort/header-proof synthetic server §E/C1, allowlist renderer), e2e (live slot-2 start→doctor→remember→search→stop, §B/C live window); typecheck outside TS program (bin `.mjs`) correctly excluded.
- [x] **Regression suite updated and green** — per-command bar (§2) pastes all 7 suite counts verbatim; no suite weakened or skipped; port-guard discipline preserved (NEVER_BIND check in harness §F and bin).
- [x] **No flaky tests introduced** — harness uses bounded `race(…,15s)` + `sleep(250)` readiness, `portFree` bind-probe fallback, `extraServers` cleanup in `finally`, per-run `randomUUID` canary/secret; live-slot checks DEFER/SKIP not FAIL when no exclusive window (documented, not silent).
- [x] **Coverage threshold met** — AC coverage 15/15 by trace; line/branch coverage N/A (no c8/nyc configured — stated, not assumed); acceptance-criteria coverage 12/15 full + 3/15 partial-by-design (explicit, escalated).
- [x] **Manual exploratory testing where applicable** — probe A3 (IMPLEMENTATION_PLAN §Step 0) is the pre-code live exploratory gate: binary scan 0 hits, `helix start --help` no --data-dir, `docker inspect` no HELIX_DATA_DIR passthrough + skill docs direct-Docker mode — verdict FAIL recorded before any code, with fail-closed `--migrate` abort as the consequence (not an improvisation).

## 1. Traceability (REQ → test → artifact → would it FAIL if broken?)

| REQ-ID | Evidence ID | Test location (harness § + live) | Type | Would a broken feature fail the test? | Status |
|--------|-------------|-----------------------------------|------|----------------------------------------|--------|
| REQ-P4-OPS-01 | T-P4OPS-01 | `verify-ops` §A (`--help` lists start\|stop\|status\|doctor exit 0; unknown subcommand/flag → exit 2 + usage on stderr) + `git diff package.json` bin+verify-ops only | E2E harness + git diff | **YES**: wrong surface or missing bin → §A `help lists X` fails; permissive parse → `exit 2` fails; extra deps → `git diff` shape fails | ✅ DONE |
| REQ-P4-OPS-02 | T-P4OPS-02 | §B (foreign reserved 3115 blocks start → exit 1 + NEVER-kill hint, foreign survives) + live slot-2 bar #10 (start 3114/6970 exit 0, Helix `slot2:6970` + storage=disk patch + ready 200/200, remember→search 1 bm25 hit, `git diff --stat src/ db/` empty) | E2E harness + live | **YES**: no pre-flight refuse → §B `exit 1` fails; killing foreign → `still alive` fails; source edit → `git diff` fails | ✅ DONE |
| REQ-P4-OPS-03 | T-P4OPS-03 | §C (stop idempotent exit 0, foreign survives two stops) + live bar #10 (stop exit 0 + repeat stop exit 0, ports free, foreign unchanged, `verifyOwnedPid` pre-SIGTERM and pre-SIGKILL in bin) | E2E harness + live | **YES**: non-idempotent → `repeat stop still exit 0` fails; killing foreign → `still alive` fails; missing re-verify → code grep `verifyOwnedPid` would fail (also §I static + bin read) | ✅ DONE |
| REQ-P4-OPS-04 | T-P4OPS-04 | §D (bearer: unset vs armed, secret never in stdout/stderr, exit 0 vs 1) + KR1 session bar #10 (status probes) | E2E harness + live | **YES**: printing secret → `never contains secret VALUE` fails; wrong exit contract → `exit 0 healthy or 1 degraded` fails | ✅ DONE |
| REQ-P4-OPS-05 | T-P4OPS-05 | §E (tokens healthy/helix-down/upstream/secret-missing/doctor-check-failed present, precedence 5>4>3>1>0 idx order, exactly one VERDICT, PASS\|FAIL\|INFO C1–C5, closed exits 0/1/3/4/5, secret-missing via env-strip, C1 header proof: synthetic slot-9 HTTP server receives 0 Authorization headers) + live bar #10 (doctor PASS C1 200, PASS C3 owned 3114, PASS C2 200/200, PASS C4, PASS C5 disk → VERDICT healthy exit 0; execution order C1→C3→C2→C4→C5 in bin) | E2E harness + header proof + live | **YES**: missing token/precedence → §E token/precedence fails; secret leak → §J fails; bearer to foreign → header proof `0 Authorization` fails | ✅ DONE |
| REQ-P4-OPS-06 | T-P4OPS-06 | §F (slots 1–3 table R(N)=3111+3(N-1) H(N)=6969+(N-1) exact, --slot 0/abc→exit 2, never 3151 as REST/Helix N=1..20, slot14 reserved 3151, derived via env/flags only, [local.dev] frozen) + `git diff`| Unit + E2E | **YES**: wrong math → `slot N rest=` fails; permissive slot → `exit2` fails; deriving 3151 → `never yields 3151` fails | ✅ DONE |
| REQ-P4-OPS-07 | T-P4OPS-07 | §G (precedence --data-dir > AGENT_MEMORY_DATA_DIR > default, state sibling outside HELIX_DATA_DIR, state path .../state/slot-N.json, mode 0600/0700, secret-free) + live (remember→search survives state-path) — **HELIX_DATA_DIR forwarding not claimed** | E2E harness + live (partial) | **YES for claimed surface**: wrong precedence/path/mode/secret → §G fails. **HELIX persistence not claimed** — A3 FAIL (§1.3) | ⚠️ DONE* partial — state-path precedence + secret-free proven; HELIX_DATA_DIR forwarding not claimed (A3 FAIL) |
| REQ-P4-OPS-08 | T-P4OPS-08 | §H (dry-run prints MIGRATE ABORT unsupported-runtime, mentions no backup/MinIO, --migrate --apply without --yes→2, --apply without --migrate→2, no backup file in repo root; --apply --yes also aborts) + session log (MinIO volume never destroyed) | E2E harness + session log | **YES**: not aborting → `MIGRATE ABORT unsupported-runtime` fails; writing data → abort contract violated; backup created → `no backup file` fails | ⚠️ DONE* partial — abort path proven; no data moved per A3 (framing 3b pending orchestrator) |
| REQ-P4-OPS-09 | T-P4OPS-09 | doc diff: README ops section `## Operations — P4 control plane` (slot table §4.2, data-dir default, backup+recovery, never-kill, Ley 172-13 PII-store declaration purpose/location/TTL/deletion + no-content-logged) + TEST_MATRIX KR1–KR3 rows (this section) | doc diff | **YES**: missing section → README anchor fails (also bar row presence) | ✅ DONE |
| NFR-P4-OPS-A | T-P4OPS-10 | §I (foreign on stand-in quartet survives all four subcommands unchanged PIDs) + static grep (no `helix prune`, `helix delete`, `docker volume rm`, `docker rm`, `fuser`, `pkill`, `killall`, --persist ≤2 doc-only) | static + live | **YES**: any kill-by-port/prune → static `no "…"` fails; signal to foreign → `survives after X` fails | ✅ DONE |
| NFR-P4-OPS-B | T-P4OPS-11 | §J (synthetic TEST_SECRET 0 occurrences in stdout+stderr of all four subcommands and in state file, output bearer: armed only; pattern of verify-env:312-323) | E2E harness | **YES**: leak → `never contains secret VALUE` fails | ✅ DONE |
| NFR-P4-OPS-C | T-P4OPS-12 | §L (bin REST_BASE 3111, HELIX_BASE 6969, src/server.ts default 3111 unchanged, helix.toml [local.dev] port 6969, git diff shows no port default change) + verify-env PASS (21) on bar #3 | E2E harness + suite log | **YES**: default change → `git diff shows no port default change` fails | ✅ DONE |
| NFR-P4-OPS-D | T-P4OPS-13 | §G (same harness as REQ-07 — state-path durability) — **HELIX restart with HELIX_DATA_DIR not claimed** | E2E harness (partial) | **YES for claimed**: state-path durability fails if broken. HELIX_DATA_DIR restart not claimed (A3) | ⚠️ DONE* partial — harness §G proves state-path durability; HELIX_DATA_DIR restart not claimed (A3) |
| NFR-P4-OPS-E | T-P4OPS-14 | suite logs (typecheck 0, verify 243, verify-env 21, verify-lifecycle 123, verify-capture 137, verify-skills 73) + `git diff package-lock.json` empty + port guard NEVER_BIND | suite logs + git diff | **YES**: any suite red or lockfile change → bar/ `git diff` fails; binding kept port → harness NEVER_BIND + bin check fails | ✅ DONE |
| NFR-P4-OPS-F | T-P4OPS-15 | §K (canary `canary-verify-ops-<uuid>` 0 occurrences in doctor/status/migrate outputs; migration report counts+paths only) | E2E harness | **YES**: canary leak → `canary never appears` fails | ✅ DONE |

No orphan REQ: 15/15 mapped. No orphan evidence: §A–L + header proof + live bar #10 each consumed by exactly one row (plus NFR-E bar). Harness sections A..L + live window bar #10 all referenced.

## 2. Count reconciliation (every published number, recomputed or live-verified where this review ran them)

| Published | Claimed at | My recomputation / live run | Result |
|-----------|------------|-----------------------------|--------|
| **typecheck exit 0** | TEST_MATRIX bar #1 (`npm run typecheck`) | bin is `.mjs` outside TS program; README Verification states typecheck clean; no `src/` diff to break it | ✅ (recorded; re-running typecheck would be redundant — bin outside program, same tree) |
| **verify-ops 99 passed, 0 failed / VERIFY PASS** | TEST_MATRIX bar #2 | Static: harness `check(` call sites ≈ 99 (sections A 7 + B 6 + C 5 + D 9 + E 12 + F 14 + G 8 + H 6 + I 11 + J 8 + K 3 + L 5 + headerProof 5 ≈ 99) — bar records 99/0 as the live run on 3114/6970 tree; harness exits 0 only on all-pass, children reaped in `finally` | ✅ exact per bar |
| **verify-env 21 passed** | bar #3 | `scripts/verify-env.ts` 21-check bar (discipline: never 3111/3112/3113/3151/6969; TEST_PORT 3199) — bar records 21/0 | ✅ |
| **verify-lifecycle 123 passed** | bar #4 | prior lane 117 + 6 since v0.7.1 → 123; bar records 123/0 | ✅ |
| **verify-capture 137 passed** | bar #5 | 137 checks (7 events + negatives + plugin helpers); bar records 137/0 | ✅ |
| **verify-skills --structural 73 passed** | bar #6 | 73 structural checks; bar records 73/0 | ✅ |
| **verify 243 passed** | bar #7 (`AGENT_MEMORY_URL=3151`) | 243 = T-RL-001 + T-F-01 + prior; bar records 243/0 on 3151, never 3111 | ✅ |
| **git diff --stat src/ db/ hooks/ plugins/ empty** | bar #8 | `git diff --stat HEAD -- src/ db/` this review → empty (0 files); `git diff --stat` at HEAD also empty for src/ db/ | ✅ |
| **git diff package-lock.json empty** | bar #9 | `git diff HEAD -- package-lock.json` → 0 lines | ✅ |
| **live slot-2 window DONE (bar #10)** | TEST_MATRIX bar #10 + `helix.toml` | `helix.toml` contains `[local.slot2] port=6970 storage="disk"` (additive, sanctioned, §4.2); bar pastes: start exit 0 (slot2:6970 + storage disk patch + ready 200/200), doctor healthy exit 0 (C1 200, C3 owned 3114, C2 200/200, C4 present, C5 disk), remember→search 1 result bm25 score 0.86 `signals:[]`, bootstrap 6970 `OK (8 indexes ensured)` before remember, stop exit 0 + second stop exit 0 idempotent, dev 6969 unchanged, `git diff src/ db/` empty | ✅ |
| **forbidden primitives absent** | §I + `bin/agent-memory.mjs` grep | `grep -c -- --persist` = 0; `grep prune/delete/docker.*rm/pkill/fuser/killall` in bin → 0 hits (only HELIX_DATA_DIR mentions in comments/abort reason, never a write); harness §I static checks 7 needles all PASS | ✅ |
| **T-P4OPS commits column** | TEST_MATRIX P4 OPS rows | 14/15 rows carry commit `f8e29f1` / `bd65360` / `8d6ae81`; T-P4OPS-09 `"(this commit)"` = pending merge commit (the lane's docs commit `974f5c4`) — filled, hash resolves on merge | ✅ (see Low observation O-01) |

No count inconsistency found across README Verification / TEST_MATRIX per-command bar / IMPLEMENTATION_PLAN.

## 3. A3 FAIL handling (P4.4 partial — the irreversible-call falsifiable probe)

| Item | Evidence | Verdict |
|------|----------|---------|
| **Probe A3 FAIL** | `IMPLEMENTATION_PLAN.md` §Step 0 table: Helix CLI 3.3.0 binary 0 occurrences HELIX_DATA_DIR, `helix start --help` no --data-dir flag, `docker inspect helix-agent-memory-dev` no HELIX_DATA_DIR env / no generic passthrough / Mounts [] / only MinIO volume, skill docs direct-Docker mode; Verdict: **A3 FAILS** — `helix start` does not forward `HELIX_DATA_DIR` | ✅ proven before any code; reversible call framing 3b pending orchestrator |
| **P4.4 rows partial** | `TEST_MATRIX.md` T-P4OPS-07 `DONE* partial — state-path precedence + state secret-free proven; HELIX_DATA_DIR forwarding not claimed (A3 FAIL)` · T-P4OPS-08 `DONE* partial — abort path proven; no data moved per A3` · T-P4OPS-13 `DONE* partial — harness §G proves state-path durability; HELIX_DATA_DIR restart not claimed (A3)` + `*Notes:` paragraph + `PROPOSED_CHANGES.md` Implementation notes appendix (§3.2 fallback) | ✅ correctly marked DONE* (not silent PASS, not hidden); escalated, not improvised |
| **--migrate abort proven** | `bin/agent-memory.mjs:1309-1325` — any `--migrate` (dry-run or --apply --yes) sets `checkFailed=true`, prints `MIGRATE ABORT: unsupported-runtime — probe A3 failed … framing 3b decision pending orchestrator`, `HINT: no source was read … MinIO volume retained`, appends audit on --apply; harness §H asserts `MIGRATE ABORT` + `unsupported-runtime` + `no backup … MinIO` + both `exit 2` gates + `no backup file in repo root` | ✅ abort proven, zero writes |
| **No data moved** | No `--migrate` code path writes before abort (bin read: abort block is the first migrate branch, no copy/backup before it); `PROPOSED_CHANGES.md` + `IMPLEMENTATION_PLAN.md` both state MinIO volume never destroyed, `docker volume ls` unchanged; `HELIX_DATA_DIR` never set for any child (`serverEnv` comment + `resolveDataDir` only feeds state path) | ✅ no data moved; reversibility preserved |

## 4. Hard constraints (packet HARD)

| Constraint | Evidence (this review) | Result |
|------------|------------------------|--------|
| **zero new deps** | `package.json` diff vs `HEAD~5` baseline: only `bin` + `verify-ops` script added; `dependencies`/`devDependencies` unchanged (`@helix-db/helix-db 3.0.4`, `zod`, `tsx`, `typescript` only); `git diff HEAD -- package-lock.json` 0 lines | ✅ |
| **frozen src/db** | `git diff --stat HEAD -- src/ db/` 0 files; `git diff HEAD -- src/ db/` empty; `helix.toml` delta limited to additive `[local.slot2]` (sanctioned config registration, not source) | ✅ |
| **port guard 3111/3112/3113/3151/6969** | `bin/agent-memory.mjs:76` `NEVER_BIND = [3111,3112,3113,3151,6969]` + derivation defense-in-depth check; harness §B/C/I use slot 9 (3135/6977 + reserved) and synthetic server on 3135 only; bar #7 verify on **3151** never 3111; live slot-2 quartet 3114/3115/3116/6970 never intersects `{3111,3112,3113,3151,6969}` | ✅ |
| **bootstrap 8 indexes** | bar #10: `bootstrap 6970 OK (8 indexes ensured)` before remember; `npx tsx scripts/bootstrap.ts` precedent in prior lane; Helix slot2 storage=disk ensures disk-mode indexes | ✅ |
| **helix.toml slot2 only additive** | `helix.toml:12-16` `[local.slot2] port=6970 storage="disk"`; `[local.dev] port 6969 storage="disk" tag v0.0.6` frozen | ✅ |

## 5. Findings

| ID | Severity | Finding | Location | Evidence | Owner |
|----|----------|---------|----------|----------|-------|
| **O-01** | Low (observation) | T-P4OPS-09 commits column shows `"(this commit)"` not a hash — expected for the lane-closing docs commit `974f5c4` (README + bar). Hash resolves on merge; not a trace gap, but the column is not yet a verifiable hash at review time. | `TEST_MATRIX.md:111` T-P4OPS-09 Commit | `git log --oneline -5` shows `974f5c4 docs(p4-ops): add README operations section…` as the docs commit that fills the row; column will be the merge commit on push | orchestrator (merge owner) |
| — | — | No Medium/High/Critical findings. All 15 REQ→test→artifact traces hold; suites green evidence pasted per-command; live slot-2 window verbatim evidence present; A3 partials explicit with abort proof; forbidden primitives absent; src/db and lockfile frozen. | — | — | — |

Cross-references (other reviewers' lanes, NOT counted here): security C1 (bearer gating) and C10 (re-verify per signal) are proven by header proof + `verifyOwnedPid()` shared code — security reviewer owns the verdict; architecture slot-math invariants and `[local.slot2]` sanctioning are architecture-owned; runbook `doctor` closed set §4a is the canonical contract consumed verbatim by bin — runbook reviewer owns that reconciliation. No sibling finding duplicates this review's scope.

## 6. Coverage

- Line/branch coverage: **N/A — not configured** (no c8/nyc in package.json); stated, not estimated.
- Acceptance criteria coverage: **15/15 REQ/NFR traced to test IDs**; 12/15 fully discriminating + PASS (T-P4OPS-01..06,09..12,14,15), 3/15 conditional on explicit A3 FAIL (T-P4OPS-07,08,13 → DONE* partial, not claimed as full — see §3). If A3 were PASS, those three would require `helix restart` + migration write-path evidence; today the abort path is the correct evidence.
- Live re-verification this review: `git diff` (src/db empty, lockfile empty, helix.toml additive only) + bin grep (0 persist/prune) + helix.toml read (`slot2:6970 disk`) + `TEST_MATRIX.md` bar read (counts + live window verbatim). Write-path suites (verify 243, verify-ops 99, lifecycle 123, capture 137, skills 73) not re-run per mandate — evidence taken from TEST_MATRIX per-command bar #1–10, statically reconciled where possible (harness section mapping + forbidden-grep + derive table vs §4.2).

## 7. Verdict Rationale

✅ **PASS** — The lane's core engineering is well-guarded: every published count reconciles to the artifact (typecheck 0, verify-ops 99/0, verify-env 21, lifecycle 123, capture 137, skills 73, verify 243 all pasted as a per-command bar), the 15-row traceability matrix has no orphan REQ or orphan evidence and each row's harness section (§A–L + header proof + live bar #10) would fail on regression (secret leak, foreign-kill, wrong slot math, permissive parse, missing VERDICT each have a direct `check()` that fails), the live slot-2 window proves start 3114/6970 → healthy doctor → remember→search 1 bm25 hit → bootstrap 8 indexes → stop idempotent with dev untouched, hard constraints hold (zero new deps, src/db empty diff, package-lock empty, forbidden primitives absent, port guard intact, helix.toml only additive), and the one irreversible call's failure (A3) is handled exactly as the packet required: probed before code, failed, recorded, escalated to orchestrator (framing 3b), with the three P4.4 rows honestly marked DONE* partial and the only reachable `--migrate` path proven to abort with `MIGRATE ABORT: unsupported-runtime` and zero writes / no volume mutation. Nothing here blocks the way a CLOSED verdict would: no Critical/High, no falsified count, no silent PASS, no kill-by-port. One Low observation (O-01) remains: T-P4OPS-09's commit hash is `"(this commit)"` until merge — merge resolves it.

## 8. Sign-off

- [ ] **Gate keeper approves** — PASS (with O-01 Low observation; no conditions). P4.4 DONE* rows remain partial pending orchestrator framing-3b decision — not a defect in this lane, but any future migration write path requires a new probe + new evidence before claiming KR3.

---

*Reviewer made no changes to any implementation file — edits limited to this own artifact (`docs/specs/40_workspace/quality-gate/P4-OPS/quality-assurance.md`) as mandated.*
