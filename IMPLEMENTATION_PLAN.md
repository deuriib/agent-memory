# Implementation Plan: P1 remainder (P1.4 + P1.2 + P1.5) + P3.2 skills

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-23
**Approved By:** user ("completa p1 + p3.2" → plan presentado → "DAle"):
P1.4 → P1.2 → P1.5 → P3.2. Defaults adoptados y declarados:
(1) P1.4 write-time: `importance` ausente → derivada de provenance (origin) +
nº de conceptos (`deriveWriteImportance`), ya no default 0.5 — cambio de
contrato documentado en CONTRACT v1.2 (§3 `importance=0.5` → derived);
(2) P1.4 ranking-time: recall boost `importance + 0.2·n/(n+1)` sobre un
ledger in-process (cap 10k, best-effort), aplicado DESPUÉS del decay en el
fused tie-break — stored `importance` sigue nunca reescrito (mismo patrón que
decay); (3) P1.2 near-dupe = Jaccard(tokens) ≥ umbral, default
`AGENT_MEMORY_MERGE_JACCARD=0.9` (≤0/inválido/≥1 → OFF) — **ON por defecto**
porque el acceptance del roadmap lo da por hecho y el merge concatena
(NUNCA descarta) contenido: riesgo de pérdida de texto = 0, umbral alto
declarado; (4) P1.2 survivor in-place (`setProperty` content/embedding/
dedupKey) preservando `memoryId`, con probe previo en el dev instance y
fallback declarado strategy-B (insert fila merged + forget variantes) si el
servidor no refresca índices tras `setProperty`; (5) P1.5 corpus propio
in-repo (`eval/corpus.ts`, determinista, sin red) — "public" = publicado con
el repo, cero dependencia de fetch externo; (6) sin worktrees: 2 lanes
paralelos con archivos disjuntos, orchestrator dueño exclusivo de la
superficie compartida (mismo desvío declarado que el lane P1+P2.1, aquí
reproducido — aislamiento por propiedad de archivos).
**Domains-Touched:** engineering (store/search/queries/confidence/consolidate),
ops (eval harness), docs (CONTRACT v1.2, README, CHANGELOG, skills), CI
(ningún script nuevo a CI: eval/skills/verify exigen server vivo)
**Prior lanes:** P0 closed, P1.1/P1.3/P1.6 + P2.1 closed at v0.4.0, P3.1 at
v0.2.0. This plan replaces the previous content in-place (lane singleton).

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | REQ-P1-4 derived confidence: `src/confidence.ts` (NEW, pure): `deriveWriteImportance(origin, conceptCount)` (lesson 0.75 / hook:* 0.55 / else 0.5, +0.025·min(concepts,8), clamp01), `confidenceBoost(importance, recallCount) = clamp01(i + 0.2·n/(n+1))`, recall ledger (`noteRecall`/`recallCount`/`resetRecalls`, Map cap 10k, clear-on-overflow documented); store `RememberInput.importance?: number` → derived when absent; `search.ts` fused tie-break = `confidenceBoost(decayedImportance(…), recallCount(id))` (decay THEN boost), both search paths call `noteRecall`; `server.ts`/`mcp.ts` drop `?? DEFAULT_IMPORTANCE` | `src/confidence.ts` (new), `src/store.ts`, `src/search.ts`, `src/server.ts`, `src/mcp.ts` | `verify-lifecycle` section F (pure math goldens) + `verify.ts` section (derived ≠ 0.5, boost monotonic, recall-lift E2E) | M |
| 2 | REQ-P1-2 consolidation tier-1 (near-dup merge): `src/consolidate.ts` (NEW, pure: `jaccard`, `mergeThreshold` from `AGENT_MEMORY_MERGE_JACCARD` default 0.9 fail-closed OFF, `isNearDuplicate`, `mergedContent` with substring guard — incoming already contained → unchanged, closes the re-merge loop); `db/queries.ts` += `updateMemoryContent()` WriteBatch (anchor by memoryId → setProperty content+embedding+dedupKey, reuse `conceptBody()` via `forEachParam` for the incoming's derived/explicit concepts from the SURVIVOR node); `remember` under the existing dedup FIFO lock: exact-dedup → return; near-dupe probe `searchByText(content, k=20)` → best candidate by (jaccard desc, importance desc, memoryId asc) → merge → return survivor id `consolidated:true` (FAIL-CLOSED on probe error, same fail-closed posture as the dedup pre-check); `RememberResult` += `consolidated: boolean`; dedup first-wins semantics preserved (no Session node on merge/dupe) | `src/consolidate.ts` (new), `db/queries.ts`, `src/store.ts` | probe4 (NEW `scripts/probe4.ts`, live dev instance: setProperty refreshes text/vector indexes? → A/B decision recorded) + `verify-lifecycle` (jaccard/threshold/substring goldens) + `verify.ts` consolidation section (3 variants → 1 row, 3 queries recall it, healthCount +1) | L |
| 3 | REQ-P1-5 eval harness (**parallel lane B, disjoint files**): `eval/corpus.ts` (NEW: ~40 deterministic dev/ops docs + ~15 queries with qrels, no network), `scripts/eval.ts` (NEW: pluggable `EvalClient` interface, `RestClient` via `AGENT_MEMORY_URL`; seeds project `agent-memory-eval` idempotently through dedup; scores R@5/R@10/MRR@10/nDCG@10 for BOTH `bm25` and `hybrid` modes; writes `docs/benchmarks/SCORECARD.md` with date, corpus size, reproduce steps; exit 1 if health fails) | `eval/corpus.ts` (new), `scripts/eval.ts` (new), `docs/benchmarks/SCORECARD.md` (new) | scorecard numbers + eval run log | M |
| 4 | REQ-P3-2 skill set (**lane C, after a slot frees**): 8 skills `skills/{recall,remember,recap,handoff,forget,lesson,commit-context,session-history}/SKILL.md` (frontmatter `name`+`description`, name == dirname; body: when-to-invoke, REST route + MCP tool table, request example, rules/failure behavior, contract-accurate); `skills/memory/SKILL.md` becomes the index linking all 8; `scripts/verify-skills.ts` (NEW: structural validation of all 8 + LIVE round-trip — each skill's route exercised against the REST server, 2xx assertions, aborts like `verify.ts` when no server) | `skills/**`, `scripts/verify-skills.ts` (new) | `verify-skills` ALL PASS (8 structural + round-trips) | M |
| 5 | Orchestrator: CONTRACT → v1.2 (derived importance replaces default 0.5 in §3, `consolidated` field, merge env + tier-1 semantics, eval harness in §5), README (config rows += merge env + eval + skills, verification counts), CHANGELOG, version 0.5.0 (`package.json` + `src/mcp.ts` + plugin `VERSION` + badge — AFTER lanes finish), ROADMAP ticks (P1.2, P1.4, P1.5, P3.2), package.json scripts (`eval`, `verify-skills`) | `docs/CONTRACT.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `package.json`, `src/mcp.ts`, plugin | diff review | S |
| 6 | Quality checks: `typecheck`, `verify-lifecycle`, `verify-capture`, `verify-injection`, `verify` + `verify-skills` vs OUR server on 3151 (3111 = upstream, never kill; Helix dev never restarted, contract §0), `eval` run producing the scorecard, gitleaks | repo root | local runs + TEST_MATRIX | S |
| 7 | ROADMAP rows ticked with evidence, TEST_MATRIX filled, report → quality-gate | `ROADMAP.md`, `TEST_MATRIX.md` | diff | S |

## Order of Operations

Step 1→2 sequential inside Lane A (both touch `src/store.ts`). Step 3 runs in
parallel with 1–2 (zero file overlap). Step 4 starts when Lane A or B frees
the 2-lane cap. Step 5→6→7 last (orchestrator owns every shared file — lanes
MUST NOT touch docs/CONTRACT, README, CHANGELOG, ROADMAP, package.json, CI,
plugin, plan/matrix; a lane needing a shared file briefs the orchestrator).

## Rollback Points

- After step 1: revert `confidence.ts` + hunks; default importance returns to
  0.5 — additive env-free rollback, no schema touched.
- After step 2: revert `consolidate.ts` + `updateMemoryContent` + remember
  hunks; MERGE env has no index artifacts; rows already merged in the dev
  instance are seed/verify data (probe projects `probe-p1-*`), no prod risk.
  Assumption stated: merge ON by default mutates survivor content in place —
  concatenation never loses text; rollback of merged rows is not promised
  (dev-instance data only).
- After step 3: delete `eval/` + `scripts/eval.ts` + `docs/benchmarks/` — no
  runtime path imports them.
- After step 4: delete the 8 skill dirs + `verify-skills.ts` — no runtime
  path imports them.

## Quality Gates

- [x] Engineering: `npm run typecheck` clean (no `any`, no `@ts-ignore`, no TODO) — exit 0
- [x] Engineering: `npx tsx scripts/verify-lifecycle.ts` green — **86 passed, 0 failed** (39 → +§F 23 confidence +§G consolidation)
- [x] Engineering: `npx tsx scripts/verify-capture.ts` green — **115 checks, 0 failed** (no regression)
- [x] Engineering: `npx tsx scripts/verify-injection.ts` green — **ALL PASS (73)**, 0 failed (no regression)
- [x] Engineering: `npm run verify` green against OUR server on **3151** — **212 passed, 0 failed**; §O confidence + §P consolidation green; upstream on 3111 untouched; (+ `verify-env` 21)
- [x] Engineering: `probe4` **12 passed → VERDICT A** (in-place `updateMemoryContent`, strategy-B fallback NOT needed); `verify-skills` **119 checks → VERIFY SKILLS PASS**; `eval` **EVAL PASS** (bm25 & hybrid R@5/R@10/MRR@10/nDCG@10 = 1.0000 on our 40-doc/15-query corpus) writes `docs/benchmarks/SCORECARD.md` with our own numbers; `purge.ts` usage guard exit 2
- [x] Security: no secrets in eval corpus/scorecard/logs; skills carry the no-secrets/PII rule; plugin saves no pinned default importance; no new env vars besides `AGENT_MEMORY_MERGE_JACCARD` (documented, fail-closed OFF on bad config); **gitleaks: local binary unavailable (declared) → CI P0.2 secret-scan job enforces on push**
- [x] Docs: CONTRACT v1.2 amendments match shipped code; README (config row, skills section, verification counts, quick start); CHANGELOG v0.5.0; version 0.5.0 lockstep ×5 (package.json, lockfile, mcp.ts, plugin, badge)
- [x] Automation/ops: no CI change needed (new `eval`/`verify-skills` scripts need a live server — documented local-only like `verify`); no new REQUIRED env var (merge defaults ON with fail-closed OFF path)
- N/A: finance / legal / marketing / people / revenue (engineering + docs change)
