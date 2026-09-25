# Spec: Brainy Engineering — CODE/PARA sobre HelixDB (rename agent-memory → Brainy)

**ID:** SPEC-001-brainy-engineering
**Owner:** general(vasquez) — Engineering Owner (R1)
**Domains-Touched:** engineering (R1, owner) · marketing/brand (R5, rename/BREAKING) · automation/ops (R8, bin/slots) · security (R2, secrets/PII) · legal/privacy (R4, Ley 172-13 TTL)
**Brief Reference:** docs/briefs/BRIEF-brainy.md (architectural-initiative, approved 2026-09-25)
**OKR Reference:** docs/briefs/OKR-brainy.md (O1 KR1.1-1.2, O2 KR2.1-2.3, O3 KR3.1-3.2)
**PRD Reference:** ../brainy/docs/PRD.md §5-§8, §11
**Contract Reference:** docs/CONTRACT.md §0 verified facts frozen
**Status:** draft
**Priority:** P0
**Execution_Mode:** subagents (frozen at frame-intent; max 2 lanes INV-006 — this lane is R1)

**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-brainy.md#OKRs / HARD:subagents+max2lanes+no-secrets+alias1version+never-kill-3111 / GATE:none-yet / DOMAINS:R1,R5,R8,R2,R4`
**Skill:** `frame-ship:translate-to-spec` (`skills/translate-to-spec/SKILL.md` Process 0-7)

## 1. Context

`agent-memory` resuelve amnesia de sesión con HelixDB (grafo+vector+BM25) pero con modelo plano Session/Memory/Concept 384-dim sin estructura PARA para razonar sobre conocimiento. La marca arrastra deuda `agentmemory`/`iii-engine` y env `AGENT_MEMORY_*` no alineados con el posicionamiento "segundo cerebro CODE/PARA" (Tiago Forte). HelixDB unifica grafo+vector+full-text con ACID sobre object storage (MinIO/S3). BRIEF-brainy congela framing F1 (big-bang rename + CODE/PARA v1) — un único breaking change con alias compat 1 versión, sin UI/realtime-sync/imágenes. Esta SPEC cubre R1: esquema HelixQL, CODE flows, retrieval híbrido, CLI/API/MCP Brainy y migración compat. Marca y bin pertenecen a R5/R8 (propios SPEC) — aquí se declaran solo las invariantes que R1 debe preservar.

Evidencia base existente (reference-only, no paste): `helix.toml:2` project `agent-memory`, `package.json:2` name `agent-memory` + `bin:15` `agent-memory → bin/agent-memory.mjs`, `db/queries.ts:28-193` LABELS/EDGES/EMBED_DIM + `bootstrapIndexes():WriteBatch` (8 indexes + 4 Todo =12), `src/store.ts:616-624` HelixStore.send + `withTimeout 15s`, `src/server.ts:26-31` prefix `/memory` + `3111`, `src/mcp.ts:538-545` `McpServer name agent-memory`, `src/embed.ts:13-16` 384-dim hash embedder.

## 2. Requirements

### Functional — Rename & Cleanup (O1)

- **REQ-BRAINY-ENG-01 — Rename atómico con alias 1 versión (O1 KR1.1):** renombrar `package.json:2` name `agent-memory` → `brainy`, `helix.toml:2` project `brainy`, `bin/agent-memory.mjs` → `bin/brainy.mjs` con symlink o dual-bin compat `agent-memory → brainy` que imprime deprecation warning en stderr por 1 versión (BRIEF Scope, OKR KR1.1). Env `AGENT_MEMORY_*` → `BRAINY_*` con alias lectura `AGENT_MEMORY_*` fallback + warning (Open Question #1 resuelta: alias 1 versión, no hard-cut). Fuera de compat, 0 ocurrencias `agentmemory`/`iii-engine`. Evidence: `grep -r agentmemory|iii-engine --exclude-dir=.helix --exclude-dir=node_modules` + `bin/brainy.mjs` + `helix.toml` diff.

- **REQ-BRAINY-ENG-02 — Cleanup deuda iii/agentmemory (O1 KR1.1):** purgar refs `iii`/`agentmemory` en docs/código/comentarios excepto capa `brainy.compat.agentmemory`; verificar HelixDB como único motor (sin fallback Qdrant/Neo4j en MVP). Evidence: `grep` 0 hits + `docs/CONTRACT.md` Brainy v1 + `ARCHITECTURE.md` v3.

### Functional — Esquema HelixQL (O2 KR2.1)

- **REQ-BRAINY-ENG-03 — Nodos & edges CODE/PARA + compat (O2 KR2.1, PRD §5.2):** crear nodos `N::Note {id,title,content,embedding:Vector<1536>,created_at,updated_at,status}`, `N::Project {name,description,deadline}`, `N::Area {name,description}`, `N::Resource {name,category}`, `N::Archive {name,archived_at}` y preservar compat `N::Memory {id,statement,memory_type,embedding:Vector<1536>,status}`, `N::Agent {name,instance_id}`, `N::Context {name,type}`. Edges `E::BELONGS_TO(Note→Project|Area|Resource|Archive)`, `E::REFERENCES(Note→Note)`, `E::SUPERSEDES(Memory→Memory|Note→Note)`, `E::ABOUT(Memory→Resource|Project)`, `E::APPLIES_TO(Memory→Context)`, `E::CAPTURED_BY(Note→Agent)`, `E::RELATES_TO(Note→Note, auto >0.85)`. Compat: `Memory`-compat rows siguen funcionando vía `POST /v1/memory`. Evidence: `db/queries.ts` new LABELS/EDGES + `bootstrapIndexes` projection.

- **REQ-BRAINY-ENG-04 — Vector & text indexes 1536-dim (O2 KR2.1, PRD §5.3):** `bootstrapIndexes():WriteBatch` crea vectores `note_embedding ON Note(embedding) 1536 cosine tenant project`, `memory_embedding ON Memory(embedding) 1536 cosine tenant project` (configurable via Helix providers) y texto `Note.content`/`Memory.statement` con tenant `project`. `bootstrap` es async (`createIndexIfNotExists` kind:accepted) con poll hasta `index_not_found` clear (hereda `scripts/bootstrap.ts` retry 30s, CONTRACT §0). Evidence: `db/queries.ts:127-193` + `scripts/bootstrap.ts` log + `helix query --host` probe `index_not_found` gone.

### Functional — CODE Flows (O2 KR2.2-2.3, PRD §6)

- **REQ-BRAINY-ENG-05 — Capture (O2 KR2.1-2.2, PRD §6.1):** `brainy add "texto" --title --tags` y `POST /v1/notes {title,content,tags?,project?}` generan embedding `Embed()` en insert y crean `Note` + `BELONGS_TO` inicial (inbox/Resource por defecto si clasificador pendiente). MCP `brainy_capture` expone el mismo path. 200..201 con `{id, inserted:true}`; validación zod `content 1..200k`, `title 1..500`. Evidence: `src/store.ts:HelixStore.saveNote` + `src/server.ts POST /v1/notes` + `src/mcp.ts brainy_capture`.

- **REQ-BRAINY-ENG-06 — Organize PARA automático + move (O2 KR2.2, PRD §6.2):** al insert, clasificador embeddings+heurística asigna `BELONGS_TO` a P/A/R/Ar (100% notas auto-clasificadas) y crea `RELATES_TO` si sim >0.85. CLI `brainy move <noteId> --to <project|area|resource|archive>` re-escribe el edge (drop+add). Heurística y threshold documentados en SPEC/app; no LLM obligatorio en F2. Evidence: `src/store.ts` classify + `db/queries.ts:saveNote/moveNote/relateNotes`.

- **REQ-BRAINY-ENG-07 — Distill con SUPERSEDES (O2 KR2.3, PRD §6.3):** `brainy distill <noteId>` genera resumen 1 línea vía LLM configurable (OpenAI/Gemini/Anthropic, env `BRAINY_LLM_PROVIDER`) y crea nuevo `Note` (o `Memory`) con `E::SUPERSEDES` al original; `GET /v1/notes/:id` expone `supersededBy`/`supersedes`. Versionado append-only, no mutate `content` in-place fuera de `setProperty` path. Evidence: `src/server.ts` distill route + `db/queries.ts:distillNote`.

- **REQ-BRAINY-ENG-08 — Express context & export (O2 KR2.3, PRD §6.4):** `brainy context --project "X"` y `GET /v1/context/:project` devuelven notas+memories+relations con `graph_path` (traversal `Note-BELONGS_TO-Project` + `REFERENCES` depth ≤2). `brainy export --format markdown` genera vault Obsidian (`# title` + frontmatter `project/tags` + `[[links]]`). Evidence: `src/server.ts GET /v1/context/:project` + CLI `export`.

### Functional — Retrieval híbrido (O2 KR2.3, PRD §6.5)

- **REQ-BRAINY-ENG-09 — Búsqueda híbrida RRF (O2 KR2.3, PRD §6.5):** `POST /v1/search {query,project?,include_graph?,max_depth?,vector_top_k?,limit?}` ejecuta vector (`vectorSearchWith` 1536 `project` tenant) + traversal grafo (`BELONGS_TO`/`REFERENCES`/`RELATES_TO` depth ≤max_depth) + BM25 (`textSearchWith`) con fusión RRF `score= Σ 1/(60+rank_i)` y respuesta `{results:[{note,score,graph_path,related_memories}]}`. `POST /v1/memory` search compat preservado. Degradación: fuente caída → `signals` sin 500. Evidence: `src/search.ts hybridSearch` + `db/queries.ts searchByVector/Text graphSearch` + `scripts/eval.ts` R@5 no regresión.

### Functional — MCP & Compat (O3 KR3.1-3.2, PRD §7)

- **REQ-BRAINY-ENG-10 — Servidor MCP Brainy (O3 KR3.1, PRD §6.5):** stdio `McpServer(name=brainy)` expone `brainy_search` (híbrida), `brainy_capture` (capture), `brainy_link` (create `REFERENCES`/`BELONGS_TO`), `brainy_reality_check` (reglas activas + contexto proyecto) con alias compat `memory_*` (11 tools previas) por 1 versión. `tools/list` handshake ≥4 tools nuevas. Evidence: `src/mcp.ts:162-535` registerTools + `InMemoryTransport` test.

- **REQ-BRAINY-ENG-11 — Compat SQLite → HelixDB (O3 KR3.2, PRD §7):** módulo `brainy.compat.agentmemory` migra `memories.statement→Memory.statement`, `memories.type→Memory.memory_type`, `objects.name→Resource.name`, `contexts.name→Context.name`, `links.about→E::ABOUT`, `links.context→E::APPLIES_TO` (PRD §7.2). `POST /v1/memory` acepta payload legacy (`statement` alias `content`). Agentes `@agentmemory/mcp` migran cambiando solo URL. Evidence: `src/compat/agentmemory.ts` + `scripts/import-transcript.ts` round-trip + verify legacy payload.

- **REQ-BRAINY-ENG-12 — REST Brainy + legacy (O3 KR3.2, PRD §8):** rutas `POST /v1/notes`, `GET /v1/notes/:id`, `POST /v1/search`, `POST /v1/memory` (legacy compat), `GET /v1/context/:project`, `POST /v1/link`. Legacy `/memory/*` preservado como alias 1 versión con deprecation header `X-Deprecated: use /v1/*`. Env `BRAINY_PORT`/`BRAINY_SECRET`/`HELIX_URL` (`AGENT_MEMORY_*` alias). Evidence: `src/server.ts` route table.

### Non-Functional

- **NFR-BRAINY-ENG-01 — Perf híbrido p95 <10ms @10k nodos (O2 KR2.1-2.3, PRD §10):** híbrida con `limit≤10` p95 <10ms hasta 10k `Note`+`Memory` nodos (ANN + scoped search, `where project` antes de `vectorSearchWith`/`textSearchWith`,(contract §0 scoped)). Medición: `scripts/eval.ts` + `docs/benchmarks/SCORECARD.md` (R@5/MRR/nDCG), `scripts/verify.ts` p95 harness. Gate FAIL si >10ms sin waiver.

- **NFR-BRAINY-ENG-02 — Persistencia ACID & bootstrap async (PRD §10, CONTRACT §0):** storage `disk` (MinIO/S3) ACID; `helix.toml [local.dev] storage=disk`; `bootstrapIndexes` reentrante, poll async hasta READY antes de aceptar writes. Evidence: `helix.toml` + `scripts/bootstrap.ts` + CONTRACT §0 fact.

- **NFR-BRAINY-ENG-03 — Migración dims 384→1536 (BRIEF Open Q #2, OKR F2):** `EMBED_DIM=1536` (default `text-embedding-3-small`); re-embeddings batched `writeBatch forEachParam` con `setProperty embedding` (CONTRACT §0: `forEachParam empty` commit fine, `setProperty` refreshes vector index per `probe4`). Legacy 384 rows re-embed on-read o via `scripts/migrate-embeddings.ts` con feature-flag `BRAINY_EMBED_DIM=384` fallback 1 versión. Evidence: `db/queries.ts EMBED_DIM`, `src/embed.ts`, `probe4.ts` verdict.

- **NFR-BRAINY-ENG-04 — No secrets / Ley 172-13 (BRIEF Constraints, GATE R2/R4):** `BRAINY_SECRET` vault/env only, nunca en config/logs/examples; PII store `Note.content`/`Memory.statement` con propósito=`segundo cerebro` TTL=`BRAINY_TTL_DAYS` (default 365) + borrado `forgetMemory`/`purge`; logs/prompts/exports allowlist only. Evidence: `src/server.ts auth guard` + `SECURITY_REVIEW.md`.

## 3. Acceptance Criteria

- [ ] **AC-01 (REQ-01):** `package.json name==brainy`, `helix.toml project==brainy`, `bin/brainy.mjs` existe y `bin/agent-memory.mjs` symlink/wrapper emite warning en stderr; `grep -r AGENT_MEMORY_ src` solo en compat alias; `npm run typecheck` green.
- [ ] **AC-02 (REQ-02):** `grep -r "iii-engine|agentmemory" --exclude-dir=.helix` =0 fuera de `brainy.compat.*` y deprecation doc; `docs/CONTRACT.md` reescrito Brainy v1.
- [ ] **AC-03 (REQ-03):** `npm run bootstrap` crea N::Note/Project/Area/Resource/Archive + compat Memory/Agent/Context y edges 7 tipos (helix query describe); `POST /v1/notes` + `POST /v1/memory` ambos insertan.
- [ ] **AC-04 (REQ-04):** `vectorSearchWith` Note `dim 1536 metric cosine tenant project` responde; ensayo `q` no tira `index_not_found` tras bootstrap; `scripts/probe.ts` evidencia async poll.
- [ ] **AC-05 (REQ-05):** `brainy add "hello" --title t` → 201 + `listNotes` lo devuelve; `POST /v1/notes` 201; `brainy_capture` MCP 200.
- [ ] **AC-06 (REQ-06):** add 20 notas variadas → 100% con `BELONGS_TO` a P/A/R/Ar; `brainy move <id> --to area` cambia edge; pares >0.85 generan `RELATES_TO`.
- [ ] **AC-07 (REQ-07):** `brainy distill <id>` crea nota con `SUPERSEDES`; `GET /v1/notes/:id` expone linaje; LLM provider configurable vía env.
- [ ] **AC-08 (REQ-08):** `brainy context --project X` y `GET /v1/context/:project` devuelven `graph_path`; `brainy export --format markdown` genera `.md` con frontmatter+links válidos.
- [ ] **AC-09 (REQ-09):** `POST /v1/search {query,include_graph:true,max_depth:2,vector_top_k:10}` → `{results[*].score, graph_path}` RRF; fuente caída → `signals` no 500; p95 <10ms en eval/scorecard.
- [ ] **AC-10 (REQ-10):** handshake `tools/list` incluye `brainy_search|capture|link|reality_check` + alias `memory_*` responden; p95 MCP 200ms.
- [ ] **AC-11 (REQ-11):** `import-transcript` SQLite→HelixDB migra con mapeo §7.2 idempotente; `POST /v1/memory {statement}` compat 201.
- [ ] **AC-12 (REQ-12):** `POST /v1/notes|search|memory|link` y `GET /v1/notes/:id|context/:project` tabla PRD §8 green; legacy `/memory/*` alias con header deprecado.
- [ ] **AC-NFR01:** p95 <10ms a 10k nodos reportado en `docs/benchmarks/SCORECARD.md`.
- [ ] **AC-NFR02:** restart MinIO → datos intactos (ACID); bootstrap reentrante.
- [ ] **AC-NFR03:** `BRAINY_EMBED_DIM=384` fallback lee legacy; migración batch re-embeds sin downtime, `forEachParam empty` safe.
- [ ] **AC-NFR04:** scan `grep -r BRAINY_SECRET` sin valor impreso; `delete` governance log allowlist only.

## 4. Contracts & Interfaces

### 4.1 HelixQL — Labels & Edges

```ts
LABELS.Note="Note"; LABELS.Project="Project"; LABELS.Area="Area"; LABELS.Resource="Resource"; LABELS.Archive="Archive";
LABELS.Memory="Memory"; LABELS.Agent="Agent"; LABELS.Context="Context"; // compat
EDGES.BELONGS_TO="BELONGS_TO"; EDGES.REFERENCES="REFERENCES"; EDGES.SUPERSEDES="SUPERSEDES";
EDGES.ABOUT="ABOUT"; EDGES.APPLIES_TO="APPLIES_TO"; EDGES.CAPTURED_BY="CAPTURED_BY"; EDGES.RELATES_TO="RELATES_TO";
EDGES.HAS_CONCEPT="HAS_CONCEPT"; EDGES.BELONGS_TO_SESSION="BELONGS_TO"; // legacy Memory->Session preserved
EMBED_DIM=1536;
```

### 4.2 `db/queries.ts` exports (frozen names §2, + Brainy — ver ARCHITECTURE.md §6)

```
bootstrapIndexes():WriteBatch          // 10+ indexes (Note/Project/Area/Resource/Archive uniqueEquality + vector 1536 + text)
saveNote():WriteBatch                 // noteId,title,content,project,embedding(1536),origin,createdAt,paraTags[] → addN Note + BELONGS_TO + forEachParam concepts/RELATES_TO
listNotes():ReadBatch                 // project,limit
getNoteById():ReadBatch               // noteId,project
searchByVector():ReadBatch            // queryVector(1536),project,k  — scoped where project before vectorSearchWith
searchByText():ReadBatch              // q,project,k — scoped
graphSearch():ReadBatch               // concepts,project,k  + new graphSearchNotes for PARA
moveNote():WriteBatch                 // noteId, toPara{label,name}
distillNote():WriteBatch              // noteId, summary, embedding, supersededId
forgetNote():WriteBatch               // noteId  (compat forgetMemory preserved)
healthCount():ReadBatch               // project
// compat preserved:
saveMemory()/searchByText|Vector/graphSearch/forgetMemory/findMemoryByDedupKey/listExpired/listProjects/getMemoryById/memoryConcepts/linkMemoryConcepts/updateMemoryContent
// migration:
migrateAgentMemoryRow():WriteBatch    // compat ingest
```

Preserve CONTRACT §0 facts (citar en PROPOSED_CHANGES): `writeBatch().forEachParam(empty)` → commit fine (`db/queries.ts:299` still), `NodeRef.var("outer")` inside forEach usable, `varAsIf` create/update, `createIndexIfNotExists` async + poll, scoped `textSearchWith`/`vectorSearchWith` + `$score/$distance` projection, `embedding` never in search payload, `toQueryRequest(params,values)` + `client.query(req).send()`.

### 4.3 REST — Brainy v1 (PRD §8 + compat)

| Method | Route | Body/query | Success | Notes |
|---|---|---|---|---|
| POST | `/v1/notes` | `{title 1..500, content 1..200k, tags? string[64], project?}` | 201 `{id,project,para}` | zod strict, embed 1536 |
| GET | `/v1/notes/:id` | `?project=` | 200 `{note, para, supersedes, supersededBy}` | 404 |
| POST | `/v1/search` | `{query 1..10k, project?, include_graph?, max_depth? 1..3, vector_top_k? 1..20, limit? 1..100}` | 200 `{results:[{note,score,graph_path,related_memories}],signals}` | RRF 60 |
| POST | `/v1/memory` | legacy `{statement|content, concepts?, project?, sessionId?, memory_type?}` | 201 `{id, sessionId, project, concepts, deduped}` | compat alias content |
| GET | `/v1/context/:project` | `?limit=` | 200 `{project, notes[], memories[], graph}` | traversal |
| POST | `/v1/link` | `{fromId,toId,type:REFERENCES|BELONGS_TO|RELATES_TO}` | 201 `{edge}` | |

Legacy alias 1 versión: `/memory/*` → `/v1/*` 308 + `X-Deprecated` header, bearer guard `BRAINY_SECRET` (alias `AGENT_MEMORY_SECRET`).

### 4.4 MCP — Brainy stdio

`McpServer(name=brainy)` stdio. Tools: `brainy_search {query,project,limit,include_graph,max_depth}`, `brainy_capture {content,title,project,tags}`, `brainy_link {fromId,toId,type}`, `brainy_reality_check {project}` (+ compat `memory_*` 11 tools). Auth `_meta.authorization Bearer <BRAINY_SECRET>` alias `AGENT_MEMORY_SECRET`. One heal line `heal survivor=...` on stderr only.

### 4.5 CLI

`brainy add "text" --title t --tags a,b --project p` → POST /v1/notes; `brainy move <id> --to <para>`; `brainy distill <id> [--provider openai|gemini]`; `brainy context --project p`; `brainy export --format markdown --out ./vault`. Bin `brainy` (`HELIX_URL`/`BRAINY_URL` slots, never-kill 3111/3112/3113 preserved per `src/server.ts:653-661`).

## 5. Out of Scope

- UI web/desktop (PRD §4.2, BRIEF Out-of-scope)
- Sincronización multi-dispositivo realtime (PRD §4.2)
- Imágenes/audio — solo texto MVP (PRD §4.2; embeddings 1536 text-only)
- Fine-tuning embeddings propio; solo `text-embedding-3-small` configurable vía Helix providers (PRD §4.2)
- Multi-writer P4.3, docker-compose/k8s P4.2, npm publish P4.5 (BRIEF Out-of-scope, roadmap separado)
- 54-tool MCP full / viewer UI / session replay (CONTRACT §4 permanece)
- Re-escritura historial git; migración es forward-only con backup MinIO nunca destruido

## 6. Dependencies

- Upstream: `helix.toml [local.dev] storage=disk` + HelixDB `ghcr.io/helixdb/helixdb:v0.0.6` (§0 facts); `@helix-db/helix-db@3.0.4` SDK; `AGENT_MEMORY_*` env alias.
- Downstream: SPEC-brainy-brand (R5) para README/CONTRACT/CHANGELOG copy; SPEC-brainy-ops (R8) para `bin/brainy` slots `BRAINY_*`; SECURITY_REVIEW (R2) STRIDE sobre nuevo boundary `Note.content`; LEGAL_REVIEW (R4) DPIA/TTL.
- External: `text-embedding-3-small` 1536 dims; MinIO/S3 for ACID.

## 7. Traceability

| Requirement | AC | OKR | Proposed Change | Evidence |
|---|---|---|---|---|
| REQ-01 | AC-01 | O1 KR1.1 | PROPOSED_CHANGES.md (bin+helix+pkg) | `grep` 0 agentmemory + diff stat |
| REQ-02 | AC-02 | O1 KR1.1 | PROPOSED_CHANGES.md | `grep iii` 0 + CONTRACT v1 |
| REQ-03 | AC-03 | O2 KR2.1 | db/queries.ts LABELS/EDGES | `helix query` describe + remember 201 |
| REQ-04 | AC-04 | O2 KR2.1 | db/queries.ts bootstrapIndexes | probe index_not_found gone |
| REQ-05 | AC-05 | O2 KR2.1 | src/store.ts saveNote + server POST /v1/notes | CLI+REST+MCP 201 |
| REQ-06 | AC-06 | O2 KR2.2 | store classify + moveNote | 20 notes 100% BELONGS_TO + RELATES_TO |
| REQ-07 | AC-07 | O2 KR2.3 | distillNote SUPERSEDES | distill round-trip |
| REQ-08 | AC-08 | O2 KR2.3 | GET /v1/context + export | context graph_path + .md vault |
| REQ-09 | AC-09 | O2 KR2.3 | src/search.ts hybrid RRF | POST /v1/search 200 + p95 <10ms scorecard |
| REQ-10 | AC-10 | O3 KR3.1 | src/mcp.ts brainy_* + alias | tools/list + live round-trip |
| REQ-11 | AC-11 | O3 KR3.2 | brainy.compat.agentmemory | import-transcript + POST /v1/memory |
| REQ-12 | AC-12 | O3 KR3.2 | src/server.ts /v1/* + alias | verify table §8 |
| NFR-01 | AC-NFR01 | O2 KR2.3 | search.ts + Sco recard | p95 <10ms 10k |
| NFR-02 | AC-NFR02 | O3 | helix.toml + bootstrap retry | restart intact + reentrant |
| NFR-03 | AC-NFR03 | O1 | migrate-embeddings.ts | 384 fallback + batch setProperty |
| NFR-04 | AC-NFR04 | — | auth guard + logline | no secret in logs |
