# Quality Assurance Review: P3.1

**Reviewer:** quality-assurance (final engineering reviewer; test adequacy + REQ traceability only)
**Date:** 2026-09-22
**Verdict:** PASS

**Evidence basis:** server on `3151` was **down** during this review (TCP closed, `livez` → 000) → **static review only** for the suite: `npm run verify` NOT re-run; relied on packet HARD (`102 passed, 0 failed → VERIFY PASS` on 3151, MCP handshake = 11 tools) + independent static census below. `npm run typecheck` re-executed this review: exit 0, zero output. Review range `git diff e9fd325..HEAD` (11 commits: 6 lane + 5 remediation).

## Checklist

- [x] All acceptance criteria have tests — P3.1 round-trip fully asserted in `scripts/verify.ts` §N (see Assertion Map); MCP parity asserted statically (T-002, limitation F-4).
- [x] All REQ-IDs traceable to test IDs — 6/6 rows in `TEST_MATRIX.md` map to a real artifact (Traceability table).
- [x] Unit + integration + e2e coverage as appropriate — repo bar is `typecheck` (unit-equivalent) + REST E2E `verify`; no unit framework exists (declared N/A in matrix).
- [x] Regression suite updated — §A–L untouched by the lane (refuter RF-008: 0 deletions in `verify.ts`); §N added + 1 remediation assertion (membership).
- [x] No flaky tests introduced — all §N asserts deterministic (no sleeps/timing; membership guarded by N1 success; unique project per run).
- [~] Coverage threshold met — no numeric coverage tooling in repo (only `tsc --noEmit`); acceptance-criteria coverage 6/6 REQ + 1/1 acceptance criterion. N/A per declared repo bar.
- [~] Manual exploratory testing — live re-run impossible (3151 down); packet HARD carries the live run, static census reproduces the count (F-5).

## Traceability (REQ-ID → test → artifact)

| REQ-ID | Test ID | Type | Artifact (evidence) | Status |
|--------|---------|------|---------------------|--------|
| REQ-P31-1 | T-001 | Integration | `scripts/verify.ts` §N1–N8 (lines 503–664): all 4 routes round-trip; boundaries at 530–539 (extra origin→400), 647–648 (missing reason→400), 650–655 (unknown id→404) | pass |
| REQ-P31-2 | T-002 | Integration (static) | `src/mcp.ts` `registerTool(` × **11** (grep, this review); one-off handshake probe recorded in `IMPLEMENTATION_PLAN.md:43-44`; auth-first `handle()` wrapper unchanged (refuter RF-009) — **no in-repo E2E** → F-4 | pass w/ limitation |
| REQ-P31-3 | T-003 | Review | `docs/CONTRACT.md` §3 rows 131–134 (4 new), §4 211–214 (lessons/recap/handoff no longer excluded), §5 218–223 (bar extended); commit 33849ee | pass |
| REQ-P31-4 | T-004 | E2E | `scripts/verify.ts` §N chain, commit e3abc6e (+ bfc10c5 membership); assertion census **77 `check(` + 25 `shape(` = 102** matches packet HARD | pass |
| REQ-P31-5 | T-005 | Review | `README.md` route rows 104–108, MCP rows 231–234, examples + verification entry 418–427; commit 77f292f | pass |
| REQ-P31-6 | T-006 | Unit (typecheck) | `npm run typecheck` re-run 2026-09-22 → exit 0, no `any`/`@ts-ignore`/TODO in diff (refuter RF-014) | pass |

**Coverage:** acceptance criteria 6/6 REQ-ID; acceptance criterion "each round-trips against the REST contract" 1/1 (T-001 + T-004). Line/branch coverage: no tooling in repo → N/A (declared bar is typecheck + verify).

## Acceptance-criterion assertion map (§N, "each round-trips")

| Step | Assertions (verify.ts lines) |
|------|------------------------------|
| lesson | 201 + envelope + echoes sessionId/project/concepts + uuid id (515–526) |
| search | 200 + envelope + finds lesson row + `origin === "lesson"` (547–553) |
| recap | 200 + envelope + sessionId echo + `count >= 1` + content present (558–563) + **membership: every bullet line belongs to requested session** (564–574, COND-004) |
| handoff | 200 + envelope + frozen first line `project=… memories=…` + `counts.memories >= 1` + content/session present (580–593) |
| counts | health 1 memory/1 session before delete — also proves rejected N2 stored nothing (597–600); 0 after delete (631–637) |
| delete | 200 + `{deleted:true, receipt:{memoryId,deletedAt}}` + receipt matches id (607–620) |
| gone | bm25 no longer returns row (623–629), health 0 (631–637), **second delete → 404 + `{error:"not_found"}`** (639–645), recap `count === 0` + content gone (657–664) |
| boundaries | **missing reason → 400** (647–648) ✔ · **extra `origin` → 400** (530–539) ✔ · **unknown id → 404 + body shape** (650–655) ✔ |

Chain fully asserted end-to-end; all three required boundaries present.

## Remediation conditions (COND-001..006 → closure evidence)

| COND | Commit | Closure evidence | State |
|------|--------|------------------|-------|
| COND-001 single-line sanitize | 5df18b6 | `\s+`→space transform **before** bounds, both lanes: `src/server.ts:53-61`, `src/mcp.ts:93-101`; typecheck green | closed (code-level → F-2) |
| COND-002 identity guard | bfc10c5 | read-only `POST /agentmemory/recap` probe **before first write** (first write = line 304); non-200 → "No data was written", exit 1 (`verify.ts:253-279`) | closed |
| COND-003 governance purpose/TTL + receipt | f2a65d4 | `docs/CONTRACT.md:150-156` (purpose/store/retention/deletion; receipt omits `reason` by design) | closed |
| COND-004 recap membership | bfc10c5 | assertion `every bullet line belongs to the requested session` (`verify.ts:564-574`), directly closing refuter CE-003 | closed |
| COND-005 shared digest + budget | 3221b93 | `src/digest.ts` single source, `DIGEST_BUDGET_MS=20_000`; both lanes import `buildDigestLines` (`server.ts:19`, `mcp.ts:18`); local copies deleted | closed |
| COND-006 MCP strictness wording | fff74ad | `README.md:112-116` strip-vs-reject declared; plan Automation/ops box checked (`IMPLEMENTATION_PLAN.md:46-47`) | closed (residual wording → F-3) |

## Exit & isolation

Exit 0 only on green: `failures.length > 0 → exit 1` (`verify.ts:668-671`), crash → exit 1 (675–678), identity mismatch → exit 1 pre-write (260–278); guards cannot silently skip asserts (a skipped block implies a recorded shape failure). Isolation: unique `verify-<uuid>` project per run (291) + second unique `verify-p31-<uuid>` project/sid for §N (503–504), so count math and re-runs stay clean.

## Findings

| ID | Severity | Location | Finding | Evidence |
|----|----------|----------|---------|----------|
| F-1 | Low | `IMPLEMENTATION_PLAN.md:39` | Doc-count drift: plan gate claims **`101 passed`** while `README.md:418` and packet HARD say **102**; static census = 77 `check(` call sites + 25 `shape(` = 102. Plan line is stale after bfc10c5 added the membership assertion (+1). | grep census this review; `git show bfc10c5` |
| F-2 | Low | `scripts/verify.ts` (absent); `src/server.ts:53-61`, `src/mcp.ts:93-101` | COND-001 closure is **code-level only** — no automated case posts a newline-bearing `reason`. Structurally unobservable via REST (receipt omits `reason` by design; only server log differs), and repo has no unit framework — so code + typecheck is the achievable bar. Residual accepted, but not suite-regressed: a future schema refactor could silently drop the transform. | `git show 5df18b6`; §N reasons all single-line literals (603–653) |
| F-3 | Low | `docs/CONTRACT.md:183`, `TEST_MATRIX.md:10` | "mirror the REST bodies/response shapes" / "input schemas mirror REST" retained after COND-006, while `README.md:112-116` now documents the real divergence (SDK strips unknown keys; REST 400s). Field-level mirror is true; strictness mirror is not — matrix/contract wording is stale relative to README. | grep `mirror` vs README:112-116 |
| F-4 | Low (known limitation) | `scripts/verify.ts:499-502`, `src/mcp.ts` | **MCP behavioral round-trip unasserted E2E**: no in-repo script drives `memory_recap/handoff/lesson/delete`; T-002 evidence is registration count (11, static) + one-off handshake probe. Residual judged **acceptable for this gate**: the main drift vector is killed by shared `src/digest.ts` (both lanes), REST asserts the envelope contract §3 froze, typecheck covers signatures, and README now documents the one intentional divergence. Not reproducible from `npm run verify` — keep named as limitation. | grep `registerTool(` = 11; no `memory_recap` invocation in `scripts/` |
| F-5 | Note | environment | Port 3151 not listening during review → live `npm run verify` not re-executed; static census (102) + re-run typecheck corroborate packet HARD. | TCP probe + curl `livez=000` |

**Findings count: 5 (4 Low, 1 Note). No Critical/High.**

## Verdict Rationale

**PASS** — every REQ-P31-* row traces to a real artifact, the full lesson→search→recap→handoff→delete→404→counts chain plus all three boundaries (missing reason 400, extra origin 400, unknown id 404) is asserted in §N, all six remediation conditions have closure evidence (COND-001 at schema level, structurally untestable E2E), verify stays exit-0-only-on-green and tenant-isolated, and typecheck is green — the residuals (101-vs-102 plan drift, no MCP E2E, no sanitize regression test) are Low, documented, and non-blocking for this gate.

**Rationale (one line):** Traceability 6/6, round-trip chain + boundaries fully asserted, 6/6 COND closures evidenced — PASS with 4 Low findings (doc drift, code-only sanitize proof, mirror-wording staleness, MCP E2E limitation) and one environment note (3151 down → static review).
