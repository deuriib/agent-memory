# Product Brief: Brainy — Segundo Cerebro Aumentado con Agentes (CODE/PARA sobre HelixDB)

**ID:** BRIEF-brainy
**Initiator:** orchestrator (Montilla)
**Date:** 2026-09-25
**Status:** approved
**Execution_Mode:** subagents (frozen at frame-intent; trivial <15 lines goes by CEO fast-path checkpoint-only, outside methodology) — max 2 parallel lanes (INV-006)
**Domains-Touched:** engineering (R1), security (R2), legal/privacy (R4), marketing/brand (R5), automation/ops (R8) — initial routing, refined at translate-to-spec
**Classification:** architectural-initiative (full BRIEF file — rename + new data model + contract break — one-way ratchet, announced 2026-09-25)
**Framings-Considered:** 3 framings evaluados; falsifiable bet registrado; grill: accepted
**Approval:** file-approval 2026-09-25 — aprobado en chat por orquestador (Montilla) + sponsor; BRIEF-brainy + OKR-brainy ratificados para handoff a translate-to-spec

## Problem Statement

Los agentes de IA (Claude Code, Cursor, Gemini CLI) sufren amnesia de sesión — cada conversación parte de cero y obliga a re-explicar contexto, preferencias y decisiones (PRD §2.1). `agent-memory` resuelve la persistencia con HelixDB (grafo+vector+BM25) pero con modelo plano (Session/Memory/Concept) sin estructura relacional para razonar sobre conocimiento. Los PKM tradicionales (Obsidian, Notion) son pasivos: almacenan, no conectan. Además la marca `agent-memory` arrastra deuda de naming (`agentmemory`, `iii-engine` refs) y env vars `AGENT_MEMORY_*` no alineados con el nuevo posicionamiento "segundo cerebro CODE/PARA" de Tiago Forte (PRD §2-3). Se necesita un sistema que fusione CODE/PARA con memoria persistente aumentada para agentes, sobre el motor unificado HelixDB.

## Desired Outcome

**Brainy** como segundo cerebro activo: captura/organiza/destila/expresa conocimiento con PARA (Projects/Areas/Resources/Archives) y exposición MCP nativa, eliminando la amnesia de sesión, con retrieval híbrido (vector+grafo+BM25) <10ms hasta 10k nodos y persistencia ACID en object storage. Marca única Brainy, cero deuda `agentmemory`/`iii`, migración transparente para usuarios actuales. Éxito = 80% menos re-explicación de contexto, 100% notas auto-clasificadas en PARA, MCP consumido por Claude/Cursor sin API keys externas, docs y contrato actualizados.

## Scope

### In Scope

- Rename atómico `agent-memory` → `brainy`: `package.json:2` name, `helix.toml:2` project, `bin/agent-memory.mjs` → `bin/brainy.mjs` (symlink compat 1 versión), `mcp_config.json`, `plugin.json`, README/CONTRACT/CHANGELOG/docs/specs, env `AGENT_MEMORY_*` → `BRAINY_*` con alias compat + deprecation warning [engineering + marketing/brand + automation/ops]
- Cleanup deuda `agentmemory` e `iii-engine`: purge de refs `iii`/`agentmemory` en docs/código/comentarios, verificar HelixDB como único motor (sin fallback Qdrant/Neo4j en MVP) [engineering]
- Esquema HelixQL CODE/PARA (PRD §5.2): N::Note, N::Project, N::Area, N::Resource, N::Archive, N::Memory/N::Agent/N::Context (compat), E::BELONGS_TO/REFERENCES/SUPERSEDES/ABOUT/APPLIES_TO/CAPTURED_BY/RELATES_TO, vector indexes 1536 dims (text-embedding-3-small, configurable) [engineering]
- CODE flows: Capture (CLI `brainy add`, API `POST /v1/notes`, MCP `brainy_capture`), Organize (clasificación PARA automática embeddings+heurística, `brainy move`), Distill (`brainy distill`, versionado SUPERSEDES), Express (`brainy context`, `brainy export --format markdown` Obsidian) [engineering]
- Búsqueda híbrida: vector + traversal grafo + BM25 con RRF fusion (PRD §5.3, §6.5) y compat `POST /v1/search` / `POST /v1/memory` [engineering]
- Servidor MCP Brainy (stdio) con tools `brainy_search`, `brainy_capture`, `brainy_link`, `brainy_reality_check` + compat `memory_*` alias [engineering]
- Capa compat + migración `brainy.compat.agentmemory`: lectura SQLite legacy → HelixDB, mapeo PRD §7.2, misma API `POST /v1/memory` [engineering]
- Docs & contract: nuevo `docs/CONTRACT.md` Brainy v1, `ARCHITECTURE.md`, `TEST_MATRIX.md` actualizado, `docs/briefs/BRIEF-brainy.md` como ancla [engineering + marketing/brand]
- Brand/Marketing: README reescrito Brainy, posicionamiento "segundo cerebro aumentado", CHANGELOG entry breaking change, deprecation notice [marketing/brand]
- Ops: `bin/brainy` slots `BRAINY_PORT`/`HELIX_URL`/`BRAINY_URL`, `helix.toml` storagedisk intacto, never-kill upstream 3111/3112/3113 preservado [automation/ops]
- Security/Privacy: declaración PII store `Note.content` + `Memory.statement` (propósito, TTL, borrado), mask/tokenize en logs/prompts/exports, DPIA si high-risk, no secretos en código/logs, breach 72h [security + legal/privacy]

### Out of Scope

- Interfaz gráfica web/desktop (PRD §4.2)
- Sincronización multi-dispositivo realtime (PRD §4.2)
- Soporte imágenes/audio — solo texto MVP (PRD §4.2)
- Fine-tuning embeddings propio; embeddings remotos configurables vía Helix providers (PRD §4.2)
- Multi-writer P4.3 (roadmap separado), docker-compose/k8s P4.2, npm publish P4.5
- Viewer UI / session replay / 54-tool MCP full (CONTRACT §4 out-of-scope permanece)

## Stakeholders

| Role | Agent | Involvement |
|------|-------|-------------|
| Sponsor | orchestrator (Montilla) | Decision authority, brief owner, gate synthesis |
| Owner | general(vasquez) — Engineering Owner (R1) | Delivery ownership: schema, queries, SDK, MCP, CLI |
| Touched | general(vera) — Marketing Owner (R5) | Brand rename, README/positioning, deprecation comms |
| Touched | general(espinoza) — Automation/Ops Owner (R8) | bin/brainy, slots, data-dir, CI/CD gates |
| Touched | general(barrera) — Security Owner (R2) | Secrets, IAM, STRIDE, PII checkpoints |
| Touched | general(subero) — Legal Owner (R4) | Ley 172-13, DPIA, retention/TTL, cross-border |
| Informed | general(santana/montero/dauhajre) — People/Revenue/Finance (R6/R7/R3) | No budget/headcount impact en MVP; informados |

## Constraints

- Budget: sin nueva infra en MVP — HelixDB local docker + MinIO/S3 existente; embeddings `text-embedding-3-small` costo acotado con cache [finance to confirm — no new spend]
- Timeline: roadmap PRD §11 (F1 Fundación 2w → F2 PARA+Embeddings 2w → F3 Grafo 2w → F4 MCP+compat 2w → F5 Pulido 2w) — 10w total; engineering owner confirma factibilidad por fase en translate-to-spec [engineering]
- Regulatory: Ley 172-13 — cada `Note.content`/`Memory.statement` declara propósito+TTL+borrado, minimización, allowlist en logs/exports, derechos ARCO, transfer cross-border sólo jurisdicción adecuada, DPIA high-risk, breach 72h [legal/security]
- Brand/GTM: marca única Brainy — no doble nombre permanente; alias `agent-memory` sólo 1 versión con warning deprecado [marketing]
- People/change: single-writer contract se mantiene (CONTRACT §3) — multi-instance futuro no incluido; no headcount nuevo [people]
- Secrets: `BRAINY_SECRET` (ex-`AGENT_MEMORY_SECRET`) vault/env only, scan pre-push, nunca en config/logs/examples [security]

## Open Questions

- [ ] Env rename: ¿alias `AGENT_MEMORY_*` → `BRAINY_*` por 1 versión o cut hard inmediato? Owner: engineering + marketing — decidir en SPEC [ ]
- [ ] Dimensión embeddings final: ¿1536 (PRD) vs 384 actual? Owner: engineering — trade-off costo/calidad, definir en ARCHITECTURE [ ]
- [ ] Estrategia bin compat: ¿symlink `agent-memory` → `brainy` + warning o dual entry en package.json bin? Owner: automation/ops [ ]
- [ ] TTL default para `Note`/`Archive`: ¿hereda `BRAINY_TTL_DAYS` o TTL por PARA type? Owner: legal/privacy + engineering [ ]

## Framings-Considered (YAGNI aplicado)

1. **F1 — Big-Bang rename + CODE/PARA v1 (elegido, recomendado):** rename atómico en un solo breaking change + esquema PARA completo + CODE flows + MCP Brainy + migración compat. Cuts YAGNI: sin UI, sin realtime sync, sin imágenes. Falsifiable bet: si HelixDB no soporta 1536-dim + BM25 + grafo <10ms a 10k nodos o la migración SQLite→HelixDB requiere downtime, el framing cae a F2. Riesgo irreversible declarado: migración mueve datos vivos — backup obligatorio, volumen MinIO nunca destruido.
2. **F2 — Rename soft + compat permanente:** marca Brainy pero `agent-memory` como alias permanente (dual bin, dual env, labels viejas+nuevas en paralelo, PARA incremental). Falsifiable bet: si la dualidad duplica docs/tests y confunde `verify`/`bootstrap`, se degrada a F1. No elegido: deuda doble nombre.
3. **F3 — Fork limpio:** congelar `agent-memory` v0.9, crear repo hermano `brainy` copiando codebase sin migración automática (import manual). Falsifiable bet: si el fork duplica mantenimiento y rompe historial git sin beneficio de migración, cae. No elegido: costo mantenimiento + fricción usuario.

Grill: accepted (Framings-Considered con bet falsable; challenge-round opt-in no bloquea HARD-GATE).

## Traceability

| Roadmap (PRD §11) | OKR | Spec (siguiente fase) |
|---|---|---|
| F1 Fundación (esquema HelixQL, CLI básica) | O1 KR1.1-1.2 | SPEC-brainy-foundation (R1) + SPEC-brainy-brand (R5) |
| F2 PARA+Embeddings (clasificación auto) | O2 KR2.1-2.2 | SPEC-brainy-para (R1) |
| F3 Grafo+Relaciones (traversal, edges auto) | O2 KR2.3 | SPEC-brainy-graph (R1) |
| F4 MCP+compat (servidor MCP, migración) | O3 KR3.1-3.2 | SPEC-brainy-mcp (R1) + SPEC-brainy-ops (R8) |
| F5 Pulido (docs, tests, benchmarks) | O1-O3 KR pulido | Gate + Handoff + Ship |
