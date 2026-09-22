# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [v0.3.0] — 2026-09-22

### Added

- `LICENSE` (Apache-2.0) + `package.json` `"license": "Apache-2.0"` as the
  license of record (legal, P0 / REQ-P0-1)
- `.github/workflows/ci.yml`: typecheck + verify-injection + pinned gitleaks
  v8.30.1 secret scan on every push/PR (automation/ops, P0 / REQ-P0-2)
- `SECURITY.md` and `CONTRIBUTING.md`, linked from README alongside
  `CHANGELOG.md` (security, P0 / REQ-P0-3)
- Legacy `AGENTMEMORY_*` env acceptance: name-only warning + armed bearer
  guard on server/MCP/bootstrap, silent hooks, `scripts/verify-env.ts` proof
  harness (engineering, P0 / REQ-P0-5)
- `EADDRINUSE` reroute hint (`AGENT_MEMORY_PORT=3151`, never kill the
  upstream) + README port-ownership statement (engineering, P0 / REQ-P0-6)
- Quality-gate record `docs/specs/50_archive/P0/GATE_REPORT.md` — 9
  reviewers, verdict **OPEN** (CLOSED → CONDITIONAL → OPEN) — plus waivers
  `docs/specs/50_archive/P0/WAIVERS-P0.md` W1..W6 with owners/expiries
  (engineering, security, legal, automation/ops, P0)

### Changed

- Persistence default: `storage = "disk"` in `helix.toml` so
  `helix start dev` survives restarts + bootstrap advisory warning when the
  key is missing (engineering, P0 / REQ-P0-4)
- Version 0.2.0 → 0.3.0 across `package.json`, lockfile, plugin `VERSION`,
  MCP server identifier, and README badge (engineering, P0)

## [v0.2.0] — 2026-09-22

### Added

- REST routes `/agentmemory/recap`, `/agentmemory/handoff`,
  `/agentmemory/lesson`, `/agentmemory/delete` (engineering, P3.1)
- MCP tools `memory_recap`, `memory_handoff`, `memory_lesson`,
  `memory_delete` — tool surface 7 → 11 (engineering, P3.1)
- Shared digest module `src/digest.ts` with 20s fan-out budget and
  `digest: budget exceeded` signal (engineering, P3.1 gate COND-005)
- Upstream identity guard in `scripts/verify.ts` — read-only probe aborts
  before any write against a non-agent-memory target (engineering, P3.1
  gate COND-002)
- `CHANGELOG.md` (ship-release step 3)

### Changed

- `docs/CONTRACT.md` §3 amended (+4 routes, +4 tools), §4 out-of-scope list
  trimmed, §5 verification bar extended (engineering, P3.1)
- Governance log line declares purpose, retention/deletion, field allowlist,
  and masking/no-PII rule (data/security, P3.1 gates COND-003 + C3-R13)
- Version 0.1.0 → 0.2.0 across `package.json`, plugin `VERSION`, and the
  MCP server identifier

### Fixed

- Governance log forgery via embedded newlines in `reason`/`memoryId` —
  normalized to a single line before logging, both lanes (security, P3.1
  gate COND-001)
- MCP delete input schemas advertise `minLength`/`maxLength` again — bounds
  applied on both sides of normalize (engineering, P3.1 gate C3-R17)

## [v0.1.0] — pre-changelog (commit `44914e0`)

### Added

- Initial public release: 8 REST routes, 7 MCP tools, zero-dependency
  capture hook, HelixDB store (graph + vector + BM25), contract
  `docs/CONTRACT.md`, end-to-end `scripts/verify.ts`.
