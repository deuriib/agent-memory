# Test / Evidence Matrix: P1 remainder (P1.4 + P1.2 + P1.5) + P3.2

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-23
**Domains-Touched:** engineering, ops (eval), docs (skills, contract)

Prior lane (P1+P2.1) matrix evidence preserved in git history (this file is
the lane singleton, updated in place per execute-spec).

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P1-4 | T-201 | Derived confidence: write-time `deriveWriteImportance(origin, conceptCount)` replaces the 0.5 default when `importance` is absent (lesson/hook/rest bases + concept bonus, clamp01, pure deterministic); ranking-time `confidenceBoost(importance, recallCount)` on an in-process recall ledger (cap 10k) applied AFTER decay in the fused tie-break; stored `importance` never rewritten; plugin no longer pins a client-side 0.5 | Unit (`verify-lifecycle` §F: 23 goldens + §F-bis decay-then-boost order golden [CE-002] + §I plugin no-default source check [COND-QA-02b]) + integration (`verify.ts` §O: 22 checks — ledger/tie ordering runs the REAL search path in-process against a stub store [CE-003], stored-importance over REST) + MCP adapter pass-through (`InMemoryTransport`, absent → `undefined`, explicit wins [COND-QA-02a]) | **DONE** — verify-lifecycle 104/104; verify 214/214 | `591c79c` + gate fix |
| REQ-P1-2 | T-202 | Consolidation tier-1: near-duplicate `remember` (Jaccard ≥ `AGENT_MEMORY_MERGE_JACCARD`, default 0.9, fail-closed OFF on bad config) merges into ONE survivor — content concatenated (substring guard closes re-merge loop), survivor `memoryId` stable, `dedupKey`/`embedding` rewritten, incoming concepts linked from survivor, result `consolidated:true`; probe4 proves `setProperty` refreshes text/vector indexes (else strategy-B fallback recorded) | Unit (`verify-lifecycle` §G: 24 goldens + §I fail-closed probe [COND-QA-03] + §I TTL×expired-survivor guard [RL-002]) + live probe (`probe4`) + E2E (`verify.ts` §P: 38 checks) | **DONE** — probe4 12/12 **VERDICT A** (text+vector refresh, dedupKey round-trip, concept re-link; fallback not needed); §P: 3 variants → 1 row, each variant recalls it, healthCount +1, merged-text re-save → dedup loop guard; §I: induced probe error → `remember` rejects, insert never sent | `39fec28` + gate fix |
| REQ-P1-5 | T-203 | Eval harness: adapter-pluggable (`EvalClient` + `RestClient`, `EVAL_MODE`), deterministic in-repo corpus (~40 docs, 15 queries with qrels, no network), seeds project `agent-memory-eval` idempotently, scores R@5/R@10/MRR@10/nDCG@10 for bm25 AND hybrid, writes `docs/benchmarks/SCORECARD.md` with our own numbers | E2E (`npm run eval` run log + scorecard artifact) + Unit (`verify-lifecycle` §H: hand-computed R@5/R@10/MRR/nDCG/aggregate goldens — rank-2 hit, missed doc, 2-doc qrel [COND-QA-01/CE-001]) | **DONE** — `EVAL PASS` ×2 (Lane B run + orchestrator re-run on 3151): bm25 & hybrid R@5/R@10/MRR/nDCG = 1.0000 (corpus-specific all-rank-1 — disclaimed on the scorecard's face; metric math regression-tested by §H goldens, so a wrong formula now fails CI; no upstream numbers claimed) | `df39d7d` + gate fix |
| REQ-P3-2 | T-204 | Skill set: 8 SKILL.md (recall, remember, recap, handoff, forget, lesson, commit-context, session-history) with valid frontmatter (name == dir), contract-accurate REST route + MCP tool tables, examples; `skills/memory/SKILL.md` links all 8 (stale "7 tools" → 11); `verify-skills.ts` structurally validates all 8 AND live round-trips every skill's route against the REST contract behind the identity guard | Structural + E2E (`verify-skills` ALL PASS vs live server; `--structural` server-free mode for CI) | **DONE** — 119 checks = 73 structural + 46 live round-trips (project `verify-skills`, cleanup 4/4), run against 3151 (3152 held Lane B's pre-merge build — declared); `--structural` = 73/73, CI-wired (gate AUT-Low-B); +4 Session nodes/run declared (DAT-002) | `c69636d` + gate fix |
| ALL | T-205 | No-regression: `verify-injection` 73 green; `verify-capture` 115 green; `verify` §5 bar green on OUR server (3151, upstream iii on 3111 untouched); typecheck clean; gitleaks clean | E2E + Review | **DONE** — injection ALL PASS (73); capture 115/115; verify 214/214 on 3151; verify-lifecycle 104/104; verify-skills 119/119 (+ `--structural` 73/73); verify-env 21/21; typecheck exit 0; purge usage guard exit 2. gitleaks local binary unavailable (declared) → CI P0.2 secret-scan enforces on push | `591c79c..HEAD` (lane + gate fix) |
| ALL | T-206 | Docs/contract: CONTRACT v1.2 (derived importance, `consolidated`, merge env + tier-1, recall-boost order, `updateMemoryContent`, §4 tier-1, §5 bar), README (badge/config row/skills section/verification counts/quick start), CHANGELOG v0.5.0, version 0.5.0 lockstep ×5, ROADMAP ticks (P1.2/P1.4/P1.5/P3.2 + §1.1 parity rows), package.json scripts (`eval`, `verify-skills`), RELEASE_NOTES v0.5.0, README `EVAL_MODE` + tie-break + defaults rows, gate P1R-P32 declarations | Review | **DONE** — this integration commit + gate-remediation commit | docs commits (this lane) |

## Coverage Summary

- Unit coverage: `verify-lifecycle.ts` sections F (confidence, 23 goldens) +
  F-bis (decay-then-boost order), G (consolidation, 24 goldens), H (eval
  metrics, 9 hand-computed goldens), I (fail-closed probe, TTL×merge, plugin
  no-default) — **104 total**, CI-runnable, no Helix
- Integration coverage: `verify-skills.ts` (73 structural, `--structural`
  runs server-free in CI) + 46 live round-trips (server required,
  local-only like `verify`); `verify.ts` §O/§P/MCP-adapter = real search +
  adapter paths (214 total)
- E2E coverage: `probe4` covered the `setProperty`-index-refresh unknown
  (VERDICT A, 12 checks); eval run + scorecard artifact
- Evidence coverage: 6/6 REQ-IDs with linked artifact
- Acceptance criteria covered: P1.4 → T-201; P1.2 → T-202; P1.5 → T-203;
  P3.2 → T-204; no-regression → T-205; contract/docs → T-206
- Gate P1R-P32 remediation: conditions COND-QA-01…04, CE-001…003,
  RL-002…004, SEC-001, AUT-001, DAT-003/004, RK-003, R1/R2 → **fixed**;
  RL-001, F-01, F-03, DAT-001, DAT-002, SEC-002 → **waived with owner +
  expiry** in `docs/specs/40_workspace/quality-gate/P1R-P32/GATE_REPORT.md` (C3)
