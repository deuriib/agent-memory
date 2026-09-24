# Reliability Review: REQ-RL-001 + REQ-F-01 (residual-closure lane)

**Reviewer role:** review-reliability (independent gate reviewer, R1-engineering/reliability)
**Date:** 2026-09-24
**Scope (commits, unpushed on main):** `01224cc` (REQ-RL-001 — per-survivor FIFO lock + fresh re-read), `a0257d6` (REQ-F-01 — post-write verify + ONE heal), `fb8e661` (docs: CONTRACT v1.5 + README + CHANGELOG). Diff under review: `a9ef417..HEAD`.
**Review criteria applied:** `frame-ship/skills/quality-gate/references/engineering/reliability-review.md` (packet named `reliability.md`; actual filename is `reliability-review.md` — applied as the authoritative checklist).
**Verdict:** ✅ **pass**

**Rules honored:** review-only (no code/script/test edits — this report is the only file written), no Helix restart/stop/upgrade, upstream `:3111` untouched, no memory content / secrets / embeddings printed, no write probes created (all evidence read-only or self-cleaning suites).

---

## Checklist

- [x] **Error paths handled explicitly** — every new send() has a fail-closed shape assert: **4/4 new call sites, 12 asserts** vs actual return shapes (see Findings evidence + F-00 below). No `try/catch` exists anywhere in `src/store.ts`, `src/consolidate.ts`, `db/queries.ts` (grep: zero matches) → nothing can be swallowed.
- [x] **No swallowed exceptions** — all verify/heal/fresh-read errors propagate out of `remember` → `respondToError` → HTTP 500 + `logSafeNote` access log (`src/server.ts:425-448`); queue tails swallow only *predecessor* rejections, never the caller's own result (`src/store.ts:524-531`).
- [x] **Input validation at boundaries** — server zod `rememberBodySchema` (`src/server.ts:71`), `defineParams` typed params for the 3 new queries (`db/queries.ts:543-547,565-569,602-606`), `EMBED_DIM` RangeError asserts (`src/store.ts:640,777`), content-type / id-match asserts on fresh reads (`src/store.ts:856,864`).
- [x] **Deterministic behavior (no hidden state)** — `missingConcepts` is pure, deduped, code-unit sorted → order-independent goldens (`src/consolidate.ts:85-105`, `scripts/verify-lifecycle.ts` §G: shuffled-input byte-identical); survivor pick is deterministic (jaccard desc → importance desc → memoryId asc, `src/store.ts:436-462`).
- [x] **Edge cases tested (empty, null, max, boundary)** — §G empty-linked/empty-incoming goldens; `null` vs `[]` miss shapes handled on every new read (`src/store.ts:843-850,937-941`); rows without `name` → `""` never matches a non-empty expectation (`src/store.ts:942-946`); TTL fence (strict `>`; unparseable `createdAt` kept) `src/lifecycle.ts:107-120`; `createdAt` IS projected by `getMemoryById` via `memoryRowProjection` (`db/queries.ts:104-112`) so the expired-while-waiting check can actually fire.
- [x] **Idempotency where required** — the ONE heal re-sends the identical `updateMemoryContent` (setProperty idempotent, `src/store.ts:889-916`), the link heal upserts Concepts unconditionally, and read-side `.dedup()` masks duplicate edges (`db/queries.ts:579`); a committed-but-unverified retry converges through the substring guard → `ensureConceptLinks` (`src/store.ts:753-764`).
- [x] **Timeouts on external calls** — all sends (incl. every new read/write) go through `withTimeout(…, QUERY_TIMEOUT_MS=15_000)` (`src/store.ts:50,410-424,477-478`): 4/4 new call sites covered. Caveat recorded as F6 (timer does not abort the in-flight fetch).

### New send() call sites vs return shapes — count

| # | Call site | Query | Declared returns (CONTRACT v1.5 §2) | Fail-closed asserts | Evidence |
|---|-----------|-------|--------------------------------------|---------------------|----------|
| 1 | `getFreshSurvivor` | `getMemoryById` | `["memory"]` | 5: hasOwn; wrong-type; row-miss ("vanished"); wrong memoryId; non-string content | `src/store.ts:835-868` |
| 2 | `sendMergedUpdate` | `updateMemoryContent` | `["memory","updated"]` | 3: hasOwn both; empty anchor; empty `updated` branch | `src/store.ts:897-915` |
| 3 | `readLinkedConcepts` | `memoryConcepts` | `["names"]` | 2: hasOwn; wrong-type ("must never be read as all linked") | `src/store.ts:928-941` |
| 4 | `ensureConceptLinks` | `linkMemoryConcepts` | `["memory"]` | 2: hasOwn; anchor presence (`indicatesPresence`) + real gate = caller's re-read | `src/store.ts:968-984` |

**4/4 covered, 12 asserts total.** Each assert names the contract clause it enforces. `null` is a legitimate miss only where documented (dedup pre-check, `src/store.ts:575`); in `getFreshSurvivor` a `null`/empty return throws "vanished" — correct fail-closed (the row is required to exist).

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | Shape drift on a new query's return | Throw naming contract §2 fail-closed | yes (4/4 sends, 12 asserts) |
| FM-002 | Rejected predecessor poisons a FIFO queue | Tail settles resolved; next waiter runs normally | yes (`src/store.ts:524-527`; no `await` between `tails.get` and `tails.set` at 522-528 → no lost-serialization interleave) |
| FM-003 | `dedupTails` / `survivorTails` Map growth | Entry deleted when its own tail is still head; both locks share `withFifoLock` | yes (`src/store.ts:532`; maps bounded by in-flight waiters; every call path hits `finally`) |
| FM-004 | Survivor expires while queued on survivor lock | Never absorbs a fresh write → fall through to plain insert | yes (`src/store.ts:745-751` → `:633`; env re-read per `filterExpired` call, `src/lifecycle.ts:107-120`) |
| FM-005 | Survivor deleted mid-merge (forget race / cross-process) | Fail-closed throw, never merge onto absent row | yes (`src/store.ts:851` vanished; `:907` empty anchor; `:981` link anchor) |
| FM-006 | Helix restart / degradation mid-verify | Per-send 15s timeout → error propagates → HTTP 500, locks released, no queue poisoning, server stays up | yes (`src/store.ts:410-424,477-478`; `src/server.ts:441-448`; REAL incident: container restart window in this lane → `internal_error` on health/remember, re-run green — `TEST_MATRIX.md` incident note) |
| FM-007 | Partial mid-batch commit (content landed, links lost) | Post-write verify detects → ONE heal → re-verify → throw naming invariant | yes (`src/store.ts:1027-1039`; guard path `:764`) |
| FM-008 | Heal retry loop / non-convergence | Exactly ONE heal; no loop constructs anywhere; idempotent re-sends | yes (`src/store.ts:1029-1033` branch-exhaustive, `:964-991`; grep: no `while`/recursion in lane code) |
| FM-009 | Deadlock between the two nested locks | Fixed acyclic order dedupKey OUTER → survivor INNER; one survivor per merge; nothing acquires a lock under the survivor lock | yes (contract at `src/store.ts:495-503`; `consolidateInto:730-737`; `remember:545-548` takes only the dedup lock) |
| FM-010 | Write committed but verify read times out | 500 despite committed data (fail-closed direction); client retry converges via substring guard → `ensureConceptLinks` | yes (convergent; no duplicate row possible — guard is byte-identical, `src/store.ts:753-772`) |
| FM-011 | Cross-process concurrent writers to one Helix | OUT OF DECLARED SCOPE — in-process only, residual until P4.3 | declared (CONTRACT v1.5 §3 tier-1 (a); README #8; `src/store.ts:725-728`) — matches packet scope |
| FM-012 | Distinct variants lose an append (the original RL-001) | Survivor lock + fresh re-read; ALL appends land | yes — proven live: §P `rl-001:` 13 checks incl. "all three wordings verbatim" green in 243/243 run |
| FM-013 | Substring guard returns blind (the original F-01) | Guard path runs concept-link verify + heal, content byte-identical | yes — proven live: §P `f-01:` score delta == 1/61 + byte-identical content |

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| F1 | **Medium** | `ROADMAP.md:68`, `ROADMAP.md:70` vs `docs/CONTRACT.md` v1.5 amendment + `README.md` #8/#11 + `CHANGELOG.md` [Unreleased] | **Stale residual ledger.** RL-001/F-02/RK-001 and F-01 rows are still listed OPEN with expiry 2026-12-31, while CONTRACT §3 tier-1 (a)+(b) declare "**CLOSED 2026-09-24**", README declares "**REMEDIATED 2026-09-24**", and CHANGELOG records both fixes. The frozen contract and the tracking ledger now contradict each other: a reader trusting ROADMAP gets the wrong risk picture, and the dated re-review would fire for already-fixed residuals. Commit `fb8e661` covered CONTRACT+README+CHANGELOG only — ROADMAP closure appears deferred to ship-release; if so it must be an explicit handoff, not an omission. No runtime impact (proven by 243/243 + 113/113). Fix within sprint: close/mark both rows at ship-release with the same evidence pointers the contract uses. |
| F2 | Low | `src/store.ts:561,614,835,795,1018-1019,1030,1034` (calls) · `src/store.ts:50,477-478` (timeout) | **No aggregate deadline on the merge critical section.** One remember that reaches consolidation issues statically up to ~13 sequential 15s-bounded sends while holding dedupKey OUTER + survivor INNER locks — worst-case hold ≈ 195s against a slow-but-responding Helix, and waiters on that survivor convoy behind it. Strictly bounded (every call rejects by 15s → error propagates → `finally` releases → tail settles resolved; no deadlock, no leak), and the real degraded incident in this lane failed FAST (connection refused → immediate 500), but the lane multiplies merge-path calls ~3–4×, amplifying per-write latency under soft degradation. Availability-only, conditional on Helix slowness → Low. Hardening option: one overall deadline for the merge critical section. |
| F3 | Low | `src/store.ts:614-626` (stale pick) vs `src/store.ts:744-752` (fresh merge, no re-check) | **Survivor choice not re-validated under the lock.** Jaccard ≥ threshold is evaluated on the probe snapshot; the fresh re-read never re-runs `pickSurvivor`/threshold against the grown content, so late waiters in a deep queue merge below-threshold text into the survivor (lane's own N=3 worst case: 31/34 ≈ 0.912; N≥4 dips under 0.9). Consequence is append-only concatenation — **zero text loss**, deterministic — a threshold-semantics drift only. Not in declared scope of RL-001 (scope = no lost append). Low. |
| F4 | Low | `src/store.ts:746-751` → `src/store.ts:637-684` | **Expired-while-waiting fall-through does not re-probe.** Two distinct variants that both lose the same expired survivor each fall to plain insert without re-running the near-dup probe → up to N live near-dup rows in that window (TTL ON only; the expired row stays filtered from reads; dedup pre-check unaffected; a later save can still merge them). Narrow conditional window → Low. |
| F5 | Low | `db/queries.ts:556-558` (comment), `db/queries.ts:579-580` (`.dedup()`), heal writer `src/store.ts:968-974` | **Duplicate HAS_CONCEPT edges accumulate.** `conceptBody` links unconditionally, so repeated merges/heals on one survivor append parallel duplicate edges; `memoryConcepts` `.dedup()` masks it for correctness but edge count grows with merge count (traversal cost), with no edge-dedup/cleanup path (DAT-001's procedure cleans orphan Concepts, not dup edges). Mechanism pre-existed v1.2 and the lane documents it in the query comment; F-01 adds one more writer of the same kind → Low. |
| F6 | Low | `src/store.ts:410-424` | **`withTimeout` does not abort the in-flight request.** On timeout the underlying fetch runs to completion (no AbortController); the lane's added reads/writes under lock increase socket pileup exposure against a degraded Helix. Error propagation itself is correct (timeout → 500, locks released). Pre-existing helper, exposure multiplied by this lane → Low. |
| F7 | Low | `src/store.ts:753-772` (guard return), `src/store.ts:1022` (dedupKey invariant), `src/store.ts:873-876` (legacy `""` comment) | **Guard path never repairs a legacy/missing `dedupKey`.** The substring-guard return verifies/heals CONCEPT LINKS only; a pre-v1.2 keyless survivor hit by the guard stays keyless (invariant (b) is enforced only on the concatenation path, which writes the key first). Impact bounded: exact-dedup pre-check misses → re-saves route to consolidation → guard returns byte-identical → **no duplicate row, no data loss**; documented fail-toward-keeping read of `""`. Legacy/dev-instance data only → Low. |
| F8 | Low | `src/store.ts:524-532`; `scripts/verify-lifecycle.ts` §I | **No regression test for queue-poisoning recovery.** Non-poisoning is sound by construction (tail swallows predecessor rejection; delete-on-settle; get/set atomic with no intervening `await`), and §I proves a rejected predecessor *propagates to its caller* — but no test asserts a *subsequent* remember on the same key succeeds after that rejection. Test gap, not a code defect → Low. |

**Counts:** Critical 0 · High 0 · Medium 1 · Low 7 · **Total 8**. **Conditions: none** (verdict is pass; no `COND-RL-NN` issued).

## Verdict Rationale

All seven checklist items pass with file:line evidence: 4/4 new send() sites carry fail-closed shape asserts matched to their declared §2 return shapes (12 asserts), every new read/write is covered by the 15s `withTimeout`, both FIFO maps clean up on settle with no poisoning path and no get/set interleave, the two-lock order is fixed and acyclic (no deadlock), the heal is provably exactly-once with no loop construct (convergence forced by idempotent re-sends), TTL re-checks under the lock actually receive `createdAt` (`db/queries.ts:110`), and degraded-Helix behavior is fail-closed + queue-safe — corroborated by a REAL container-restart incident recorded in `TEST_MATRIX.md` that produced fast 500s, no lockup, and a green re-run. The original RL-001 and F-01 defects are closed with live E2E proof (`AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` → **243 passed, 0 failed**, incl. the 13 `rl-001:` concurrency checks and the `f-01:` 1/61 causality check).

No Critical or High finding exists; the single Medium (F1) is a docs-ledger inconsistency with zero runtime impact and a clear owner action (close ROADMAP §1.3 rows at ship-release). The seven Lows are bounded, narrow-window, pre-existing-mechanism, or test-gap items — none contradict the declared scope (in-process only, cross-process deferred to P4.3, which CONTRACT v1.5 §3 tier-1 (a), README #8, and `src/store.ts:725-728` all state explicitly). Conditions are therefore unnecessary: **pass**.

## Evidence Runs (2026-09-24, read-only / self-cleaning)

- `npm run typecheck` — exit 0, no errors.
- `npm run verify-lifecycle` — **113 passed, 0 failed** / `VERIFY PASS` (§G `missingConcepts` goldens + §I guard-path 5-send seam).
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` — **243 passed, 0 failed** / `VERIFY PASS` (§P `rl-001:` 13 checks + `f-01:` block incl. fused-score delta == 1/61; suites clean up their own rows via `forget`).
- `GET /memory/health?project=review-reliability` → `{"status":"ok","counts":{"memories":0,"sessions":0}}` — this review created **zero write probes**, so no `forget` cleanup was required.
- `grep catch src/store.ts src/consolidate.ts db/queries.ts` — no matches (no swallowed exceptions in lane code).
- `git diff a9ef417..HEAD --stat` — 11 files, +1149/−180; no route/MCP-tool/schema/index changes (`bootstrapIndexes` untouched, still 8).
