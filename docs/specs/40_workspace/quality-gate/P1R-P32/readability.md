# Readability Review: P1 remainder (P1.4+P1.2+P1.5) + P3.2

**Reviewer:** review-readability (independent, engineering domain)
**Date:** 2026-09-23
**Verdict:** pass
**Scope (diff d17294b..HEAD):** `591c79c` (REQ-P1-4), `39fec28` (REQ-P1-2),
`df39d7d` (REQ-P1-5), `c69636d` (REQ-P3-2), `2deda68` (docs integration).

## Checklist

- [x] Naming is intention-revealing (no `data`, `tmp`, `x`)
- [x] Functions have single responsibility
- [x] Nesting depth <= 3
- [x] Comments explain WHY, not WHAT
- [x] Public APIs documented
- [x] No dead code or commented-out blocks
- [x] Consistent style with surrounding code

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| —  | —        | —        | None (0 findings) |

## Evidence

- **Naming:** domain-revealing identifiers throughout the new surface —
  `deriveWriteImportance` / `confidenceBoost` / `noteRecall` / `recallCount`
  (`src/confidence.ts`), `jaccard` / `mergeThreshold` / `isNearDuplicate` /
  `mergedContent` (`src/consolidate.ts`), `pickSurvivor` / `consolidateInto` /
  `effectiveImportance` / `effectiveConcepts` (`src/store.ts:405-616`),
  `updateMemoryContent` (`db/queries.ts:516-564`), `EvalClient` / `RestClient` /
  `validateCorpus` / `scoreQuery` / `recallAt` / `ndcgAt10` / `mapToDocIds`
  (`scripts/eval.ts`). Short fixture names in test/probe files (`V1/V2/V3`,
  `confX/confY`, `pv1..pv3`, `C1/C2/E1/E2`, `b0/b1/b5`, `obm/pbm/phy`) each
  carry an adjacent doc comment defining them and follow the pre-existing
  verify.ts section-prefix convention — scan found no bare `data`/`tmp`/`x`
  style names.
- **Single responsibility:** every new src function does one job
  (`mergedContent` = merge only; `pickSurvivor` = candidate ranking only;
  `consolidateInto` = survivor rewrite only; `rememberLocked` = dedup →
  consolidate → insert as three commented steps). Harness `main()` functions
  are linear drivers that delegate to small helpers (`validateCorpus`,
  `fetchHealthCounts`, `createClient`, `renderScorecard`) — the same
  procedural convention as the pre-existing `scripts/verify.ts`.
- **Nesting depth ≤ 3:** worst cases measured at exactly 3 —
  `pickSurvivor` (`for` → `if` → `if`, `src/store.ts:405-438`),
  `probe4.ts` `main` (`try` → `else` → `if (isRecord)`), `verify-skills.ts`
  structural loop (`for` → `if` → `if`), `parseFrontmatter` (`for` → `if/else if`).
- **Comments = WHY:** `src/confidence.ts:1-17` (purity vs ledger-state trade-off
  and cap rationale), `src/consolidate.ts:34-46` (default-ON and fail-closed OFF
  reasoning), `src/store.ts:545-555` (fail-closed probe posture + documented
  large-content residual), `src/search.ts:143-155` (frozen 4-level tie order and
  "boost only reorders exact ties"), `scripts/verify-lifecycle.ts:387-390` (why
  goldens replicate the IEEE-754 expression), `scripts/probe4.ts:1-50` (A/B gate
  design and authorized fallback). No comment merely restates the code.
- **Public APIs documented:** all exports of `confidence.ts` and
  `consolidate.ts` carry JSDoc; `RememberInput.importance?` and
  `RememberResult.consolidated` documented inline (`src/store.ts:106-137`);
  `updateMemoryContent` has a full contract block incl. the var-name-resolution
  caveat for `conceptBody()`; `EvalClient`/`EvalDoc`/`EvalQuery` documented;
  9 SKILL.md frontmatter descriptions present (≥80 chars enforced by
  `verify-skills`); CONTRACT v1.2 documents the derived-importance default,
  `consolidated`, the merge env, and the tie-break order.
- **No dead code / commented-out blocks:** repo-wide grep over `*.ts` for
  commented-out statements (`// const|let|return|if|function|await|import`)
  matched only a pre-existing WHY comment in `scripts/verify-capture.ts:470`
  (outside this lane's diff); grep for `TODO`, `@ts-ignore`, `: any`,
  `as any` matched nothing in the repo; `npm run typecheck` exit 0 (read-only
  run). Every new export is consumed (e.g. `isNearDuplicate` → verify-lifecycle
  §G; confidence fns → `search.ts`/`store.ts`/verify suites; `EvalDoc`/
  `EvalQuery` → `eval.ts`); `resetRecalls` is explicitly marked "tests only"
  and used only by tests.
- **Consistent style:** new files reuse the repo's `/* --- */` banner
  sections and the `check`/`shape`/`brief` assertion plumbing verbatim;
  `rememberLocked` step comments were renumbered 1 → 2 → 3 correctly after
  the consolidation step was inserted (`src/store.ts:496,545,569`);
  `confidence.ts`/`consolidate.ts` docstrings explicitly mirror
  `src/lifecycle.ts`; all 9 SKILL.md files share one template (When to use /
  Tools+routes / Example / Rules / Failure behavior) with identical
  port-conflict and no-secrets/PII wording; CHANGELOG follows Keep a Changelog;
  version reads 0.5.0 in `package.json`, plugin `VERSION`, `src/mcp.ts`, badge.

## Verdict Rationale

Pass — all seven checklist items hold across the five commits (~4.3k added
lines): names reveal intent (terse test fixtures are documented in place and
follow local convention), every new function is cohesive with worst-case
nesting of exactly 3, comments consistently explain contract/fail-closed/determinism
WHYs rather than restating code, all new public surfaces (pure modules, store
types, batch query, eval adapter, skills frontmatter, CONTRACT v1.2) are
documented, the diff introduced zero dead or commented-out code and zero
`any`/`@ts-ignore`/`TODO` (grep evidence + `tsc --noEmit` exit 0), and style
matches the surrounding codebase (banner sections, assertion plumbing,
numbered store steps, one skill template, Keep-a-Changelog). Candidates I
examined and rejected as noise: the double-guard around `rRem` in
`verify-skills.ts:411-425` (readable fail-fast), non-interpolating template
literals in scorecard notes (cosmetic), and linear harness `main()` length
(repo-established script convention). No finding without evidence was raised;
verdict is ✅ pass with 0 findings.
