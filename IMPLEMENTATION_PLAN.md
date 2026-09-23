# Implementation Plan: REQ-RL-001 (per-survivor FIFO lock) + REQ-F-01 (post-write verify + heal)

**Agent:** vasquez (Engineering Owner R1, execute-spec lane)
**Date:** 2026-09-23
**Approved By:** orchestrator reference-only packet
(`SPEC:ROADMAP.md#1.3-rows-RL-001,F-01 + docs/CONTRACT.md#3-tier-1-(a),(b)` /
`HARD:subagents+no-route-or-MCP-tool-changes+no-helix-restart+single-writer-in-process-scope-only` /
`GATE:open-residuals-RL-001,F-01-accepted-2026-09-23-expiry-2026-12-31` / `DOMAINS:R1`):
close the two accepted residuals RL-001 (lost append on concurrent distinct
near-dup variants) and F-01 (mid-batch atomicity assumption on
`updateMemoryContent`). Scope is EXACTLY the approved proposal — no expansion.
**Domains-Touched:** engineering only (R1: `db/queries.ts`, `src/store.ts`,
`src/consolidate.ts`, `scripts/verify.ts`, `scripts/verify-lifecycle.ts`).
Docs (ROADMAP/CONTRACT/README) belong to the second lane — this lane reports
contract deltas verbatim instead of editing them.
**Prior lanes:** P0 closed, P1.1/P1.3/P1.6 + P2.1 closed at v0.4.0, P1-remainder
+ P3.2 at v0.5.0, P2-completion at v0.6.0. This plan replaces the previous
content in-place (lane singleton); prior content preserved in git history.

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | REQ-RL-001 per-survivor FIFO lock: `db/queries.ts` += ADDITIVE `getMemoryById()` ReadBatch + `getMemoryByIdParams` (memoryId string, project string; unique-equality anchor on `memoryId` AND `project` filter as the fail-closed double check; projects `memoryRowProjection` + `dedupKey`; existing index #1 only → bootstrap stays 8); `src/store.ts` += `survivorTails` Map + `withSurvivorLock` (same FIFO pattern as `dedupTails`; LOCK ORDERING documented: incoming dedupKey lock OUTER → survivor lock INNER, one survivor per merge so no lock cycle); `consolidateInto` acquires the survivor lock, RE-READS the survivor fresh via `getMemoryById`, and does everything downstream against the FRESH snapshot: `filterExpired` re-run (survivor expired while waiting → plain insert, never absorbs), `mergedContent(fresh.content, input)`, fresh embed + fresh dedupKey, existing response asserts kept; fresh-read MISS (survivor deleted mid-merge) → throw fail-closed (same posture as the vanished-survivor assert) | `db/queries.ts`, `src/store.ts` | `verify.ts` §P NEW concurrent distinct-variants test (N=3 `Promise.all`, same survivor id, all three wordings in survivor content) + `verify-lifecycle` §I seam harness updated for the fresh-read call (no assertion weakened) | M |
| 2 | REQ-F-01 post-write verify + heal: `db/queries.ts` += ADDITIVE `memoryConcepts()` ReadBatch + `memoryConceptsParams` (memoryId string, project string; anchor Memory by memoryId+project → `.out("HAS_CONCEPT")` → `.dedup()` → project concept `name`, returns `["names"]`) and ADDITIVE `linkMemoryConcepts()` WriteBatch + `linkMemoryConceptsParams` (memoryId string, concepts array object, project string; anchor by memoryId+project, `conceptBody()` per missing name, returns `["memory"]`; content/embedding/dedupKey NEVER rewritten); `src/consolidate.ts` += pure `missingConcepts(linked, incoming)` set-difference (dedup, exact-name, code-unit sorted → order-independent); `src/store.ts` `consolidateInto` after a successful `updateMemoryContent`: re-read `getMemoryById` + `memoryConcepts`, assert (a) content === nextContent, (b) dedupKey === `contentHash(project, normalize(nextContent))`, (c) every incoming EFFECTIVE concept linked — mismatch → ONE heal (content-state wrong → full `updateMemoryContent` retry; content-state right but links missing → `linkMemoryConcepts` link-only), re-verify, still wrong → throw fail-closed NAMING the failed invariant; substring-guard path now ALSO runs the concept-link verify+heal (may no-op content, must link missing incoming effective concepts) instead of returning without a read; `RememberResult` echo semantics (`consolidated:true`, survivor id, REQUEST echo) unchanged; ALL existing fail-closed asserts kept | `db/queries.ts`, `src/consolidate.ts`, `src/store.ts` | `verify.ts` §P NEW heal test (guard-path save with new explicit concept C → graph-branch recall via `smart-search concepts=[C]`, content byte-length unchanged) + `verify-lifecycle` §G NEW `missingConcepts` goldens (order-independence, dedup, exact-name) + §I seam updated for the guard-path concepts read | M |
| 3 | Quality bar (run yourself, paste counts): `npm run typecheck` clean → `npx tsx scripts/bootstrap.ts` green (8 indexes, no index added) → `npm run verify-lifecycle` green (§G goldens no regression) → `npm run verify` green against OUR server on 3151 (§P no regression; upstream 3111 untouched; Helix dev never restarted) | repo root + local server :3151 | run outputs summarized in TEST_MATRIX.md | S |
| 4 | Two Conventional Commits, one per REQ, each body linking REQ-ID → test → artifact; plan/matrix rows updated with evidence (RL row in commit 1, F row + backfill in commit 2); NO ROADMAP/CONTRACT/README commits (docs lane owns them) — report exact §2 export + §3 tier-1 behavior deltas for the docs lane | `src/`, `db/`, `scripts/`, this plan, `TEST_MATRIX.md` | git log | S |

## Order of Operations

Step 1 → 2 sequential inside the lane (both touch `src/store.ts` +
`db/queries.ts`; each commit must leave the full bar green — the §I seam
harness adapts once per step because the fresh read (step 1) and the guard-path
concepts read (step 2) each add one `send()` to the TTL×merge control flow).
Step 3 runs before each commit; step 4 lands the two commits. Singleton files
(this plan + TEST_MATRIX) are written up front with planned rows and updated
in place with evidence before each commit.

## Rollback Points

- After step 1 (commit 1): revert the `getMemoryById` hunks + survivor-lock
  hunks + the §P concurrent block + §I harness — behavior returns to the
  per-dedupKey-only lock (RL-001 residual reopens); no schema, no index, no
  route touched; rows written by the concurrent test are seed data on random
  `verify-*` projects (forgotten at test end), no prod risk.
- After step 2 (commit 2): revert the `memoryConcepts`/`linkMemoryConcepts`
  hunks + verify/heal hunks + `missingConcepts` + §P heal block + §G goldens —
  merge behavior returns to commit-1 state (F-01 residual reopens); additive
  queries are never referenced after revert.
- Assumption stated (irreversible-adjacent): merges still rewrite survivor
  content in place (unchanged from P1.2 — concatenation never discards);
  the heal path may re-run `updateMemoryContent` ONCE with byte-identical
  content when only `dedupKey` is stale (idempotent setProperty, dev-instance
  data only; rollback of merged rows is not promised — same declaration as
  the P1.2 lane).

## Evidence Log (updated in place before each commit)

### Commit 1 — REQ-RL-001 (2026-09-23)

- Step 1 done exactly as planned: `getMemoryById` ADDITIVE query,
  `survivorTails`/`withSurvivorLock`/`withFifoLock` in `src/store.ts`,
  `consolidateInto` → lock wrapper + `mergeUnderSurvivorLock` (fresh read →
  TTL re-check → guard/write over `fresh.content`) + `getFreshSurvivor`
  fail-closed parser. No renames, no param-schema changes, no route/MCP
  changes, `RememberResult` untouched, barrel `db/index.ts` not yet touched
  (gets all three new exports with commit 2, additive).
- NEW evidence landed: `verify.ts` §P `rl-001:` block = 13 checks (base
  insert, N=3 `Promise.all` variants → all `consolidated=true` + same
  survivor id + `deduped=false`, health 1 memory / 1 session, all three
  variant wordings verbatim in survivor content, cleanup forget);
  `verify-lifecycle.ts` §I harness extended with per-call canned `replies`
  (i5 control serves the fresh read; assertion re-based: pre-check + fresh
  re-read = 2 sends, insert would be 3 — no assertion weakened).
- Bar (commit-1 tree, server :3151): typecheck exit 0 · bootstrap
  `OK (8 indexes ensured)` · verify-lifecycle **104 passed, 0 failed** ·
  verify **227 passed, 0 failed**. Details pasted in TEST_MATRIX.md.

## Quality Gates

- [ ] Engineering: `npm run typecheck` clean (no `any`, no `@ts-ignore`, no TODO) — exit 0
- [ ] Engineering: `npx tsx scripts/bootstrap.ts` green — **8 indexes ensured + READY** (no index added)
- [ ] Engineering: `npx tsx scripts/verify-lifecycle.ts` green — counts pasted in TEST_MATRIX (§G goldens no regression)
- [ ] Engineering: `npm run verify` green against OUR server on **3151** — counts pasted in TEST_MATRIX (§P no regression; upstream 3111 untouched)
- [ ] Engineering: NEW evidence — §P concurrent distinct-variants test (RL-001 acceptance: no lost append) + §P heal test (F-01 acceptance: guard path links C, content unchanged) + §G `missingConcepts` goldens
- N/A: security (no auth/data-surface change — internal reads only, no new env, no secret handling change) / finance / legal / marketing / people / revenue
- [ ] Docs (second lane): CONTRACT §2 gains `getMemoryById`/`memoryConcepts`/`linkMemoryConcepts` + §3 tier-1 (a)/(b) re-baselined — deltas reported verbatim by this lane, files untouched here
