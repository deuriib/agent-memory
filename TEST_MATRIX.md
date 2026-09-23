# Test / Evidence Matrix: P2 completion (P2.2 + P2.3 + P2.4) + v0.6.0 release

**Agent:** orchestrator (execute-spec + ship-release lane)
**Date:** 2026-09-23
**Domains-Touched:** engineering, security, legal, automation/ops, data

Prior lane (P1 remainder + P3.2) matrix evidence preserved in git history
(this file is the lane singleton, updated in place per execute-spec).

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P2-2 | T-207 | File-edit + failure capture: `PostToolUse` with an edit-like tool name stores `file edited via <tool>` (name only; `AGENT_MEMORY_CAPTURE_PATHS=basename` opt-in appends the sanitized basename, default OFF; tool names carrying `/` or `\` fail closed → store nothing) + `PostToolUseFailure` and the plugin `tool.execute.after` store `tool failed: <tool>` (`hook:tool.execute.after`, own `memory*` skipped, non-string tool never throws); Antigravity `capture.mjs` mirrors the marker | Unit (`verify-capture` §A/§F — 137 checks: edit marker both hooks, basename opt-in OFF/ON, path-bearing `tool_name` → 0 requests, prompt/path canaries, plugin `captureToolFailure` origin + `memory*` skip, non-string helpers never throw) + adapter source review | **DONE** — verify-capture **137/137**; typecheck 0 | `2035e18` |
| REQ-P2-3 | T-208 | Script-only transcript import (`scripts/import-transcript.ts`: `--file/--project/--session-id/--dry-run/--include-prompts`) through the existing `POST /memory/remember` surface; Claude Code JSONL + generic `{content}` fallback; user text skipped by default (`skipped_prompts` counted, never printed); typed lines dispatch BEFORE the generic fallback (gate C1: `{type:"user"}` cannot bypass); caller `origin` coerced into `import:*` (gate C4) | Unit (`rowsForLine`: prompt-gate canary absent by default / present with opt-in; origin coercion `lesson`→`import:lesson`) + CLI dry-runs (default **4 rows / 1 skipped** vs `--include-prompts` **5 / 0**; unknown arg → exit 2) + E2E live import → `memory/search` hits on 3151 (rows `forget`-cleaned) | **DONE** — dry-runs + unit + live search reproducible; entry guard import-without-side-effects (gate C3) | `2035e18` |
| REQ-P2-4 | T-209 | Deterministic no-LLM session summarization (`src/summarize.ts` `buildSessionSummary`: top concepts, origin counts, time range, top-5 picks, top-3 lessons) + `scripts/summarize-session.ts` saving summary + ≤3 lessons as `/memory/lesson` rows under the SAME sessionId → closed session retrievable by `session` | Unit (`buildSessionSummary` byte-identical on repeat; empty-session shape `count:0`) + E2E live summarize → `GET /memory/sessions/:id/memories` contains summary + lessons (3 rows, cleaned via `forget`); CLI usage guard exit 2 | **DONE** — determinism proven + live sessionMemories proof | `2035e18` |
| ALL | T-210 | No-regression full bar pre-ship (consolidated run vs HEAD `2035e18`) | E2E | **DONE** — typecheck 0 · verify-capture **137/137** · verify-lifecycle **104/104** · verify-env **21/21** · verify-injection **ALL PASS** · verify-skills `--structural` **73/73** · purge usage guard exit 2 · `verify` **214/214** on OUR 3151 reroute (upstream `iii` on 3111 untouched) · verify-skills live **119/119** · server torn down (no leftover pid) | this release commit |
| ALL | T-211 | Release/contract docs: CHANGELOG **[v0.6.0]** heading above `### Added`, version 0.5.0 → **0.6.0** lockstep ×6 (`package.json`, `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`, README badge), RELEASE_NOTES v0.6.0, CONTRACT v1.3 §5 count 132 → **137** + **v1.4 DAT-001 declaration**, README counts (115 → 137) + out-of-scope version, ROADMAP P2.2–P2.4 ticks + DAT-001 closure, TEST_MATRIX (this file), tag `v0.6.0` | Review | **DONE** — grep-verified zero stale `0.5.0` version pins and zero stale 115/132 counts outside historical release sections | release commit |

## Coverage Summary

- Unit coverage: `verify-capture` §A–§F (hook payloads/origins/exit-0/silence,
  privacy canaries, dead server, edit marker, basename opt-in, path
  fail-closed, plugin failure/start helpers, non-string never-throw) +
  `rowsForLine` prompt-gate/origin-coercion units + `buildSessionSummary`
  determinism/empty-shape units — **137 capture checks**, CI-runnable, no
  Helix
- Integration coverage: import/summarize CLI dry-runs (server-free) + usage
  guards (exit 2); `verify-skills --structural` 73 server-free
- E2E coverage: `verify` **214** + `verify-skills` live **119** on the 3151
  reroute; live import→search and summarize→sessionMemories legs (rows
  cleaned via `forget`); DAT-001 orphan-cleanup procedure proved live against
  the dev instance (see CONTRACT §3 v1.4 for the verified expressions)
- Evidence coverage: 3/3 P2 REQ-IDs + 2 release rows, each with a linked
  artifact
- Acceptance criteria covered: P2.2 → T-207; P2.3 → T-208; P2.4 → T-209;
  no-regression → T-210; contract/docs/version → T-211
- Gate P2-COMPLETE remediation: C1–C6 (prompt-gate bypass, path-bearing
  tool-name, plugin non-string throw + unguarded before-hook, origin-namespace
  coercion, entry-guard side effect, README staleness) → **fixed + re-proven**
  (`50_archive/P2-COMPLETE/GATE_REPORT.md`); residuals G1/G2/F2/F6 +
  R-P2-01…04 / L-P2-01…03 / S-03 accepted with owner + expiry there;
  standing RL-001 / F-01 → `ROADMAP.md` §1.3; **DAT-001 → closed this
  release** (CONTRACT v1.4 declaration with live-verified procedure)
