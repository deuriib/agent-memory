# Release Notes: v0.3.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the owning domain owner / operations function per ship-release role binding —
stated as the role assumption for this lane)
**Specs Included:** P0 — `ROADMAP.md` §2 "Publishable foundations"
(REQ-P0-1..6)
**Domains-Touched:** engineering, security, legal, automation/ops
**Ship Type:** deploy (no breaking changes → README/INSTALL/MIGRATION
templates cited, not required)

## Highlights

- **Publishable foundations** — Apache-2.0 `LICENSE` + matching `package.json`
  `"license"` field, plus a CI gate (typecheck + verify-injection + pinned
  gitleaks v8.30.1 secret scan) green on `main` across 5 runs
  (35781376642, 35781958949, 35784838135, 35786040704, 35787110447).
- **Durable persistence default** — `storage = "disk"` in `helix.toml`, so a
  plain `helix start dev` survives restarts; proven by the restart canary
  artifact (`docs/specs/50_archive/P0/evidence/p0-4-restart-canary.log`:
  BM25 hit on attempt 1 post-restart, `RESULT: PASS`).
- **Legacy env acceptance** — servers started under old `AGENTMEMORY_*` names
  keep working: name-only warning on server/MCP/bootstrap (never prints
  values), bearer guard armed, hooks stay silent.
- **Port ownership settled** — `EADDRINUSE` prints the reroute hint
  (`AGENT_MEMORY_PORT=3151`, never kill the upstream); README states
  definitively which port is ours.
- **Quality gate OPEN** — 9 dedicated reviewers; trail CLOSED → CONDITIONAL →
  OPEN with all 15 conditions closed and both ❌ verdicts cleared on scoped
  recheck; waivers W1..W6 recorded with owners, compensating controls, and
  expiries.

## Changes

### Features

- `LICENSE` (Apache-2.0) + `package.json` `"license": "Apache-2.0"` as the
  license of record (P0 / REQ-P0-1, legal)
- `.github/workflows/ci.yml` — typecheck + verify-injection + pinned gitleaks
  v8.30.1 secret scan on every push/PR (P0 / REQ-P0-2, automation/ops)
- `SECURITY.md` + `CONTRIBUTING.md` governance docs, linked from README
  alongside `CHANGELOG.md` (P0 / REQ-P0-3, security)
- Durable persistence default `storage = "disk"` in `helix.toml` + bootstrap
  advisory warning when the key is missing (P0 / REQ-P0-4, engineering)
- Legacy `AGENTMEMORY_*` acceptance: name-only warning + armed guard, with
  `scripts/verify-env.ts` as the proof harness (P0 / REQ-P0-5, engineering)

### Fixes

- `EADDRINUSE` dead end → actionable reroute hint (`AGENT_MEMORY_PORT=3151`,
  never-kill-upstream note) + README `## Known limitations` port-ownership
  statement (P0 / REQ-P0-6, engineering)

### Domain Ships

- **Legal:** `LICENSE` (Apache-2.0) shipped + 248-package manual license scan
  with zero copyleft hits — path: `docs/specs/50_archive/P0/legal-reviewer.md`
  (LGL-004; residual under waiver W1) (P0 / REQ-P0-1)
- **Automation/ops:** CI on `main` all green — runs 35781376642, 35781958949,
  35784838135, 35786040704, 35787110447 all `conclusion=success`
  (P0 / REQ-P0-2)
- **Security:** gitleaks pinned at v8.30.1 (sha256-verified, fingerprint-scoped
  `.gitleaksignore`) + governance docs `SECURITY.md` / `CONTRIBUTING.md` —
  path: `docs/specs/50_archive/P0/security-reviewer.md`
  (P0 / REQ-P0-2, REQ-P0-3)
- **Engineering:** gate record `docs/specs/50_archive/P0/GATE_REPORT.md`
  (**OPEN**), waivers `docs/specs/50_archive/P0/WAIVERS-P0.md` (W1..W6), and
  handoff `docs/specs/50_archive/P0/HANDOFF.md` (Status: complete) archived
  together with the nine reviewer artifacts (P0)

### Breaking Changes

- **None — no behavior removed or renamed.** Migration guide **N/A**:
  README/INSTALL/MIGRATION templates cited, not required (ship-type `deploy`
  without breaking changes). Undo path: rollback plan below.

## Known Issues

- **Waivers W1..W6 active** — W1: no license/CVE scan in CI; W2: `verify-env`
  not gated in CI/PR bar; W3: no backup/DR automation + advisory false
  negatives; W4: gitleaks same-origin checksum + tag-pinned actions; W5:
  precedence/backstop tests deferred; W6: empty-new-name divergence across
  surfaces. Expiry: **2026-12-21** or the named milestone (P1..P4), whichever
  first; re-review owners per waiver — full text:
  `docs/specs/50_archive/P0/WAIVERS-P0.md`. Compensating controls documented
  in README (durability & recovery, never-empty, split-brain guidance).
  Owner: domain owners + orchestrator.
- **~50 Low findings** → roadmap backlog — non-blocking per severity
  guardrail; owner: orchestrator (triage).

## Rollback / Undo

- **Code:** `git revert` of the P0 delivery + release merge range, or check
  out tag `v0.2.0` for a full code undo — no schema, index, or migration
  change; version markers return to 0.2.0.
- **Archive undo:** reverse `git mv` restoring `50_archive/P0/` to its
  pre-archive lane under `docs/specs/40_workspace/` — exact source paths
  recorded in `docs/specs/50_archive/P0/ARCHIVE-RECORD.md`.
- Owner: engineering owner + orchestrator. ETA: immediate.

---

# Release Notes: v0.2.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the engineering-specialist function, per `agents/orchestrator.md` +
`agents/vasquez.md` delegation — stated as the role assumption for this lane)
**Specs Included:** P3.1 — ROADMAP.md §P3 "MCP tool parity for the useful subset"
**Domains-Touched:** engineering, security, data lens
**Ship Type:** deploy (local library/server release; no external deployment target)

## Highlights

- **MCP/REST parity for the useful subset** — `recap`, `handoff`, `lesson`,
  and governance-style `delete` now exist on both surfaces over the same
  `MemoryStore`: 12 REST routes, 11 MCP tools, one contract.
- **Every feature round-trips** — `npm run verify` proves the full chain
  (lesson → search with `origin:"lesson"` → recap membership → handoff
  header/counts → governed delete with receipt → gone → second delete 404 →
  counts) at **102 passed, 0 failed → VERIFY PASS**.
- **Gate-hardened before ship** — 8 independent reviews + a 17-row C3
  interrogation produced real fixes: log-forgery sanitize, an upstream identity
  guard in `verify`, a shared digest module with a 20s fan-out budget, and a
  declared PII allowlist/masking rule for the governance log.

## Changes

### Features

- `POST /agentmemory/recap` — deterministic session/project digest, per-source
  `signals[]` degradation, never 500 (P3.1, engineering)
- `POST /agentmemory/handoff` — recap + `healthCounts` as next-agent context
  block (P3.1, engineering)
- `POST /agentmemory/lesson` — remember with server-forced
  `origin="lesson"`, strict body (extra `origin` → 400) (P3.1, engineering)
- `POST /agentmemory/delete` — governance delete: required single-line
  `reason` (1..1000), receipt `{memoryId, deletedAt}`, 404 `{error:"not_found"}` (P3.1, engineering)
- MCP tools `memory_recap`, `memory_handoff`, `memory_lesson`,
  `memory_delete` — same envelopes behind the unchanged
  `_meta.authorization` gate; surface 7 → 11 (P3.1, engineering)
- `src/digest.ts` — shared digest builder for both lanes with
  `DIGEST_BUDGET_MS = 20_000` + `digest: budget exceeded` signal (P3.1 gate
  COND-005, engineering)
- `CHANGELOG.md` — Keep-a-Changelog history created (ship-release step 3;
  resolves the changelog open item routed from verify-handoff)

### Fixes

- Governance log forgery via embedded newlines in `reason`/`memoryId` —
  normalized to one line before logging, both lanes (P3.1 gate COND-001,
  security; findings RK-P31-1 / CE-001 / SEC-001 / DAT-001)
- `npm run verify` no longer writes test rows into a foreign instance —
  read-only identity probe before the first write aborts with the
  `AGENT_MEMORY_URL` instruction (P3.1 gate COND-002, engineering; finding
  RK-P31-7, High)
- MCP delete input schemas advertise `minLength`/`maxLength` again
  (bounds on both sides of normalize) (P3.1 gate C3-R17, engineering)
- Recap asserts per-bullet session membership, not just an echoed id
  (P3.1 gate COND-004, engineering; finding CE-003)

### Domain Ships

- **Quality gate: OPEN** — 4 pass + 4 conditional-with-conditions-cleared,
  C3 17/17 PASS, waivers W1–W4 (three-block bar, expiring 2026-12-21).
  Record: commits `0fe0b97` (gate report, 8 reviews, C3) and `e9b0504`
  (handoff) — paths at those commits: the P31 quality-gate lane under
  `docs/specs/40_workspace/` (workspace purged at archive
  per ship-release hygiene; history is the record).
- **Security:** governance log declares purpose, store, retention/deletion,
  field allowlist + masking rule (P3.1 gate COND-003 + C3-R13,
  `f2a65d4` + `d7a7628`); zero secrets/content in logs verified by review.
- **Data:** contract §1/§2 and `db/queries.ts` byte-untouched — no new
  labels, edges, indexes, or migration (data review, PASS).

### Breaking Changes

- **None — additive.** Behavioral note: clients asserting *exactly 7* MCP
  tools now see 11; update count assertions (in-repo assertions already
  updated). Migration path: none required. Undo path: revert range below.

## Known Issues

- **MCP behavioral round-trip unasserted in E2E** (QA F-4, accepted with
  shared-digest mitigation) — workaround: handshake probe covers registration;
  recommend a stdio harness in P3.x — owner: engineering.
- **Upstream residue:** a pre-guard verify run wrote project
  `verify-18637b3b` into the user's upstream `agentmemory` (port 3111); the
  upstream instance is currently down. Purge when it's back: enumerate
  `GET /agentmemory/sessions?project=verify-18637b3b` → per-session
  memories → `POST /agentmemory/forget {memoryId}` each → health 0.
  Recurrence prevented by the identity guard — owner: user/deploying
  operator.
- **ESC/NUL advisory gap:** sanitize collapses whitespace but not
  `ESC`/`NUL` control chars in `reason` (no forgery primitive — no ANSI
  decoding in the log path) — owner: engineering, re-review with W1 expiry.
- **MCP lane strips unknown keys** instead of 400-rejecting (SDK-mediated;
  REST strict-rejects; `origin` server-forced both lanes) — accepted, waiver
  W1 — owner: security re-review 2026-12-21.

## Rollback / Undo

- **Code:** `git revert` of the release commit reverts docs/version; the
  feature range is `e9fd325..` (14 P3.1 commits) + release commit. Pure
  revert — no schema, index, or migration change; `origin:"lesson"` rows
  persist as inert data; version markers return to 0.1.0. Owner:
  engineering owner. ETA: ≤15 min (risk review, RK rollback analysis).
- **Data undo:** none needed — no backfill; delete receipts are audit-only.
- **Non-code undo:** restore prior README/CONTRACT wording via the same
  revert; no comms/filings/launches exist for this ship.

## Documentation audit (ship-release step 4)

- `README.md` — version badge v0.2.0, CHANGELOG/release-notes links,
  P3.1 route/tool tables + examples already synced (verified this release).
- `CHANGELOG.md` — created; `[v0.2.0] — 2026-09-22` entry.
- `INSTALL.md` — **N/A-justified:** README Quick start is the install guide;
  every command in it (helix/bootstrap/dev/verify) executed successfully this
  session. Owner: engineering.
- `MIGRATION.md` — **N/A-justified:** no breaking changes (additive release).
- Version lockstep — manual 3-marker sync (this repo has no
  `scripts/bump-version.mjs`; N/A script): `package.json`,
  `.opencode/plugins/agent-memory.ts` `VERSION`, `src/mcp.ts` `McpServer`
  version → all `0.2.0`. Zero remaining `0.1.0` markers (grep-verified).
- `docs/specs/` lifecycle — **no backlog spec to archive (N/A-justified):**
  P3.1 originated in ROADMAP.md, not a `20_backlog/SPEC-*.md`; the lane
  record is ROADMAP (marked done) + history (`33849ee..e9b0504`).
  `40_workspace/` purged at release per ship-release hygiene.

## Verification (pre-ship, this release)

- `npm run typecheck` → clean (no `any`, no `@ts-ignore`, no TODO/FIXME).
- `npm run verify` (target: our server, `AGENT_MEMORY_URL=…:3151`) →
  **102 passed, 0 failed → VERIFY PASS**.
- MCP handshake → exactly 11 tools, delete schemas advertise bounds.
- Plain `npm run verify` (no `AGENT_MEMORY_URL`) → identity-guard abort,
  exit 1, zero writes.
