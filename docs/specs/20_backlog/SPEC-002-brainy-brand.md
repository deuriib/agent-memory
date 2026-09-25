# Spec: Brainy Brand Rename — agent-memory → Brainy (segundo cerebro CODE/PARA)

**ID:** SPEC-002-brainy-brand
**Owner:** general(vera) — Marketing/Brand Owner (R5)
**Domains-Touched:** marketing/brand (R5, owner) · engineering (R1, interface — no overpromising roadmap/claims) · automation/ops (R8, interface — bin/docs slots) · security (R2, interface — no secrets in examples) · legal/privacy (R4, interface — claims/privacy review)
**Brief Reference:** BRIEF-brainy (docs/briefs/BRIEF-brainy.md#OKRs)
**Status:** draft
**Priority:** P0
**Execution_Mode:** subagents (inherited from BRIEF-brainy, frozen at frame-intent; max 2 parallel lanes INV-006) — per packet HARD:subagents+max2lanes+no-secrets+alias1version
**GATE:** none-yet
**Skill Path:** `frame-ship:translate-to-spec` (`skills/translate-to-spec/SKILL.md` + `references/spec-template.md`)

## 1. Context

`agent-memory` resuelve la amnesia de sesión con HelixDB (grafo+vector+BM25) pero con marca plana y deuda `agentmemory`/`iii-engine` + env `AGENT_MEMORY_*` (BRIEF-brainy §Problem). La visión Brainy (PRD §1, §9, §13) es el **segundo cerebro aumentado con agentes** — no un archivo pasivo sino colaborador activo — fusionando **CODE (Capture/Organize/Distill/Express) + PARA (Projects/Areas/Resources/Archives)** de Tiago Forte sobre **HelixDB unificado** (grafo+vector+full-text+temporal, sin Qdrant/Neo4j).

Este SPEC cubre exclusivamente el lane **R5 Marketing/Brand** del rename atómico `agent-memory → brainy` (BRIEF-brainy §Scope In-Scope bullet 1 + bullet 8). R1 es dueño de schema/queries/SDK/MCP/CLI; R8 de `bin/brainy` slots; R2/R4 de PII/secrets. R5 es dueño de: purga de marca, posicionamiento, README reescrito, CHANGELOG breaking change + deprecation comms con alias 1 versión, y aprobación de cualquier claim de roadmap/producto para evitar overpromising (collab R1).

Referencia sólo: `docs/briefs/BRIEF-brainy.md`, `docs/briefs/OKR-brainy.md` (KR-1.1/KR-1.2), `../brainy/docs/PRD.md` §1 (Visión segundo cerebro), §9 (casos María/equipo — preferencia TypeScript estricto/pnpm, convenciones vía `brainy_reality_check`), §13 (glosario CODE/PARA), §5.2/§11.

## 2. Requirements

- **REQ-BRAINY-MKT-01 — Rename atómico artefactos públicos (alias 1 versión):** Renombrar `package.json:2` `name: "agent-memory"` → `"brainy"`, `helix.toml:2` `project` `agent-memory` → `brainy`, `bin/agent-memory.mjs` → `bin/brainy.mjs` con compat `agent-memory` alias 1 versión (symlink o dual `bin` entry que emite deprecation warning y delega a `brainy`), `mcp_config.json` key `agent-memory` → `brainy` (+ alias compat), `plugin.json` `name` `agent-memory` → `brainy`, y toda ruta `docs/specs` que mencione la marca. `BRIEF-brainy` queda como ancla histórica (no renombrar). Compat expira en la versión siguiente (breaking change notice anuncia sunset).

- **REQ-BRAINY-MKT-02 — Purge deuda `agentmemory`/`iii-engine`/`AGENT_MEMORY_*` fuera de compat:** Cero ocurrencias de `agentmemory`/`iii-engine` (case-insensitive) y de `AGENT_MEMORY_*` fuera de la capa compat/alias una vez aplicado el rename. Compat layer único permitido: `brainy.compat.agentmemory` y shim env `AGENT_MEMORY_* → BRAINY_*`. Verificación: `grep -r "agentmemory\|iii-engine" --exclude-dir=.helix --exclude-dir=node_modules` → 0 hits fuera de `compat/`/deprecation notice; `grep -r "AGENT_MEMORY_"` → sólo en compat alias.

- **REQ-BRAINY-MKT-03 — Posicionamiento "segundo cerebro aumentado con agentes" (CODE/PARA + HelixDB):** README hero/tagline + `package.json` `description` + `plugin.json` `description` + `docs/CONTRACT.md` intro posicionan Brainy como *segundo cerebro aumentado con agentes* fusionando **CODE/PARA** (Tiago Forte, PRD §13 glosario) sobre **HelixDB** (grafo+vector+BM25+temporal unificado, sin servicios externos). Mensaje distingue: no PKM pasivo (Obsidian/Notion) ni memoria plana Session/Memory/Concept — sino red relacional PARA. Casos de uso PRD §9.1 María (preferencia TS/pnpm) y §9.2 equipo (convenciones) citados como ejemplos de `brainy_capture`/`brainy_reality_check`, sin inventar verticales.

- **REQ-BRAINY-MKT-04 — README reescrito Brainy (quickstart + examples + migration):** Reescribir `README.md:1-925` completo bajo marca Brainy preservando estructura verificable (How it works, Quick start, REST API, MCP, Hooks, Verification) pero con: (a) quickstart `brainy` CLI (`helix start dev`, `npm install`, `npm run bootstrap`, `brainy add "texto" --title`, `brainy search`/`brainy context --project`), (b) 3 ejemplos copiables: `brainy add`/`POST /v1/notes` + `brainy_search` hybrid + `brainy export --format markdown` (Obsidian), (c) sección **Migration from agent-memory** con comando, mapeo `AGENT_MEMORY_*` → `BRAINY_*`, y nota never-kill `3111/3112/3113` preservada, (d) env table actualizada `BRAINY_*` primarios + `AGENT_MEMORY_*` alias deprecado. Ningún claim de UI/pricing/sync introduce fuera de §5.

- **REQ-BRAINY-MKT-05 — Deprecation comms + CHANGELOG breaking change (alias 1 versión):** `CHANGELOG.md` entry `## [v1.0.0] / [brainy v1]` tipo `Changed/BREAKING CHANGE` que liste: renames (package, helix.toml, bin, env, mcp_config, plugin), alias compat 1 versión con warning (`[brainy] deprecation: agent-memory alias will be removed in next major`), sunset/expiry (1 versión), migración transparente (`brainy.compat.agentmemory` SQLite→HelixDB, `POST /v1/memory` payload legacy), y `BRAINY_SECRET` vault/env only. README Migration + CHANGELOG deben coincidir. Gate: marketing owner sign-off en PR.

- **REQ-BRAINY-MKT-06 — Docs & contract alineados, sin overpromising (collab R1):** Actualizar `docs/CONTRACT.md` header a `Brainy — v1 Frozen Contract` y todas las menciones internas `agent-memory` → `Brainy` (mantener apéndice compat si existe), y barrer `docs/specs` (`ARCHITECTURE.md`, `15_requirements/`, `30_delivery/`) de refs de marca vieja fuera de histórico. Todo claim de roadmap fuera de BRIEF-brainy §Scope/PRD §4.1/§11 (p. ej. multi-writer P4.3, docker-compose/k8s, npm publish, viewer UI) requiere aprobación explícita `general(vasquez)` R1; REQ-BRAINY-MKT lo bloquea si no hay `ARCHITECTURE.md`/`BRIEF` cover. No inventar fechas/SLAs/precios.

- **REQ-BRAINY-MKT-07 — Higiene de publicación (no-secrets, allowlist, sign-off):** Todo ejemplo/README/CHANGELOG/docs usa valores placeholder (`BRAINY_SECRET=***`, `http://127.0.0.1:6969`), nunca secretos reales (HARD no-secrets). Logs/exports/prompts siguen allowlist — ningún ejemplo imprime `Memory.content` crudo como secreto. Entregable R5 exige `marketing sign-off` checklist (grep 0, diffs, CHANGELOG) antes de `quality-gate`.

## 3. Acceptance Criteria

- [ ] **AC-01 (REQ-01, REQ-02 — rename + purge grep):** `grep -ri "agentmemory" --exclude-dir=.helix --exclude-dir=node_modules --exclude-dir=.git | grep -v "compat" | grep -v "CHANGELOG.*BREAKING.*agent-memory" | wc -l` → `0`; igual para `iii-engine`. `grep -r "AGENT_MEMORY_" --exclude-dir=.helix --exclude-dir=node_modules` → sólo hits en `compat`/`bin/*.mjs` alias shim con `deprecation` token. Evidencia: CI log + `git diff --stat` muestra `package.json:2` `brainy`, `helix.toml:2` `brainy`, `bin/brainy.mjs` (+ symlink/dual bin), `mcp_config.json` `brainy`, `plugin.json` `brainy`.

- [ ] **AC-02 (REQ-01 — alias 1 versión):** `npx agent-memory --help` o `bin/agent-memory --help` (alias) → exit 0, stderr contiene `deprecation` + `brainy` y delega correctamente; `npx brainy --help` → sin warning. `npm run typecheck` pasa con nuevo `name`. Evidencia: captura terminal + `package.json` `bin` diff.

- [ ] **AC-03 (REQ-03 — posicionamiento):** `README.md:1-30` hero contiene exactamente `segundo cerebro` + `CODE` + `PARA` + `HelixDB` + `Tiago Forte` (case-insensitive grep ≥1 cada uno); `package.json` `description` y `plugin.json` `description` contienen `Brainy` y `HelixDB`; `docs/CONTRACT.md:1-5` header `Brainy`. No menciona `iii-engine`/`Qdrant`/`Neo4j` como motor activo (sólo histórico si se cita PRD §12 mitigación). Evidencia: `grep -n` snippets + diff.

- [ ] **AC-04 (REQ-04 — README reescrito):** `README.md` diff muestra: quickstart con `brainy add` y `brainy` CLI, sección `## Migration from agent-memory` con tabla `AGENT_MEMORY_* → BRAINY_*`, 3 ejemplos copiables (CLI `brainy add`, `POST /v1/notes` curl, `brainy export --format markdown`), MCP snippet con `brainy_search`/`brainy_capture` (+ alias `memory_*` compat mencionado), env table con `BRAINY_*` primarios. `README.md` no contiene precios/fechas UI multi-device. Evidencia: `git diff README.md` + `grep -c "brainy"` ≥ 20.

- [ ] **AC-05 (REQ-05 — CHANGELOG breaking change):** `CHANGELOG.md` contiene `## [v1` o `## [brainy` con subtítulo `BREAKING CHANGE` que enumera todos los renames del AC-01, declara `alias 1 versión` + `deprecation warning` + `sunset next major`, menciona `BRAINY_SECRET` vault/env only. README Migration y CHANGELOG coinciden en nombres de env/bin. Evidencia: `grep -A20 "BREAKING CHANGE" CHANGELOG.md` + diff.

- [ ] **AC-06 (REQ-06 — contract/docs + no overpromising):** `docs/CONTRACT.md` diff: `0` ocurrencias `agent-memory` fuera de apéndice compat/histórico; `grep -r "agent-memory" docs/specs --exclude-dir=50_archive` → `0`. Ningún doc nuevo promete UI/PRicing/sync multi-device realtime/imágenes/audio fuera de `docs/briefs/BRIEF-brainy.md` §Out of Scope. Si algún claim toca roadmap P4.3/P4.2/P4.5 requiere comentario `Approved-by: general(vasquez) R1` en PR. Evidencia: grep logs + PR review thread.

- [ ] **AC-07 (REQ-07 — hygiene + sign-off):** `gitleaks`/`secret-scan` en CI pasa; `grep -r "BRAINY_SECRET" README.md docs/` muestra sólo placeholder `***` o `$BRAINY_SECRET`, nunca valor literal. `marketing sign-off` checklist adjunto en PR (grep 0, diffs, CHANGELOG, README). Evidencia: CI log + checklist markdown en PR description.

## 4. Contracts & Interfaces

**Artefactos R5 (document/brand contracts, no API shapes — marketing owner controls):**

| Target | Change | Sign-off | Alias/Warning |
|--------|--------|----------|---------------|
| `package.json:2` `name` | `agent-memory` → `brainy` | R5 + R1 | `bin` dual entry 1 versión, warning en shim |
| `helix.toml:2` `project` | `agent-memory` → `brainy` | R5 + R8 | alias no aplica (project name es fuente) |
| `bin/brainy.mjs` (`bin` key) | nuevo primario; `agent-memory` symlink/dual bin compat 1 versión → stderr `deprecation` | R5 + R8 | `bin/agent-memory.mjs` shim → `brainy` |
| `mcp_config.json` | key `agent-memory` → `brainy` (+ alias compat documentado) | R5 + R1 | README MCP snippet dual |
| `plugin.json` `name` | `agent-memory` → `brainy` | R5 + R1 | compat alias en registry si aplica |
| `README.md:1-925` | rewrite completo Brainy (hero CODE/PARA+HelixDB, quickstart brainy CLI, 3 examples, migration note, env table `BRAINY_*`) | R5 (owner) | no secrets, no pricing/UI |
| `docs/CONTRACT.md` | header `Brainy — v1` + purge marca vieja | R5 + R1 | apéndice compat permitido |
| `CHANGELOG.md` | entry BREAKING CHANGE + deprecation notice + sunset 1 versión | R5 | coincide con README Migration |
| `docs/specs/**` | barrido `agent-memory` → `brainy` fuera de `50_archive/` histórico | R5 | grep 0 fuera de compat |

**Env contract (shared R5+R1+R8):** Primarios `BRAINY_*` (`BRAINY_PORT`, `BRAINY_URL`, `BRAINY_SECRET`, `BRAINY_DATA_DIR`, `BRAINY_PROJECT`, `BRAINY_TTL_DAYS`, `BRAINY_DECAY_LAMBDA`, `BRAINY_MERGE_JACCARD`, `BRAINY_CAPTURE_PATHS`). Alias `AGENT_MEMORY_*` → `BRAINY_*` 1 versión con `console.warn` deprecation en `src/server.ts`/`src/mcp.ts`/`bin/` shim; `HELIX_URL` permanece (no rename). Documentado en README Migration + CHANGELOG.

**Brand claims contract (R5 authorizes, R1 must co-approve):** Cualquier afirmación de performance (`<10ms hasta 10k nodos`), persistencia ACID, MCP nativo, o roadmap (multi-writer, docker-compose, viewer UI) debe citar fuente (`BRIEF-brainy`, `PRD §10-11`, `docs/CONTRACT.md`, `ARCHITECTURE.md`) y llevar `Approved-by: general(vasquez)` si extiende BRIEF §Scope.

## 5. Out of Scope

- UI web/desktop, viewer UI, session replay, 54-tool MCP full (BRIEF-brainy §Out of Scope; PRD §4.2).
- Pricing, packaging, monetización, revenue recognition (R7, no afectado en MVP).
- Sincronización multi-dispositivo realtime, soporte imágenes/audio, fine-tuning embeddings (PRD §4.2).
- Cambios de esquema HelixQL CODE/PARA (N::Note/Project/Area/Resource/Archive, E::BELONGS_TO/REFERENCES/SUPERSEDES) — dueño R1.
- Multi-writer P4.3, docker-compose/k8s P4.2, npm publish P4.5 — dueño R1/R8 roadmap separado.
- Lógica de migración de datos SQLite→HelixDB (`brainy.compat.agentmemory`) — dueño R1; R5 sólo documenta la migración en README/CHANGELOG.

## 6. Dependencies

- **Upstream:** `docs/briefs/BRIEF-brainy.md` (approved 2026-09-25) + `docs/briefs/OKR-brainy.md` KR-1.1/KR-1.2 (rename atómico, docs & brand); `../brainy/docs/PRD.md` §1/§9/§13 como referencia de posicionamiento (no fuente de contrato).
- **Downstream / parallel:** `SPEC-brainy-foundation` / `SPEC-brainy-para` / `SPEC-brainy-graph` / `SPEC-brainy-mcp` (R1) + `SPEC-brainy-ops` (R8) — R5 no bloquea su `bootstrap`/`ARCHITECTURE.md`; pero `quality-gate` exige grep 0 global.
- **Cross-domain:** R1 `general(vasquez)` — co-approval de cualquier claim de roadmap/contrato en README/CONTRACT (no overpromising); R8 `general(espinoza)` — `bin/brainy` slots y `helix.toml` storagedisk intacto; R2/R4 — no-secrets scan + Ley 172-13 PII checkpoints en ejemplos (mask/tokenize).
- **Tooling:** `helix` CLI (`helix.toml` name), `npm`/`package.json`, `gitleaks` pre-push, `grep` verification harness.

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change | Evidence |
|-------------|---------------------|-----------------|----------|
| REQ-BRAINY-MKT-01 | AC-01, AC-02 | PROPOSED_CHANGES.md (rename + alias 1v) | `git diff --stat` + alias help capture + `npm run typecheck` |
| REQ-BRAINY-MKT-02 | AC-01 | PROPOSED_CHANGES.md (purge) | `grep -r agentmemory/iii-engine` 0 fuera compat + CI log |
| REQ-BRAINY-MKT-03 | AC-03 | PROPOSED_CHANGES.md (positioning) | `grep -n "segundo cerebro.*CODE.*PARA.*HelixDB"` + CONTRACT header diff |
| REQ-BRAINY-MKT-04 | AC-04 | PROPOSED_CHANGES.md (README rewrite) | `git diff README.md` + grep brainy ≥20 + 3 examples |
| REQ-BRAINY-MKT-05 | AC-05 | PROPOSED_CHANGES.md (CHANGELOG) | `grep -A20 "BREAKING CHANGE" CHANGELOG.md` + README Migration parity |
| REQ-BRAINY-MKT-06 | AC-06 | PROPOSED_CHANGES.md (CONTRACT/docs) | `grep -r agent-memory docs/specs` 0 + PR `Approved-by: R1` if needed |
| REQ-BRAINY-MKT-07 | AC-07 | PROPOSED_CHANGES.md (hygiene) | gitleaks pass + `BRAINY_SECRET=***` + marketing sign-off checklist |

**Handoff packet (next stage):** `SPEC:docs/specs/20_backlog/SPEC-002-brainy-brand.md#REQ-BRAINY-MKT-01..07 / HARD:subagents+max2lanes+no-secrets+alias1version / GATE:none-yet / DOMAINS:R5,R1,R8,R2,R4` → `frame-ship:propose-changes` (PROPOSED_CHANGES.md, untouched repo) → `review-security`/`review-architecture` → `execute-spec` (max 2 lanes) → `quality-gate`.
