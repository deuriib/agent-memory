# Architecture Contract: Brainy — Segundo Cerebro CODE/PARA sobre HelixDB

**Owner:** general(vasquez) — Engineering Owner (R1)
**Version:** v3
**Last Updated:** 2026-09-25
**Domains-Touched:** engineering (R1, owner) · marketing/brand (R5 — rename alias 1 versión) · automation/ops (R8 — bin/brainy slots) · security (R2 — secrets/PII STRIDE) · legal/privacy (R4 — Ley 172-13 TTL) · todos (R1, bounded) · p4-ops (R1/R8, foundation preserved)
**Singleton:** canonical — create-if-missing, UPPER_SNAKE, never suffix; update in place, never `ARCHITECTURE-*.md`. Interfaces/API shapes live in tables below (no separate `API_CONTRACTS.md`).
**Scope & grounding:** Brainy architectural-initiative (BRIEF-brainy approved 2026-09-25) — rename agent-memory→Brainy + CODE/PARA HelixQL + hybrid RRF + MCP Brainy + compat migration. Grounds `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` (REQ-BRAINY-ENG-01..12, NFR-01..04) over PRD §5-§8. Prior foundation P4 ops + Todos preserved (v2) and cited inline. Format per `review-architecture/references/architecture-template.md`.

## Overview

Brainy es el segundo cerebro activo CODE (Capture/Organize/Distill/Express) sobre PARA (Projects/Areas/Resources/Archives) con HelixDB como motor unificado grafo+vector+BM25 y persistencia ACID en object storage (MinIO/S3). Un único breaking change renombra `agent-memory` → `brainy` (`package.json:2`, `helix.toml:2`, `bin/brainy.mjs`) con alias/symlink `agent-memory` + env `BRAINY_*` alias `AGENT_MEMORY_*` una versión (BRIEF Scope, REQ-01). El esquema HelixQL añade `Note/Project/Area/Resource/Archive` + compat `Memory/Agent/Context` (7 edges). Capture vía `brainy add` / `POST /v1/notes` / `brainy_capture`; Organize auto-clasifica 100% notas en PARA y crea `RELATES_TO >0.85`; Distill versiona `SUPERSEDES`; Express expone `context` + `export markdown` (Obsidian). Búsqueda híbrida `vector(1536)+grafo+BM25` fusiona RRF `1/(60+rank)` en `POST /v1/search` con compat `POST /v1/memory`. MCP Brainy stdio expone `brainy_search/capture/link/reality_check` + alias `memory_*`. P4 ops (`start|stop|status|doctor`, quartet slots, never-kill 3111) y Todos (`Todo` entity, frontier) quedan como sub-sistemas foundation sin regresión (v2 citations below).

**No-secret posture:** `BRAINY_SECRET` vault/env only, nunca en código/logs/examples; PII store `Note.content`/`Memory.statement` con propósito/TTL/borrado (Ley 172-13) y allowlist en logs/exports.

## Components

| Component | Responsibility | Interface |
|-----------|---------------|-----------|
| **Brainy data model** (`db/queries.ts` + `src/store.ts`) | Nodos `Note{id,title,content,embedding[1536],created_at,updated_at,status}`, `Project{name,description,deadline}`, `Area{name,description}`, `Resource{name,category}`, `Archive{name,archived_at}` + compat `Memory{statement,memory_type,embedding[1536]}`, `Agent{name,instance_id}`, `Context{name,type}`; edges `BELONGS_TO(Note→P/A/R/Ar)`, `REFERENCES(Note→Note)`, `SUPERSEDES`, `ABOUT(Memory→Resource|Project)`, `APPLIES_TO(Memory→Context)`, `CAPTURED_BY(Note→Agent)`, `RELATES_TO(auto>0.85)`, legacy `HAS_CONCEPT` preserved | ARCH §6 (DB contract) — REQ-BRAINY-ENG-03/04; `db/queries.ts:28-193`, `src/store.ts:18-55` |
| **Bootstrap & indexes** (`db/queries.ts:bootstrapIndexes`, `scripts/bootstrap.ts`) | `createIndexIfNotExists` async (kind:accepted) con poll hasta `index_not_found` clear; vectores `note_embedding`/`memory_embedding` 1536 cosine tenant `project`, textos `Note.content`/`Memory.content` tenant `project`, uniqueEquality `Note.id`, `Memory.memoryId`, `Project.name`, etc.; compat indexes intactos | ARCH §6; CONTRACT §0 async fact; `db/queries.ts:127-193` |
| **Embedder** (`src/embed.ts`) | Determinístico 1536-dim (antes 384) — `text-embedding-3-small` remoto configurable vía Helix providers o hash bag-of-words fallback; `Math.fround` round-trip 1e-6 para verify; `writeBatch forEachParam empty` safe (CONTRACT §0) | ARCH §6; `src/embed.ts:16`, `src/store.ts:embeddingsEqual` |
| **Store — Brainy** (`src/store.ts` HelixStore) | `saveNote`, `listNotes`, `getNoteById`, `moveNote`, `distillNote`, `searchByVector/Text` (scoped `where project` antes de `vectorSearchWith/textSearchWith`), `graphSearch` (traversal BELONGS_TO/REFERENCES/RELATES_TO depth≤max_depth), `forgetNote`, health; alias compat `remember`/`saveMemory` preservado; `setProperty embedding` refresca vector index (probe4 verdict A) | ARCH §6-§7; `src/store.ts:623-1233`, `db/queries.ts:243-301` |
| **Hybrid search** (`src/search.ts`) | `bm25Search` degradado + `hybridSearch` RRF `Σ 1/(60+rank)` sobre vector+grafo+BM25, sorted desc, tie-break `decayedImportance→recallBoost→createdAt→memoryId`; TTL `filterExpired` pre-return + `signals` | ARCH §7; `src/search.ts:1-264` |
| **REST Brainy v1** (`src/server.ts`) | `POST /v1/notes 201`, `GET /v1/notes/:id 200`, `POST /v1/search 200 {results:[{note,score,graph_path,related_memories}],signals}`, `POST /v1/memory 201 compat`, `GET /v1/context/:project 200`, `POST /v1/link 201`; legacy `/memory/*` alias 1 versión con `X-Deprecated` header; bearer `BRAINY_SECRET` alias `AGENT_MEMORY_SECRET`; localhost open when unset; `EMBED_DIM 1536` | ARCH §7; `src/server.ts:26-31,136-560` |
| **MCP Brainy** (`src/mcp.ts`) | Stdio `McpServer(name=brainy)` tools `brainy_search` (híbrida), `brainy_capture`, `brainy_link`, `brainy_reality_check` + compat alias `memory_*` (11 tools); `handle(_meta)` bearer via `_meta.authorization`; stdout = protocol only, diagnostics stderr `oneLine` + heal lines; `handle` nunca crashea en Helix down | ARCH §8; `src/mcp.ts:162-535`, `src/mcp.ts:538-545` |
| **CLI Brainy** (`bin/brainy.mjs`) | `brainy add "text" --title --tags --project`, `brainy move <id> --to <para>`, `brainy distill <id> [--provider]`, `brainy context --project`, `brainy export --format markdown --out ./vault`; wraps `POST /v1/*` con `BRAINY_PORT=3111`/`BRAINY_URL`/`HELIX_URL`; symlink `agent-memory→brainy` + deprecation warning stderr; quartet never-kill preserved | ARCH §1; `bin/agent-memory.mjs`→`bin/brainy.mjs`; `src/server.ts:653-661` never-kill hint |
| **Compat migration** (`brainy.compat.agentmemory`, `scripts/import-transcript.ts`) | Lee SQLite legacy → HelixDB mapeo PRD §7.2 `memories.statement→Memory.statement`, `type→memory_type`, `objects.name→Resource.name`, `contexts.name→Context.name`, `links.about→ABOUT`, `links.context→APPLIES_TO`; `POST /v1/memory` payload legacy; idempotente con `dedupKey` first-wins | ARCH §9; `src/compat/agentmemory.ts`, `scripts/import-transcript.ts` |
| Arg parser (`bin/brainy.mjs`) | Fail-closed `subcommand+flags` estilo `src/server.ts:479-481`; unknown → usage stderr exit 2 | CLI §1 (REQ-BRAINY-ENG-01,12; NFR invariants) |
| Slot derivation | Pure `N → quartet + instance name` no I/O; env projection only | Interfaces §2; quartet A1 |
| Spawn manager | `start` pre-flight quartet occupancy (refuse+NEVER-kill hint exit 1) → `helix start dev/slotN` + `npx tsx src/server.ts` never `--persist`, readiness Helix `/healthz`+`/v1/livez` 30s, record state | `start`/`stop` §1; REQ-P4-OPS-02/03 |
| State file | `<parent-of-data-dir>/state/slot-<N>.json` con `slot,pids{rest,helix},helixInstance,dataDir,startedAt,cliVersion`; nunca secret/PII/content | Interfaces §4 |
| Doctor checker | C1-helix-healthz, C2-rest-health, C3-ports, C4-secret-presence(flag only), C5-storage; una línea por check + `VERDICT:` terminal; read-only | Interfaces §5 |
| Migrator | Dry-run default; `--migrate --apply --yes` pre-flight→backup→copy→verify; MinIO volume nunca destruido | Data Flow §4 |
| Todo node (`db/queries.ts` + `src/store.ts`) | `Todo{todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId?}`; 4 indexes `todo_id/title/project/status` → total ≥16 con Brainy+legacy (8+4+≥4 Brainy) | ARCH §6 Todo; `db/queries.ts:32-34,727-862` |
| REST todos/frontier | `POST /memory/todos 201`, `GET /memory/todos` filtered+sorted, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `GET /frontier`; alias `/agentmemory/todos*`; BM25+fallback + `filterTodos` priority | ARCH §7 Todo |
| MCP todos | `memory_todo_create/list/get/update/delete`, `memory_frontier` vía `registerTools` + `handle(_meta)` | ARCH §8 Todo |
| Hook capture | `hooks/capture.mjs` auto-extract ≤3 todos + ≤3 capture compat; bodies≥400 heurística TODO/FIXME; fire-and-forget 1.5s, exit 0, never logs prompt | ARCH §10 |

`status` es modo read-only separado de `doctor` — exits 0/1/2 vs 0-5 (INV-009).

## Interfaces

### §1 CLI surface — Brainy

| Subcommand | Flags / Args | Side effects | Exit | Notes |
|---|---|---|---|---|
| `brainy add` | `"text" --title T --tags a,b --project P` | `POST /v1/notes` → `Note` + `BELONGS_TO` | 0/1/2 | fail-closed zod 1..200k |
| `brainy move` | `<noteId> --to <project|area|resource|archive>:<name>` | rewrite `BELONGS_TO` edge | 0/1/2 | 404 if not found |
| `brainy distill` | `<noteId> [--provider openai|gemini|anthropic]` | `SUPERSEDES` version | 0/1/2 | LLM via `BRAINY_LLM_PROVIDER` |
| `brainy context` | `--project P [--limit N]` | `GET /v1/context/:project` | 0/1/2 | graph_path ≤depth2 |
| `brainy export` | `--format markdown --out PATH --project P` | write vault `.md` + frontmatter `[[links]]` | 0/1/2 | Obsidian compat |
| `brainy search` | `"query" --project P --limit N --include-graph` | `POST /v1/search` | 0/1/2 | RRF output |
| Legacy | `agent-memory ...` (symlink) | proxy to `brainy` + `WARN deprecated` stderr | 0/1/2 | alias 1 versión (REQ-01) |
| `start` | `--slot N --data-dir PATH` | spawn Helix+server, readiness gate, state | 0/1/2 | never-kill preflight |
| `stop` | `--slot N` | SIGTERM→SIGKILL tracked PIDs + `helix stop`, remove state | 0/1/2 | idempotent |
| `status` | `--slot N` | none (probes) | 0/1/2 | read-only |
| `doctor` | `--slot N --migrate --apply --yes --backup-dir` | checks; migrate backup→copy→verify | 0-5 | §5 verdicts |

Shared `--help` → usage exit 0; `--apply` sin `--migrate` o `--migrate --apply` sin `--yes` → exit 2.

### §2 Slot → port derivation (REQ-P4-OPS-06, A1)

| Slot | REST `R(N)=3111+3(N-1)` | Helix `H(N)=6969+(N-1)` | R+1 | R+2 | Instance |
|---|---|---|---|---|---|
| 1 | `3111` | `6969` | `3112` | `3113` | `dev` (brainy) |
| 2 | `3114` | `6970` | `3115` | `3116` | `slot2` |
| N | `3111+3(N-1)` | `6969+(N-1)` | R+1 | R+2 | `slotN` |

Inv: `N≥1` int else 2; `N≥2` quartet ∩ `{3111,3112,3113,6969}=∅`; reservas nunca bound/signal.

### §3 Derived env — Brainy (RECONCILED)

| Variable | Slot N | Default slot 1 | Legacy alias (1 versión) |
|---|---|---|---|
| `BRAINY_PORT` | `R(N)` | `3111` | `AGENT_MEMORY_PORT` fallback |
| `BRAINY_URL` | `http://127.0.0.1:R(N)` | `http://127.0.0.1:3111` | `AGENT_MEMORY_URL` fallback |
| `HELIX_URL` | `http://127.0.0.1:H(N)` | `http://localhost:6969` | — |
| `HELIX_DATA_DIR` | resolved | unset until migrate/fallback | — |
| `BRAINY_DATA_DIR` | `--data-dir` > env > `~/.local/share/brainy/<slot>/` | `…/1/` | `AGENT_MEMORY_DATA_DIR` fallback |
| `BRAINY_SECRET` | inherited passthrough never printed | unset=open | `AGENT_MEMORY_SECRET` fallback + warning |
| `BRAINY_TTL_DAYS` | TTL Note/Archive (default 365) | `365` | `AGENT_MEMORY_TTL_DAYS` fallback |
| `BRAINY_EMBED_DIM` | `1536` (default) / `384` fallback | `1536` | — |
| `BRAINY_LLM_PROVIDER` | `openai|gemini|anthropic` | `openai` | — |
| `BRAINY_HOST` | `127.0.0.1` | `127.0.0.1` | `AGENT_MEMORY_HOST` fallback |

Every `AGENT_MEMORY_*` read emits single-line `WARN deprecated use BRAINY_*` stderr (REQ-01).

### §4 State file (REQ-P4-OPS-03/07)

Path `<parent-of-data-dir>/state/slot-<N>.json` (default `~/.local/share/brainy/state/slot-<N>.json` para Brainy; legacy `agent-memory/state` alias migrado). Sibling of data dir, never inside `HELIX_DATA_DIR`. Fields `slot, pids{rest,helix}, helixInstance, dataDir, startedAt, cliVersion`. Never secret/content/PII.

### §5 Doctor verdict / exit (canonical RUNBOOK §4a / RUN-REQ-01/02)

| Exit | Verdict | Trigger | Prec |
|------|---------|---------|------|
| 0 | `healthy` | all PASS (C2 may be INFO not-running) | 5th |
| 1 | `doctor-check-failed` | C5 FAIL; internal error | 4th |
| 2 | usage | bad/unknown flags | — |
| 3 | `upstream-holds-port` | C3 foreign PID quartet + NEVER kill hint `BRAINY_PORT=3151` | 3rd |
| 4 | `helix-down` | C1 healthz refused/non-200; C2 500 | 2nd |
| 5 | `secret-missing` | C4 empty `BRAINY_SECRET`; C2 401 | 1st wins |

Checks C1 helix-healthz, C2 rest-health (only if listener verified slot-owned), C3 ports, C4 secret-presence flag only, C5 storage-data-dir. Precedence `5>4>3>1>0`.

### §6 DB contract — Brainy + legacy + Todos

```
Node Note { noteId uniqueEquality, title text tenant project, content text tenant project,
            project equality, sessionId, embedding vector 1536 cosine tenant project,
            createdAt dateTime, updatedAt dateTime, status equality, paraType }
Node Project { name uniqueEquality, description, deadline }
Node Area { name uniqueEquality, description }
Node Resource { name uniqueEquality, category }
Node Archive { name uniqueEquality, archivedAt dateTime }
Node Memory { memoryId uniqueEquality, content text tenant project, project equality, sessionId equality,
              origin, importance f64, createdAt dateTime, embedding vector 1536, dedupKey uniqueEquality, memory_type }
Node Concept { name uniqueEquality, project }
Node Agent { name uniqueEquality, instance_id }
Node Context { name uniqueEquality, type }
Node Session { sessionId uniqueEquality, project equality, startedAt, updatedAt }
Node Todo { todoId uniqueEquality, project equality, status equality, title text tenant project,
            description, priority, sessionId, createdAt, updatedAt, parentId }
Edges: BELONGS_TO, REFERENCES, SUPERSEDES, ABOUT, APPLIES_TO, CAPTURED_BY, RELATES_TO, HAS_CONCEPT
Indexes total: 8 legacy + 4 Todo + ≥6 Brainy (Note id/project/embedding/content/status, Project name, Area name, Resource name, Archive name, paraType) = ≥18
Query exports: bootstrapIndexes, saveNote, listNotes, getNoteById, moveNote, distillNote, searchByVector, searchByText, graphSearch, graphSearchNotes, forgetNote, healthCount,
              saveMemory, listSessions, sessionMemories, searchByVector/Text, graphSearch, forgetMemory, findMemoryByDedupKey, listExpired, listProjects, getMemoryById, memoryConcepts, linkMemoryConcepts, updateMemoryContent, migrateAgentMemoryRow,
              saveTodo, listTodos, getTodoById, updateTodo, searchTodosByText, deleteTodo
```

Parametric invariants (CONTRACT §0, preserved): `writeBatch().forEachParam(empty)` commits fine; `NodeRef.var("outer")` inside forEach usable; `varAsIf varEmpty/varNotEmpty` both directions; `createIndexIfNotExists` async poll 30s; scoped `where project` before `textSearchWith/vectorSearchWith` + `$score`/`$distance` projection; `embedding` never in search payload; `toQueryRequest(params,values)` → `client.query(req).send()`; `PropertyInput.value` (no `.val`); `IndexSpec.nodeVector(label,prop,dim,metric,tenant)`.

### §7 REST contract — Brainy v1 + Todos + legacy

**Brainy v1:**

| Method | Route | Body / query | Success | Bearer | Notes |
|---|---|---|---|---|---|
| POST | `/v1/notes` | `{title 1..500, content 1..200k, tags? string[64] 1..200, project? 1..200}` strict | 201 `{id,project,para,deduped}` | except `livez` | derive embed 1536, auto BELONGS_TO |
| GET | `/v1/notes/:id` | `?project=` | 200 `{note,para,supersedes[],supersededBy}` | yes | 404 |
| POST | `/v1/notes/:id/move` | `{to: project\|area\|resource\|archive, name: 1..500, project?}` strict | 200 `{id, para:{label,name}}` | yes | drop+add `BELONGS_TO` via `HelixStore.moveNote`; 404 note/target; 400 tenant |
| POST | `/v1/search` | `{query 1..10k, project?, include_graph? bool, max_depth? 1..3 default2, vector_top_k? 1..20 default10, limit?1..100 default10}` | 200 `{mode:hybrid, results:[{note,score,graph_path,related_memories}],signals}` | yes | RRF 60, TTL filter, never 500 |
| POST | `/v1/memory` | legacy `{statement|content, concepts?, project?, sessionId?, memory_type?}` | 201 compat | yes | alias statement→content |
| GET | `/v1/context/:project` | `?project=&limit=1..100` | 200 `{project, notes[],memories[],graph,signals}` | yes | traversal depth2 |
| POST | `/v1/link` | `{fromId,toId,type:REFERENCES|BELONGS_TO|RELATES_TO, project?}` | 201 `{edge}` | yes | strict enum |

Legacy alias 1 versión: `POST /memory/remember|search|smart-search` → `POST /v1/notes|search|search` 308 with `X-Deprecated: use /v1/*`; `GET /memory/health|livez` preserved. Error shape `400 invalid_request` with zod details, `415 unsupported_media_type`, `413 payload_too_large` (1 MiB), `401 unauthorized` with `www-authenticate: Bearer`.

**Todos (preserved):**

| Method | Route | Body / query | Success | Notes |
|---|---|---|---|---|
| POST | `/memory/todos` | `{title 1..500, description 0..5000?, priority, status, project?, sessionId?, parentId?}` | 201 `{todo}` | alias `/agentmemory/todos*` |
| GET | `/memory/todos` | `?project=&limit=&status=&priority=&search=&frontier=&parentId=` | 200 `{todos}` | BM25+fallback |
| GET | `/memory/todos/:id` | — | 200 `{todo}` | 404 |
| PATCH | `/memory/todos/:id` | `{title?,description?,priority?,status?,parentId?:string\|null}` | 200 `{todo}` | null clears |
| DELETE | `/memory/todos/:id` | — | 200 `{deleted:true}` | 404 |
| GET | `/memory/frontier` | `?project=&limit=` | 200 `{frontier,count}` | pending∪active |
| GET | `/memory/livez` | — | 200 `{status:ok}` | bearer-exempt |
| GET | `/memory/health` | `?project=` | 200 `{status:ok,counts:{memories,sessions}}` | bearer if secret |

### §8 MCP contract — Brainy + Todos + legacy

Stdio `McpServer(name=brainy, version:1.0.0)` via `@modelcontextprotocol/sdk`, `registerTools(mcp, store, secret)` + `handle(name,_meta,op)` auth barrier (`_meta.authorization Bearer <BRAINY_SECRET>` alias `AGENT_MEMORY_SECRET`, mismatch→`McpError InvalidRequest unauthorized`). Tools:

| Tool | Input | Ann. | Store call |
|---|---|---|---|
| `brainy_search` | `{query 1..10k, project?, limit?, include_graph? bool, max_depth?}` | ro:true idem:true | `hybridSearch({query,project,limit})` + graph branch when include_graph |
| `brainy_capture` | `{content 1..200k, title? 1..500, project?, tags?}` | ro:false | `saveNote` (embed+classify) |
| `brainy_link` | `{fromId,toId,type:REFERENCES|BELONGS_TO|RELATES_TO}` | ro:false | `linkNotes` |
| `brainy_reality_check` | `{project?}` | ro:true | `context + rules` (active memories) |
| Alias `memory_search` | `{query,project?,limit?}` | ro:true | `bm25Search` |
| Alias `memory_smart_search` | `{query,concepts?,project?,limit?}` | ro:true | `hybridSearch` |
| Alias `memory_save` | `{content,concepts?,project?,sessionId?,origin?,importance?}` | ro:false | `remember` |
| Alias `memory_sessions`, `memory_session_memories`, `memory_forget`, `memory_health`, `memory_recap|handoff|lesson|delete` | per schema | mixed | preserved 1:1 |
| `memory_todo_create/list/get/update/delete`, `memory_frontier` | per Todo schema (title required, parentId null clears) | mixed | `createTodo/listTodos/...` |

Stdout = MCP protocol only; diagnostics on stderr (`[brainy mcp] name: logSafeNote`), heal lines `heal survivor=<id> ...` oneLine CWE-117.

### §9 Plugin hook contracts

`plugins/opencode/plugins/brainy.ts` (legacy `agent-memory.ts` alias): 6 todo tools + 4 brainy tools + 11 memory tools = 21 total under namespace `memory`+`brainy` (codemode). `call()` bearer `Authorization: Bearer <BRAINY_SECRET>`. `recallCache.clear()` on mutate. Captured ops: `prompt→brainy_reality_check`, `context→brainy_search`, `compaction→brainy distill`, `tool.execute.before/after` capture.

`hooks/capture.mjs`: supports 7 events `SessionStart, PostToolUse, Stop, PostToolUseFailure, PreCompact, SessionEnd, UserPromptSubmit` allowlist; `PostToolUse` with edit-like tool → `file edited via <tool>[: <basename>]` (`BRAINY_CAPTURE_PATHS=basename` opt-in); always exit 0, stdin JSON, `BRAINY_URL` default `http://127.0.0.1:3111`, no payload logging.

## Data Flow

1. **Brainy Capture (REQ-05):** `brainy add` or `POST /v1/notes` or `brainy_capture` → `zod` validate → `normalize(project,content)` → `dedupKey sha256` → `findMemoryByDedupKey` lock → if hit return existing else `embed 1536` → `saveNote forEachParam concepts=tags|extractConcepts` → upsert `Project/Area/Resource` if not exist → `BELONGS_TO` edge + `CAPTURED_BY→Agent` + `RELATES_TO` candidates `>0.85` via `vectorSearch` → 201 `{id,para}`.
2. **Organize (REQ-06):** classifier `cosine(noteEmbedding, paraDescriptionEmbeddings)` + keyword fallback → chosen `PARA` → `moveNote` drops old `BELONGS_TO` adds new; `RELATES_TO` batch computed post-insert.
3. **Distill (REQ-07):** `brainy distill <id>` → `getNoteById` → LLM prompt `summarize to 1 line` → `embed(summary)` → `saveNote(summary)` + `addE SUPERSEDES new→old` → return `{id,supersedes}`.
4. **Express (REQ-08):** `brainy context`/`GET /v1/context/:project` → anchor `Project/Area` → `graphSearchNotes(max_depth)` (BELONGS_TO→Notes, REFERENCES transitive) → project `Note` rows + `related_memories` via `linked Memory` traversal; `brainy export` → iterate notes → write `vault/<Project>/<title>.md` with `---\nproject: X\ntags: [..]\n---\n` + `[[REFERENCES]]`.
5. **Hybrid search (REQ-09):** `POST /v1/search` → run `searchByVector(1536, project, vector_top_k)` + `searchByText(project, query)` + `graphSearch(project, concepts)` (+ PARA graph when `include_graph`) in parallel, catch per-source → RRF fuse `score=Σ1/(60+rank)` → `compareFusedAt(nowMs)` tie-break `boostedDecayedImportance→createdAt→memoryId` → `filterExpired` → attach `signals` per row + envelope → 200 (never 500).
6. **Compat migration (REQ-11):** `brainy.compat.agentmemory` → open SQLite `agent_memory.db` → iterate `memories/objects/contexts/links` → map via `migrateAgentMemoryRow` → `saveMemory` batch 100 with `dedupKey` → verify `healthCount` == source count → `POST /v1/memory` legacy alias.
7. **Ops start/stop/doctor** (preserved v2): §1-§4 Data Flow 1-4 v2 unchanged — derived env now `BRAINY_*` with alias fallback; readiness probes `/v1/livez` added beside `/memory/livez`.
8. **Todos lifecycle** (preserved v2): `POST /memory/todos` validate parent→`saveTodo`→return | `GET ...?search=` `searchTodosByText`+fallback→`filterTodos`→slice; `frontier` = pending∪active priorityRank→updatedAt→todoId.

## Data Model Diagram

```
[Agent] --CAPTURED_BY--> [Note] --BELONGS_TO--> [Project|Area|Resource|Archive]
                           |--REFERENCES--> [Note]
                           |--RELATES_TO(auto >0.85)--> [Note]
                           |--SUPERSEDES--> [Note|Memory] (versioning)
                           |--HAS_CONCEPT--> [Concept] (legacy graph)
[Memory] --BELONGS_TO--> [Session] --belongs to project
[Memory] --HAS_CONCEPT--> [Concept]
[Memory] --SUPERSEDES--> [Memory]
[Memory] --ABOUT--> [Resource|Project]
[Memory] --APPLIES_TO--> [Context]
[Todo] (no edges, app-side parentId filter)
Indexes ≥18: uniqueEquality Note.id/Memory.memoryId/Concept.name/Project.name/Area.name/Resource.name/Archive.name/Session.sessionId/Todo.todoId;
          equality Memory.project/Session.project/Session.sessionId/Todo.project/Todo.status/Note.project/Note.status;
          vector Note.embedding 1536 cosine tenant project / Memory.embedding 1536;
          text Note.content/Memory.content/Todo.title tenant project
```

## Invariants

- INV-001 (Brainy): One breaking rename — `brainy` canonical, alias `agent-memory` 1 versión con deprecation warning cada invocación en stderr; después corte limpio. Env lectura `BRAINY_* ?? AGENT_MEMORY_*` (alias fallback) — escritura siempre `BRAINY_*`.
- INV-002: Frozen surfaces — `src/**`, `db/**`, `hooks/**`, `plugins/**`, `helix.toml [local.dev]` (port 6969, storage=disk) nunca editados fuera de SPEC lane; additive `[local.slotN]` + `brainy` indexes = config, no source edit (same as v2). Post-migration `helix.toml project=brainy` is the ONLY frozen-file exception via SPEC.
- INV-003: Never-kill — signal solo PIDs registrados en state file; prohibido `fuser/helix prune/docker rm/volume rm/--persist` sobre 3111/3112/3113 (NFR-A, `src/server.ts:653-661`). Brainy lane no introduce nuevos kill paths.
- INV-004: No secret value en output/state/logs — flags `bearer: armed|unset` only; `BRAINY_SECRET` alias `AGENT_MEMORY_SECRET` same posture (NFR-B/F Ley 172-13). `grep -r BRAINY_SECRET` no match value.
- INV-005: Defaults intactos — REST `3111`, Helix `6969`, hooks/plugins `3111`; Brainy slots derivación, no cambio default (NFR-C).
- INV-006: Doctor verdicts closed `0 healthy /1 doctor-check-failed /2 usage /3 upstream-holds-port /4 helix-down /5 secret-missing` precedence `5>4>3>1>0`, exact one `VERDICT:` line.
- INV-007: State file fuera de `HELIX_DATA_DIR`; Helix owns data dir exclusivo (REQ-07).
- INV-008: Migration fail-closed — dry-run default, backup verificado antes de copy, MinIO volume nunca destruido; SQLite→HelixDB migration idempotente con dedup.
- INV-009: `status` ≠ `doctor` (0/1/2 vs 0-5).
- INV-010: Derivation only via env/flags — zero `src/**` edit para Brainy alias; quartet never intersects `{3111,3112,3113,6969}` for N≥2; reserved never bound.
- INV-011: Todos naming `todos` forever, never `actions`; Brainy PARA labels `Project/Area/Resource/Archive` capitalizados, nunca lowercase `project`.
- INV-012: App-side parentId for Todo; Brainy `BELONGS_TO` re-write is atomic drop+add bajo lock `noteId`.
- INV-013 (CONTRACT §0 preserved): `writeBatch forEachParam(empty)` commits; `varAsIf` both branches; `createIndexIfNotExists` async poll; scoped search `where project` before `vectorSearchWith/textSearchWith`; `$score/$distance` projection; `embedding` never in search payload; `toQueryRequest` + `client.query().send()`.
- INV-014: `EMBED_DIM 1536` canonical; `BRAINY_EMBED_DIM=384` fallback solo para lectura legacy 1 versión; new writes siempre 1536; `setProperty embedding` refreshes index (probe4 A).
- INV-015: Hybrid RRF constant `60` frozen; hybrid never 500 — degraded `signals` only.
- INV-016: Single-writer (§3) holds — dedup `contentHash(project+normalize)` + per-key `survivorTails` FIFO lock; cross-process writers remain out-of-contract until P4.3 (residual ledger).

### Frozen surfaces detail

`src/**` · `db/**` · `hooks/**` · `plugins/**` · `helix.toml [local.dev]` · manifests · `package-lock.json`. Brainy lane exception: `package.json:2 name→brainy + bin brainy`, `helix.toml:2 project→brainy`, `bin/brainy.mjs` creation, `docs/CONTRACT.md` Brainy v1, `ARCHITECTURE.md` this file. Todos still no new Helix labels beyond `Todo`; Brainy adds `Note/Project/Area/Resource/Archive` as new labels via SPEC.

## Non-Functional Requirements

- **Performance — hybrid p95 <10ms @10k:** vector ANN + scoped where + RRF in `src/search.ts`; `limit≤100` cap, over-fetch `max(limit*4,100)≤400` for fallback; `queryVector 1536` per-request embed cached heurística; hooks `POST /v1/notes` fire-and-forget 1.5s. Measured `scripts/eval.ts` → `docs/benchmarks/SCORECARD.md` + `verify` p95 harness; gate FAIL if >10ms.
- **Performance — ops:** `start` readiness 30s bound (`scripts/verify-env.ts:55`); `status`/`doctor` bounded probes; migration bound by backup verify (REQ-02/08).
- **Availability:** `stop` idempotente via state file; `status`/`doctor` no mutan estado; slot N≥2 deja slot 1 serving; Brainy alias 1 versión no rompe `agent-memory` clientes existentes (drop-in `BRAINY_*`).
- **Security (Ley 172-13):** output allowlist ports/booleans/counts/status/`$HOME`-collapsed paths; secret presence only; `Note.content` PII-purpose `segundo cerebro` TTL `BRAINY_TTL_DAYS` 365 + `purge/forgetNote`; mask/tokenize en logs/prompts/exports; DPIA if high-risk; breach 72h; no freelance fixes — severity+location+owner to `barrera/subero`.
- **Storage:** `helix.toml storage=disk` MinIO/S3 ACID; data never destroys volume; re-embeddings batched `forEachParam` with `setProperty`.

## Traceability (Brainy)

| SPEC REQ | ARCH section | Component | Evidence path |
|---|---|---|---|
| REQ-01 alias 1v | §1 CLI Legacy, §3 env alias | `bin/brainy.mjs` | `package.json:2`, `helix.toml:2`, `bin/brainy.mjs` |
| REQ-02 cleanup | INV-001 | docs sweep | `grep` 0 agentmemory/iii |
| REQ-03 schema | §6 DB contract, diagram | `db/queries.ts` LABELS/EDGES | `db/queries.ts:28-50` + HELIXQL |
| REQ-04 1536 indexes | §6 bootstrap, INV-014 | bootstrapIndexes | `db/queries.ts:127-193` + probe index_not_found |
| REQ-05 capture | Data Flow 1, §7 REST, §8 MCP | HelixStore.saveNote + server | `src/store.ts:691`, `src/server.ts: POST /v1/notes` |
| REQ-06 organize | Data Flow 2 | classifier + moveNote | `src/store.ts classify` + `db/queries.ts moveNote` |
| REQ-07 distill | Data Flow 3 | distillNote SUPERSEDES | `db/queries.ts distillNote` + LLM env |
| REQ-08 express | Data Flow 4, §7 | context/export | `src/server.ts GET /v1/context` |
| REQ-09 hybrid RRF | Data Flow 5, §7, NFR perf | hybridSearch | `src/search.ts:186-264` + SCORECARD p95 |
| REQ-10 MCP | §8 | brainy_search/capture/link/reality_check | `src/mcp.ts:162-535` |
| REQ-11 migration | Data Flow 6 | brainy.compat.agentmemory | `src/compat/agentmemory.ts` + import-transcript |
| REQ-12 REST | §7 | /v1/* + alias | `src/server.ts` route table |
| NFR-01 p95 | NFR Perf | search | `scripts/eval.ts` |
| NFR-02 ACID | NFR Storage | bootstrap async | `helix.toml`, `scripts/bootstrap.ts` |
| NFR-03 384→1536 | INV-014, §6 | migrate-embeddings | `src/embed.ts`, probe4 |
| NFR-04 secrets | INV-004, NFR Security | auth guard | `src/server.ts` bearer, `src/mcp.ts handle` |

Prior foundation traceability preserved: `REQ-P4-OPS-*`→§1-5+§7 Todo, `REQ-TODO-*`→§6-10 — see v2 git history.
