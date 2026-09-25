# Readability Review: Brainy v1

**Reviewer:** review-readability
**Date:** 2026-09-25
**Verdict:** conditional
**Scope:** `src/**`, `db/queries.ts`, `bin/brainy.mjs`, `scripts/*.ts`, `hooks/capture.mjs` (commits `7757ac1..908ce3e`)
**Stage skill:** `frame-ship:quality-gate` (dispatched reviewer; no chain skill re-load required)
**Role:** `prompts/review-readability.md` — independent reviewer; no code under review was written by this reviewer.

## Checklist

- [x] Naming is intention-revealing (minor exceptions — RD-002)
- [x] Functions have single responsibility
- [x] Nesting depth <= 3 (no 4+-deep blocks found in scope)
- [~] Comments explain WHY, not WHAT (excellent overall; two drifts — RD-001, RD-003)
- [x] Public APIs documented (module headers + contract § cites throughout)
- [x] No dead code or commented-out blocks (checked below)
- [x] Consistent style with surrounding code

Dead-code sweep (evidence, HEAD `908ce3e`): no commented-out code blocks in scope;
no undocumented TODOs (only `TODO_ROW_NAMES` constant at `src/store.ts:686`,
`TODO/FIXME` regex heuristics in `hooks/capture.mjs:241-249`, and `console.log`
in `src/demo.ts` + access-log/server-listen lines in `src/server.ts:770,916,994`
— all intentional); `scripts/probe*.ts` are NOT wired in `package.json` scripts
but carry self-documenting run headers and are cited as empirical verification
by `db/queries.ts:1-8`, so they are documented spike artifacts, not dead code.
`npm run typecheck` clean, `npm test` 80/80 pass (2026-09-25).

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RD-001 | Low | `src/search.ts:136-164` | Stacked/misplaced doc comment: the `compareFusedAt` contract block (fixed-clock, tie order) sits directly above `tieBreakImportance`, so the comparator's contract reads as the helper's doc and `compareFusedAt` itself is left with no adjacent doc. Split: keep helper doc at `:155-164`, move the `:136-154` block down to `compareFusedAt` (`:174`). Owner: engineering. Commit `7a7691f`. |
| RD-002 | Low | `src/store.ts:1598-1622` | Terse locals in `listTodos`/`filterTodos` (`q`, `sub`, `out`, single-letter lambdas `t`/`a`/`b`) sit below this file's own naming bar (cf. `embeddingsEqual` `:102-119` with explicit `actual`/`expected`). Rename to `query`/`fallbackHits`/`filtered` or record an accept. Owner: engineering. Commit `5b40c8e`. |
| RD-003 | Low | `hooks/capture.mjs:27-29` vs `:236-286` | Header claims "Only a tiny, host-agnostic summary is stored … hook payloads … deliberately NOT captured", but `extractTodos`/`collectBody` read `hook.transcript/session_body/body/content/prompt.text/tool_output/result` and store derived todo titles. The `UserPromptSubmit` fixed-string path (`:72`) holds; the blanket header claim is stale relative to the todo auto-extract feature. Reconcile the header with the feature; privacy half needs security co-sign (see cross-domain request). Owner: engineering + security. |
| RD-004 | Info | `src/embed.ts:114-142` | `embedWithProvider` (network fetch, `OPENAI_API_KEY` bearer) lives in the "Deterministic, keyless" module whose header (`:1-13`) describes only the hash algorithm. Works, but module cohesion/naming has drifted; a one-line header note or relocation suffices. Owner: engineering. Commit `74ec6eb`. |
| RD-005 | Info | `bin/brainy.mjs` (1817 lines), `src/store.ts` (2086 lines) | Single-file scale noted; mitigated by section banners, pure slot derivation, and WHY comments throughout. No action — recorded so a future split has a baseline. Owner: engineering. |

## REQ rows covered (readability lens only)

- SPEC-001 (REQ-BRAINY-ENG-01..09): `src/store.ts`, `src/search.ts`, `src/embed.ts`, `src/server.ts`, `src/mcp.ts`, `src/concepts.ts`, `src/confidence.ts`, `src/consolidate.ts`, `src/lifecycle.ts`, `db/queries.ts`, `scripts/*.ts` — naming, structure, comment quality.
- SPEC-003 (REQ-BRAINY-OPS-*): `bin/brainy.mjs`, `scripts/verify-ops.ts` — CLI section structure, HARD-rule headers, helper naming.
- SPEC-002/004/005 (brand/security/legal shared surface): `hooks/capture.mjs` privacy comments, `src/server.ts` + `src/mcp.ts` schema/origin headers — comment accuracy only; no verdict on brand/security/legal substance (owned by their reviewers).

## Verdict Rationale

The codebase is clean, idiomatic, and unusually well-documented — module headers
cite the frozen contract, WHY comments dominate, early returns beat nesting, and
`typecheck` + 80/80 tests are green. Nothing approaches CLOSED. Three Low
comment/naming drifts carry line-numbered remediations (doc-only, zero behavior
change), hence **conditional** rather than pass. RD-004/RD-005 are Info notes,
not conditions.

## Conditions to clear

- [ ] COND-RD-001: attach the tie-order contract block to `compareFusedAt` (`src/search.ts:136-164`).
- [ ] COND-RD-002: rename `listTodos`/`filterTodos` terse locals or record an accept (`src/store.ts:1598-1622`).
- [ ] COND-RD-003: reconcile `hooks/capture.mjs` header with todo auto-extract + security co-sign on `collectBody` sources.

## Residual risk

- Low: `collectBody` fallback (`hooks/capture.mjs:280-282`) stringifies the whole
  hook payload when no long-text field is found — owner: security reviewer to
  confirm allowlist posture (cross-domain request below). Expiry: gate sign-off.

## Cross-domain request (for orchestrator)

- To security reviewer: co-sign COND-RD-003 — confirm `collectBody` source list
  (`transcript/session_body/body/content/prompt.text/tool_output/result`,
  `hooks/capture.mjs:262-286`) and the JSON-stringify fallback are within the
  approved PII allowlist, or file a security finding. Requested by
  review-readability, 2026-09-25.
