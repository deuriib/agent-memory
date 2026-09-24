# Quality Assurance Review: REQ-RL-001 + REQ-F-01 (residual-closure lane)

**Reviewer:** quality-assurance (independent gate reviewer — runs the real suite; LAST of 9)
**Date:** 2026-09-24
**Scope (commits, main, unpushed):** `01224cc` (REQ-RL-001 — per-survivor FIFO lock + fresh re-read), `a0257d6` (REQ-F-01 — post-write verify + ONE heal), `fb8e661` (docs: CONTRACT v1.5 + README + CHANGELOG). Diff range `a9ef417..HEAD`. Primary code: `src/store.ts`, `db/queries.ts`, `src/consolidate.ts`; tests `scripts/verify.ts` §P, `scripts/verify-lifecycle.ts` §G/§I; docs `docs/CONTRACT.md` (v1.5), `TEST_MATRIX.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `ROADMAP.md`, `CHANGELOG.md`.
**Packet (accepted by reference):** SPEC:ROADMAP.md#1.3-rows-RL-001,F-01 + docs/CONTRACT.md#v1.5-amendment (§2+§3-tier-1+§5) / HARD:subagents+review-only+no-code-edits+no-push / GATE:execution-evidence-commits-01224cc,a0257d6,fb8e661-bar-green / DOMAINS:R1-engineering,quality-assurance.
**Checklist applied:** `frame-ship/skills/quality-gate/references/engineering/quality-assurance-review.md` (the packet named `…/quality-assurance.md`; actual file is `quality-assurance-review.md` — same checklist, applied).
**Pre-work honored:** all 8 sibling reviews read in full BEFORE judging; their cited evidence spot-checked where cheap; conditions cross-checked for contradictions and duplicates.
**Verdict:** ⚠️ **conditional** — gate state: **CONDITIONAL** (not CLOSED, not yet OPEN); 12 canonical conditions (10 inherited + 2 new `COND-QA-05/06`); findings: **0 Critical / 0 High / 3 Medium / 2 Low / 2 notes**.

> **COND-QA id note:** `COND-QA-01…04` are consumed by the archived P1R-P32 gate (still referenced in `docs/CONTRACT.md:557-579` and code comments) and were cleared there. This lane's conditions continue at **COND-QA-05** to avoid collision.

## Checklist

- [~] **All acceptance criteria have tests** — both headline criteria asserted (RL-001 13 asserts, F-01 16 asserts, each re-run green ×2 by this reviewer). BUT three contract-claimed fail-closed sub-paths have zero asserting tests → **COND-RF-03**; the `embedding` batch property is asserted nowhere (not even implemented in verify) → **COND-RF-01**.
- [x] **All REQ-IDs traceable to test IDs** — 2/2: REQ-RL-001 → T-RL-001, REQ-F-01 → T-F-01 (TEST_MATRIX:12-13, both DONE, each → test → artifact).
- [x] **Unit + integration + e2e as appropriate** — §G/§I pure + offline seam (no network), §P live e2e against `:3151`, plus sibling counterfactuals (pre-fix trees fail the very blocks the lane's tests make).
- [~] **Regression suite updated** — counts moved correctly in CONTRACT §5 and TEST_MATRIX (verify 227→243, lifecycle 104→113). NOT updated in `README.md:607,631` (214/104) → **COND-QA-05** and `ROADMAP.md:44` (214/104/115) → folded into **COND-RF-02**.
- [x] **No flaky tests introduced** — two independent full live runs by this reviewer (both 243/0), plus refuter's 3× RL-001 stress + counterfactuals, all green; fixtures are per-run uuid projects with explicit forget asserts; the `Promise.all` concurrency IS the subject under test and its asserts hold under every interleaving; jaccard margin (31/34 ≈ 0.912 ≥ 0.9) documented at construction.
- [x] **Coverage threshold** — **N/A by repo design**: no coverage tooling exists (`package.json` has no vitest/istanbul; ROADMAP:44 status column itself says "no unit suite"). Repo standard = assertion-count bar (§G/§I/§P), which is met and reconciled below. Not a defect.
- [x] **Manual exploratory testing** — done across the panel: refuter's pre-fix counterfactuals (`:3199`/`:3201`) + live stress, data's cross-project leak probe, resilience's read-path `signals[]` probes, reliability's failure-mode audit.

## Evidence re-verification (this reviewer, 2026-09-24)

| Claim (source) | Spot-check | Result |
|---|---|---|
| `npm run typecheck` exit 0 (all siblings) | re-run | **exit 0** ✓ |
| lifecycle 113/0 (readability/refuter/resilience/risk) | re-run | **113 passed, 0 failed / VERIFY PASS** ✓ (incl. `5 sends, NO insert` seam) |
| live verify 243/0 (refuter/reliability/resilience/risk/security) | re-run **×2** against `:3151` | **243 passed, 0 failed** both runs ✓ |
| `rl-001:` = 13 checks (CONTRACT §5, TEST_MATRIX, readability) | counted in my log | **13** ✓ exactly |
| `f-01:` block (TEST_MATRIX lists 9 "(tail)") | counted in my log | **16 PASS lines** — refuter wrote "14"; undercount, immaterial (no doc claims 14; TEST_MATRIX labels its list as tail) → note QA-004, no condition |
| RD-001 docstring drift | read `src/store.ts:704-706` | **confirmed**: "return the survivor WITHOUT a write" still present post-`a0257d6` |
| RF-017/RK-008 param order | read `docs/CONTRACT.md:140` vs `db/queries.ts:611-615` | **confirmed**: contract `memoryId, project, concepts` vs code `memoryId, concepts, project`; IMPLEMENTATION_PLAN step 2 matches the CODE, so the doc line is the wrong side |
| CE-003/RK-002/RS-01 stale ROADMAP | read `ROADMAP.md:68,70` | **confirmed**: present-tense OPEN + 2026-12-31 expiry vs CONTRACT "CLOSED 2026-09-24"; DAT-001 CLOSED pattern sits at `:69` |
| RK-005 rollback probes | re-ran all 3 `git merge-tree --write-tree --merge-base=…` | **1 / 0 / 0 — exactly as risk recorded** ✓ |
| AU-001/CI never run for this lane | `git status` (3 commits unpushed) | ✓ confirmed |
| CONTRACT H1 v1.5 bump | `docs/CONTRACT.md:1` | **done** ✓ (`# agent-memory — v1.5 Frozen Contract`) — no finding; README:579 "v1.4" correctly scopes limitation #10/DAT-001 |
| §2 other param orders (`getMemoryById`, `memoryConcepts`) | `db/queries.ts:535-538,572-575` vs contract `:138-139` | both match ✓ (only `linkMemoryConcepts` drifts) |

Hygiene: Helix dev `:6969` never restarted/stopped/touched; upstream `:3111` untouched; **zero write probes created by this review** (all evidence = self-cleaning suites + read-only git/curl) → nothing to forget; no secrets, no PII, no memory content, no embeddings reproduced anywhere below; repo files modified by this review: **only this report**.

## Traceability (REQ → test)

| REQ-ID | Acceptance sub-criterion | Test ID / asserting evidence | Type | Status |
|---|---|---|---|---|
| REQ-RL-001 | **No lost append, in-process**: 3 CONCURRENT distinct near-dup variants → 1 survivor, all three wordings verbatim, memories=1, sessions=1 | T-RL-001 · §P `rl-001:` **13 asserts** (`survivor content contains ALL THREE variant wordings verbatim (no lost append)`, `SAME survivor id (serialized per survivor)`) — re-run ×2 green; pre-fix counterfactual FAILS it (refuter RF-013: `[201,500,500]`, `transaction_conflict`, `1/3`) | E2E live | **pass / discriminating** |
| REQ-RL-001 | fresh re-read fail-closed on vanished / wrong-id / non-string content (`src/store.ts:850-868`) | §I seam serves the fresh read on its HAPPY path only | seam | **untested** → COND-RF-03 |
| REQ-RL-001 | expired-while-waiting → plain insert, never absorbs (`src/store.ts:744-751`) — claimed at CONTRACT §3 tier-1(a) v1.5 | §I TTL-ON case drops the candidate at PROBE time (pre-lock); control runs TTL OFF (`filterExpired` identity) — nothing reaches `store.ts:746` | — | **untested** → COND-RF-03 |
| REQ-F-01 | **verify + heal, byte-identical guard path**: content/dedupKey/linked-concepts verified after every merge write, ONE heal, fail-closed named throw; guard path heals links with content byte-identical | T-F-01 · §P `f-01:` **16 asserts** (`survivor content BYTE-IDENTICAL after the guard-path heal`, `fused score = control + 1/61 (the HEALED link caused the recall)`) re-run ×2 green + refuter causality counterfactual (pre-`a0257d6` fails with `delta=0`); §G `missingConcepts` 9 goldens; §I guard seam (`consolidated=true, 5 sends, NO insert`) | E2E + unit + seam | **pass / discriminating** |
| REQ-F-01 | heal-still-violated → throw naming invariant; content-drift → `retryWrite` (`src/store.ts:1029-1038`) | none found (refuter CE-002, resilience finding 3 — independently confirmed by both) | — | **untested** → COND-RF-03 |
| REQ-F-01 | batch's `embedding` write verified | not implemented — verify covers content/dedupKey/links only (`src/store.ts:1017-1026` vs `db/queries.ts:665-668`) | — | **close-or-rescope** → COND-RF-01 |

**Trace verdict:** 2/2 REQ-IDs → test IDs with artifact rows; the two HEADLINE acceptance behaviors are genuinely asserted and proven discriminating (counterfactuals). The residual trace gaps are exactly the three sub-paths (COND-RF-03) and the embedding property (COND-RF-01) — no other claimed behavior lacks an asserting test.

## Acceptance criteria judgment

- **RL-001 "no lost append, in-process" — ✅ MET on the evidence.** 13/13 asserts green ×2 independent runs by this reviewer; the test provably fails on the pre-fix tree (true write overlap → Helix `transaction_conflict`, only `1/3` wordings land); scope honestly declared same-process in three places (`docs/CONTRACT.md:309-312`, `README.md:547+`, `src/store.ts:725-728`). In-process serialization + fresh re-read verified by static lock-order audit (refuter RF-001/RF-002, reliability FM-009 — no cycle, no bypassing writer).
- **F-01 "verify + heal, byte-identical guard path" — ✅ MET for the enumerated invariants, ⚠️ with two recorded boundaries that must clear.** Byte-identity is unconditional on the guard path (zero content writes, `src/store.ts:764`) and reproduced live; heal is exactly-once + idempotent (refuter RF-007/RF-011); errors never become success (RF-011). Boundary 1: "ATOMICITY — CLOSED" over-reaches by the `embedding` property → COND-RF-01 must either verify it or re-scope the closure word. Boundary 2: the throw families rest on code-reading, not assertions → COND-RF-03. With those two conditions, the acceptance stands; without them it stands *over-claimed*, not *wrong*.

## Do the refuter's F-2 / resilience COND-RS-03 genuinely gate?

**GATE (stay conditional) — not backlog.** Reasons: (1) CONTRACT v1.5 explicitly *claims* these behaviors ("expired-while-waiting → plain insert", "fail closed on vanished/wrong-id/non-string", "throw NAMING the violated invariant") — the REQ→test trace would otherwise imply coverage the suites do not provide; (2) the expired-while-waiting branch is **not fail-closed under regression**: if the under-lock `filterExpired` re-run broke, an incoming variant would merge into a TTL-expired survivor that reads filter out — a silent, lost-append-shaped outcome under TTL-ON (the exact defect class RL-001 exists to close); (3) they are cheap to clear (three offline §I seam cases with per-call canned replies, or an explicit declaration). The two THROW families are fail-closed by construction (regression ⇒ HTTP 500, never silent), so for those the refuter's declaration escape-hatch is acceptable. Split clear-criteria recorded under canonical COND-RF-03 below — this also resolves the RF-vs-RS strictness divergence.

## Own findings (gaps NO sibling caught)

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| QA-001 | **Medium** | `README.md:607` (`214 passed, 0 failed`), `README.md:631` (`104 passed`) | **README Verification section carries pre-lane counts.** Actual final bar is 243/113 (re-run ×2 today, CONTRACT §5, TEST_MATRIX:50-51). The verify bullet's description also stops at v1.2 content (ends at MCP pass-through, `:607-630`) — it never mentions the v1.5 §P `rl-001:`/`f-01:` blocks or §G/§I additions the lifecycle bullet now includes. Siblings flagged ROADMAP:44 counts (RF-02) but **nobody flagged the README copy**; grep of `214`/`104` across the 8 sibling reports → zero matches. The README is the public face of the repo and is the doc a first-time operator trusts. → **COND-QA-05** |
| QA-002 | **Low** | `IMPLEMENTATION_PLAN.md:79-87` (all six Quality Gates `- [ ]`); Evidence Log has Commit-1 entry only (`:59-77`) | **Plan singleton never finished after commit 1.** Every gate listed has run green (typecheck 0, lifecycle 113, verify 243, new-evidence items all present in TEST_MATRIX), and the repo's own convention is TICKED boxes with counts pasted — `git show 2035e18:IMPLEMENTATION_PLAN.md:72-81` shows the prior lane's plan with all `[x]` + counts. The plan was last touched by `01224cc` (commit 1); `a0257d6` updated TEST_MATRIX but never returned to the plan, so step 4's "plan/matrix rows updated with evidence … F row + backfill in commit 2" is only half-done. A reader of the plan alone concludes the lane's gates never ran. No sibling flagged this (siblings only flagged plan `:41-49`, rollback → COND-RK-03). → **COND-QA-06** (same docs pass as COND-RK-03, same file) |
| QA-003 | Low | `ROADMAP.md:44` ("This repo" column) | **Line 44 is staler than siblings recorded**: they flagged `verify (214)` + `verify-lifecycle (104)`; it ALSO says `verify-capture (115)` while the actual count has been **137** since contract v1.3 (`docs/CONTRACT.md:36-37,563`, `TEST_MATRIX:61`) — 115 was the pre-v1.3 number (visible in the prior plan, `2035e18:IMPLEMENTATION_PLAN.md:74`). Not a new condition: same line, same fix action → **folded into canonical COND-RF-02** clear-criteria (214→243, 104→113, 115→137). |
| QA-004 | Note | `refuter.md:15` | Refuter recorded "all 14 `f-01:`-block checks"; the block actually emits **16** PASS lines (counted in my run). No document claims 14, so no doc contradiction and no gate impact — recorded for the panel's evidence hygiene only. No condition. |
| QA-005 | Note | `docs/CONTRACT.md:557,561-562,579` | CONTRACT §5 still cites historical `COND-QA-01/02/02b/03` (the archived P1R-P32 gate, all cleared there). New QA conditions for this lane are numbered **from 05** to avoid id collision (see header note). No action required. |

## Cross-review synthesis (the LAST reviewer's job)

### Duplicates (canonical named, duplicate NOT re-issued)

| Duplicate COND | Canonical | Why |
|---|---|---|
| **COND-DT-01** (data) | **COND-RF-01** (refuter) | Identical issue (batch's `embedding` escapes verify / "CLOSED" over-reach) with identical two remediation options. Canonical = RF-01 (original counterexample CE-001; risk RK-003 already inherits it). DT-01's extra clause "mirror into ROADMAP F-01 when that row is next touched" is already carried by COND-RK-01. |
| **COND-RS-01** (resilience) | **COND-RF-02** (refuter) | Same rows (`ROADMAP.md:68,70` contradict CLOSED). Canonical = RF-02 (broader: also owns line-44 counts, and now QA-003's 115→137). Reliability F1 and risk RK-002 mapped here too (neither re-issued). |
| **COND-RS-03** (resilience) | **COND-RF-03** (refuter) | RS's two cases ⊂ RF's three (RF also owns expired-while-waiting). Divergence resolved in canonical clear-criteria: expired-while-waiting = test REQUIRED; the two throw families = test OR explicit code-reviewed-untested declaration. |

Non-duplicate dependencies (kept separate): **COND-RK-01** waits on COND-RF-01 + COND-RS-02 clearing (risk's own ordering); **COND-RS-02** receives security's SEC-F01 and automation's AU-002 as corroborations, not as extra conditions (security explicitly deferred: "track it there … not a security blocker").

### Contradictions check

**No incompatible demands found.** Three divergences, all reconciled above:
1. COND-RF-03 (tests *or* declaration) vs COND-RS-03 (tests only) → resolved: split criteria, canonical RF-03.
2. Security SEC-F01 (add queue cap/deadline) vs COND-RS-02 default (document now; code change needs its own proposal lane) → resolved: RS-02's default governs this lane; security's code-fix wording is explicitly scoped "before any multi-client/remote exposure" (i.e., P4.3), consistent with the RS-02 trigger. No second queue condition issued.
3. Verdict spread: reliability ✅ + security ✅ vs six ⚠️ conditional → not a contradiction; the two passes are lens-scoped, both acknowledge the docs/ops conditions with owners, and neither waives sibling conditions. Gate verdict = strictest blocking set.

### Backlog riders (recorded, do NOT gate, no conditions)

- Reliability F8 (queue-poisoning recovery test) · F2/F3/F4/F5/F6/F7 (aggregate deadline, no similarity re-check, expired no re-probe, dup edges, no AbortController, legacy keyless dedupKey) · refuter F-5/F-6 · readability RD-002..RD-006 · resilience findings 4/5 (crash-window doc carve-out — carried into COND-RK-01's wording; session-node run budget — carried into COND-RK-01) · risk RK-007 (concept tokens in log messages) · data DT-02/DT-03 · **data DT-04's TEST_MATRIX:4 stale date** (rider: fix in the same docs pass as COND-RF-02) · security SEC-F02/03/04/05 · automation AU-003 (stdout-capture note may ride COND-RK-02).

## Consolidated condition table (canonical, across all 9 reviews)

| # | Canonical COND | Sev | Finding (origin) | Owner | Duplicates folded | Clear-criteria (unambiguous) |
|---|---|---|---|---|---|---|
| 1 | **COND-RD-01** | Med | RD-001 docstring drift (readability) | engineering | — | Comment-only diff at `src/store.ts:704-706`: substring-guard sentence matches post-`a0257d6` behavior (byte-identical content BUT concept-link verify + link-only heal now runs). `npm run typecheck` exit 0; reviewer re-read confirms "WITHOUT a write" no longer stands unqualified. |
| 2 | **COND-RF-01** | Med | F-1/CE-001 embedding escapes verify; "ATOMICITY CLOSED" over-reaches (refuter) | engineering | **COND-DT-01** (data) | ONE of: (a) `embedding` invariant added to `verifyMergedState` (project it via `getMemoryById`, compare vs `embed(expectedContent)` — deterministic embedder) + §I seam case + §5 counts updated; **or** (b) `docs/CONTRACT.md` §3 tier-1(b) re-scoped so CLOSED explicitly covers only content/dedupKey/links, with `embedding` declared as a named residual (owner engineering, expiry ≤ 2026-12-31 or next Helix engine upgrade). Roadmap mirror clause rides COND-RF-02/RK-01. |
| 3 | **COND-RF-02** | Med | F-3/CE-003 ROADMAP §1.3 rows contradict CLOSED (refuter) | engineering (ship-release) | **COND-RS-01** (resilience); absorbs reliability F1, risk RK-002, data DT-04's roadmap half, **QA-003** | `ROADMAP.md:68` (RL-001) and `:70` (F-01) moved to the DAT-001 CLOSED pattern (`:69` precedent): CLOSED 2026-09-24 + surviving boundaries (RL-001 → same-process only until P4.3; F-01 → engine-upgrade re-verify carve-out), pointers to CONTRACT v1.5 §3; **and** `:44` "This repo" counts reconciled: 214→**243**, 104→**113**, capture 115→**137**. Clear = no present-tense "can lose one append"/"unverified"/stale count left on those lines. Before push. |
| 4 | **COND-RF-03** | Med | F-2/CE-002 three cited sub-paths untested (refuter) | engineering | **COND-RS-03** (resilience) | Split: (a) **expired-while-waiting** — §I seam case REQUIRED (canned fresh row with expired `createdAt` → assert plain insert / no absorb; regression here is silent → not waivable by declaration); (b) fresh-read vanish/wrong-id/non-string throws and (c) heal-still-violated→named throw — each cleared by an §I seam case **OR** an explicit code-reviewed-untested declaration in CONTRACT §3 / TEST_MATRIX trace (fail-closed ⇒ regression = 500 only). Counts pasted into TEST_MATRIX + §5 if tests added. |
| 5 | **COND-RF-04** | Low | F-4/CE-004 §2 param-order drift (refuter) | engineering | risk RK-008 (inherited) | `docs/CONTRACT.md:140` → `memoryId (string), concepts (array object), project (string)` matching `db/queries.ts:611-615` (and IMPLEMENTATION_PLAN step 2). One-line diff. |
| 6 | **COND-RS-02** | Med | Unbounded FIFO queue depth + amplified in-lock hold, undeclared (resilience finding 2) | engineering | receives SEC-F01 (security, deferred by owner) + AU-002 (automation, inherited) + risk RK-001(b) | Dated declaration in `docs/CONTRACT.md` §3 or README *Known limitations*: unbounded lock-queue wait + per-send-timeout envelope (use automation AU-002's round-trip table: 6 sends happy / ≤11 worst-heal, ≤165s at cap), owner engineering, trigger = P4.3 multi-instance OR first observed retry storm. Code fix (queue cap / request deadline) = separate proposal lane, NOT this lane. |
| 7 | **COND-RK-01** | Med | RK-001 lane created residuals no dated ledger declares (risk) | engineering | — (dependency: clears AFTER RF-01 + RS-02) | Every residual row in risk's inventory marked *Declared? NO* appears in `ROADMAP.md` §1.3 or CONTRACT §3 with owner + dated expiry/trigger: embedding gap, queue wait, untested fail-closed paths (or their RF-03 declaration), crash-window lazy-heal carve-out, `verify.ts` session-node run budget. Clear = zero `NO` rows remain; ROADMAP/CONTRACT diff reviewed by risk role. |
| 8 | **COND-RK-02** | Med | RK-004 silent successful heals + no operator runbook (risk) | engineering | receives AU-004 + AU-003's stdout note (automation, inherited) | Docs-only: one operator line (README Troubleshooting or CONTRACT §3) — on `-> 500: Error: REQ-F-01:`/`REQ-RL-001:` in the log: what it means (fail-closed, write not reported), what to do (retry safe — converges via substring guard → `ensureConceptLinks`; escalate if repeated), how to find (`grep "REQ-F-01:\|REQ-RL-001:"`) — **plus** explicit accepted-silence declaration for successful heals (owner + expiry) or a filed follow-up proposal-lane ticket for a one-line allowlisted heal log. No code hotfix inside this condition. |
| 9 | **COND-RK-03** | Med | RK-005 documented per-commit rollback conflicts (risk) | engineering | receives AU-005 (automation, inherited) | `IMPLEMENTATION_PLAN.md:39-55` Rollback Points replaced by the proven procedure: full reverse-order revert `fb8e661` → `a0257d6` → `01224cc` (each tree-equal to a green parent, no data backout), with explicit warnings: reverting `01224cc` alone CONFLICTS (this reviewer re-ran the probes: **1/0/0**, matches risk exactly) and reverting `a0257d6` while keeping `fb8e661` leaves docs claiming CLOSED for reopened behavior. Clear = plan diff + probes still 1/0/0. |
| 10 | **COND-AU-01** | Low (confirm) | AU-001 these commits have never run in CI (automation) | engineering (ship-release) | — | At push: `CI` workflow green on the pushed head (typecheck, verify-injection, verify-lifecycle 113, verify-capture 137, verify-skills --structural 73, gitleaks). Actions run URL + head SHA recorded in ship-release notes. Red → retry N=2 differently → escalate; no third loop. |
| 11 | **COND-QA-05** *(new)* | Med | **QA-001** README Verification stale counts (this review) | engineering (ship-release) | — | `README.md:607` → `243 passed, 0 failed`; `:631` → `113 passed`; verify bullet names the v1.5 §P `rl-001:` (13) + `f-01:` blocks (and lifecycle bullet's §G/§I additions). Clear = zero `214`/`104` left in README's Verification section; counts match CONTRACT §5. |
| 12 | **COND-QA-06** *(new)* | Low | **QA-002** plan gates unchecked + no Commit-2 evidence (this review) | engineering | — (execute in the same file pass as COND-RK-03) | `IMPLEMENTATION_PLAN.md:79-87` gates ticked with the recorded final-bar counts (repo convention, cf. `2035e18` prior plan) **or** an explicit pointer line stating TEST_MATRIX owns the final bar; AND a Commit-2 Evidence Log entry added (or step-4 wording amended to say the matrix F-row + counts are the commit-2 evidence). Clear = plan diff reviewed by this role. |

**Canonical count: 12** (COND-RD-01, RF-01..RF-04, RS-02, RK-01..RK-03, AU-01, QA-05, QA-06). **Duplicates retired: 3** (DT-01→RF-01, RS-01→RF-02, RS-03→RF-03). No condition re-issued where a sibling already owned it (risk's inheritance discipline and security/automation's explicit deferrals were verified and respected).

## Verdict Rationale

- **pass not met** — 12 canonical conditions outstanding, including two Medium doc-truth contradictions on the packet's own SPEC anchor (ROADMAP rows OPEN vs CONTRACT CLOSED; README counts stale), the embedding closure over-reach, and the untested contract-claimed sub-paths.
- **closed/fail not met** — zero Critical, zero High across all 9 reviews; both headline acceptance criteria MET with proven-discriminating tests (pre-fix counterfactuals fail exactly the assertions the lane makes); the full bar re-run green **twice** by this reviewer (typecheck 0 / lifecycle 113/0 / live 243/0, `rl-001`=13, `f-01`=16); rollback of the whole lane proven deterministic and re-verified by me (merge-tree 1/0/0); pipeline/dependency/index surfaces byte-identical; every condition has a cheap, owned, unambiguous mitigation; the two pass verdicts (reliability, security) and six conditionals are reconcilable without conflict.
- **conditional** = exactly the panel's state: ⚠️ **CONDITIONAL**. Gate stays **CONDITIONAL → clears to OPEN** when the 12 canonical conditions are cleared or waived (owner + expiry per C3); **push additionally gated** on COND-RF-02 + COND-QA-05 (doc truth before the public tree moves) and confirmed afterward by COND-AU-01 (first Actions run).

## Findings summary (this review)

**Critical: 0 · High: 0 · Medium: 1 (QA-001) · Low: 2 (QA-002, QA-003) · Notes: 2 (QA-004, QA-005)**
**Conditions issued: 2 — `COND-QA-05`, `COND-QA-06`** (both new gaps, no sibling ownership existed; QA-003 folded into COND-RF-02 instead of re-issued).
**Consolidated gate: 12 canonical CONDs · 3 duplicates retired · verdict ⚠️ conditional.**

## Evidence log (allowlisted — statuses/counts only; no content, no ids, no secrets)

| Run / probe | Target | Result |
|---|---|---|
| `npm run typecheck` | repo `fb8e661` | exit 0 |
| `npx tsx scripts/verify-lifecycle.ts` | offline seam (127.0.0.1:9, no network) | **113 passed, 0 failed / VERIFY PASS** |
| `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` | live `:3151` — run 1 | **243 passed, 0 failed / VERIFY PASS** |
| same — run 2 (counted) | live `:3151` | **243/0**; `PASS  rl-001:` = **13**; `PASS  f-01:` = **16**; `FAIL` = 0 |
| `git merge-tree --write-tree --merge-base=…` ×3 | repo (read-only) | partial-`01224cc` revert **1** (conflict), revert-`a0257d6` **0**, revert-`fb8e661` **0** — matches risk exactly |
| `git show 2035e18:IMPLEMENTATION_PLAN.md` | history (read-only) | prior-lane convention: Quality Gates **ticked with counts** — confirms QA-002 regression |
| Doc reads | CONTRACT v1.5, TEST_MATRIX, IMPLEMENTATION_PLAN, ROADMAP:44/66-70, README:540-642, CHANGELOG [Unreleased], `src/store.ts:704-706`, `db/queries.ts:535-631` | all findings above sourced file:line |
| Write probes | — | **zero** created by this review (suites self-clean) → nothing to forget |
| Helix `:6969` / upstream `:3111` | environment | never restarted/stopped/touched; upstream untouched |
| Files modified by this review | repo | **only this report** (`docs/specs/40_workspace/quality-gate/RL001-F01/quality-assurance.md`) |
