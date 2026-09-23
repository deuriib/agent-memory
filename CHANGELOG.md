# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [v0.4.0] — 2026-09-23

### Added

- **Auto concept extraction** (P1.3 / REQ-P1-3): `remember` without an
  explicit `concepts[]` derives up to 8 deterministic concepts (shared
  tokenizer → stopwords → tf DESC → lex ASC); caller-supplied concepts win
  verbatim, so the §3 echo contract is preserved; derived concepts power the
  graph branch on plain saves (fused score == 3/61 proof) —
  `src/concepts.ts` (engineering, P1)
- **Dedup on write** (P1.6 / REQ-P1-6): `dedupKey =
  sha256(project + "\n" + normalize(content))` property + index #8 +
  `findMemoryByDedupKey` pre-check under a per-key FIFO lock; duplicate saves
  return the existing id with additive `deduped: true` and create no second
  row; uniqueness is application-side (probe3: the server does not enforce
  the unique index) (engineering, P1)
- **Memory lifecycle — corte A** (P1.1 / REQ-P1-1): read-time decay
  `importance · e^(−λ·ageDays)` on the fused tie-break
  (`AGENT_MEMORY_DECAY_LAMBDA`, default OFF) + TTL hiding of expired rows with
  an explicit `ttl: hidden N expired rows` signal
  (`AGENT_MEMORY_TTL_DAYS`, default OFF) + fail-closed `scripts/purge.ts`
  (`--days N --project P|all [--dry-run]`, project-scoped `listExpired` +
  per-id `forgetMemory`, allowlisted governance line) (engineering/ops, P1)
- **Hook coverage** (P2.1 / REQ-P2-1): `capture.mjs` 3 → 7 events
  (`PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`) with
  a per-event content allowlist — `UserPromptSubmit` never reads prompt text
  (Ley 172-13) — plus the OpenCode plugin's 5th hook
  `tool.execute.before` (fire-and-forget `tool started: <name>`, own
  `memory*` skipped) (engineering/security, P2)
- Local suites `scripts/verify-lifecycle.ts` (39 passed) and
  `scripts/verify-capture.ts` (115 checks), both Helix-free and wired into CI
  (engineering, P0/P1/P2 gate)

### Changed

- `docs/CONTRACT.md` **v1 → v1.1**: §0 probe3 facts (unique index not
  enforced, `ltParam` on `dateTime`, missing-property writes), §1
  `dedupKey` property, §2 +3 exports + index #8 + `saveMemory` param, §3
  remember/dedup/decay/TTL/purge/7-event hooks/plugin `execute.before`
  semantics, §4 drops "Decay" from do-not-build, §5 verification bar
  (engineering, P1+P2.1)
- `scripts/verify.ts` bar grows 102 → 131 → **152 passed** across lane +
  gate remediation (derived-concepts, graph-branch, dedup/race, dedup×hook
  (F4) sections); README route prefix corrected to
  `/memory`, hooks/config/verification docs refreshed (engineering, P1+P2.1)
- Version 0.3.0 → 0.4.0 across `package.json`, lockfile, plugin `VERSION`,
  MCP server identifier, and README badge (engineering, P1+P2.1)

### Fixed

- Purge governance/audit lines: CWE-117 newline forgery — print-side
  `oneLine()` normalizer extracted to `src/logline.ts` + 5 CI assertions in
  `verify-lifecycle` section E (security, P1+P2.1 gate COND-004 / COND-007)
- Dedup store pre-check fails closed on shape drift — transport error or a
  response missing the frozen `memory` return throws instead of reading as a
  miss (engineering, P1+P2.1 gate resilience F1)
- Purge failure paths write an allowlisted single-line `status=partial` audit
  record before exit 1 when deletions happened, plus per-batch
  `purge-progress` (automation/ops, P1+P2.1 gate COND-006)
- Doc-truth corrections: falsified `contentHash` docstring, nonexistent-test
  citations, plan/README false-pointer cells, `dedayImportance` →
  `decayedImportance` typo — swept to 0 instances across all six docs
  (engineering, P1+P2.1 gate COND-005 / COND-008 / COND-010)

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
