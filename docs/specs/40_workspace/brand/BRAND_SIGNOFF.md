# Brand Sign-off Matrix — SPEC-002-brainy-brand (R5)

**Owner:** general(vera) — Marketing/Brand Owner (R5)
**Date:** 2026-09-25
**Packet:** `SPEC:docs/specs/20_backlog/SPEC-002-brainy-brand.md#REQ-BRAINY-MKT-01..07 / HARD:subagents+max2lanes+no-secrets+alias1version / GATE:none-yet (this lane produces the R5 gate evidence) / DOMAINS:R5,R1,R8,R2,R4`
**Scope note:** The brand rewrite (README/CHANGELOG/CONTRACT/skills/policies/campaigns) shipped in commit `c02a0e0`. This lane covers the residual purge verification (REQ-BRAINY-MKT-02) plus the AC-01..AC-07 evidence matrix and the REQ-BRAINY-MKT-07 sign-off checklist. No requirement/history text was rewritten to satisfy a grep; literal-`0` variances are documented with rationale below.

## Task 1 — Residual purge result: verify-only, zero edits

Authorized scope per `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md` row "docs/ & skills/ Brand Debt Cleanup": `ARCHITECTURE.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `skills/**/SKILL.md` (+ shipped README/CHANGELOG/CONTRACT/manifests). Verified 2026-09-25:

| Target | `agentmemory`/`iii-engine` hits | Verdict |
|--------|-------------------------------|---------|
| `skills/**` | 0 | clean (swept in `c02a0e0`) |
| `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md` | 0 | clean (swept in `c02a0e0`) |
| `README.md` | 0 (`grep -c -i brainy` = 69) | clean |
| `docs/specs/10_design/ARCHITECTURE.md` | 6 (`agentmemory`, all `brainy.compat.agentmemory` / `/agentmemory/todos*` alias / `migrateAgentMemoryRow` / grep-0 requirement text) | allowed set only — no edit |
| `db/queries.ts` | 2 (`migrateAgentMemoryRowParams`, `migrateAgentMemoryRow`) | compat layer — R1 owned, must stay |
| `src/**` | 12 (`src/compat/agentmemory.ts`, `/agentmemory/` route alias, `createAgentMemoryServer` alias export, `[agentmemory]` log prefixes, never-kill comment) | compat/alias — must stay per HARD alias1version; `src/server.ts` etc. explicitly untouched without proposal row |
| `scripts/*.ts` (excl. `verify-ops.ts`) | 23 (`upstream agentmemory` never-kill comments, `AGENTMEMORY_*` ignore-lists in verify harnesses, `[agentmemory-compaction-reminder]` fixture tag) | R8 safety invariant / test fixtures — not authorized, must stay |

Nothing in the authorized set required a purge edit. All remaining occurrences fall in the allowed set: 1-version compat layer (`brainy.compat.agentmemory`, `bin/agent-memory.mjs` shim, `AGENT_MEMORY_*` fallbacks with single `WARN deprecated`), never-kill upstream references owned by R8, historical anchors (`docs/briefs/**`, `docs/adr/**`, `50_archive/**`, CHANGELOG BREAKING entries), and frozen requirement context in `docs/specs/20_backlog/*.md` (off-limits — never edited).

## Task 2 — AC-01..AC-07 verification matrix (all commands run 2026-09-25)

### AC-01 (REQ-01, REQ-02 — rename + purge grep) → VARIANCE (accepted, documented)

- `grep -rni "agentmemory" --exclude-dir=.helix --exclude-dir=node_modules --exclude-dir=.git . | wc -l` → **191** total; excluding `compat` + `CHANGELOG` → **134**, all in the allowed set above (briefs anchors, ADR history, SPEC context, RELEASE_NOTES history, never-kill comments, alias shims). Literal `0` would require falsifying history — not done.
- `grep -rni "iii-engine" --exclude-dir=.helix --exclude-dir=node_modules --exclude-dir=.git . | wc -l` → **23**, all in briefs/ADRs/SPEC context/proposal text (historical problem statements) — same variance rationale.
- Manifests: `package.json:2` `name: "brainy"`, `bin: { brainy, agent-memory }` dual entry; `helix.toml` `name = "brainy"`; `mcp_config.json` primary key `"brainy"` + documented `"agent-memory"` alias (dual-key = intentional 1-version compat); `plugin.json` `name: "brainy"`.
- `grep -rn "AGENT_MEMORY_" --exclude-dir=.helix --exclude-dir=node_modules --exclude-dir=.git . | wc -l` → **655 across 106 files**; outside alias shims/deprecation docs/migration tables, hits are requirement/history text in frozen SPECs and briefs (off-limits). Compat reads all emit the single `WARN deprecated` (verified in `bin/brainy.mjs:424`, `src/server.ts:975-976`).

### AC-02 (REQ-01 — alias 1 versión) → PASS

- `node bin/agent-memory.mjs --help` → **exit 0**; stderr: `WARN deprecated use brainy — agent-memory alias will be removed in next major` (contains `deprecat` ×1, `brainy` ×1); delegates correctly.
- `node bin/brainy.mjs --help` → **exit 0**; stderr **0 bytes**, no warning.
- `npm run typecheck` → **exit 0, 0 errors** (`tsc --noEmit`, package `brainy@1.0.0`).

### AC-03 (REQ-03 — posicionamiento) → PASS

- `README.md:8` hero contains `segundo cerebro` (×1) + `CODE` (×17) + `PARA` (×13) + `HelixDB` (×10) + `Tiago Forte` (×2) — each ≥1 case-insensitive.
- `package.json` + `plugin.json` descriptions contain `Brainy` + `HelixDB` (both: `Brainy — Segundo cerebro aumentado con agentes sobre HelixDB (CODE/PARA, hybrid retrieval)`).
- `docs/CONTRACT.md:1` header: `# Brainy — v1 Frozen Contract`.
- README: 0 `iii-engine`, 0 `Qdrant`/`Neo4j` as active engines.

### AC-04 (REQ-04 — README reescrito) → PASS

- Quickstart (`README.md:110-155`) with `brainy add` / `brainy search` / `brainy context --project` (+ `helix start dev`, `npm install`, `npm run bootstrap`).
- `## Migration from \`agent-memory\`` (`README.md:285`) with `AGENT_MEMORY_* → BRAINY_*` table (`README.md:312-320`) + never-kill `3111/3112/3113` note.
- 3 copyable examples: CLI `brainy add` + `POST /v1/notes` curl (`README.md:176`), `brainy_search` hybrid RRF (`README.md:205-211`), `brainy export --format markdown` Obsidian vault (`README.md:241-247`).
- MCP snippet with `brainy_search`/`brainy_capture` + `memory_*` alias mention (`README.md:293`).
- `BRAINY_*` env table with deprecated fallbacks (`README.md:312-320`).
- `grep -c "brainy" README.md` → **33** (case-sensitive; 69 case-insensitive) ≥ 20.
- Zero pricing/UI/multi-device claims (grep for pricing/price/USD/multi-device/sync/GUI → 0 hits).

### AC-05 (REQ-05 — CHANGELOG breaking change) → PASS

- `CHANGELOG.md:6` `## [v1.0.0] — 2026-09-25 / [brainy v1]` with `### Changed / BREAKING CHANGE` (`CHANGELOG.md:8`) enumerating package/helix.toml/bin/env/MCP/plugin renames; alias 1 versión + deprecation warning + sunset **v2.0.0**; `brainy.compat.agentmemory` SQLite→HelixDB mapping; `BRAINY_SECRET` vault/env-only (`CHANGELOG.md:38-42`).
- README Migration ↔ CHANGELOG parity: env names (`BRAINY_*`/`AGENT_MEMORY_*`) and bin names (`brainy`/`agent-memory.mjs`) match.

### AC-06 (REQ-06 — contract/docs + no overpromising) → VARIANCE (accepted, documented)

- `grep -r "agent-memory" docs/specs --exclude-dir=50_archive | wc -l` → **119** across 13 files (ARCHITECTURE compat/alias docs, REQ-P4-OPS, frozen `20_backlog` SPEC context, RELEASE_NOTES history, workspace proposals, engineering review artifacts). Literal `0` would require rewriting frozen requirements and history — explicitly forbidden (SPECs frozen, briefs/ADRs historical anchors). `docs/CONTRACT.md` has 2 `agent-memory` hits, both `agent-memory-eval` benchmark fixture project names (`CONTRACT.md:698,703`) referencing `scripts/eval.ts` seed namespace — renaming the fixture is R1/R8 scope, recorded as cross-domain request, not a freelance fix.
- No new doc promises UI/pricing/realtime-sync/images/audio outside `BRIEF-brainy.md` Out of Scope; no roadmap claim requiring `Approved-by: general(vasquez)` was introduced by this lane.

### AC-07 (REQ-07 — hygiene + sign-off) → PASS (grep fallback; gitleaks not-installed)

- `grep -rn "BRAINY_SECRET" README.md docs/ | wc -l` → **109**; all non-placeholder hits are variable *names* in prose/tables (`vault/env only` posture), never values. Placeholders `***` / `$BRAINY_SECRET` in all executable examples.
- Literal-secret pattern grep (`sk-…`, `ghp_…`, `AKIA…`, `PRIVATE KEY`) over `README.md docs/ CHANGELOG.md` → 0 real keys (only `50_archive` PII-store declarations, historical).
- `gitleaks`: **not-installed** (`which gitleaks` → empty). No scan claimed; grep fallback used instead. Recommend pinning `gitleaks` in CI (R8).
- `npm test` → **80 pass, 0 fail**; `npm run typecheck` → **0 errors**.

## Marketing sign-off checklist (REQ-BRAINY-MKT-07)

| Item | Status | Owner |
|------|--------|-------|
| Rename + purge evidence (AC-01) | variance (allowed set documented; manifests verified) | general(vera) |
| Alias 1 versión (AC-02) | verified (exit 0 both bins; typecheck 0) | general(vera) |
| Positioning hero + descriptions + CONTRACT header (AC-03) | verified | general(vera) |
| README quickstart + 3 examples + migration + env table, no overpromising (AC-04) | verified | general(vera) |
| CHANGELOG BREAKING + README parity (AC-05) | verified | general(vera) |
| Docs sweep + no-overpromising (AC-06) | variance (frozen SPECs/history untouched by rule) | general(vera) |
| No-secrets hygiene (AC-07) | verified via grep fallback (`gitleaks` not-installed) | general(vera) |

**Pending: quality-gate** (R5 gate evidence delivered; cross-domain reviews R1/R8/R2/R4 per proposal approval list).
