# Proposed Changes: general(vera) — Marketing/Brand Owner

**Spec Reference:** SPEC-002-brainy-brand — `docs/specs/20_backlog/SPEC-002-brainy-brand.md#REQ-BRAINY-MKT-01..07`
**Brief Reference:** `docs/briefs/BRIEF-brainy.md` (approved 2026-09-25) + `docs/briefs/OKR-brainy.md` (KR-1.1, KR-1.2)
**Agent:** general(vera) — Marketing/Brand Owner (R5)
**Date:** 2026-09-25
**Execution_Mode:** subagents (inherited from BRIEF-brainy, frozen at frame-intent; max 2 parallel lanes INV-006)
**Domains-Touched:** [marketing/brand (R5, owner), engineering (R1), automation/ops (R8), security (R2), legal/privacy (R4)]
**Packet:** `SPEC:docs/specs/20_backlog/SPEC-002-brainy-brand.md#REQ-BRAINY-MKT-01..07 / HARD:subagents+max2lanes+no-secrets+alias1version+zero-impl-edits / GATE:none-yet / DOMAINS:R5,R1,R8,R2,R4`

> Proposal lane: design-before-code. This proposal specifies the brand transformation, external positioning, documentation rewrite, deprecation communications, and metadata alignment for the atomic transition from `agent-memory` to **Brainy**. In accordance with the `propose-changes` lane contract, zero implementation or production files are modified during this proposal phase.

## Summary

Proposes the atomic brand repositioning and metadata alignment from `agent-memory` to **Brainy** ("segundo cerebro aumentado con agentes", CODE/PARA sobre HelixDB unificado), establishing brand dignity and eliminating historical naming debt (`agentmemory`, `iii-engine`). Governs the complete rewrite of `README.md` (new hero, CLI quickstart, 3 verified developer examples, migration guide, and `BRAINY_*` environment table), a breaking change entry in `CHANGELOG.md` for `[v1.0.0] / [brainy v1]`, alignment of frozen contract `docs/CONTRACT.md`, manifest updates (`package.json`, `plugin.json`, `mcp_config.json`, `helix.toml`), and a comprehensive brand debt cleanup across the documentation tree with a strict 1-version deprecation alias.

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `README.md` | `file-modify` | Complete rewrite under brand Brainy: Hero positioning "segundo cerebro aumentado con agentes" (CODE/PARA de Tiago Forte sobre HelixDB unificado grafo+vector+BM25); Quickstart with `brainy` CLI (`helix start dev`, `npm install`, `npm run bootstrap`, `brainy add "texto" --title`, `brainy search`, `brainy context --project`); 3 copyable developer examples (`brainy add` / `POST /v1/notes`, `brainy_search` hybrid RRF, `brainy export --format markdown` for Obsidian); "Migration from agent-memory" section detailing atomic renames, 1-version alias window, and port preservation (never-kill 3111/3112/3113); updated environment variable table displaying `BRAINY_*` primaries alongside deprecated `AGENT_MEMORY_*` aliases with sunset warning. Lines 1–926 rewritten preserving technical verification rigor. |
| `CHANGELOG.md` | `file-modify` | Add breaking change entry `## [v1.0.0] / [brainy v1]` under Keep a Changelog standard documenting: product rename `agent-memory → brainy`; 1-version backwards compatibility alias for CLI/bin, env vars, MCP tools, and plugin with stderr deprecation warning (`[brainy] deprecation: agent-memory alias will be removed in next major`); sunset schedule; data migration transparency (`brainy.compat.agentmemory` SQLite → HelixDB); secret posture declaration (`BRAINY_SECRET` vault/env only). Parity with README Migration section. |
| `docs/CONTRACT.md` | `contract-update` | Update document header to `Brainy — v1 Frozen Contract`; update all internal text references from `agent-memory` to `Brainy`; preserve backwards compatibility appendix (`brainy.compat.agentmemory` SQLite migration schema and legacy `POST /v1/memory` / `memory_*` MCP alias signatures) as frozen contracts. No changes to underlying wire protocols or schema invariants. |
| `package.json` | `config-update` | Update `name: "brainy"` (line 2), `description: "Segundo cerebro aumentado con agentes (CODE/PARA sobre HelixDB unificado)"` (line 6), `bin: { "brainy": "./bin/brainy.mjs", "agent-memory": "./bin/agent-memory.mjs" }` providing dual entry during 1-version transition, version bump to `1.0.0`. Dependencies unchanged. |
| `plugin.json` | `config-update` | Update plugin manifest `name: "brainy"` and description to "Segundo cerebro aumentado con agentes en HelixDB (CODE/PARA con grafo + vector + BM25): MCP tools, auto-capture hooks, y skill de recall para Google Antigravity." (lines 3-4). |
| `mcp_config.json` | `config-update` | Update MCP server key from `"agent-memory"` to `"brainy"` (command `npx tsx src/mcp.ts`), documenting legacy alias compatibility in README. |
| `helix.toml` | `config-update` | Update `[project] name = "brainy"` (line 2) aligning project identifier with HelixDB engine configuration while keeping `[local.dev]` and `[local.slot2]` storage="disk" intact. |
| `bin/brainy.mjs` & `bin/agent-memory.mjs` | `file-modify` | Introduce `bin/brainy.mjs` as primary executable CLI; maintain `bin/agent-memory.mjs` as a backwards-compatible 1-version shim that outputs a stderr deprecation warning (`[brainy] deprecation: 'agent-memory' is deprecated and will be removed in next major version; use 'brainy'`) before delegating execution to `bin/brainy.mjs`. |
| `docs/` & `skills/` Brand Debt Cleanup | `file-modify` | Purge all active occurrences of `agentmemory` and `iii-engine` across documentation, specs, and skill docstrings (`ARCHITECTURE.md`, `ROADMAP.md`, `CONTRIBUTING.md`, `SECURITY.md`, `skills/**/SKILL.md`), preserving occurrences strictly inside historical archives (`docs/specs/50_archive/`) and active compatibility layer references (`brainy.compat.agentmemory`). |
| `policies/brand-deprecation-policy.md` | `policy-update` | Document formal 1-version deprecation policy governing CLI shims, environment variable fallbacks (`AGENT_MEMORY_* → BRAINY_*`), MCP aliases, and API route deprecation headers (`X-Deprecated`), establishing clear sunset criteria and zero-downtime developer expectations. |
| `campaigns/brainy-v1-launch.md` | `campaign-update` | GTM launch brief defining brand narrative, developer-centric tone, value proposition ("segundo cerebro aumentado con agentes", "no más amnesia de sesión", "CODE/PARA nativo en tu IDE"), release announcement copy, and community messaging across channels without hyperbole or unsubstantiated claims. |
| `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md` | `document-create` | Singleton proposal specification detailing the brand change package, risk assessment, traceability, and review gates without modifying repository implementation files. |

Change types: `file-create | file-modify | file-delete | document-create | campaign-update | contract-update | policy-update | model-update | workflow-update | config-update`.

## Rationale

Each proposed change traces directly to `SPEC-002-brainy-brand` requirements REQ-BRAINY-MKT-01..07 and aligns with the strategic direction defined in `BRIEF-brainy.md` and `OKR-brainy.md`:

- **REQ-BRAINY-MKT-01 (Atomic Public Artifacts Rename with 1-Version Alias):**
  Renaming public package identifiers (`package.json`, `helix.toml`, `mcp_config.json`, `plugin.json`, `bin/brainy.mjs`) establishes Brainy as the single, authoritative project identity. Retaining `agent-memory` as a 1-version shim with a stderr warning protects existing developer workflows and automated agent pipelines (Claude Code, Cursor, Antigravity) from abrupt breaks while setting a deterministic sunset path.
  *Trace: AC-01, AC-02.*

- **REQ-BRAINY-MKT-02 (Purge Brand Debt `agentmemory`/`iii-engine`/`AGENT_MEMORY_*`):**
  The repository currently harbors historical references to `iii-engine` and `agentmemory` from legacy prototypes, which dilutes developer trust and causes confusion regarding the database engine. Purging these terms across active documentation and source files ensures that HelixDB is clearly understood as the sole, unified graph/vector/BM25 engine. All environment variables transition to `BRAINY_*` primaries, isolating `AGENT_MEMORY_*` exclusively to the compatibility shim.
  *Trace: AC-01.*

- **REQ-BRAINY-MKT-03 (Positioning: "Segundo Cerebro Aumentado con Agentes" CODE/PARA + HelixDB):**
  Moves beyond flat memory tuples (`Session`/`Memory`/`Concept`) into an active second brain architecture implementing Tiago Forte's CODE (Capture, Organize, Distill, Express) and PARA (Projects, Areas, Resources, Archives) methodology. The copy emphasizes developer reality: eliminating session amnesia, organizing knowledge automatically without manual taxonomy maintenance, and providing unified hybrid retrieval (<10ms for 10k nodes) without external SaaS services or vector API keys. Real-world developer personas from PRD §9 (María: strict TS/pnpm preferences; team conventions via `brainy_reality_check`) anchor the narrative without invented verticals.
  *Trace: AC-03.*

- **REQ-BRAINY-MKT-04 (README Full Rewrite with Quickstart, 3 Examples, and Migration Guide):**
  Replaces the 926-line legacy README with a streamlined, developer-first guide. Features:
  1. Quickstart CLI commands (`helix start dev`, `npm run bootstrap`, `brainy add`, `brainy search`, `brainy context`).
  2. Three immediately copyable examples: note capture via CLI / `POST /v1/notes`, hybrid search with RRF scores via `brainy_search`, and Markdown vault export for Obsidian via `brainy export --format markdown`.
  3. A prominent "Migration from agent-memory" section detailing the 1-version deprecation window, env var mappings (`AGENT_MEMORY_* → BRAINY_*`), and explicit reassurance that the quartet ports (3111/3112/3113) and never-kill invariants remain intact.
  4. Complete environment variables table with `BRAINY_*` primaries.
  *Trace: AC-04.*

- **REQ-BRAINY-MKT-05 (Deprecation Comms + CHANGELOG Breaking Change Entry):**
  Provides unambiguous documentation of the breaking change under `## [v1.0.0] / [brainy v1]`. Details every renamed entity, explains the 1-version alias mechanics, specifies the console warning format, announces the sunset milestone (v2.0.0), outlines data migration from SQLite via `brainy.compat.agentmemory`, and reiterates that `BRAINY_SECRET` remains vault/env only.
  *Trace: AC-05.*

- **REQ-BRAINY-MKT-06 (Docs & Contract Alignment Without Overpromising):**
  Updates `docs/CONTRACT.md` header to `Brainy — v1 Frozen Contract` and sweeps active specs (`ARCHITECTURE.md`, `ROADMAP.md`). Enforces strict boundary control: no claims regarding unbuilt features (graphical UI, real-time multi-device sync, audio/image embeddings, multi-writer clustering) are permitted in public copy without explicit co-approval from Engineering Owner `general(vasquez)`.
  *Trace: AC-06.*

- **REQ-BRAINY-MKT-07 (Publication Hygiene, No-Secrets, and Sign-off Checklist):**
  Guarantees that all copy, documentation, and examples use strictly allowlisted placeholder values (`BRAINY_SECRET=***`, `http://127.0.0.1:6969`, `$BRAINY_SECRET`), completely preventing credential leakage. All examples respect Ley 172-13 data minimization principles by never displaying raw, unmasked sensitive data. Enforces the formal Marketing Sign-off checklist prior to quality gate entry.
  *Trace: AC-07.*

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| **F2: Dual Brand Permanent** (Coexist `agent-memory` and `brainy` indefinitely as parallel first-class brands) | **Rejected per BRIEF-brainy §Framings-Considered (F2):** Permanent dual branding creates severe cognitive overhead for developers, bifurcates documentation and tutorials, doubles CI/test matrix maintenance, and perpetuates brand debt. A clean 1-version alias sunset is superior in clarity and discipline. |
| **F3: Repository Fork** (Freeze `agent-memory` at v0.9.0 and create a detached GitHub repository `brainy`) | **Rejected per BRIEF-brainy §Framings-Considered (F3):** Forking severs the git history, fragments community stars/issues, divides developer attention, and creates friction for existing users. An in-place atomic rename with automated migration preserves project momentum and credibility. |
| **Immediate Hard Cut (0-Version Sunset)** (Renaming everything immediately without `agent-memory` alias or env shims) | **Rejected:** Violates developer empathy and production safety. Instant breaks in existing CI pipelines, Cursor/Claude configurations, and developer shell scripts cause operational outages. The 1-version deprecation window balances rapid modernization with operational stability. |

## Approval Required From

- [ ] Owning domain owner: **general(vera) — Marketing/Brand Owner (R5)** — Mandatory: brand dignity, positioning accuracy, deprecation clarity, developer empathy.
- [ ] Engineering owner: **general(vasquez) — Engineering Owner (R1)** — Mandatory: technical veracity of hybrid search (<10ms at 10k nodes), zero overpromising of roadmap features (UI, sync, audio/images), validation of CLI/MCP/compat interfaces.
- [ ] Security owner: **general(barrera) — Security Owner (R2)** — Mandatory: no secrets in examples (`BRAINY_SECRET=***` placeholder compliance), local loopback verification, Ley 172-13 PII minimization in note store declarations.
- [ ] Automation/ops owner: **general(espinoza) — Automation/Ops Owner (R8)** — Interface check: `bin/brainy` executable slots, stderr deprecation warning formatting, preservation of never-kill quartet invariants (3111/3112/3113).
- [ ] Legal/privacy owner: **general(subero) — Legal/Privacy Owner (R4)** — Interface check: claim substantiation, Apache-2.0 license notice continuity, Ley 172-13 PII store and right-to-erasure declarations.

> **Rule:** No repository file modifications during proposal phase. For non-code domains, no external sends, filings, or campaign launches during proposal phase either. This lane produces only `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md`.

---

## Risk Assessment: SPEC-002-brainy-brand

**Proposer:** general(vera) — Marketing/Brand Owner (R5)
**Date:** 2026-09-25
**Domains-Touched:** R5 marketing/brand (owner) · R1 engineering · R8 automation/ops · R2 security · R4 legal/privacy

### Risk Matrix

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R-001** | **Developer Confusion during Migration:** Developers unaware of the rename may wonder why `npx agent-memory` or `AGENT_MEMORY_*` emits warnings, or struggle finding docs. | Medium | Medium | Implement dual-binary entry in `package.json:bin` and a friendly stderr deprecation notice explaining the rename with the exact `brainy` alternative; prominently feature the "Migration from agent-memory" section at the top of `README.md` and `CHANGELOG.md`. |
| **R-002** | **Ecosystem & Plugin Disruption:** Antigravity plugins or MCP clients configured with `"agent-memory"` fail to connect if keys are removed abruptly. | Medium | High | Maintain MCP server alias `"agent-memory"` in `src/mcp.ts` and document dual configuration in `README.md`; keep `plugin.json` compatible during the 1-version window; emit actionable stderr diagnostic instructions. |
| **R-003** | **Breaking Change Comms Miss:** Downstream automated scripts break upon upgrading to v1.0.0 if environment variables are not recognized. | Low | High | Support fallback `AGENT_MEMORY_* → BRAINY_*` with a console warning in `src/server.ts`, `src/mcp.ts`, and `bin/brainy.mjs`. Emphasize the breaking change and sunset schedule in `CHANGELOG.md` under `## [v1.0.0] / [brainy v1]`. |
| **R-004** | **Roadmap Overpromising:** Marketing copy exaggerates capabilities (e.g., claiming multi-device cloud sync, native desktop GUI, or voice memos) that are out of scope. | Medium | High | Enforce strict boundary review with Engineering Owner `general(vasquez)` (R1). Explicitly declare graphical UI, real-time sync, and multi-modal models as Out of Scope in `README.md` and GTM briefs. |
| **R-005** | **Secret or Sensitive Data Leakage in Copy:** Public examples or documentation inadvertently display real tokens, secrets, or unmasked user data. | Low | High | Pinned `gitleaks` scan in CI; strict use of placeholders (`BRAINY_SECRET=***`, `http://127.0.0.1:6969`); Security Owner `general(barrera)` (R2) review gate before merge. |
| **R-006** | **Residual Brand Debt / Broken Links:** Incomplete purge leaves broken markdown links or lingering references to `iii-engine` / `agentmemory`, confusing developers. | Low | Low | Enforce strict grep verification (`grep -ri "agentmemory\|iii-engine"`) in CI and acceptance criteria AC-01; ensure all documentation cross-links point to canonical `Brainy` headers. |

### Blast Radius

- **Developer Experience & Learning Curve:** Developers transitioning from `agent-memory` v0.9 to `brainy` v1.0 must adopt the new CLI name (`brainy`) and environment variables (`BRAINY_*`). The 1-version alias window ensures zero disruption to daily work, with actionable warnings guiding them to update their shell profiles.
- **Ecosystem & Plugins:** Local OpenCode, Antigravity, Claude Code, and Cursor MCP setups referencing `agent-memory` continue operating through the compat shim. The plugin identifier is updated smoothly.
- **Systems & Services:**
  - REST Server: Primary port 3111 (or 3151 reroute) remains completely unchanged.
  - HelixDB: Dev instance port 6969 and storage configuration (`storage="disk"`) remain intact; `helix.toml` project rename to `brainy` is isolated to the local engine metadata.
  - STDIO MCP Transport: Protocol behavior remains strictly compliant with Model Context Protocol standards.
- **Teams Affected:**
  - Marketing (R5): Manages brand repositioning, documentation voice, launch messaging, and developer relations.
  - Engineering (R1): Co-approves technical claims, ensures CLI/REST/MCP parity, and maintains compat layer.
  - Automation/Ops (R8): Validates slot allocations, container scripts, and CI/CD pipeline health.
  - Security (R2) & Legal (R4): Verifies no-secrets posture and Ley 172-13 privacy declarations.
- **Customers / Regulators / Revenue:**
  - Customers/Developers: Benefit from improved clarity, CODE/PARA organization, and reliable second brain capabilities.
  - Regulators: Ley 172-13 compliance preserved; clear purpose, TTL, and right-to-erasure declarations documented.
  - Revenue: Open-source MVP with zero licensing, pricing, or commercial paywall impacts.
- **Timeout & Availability:** Documentation and metadata updates introduce zero runtime overhead, latency changes, or timeout risks.
- **Failure Isolation:** Any issues in brand copy or documentation are isolated to static markdown files and package manifests; core database persistence and query logic remain unaffected.

### Rollback Plan

- **Documentation & Metadata Revert:** If developer feedback or unexpected plugin incompatibilities require rolling back the rename, revert all brand commits via `git revert` (owner: `general(vera)` R5, ETA < 15 minutes).
- **Comms Retraction & Deprecation Extension:** If the 1-version window proves too abrupt for key ecosystem partners, issue a minor patch (v1.0.1) extending the alias deprecation window to v2.0.0 and updating `CHANGELOG.md` and `README.md` accordingly.
- **Config Rollback:** Restore `"name": "agent-memory"` in `package.json`, `helix.toml`, `plugin.json`, and `mcp_config.json`.
- **Verification After Rollback:** Execute `npm run typecheck`, `npm run verify`, and check that `bin/agent-memory.mjs` executes cleanly without deprecation warnings.

### Security Considerations

- **No Secrets in Public Copy:** All examples in `README.md`, `CHANGELOG.md`, `docs/CONTRACT.md`, and launch guides use synthetic placeholders (`BRAINY_SECRET=***`, `$BRAINY_SECRET`).
- **Input & Parameter Hygiene:** CLI examples demonstrate proper sanitization, quoting, and local loopback endpoints (`http://127.0.0.1:6969`, `http://127.0.0.1:3111`).
- **Privacy Compliance (Ley 172-13):** The README explicitly includes the Data Privacy declaration: `Note.content` and `Memory.statement` store developer context for session recall; data remains local under user control; TTL and deletion procedures (`brainy forget`, `scripts/purge.ts`) are documented; logs and hooks adhere to field allowlists.

### Domain Considerations

- **Marketing/Brand (R5):** Establishes an authentic, dignified, developer-centric voice without superficial hype. Elevates the product from a simple key-value store to an augmented second brain implementing Tiago Forte's CODE/PARA.
- **Engineering (R1):** Technical rigor enforced: no exaggerations of retrieval speed (<10ms hybrid search bounded up to 10k nodes per benchmark scorecard), strict adherence to frozen contract interfaces.
- **Automation/Ops (R8):** Binary slots, execution scripts, and CI workflows updated deterministically with zero-downtime transition.
- **Security (R2):** Pre-push gitleaks and secret scanning verified; no PII exposure.
- **Legal/Privacy (R4):** Alignment with Dominican Ley 172-13; clear retention and deletion declarations.

### C2 Budget Note

A triggered challenge round runs exactly once, where pass = ≤3 questions (question 4 / N+1 = FAIL, blocked), followed by a terminal approve/reject decision. Approver-requested re-grill allows ≤1 extra pass (total ≤2), then Retry N=2 triggers escalation to `orchestrator`.
Exit before decision results in a pause, recorded as `grill: exited`, and escalation; the proposal stays unapproved (no silent promote).
The round challenges the plan and mitigations; it never rewrites the proposal.

---

## C2 Challenge Hook Trigger Analysis

### Trigger Evaluation Checklist

1. **Auth / data / API / PII surface touched?**
   - **YES.** While this proposal governs brand and documentation, it specifies public API route paths (`POST /v1/notes`, `POST /v1/search`), MCP server tool identifiers (`brainy_search`, `brainy_capture`), environment variable authentication (`BRAINY_SECRET` bearer guard), and privacy declarations for stored notes under Ley 172-13.
2. **Multi-domain scope?**
   - **YES.** The proposal touches 5 domains: Marketing/Brand (R5, owner), Engineering (R1, technical claims & contract), Automation/Ops (R8, bin slots), Security (R2, secret hygiene), and Legal/Privacy (R4, Ley 172-13 compliance).
3. **Blast radius mentioning customers / regulators / revenue?**
   - **YES.** The blast radius covers developers/users ("customers"), Dominican data privacy authorities under Ley 172-13 ("regulators"), and open-source adoption ecosystem ("revenue" / community value).
4. **Approver request?**
   - Available upon reviewer request.

**Trigger Verdict:** **TRIGGERED** (via auth/API surface, multi-domain scope, and regulator/user blast radius).

### One-Pass Budget & Execution Rules

- **Budget:** Exactly one budgeted round per trigger containing ≤ 3 questions. Any 4th question (N+1) is an automatic methodology FAIL and blocks the lane.
- **Re-challenge Budget:** Approver-requested re-grill is limited to ≤ 1 extra pass (maximum 2 passes total).
- **Masking Reminder (Ley 172-13):**
  > *"Por tu privacidad: no compartas PII/secretos/tokens en esta ronda; enmascaramos todo export (Ley 172-13)."*
  Only allowlisted evidence and sanitized references are permitted during review discussions.
- **Exit & Terminal Semantics:**
  An exit before formal decision immediately pauses execution, logs `grill: exited`, and escalates to `orchestrator (Montilla)`. No silent promotion to implementation is permitted.
- **Single Source Canonical References:**
  Glossary definitions live once in `skills/frame-intent/SKILL.md` §C1. Warmth, challenge structure, and canonical clauses live in people SPEC §4.
