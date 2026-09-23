# Quality Gate Report — P2-COMPLETE (P2.2 + P2.3 + P2.4)

Lane: P2 capture breadth · Spec: `ROADMAP.md` P2.2–P2.4 + locked decisions
(basename opt-in OFF; script-only import, no new route).
Date: 2026-09-23 · Orchestrator-synthesized from 10 independent reviewer reports
in `docs/specs/40_workspace/quality-gate/P2-COMPLETE/`.

## Verdict: ✅ OPEN

First pass was ❌-CLOSED on two refuter-proven holes (R1 prompt-gate bypass,
R2 path-bearing tool name) plus a robustness hole (R3 plugin throw on
non-string tool). Owner (engineering) remediated all three within lane scope —
each fix repairs the plan's own claim, no scope expansion — and re-verification
is green (see §Re-verification). No waivers. Residuals below carry owner +
expiry; none blocks release.

## Reviewer verdicts

| Reviewer | Verdict | File |
|---|---|---|
| readability | ✅ PASS (nits only) | `readability.md` |
| reliability | ✅ PASS (1 low note) | `reliability.md` |
| refuter | ❌ 2 holes + 2 ⚠️ (first pass) → ✅ claims hold after remediation | `refuter.md` |
| resilience | ✅ PASS | `resilience.md` |
| risk | ✅ PASS | `risk.md` |
| quality-assurance | ⚠️ CONDITIONAL (G1/G2/G3) → ✅ G3 fixed; G1/G2 carried as residuals | `quality-assurance.md` |
| security | ⚠️ PASS, no blocker (S-01/S-02/S-03 lows) → ✅ S-01/S-02 fixed | `security.md` |
| legal | ✅ PASS (3 low docs-owned residuals) | `legal.md` |
| automation/ops | ⚠️ PASS, no blocker (F1–F6) → ✅ F1/F3/F4/F5 fixed; F2/F6 carried | `automation.md` |
| data | ✅ PASS (1 low backlog note) → ✅ origin coercion fixed | `data.md` |

## Cleared conditions (fixed + re-verified, not waived)

- **C1 / R1 — generic `{type:"user", content}` bypassed `--include-prompts`** (privacy,
  refuter ❌): `rowsForLine` dispatched the generic fallback before the type
  gate. Fix: recognized types dispatch FIRST; generic fallback serves untyped
  lines only (`scripts/import-transcript.ts`). Proven: default → `[]`
  (canary absent), opt-in → stored.
- **C2 / R2 — path-bearing `tool_name` stored verbatim** (privacy, refuter ❌):
  tool names with `/` or `\` now fail closed (store nothing) in both capture
  hooks. Proven: `verify-capture` §F `path-bearing tool_name: 0 requests`.
- **C3 / R3 — `captureToolStart` threw on non-string tool; `execute.before`
  unguarded** (robustness, refuter ⚠️→❌-grade): whole helper bodies in
  try/catch, non-string early-return, 80-char bound (hook parity); before-hook
  wrapped like the after-path. Proven: §F `non-string tool: helpers never
  throw`.
- **C4 / S-02 + data note — generic `origin` passthrough minted
  `lesson`/`hook:*` provenance** (importance integrity): origins coerced into
  `import:*` (`import:lesson`, …). Proven live via `rowsForLine` unit run.
- **C5 / QA G3 — entry guard fired on import**, blocking unit tests: both new
  scripts compare `argv[1]` to the module path. Proven: `import
  rowsForLine` with zero side effects.
- **C6 — docs staleness** (F1/F3/F4/F5, L-P2-01): README out-of-scope list,
  hook allowlist, new P2 CLI section with opt-in warnings; redundant
  self-fallback removed.

## Re-verification (post-remediation, this session)

- `typecheck` clean · `verify-capture` **137/137** (was 132; +5 gate-regression
  checks) · `verify-lifecycle` 104 · `verify-env` 21 · `verify-injection`
  ALL PASS
- Import dry-run unchanged (4 rows/1 skipped default; 5/0 opt-in); usage
  errors exit 2 on both CLIs; pre-remediation live import→search→summarize→
  sessionMemories proof stands (rows cleaned via `forget`; fix C1 only
  narrows what untyped user lines store — re-proven at unit level)

## Residuals (accepted, owner + expiry)

- **G1** — Antigravity `capture.mjs` edit marker has zero automated coverage
  (`verify-capture` only spawns `hooks/capture.mjs`). Owner: engineering.
  Expiry: next capture change or 2026-12-31.
- **G2** — No checked-in automated test for import/summarize live legs (manual
  runs only). Owner: engineering. Expiry: P4.1 or 2026-12-31. (G3 fix makes
  the unit half writable; import `--dry-run` is server-free and CI-wirable.)
- **F2** — `summarize-session` re-runs append unboundedly (documented in
  README; clean via `forget`). Needs guard/`--force` ticket. Owner:
  engineering. Expiry: 2026-12-31.
- **F6** — CI covers neither new script. Owner: engineering. Expiry: P4.1.
- **R-P2-01…04, L-P2-01…03, S-03, DAT-001-note** — lows as recorded in
  `risk.md` / `legal.md` / `security.md` / `data.md` (docs-owned or standing
  expiries incl. DAT-001 2026-12-31/v0.6.0).
- **Standing (unchanged):** RL-001, F-01 (ROADMAP §1.3); purge RL-002
  (out of lane).

## Trace

REQ→test→artifact: P2.2 → `verify-capture` §A/§F → `hooks/capture.mjs`,
plugin `captureToolFailure`, Antigravity adapter; P2.3 →
import dry-run + live search hits → `scripts/import-transcript.ts`; P2.4 →
deterministic unit + live `sessionMemories` → `src/summarize.ts`,
`scripts/summarize-session.ts`. Contract v1.3 amendment in
`docs/CONTRACT.md`; roadmap rows marked done.

Handoff: cleared for `frame-ship:verify-handoff` with SPEC/HARD/GATE/DOMAINS intact.
