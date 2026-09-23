# Risk Review: P1 remainder + P3.2 (REQ-P1-4 / P1-2 / P1-5 / P3.2 / docs v1.2)

**Reviewer:** review-risk (independent engineering-domain reviewer)
**Date:** 2026-09-23
**Verdict:** pass
**Repo/commits reviewed:** `/mnt/DATA/GitHub/agent-memory` — `d17294b..HEAD`
(`591c79c`, `39fec28`, `df39d7d`, `c69636d`, `2deda68`) — review-only, no code
edits; test evidence taken from `TEST_MATRIX.md` per gate rules (write-path
suites not re-run).

## Checklist

- [x] Blast radius analysis bounded and verified — write path (`remember`)
  gains one probe + one in-place update; search path gains a tie-break input;
  consumers traced end-to-end (REST, MCP, hooks, both plugins). See RK-001,
  RK-006.
- [x] Backward compatibility preserved (no breaking API/schema shifts without
  ADR) — `RememberResult` gains are additive (`consolidated`), `importance`
  stays accepted (caller wins), no schema/index change (8 indexes unchanged,
  `updateMemoryContent` reuses #6/#7/#8 — `db/queries.ts:516-531`). Recorded
  decision = CONTRACT v1.2 amendment + CHANGELOG v0.5.0 (frozen-contract
  amendment plays the architecture-record role; ADR-0001 still covers dedup).
  One doc surface still asserts the retired default → RK-003.
- [x] Dependencies pinned; zero critical/high CVEs or supply-chain hazards —
  `package.json` diff = version bump + 2 scripts only; lockfile version-only;
  no new runtime dependency (`eval` corpus is in-repo, zero network).
  `gitleaks` local binary unavailable (declared) → CI P0.2 secret scan
  enforces on push (accepted, plan security line).
- [x] Rollback determinism proven (revertible ≤15 min) — 5 separable commits,
  additive env knob (`AGENT_MEMORY_MERGE_JACCARD`) leaves no index/build
  artifacts, `eval/`+`skills/` deletable (plan Rollback Points). Code revert
  clean; already-merged rows not restorable — RK-002 (accepted-with-owner).
- [x] Architectural contract invariants intact — no `ARCHITECTURE.md` in repo;
  CONTRACT §0 verified facts serve that role and are unchanged except the
  accurate dedupKey-rewrite note (`docs/CONTRACT.md:60`). Invariants hold:
  stored `importance` never rewritten (merge updates content/embedding/
  dedupKey only, `db/queries.ts:546-550`; decay/boost order-only,
  `src/search.ts:136-160`), dedup/merge first-wins with no Session node
  (`src/store.ts:614-651`), fail-closed posture consistent.
- [x] Zero unmitigated regression risk across touched systems — no unmitigated
  **High+** residual; 6 findings below (2 open Mediums, 2 accepted, 2 Low).

## Risk Assessment Matrix

| ID | Risk Dimension (location) | Severity | Likelihood | Evidence | Mitigation | Residual | Owner | Status |
|----|---------------------------|----------|------------|----------|------------|----------|-------|--------|
| RK-001 | **In-process concurrent merge can lose one append (silent false-success write).** `src/store.ts:646-651` known-limit docstring; `consolidateInto` computes `nextContent` from the probe's `survivor.content` (read) then `setProperty` (write) — the per-key FIFO lock keys on the INCOMING dedupKey, so two concurrent saves of different variants pick the same survivor under different locks: the second write overwrites the first's append while both return `201 consolidated:true`. This is a data-loss window at the concurrency level, contradicting the plan's "riesgo de pérdida de texto = 0" and CONTRACT §3's unconditional "content is CONCATENATED (never discarded)" (`docs/CONTRACT.md:231`), which carries NO concurrency exception. Recoverable (caller still holds the incoming text; re-save re-merges), no survivor content destroyed. | **Medium** | Low (needs concurrent near-dup variant writes; hooks fire detached POSTs) | `src/store.ts:646-651`; `src/store.ts:556-565` (probe→merge); `docs/CONTRACT.md:231` vs store docstring | Code docstring documents the limit; substring guard and id-stability bound blast radius; cross-process case already covered by RL-001 accepted risk | Medium → Low-Med after disclosure | engineering | **open** — contract-level disclosure of the in-process lost-append exception (or cross-key serialization) needed; not yet a contract-registered accepted risk |
| RK-002 | **Merge ON by default mutates survivor rows in place, irreversibly, in any deployment.** ON default `AGENT_MEMORY_MERGE_JACCARD` absent → 0.9 (`src/consolidate.ts:47-53`); `updateMemoryContent` rewrites content/embedding/dedupKey with no versioning/undo (`db/queries.ts:539-556`). Plan accepts non-reversibility scoped as "dev-instance data only" (`IMPLEMENTATION_PLAN.md:56-61`) — an assumption that understates the shipped default: every deployment's prod data is merged on upgrade. Content is append-only (verified: `mergedContent` = survivor + "\n" + incoming, `src/consolidate.ts:74-79` — never discards; substring guard closes re-merge loop), survivor `memoryId`/origin/importance/createdAt untouched, probe4 VERDICT A proves index refresh. | **Medium** impact / **Low** residual | Medium (every near-dup save) | `src/consolidate.ts:74-79`; `src/store.ts:651-706`; `IMPLEMENTATION_PLAN.md:56-61`; TEST_MATRIX T-202 | Concatenation-never-discards + fail-closed asserts on empty anchor/updated (`src/store.ts:685-704`) + env off-switch + explicit plan assumption | Low-Med | engineering | **accepted-with-owner** — assumption stated in plan Rollback Points (owner: engineering); recommend carrying the "merges are not reversible" note into CONTRACT §3 |
| RK-003 | **Behavior change `importance=0.5` default retired — code consumers clean, README still asserts the old default.** Verified clean: hooks NEVER sent `importance` (`hooks/capture.mjs` grep `importance` → 0 matches; payload = content/project/sessionId/origin only, `hooks/capture.mjs:121-148`) — hook captures now derive 0.55+bonus, intended and contract-documented; OpenCode plugin fixed client-side (`DEFAULT_IMPORTANCE` removed, conditional spread, `plugins/opencode/plugins/agent-memory.ts:693-704`); REST/MCP pass the raw optional (`src/server.ts:267-272`, `src/mcp.ts:159-164`); antigravity recall only READS/displays `importance` (`plugins/antigravity/scripts/recall.mjs:249-251`). NOT clean: `README.md:136` still documents `importance=0.5` as a request default — a direct contradiction of CONTRACT v1.2 ("The old `importance=0.5` default is retired", `docs/CONTRACT.md:176`); README REST table rows for `remember`/`lesson` omit the new `consolidated` field (`README.md:133`) while CONTRACT and all 8 skills carry it; README example rows show `importance:0.5` (legacy captures from 2026-09-22 — accurate as captures, misleading as re-runnable expectations for concept-bearing writes). | **Medium** (doc contradicts frozen contract on a shipped behavior change; no code breaks) | Medium (README is the primary consumer reference) | `README.md:133,136` vs `docs/CONTRACT.md:157,176` vs `skills/remember/SKILL.md:24` | Contract v1.2 + CHANGELOG + skills all correct; `verify.ts` §O pins derived≠0.5 behavior | Medium | docs (orchestrator owns shared docs) | **open** — README defaults line + `consolidated` response fields need correction |
| RK-004 | **Per-process recall ledger skew across multi-writer deployments.** Ledger is a module-level Map (cap 10 000, clear-on-overflow), never persisted, per-process (`src/confidence.ts:86-104`); REST and MCP writers each hold their own ledger → different surfaces can order exact RRF ties differently, and a restart/overflow wipes history. Contract discloses this explicitly: "best-effort, PER-PROCESS: counts reset on restart and are not shared across writers" (`docs/CONTRACT.md:246-248`). RL-001 single-writer assumption still holds unchanged for dedup (`docs/CONTRACT.md:210-214`, owner: engineering, cross-process out of contract, P4.3 planned). Impact bounded by design: boost applies ONLY after RRF score (`src/search.ts:136-160`), capped at +0.2 asymptote, stored `importance` never rewritten — skew degrades to pre-boost order, never correctness. | **Low** | Medium (any multi-process or restart deployment) | `src/confidence.ts:86-104`; `src/search.ts:136-160,238-244`; `docs/CONTRACT.md:210-214,246-248` | Contract-level disclosure; tie-break-only + cap + idempotent ledger reads; single-writer assumption formally recorded with owner | Low | engineering | **accepted-with-owner** — CONTRACT v1.2 accepted-risk record (owner: engineering) |
| RK-005 | **Eval scorecard misreading: perfect 1.0000 grid without an explicit corpus-specificity disclaimer.** `docs/benchmarks/SCORECARD.md:20-23` shows R@5/R@10/MRR/nDCG = 1.0000 for both modes. The artifact DOES state corpus provenance (`:10` "eval/corpus.ts — 40 documents, 15 queries … in-repo, deterministic") and "our measurements, nothing borrowed" (`:3-4`), and the harness has a discriminative sanity gate (recall-0 fails loudly, `scripts/eval.ts:649-654`); but nowhere does the scorecard say the perfect scores are **corpus-specific / not a general retrieval-quality claim** — that disclaimer exists only as a parenthetical in TEST_MATRIX T-203, not in the published artifact a reader would cite. Small hand-built corpus with qrels designed around the docs makes 1.0000 expected-by-construction; a reader skimming the table can over-claim. | **Low** | Medium (headline table invites quoting) | `docs/benchmarks/SCORECARD.md:10,20-23`; `TEST_MATRIX.md:14` (claim lives in matrix, not artifact); `scripts/eval.ts:401-441` (generator has no disclaimer line) | Corpus/method/date/server all stamped in the artifact header; no upstream numbers claimed; decoy query proves discrimination (T-203) | Low | ops (eval harness) | **open** — add a one-line "scores are specific to this in-repo corpus" disclaimer to the generator (backlog) |
| RK-006 | **Probe query cost + write-availability coupling on the hot remember path.** Every remember that misses exact dedup runs `searchByText(content, k=20)` with the incoming content passed VERBATIM as `q` — up to 200k chars → very large probe query, code-flagged "documented residual" (`src/store.ts:555-565`). Probe errors PROPAGATE: a text-index failure now fails NOVEL WRITES (before, remember needed only dedup pre-check + insert) — a partial-index outage (`index_not_found` before bootstrap) changes from "search degraded" to "writes fail". Contract discloses the fail-closed posture (`docs/CONTRACT.md:224-227`). No latency/throughput measurement exists for the added read on the write path (functional suites green per TEST_MATRIX — 212/212, 86/86; not a perf baseline). | **Medium** (conditional perf/availability impact) | Medium (every novel write pays it; failure mode needs index trouble) | `src/store.ts:556-565`; `src/store.ts:555` (200k residual); `docs/CONTRACT.md:224-227`; `src/consolidate.ts:47-53` (fail-closed OFF) | Disclosed in code + contract; env off-switch (invalid value → OFF, fail-closed); probe scoped k=20, project-scoped, runs BEFORE embed (no wasted embed on merge); same fail-closed family as existing dedup pre-check | Low-Med (perf unmeasured) | engineering | **accepted-with-owner** — documented residual in CONTRACT §3 + `src/store.ts` (owner: engineering); perf baseline deferred, no expiry set |

## Verdict Rationale

**✅ pass — 6 findings, 0 unmitigated High+, 0 Critical.** The weighted
concerns were each verified against code, not claims: (1) in-place survivor
mutation is concatenation-never-discard at the content level (verified in
`mergedContent`, `src/consolidate.ts:74-79`) with fail-closed write asserts
and a stated plan assumption, but the plan/contract "zero text loss" claim
holds only outside concurrency — the in-process lost-append window (RK-001,
Medium, open) needs contract-level disclosure with owner, and merge
irreversibility under the ON default is accepted-with-owner per the plan
(RK-002); (2) the `importance=0.5` retirement is clean across every CODE
consumer (hooks never sent it — verified by grep; plugin fixed client-side —
verified in `2deda68`'s plugin hunk (`git log d17294b..HEAD -- plugins/` → only
`2deda68` touches the plugin; T-201 attributes the fix to `591c79c` — commit
attribution drift, informational); server/MCP pass raw optional), while
`README.md:136` still asserts the retired default and its route table omits
`consolidated` (RK-003, Medium, open — docs owner); (3) recall-ledger skew is
explicitly disclosed per-process in CONTRACT v1.2 (`:246-248`), bounded to
tie-breaks behind the winning RRF score, and RL-001's single-writer contract
still holds verbatim with named owner (RK-004, accepted); (4) the scorecard
stamps corpus provenance but lacks an explicit "corpus-specific" disclaimer
in the published artifact (RK-005, Low, open); (5) the k=20 probe on every
novel write — including its fail-closed write coupling and the 200k-char
query residual — is documented in code and contract with an off-switch but
has no perf baseline (RK-006, accepted-with-owner). Backward compatibility,
dependency hygiene, ≤15-min code rollback, and CONTRACT §0 invariants all
verify; the two open Mediums (RK-001 contract disclosure, RK-003 README
correction) are documentation-accuracy follow-ups for their named owners and
do not carry exploitation, production-outage, or High+ impact — residual
risk is explicit, every risk has an owner, nothing is silently passed.
