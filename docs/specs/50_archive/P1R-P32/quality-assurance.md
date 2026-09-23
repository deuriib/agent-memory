# Quality Assurance Review: P1 remainder + P3.2 (REQ-P1-4 / P1-2 / P1-5 / P3-2)

**Reviewer:** quality-assurance (independent engineering-domain QA — runs/recomputes the real suite; 1 subagent per reviewer, own checklist only)
**Date:** 2026-09-23
**Verdict:** ⚠️ conditional — COND-QA-01…04 (3 Medium, 1 Low)

Scope: lane `d17294b..HEAD` (`591c79c`, `39fec28`, `df39d7d`, `c69636d`, `2deda68`), lens = REQ-ID → test → artifact traceability for all six TEST_MATRIX rows (T-201..T-206), acceptance-criterion assertion matching, published-count reconciliation, tautology scan, deviation record. Review-only: no fixes anywhere except this file.

## Checklist

- [ ] **All acceptance criteria have tests** — 6/6 REQ-IDs traced, but 3 acceptance sub-criteria have NO test: MCP/plugin importance derivation (COND-QA-02), consolidation fail-closed-on-probe-error (COND-QA-03), eval metric correctness (COND-QA-01).
- [x] **All REQ-IDs traceable to test IDs** — 6/6 rows map to real test sections/artifacts (matrix below).
- [x] **Unit + integration + e2e coverage as appropriate** — unit (verify-lifecycle §F/§G, pure), integration (probe4 live decision gate, verify-skills structural), e2e (verify §O/§P, eval run, verify-skills live round-trips); the metric-unit exception is tracked as COND-QA-01, not a missing coverage *type*.
- [x] **Regression suite updated** — verify bar 152 → 212 and lifecycle 39 → 86 as published; capture/injection/env counts unchanged and independently re-derived (table below).
- [x] **No flaky tests introduced** — §O uses in-process stub stores (documented rationale: avoids float-equal RRF ties over two live indexes); §P/probe4/verify-skills use per-run nonces, isolated projects, memoryId-targeted assertions (rerun-safe, probe4.ts:25-28); eval smoke retries are bounded (5×2s) and fail loud. No new timing assertions.
- [ ] **Coverage threshold met** — no line/branch coverage tooling configured in this repo (no c8/nyc/istanbul in package.json): N/A, unmeasured, stated as such rather than assumed. Acceptance-criteria coverage: 6/6 rows traced; 3/6 rows conditional (T-201, T-202, T-203).
- [x] **Manual exploratory testing done (if applicable)** — probe4 IS the pre-implementation live exploratory gate (VERDICT A, 12 checks, wired only after); eval executed ×2 (Lane B + orchestrator re-run on 3151 per matrix).

## Traceability (REQ → test → artifact → would it FAIL if broken?)

| REQ-ID | Test ID | Test location | Type | Would a broken feature fail the test? | Status |
|--------|---------|---------------|------|----------------------------------------|--------|
| REQ-P1-4 | T-201 | verify-lifecycle §F (23 goldens, LIVE re-run 86/86) + verify.ts §O (22 = 17 checks + 5 shapes) + §D:393-397 | Unit + E2E | **Core YES**: wrong base/bonus/clamp → §F golden fails; store re-pinning 0.5 → §O rest-row `importance !== expected` fails (verify.ts:1050-1051); ledger/tie-break wiring broken → O5/O6 ordering flip fails (verify.ts:1111-1164); stored-importance rewrite → :1161 fails. **Sub-criteria NO**: `mcp.ts` DEFAULT drop and "plugin no longer pins 0.5" have zero tests (COND-QA-02) | ⚠️ conditional |
| REQ-P1-2 | T-202 | verify-lifecycle §G (24 goldens) + probe4 (12, gates 1-3 + setup for VERDICT A) + verify.ts §P (38 = 22 checks + 16 shapes) | Unit + live probe + E2E | **Core YES**: merge broken → §G math goldens fail; setProperty not refreshing indexes → probe4 GATE 1/2/3 fail (probe4.ts:399-432); 3-variants→1-row/concat/recall/loop-guard broken → §P checks fail (verify.ts:1197-1379). **Sub-criterion NO**: "FAIL-CLOSED on probe error" (plan:37, CONTRACT:226-228) implemented (store.ts:545-558, no try/catch) but no suite induces a probe failure (COND-QA-03) | ⚠️ conditional |
| REQ-P1-5 | T-203 | scripts/eval.ts run log + docs/benchmarks/SCORECARD.md artifact; corpus 40 docs/15 queries (recounted ✓) | E2E (run log) | **NO for the metric claim**: metric fns module-private (eval.ts:326-379), referenced nowhere else (grep `recallAt\|ndcgAt10\|scoreQuery` → only eval.ts); all 15×2 query results rank-1 (SCORECARD:30-46) so every metric degenerates to 1.0000; the only gate is `recall5 > 0` (eval.ts:650) — a wrong MRR/nDCG/k-handling still exits `EVAL PASS`. The matrix's discriminative claim "decoy query returns 0" (TEST_MATRIX:14) has ZERO in-repo occurrence (grep `decoy` → TEST_MATRIX only; validateCorpus forbids qrel-less queries) → claimed evidence not reproducible from the repo (COND-QA-01, subsumes refuter CE-001) | ⚠️ conditional |
| REQ-P3-2 | T-204 | scripts/verify-skills.ts — 119 = 73 structural + 46 live (both recounted exactly) | Structural + E2E | **YES**: wrong frontmatter/name/dir/route/tool/secret → structural fails (expected values from hardcoded SKILL_CONTRACTS:99-112, never file-inferred); wrong route/shape/status → live round-trips fail; index missing any of the 8 → :203 fails. Index "11 tools" claim verified by read (skills/memory/SKILL.md:10,28) | ✅ pass |
| ALL | T-205 | verify-injection 73, verify-capture 115, verify 212, verify-env 21, typecheck, gitleaks (declared unavailable) | E2E + Review | **YES** for all green-path regressions (recounts below all reconcile; typecheck + lifecycle re-run LIVE this review, exit 0 / 86-86). gitleaks gap is a declared deviation → CI P0.2 compensating control | ✅ pass |
| ALL | T-206 | CONTRACT v1.2, README, CHANGELOG v0.5.0, version lockstep ×5, ROADMAP ticks | Review (docs) | Counts/lockstep/§5/ROADMAP all reconcile on read (my recount independently matches refuter RF-015). README v1.2 drift (defaults line `importance=0.5`, route table missing `consolidated`, + missed location: Retrieval tie-break paragraph README:70-74 omits the v1.2 recall-boost step per CONTRACT:318-322) is an **open finding owned by risk RK-003** — cross-referenced there, not re-counted here | ✅ pass (note: RK-003 open) |

## Count reconciliation (every published number, recomputed)

| Published | Claimed in | My recomputation | Result |
|---|---|---|---|
| **86** verify-lifecycle | PLAN G2, T-201/T-205, CONTRACT §5, README, CHANGELOG, ROADMAP | **LIVE re-run: `86 passed, 0 failed / VERIFY PASS`, exit 0**; static: A–E 39 + §F 23 + §G 24 = 86 | ✓ |
| **212** verify | PLAN G4, T-201/T-202/T-205, CONTRACT §5, README, CHANGELOG (152→212), ROADMAP | Static: 143 `check(` + 60 `shape(` call sites (defs excluded) = 203; §O = 22 counted, §P = 30 call sites → 38 via 3-variant loop; A–N = 151 call sites → 152 via 1 pre-existing loop = prior bar; 152+22+38 = **212** | ✓ (write-path not re-run per mandate; live evidence in matrix) |
| **119** = 73+46 verify-skills | PLAN G5, T-204, CONTRACT §5, README, CHANGELOG, ROADMAP | Structural: 8×5 fixed + 12 routes + 12 tools + 8 secret + 9 index = **73**; live: 2+8+3+5+6+6+3+3+5+4+1 = **46** | ✓ exact |
| **115** verify-capture | PLAN G3, T-205, CONTRACT §5, README, CHANGELOG, ROADMAP | 7 events × 9 = 63 + 6 negatives × 4 = 24 + 28 standalone = **115** | ✓ exact |
| **73** verify-injection | T-205, CONTRACT §5, README, ROADMAP | grep `check(` = 74 − 1 function def = **73** call sites (conditional block runs on green) | ✓ |
| **21** verify-env | PLAN G4, T-205, CONTRACT §5, README, ROADMAP | grep = 23 − 1 def − 1 header comment (`check()` at :4) = **21** | ✓ |
| **12** probe4 | PLAN G5, T-202, CONTRACT §5, README | Static count: 1 precondition + 3 setup + 3 update + 3 gates + 2 sub = **12**; verdict A = setup + gates 1-3 (probe4.ts:496) | ✓ |
| **40 docs / 15 queries** | PLAN G5, T-203, CONTRACT §5, README, CHANGELOG, ROADMAP, SCORECARD:10 | grep: 40 `id:"d…"`, 15 `query:"…"` in eval/corpus.ts | ✓ |
| **23 / 24 / 22 / 38** section counts | T-201 (§F 23, §O 22), T-202 (§G 24, §P 38) | Counted assertion-by-assertion: §F 4+6+6+7=**23**; §G 7+8+4+5=**24**; §O 17+5=**22**; §P 22+16=**38** | ✓ exact |
| **0.5.0 lockstep ×5** | T-206, PLAN G6, CHANGELOG | package.json:3, lockfile:3+9, src/mcp.ts:376, plugin VERSION:63, README badge:3 | ✓ |
| **typecheck exit 0** | PLAN G1 | **LIVE re-run this review: exit 0** | ✓ |

No count inconsistency found across CONTRACT §5 / README verification / CHANGELOG / ROADMAP §1.1 / TEST_MATRIX / PLAN quality gates.

## PLAN quality gates & deviations

- All 7 applicable gates `[x]`, N/A row present for the other domains. Every number inside the gates matches TEST_MATRIX and the reconciliation above → **consistent**.
- One wording imprecision: G6 "no new env vars besides `AGENT_MEMORY_MERGE_JACCARD`" — the lane also introduces `EVAL_MODE` (eval.ts:61, harness-only, default `rest`, unknown mode fail-closes via `fail()` :260-270; documented in eval.ts header + SCORECARD:69, absent from README config table) → COND-QA-04 (Low).
- Declared deviations all recorded: no-worktrees 2-lane file-disjoint isolation (PLAN header §6); "3152 held Lane B's pre-merge build — declared" (TEST_MATRIX T-204); "gitleaks local binary unavailable (declared) → CI P0.2" (TEST_MATRIX T-205, PLAN G6); CONTRACT v1.2 amendment block records the contract change. PLAN has no "Deviations" section — per prompt, not applicable; deviations live in TEST_MATRIX/CONTRACT as declared. ✓

## Tautology / false-assertion scan

- No assertion found that is true by construction regardless of implementation. The closest candidate — verify.ts:1121-1125 (`confidenceBoost(stored, N) > confidenceBoost(stored, 0)`) — re-tests the pure function's monotonicity already pinned by §F rather than the server wiring; it is weak but genuinely implementation-dependent, and the load-bearing wiring assertions sit in O5 (`recallCount===3` via real `bm25Search`) and O6 (tie→boost ordering flip). Not raised as a finding (no false claim); noted for awareness.
- `contentHash(x) === contentHash(x)` determinism probes (verify-lifecycle:145-148) are legitimate property tests (fail if a salt/nonce enters the hash), not tautologies.

## Findings

| ID | Severity | Finding | Location | Evidence | Owner |
|----|----------|---------|----------|----------|-------|
| **COND-QA-01** | **Medium** | T-203: no test can detect a wrong R@5/R@10/MRR@10/nDCG@10 computation — metric fns are module-private, unexported, unimported; the all-rank-1 corpus makes every metric degenerate to 1.0000; the only gate is `recall5 > 0`, so a broken MRR/nDCG/k-handling still exits `EVAL PASS` and publishes a wrong scorecard. The matrix's discriminative-evidence claim ("decoy query returns 0 → discriminates") has no in-repo artifact and is not reproducible (grep `decoy` → TEST_MATRIX:14 only). Subsumes refuter CE-001 (formulas reviewed correct there — defect is evidence, not code) | `scripts/eval.ts:326-379` (fns), `:650-656` (only gate), `docs/benchmarks/SCORECARD.md:20-23,30-46` (all 1.0000 / all rank-1), claim at `TEST_MATRIX.md:14` | grep `recallAt\|ndcgAt10\|scoreQuery` across repo → only eval.ts; grep `decoy` → only TEST_MATRIX:14; validateCorpus (eval.ts:287-297) forbids qrel-less queries; scorecard appendix rows 1-15 first rank = 1 both modes | engineering (execute-spec lane author) — fix: known-answer metric fixture goldens (rank-2 hit, missed doc, 2-doc qrel) or export + unit-test, else narrow the matrix claim |
| **COND-QA-02** | **Medium** | T-201 acceptance sub-criteria "server.ts/mcp.ts drop `?? DEFAULT_IMPORTANCE`" and "plugin no longer pins a client-side 0.5" have ZERO tests — code artifacts verified in diff, but no suite ever calls MCP `memory_save` with/without importance, and no test asserts the plugin payload omits `importance`. Re-pinning 0.5 in either adapter ships green | Plan step 1 (`IMPLEMENTATION_PLAN.md:36`), claim `TEST_MATRIX.md:12`; code: `src/mcp.ts:159-164`, `plugins/opencode/plugins/agent-memory.ts:696,701-704` | grep `memory_save` in scripts/ → only verify-capture:450-457 (self-observation skip; asserts content/origin/project/sessionId, never importance); grep importance-assertions in verify.ts → REST-only (:393-397, :1041-1065); git diff `d17294b..HEAD` shows DEFAULT_IMPORTANCE removal with no accompanying test hunk | engineering (execute-spec lane author) |
| **COND-QA-03** | **Medium** | T-202 acceptance "FAIL-CLOSED on probe error" (a broken near-dup probe must never silently skip a merge) is implemented but untested — no suite induces a `searchByText` failure during `remember`. A regression swallowing the error → silent near-dup accumulation (the exact defect P1.2 exists to fix) ships green | Plan step 2 (`IMPLEMENTATION_PLAN.md:37`), `docs/CONTRACT.md:226-228`, code `src/store.ts:545-558` | Read of store.ts:545-558 confirms NO try/catch (errors propagate as designed); grep scripts/ `probe error\|propagat\|fail-closed` → only config-ON/OFF goldens (verify-lifecycle:585-593), no induced-failure scenario anywhere | engineering (execute-spec lane author) |
| **COND-QA-04** | Low | PLAN gate G6 states "no new env vars besides `AGENT_MEMORY_MERGE_JACCARD`" while the lane adds `EVAL_MODE` (harness-only, fail-closed on unknown mode, documented in eval.ts header + SCORECARD:69 but absent from the README config table) — gate wording imprecise, no security impact (never read by the server) | `IMPLEMENTATION_PLAN.md:75` vs `scripts/eval.ts:61,260-270`; README config table :403-417 | git diff shows eval.ts introduced this lane; README config-table diff adds only MERGE_JACCARD row | orchestrator (plan/docs owner) |

Cross-references (other reviewers' lanes, NOT counted here): README v1.2 drift → risk **RK-003** (open; I add one missed location to its evidence: README:70-74 Retrieval tie-break omits the v1.2 recall-boost step vs CONTRACT:318-322); eval metric discrimination origin → refuter **CE-001** (folded into COND-QA-01 per this reviewer's lane mandate); RELEASE_NOTES staleness → automation. No sibling finding duplicates COND-QA-02/03/04 (checked against existing artifacts in this gate folder).

## Coverage

- Line/branch coverage: **N/A — not configured** (no coverage tooling in package.json); stated, not estimated.
- Acceptance criteria coverage: **6/6 REQ-IDs traced to test IDs**; 3/6 rows fully discriminating + passed (T-204, T-205, T-206), 3/6 conditional on untested acceptance sub-criteria (T-201 → COND-QA-02, T-202 → COND-QA-03, T-203 → COND-QA-01).
- Live re-verification this review: `npm run typecheck` exit 0; `npx tsx scripts/verify-lifecycle.ts` → **86 passed, 0 failed / VERIFY PASS**. Write-path suites (verify/eval/verify-skills) NOT run per mandate — live evidence taken from TEST_MATRIX, statically reconciled where possible.

## Verdict Rationale

⚠️ **conditional (COND-QA-01…04)** — The lane's core engineering is well-guarded: every published count reconciles to the assertion level (86/212/119/115/73/21/12/40/15 and lockstep ×5 all exact), the two re-runnable suites pass live, the primary acceptance paths of all four REQs have tests that genuinely discriminate (derived≠0.5, ledger wiring, 3-variants→1-row, index-refresh gates, structural+live skill round-trips), all declared deviations are recorded, and the plan gates are consistent with the matrix. The conditions are evidence gaps, not broken behavior: three acceptance sub-criteria (MCP/plugin importance, probe fail-closed, metric correctness) have no test that would fail on regression — with T-203's scorecard the most exposed, since an all-rank-1 corpus plus a `recall5>0`-only gate cannot detect a wrong MRR/nDCG computation and the matrix's "decoy" discriminative claim is not reproducible in-repo (COND-QA-01, Medium). Nothing here blocks the way a CLOSED verdict would: no Critical/High, no falsified count, no tautological test, no unsafe write-path run in this review.
