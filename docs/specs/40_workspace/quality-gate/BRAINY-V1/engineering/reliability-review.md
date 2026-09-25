# Reliability Review: Brainy v1 (SPEC-001..005)

**Reviewer:** review-reliability (independent; did not write the code under review)
**Date:** 2026-09-25
**Verdict:** conditional
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..908ce3e` (HEAD `908ce3e`)
**Role prompt:** `/mnt/DATA/GitHub/dotfiles/dot_config/opencode/prompts/review-reliability.md`
**Checklist:** `/mnt/DATA/GitHub/frame-ship/skills/quality-gate/references/engineering/reliability-review.md`

## Checklist

- [x] Error paths handled explicitly (store fail-closed asserts throughout)
- [x] No swallowed exceptions (grep: zero empty `catch {}` in `src/`; two degraded catches analyzed below)
- [x] Input validation at boundaries (zod `.strict()` schemas, `src/server.ts:38-259`)
- [x] Deterministic behavior (frozen RRF k=60, fixed tie-break order, per-call env re-read documented)
- [x] Edge cases tested (empty/null/max/boundary via zod bounds + lifecycle goldens)
- [x] Idempotency where required (dedup locks, idempotent `stop`, idempotent setProperty re-send)
- [x] Timeouts on external calls (`QUERY_TIMEOUT_MS=15_000` on every Helix send, `src/store.ts:86,852-854`)

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | Helix shape drift (missing return var) | fail-closed throw, never read as miss | yes (`src/store.ts:939-949,1047-1049,1218-1228,1284-1299`) |
| FM-002 | Concurrent distinct near-dup merges (lost append) | serialize per survivor, fresh re-read under lock | yes (REQ-RL-001, T-RL-001 E2E green) |
| FM-003 | Survivor expires while queued | fall through to plain insert, never absorb | yes (`src/store.ts:1124-1130`) |
| FM-004 | Partial source failure in hybrid search | degrade into `signals`, never HTTP 500 | yes (`src/search.ts:81-90,241-249`) |
| FM-005 | Helix container restart mid-run | surface `internal_error`, green on re-run, no code change | yes (TEST_MATRIX.md lane note, harness-level) |
| FM-006 | Oversize body (>1MiB) | 413 `payload_too_large` | yes (`src/server.ts:314`) |
| FM-007 | Port collision on start (incl. 3111/3112/3113) | refuse exit 1 + neverKillHint, never signal | yes (`bin/brainy.mjs`, verify-ops §B/§I 124/124) |
| FM-008 | `GET /v1/context/:project` text-probe failure | currently silent `memories=[]` — QUIET FAILURE (RL-001) | **no** |

## Findings

| ID | Severity | Location | Finding + Evidence |
|----|----------|----------|--------------------|
| RL-001 | Med | `src/server.ts:549-553` | Quiet failure: `GET /v1/context/:project` catches `searchByText` failure and substitutes `memories=[]` with **no signal** — response reports `memoriesCount: 0` as fact. Every sibling search path degrades via `signals` (`src/search.ts:241-249`, `src/server.ts:721-734`); this route is the single exception. Evidence: `read src/server.ts:546-562` (try/catch → `memories = []`, no `signals` key in the 200 payload). Owner: R1. |
| RL-002 | Med | `src/store.ts:848` | Env misdirection: `HelixStore` constructor reads `HELIX_URL` only, not `BRAINY_URL`-canonical-first, contradicting SPEC-003 REQ-OPS-02 (known item 3). A canonical-only operator config silently targets shared dev `:6969` (384-dim) instead of the intended instance; failure mode is loud (`invalid_vector_dimension`) rather than corruptive, and a workaround exists (set `HELIX_URL`), so Med not High. Evidence: `src/store.ts:848` vs `scripts/bootstrap.ts:25` (bootstrap resolves `BRAINY_URL` first). Commit range `7757ac1..908ce3e`. Owner: R1. |
| RL-003 | Med | `docs/benchmarks/SCORECARD.md:29-44` | Scale leg not run: NFR-01 p95 proven only at N=40 (8.68ms), not at ~10k nodes; `scripts/eval.ts` has no scale knob (known item 4). Single max outlier 70.79ms at N=40 gives no headroom argument at 250x scale. No code defect; evidence gap blocks NFR-01 PASS. Owner: R1/R8. |

Non-findings (analyzed, accepted): `src/search.ts:297-299` traversal-enrichment `catch {}` is enrichment-only with an inline `// Graceful degradation` comment — row still returned with base fields, not a quiet failure. No empty `catch {}` anywhere in `src/` (ripgrep `catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}` → zero matches). Server 500 path logs via `logSafeNote` (`src/server.ts:890-893`).

## Rulings on the 5 known items

1. **`npm run bootstrap` FAIL on shared dev (`index_definition_conflict vector_dimension`)** — **accepted-residual**. Fail-closed against pre-existing 384-dim indexes is the correct behavior; dev left untouched; slot9 clean run ensured 25 indexes (`TEST_MATRIX.md` bar #5-6). Owner: engineering lane (done).
2. **`scripts/verify.ts` 238 passed / 5 failed (legacy 384-dim goldens)** — **condition, not blocker**. All 5 are expectation drift in an off-limits harness file (`embed length 384`, golden snapshot, 2 RRF goldens), deterministic across 2 runs, total 243 = historical bar; zero product-code signal. Condition: owning lane updates goldens to 1536-dim per INV-014. Owner: R1 (harness owner).
3. **`src/store.ts:848` reads `HELIX_URL` only** — **condition** (RL-002 above). Fix canonical-first read before next release; interim workaround (set `HELIX_URL`) documented in lane evidence. Owner: R1.
4. **NFR-01 p95 at N=40, 10k leg not run** — **condition** (RL-003 above). Scale harness (seed ~10k notes, report R@5/MRR/nDCG + p95) required before NFR-01 can PASS; no waiver claimed here. Owner: R1/R8.
5. **Hook probe POST to default `:3111` without `AGENT_MEMORY_URL`** — **accepted-residual**. Single fixed PII-free string (`user prompt submitted`), no prompt text, no secret, self-reported in `TEST_MATRIX.md` incident #2, not repeated. No recurrence; no further action. Owner: executing lane (closed).

## REQ rows covered

| REQ-ID | Reliability lens | Basis |
|--------|------------------|-------|
| REQ-BRAINY-ENG-05/06/07 | store write paths fail-closed, tenant guards | `src/store.ts`, `src/server.ts:427-483`, live C8 400s |
| REQ-BRAINY-ENG-09 | hybrid never-500, signals degradation | `src/search.ts`, live `signals:[]` no-500 |
| REQ-BRAINY-OPS-02 | env canonical-first (deviation RL-002) | `src/store.ts:848`, `scripts/bootstrap.ts:25` |
| REQ-BRAINY-OPS-05 | doctor order C1→C3→C2→C4→C5, exit precedence, never-kill | `bin/brainy.mjs`, verify-ops 124/124 (re-run this review) |
| NFR-BRAINY-ENG-01 | p95 latency (gap RL-003) | `docs/benchmarks/SCORECARD.md` |
| NFR-BRAINY-OPS-01 | never-kill, secret non-printing, port parity | verify-ops §I/§J/§L 124/124 |

## Independently re-verified (read-only, this review)

- `npm run typecheck` — exit 0, 0 errors.
- `npm test` — 80 passed, 0 failed.
- `npx tsx scripts/verify-lifecycle.ts` — 123 passed, 0 failed / VERIFY PASS.
- `npx tsx scripts/verify-ops.ts` — 124 passed, 0 failed / VERIFY PASS (incl. C1 zero-Auth proof).
- Ports 3111/3112/3113 never touched, never probed; no file modified except this artifact.

## Verdict Rationale

Core reliability posture is strong: fail-closed store asserts, FIFO lock ordering with a documented acyclic chain, per-request 15s Helix timeouts, deterministic fusion, idempotent stop, and honest lane evidence with nothing papered over. Three Medium items prevent PASS: one genuine quiet failure (RL-001), one env-misdirection deviation (RL-002), one unrun scale leg (RL-003). All have named owners and bounded remediation — hence **conditional**, not fail.

## Residual risk + owner

- Writes under a canonical-only (`BRAINY_URL`-only) config target the wrong Helix instance until RL-002 is fixed — loud failure, no silent corruption. Owner: R1.
- p95 at 10k-node scale unknown until RL-003 harness exists. Owner: R1/R8.
- `GET /v1/context/:project` may under-report `memoriesCount` until RL-001 carries a signal. Owner: R1.
