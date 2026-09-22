# Test / Evidence Matrix: P0

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Domains-Touched:** engineering, security, ops (persistence), docs

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P0-1 | T-001 | `LICENSE` present (Apache-2.0), `package.json` `license` field matches | Review | pass | 44914e0 (pre-existing) |
| REQ-P0-2 | T-002 | CI workflow runs `typecheck` + `verify-injection` + pinned gitleaks v8.30.1 secret scan on every push/PR — actionlint 0 errors, local equivalents green, gitleaks `no leaks found` | Review + local equivalent | pass (2026-09-22) | 4cf0f6a |
| REQ-P0-3 | T-003 | `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` present and linked from README (README `## Contributing & security` + Specification link) | Review | pass (2026-09-22) | 7caa14d |
| REQ-P0-4 | T-004 | Persistence: `--disk --persist` default dev path; bootstrap warns when `helix.toml` lacks `storage = "disk"`; **save → `helix restart dev` → still searchable** (canary `228cdf69`, BM25 hit score 0.863 post-restart) | E2E | pass (2026-09-22) | c551774 |
| REQ-P0-5 | T-005 | Legacy `AGENTMEMORY_*` fallback: server started with only legacy names arms the guard (health 401 without / 200 with bearer), warns name-only; hooks stay silent | E2E (`scripts/verify-env.ts`) | pass — VERIFY PASS 21/21 (2026-09-22) | bb335e2 |
| REQ-P0-6 | T-006 | `EADDRINUSE` prints `AGENT_MEMORY_PORT=3151` reroute + never-kill-upstream note; README states port ownership definitively | E2E + Review | pass — verify-env sections A/C green; README Known-limitations #1 states ownership (2026-09-22) | 1af2cde |

## Coverage Summary

- Unit coverage: N/A (repo bar is `typecheck` + E2E `verify` + `verify-injection`)
- Evidence coverage: target 6/6 REQ-IDs with linked artifact
- Acceptance criteria covered: P0.1 → T-001; P0.2 → T-002; P0.3 → T-003;
  P0.4 → T-004; P0.5 → T-005; P0.6 → T-006

## Gate remediation evidence

(filled by quality-gate when it runs)
