# Test / Evidence Matrix: REQ-RL-001 + REQ-F-01 (residual closure lane)

**Agent:** vasquez (Engineering Owner R1, execute-spec lane)
**Date:** 2026-09-23 (gate RL001-F01 remediation pass: 2026-09-24)
**Domains-Touched:** engineering (R1)

Prior lane evidence preserved in git history (this file is the lane singleton,
updated in place per execute-spec).

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-RL-001 | T-RL-001 | Per-survivor FIFO lock closes the lost-append on CONCURRENT distinct near-dup variants: `survivorTails` + `withSurvivorLock` (lock ordering dedupKey OUTER → survivor INNER, one survivor per merge, no cycle) + ADDITIVE `getMemoryById()` fresh re-read under the lock (filterExpired re-run → expired-while-waiting falls to plain insert; fresh-read miss → fail-closed throw) + §P concurrent test: base variant saved, then N=3 DISTINCT near-dup variants fired CONCURRENTLY via `Promise.all` on one fresh project → all three `consolidated:true` with the SAME survivor id, healthCount memories = 1, sessions = 1, and the session read shows ALL THREE variant wordings in the survivor content (no lost append) | E2E live (`verify.ts` §P `RL-001 concurrent` block, server :3151) + pure seam (`verify-lifecycle` §I TTL×merge control now serves the fresh read — `consolidated=true`, no insert write, canned-reply queue traps any unexpected send) | **DONE** — counts pasted below | commit 1 (see git log) |
| REQ-F-01 | T-F-01 | Post-write verify + heal for `updateMemoryContent`: ADDITIVE `memoryConcepts()` (memoryId+project → HAS_CONCEPT → `["names"]`) + ADDITIVE `linkMemoryConcepts()` (link-only WriteBatch, content/embedding/dedupKey untouched) + pure `missingConcepts(linked, incoming)`; `consolidateInto` verifies content / dedupKey / linked-concept invariants after every merge write, heals ONCE (content-state wrong → full `updateMemoryContent` retry; links-only missing → `linkMemoryConcepts`), re-verifies, still wrong → fail-closed throw naming the invariant; substring-guard path now runs the concept-link verify+heal instead of returning without a read. §P heal test: A → survivor, B → merged (content `A\nB`), re-save B + NEW explicit concept C → guard path links C; `smart-search concepts=[C]` recalls the survivor with fused-score Δ == 1/61 vs the no-concepts control (graph-branch causality) while content byte-length stays exactly `A\nB` (no duplicate append); response keeps `consolidated:true` + survivor id + REQUEST concept echo | E2E live (`verify.ts` §P `F-01 heal` block) + pure goldens (`verify-lifecycle` §G `missingConcepts`: order-independence over shuffled input, dedup, exact-name/case match, no substring match, empty-set cases) + seam (§I guard path serves the concepts read) | **DONE** — counts pasted below | commit 2 (this release lane) |

## Coverage Summary

- Evidence coverage: 2/2 REQ-IDs, each → test → artifact row.
- RL-001 acceptance covered by T-RL-001 E2E (the exact failure mode: 3
  concurrent distinct variants, post-state content includes all three).
- F-01 acceptance covered by T-F-01 E2E (heal observable via the graph branch
  while content provably untouched) + §G pure goldens for the set-difference
  helper.
- No-regression: §G consolidation goldens, §I fail-closed probe + TTL×merge,
  §P original 3-variant sequence (P1–P8) all green in the final bar below.
- Docs: ROADMAP / CONTRACT / README untouched by this lane (second lane owns
  them); contract deltas reported in the lane report for verbatim pickup.

## Commit-1 bar (REQ-RL-001 tree, run 2026-09-23, server :3151, Helix dev untouched)

- `npm run typecheck` — exit 0 (no errors).
- `npx tsx scripts/bootstrap.ts` — `bootstrapIndexes: OK (8 indexes ensured)` + `READY` (no index added).
- `npm run verify-lifecycle` — **104 passed, 0 failed** / `VERIFY PASS` (§I TTL×merge control re-based to the fresh read: `TTL OFF control -> same candidate consolidates (consolidated=true, pre-check + fresh re-read, no insert)` PASS).
- `npm run verify` — **227 passed, 0 failed** / `VERIFY PASS`; T-RL-001 block verbatim:
  - `PASS rl-001: base status 201`
  - `PASS rl-001: base body`
  - `PASS rl-001: base is a plain insert (deduped=false, consolidated=false)`
  - `PASS rl-001: variant 0 body` / `variant 1 body` / `variant 2 body`
  - `PASS rl-001: all 3 concurrent variants -> status 201`
  - `PASS rl-001: all 3 consolidated=true, deduped=false, SAME survivor id (serialized per survivor)`
  - `PASS rl-001: health envelope after 3 concurrent merges`
  - `PASS rl-001: 1 base + 3 concurrent merges -> memories = 1, sessions = 1`
  - `PASS rl-001: sessionMemories(rlSid0) envelope`
  - `PASS rl-001: survivor content contains ALL THREE variant wordings verbatim (no lost append)`
  - `PASS rl-001: cleanup forget survivor -> 200`

## Final verification bar (run on the commit-2 tree, server :3151, Helix dev untouched)

- `npm run typecheck` — exit 0 (no errors).
- `npx tsx scripts/bootstrap.ts` — `bootstrapIndexes: OK (8 indexes ensured)` + `READY` (no index added by either REQ).
- `npm run verify-lifecycle` — **113 passed, 0 failed** / `VERIFY PASS` (includes §G `missingConcepts` goldens + §I guard-path heal seam: `TTL OFF control -> consolidates via guard; guard path heals missing concept links offline (consolidated=true, 5 sends, NO insert)` PASS).
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` — **243 passed, 0 failed** / `VERIFY PASS`; T-RL-001 block (13 checks) green in the same run; T-F-01 `f-01:` block verbatim (tail):
  - `PASS f-01: guard re-save -> 201, consolidated=true, deduped=false, SAME survivor id`
  - `PASS f-01: response echoes REQUEST concepts [C] (first-wins echo unchanged on the guard path)`
  - `PASS f-01: response echoes the REQUEST sessionId (contract §3 echo unchanged on the guard path)`
  - `PASS f-01: sessionMemories(fSidA) envelope (after heal)`
  - `PASS f-01: survivor content BYTE-IDENTICAL after the guard-path heal (A\nB — no re-append, no rewrite)`
  - `PASS f-01: control smart-search (no concepts) envelope`
  - `PASS f-01: smart-search concepts=[C] envelope`
  - `PASS f-01: smart-search concepts=[C] fused score = control + 1/61 (graph leg rank 1 — the HEALED link caused the recall)`
  - `PASS f-01: cleanup forget survivor -> 200`
- Adjacent suites (no-regression on the shared store): `verify-capture` **137 checks, 0 failed**; `verify-env` **21 passed, 0 failed**; `verify-skills --structural` **73 passed, 0 failed**; `verify-injection` **ALL PASS** (exit 0).
- Incident note (harness, not product): the first commit-2 `verify` attempt returned `internal_error` on `health`/`remember` because the Helix dev CONTAINER was inside a restart window (`helix status` uptime reset to <1s; SDK `fetch failed … Cannot reach Helix at http://localhost:6969/v2/query`). Re-run green once the container was back; no code change came from this. One test-fixture root cause was found and fixed in-lane (Phase-1 single hypothesis): the §I canned reply at call 5 fed `names` as a STRING array while `memoryConcepts` returns RECORDS `{name}` (`PropertyProjection.new("name")`) and `readLinkedConcepts` drops non-record rows via `toRecords` — so the re-read saw zero linked names and failed closed with all 7 missing. Fixture corrected to `i5ExpectedConcepts.map((name) => ({ name }))`; product code unchanged (fail-closed behavior was correct).

## Gate-remediation bar (gate RL001-F01, lane 2026-09-24)

Full verification bar after the RL001-F01 condition-clearance changes (one run, in order, each command pasted with its own counts). `scripts/verify.ts` mints fresh uuid test sessions per run: the memory rows self-clean via `forget` at test end, but **no Session deletion path exists**, so each run leaves **+17 Session nodes** (the run-budget declaration lands in `docs/CONTRACT.md` §5, commit 2).

| # | Command | Result |
| - | ------- | ------ |
| 1 | `npm run typecheck` | exit 0 (0 errors) |
| 2 | `npx tsx scripts/bootstrap.ts` | exit 0 — `OK (8 indexes ensured)` + READY (still 8 indexes) |
| 3 | `npm run verify-lifecycle` | **117 passed, 0 failed** (2026-09-23 baseline 113; +4 = RF-03 seams a/b/c + RK-02 response-shape assert) |
| 4 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` | **243 passed, 0 failed** (:3151; §P f-01 covers RF-04) |
| 5 | `npm run verify-env` | **21 passed, 0 failed** |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** |
| 7 | `npm run verify-capture` | **137 passed, 0 failed** (incidental, not part of the gate bar) |
| 8 | Session-node run budget (RK-01 evidence) | `helix query dev -e '… nWithLabel("Session").count() …'`: 490 → 507 → **524** — **+17 per `verify` run**, measured ×2 (2026-09-24); accumulation unbounded until reset → declared in `docs/CONTRACT.md` §5 (commit 2) |

COND → test/evidence → artifact:

| COND | Test / evidence | Artifact |
| ---- | --------------- | -------- |
| RD-01 | `verify-lifecycle` §M write-path doc contract (`WITHOUT a write`, `receive-and-wait`, `vanishes`, `heal`, `req_id`) | `src/store.ts:809-821` |
| RF-01 | Re-scope to CONTRACT §3 tier-1 **(b)** — doc-level, no code | `docs/CONTRACT.md` §3 |
| RF-02 | §P f-01: one-time-hash secret hash proven never → embedding path (243 bar, 1 call) | `scripts/verify.ts` §P f-01 |
| RF-03 | `verify-lifecycle` §I-c seam cases — (a) expired-while-waiting → **insert sent** (3 sends), (b) fresh-read miss → reject, `links` stale after heal → **8 sends** (merge-path `verifyMergedState` retryWrite variant = the exact cited location), (c) post-heal still-violated → named throw (8 sends); plus RK-02 response-shape assert in §I | `scripts/verify-lifecycle.ts` §I-c |
| RF-04 | Typecheck (0) + §P f-01 live embed pass after DB-API param-order pin | `db/queries.ts:111` |
| RS-02 | Doc declaration of the AU-002 send envelope (NO queue cap / waiter deadline / circuit breaker) | `docs/CONTRACT.md` §3 |
| RK-01 | `docs/CONTRACT.md` §5 session-node run budget declared (+17/run, measured 490→507→524, re-review P4.1/2026-12-31) + §3b crash-window carve-out + `ROADMAP.md` §1.3 `VERIFY-SESSION-NODES` row; `verify` 243 green post-declaration (evidence #8) | `docs/CONTRACT.md` §5, §3; `ROADMAP.md` §1.3 |
| RK-02 | Two heal log sites + §I message-stability assert + `heal survivor=expired-hit links=7` observed on a live run (stderr) | `src/store.ts:1048, 1166` |
| RK-03 | `README` §G line count → 117; structural `verify-skills` gate-line pass (73 bar) | `README.md:607` |
| QA-05 | This section — per-command counts, single consolidated bar | `TEST_MATRIX.md` |
| QA-06 | ROADMAP verification row counts → 243 / 117 / 137 | `ROADMAP.md:44` |

Deviations from the packet's literal wording, resolved toward the gate reports' verbatim clear criteria (truth + "confirm totals first" over stale literals): lifecycle **117** (packet predates the +4 checks RF-03/RK-02 mandate); RK-02 log on **stderr** (store may not write stdout — `src/mcp.ts:381`; both streams are the §3 governance log); RK-01 "zero NO rows remain" required the §5 run-budget addition + §3b carve-out; RF-01 via re-scope option (b); RS-02 keeps the AU-002 numbers as criterion (c) alternative; archived docs (`docs/specs/50_archive/**`, `RELEASE_NOTES`) and reviewer-owned gate reports keep their historical counts.

## P4 OPS — ops control plane (SPEC-P4-OPS, executed 2026-09-24, server :3151 + slot2 live window 3114/6970)

**Spec:** `docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` · **Harness:** `scripts/verify-ops.ts` (§A–§L) + live slot-2 window (3114/3115/3116/6970, instance `slot2`, `dev` 6969 read-only) · **A3:** FAIL — HELIX_DATA_DIR not forwarded (see IMPLEMENTATION_PLAN §Step 0), P4.4 framing 3b pending orchestrator

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P4-OPS-01 | T-P4OPS-01 | CLI surface: `bin/agent-memory.mjs` (Node ≥20 ESM, `node:` builtins only) registered as `bin.agent-memory`, `--help` lists start\|stop\|status\|doctor (exit 0), unknown subcommand/flag or invalid `--slot` → usage on stderr exit 2; `package.json` only gains `bin` + `verify-ops`, `package-lock.json` untouched (AC-01) | E2E harness `verify-ops` §A + `git diff` | **DONE** | f8e29f1 |
| REQ-P4-OPS-02 | T-P4OPS-02 | `start --slot 2` spawns Helix `slot2` (`helix add local --name slot2 --port 6970` once, then `helix start slot2`, never `--persist`) + `npx tsx src/server.ts` with §4.3 env (AGENT_MEMORY_PORT=3114, HELIX_URL=6970, state 0600/0700), readiness gate Helix `/healthz` + `/memory/livez` ≤30 s, pre-flight quartet refuse + NEVER-kill hint exit 1 no signal, `git diff --stat src/ db/` empty (AC-02, KR2) | E2E harness `verify-ops` §B + live slot-2 (see bar #10) | **DONE** | f8e29f1, 8d6ae81 |
| REQ-P4-OPS-03 | T-P4OPS-03 | `stop --slot 2` SIGTERM→SIGKILL tracked PIDs only with `verifyOwnedPid()` pre-SIGTERM and pre-SIGKILL (C10), `helix stop slot2`, removes state, idempotent exit 0; foreign quartet PIDs unchanged, stale/mismatch → `stale-pid` note exit 1 no signal (AC-03) | E2E harness `verify-ops` §C + live slot-2 | **DONE** | f8e29f1 |
| REQ-P4-OPS-04 | T-P4OPS-04 | `status --slot N` read-only quartet + REST/Helix probes + data-dir + `bearer: armed\|unset` (presence-only, never value, never Authorization header; 401=armed) exits 0/1/2 distinct from doctor (AC-04, KR1) | E2E harness `verify-ops` §D + KR1 session | **DONE** | f8e29f1 |
| REQ-P4-OPS-05 | T-P4OPS-05 | `doctor --slot N` C1→C3→C2→C4→C5 (C3 ports before C2 bearer), one `PASS\|FAIL\|INFO <check-id>` per check + exactly one `VERDICT: <name>`, closed exits 0/1/2/3/4/5 precedence 5>4>3>1>0; KR1 verdicts `healthy` 0 / `upstream-holds-port` 3 / `helix-down` 4 (+ `secret-missing` 5, `doctor-check-failed` 1), foreign listener receives zero bearer requests (C1), output allowlisted (AC-05, KR1) | E2E harness `verify-ops` §E + KR1 session (bar #10) | **DONE** | f8e29f1 |
| REQ-P4-OPS-06 | T-P4OPS-06 | Slot derivation `R(N)=3111+3(N−1)`, `H(N)=6969+(N−1)` §4.2 slots 1–3 table exact, `--slot 0`/`abc` → exit 2, slot N≥2 ∩ {3111,3112,3113,6969}=∅, never 3151, derived via env/flags only, `[local.dev]` frozen (AC-06) | E2E harness `verify-ops` §F + `git diff` | **DONE** | f8e29f1 |
| REQ-P4-OPS-07 | T-P4OPS-07 | Data-dir precedence `--data-dir` > `AGENT_MEMORY_DATA_DIR` > `~/.local/share/agent-memory/<slot>/`, state `<parent>/state/slot-N.json` outside `HELIX_DATA_DIR`, remember→search survives `helix restart` + stop/start cycle, state contains no secret (AC-07, KR3* — A3 FAIL see note) | E2E harness `verify-ops` §G + live | **DONE* partial** — state-path precedence + state secret-free proven; HELIX_DATA_DIR forwarding not claimed (A3 FAIL) | f8e29f1 |
| REQ-P4-OPS-08 | T-P4OPS-08 | `doctor --migrate` dry-run default zero writes (counts+allowlisted paths only), `--migrate --apply --yes` fail-closed `MIGRATE ABORT: unsupported-runtime` (Probe A3 FAIL — `helix start` does not forward `HELIX_DATA_DIR` on CLI 3.3.0), audit line, MinIO volume never destroyed (AC-08, P4.4 not claimed — framing 3b pending orchestrator) | E2E harness `verify-ops` §H + session log | **DONE* partial** — abort path proven; no data moved per A3 | f8e29f1 |
| REQ-P4-OPS-09 | T-P4OPS-09 | Docs closure: README ops section (derivation table, data-dir default, backup+recovery, never-kill, Ley 172-13 PII-store declaration) + `TEST_MATRIX.md` KR1–KR3 rows (this section) linking evidence (AC-09) | doc diff | **DONE** | (this commit) |
| NFR-P4-OPS-A | T-P4OPS-10 | Never-kill-upstream: no kill-by-port/`fuser`/`prune`/`delete`/`docker rm|kill|volume rm`/`--persist` in source; foreign listeners on stand-in quartet survive all four subcommands unchanged PIDs (AC-A) | static grep + live `verify-ops` §I | **DONE** | f8e29f1, bd65360 |
| NFR-P4-OPS-B | T-P4OPS-11 | Secret non-printing: synthetic `AGENT_MEMORY_SECRET` value 0 occurrences in stdout+stderr of all four subcommands and in state file, output `bearer: armed` only (AC-B) | E2E harness `verify-ops` §J | **DONE** | bd65360 |
| NFR-P4-OPS-C | T-P4OPS-12 | Port-parity default untouched: bare `npm run dev` still `3111`, `HELIX_URL` `6969`, hook/plugin defaults unchanged; `status --slot 1` reports 3111/6969; `verify-env` PASS (AC-C) | E2E harness `verify-ops` §L + `verify-env` | **DONE** | bd65360 |
| NFR-P4-OPS-D | T-P4OPS-13 | Durability across restart: save → `helix restart <instance>` → search + save → stop/start cycle → search (AC-D, KR3*) | E2E harness `verify-ops` §G | **DONE* partial** — harness §G proves state-path durability; HELIX_DATA_DIR restart not claimed (A3) | bd65360 |
| NFR-P4-OPS-E | T-P4OPS-14 | Zero new deps + suites green: `package-lock.json` untouched, `npm run typecheck` 0, `verify`/`verify-env`/`verify-lifecycle`/`verify-capture`/`verify-skills` PASS, port guard 3111/3112/3113/3151/6969 never bound by harness (AC-E) | suite logs + `git diff` | **DONE** | bd65360, f8e29f1 |
| NFR-P4-OPS-F | T-P4OPS-15 | Ley 172-13 output hygiene: canary memory string 0 occurrences in `doctor`/`status`/`--migrate` outputs; migration report counts+allowlisted paths only (AC-F) | E2E harness `verify-ops` §K | **DONE** | bd65360 |

Per-command bar (live evidence, server :3151 + slot2 window 3114/6970, instance `slot2`, `dev` read-only):

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck` | exit 0 (0 errors) — bin `.mjs` outside TS program |
| 2 | `npx tsx scripts/verify-ops.ts` | **99 passed, 0 failed** / VERIFY PASS (C1 header proof: synthetic server 0 Authorization headers; §A–§L + never-kill + secret + canary + port-parity all green; live-slot checks DEFER where noted) |
| 3 | `npm run verify-env` | **21 passed, 0 failed** / VERIFY PASS |
| 4 | `npm run verify-lifecycle` | **123 passed, 0 failed** / VERIFY PASS (prior lane 117 + 6 goldens since v0.7.1) |
| 5 | `npm run verify-capture` | **137 passed, 0 failed** / ALL PASS |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** / VERIFY SKILLS PASS |
| 7 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 AGENT_MEMORY_SECRET=test-secret-p4-ops-fixed npm run verify` | **243 passed, 0 failed** / VERIFY PASS (server on 3151, never 3111; Helix dev 6969; T-RL-001 + T-F-01 green) |
| 8 | `git diff --stat src/ db/ hooks/ plugins/` | empty (0 files) |
| 9 | `git diff package-lock.json` | empty (0 lines) |
| 10 | Live slot-2 window `AGENT_MEMORY_SECRET=test-secret-p4-ops-fixed bin/agent-memory start --slot 2` → `doctor healthy` → `remember`→`search` 3114 → `stop --slot 2` → idempotent | **DONE**: `start` exit 0 (helix registered `slot2:6970` + `storage="disk"` patch + ready 200/200); `doctor --slot 2` → `PASS C1` 200, `PASS C3` owned 3114, `PASS C2` 200/200, `PASS C4` present, `PASS C5` disk → `VERDICT: healthy` exit 0; `POST /memory/remember` → `{"id":"0b0a4b43-…","deduped":false}`; `POST /memory/search` → 1 result `bm25` score 0.86 `signals:[]`; bootstrap 6970 `OK (8 indexes ensured)` before remember; `stop --slot 2` exit 0 + second `stop` exit 0 idempotent; `helix status` dev unchanged (6969 up), `git diff --stat src/ db/` empty, `helix.toml` only `[local.slot2]` additive (sanctioned) |

*Notes:* P4.4 `HELIX_DATA_DIR` forwarding / MinIO migration (REQ-07/08/NFR-D partial) — Probe A3 FAIL (see IMPLEMENTATION_PLAN §Step 0 + PROPOSED_CHANGES Appendix): `helix start` 3.3.0 does not forward `HELIX_DATA_DIR`; `--migrate` fails closed `unsupported-runtime`; framing 3b (data-dir for new instances only) escalated to orchestrator, not claimed in this lane. All other REQs implemented.
