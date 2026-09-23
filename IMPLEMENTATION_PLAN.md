# Implementation Plan: P1 (recall quality & lifecycle) + P2.1 (capture breadth)

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Approved By:** user ("vamos con lo que sugieres + p2.1" → plan presentado → "Dale"):
P1.3 → P1.6 → P1.1 (corte A: decay + TTL + purge por lectura, sin migración de
`lastRecalledAt`) + P2.1. Defaults adoptados y declarados:
(1) concepts explícitos ganan verbatim, derivación SOLO cuando `concepts` ausente;
(2) `dedupKey = sha256(project + "\n" + normalize(content))` con índice unique de
una propiedad; (3) env con prefijo propio `AGENT_MEMORY_TTL_DAYS` /
`AGENT_MEMORY_DECAY_LAMBDA` (divergencia deliberada §3.2 del ROADMAP — mi borrador
decía `MEMORY_*`, corregido); (4) TTL y decay **off por defecto** (no sorprender
rankings/hide existentes; el acceptance se prueba con env encendido);
(5) sin worktrees: lanes con archivos disjuntos, orchestrator dueño exclusivo de
la superficie compartida (desviación del worktree-annex declarada — aislamiento
logrado por propiedad de archivos, 2× `npm ci` + merge de docs innecesarios).
**Domains-Touched:** engineering (store/search/db/hooks/plugin), ops (purge script),
docs (CONTRACT v1.1, README, CHANGELOG), CI
**Prior lanes:** P0 closed (see git history + `docs/specs/50_archive/P0/GATE_REPORT.md`);
P3.1 closed at v0.2.0. This plan replaces the P0 content in-place (lane singleton).

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | REQ-P1-3 auto concept extraction: `src/concepts.ts` (new, deterministic: reuse embed tokenizer, stopword list, top-8 by tf then lex), derive ONLY when `concepts` absent (explicit wins verbatim — deviation from sketch, preserves §3 echo contract); `src/embed.ts` exports `tokenize` (additive) | `src/concepts.ts`, `src/embed.ts`, `src/store.ts` | `scripts/verify-lifecycle.ts` (new, pure/CI) + `scripts/verify.ts` D-section rewrite (default → derived non-empty) | M |
| 2 | REQ-P1-6 dedup on write: `dedupKey` param+property on `saveMemory`, index #8 `nodeUniqueEquality("Memory","dedupKey")` (probe legacy nodes first — backfill-blocked contingency: one-shot backfill script), read `findMemoryByDedupKey`, remember() pre-check → existing `{id,sessionId,project,concepts,deduped:true}` 201, race closed by a per-key in-process FIFO lock around that pre-check (shipped truth: probe3 proved the server does NOT enforce index #8 — application-side pre-check only, no `unique_constraint_violation` catch exists) | `db/queries.ts`, `db/index.ts`, `src/store.ts`, `scripts/probe3.ts` (new, live probe), `scripts/verify.ts` (dedup section) | probe log + verify dedup assertions (same id, count stable, searchable once) | M |
| 3 | REQ-P1-1 decay/TTL/purge (corte A): `src/lifecycle.ts` (new, pure: `normalizeContent`, `decayedImportance`, `filterExpired`), decay ties fused rows in `src/search.ts` (`AGENT_MEMORY_DECAY_LAMBDA`, default 0=off), TTL hides expired from both searches + `signals` entry (`AGENT_MEMORY_TTL_DAYS`, default off), `scripts/purge.ts` (new, Helix-direct like bootstrap: `listExpired` read (probe `ltParam` dateTime first) → per-id `forgetMemory` loop, `--days/--project/--dry-run`) | `src/lifecycle.ts`, `src/search.ts`, `db/queries.ts`, `scripts/purge.ts`, `scripts/verify-lifecycle.ts` (pure: decay/TTL/dedup-hash/concepts) + `probe3` (e) `ltParam`; purge evidence = dry-run + exit-2 guard run log (real-run not harnessed, code-reviewed) | verify-lifecycle count (39) + probe3 GREEN + purge dry-run/exit-2 guard log | M |
| 4 | REQ-P2-1 hook coverage (**parallel to 1–3**, disjoint files): `hooks/capture.mjs` SUPPORTED += `PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit` (fixed-string / tool-name-only content — `UserPromptSubmit` NEVER captures prompt text, Ley 172-13); OpenCode plugin registers `tool.execute.before` (fire-and-forget POST, never awaited/never throws, skips `memory*` tools, `origin="hook:tool.execute.before"`); `scripts/verify-capture.ts` (new, spawns capture.mjs vs local counting server: 7 events + negatives, stdout/stderr empty, exit 0) | `hooks/capture.mjs`, `plugins/opencode/plugins/agent-memory.ts`, `scripts/verify-capture.ts` | verify-capture ALL PASS (events × payload × silence × exit code) | M |
| 5 | Orchestrator: CONTRACT → v1.1 (§1 dedupKey + index 8; §2 new exports; §3 derived defaults + `deduped` + decay/TTL env semantics + hook events; §4 remove "Decay" from do-not-build; §0 new probe facts), README (config + purge), CHANGELOG, version 0.4.0 (`package.json` + `src/mcp.ts` + plugin `VERSION`), ROADMAP ticks, `package.json` scripts (`verify-lifecycle`, `verify-capture`, `purge`), CI += both new local scripts | `docs/CONTRACT.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `package.json`, `src/mcp.ts`, plugin, `.github/workflows/ci.yml` | diff review | S |
| 6 | Quality checks: `typecheck`, `verify-lifecycle`, `verify-capture`, `verify-injection`, `verify` vs OUR server on **3151** (3111 = upstream iii, never kill; Helix dev never restarted, contract §0), gitleaks | repo root | local runs + TEST_MATRIX | S |
| 7 | ROADMAP rows ticked with evidence, TEST_MATRIX filled, report → quality-gate | `ROADMAP.md`, `TEST_MATRIX.md` | diff | S |

## Order of Operations

Steps 1→2→3 are sequential INSIDE Lane A (all touch `src/store.ts` /
`db/queries.ts` — one file, ordered commits). Step 4 (Lane B) runs in parallel
with 1–3: zero file overlap (hooks/plugins/scripts-verify-capture vs
src/db/scripts-purge). Steps 5→6→7 last (orchestrator owns every shared file —
lanes MUST NOT touch docs/README/CHANGELOG/ROADMAP/package.json/CI/plan/matrix;
a lane needing a shared file briefs the orchestrator instead).

## Rollback Points

- After step 1: revert `src/concepts.ts` + `store.ts`/`embed.ts` hunks; verify.ts D-section restored — no schema touched.
- After step 2: revert `db/queries.ts` + `store.ts` dedup hunks; index #8 is
  **orphaned, not dropped** — the repo has no index-drop mechanism
  (`bootstrapIndexes` only creates), so reverting does NOT remove it from an
  already-bootstrapped instance; per probe3 an orphaned, now-unused unique
  index is inert, and removal would need a future drop tool (the other 7
  indexes are unaffected); `deduped` field removal is additive-reversible.
- After step 3: revert `src/search.ts` + `lifecycle.ts` + `purge.ts`; env defaults are OFF so rollback never changes live behavior for configured users mid-flight.
- After step 4: revert `capture.mjs` + plugin hook registration + `verify-capture.ts` — host pipelines keep flowing (exit-0 guarantee is per-event).
- Assumption stated: dev-instance data is seed/verify data (probe writes use isolated `probe-p1-*` projects); no production data risk.

## Quality Gates

- [x] Engineering: `npm run typecheck` clean (no `any`, no `@ts-ignore`, no TODO) — exit 0
- [x] Engineering: `npx tsx scripts/verify-lifecycle.ts` green — **39 passed, 0 failed**
- [x] Engineering: `npx tsx scripts/verify-capture.ts` green — **115 checks, 0 failed**
- [x] Engineering: `npx tsx scripts/verify-injection.ts` green — **ALL PASS (73)**
- [x] Engineering: `npm run verify` green against OUR server on **3151** — **152 passed, 0 failed**; §5 bar + dedup/concept + dedup×hook (F4) sections; upstream iii on 3111 untouched (+ `verify-env` 21, `demo OK`, `bootstrap 8 indexes`)
- [x] Ops: `scripts/purge.ts --dry-run` (would-delete=1 on probe-p1-ttl) + usage guard exit 2; `listExpired` `ltParam` dateTime probe-verified → contract §0 fact
- [x] Security: `UserPromptSubmit` stores NO prompt text (canary asserted in verify-capture); hook contents fixed-string/tool-name only; dedupKey stores no raw content; no secrets in any new log line (purge governance line allowlisted). **gitleaks: local run unavailable (2× download timeout, escalated) → CI P0.2 secret-scan job enforces on push**
- [x] Docs: CONTRACT v1.1 amendments match shipped code; README env vars documented; CHANGELOG v0.4.0 entry; version 0.4.0 in all lockstep locations (package.json, lockfile, `src/mcp.ts`, plugin `VERSION`, README badge)
- [x] Automation/ops: CI runs the two new local scripts (`verify-lifecycle`, `verify-capture`); no new required env vars (TTL/decay default off)
- N/A: finance / legal / marketing / people / revenue (engineering + docs change)
