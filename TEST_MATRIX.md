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

Full verification bar after the RL001-F01 condition-clearance changes (one run, in order, each command pasted with its own counts). The run-budget declaration in `scripts/verify.ts` §10 now counts **+17 Session nodes per `verify` run** (lazy `_SESSION_STALE_MS` cursor heal: one new node per pre-stale session on the first run after 2h of activity — `docs/CONTRACT.md` §5); totals below are post-heal steady-state.

| # | Command | Result |
| - | ------- | ------ |
| 1 | `npm run typecheck` | exit 0 (0 errors) |
| 2 | `npx tsx scripts/bootstrap.ts` | exit 0 — `OK (8 indexes ensured)` + READY (still 8 indexes) |
| 3 | `npm run verify-lifecycle` | **117 passed, 0 failed** (2026-09-23 baseline 113; +4 = RF-03 seams a/b/c + RK-02 response-shape assert) |
| 4 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` | **243 passed, 0 failed** (:3151; §P f-01 covers RF-04) |
| 5 | `npm run verify-env` | **21 passed, 0 failed** |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** |
| 7 | `npm run verify-capture` | **137 passed, 0 failed** (incidental, not part of the gate bar) |
| 8 | Session-node run budget (RK-01 evidence) | `helix query dev -e '… nWithLabel("Session").count() …'`: 490 → **507 (+17/run, bounded)** |

COND → test/evidence → artifact:

| COND | Test / evidence | Artifact |
| ---- | --------------- | -------- |
| RD-01 | `verify-lifecycle` §M write-path doc contract (`WITHOUT a write`, `receive-and-wait`, `vanishes`, `heal`, `req_id`) | `src/store.ts:809-821` |
| RF-01 | Re-scope to CONTRACT §3 tier-1 **(b)** — doc-level, no code | `docs/CONTRACT.md` §3 |
| RF-02 | §P f-01: one-time-hash secret hash proven never → embedding path (243 bar, 1 call) | `scripts/verify.ts` §P f-01 |
| RF-03 | `verify-lifecycle` §I-c seam cases — (a) expired-while-waiting → **insert sent** (3 sends), (b) fresh-read miss → reject, `links` stale after heal → **8 sends** (merge-path `verifyMergedState` retryWrite variant = the exact cited location), (c) post-heal still-violated → named throw (8 sends); plus RK-02 response-shape assert in §I | `scripts/verify-lifecycle.ts` §I-c |
| RF-04 | Typecheck (0) + §P f-01 live embed pass after DB-API param-order pin | `db/queries.ts:111` |
| RS-02 | Doc declaration of the AU-002 send envelope (NO queue cap / waiter deadline / circuit breaker) | `docs/CONTRACT.md` §3 |
| RK-01 | §10 `run budget` declares +17/run session-node lazy heal; `verify` 243 green post-declaration; count 490→507 bounded (evidence #8); §3b crash-window carve-out sentence | `scripts/verify.ts` §10, `docs/CONTRACT.md` §5, §3 |
| RK-02 | Two heal log sites + §I message-stability assert + `heal survivor=expired-hit links=7` observed on a live run (stderr) | `src/store.ts:1048, 1166` |
| RK-03 | `README` §G line count → 117; structural `verify-skills` gate-line pass (73 bar) | `README.md:607` |
| QA-05 | This section — per-command counts, single consolidated bar | `TEST_MATRIX.md` |
| QA-06 | ROADMAP verification row counts → 243 / 117 / 137 | `ROADMAP.md:44` |

Deviations from the packet's literal wording, resolved toward the gate reports' verbatim clear criteria (truth + "confirm totals first" over stale literals): lifecycle **117** (packet predates the +4 checks RF-03/RK-02 mandate); RK-02 log on **stderr** (store may not write stdout — `src/mcp.ts:381`; both streams are the §3 governance log); RK-01 "zero NO rows remain" required the §5 run-budget addition + §3b carve-out; RF-01 via re-scope option (b); RS-02 keeps the AU-002 numbers as criterion (c) alternative; archived docs (`docs/specs/50_archive/**`, `RELEASE_NOTES`) and reviewer-owned gate reports keep their historical counts.
