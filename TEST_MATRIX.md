# Test / Evidence Matrix: P0

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Domains-Touched:** engineering, security, ops (persistence), docs

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P0-1 | T-001 | `LICENSE` present (Apache-2.0), `package.json` `license` field matches | Review | pass | 44914e0 (pre-existing) |
| REQ-P0-2 | T-002 | CI workflow runs `typecheck` + `verify-injection` + pinned gitleaks v8.30.1 secret scan on every push/PR — actionlint artifact `evidence/actionlint.log` (0 errors, exit 0), local equivalents green, gitleaks `no leaks found` (25 commits scanned of 26 in history) | Review + local equivalent | pass locally; **green-on-`main` pending push (COND-01, QA-01/CE-01)** (2026-09-22) | 4cf0f6a |
| REQ-P0-3 | T-003 | `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` present and linked from README (README `## Contributing & security` + Specification link) | Review | pass (2026-09-22) | 7caa14d |
| REQ-P0-4 | T-004 | Persistence: `--disk --persist` default dev path; bootstrap warns when `helix.toml` lacks `storage = "disk"`; **save → `helix restart dev` → still searchable** — artifact-backed rerun 2026-09-22: canary `p04canary1790108269`, BM25 hit on first post-restart attempt, full log in `evidence/p0-4-restart-canary.log` (original run: canary `228cdf69`, score 0.863, single-source) | E2E | pass (2026-09-22, artifact) | c551774 |
| REQ-P0-5 | T-005 | Legacy `AGENTMEMORY_*` fallback: server started with only legacy names arms the guard (health 401 without / 200 with bearer), warns name-only; hooks stay silent | E2E (`scripts/verify-env.ts`) | pass — VERIFY PASS 21/21 (2026-09-22) | bb335e2 |
| REQ-P0-6 | T-006 | `EADDRINUSE` prints `AGENT_MEMORY_PORT=3151` reroute + never-kill-upstream note; README states port ownership definitively | E2E + Review | pass — verify-env sections A/C green; README Known-limitations #1 states ownership (2026-09-22) | 1af2cde |

## Coverage Summary

- Unit coverage: N/A (repo bar is `typecheck` + E2E `verify` + `verify-injection`)
- Evidence coverage: target 6/6 REQ-IDs with linked artifact
- Acceptance criteria covered: P0.1 → T-001; P0.2 → T-002; P0.3 → T-003;
  P0.4 → T-004; P0.5 → T-005; P0.6 → T-006

## Gate remediation evidence

- Evidence corrections from gate findings (2026-09-22): `70` → **73** assertions
  (QA-02/CE-02, `IMPLEMENTATION_PLAN.md` + `ROADMAP.md`); gitleaks count basis
  corrected to 25 scanned / 26 in history (QA-03); actionlint artifact attached
  (`evidence/actionlint.log`, QA-05); restart canary re-run with committed
  artifact (`evidence/p0-4-restart-canary.log`, QA-04).
- Full 9-reviewer record: `GATE_REPORT.md` (same directory) — status **CLOSED**
  pending COND-01 (push decision) + docs conditions + waivers `WAIVERS-P0.md`.
