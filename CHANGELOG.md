# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
