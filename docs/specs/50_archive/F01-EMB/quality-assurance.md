# Quality Assurance Review: SPEC-F01-EMB

**Reviewer:** quality-assurance (independent subagent — runs the real suite)
**Date:** 2026-09-24
**Verdict:** **conditional** (2 Medium findings — both remediable by the owner; no ❌)
**Stage skill:** `skill(frame-ship:quality-gate)` loaded before acting
`/mnt/DATA/GitHub/frame-ship/skills/quality-gate/SKILL.md` → `references/engineering/quality-assurance-review.md`

**Packet (reference-only):**
`SPEC:docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06 / HARD:subagents+storage=disk+no-secrets / GATE:executed / DOMAINS:R1,R2,R8`

**Reviewer independence:** this artifact covers ONLY the quality-assurance role
(REQ→test→artifact trace, evidence completeness, verdict readiness). Readability,
reliability, refuter, resilience, risk, data, security (R2) and automation (R8) reviews
are separate subagents — not performed here, not inferred here.

## Checklist

- [x] All acceptance criteria have tests (AC-01..AC-05 → runs below; AC-04 via the hybrid
      search's vector leg — note 1)
- [~] All REQ-IDs traceable to test IDs — **REQ-01..06 traced; REQ-02's shape-drift
      sub-branch has no test (FIND-QA-01)**
- [x] Integration + e2e coverage as appropriate (offline seams + live Helix e2e;
      no unit suite exists in this repo — ROADMAP "no unit suite", coverage tooling N/A)
- [~] Regression suite updated — suites grew (+6 lifecycle, +1 probe4) and counts were
      amended in README/CONTRACT/ROADMAP; **`TEST_MATRIX.md` was not extended (FIND-QA-02)**
- [x] No flaky tests introduced — every suite run twice, byte-identical totals
      (123/123, 13/13, 243/243); offline seams are canned-reply queues with call-order
      traps and zero network
- [n/a] Coverage threshold met — no coverage harness in this repo (declared N/A, not silent)
- [x] Manual exploratory testing done — live server + Helix dev instance exercised;
      log-channel scan for embedding leakage (below)

## Traceability (REQ → test → artifact → evidence)

| REQ-ID | Test / run ID | Type | Result | Evidence file |
|--------|---------------|------|--------|---------------|
| REQ-F-01-EMB-01 (projection `+embedding`, no new index, bootstrap 8) | `npx tsx scripts/probe4.ts` sub-check `f32 round-trip` + `npx tsx scripts/bootstrap.ts` | live (Helix dev, storage=disk) | pass (maxDiff=0 dims=384; "8 indexes ensured") | `evidence/03-probe4.log`, `evidence/05-bootstrap.log` |
| REQ-F-01-EMB-02 (`FreshSurvivorRow.embedding`, fail-closed shape drift) | `verify-lifecycle` §I-d precondition + d1/d2 (well-formed stale value); **shape-drift branch (missing key / non-array / wrong length) → NO TEST** | offline seam | pass for value-drift; **gap for shape-drift** | `evidence/02-verify-lifecycle.log` |
| REQ-F-01-EMB-03 (`expectedEmbedding` fed to verify) | `verify-lifecycle` §I-d d1/d2 (violation fires only when stale ⇒ the argument is actually consumed) + `verify` §P live merges (happy path) | offline seam + e2e live | pass | `evidence/02-verify-lifecycle.log`, `evidence/04-verify.log` |
| REQ-F-01-EMB-04 (`embeddingsEqual`, 4th invariant, → `viaRetryWrite`, named throw) | §I-d **d1** (8 sends, ONE heal), **d2** (named `… invariant(s) violated — embedding`), **d3** (5 sends, no heal = false-positive guard) | offline seam | pass (3/3) | `evidence/02-verify-lifecycle.log` |
| REQ-F-01-EMB-05 (heal line `… invariants=…,embedding`, token-only, stderr) | §I-d d1 exact-string assert + d2 "no heal line on throw path" + live log scan | offline seam + log scan | pass (line pinned verbatim; live server log has **zero** `embedding` occurrences) | `evidence/02-verify-lifecycle.log` + scan noted below |
| REQ-F-01-EMB-06 (no embedding exposure; CONTRACT v1.6 + ROADMAP CLOSED) | code inspection: `memoryRowProjection` unchanged, `toSearchHit` fixed-shape, `getMemoryById` consumed only by `getFreshSurvivor` (+ probe4); docs diff | static (diff) | pass | `git diff db/queries.ts src/store.ts docs/CONTRACT.md ROADMAP.md README.md` |
| NFR-A (no extra send) | send-count assertions in every seam (3/5/8) + full-suite envelope asserts | offline seam | pass | `evidence/02-verify-lifecycle.log` |
| NFR-B (lock envelope 6/≤11/≤165s) | existing envelope assertions green in both suites | offline seam | pass (unchanged) | `evidence/02-verify-lifecycle.log` |
| NFR-C (fail-closed: every new failure mode throws) | d2 named throw; code inspection for shape-drift (violation → heal → named throw) | offline seam + static | pass by inspection; shape-drift path unasserted (see FIND-QA-01) | `evidence/02-verify-lifecycle.log` |

**AC coverage**

| AC | Evidence | Status |
|----|----------|--------|
| AC-01 `npm run typecheck` clean | `evidence/01-typecheck.log` (exit 0) | ✅ |
| AC-02 `verify-lifecycle` §I seam proves embedding drift heals | `evidence/02-verify-lifecycle.log` — precondition + d1 (8 sends, `heal survivor=seam-emb-d1 invariants=embedding`) + d2 (named throw) + d3 | ✅ |
| AC-03 `scripts/probe4.ts` still green | `evidence/03-probe4.log` — `13 passed, 0 failed`, VERDICT A | ✅ |
| AC-04 vector recall of merged content finds survivor | `evidence/04-verify.log` — §P6 `smart-search … hits the survivor` ×3 (hybrid = bm25 + **`searchByVector`** + graph, `src/search.ts:192`) | ✅ (note 1) |
| AC-05 no regression — `verify` + `verify-lifecycle` green, no new index | `evidence/04-verify.log` (243/0) + `evidence/02-verify-lifecycle.log` (123/0) + `evidence/05-bootstrap.log` (`bootstrapIndexes` and `bootstrap.ts` show **no diff** → 8 indexes unchanged) | ✅ |

## Evidence inventory (all under `…/SPEC-F01-EMB/evidence/`)

| File | Command | Result |
|------|---------|--------|
| `01-typecheck.log` | `npm run typecheck` | exit 0, no output (clean) |
| `02-verify-lifecycle.log` | `npm run verify-lifecycle` | **123 passed, 0 failed / VERIFY PASS** (run twice, identical) |
| `03-probe4.log` | `npx tsx scripts/probe4.ts` (live `localhost:6969`) | **13 passed, 0 failed / PROBE4 PASS (VERDICT A)**, `maxDiff=0 dims=384` (run twice, identical) |
| `04-verify.log` | `AGENT_MEMORY_URL=http://127.0.0.1:3199 npm run verify` | **243 passed, 0 failed / VERIFY PASS** (run twice, identical) |
| `05-bootstrap.log` | `npx tsx scripts/bootstrap.ts` | `bootstrapIndexes: OK (8 indexes ensured)`, READY attempt 1 |

Counts match the docs claimed in this lane: README 123/13, `docs/CONTRACT.md` §5 123/13,
`ROADMAP.md` 123/13 — no stale number found.

**Evidence-hygiene check (log channel):** scanned the live server log of the fresh run —
2 heal lines total, both `heal survivor=<uuid> links=1` (family token only), **zero**
occurrences of `embedding` and zero vector dumps; scanned every evidence file for
long-float arrays (vector dumps) → none; "token" matches are fixture words only.
No secrets/credentials patterns in evidence files.

## Findings

### FIND-QA-01 — REQ-F-01-EMB-02 shape-drift branch has no test — **Medium**
- **Location:** `src/store.ts` `readEmbeddingVector` / `embeddingsEqual` (fail-closed on
  missing key, non-array, length ≠ `EMBED_DIM`, non-finite element);
  `scripts/verify-lifecycle.ts` §I-d (d1/d2/d3 feed only well-formed-but-stale vectors).
- **Evidence:** every canned row that reaches `verifyMergedState` carries a valid
  384-number vector (grep of `scripts/verify-lifecycle.ts` `embedding` → lines 1174, 1209,
  1215, 1325, 1344, 1347, 1432). Seams (a)/(b) bypass `verifyMergedState` (expired /
  vanished survivor), so they do not exercise it either. Architecture-review condition
  **C2** names exactly this case ("absent property, non-array, or length ≠ EMBED_DIM …
  must never silently pass").
- **Impact:** current code is correct by inspection (shape drift → `undefined` →
  `embeddingsEqual` false → violation → ONE `retryWrite` heal → named throw). The risk is
  a future refactor that reads shape drift as a pass; nothing would catch it.
- **Owner:** general(vasquez) — Engineering Owner (R1). Suggested remediation: +3 offline
  seams (missing `embedding` key / string value / 383-length array) asserting
  `violations → ["embedding"]` → ONE heal → named throw, then re-run the suite.
- **No freelance fix applied** — reported only, per guardrails.

### FIND-QA-02 — `TEST_MATRIX.md` not extended for this lane — **Medium**
- **Location:** `/mnt/DATA/GitHub/agent-memory/TEST_MATRIX.md` (root; lane singleton,
  "REQ-RL-001 + REQ-F-01 (residual closure lane)").
- **Evidence:** `grep -c "EMB" TEST_MATRIX.md` → **0**, while
  `SPEC-F01-EMB.md §6 Dependencies → Downstream` explicitly lists "**TEST_MATRIX
  extension**", and `CONTRIBUTING.md:98` makes that file the canonical
  `REQ-ID → test/evidence → artifact` registry. CONTRACT v1.6 and ROADMAP (the other two
  downstream items) were updated in-lane — this one was not.
- **Impact:** the REQ→test→artifact trace exists in spec §7 and in this gate directory
  but is absent from the repo's declared trace matrix; a later lane cannot see which
  evidence IDs close REQ-F-01-EMB-01..06.
- **Owner:** general(vasquez) — Engineering Owner (R1). Remediation: add six rows
  (REQ-F-01-EMB-01..06 → evidence IDs → status → commit) and refresh the header title.

### FIND-QA-03 — Stale long-running dev server would serve pre-change code — **Low**
- **Location:** `node src/server.ts` pid 35667 on `127.0.0.1:3151`, started
  2026-09-24 09:49, while `src/store.ts` / `db/queries.ts` mtimes are 13:12 / 13:10.
- **Impact:** any `verify` run pointed at `:3151` (the convention used by prior lanes,
  incl. `TEST_MATRIX.md`) validates **old** code and would silently understate (or
  misstate) this lane's evidence.
- **Handling here:** this review started a fresh server on `:3199` with current code for
  `04-verify.log`; probe4 and verify-lifecycle talk to Helix / offline only and are
  unaffected.
- **Owner:** general(espinoza) — Automation/Ops Owner (R8), with engineering. Remediation:
  restart the dev server after code lanes, or pin evidence runs to a fresh instance.

### FIND-QA-04 — Open checkboxes in spec + proposal — **Low**
- **Location:** `SPEC-F01-EMB.md §3` (AC-01..05 all `[ ]`) and
  `40_workspace/engineering/PROPOSED_CHANGES.md` "Approval Required From" (R1/R2/R8 all
  `[ ]`).
- **Impact:** DoD trace reads as unfinished even though the runs are green; gate/handoff
  evidence should be linked in place.
- **Owner:** engineering owner (R1) flips ACs with evidence refs; orchestrator owns the
  packet/GATE state.

## Notes

1. **AC-04 mechanics:** there is no pure-vector REST route; `/memory/smart-search` is the
   vector-bearing surface (`hybridSearch` → `store.searchByVector`, `src/search.ts:192`).
   The three `consolidation: smart-search … hits the survivor` checks therefore carry the
   vector leg of AC-04; probe4's GATE 2 additionally proves pure `searchByVector` recall
   on a fresh `updateMemoryContent` (distance ≤ 1e-4). Adequate, recorded so the gate does
   not read AC-04 as untested.
2. **Live happy-path proof of C1:** every §P merge in `04-verify.log` ran
   `verifyMergedState` with a real `embedding` projection against live Helix and passed
   with no heal — that is the live proof that the f32 comparison does not false-positive
   (paired with the offline d3 false-positive guard).
3. **Non-flakiness:** each suite was executed twice in this review with identical totals;
   seams are deterministic canned-reply queues (`makeSeamStore`, unreachable port
   `127.0.0.1:9`) that fail loudly on any unexpected send.
4. **Storage:** `helix status` → `dev … http://localhost:6969 - Up … storage: disk`
   (HARD `storage=disk` honored). No instance was restarted or stopped.

## Verdict Rationale

All five acceptance criteria are green on current code with on-disk evidence, the
REQ→test→artifact trace holds for five of six requirements, log hygiene and projection
containment match REQ-06, and no regression or flakiness was observed. Two Medium gaps
keep this from an unconditional **pass**: REQ-F-01-EMB-02's shape-drift sub-branch is
unasserted (FIND-QA-01) and the repo's declared trace matrix was not extended
(FIND-QA-02). Both are owner-remediable test/doc additions with no product defect found.

**Gate verdict readiness:** this artifact + `evidence/*.log` are ready for consolidation.
Not yet present at review time: R2 security-reviewer and R8 automation-reviewer artifacts,
and `GATE_REPORT.md` — orchestrator consolidates per routing table (this reviewer did not
bundle or substitute for them). Expected consolidated status once FIND-QA-01/02 clear:
**OPEN**.
