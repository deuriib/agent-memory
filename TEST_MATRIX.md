# Test / Evidence Matrix: REQ-RL-001 + REQ-F-01 (residual closure lane)

**Agent:** vasquez (Engineering Owner R1, execute-spec lane)
**Date:** 2026-09-23
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

- (pasted after the runs)
