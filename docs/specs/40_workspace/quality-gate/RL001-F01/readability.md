# Readability Review: REQ-RL-001 + REQ-F-01 (residual-closure lane)

**Reviewer:** review-readability (independent gate reviewer, R1-engineering/readability)
**Date:** 2026-09-24
**Scope:** 3 commits on main (unpushed) — `01224cc` (REQ-RL-001), `a0257d6` (REQ-F-01), `fb8e661` (docs CONTRACT v1.5 + README + CHANGELOG); diff range `a9ef417..HEAD`. Primary code: `src/store.ts`, `db/queries.ts`, `db/index.ts`, `src/consolidate.ts`; tests `scripts/verify.ts` §P `rl-001:`/`f-01:`, `scripts/verify-lifecycle.ts` §G/§I; docs `docs/CONTRACT.md` (v1.5), `TEST_MATRIX.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `CHANGELOG.md`.
**Checklist applied:** `frame-ship/skills/quality-gate/references/engineering/readability-review.md`
**Verdict:** ⚠️ **conditional** — 1 Medium finding (docstring drift) ⇒ 1 condition; 5 Low findings ⇒ backlog, no conditions.

## Checklist

- [x] Naming is intention-revealing (no `data`, `tmp`, `x`)
- [x] Functions have single responsibility (one soft-size exception, RD-004)
- [x] Nesting depth <= 3
- [x] Comments explain WHY, not WHAT (REQ/contract/probe references throughout)
- [ ] Public APIs documented — contract §2/§3 updated (v1.5), but one method docstring contradicts shipped behavior (RD-001)
- [x] No dead code or commented-out blocks (one write-only field, RD-002)
- [x] Consistent style with surrounding code

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RD-001 | Medium | `src/store.ts:704-706` | **Docstring drift vs actual behavior.** The `consolidateInto` method docstring still says the substring guard will "return the survivor WITHOUT a write (closes the re-merge loop)". Since `a0257d6` the guard path runs `ensureConceptLinks` (`src/store.ts:762-764`) — a `memoryConcepts` read plus a possible `linkMemoryConcepts` write. The inline comment at `src/store.ts:754-761` and CONTRACT §3 tier-1 (b) v1.5 (`docs/CONTRACT.md:64-67`) both state the new behavior correctly; the method-level docstring — the one a maintainer reads for the lock-path contract — was not updated and now contradicts its own body. |
| RD-002 | Low | `src/store.ts:165-171`, `869-877` | Dead field: `FreshSurvivorRow.memoryId` is populated by `getFreshSurvivor` but never read by any caller — consumers only read `content` (`:752-753`, `:1021`), `createdAt` (via `filterExpired`, `:745`), and `dedupKey` (`:1022`). The wrong-id identity assert inside `getFreshSurvivor` (`:855-862`) does not require returning the field. |
| RD-003 | Low | `src/store.ts:646-647`, `762-763`, `782-783` | The effective-concepts rule (`input.concepts.length > 0 ? [...input.concepts] : extractConcepts(input.content)`) is duplicated 3× across insert / guard / merge paths. These three sites must stay in lockstep (which list gets LINKED vs what the response ECHOES); a named helper (e.g. `effectiveConceptsFor(input)`) would make the shared rule explicit and prevent silent divergence. |
| RD-004 | Low | `src/store.ts:740-819` | `mergeUnderSurvivorLock` is ~80 lines with ~6 phases (fresh read → TTL re-check → guard heal → embed → write → verify → response), exceeding the ≤40-line soft guardrail. Readable today thanks to the comment structure, but the guard-path branch or response building could be extracted without changing the lock scope. |
| RD-005 | Low | `src/store.ts:4-8` vs `28-36` | Module header claims "the param schemas below are declared here, per contract — db/queries.ts only references them by name", but the three NEW schemas (`getMemoryByIdParams`, `memoryConceptsParams`, `linkMemoryConceptsParams`) are declared in `db/queries.ts:530-534,568-572,610-614` and imported into `store.ts` (the inverse). Pre-existing drift (the same pattern exists for the v1.1+ queries), amplified by this lane's 3 new imports. |
| RD-006 | Low | `TEST_MATRIX.md:12-13` (Commit column) | Evidence rows cite "commit 1 (see git log)" / "commit 2 (this release lane)" instead of the actual hashes `01224cc` / `a0257d6` that CONTRACT v1.5, CHANGELOG, and README all record — an evidence matrix should not require cross-file lookup for traceability. (The "docs untouched by this lane" bullet at `:25-26` is accurate as written — it scopes to the execute-spec lane and explains the docs-lane split — so no drift finding there.) |

## Conditions (verdict ⚠️)

- **COND-RD-01** — Fix RD-001: update the substring-guard sentence in the `consolidateInto` docstring (`src/store.ts:704-706`) so it matches post-`a0257d6` behavior: content/embedding/dedupKey stay byte-identical (re-merge loop stays closed) **but** the concept-link verify + link-only heal (`ensureConceptLinks` → `memoryConcepts` read, possibly `linkMemoryConcepts`) now runs on this path — consistent with the inline comment at `:754-761` and CONTRACT §3 tier-1 (b) v1.5. Verifiable as: comment-only diff, no behavior change, `npm run typecheck` still exit 0, reviewer re-read confirms the sentence no longer says "WITHOUT a write" unqualified.

RD-002..RD-006 are backlog (Low): record and fix at owner's discretion; they do not gate.

## Verdict Rationale

Naming, comment quality (why-not-what with REQ/contract anchors), type safety, and structure are strong across the lane: strict TS clean with no `any`/unsafe casts/`@ts-ignore` in the diff, no commented-out code or TODOs, lock-ordering and fail-closed rationale documented at every new seam, test fixtures explain their jaccard geometry precisely (the claimed 31-token base at `scripts/verify.ts:1478-1479` and j=10/11 at `:1578` check out arithmetically). One docstring contradicts the lane's own headline behavior change (RD-001), so the verdict is ⚠️ conditional on that single comment fix; everything else is Low hygiene.

## Evidence gathered (read-only)

- `npm run typecheck` — exit 0; `tsconfig.json:8 "strict": true`; grep of the diff finds no `any`, no `as`-casts beyond import aliases, no `@ts-ignore`, no TODO/FIXME in added code.
- `npm run verify-lifecycle` — **113 passed, 0 failed / VERIFY PASS** (matches CONTRACT §5 and TEST_MATRIX; §G `missingConcepts` goldens and §I 5-send guard-path seam green). Fully offline (seam store targets `127.0.0.1:9` with `send` overridden — no network, no writes).
- `curl http://127.0.0.1:3151/memory/livez` → ok; `/memory/health` → ok (read-only; no write probes run by this reviewer, so nothing to forget).
- `scripts/verify.ts` §P counts verified by inspection: 13 `rl-001:` checks (incl. 3 `shape(... variant N body)` checks) as claimed; `f-01:` block asserts match the CONTRACT §5 description. Full `npm run verify` not re-run by this reviewer — §P runtime evidence is owned by the execution-evidence lane (GATE bar-green) and re-running would write rows for no readability signal.
- Docs read completely: `docs/CONTRACT.md` (v1.5), `TEST_MATRIX.md`, `IMPLEMENTATION_PLAN.md`, plus README/CHANGELOG diffs. No secrets, no PII, no memory content, no embeddings appear in this report.

## Findings summary

Critical: 0 · High: 0 · Medium: 1 (RD-001) · Low: 5 (RD-002..RD-006) · Conditions: COND-RD-01
