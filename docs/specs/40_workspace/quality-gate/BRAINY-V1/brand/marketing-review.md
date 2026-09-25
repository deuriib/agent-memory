# Marketing Review: SPEC-002-brainy-brand (Brainy v1)

**Reviewer:** brand-reviewer (marketing/brand domain gate, independent — did not author R5 lane)
**Date:** 2026-09-25
**Verdict:** conditional
**SPEC:** `docs/specs/20_backlog/SPEC-002-brainy-brand.md#REQ-BRAINY-MKT-01..07` (read only)
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD`; R5 sign-off `docs/specs/40_workspace/brand/BRAND_SIGNOFF.md` (commit `d41ded1`)

## Checklist

- [x] Brand alignment verified
- [x] Messaging consistent with positioning
- [x] GTM impact assessed (1-version compat + sunset v2.0.0 communicated)
- [x] Customer-facing copy reviewed (README, CONTRACT, CHANGELOG, skills, manifests)
- [x] Competitive implications considered (no external benchmark claims as ours)
- [x] Launch readiness (conditional — see COND-BRAND-01)

## AC-01..07 reproduce table

Commands re-run 2026-09-25 by this reviewer (counts drift vs sign-off because 8 gate-review files landed after `d41ded1`; delta classified below).

| AC | My command | Sign-off claimed | My result | Reproduce? | Variance ruling |
|----|-----------|-----------------|-----------|------------|-----------------|
| AC-01a | `grep -rni "agentmemory" --exclude-dir=.helix --exclude-dir=node_modules --exclude-dir=.git . \| wc -l` | 191 | **203** | Yes (direction: +12 = new gate artifacts) | ACCEPTABLE — see file classification below |
| AC-01b | same pipeline `\| grep -v -i "compat" \| grep -v "CHANGELOG" \| wc -l` | 134 | **137** | Yes | ACCEPTABLE — all in allowed set |
| AC-01c | `grep -rni "iii-engine" ... \| wc -l` | 23 | **29** | Yes (+6 = gate artifacts quoting SPEC context) | ACCEPTABLE — all historical/frozen |
| AC-01d | `grep -rn "AGENT_MEMORY_" ... \| wc -l` | 655/106 files | **671** | Yes (+16 = gate artifacts) | ACCEPTABLE — compat + frozen text only |
| AC-01e | manifests | `brainy` + dual bin | `package.json:2 name brainy`, `helix.toml:2 name brainy`, `mcp_config.json` keys `brainy`+`agent-memory`, `plugin.json name brainy` | Yes | PASS, no variance |
| AC-02 | `node bin/agent-memory.mjs --help` / `node bin/brainy.mjs --help` / `npm run typecheck` | exit 0 both, deprecation on alias only | alias exit 0 + `WARN deprecated use brainy — agent-memory alias will be removed in next major` on stderr; `brainy` stderr 0 bytes; `typecheck` exit 0, 0 errors | Yes | PASS |
| AC-03 | hero + descriptions + CONTRACT header | hero ×1/×17/×13/×10/×2 | `segundo cerebro` ×1, `CODE` ×4 (case-sens; ≥1), `PARA` ×12, `HelixDB` ×10, `tiago forte` ×2 (ci); `package.json`+`plugin.json` descriptions `Brainy…HelixDB`; `docs/CONTRACT.md:1` `# Brainy — v1 Frozen Contract`; README 0 `iii-engine`, 0 active `Qdrant`/`Neo4j` | Yes | PASS |
| AC-04 | README structure | quickstart + migration + 3 examples + MCP + env | `## Migration from agent-memory` `README.md:285`; env table `README.md:312-320`; MCP `brainy_search`/`brainy_capture` + `memory_*` alias `README.md:293`; examples CLI/`POST /v1/notes`/`brainy export` present; `grep -c brainy` 33 (69 ci) ≥ 20; ports 3111 preserved | Yes | PASS |
| AC-05 | CHANGELOG | `## [v1.0.0]/[brainy v1]` + BREAKING + sunset v2.0.0 + parity | `CHANGELOG.md:6` header confirmed; `### Changed / BREAKING CHANGE` enumerates package/helix/bin/env/MCP/plugin renames; sunset **v2.0.0**; `brainy.compat.agentmemory` mapping; `BRAINY_SECRET` vault/env-only; env/bin names match README Migration | Yes | PASS |
| AC-06 | `grep -r "agent-memory" docs/specs --exclude-dir=50_archive \| wc -l` | 119/13 files | **135** (+16 = new `40_workspace/quality-gate` reviews quoting compat names) | Yes | ACCEPTABLE — see ruling |
| AC-07 | secrets hygiene | 109 hits, placeholders only; gitleaks missing | 116 hits; executable examples use `$BRAINY_SECRET` (`README.md:178`) and `"BRAINY_SECRET": "***"` (`README.md:385,401`); no literal `sk-/ghp_/AKIA/PRIVATE KEY` in README/docs/CHANGELOG (only pattern-name mentions in `50_archive` PII-store declarations, historical); `gitleaks` still not installed | Yes | PASS with condition (COND-BRAND-01) |

### Variance file classification (the challenge: is anything user-facing leaking?)

`agentmemory` per-file top holders (my run): `RELEASE_NOTES.md` 11 (history), `src/server.ts` 10 (route alias `/agentmemory/*` + `createAgentMemoryServer` export + `[agentmemory]` log prefixes + never-kill comment — compat/safety, must stay), `IMPLEMENTATION_PLAN.md` 10 (frozen plan text), `scripts/verify-env.ts` 9 (never-kill + `AGENTMEMORY_*` ignore-list — R8 safety invariant), `BRAND_SIGNOFF.md` 8 + `PROPOSED_CHANGES.md` 8 (the variance record itself), `SPEC-001` 8 / `SPEC-002` 6 (frozen requirement context, off-limits), `50_archive` HANDOFF/SPEC 13 (frozen history), `ARCHITECTURE.md` 7 (`brainy.compat.agentmemory` + alias docs), `scripts/eval.ts` 5 (never-kill port comments).

`iii-engine` holders: `PROPOSED_CHANGES.md` 5, `SPEC-002` 5, `IMPLEMENTATION_PLAN.md` 4, `BRAND_SIGNOFF.md` 3, `SPEC-001` 3, briefs/ADRs 6, `refuter-review.md` 2 (quoting SPEC), `OKR-brainy.md` 2, `TEST_MATRIX.md` 1 — 100% problem-statement/history text in frozen or review-quoting files.

`docs/specs` `agent-memory` 135 holders: `SPEC-003` 21, `PROPOSED_CHANGES` (brand) 19, `SPEC-002` 18, `ARCHITECTURE_REVIEW` 11, automation proposal 11, `RELEASE_NOTES` 9, `ARCHITECTURE.md` 8, engineering proposal 7, `SECURITY_REVIEW` 6, `BRAND_SIGNOFF` 6, `SPEC-001` 5, quality-gate reviews ~8 (new since sign-off), `REQ-P4-OPS.md` 2, `SPEC-005` 1. No file outside the allowed set (compat docs / frozen SPECs / history / workspace proposals / gate artifacts quoting compat names).

User-facing surfaces: `README.md` 0 `agentmemory`/`iii-engine`; `skills/**` 0 `agentmemory`/`iii-engine`. `AGENT_MEMORY_*` in README/skills/CONTRACT appears only in deprecation/migration tables and port-coexistence fallback docs (`README.md:293,310-320`, `skills/*/SKILL.md` fallback lines) — intentional 1-version compat communication, not a leak.

**Ruling: AC-01/AC-06 variances are ACCEPTABLE for release.** Literal grep-0 is unachievable without falsifying frozen history (`docs/briefs/**`, `docs/adr/**`, `50_archive/**`, `20_backlog` SPEC context), breaking the 1-version compat contract (`src/compat/agentmemory.ts`, `bin/agent-memory.mjs` shim, `AGENT_MEMORY_*` fallbacks with single `WARN deprecated`), or deleting R8 safety invariants (never-kill `3111/3112/3113` comments, verify-harness ignore-lists). Every remaining hit classifies as compat/safety/history. Zero user-facing brand leak found.

## Overpromising findings

Sweep: `README.md`, `docs/CONTRACT.md`, `CHANGELOG.md`, `ROADMAP.md`, `skills/**` for GUI / multi-device sync / audio-images / pricing / realtime-sync claims.

- `docs/CONTRACT.md:610`: `merge — tiers 2–4 of upstream's consolidation, LLM auto-compress, viewer UI,` — context (`CONTRACT.md:606-613`, `## 4. Out of scope for v1 (do not build)`): explicitly lists viewer UI / Replay / 20 agent adapters / 54-tool surface as **remaining out**. Correct scoping, not a promise. No finding.
- `README.md:147,152`: `GUI` substring hits are `Guidelines` (TypeScript & Tooling Guidelines example), not a graphical-interface claim. No finding.
- `docs/CONTRACT.md:21`: `no images/audio, BRIEF Out-of-Scope` — correct exclusion statement. No finding.
- `docs/CONTRACT.md:111,597`: `async`/`sync throw` — code-semantics words, not device-sync claims. No finding.
- Pricing/fechas/UI/multi-device realtime: 0 hits outside out-of-scope declarations.

**Overpromising findings: 0.** No quotes required (no violations).

## README / CHANGELOG / Contract checks

- README quality bar: quickstart (`README.md:110-155`, `brainy add/search/context` + `helix start dev`/`npm install`/`npm run bootstrap`) ✓; ≥3 copyable verified examples (CLI `brainy add`, `POST /v1/notes` curl `README.md:176`, `brainy_search` hybrid `README.md:205-211`, `brainy export --format markdown` `README.md:241-247` — 4 present) ✓; `## Migration from agent-memory` + env table ✓; MCP snippet with alias mention ✓; `Brainy…HelixDB` descriptions in `package.json`/`plugin.json`, `helix.toml` `brainy`, `mcp_config.json` dual keys (intentional 1-version compat) ✓; never-kill `3111/3112/3113` note preserved ✓.
- CHANGELOG breaking entry `CHANGELOG.md:6` `## [v1.0.0] — 2026-09-25 / [brainy v1]` + `### Changed / BREAKING CHANGE`: renames, alias + sunset **v2.0.0**, migration mapping, `BRAINY_SECRET` posture ✓; parity with README Migration on env/bin names ✓.
- Contract/claims: `docs/CONTRACT.md:1` header `Brainy — v1 Frozen Contract` ✓; 2 `agent-memory` hits at `CONTRACT.md:698,703` are `agent-memory-eval` benchmark fixture project names referencing `scripts/eval.ts` seed namespace — **cross-domain request to R1/R8 confirmed to exist** (recorded in sign-off; renaming the fixture is R1/R8 scope, not a freelance fix; not a brand leak — fixture namespace, not user-facing copy).

## Findings

| ID | Severity | Location + evidence | Owner |
|----|----------|--------------------|-------|
| COND-BRAND-01 | Medium | `gitleaks` not installed — AC-07 hygiene rests on grep fallback (literal-secret patterns 0 hits in shippable surfaces; `BRAINY_SECRET=s3cr3t` test value lives only in frozen `SPEC-004` acceptance text, not executable docs). Pin `gitleaks` (or equivalent secret scan) in CI so the breaking-release gate does not ship on grep alone. Evidence: `which gitleaks` → empty (this run + sign-off run agree). | R8 `general(espinoza)` (CI), co-sign R2 |

No other findings. Finding without proof = REFUTED — all rows above carry commands + file:line evidence.

## Verdict Rationale

Brand rename is complete on every user-facing surface (README 0, skills 0, manifests + CONTRACT header + CHANGELOG + positioning all Brainy). Overpromising sweep is clean — the only roadmap-adjacent mentions are explicit out-of-scope declarations. AC-01/AC-06 variances are genuine compat/safety/history with zero user-facing leak, therefore ACCEPTABLE. The single condition is process hygiene (secret-scan tooling in CI), not a brand defect — it does not block the brand verdict but must be recorded and owned.

**Verdict: conditional** (1 Medium condition, owned, non-blocking for brand substance).

## Residual risk + owner

- Residual: secret-scan gap until `gitleaks` pinned in CI — a hardcoded test credential merged between grep audits would not be caught automatically. Owner: R8 `general(espinoza)`, expiry next release or 90 days.
- Residual: `agent-memory-eval` fixture name (`docs/CONTRACT.md:698,703`) survives as R1/R8-owned cross-domain request — no user impact (benchmark namespace, documented). Owner: R1 `general(vasquez)` + R8.
- No PII/secrets in this artifact. Allowlisted evidence only (diffs, greps, exit codes).
