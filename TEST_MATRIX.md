# Test / Evidence Matrix: P1 (recall quality & lifecycle) + P2.1

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Domains-Touched:** engineering, security (hook privacy), ops (purge), docs

Prior lane (P0) matrix evidence preserved in git history (this file is the lane
singleton, updated in place per execute-spec) and in
`docs/specs/50_archive/P0/GATE_REPORT.md`.

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P1-3 | T-101 | Auto concept extraction: `remember` without `concepts[]` derives ≤8 deterministic concepts (tf desc → lex tie-break, stopwords dropped) echoed in 201; explicit `concepts` win verbatim (echo exact — §3 preserved); derived concepts power graph branch on plain saves | Unit (`verify-lifecycle`) + E2E (`verify.ts` D + graph-branch assertion) | **DONE** — verify-lifecycle 34/34; verify.ts graph-branch fused score == 3/61 | `b27364b` |
| REQ-P1-6 | T-102 | Dedup on write: `dedupKey = sha256(project+"\n"+normalize(content))`, unique index #8; same fact twice → same id, `deduped:true`, healthCount stable, one retrievable row; legacy-node index probe (backfill contingency); race path catches `unique_constraint_violation` | Unit (`verify-lifecycle` golden) + E2E (`verify.ts` dedup section) + live probe (`probe3`) | **DONE** — probe3 GREEN: server does NOT enforce uniqueness → app-side pre-check under per-key FIFO lock (design adapted, §0 recorded); backfill contingency NOT needed (probe3 a3-2: nodes missing the property are harmless); dedup/race green in verify.ts | `101e063` |
| REQ-P1-1 | T-103 | Decay/TTL/purge (corte A): decayed importance in fused tie-break (`AGENT_MEMORY_DECAY_LAMBDA`, default 0=off, half-life property asserted); TTL hides expired from both searches + `signals` entry (`AGENT_MEMORY_TTL_DAYS`, default off); `listExpired` `ltParam` dateTime probe-verified; `purge.ts --dry-run`/real on isolated project, healthCount reflects it | Unit (`verify-lifecycle`) + E2E (`verify.ts` + purge run log) + live probe | **DONE** — probe3 (e) GREEN (strict older-than, project-scoped, $id Asc); purge dry-run `would-delete=1` on probe-p1-ttl + usage guard exit 2; decay/TTL math 34/34 | `45380b5` |
| REQ-P2-1 | T-104 | Hook coverage: `capture.mjs` supports 7 events (added `PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`); fixed-string/tool-name-only content, `UserPromptSubmit` captures NO prompt text; stdout/stderr empty, exit 0 on every path incl. negatives; plugin registers `tool.execute.before` (fire-and-forget, skips `memory*` tools, `origin=hook:tool.execute.before`) | Integration (`verify-capture.ts`, spawns hook vs counting server) + typecheck (plugin hook) | **DONE** — verify-capture 115/115 (payload/origin/exit-0/silence + prompt canary NOT stored + dead server + `captureToolStart` incl. `memory*` skip) | `8fbd795` |
| ALL | T-105 | No-regression: `verify-injection` 73 assertions green; `verify` §5 bar green on OUR server (3151, upstream iii on 3111 untouched); typecheck clean; gitleaks clean | E2E + Review | **DONE** — verify-injection ALL PASS (73); verify 131/131 on AGENT_MEMORY_PORT=3151 (iii on 3111 never touched); verify-env 21/21; typecheck exit 0; demo OK. gitleaks local run unavailable (2 download timeouts, escalated) → CI P0.2 secret-scan job is the enforcing gate on push | `45380b5`..`8fbd795` |
| ALL | T-106 | Docs/contract: CONTRACT v1.1 (§0 probe facts, §1 dedupKey+index8, §2 new exports, §3 semantics, §4 decay removed from do-not-build), README env+purge, CHANGELOG, version 0.4.0 lockstep ×3, CI += 2 scripts, ROADMAP ticks | Review | **DONE** — CONTRACT v1.1 + README (badge/8 indexes/dedup/decay/TTL/7 events/env/verification) + CHANGELOG v0.4.0 + ROADMAP P1.1/P1.3/P1.6/P2.1 ticks + stale rows (12 routes, 11 tools, hooks, tests) fixed; version 0.4.0 in package.json/lock/mcp.ts/plugin/badge; CI += verify-lifecycle + verify-capture | docs commit (this lane) |

## Coverage Summary

- Unit coverage: `verify-lifecycle.ts` (pure functions — dedupKey golden, decay math incl. half-life, TTL filter, concept determinism/limits) — CI-runnable, no Helix
- Integration coverage: `verify-capture.ts` (hook E2E vs local counting server — CI-runnable, no Helix)
- E2E coverage: `verify.ts` gains dedup round-trip, derived-concepts graph branch, lifecycle/purge sections; §5 bar preserved
- Evidence coverage: target 6/6 REQ-IDs with linked artifact
- Acceptance criteria covered: P1.3 → T-101; P1.6 → T-102; P1.1 → T-103;
  P2.1 → T-104; no-regression → T-105; contract/docs → T-106
