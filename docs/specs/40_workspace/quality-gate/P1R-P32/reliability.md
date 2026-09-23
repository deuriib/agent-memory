# Reliability Review: P1R-P32 (P1.4 + P1.2 + P1.5 + P3.2)

**Reviewer:** review-reliability (independent engineering-domain reviewer)
**Date:** 2026-09-23
**Verdict:** conditional (4 findings → COND-001..004)

**Scope reviewed:** `git diff d17294b..HEAD` = `591c79c` (REQ-P1-4),
`39fec28` (REQ-P1-2), `df39d7d` (REQ-P1-5), `c69636d` (REQ-P3-2),
`2deda68` (docs). Evidence cross-referenced against `TEST_MATRIX.md`
T-201..T-206 (suites NOT re-run — write-path suites are evidence-by-matrix;
this review is read-only).

## Checklist

- [x] **Error paths handled explicitly** — fail-closed throws on dedup
      pre-check shape drift (`src/store.ts:508-518`), saveMemory missing
      `memory` return (`src/store.ts:604-606`), updateMemoryContent missing
     /empty `memory`/`updated` branches (`src/store.ts:691-706`); near-dup
      probe errors PROPAGATE (`src/store.ts:556-563`, no try/catch — same
      posture as the dedup pre-check, contract §tier-1 `docs/CONTRACT.md:224-227`).
- [x] **No swallowed exceptions** — per-source catches in `src/search.ts`
      record `signals` (declared degraded mode: all-down ⇒ 200 + empty +
      signals, module docstring); harness catches convert to
      `status:-1` + `logSafeNote` then `abort()`/`exit 1`
      (`scripts/eval.ts:144-146`, `scripts/verify-skills.ts:257-259`);
      JSON-parse fallbacks keep the raw body (value preserved, not dropped).
      No empty catch found that hides a failure.
- [x] **Input validation at boundaries** — REST `z.strict()` bodies,
      `importance` bounded `min(0).max(1)` (`src/server.ts:45,71-80`),
      `content` `min(1).max(200_000)` (`src/server.ts:38`); MCP mirrors both
      (`src/mcp.ts:40,82`); eval narrows every response with zod and never
      trusts the envelope (`scripts/eval.ts:153+`); bad
      `AGENT_MEMORY_MERGE_JACCARD` ⇒ OFF fail-closed
      (`src/consolidate.ts:47-53`, goldens §G).
- [ ] **Deterministic behavior (no hidden state)** — PARTIAL: survivor pick
      is locale-free deterministic (`src/store.ts:415-445`), tie order frozen
      with one fixed clock (`src/search.ts:133-160`), but the recall ledger is
      deliberate process-local hidden state affecting tie order
      (`src/confidence.ts:86-100`), declared at contract level
      (`docs/CONTRACT.md:242-249`) — unqualified determinism claim in the
      eval harness → **RL-004**.
- [x] **Edge cases tested (empty, null, max, boundary)** — `verify-lifecycle`
      §F (`:355-518`: bases, hook-prefix boundary, 8-concept cap, negative
      counts, clamp, boost identity/monotonic/asymptote, ledger 10k-cap +
      empty-id + reset) and §G (`:520-649`: jaccard empty/empty ⇒ 0,
      exact-float 10/11 golden, threshold fail-closed ×6 inputs, threshold
      boundary `>=`, substring guard, re-merge loop, whitespace collapse) —
      86/86 per T-201/T-202.
- [x] **Idempotency where required** — exact-dedup first-wins returns the
      same id (`src/store.ts:521-543`); substring guard makes re-saving the
      merged text a no-op (`src/consolidate.ts:74-79`); eval seed pass 2 =
      40/40 `deduped` (`docs/benchmarks/SCORECARD.md:14`); a `send()` timeout
      that leaves an orphan write in flight self-heals on retry via those
      same two guards. `noteRecall` increment-per-call is intentional
      (counter semantics, documented `src/confidence.ts:91-95`).
- [x] **Timeouts on external calls** — store queries 15 s
      (`src/store.ts:44,387-401,454-456`); eval harness 10 s
      (`scripts/eval.ts:71,128-133`); verify-skills 10 s
      (`scripts/verify-skills.ts:241-245`).

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | Dedup pre-check / near-dup probe lookup errors or shape drift | remember throws (fail-closed), never proceeds to write | yes — `src/store.ts:508-518,556-563`; contract `:224-227` |
| FM-002 | `saveMemory`/`updateMemoryContent` silent no-op write | throw, never report success for nothing written | yes — `src/store.ts:604-606,691-706` |
| FM-003 | Two concurrent remembers of the SAME content | per-key FIFO serializes; waiter re-runs pre-check, same id returned | yes same-process (`src/store.ts:474-487`, verified "race → same id" T-205); cross-process declared out-of-contract with owner (`docs/CONTRACT.md:210-214`) |
| FM-004 | Two concurrent remembers of DIFFERENT near-dup variants picking the SAME survivor (distinct dedupKeys ⇒ no serialization) | both appends preserved; both callers get `consolidated:true` only if written | **no — one append can be silently lost → RL-001** |
| FM-005 | Near-dup probe matches a TTL-EXPIRED survivor (TTL filter is app-side, applied only in `src/search.ts` wrappers) | fresh incoming must not be merged into a search-hidden row | **no — fresh content becomes search-invisible (purged later if purge runs) → RL-002** |
| FM-006 | Recall ledger at 10k cap / server restart / REST-vs-MCP process split | declared degradation: tie-break falls back to pre-recall order; never correctness | yes, declared — `src/confidence.ts:86-98`, `docs/CONTRACT.md:246-248` |
| FM-007 | Warm recall ledger during a benchmark run reorders exact RRF ties | determinism claim qualified | **partial → RL-004** |
| FM-008 | All search sources down | 200 + empty results + `signals`, never 500 | yes — `src/search.ts` module docstring; archived review-resilience |
| FM-009 | `send()` 15 s timeout with the write still in flight upstream | caller gets an error; retry converges via dedup / substring guard | yes (idempotent-retry property) |
| FM-010 | Bad `AGENT_MEMORY_MERGE_JACCARD` (≤0, ≥1, non-finite, `""`) | consolidation OFF, straight to insert — never invents a threshold | yes fail-closed — `src/consolidate.ts:47-53`, §G goldens |
| FM-011 | Harness HTTP hang | `AbortSignal.timeout(10s)` ⇒ `status:-1` ⇒ abort/exit 1 with runbook | yes — `scripts/eval.ts:71,144-146`; `scripts/verify-skills.ts:245,348-384` (identity guard BEFORE first write) |
| FM-012 | `embed()` wrong dims on merge re-embed | `RangeError` before any write | yes — `src/store.ts:665-668` |
| FM-013 | ≤200k content sent verbatim as BM25 probe `q` on every remember; probe failure now fails WRITES (text-index health became a write-path dependency) | bounded (15 s) + documented | declared in code + contract, but ops runbook frames bootstrap as a SEARCH fix → **RL-003** |
| FM-014 | Harness pointed at the upstream/foreign server | identity guard (recap ⇒ 200) aborts before any write; exit 1 | yes — `scripts/eval.ts:20-25`, `scripts/verify-skills.ts:348-384` |
| FM-015 | True near-dup ranked outside BM25 top-20 | no candidate ⇒ plain insert (duplicate row possible) | yes, by design — k=20 declared in plan step 2 + contract `:224-227` |
| FM-016 | Eval scores read as general retrieval quality | artifact itself pins corpus + method, claims no upstream numbers | yes, declared — `docs/benchmarks/SCORECARD.md:3-16`, `TEST_MATRIX.md` T-203 "corpus-specific" |

## Declared-Risk Assessment (the four handed from the lanes)

| Declared risk | Honest assessment | Disposition |
|---|---|---|
| Concurrent DISTINCT near-dup variants can lose one append | Real, silent (both callers receive `consolidated:true`), and the plan's unqualified zero-loss invariant (`IMPLEMENTATION_PLAN.md:16`, `:60`) is contradicted by the code's own known-limit note (`src/store.ts:646-649`). Documented only in a code docstring — absent from CONTRACT §tier-1, README Known limitations, and ROADMAP; no owner/expiry recorded. | **Finding RL-001 (Med) → COND-001** |
| Recall ledger is per-process, resets on restart | Declared at contract level verbatim (`docs/CONTRACT.md:246-248`) and scoped to tie-break only — ranking degrades, correctness never does. Acceptable trade-off. Residual: the eval harness's unqualified determinism claim (`scripts/eval.ts:34-35`). | Declared ⇒ FM-006 handled; claim gap ⇒ **RL-004 (Low) → COND-004** |
| Large-content probe uses full content as `q` | Declared (`src/store.ts:553-555`), bounded by the 15 s timeout, fail-closed is contract-declared. Under-assessed part: with tier-1 ON, an `index_not_found` condition now fails WRITES too, while the runbook (`scripts/eval.ts:47-48`, `:481`) tells operators bootstrap fixes *searches*. | **RL-003 (Low) → COND-003** |
| Eval scores are corpus-specific (perfect 1.0s) | Disclosed on the artifact face (corpus row `SCORECARD.md:10`, "our measurements, nothing borrowed" `:3-4`, "no upstream numbers claimed" `docs/CONTRACT.md:432-435`, matrix T-203) and the decoy query returning 0 proves discrimination. A reader can still over-read 1.0000, but no document claims generality. | Accepted/documented ⇒ FM-016, **no finding** |

## Findings

| ID | Severity | Location | Finding | Evidence | Owner |
|----|----------|----------|---------|----------|-------|
| RL-001 | Medium | `src/store.ts:545-567,646-649` vs `IMPLEMENTATION_PLAN.md:16,60` | **Concurrent distinct-key near-dup merges silently lose one append.** The per-key FIFO lock serializes only identical content (same `dedupKey`); two concurrent saves with different variants that pick the same survivor both read the pre-merge content and both `setProperty` — last writer wins, the loser's text is never stored anywhere (merge creates no new row), and BOTH callers receive 201 `consolidated:true`. This breaks the plan's unqualified invariant "riesgo de pérdida de texto = 0 / concatenation never loses text", and neither CONTRACT §tier-1 (`docs/CONTRACT.md:230-231` states only "runs under the same per-key FIFO lock") nor README Known limitations mentions the distinct-key race; no ROADMAP ticket/owner/expiry exists for it (grep over ROADMAP: 0 matches). Assumption stated: severity Medium (not Critical) because the window is concurrency-gated on a declared single-writer local deployment and the lane declared the limit — it would be High the moment multi-instance (P4.3) lands. | diff `39fec28` + `git grep -n concurrent README.md docs/CONTRACT.md ROADMAP.md` (only same-id race + P4.3 rows) | engineering owner (lane A) |
| RL-002 | Medium | `src/store.ts:556-563` (raw `searchByText` probe) + `src/store.ts:415-445` (`pickSurvivor` — no TTL check) | **Near-dup probe can merge a fresh write into a TTL-expired survivor.** TTL hiding is app-side and applied ONLY in the `src/search.ts` wrappers (`filterExpired` at `:101`/`:238`); the remember probe calls the raw store query, which returns expired rows (proven by RF-020: expired rows still crowd results pre-filter). With `AGENT_MEMORY_MERGE_JACCARD` default-ON and `AGENT_MEMORY_TTL_DAYS` opted-in, a fresh near-dup write is concatenated into an expired row, reports `consolidated:true`, and becomes invisible to every search path (TTL filter drops the row) and absent from the caller's session listing (no Session node on merge). Worse, a subsequent `purge.ts` run (a *destructive* TTL purge, `scripts/purge.ts:2`) deletes the survivor — destroying the fresh content = conditional data loss. This TTL×merge interaction is documented NOWHERE (repo-wide grep `expired.*consolidat\|TTL.*merge` ⇒ 0 hits outside unrelated archive files). Assumption stated: Medium because both features beyond merge-ON are opt-in (TTL default OFF). | diff `39fec28`; `src/search.ts:101,238`; `docs/CONTRACT.md:255-259` (TTL read-time); `scripts/purge.ts:2` | engineering owner (lane A) |
| RL-003 | Low | `src/store.ts:553-567`; `scripts/eval.ts:47-48,481` | **Write-path operational blast radius under-documented.** With tier-1 ON, every `remember` depends on text-index health (probe errors propagate by design) and sends the full content (≤200k, `src/server.ts:38`) as the BM25 `q`. Both are declared in code/contract and bounded by the 15 s timeout, but the only operator guidance frames `index_not_found` as a *search* problem with a one-command bootstrap fix — operators hitting 500s on writes would not connect it. Docs-only gap. | diff `39fec28` + `git grep -n index_not_found` | engineering owner (lane A) / ops |
| RL-004 | Low | `scripts/eval.ts:34-35` (+ scorecard Reproduce `docs/benchmarks/SCORECARD.md:51-62`) | **Determinism claim not qualified for server-side hidden state.** "No randomness anywhere — identical inputs produce identical numbers" ignores the server's per-process recall ledger (`noteRecall` on every returned row, `src/search.ts:105,244`), which reorders exact RRF ties and therefore varies with server warm history/restart — and REST vs MCP are separate processes with separate counts (declared `docs/CONTRACT.md:246-248`). Empirical impact here was nil (both runs saturated at 1.0000, T-203), so the claim needs a one-line qualification, not a redesign. | diff `df39d7d`; `src/confidence.ts:86-100` | engineering owner (lane B) |

**Findings count: 4** (2 Medium, 2 Low; 0 Critical/High). Every finding
carries diff/scan evidence; none is REFUTED.

## Conditions to Clear (COND)

- **COND-001 → RL-001:** Either (a) **default**: re-read the survivor's
  content inside the write path (or serialize on survivor `memoryId`) so
  concurrent variants concatenate both texts — OR (b) documented acceptance:
  add the in-process distinct-key race to `docs/CONTRACT.md` §tier-1 **and**
  README Known limitations with owner (engineering) + ROADMAP ticket/expiry,
  and correct the unqualified zero-loss claims at `IMPLEMENTATION_PLAN.md:16`
  and `:60`. Clear when the docs diff shows the caveat and no unqualified
  "text loss = 0" claim remains. Breaks the (b) option: any move toward
  multi-instance (P4.3) — then (a) is mandatory.
- **COND-002 → RL-002:** **Default**: skip TTL-expired candidates in
  `pickSurvivor` (apply the same `AGENT_MEMORY_TTL_DAYS` rule at probe time;
  pure, golden-testable in §G) — OR explicitly declare the TTL×merge
  combination unsupported in `docs/CONTRACT.md` §tier-1 + README (stating that
  fresh writes can enter expired rows and `purge.ts` will delete them), with
  owner + expiry. Clear when either the guard exists (plus a golden) or the
  declaration lands. A silent, undocumented state does not clear.
- **COND-003 → RL-003:** README runbook/limitations states that with tier-1
  ON an unhealthy text index fails **writes** too (remember is fail-closed),
  that `bootstrap.ts` restores writes, and that the probe sends the full
  content (≤200k) as `q` (bounded by 15 s). Clear on README diff.
- **COND-004 → RL-004:** Qualify the determinism claim in
  `scripts/eval.ts:34-35` and the scorecard Reproduce notes: identical
  numbers hold for identical server recall-ledger state (per-process; resets
  on restart). Clear on one-line diff.

## Verdict Rationale

Conditional — not pass, not closed. The core reliability posture of this
lane is genuinely strong and evidence-backed: fail-closed error paths
throughout the write chain (shape asserts on all three write queries), a
15 s timeout on every store call and 10 s in both harnesses, strict zod
boundaries on REST/MCP including the now-optional `importance`, idempotent
retries via dedup + the substring guard, identity guards before any harness
write (upstream 3111 protected), and §F/§G pure goldens covering empty,
boundary, negative, cap, and fail-closed env cases (86/86 per T-201/T-202;
212/212 and 119/119 per T-201..T-204). Of the four declared risks, two
assess as properly declared-and-handled (ledger, corpus-specific scores)
and two are real but bounded: the concurrent lost append (RL-001) is
code-documented yet contradicted by the plan's zero-loss invariant and
missing from user-facing docs, and the TTL×merge interaction (RL-002) is
undeclared anywhere and can escalate to purge-time deletion of fresh
content. Neither is Critical on a single-writer local deployment with
default-OFF TTL — both are condition-clearable via a small guard or an
explicit owner-stamped acceptance, so ⚠️ COND-001..004 is the honest
verdict; if the orchestrator requires code remediation rather than
documented acceptance for RL-001/RL-002, this verdict escalates to closed.
