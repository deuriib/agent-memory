# Spec: Todos — follow-ups para agentes

**ID:** SPEC-020-todos
**Owner:** general(vasquez) — Engineering Owner (R1)
**Domains-Touched:** [engineering] (R1, owner)
**Brief Reference:** docs/briefs/BRIEF-todos.md (approved 2026-09-25) + docs/briefs/OKR-todos.md
**Status:** draft
**Priority:** P2 — bounded-initiative (well-scoped, 3 vías de creación, single-process)
**Execution_Mode:** subagents (frozen at frame-intent; trivial <15 lines goes by CEO fast-path checkpoint-only, outside methodology)
**Own:** engineering

**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-todos.md#OKR-todos.md / HARD:subagents+zero-new-deps,src/db/hooks/plugins only, never kill upstream, BRIEF frozen / GATE:none-yet / DOMAINS:R1,R2,R8`

## 1. Context

Agents surface follow-ups during sessions — decisions to revisit, files to inspect, tasks blocked on input — que hoy se pierden entre sesiones. La imagen de referencia exige superficie "No todos tracked yet" con flujo `pending → active → done/blocked`, frontier de lo desbloqueado y listo, búsqueda, y 3 vías de creación. No existía entidad Todo; upstream llama esto Actions pero este lane fija nombre `todos` everywhere, nunca `actions`. BRIEF-todos §Scope ya lista el contrato single-process sin grafo de dependencias, sin leases, sin signals — YAGNI recorta `requires/unlocks/gated_by/conflicts_with`. Este spec traduce ese intent a contratos testeables para `db/queries.ts` + `src/store.ts` + `src/server.ts` + `src/mcp.ts` + `plugins/opencode/plugins/agent-memory.ts` + `hooks/capture.mjs`, con 0 new deps y frozen BRIEF.

Grounding: real surfaces read this lane — `db/queries.ts:32-34,127-193` (LABELS.Todo + 12-index bootstrap), `src/store.ts:289-351,1313-1472` (Todo types + HelixStore impl), `src/server.ts:136-177,268-283,470-560` (schemas + alias + routes), `src/mcp.ts:113-147,411-536` (6 tools), `hooks/capture.mjs:209-286` (extractTodos), `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` (6 tools, all verified in repo).

## 2. Requirements

Functional — cada REQ tiene su AC y su traza a artefacto + evidencia (ver §3 + §7):

- **REQ-TODO-01 — Todo node + 12 indexes (DB contract):** Nodo Helix `Todo {todoId:string (unique, `todo_${uuid}`), title:string 1..500 trim, description:string 0..5000, priority:low|medium|high (default medium), status:pending|active|done|blocked (default pending), project:string, sessionId:string, createdAt:dateTime iso, updatedAt:dateTime iso, parentId?:string 0..200 (absent = "" stored, read as undefined)}`. `db/queries.ts` exporta `LABELS.Todo="Todo"`, `bootstrapIndexes()` crea **12 indexes** = 8 existentes (memory/session/concept) + 4 Todo: `todo_id nodeUniqueEquality(Todo, todoId)`, `todo_project nodeEquality(Todo, project)`, `todo_status nodeEquality(Todo, status)`, `todo_title nodeText(Todo, title, project)` con tenant `project`. Proyección `todoRowProjection` incluye `$id→id + los 9 campos` incl. `parentId`. `saveTodo`, `listTodos`, `getTodoById`, `updateTodo`, `searchTodosByText`, `deleteTodo` usan exactamente esos labels/params/indexes; no DDL adicional.

- **REQ-TODO-02 — REST CRUD + frontier + alias (HTTP contract):** Bajo `/memory` (bearer guard idéntico a otras rutas `/memory/*`, solo `livez` exenta; 401 + `www-authenticate: Bearer` si mismatch):
  | Method | Route | Body / query | Success | Errors |
  |---|---|---|---|---|
  | POST | `/memory/todos` | `{title, description?, priority?, status?, project?, sessionId?, parentId?}` strict | 201 `{todo}` | 400 zod (unknown field, empty title, bad enum), 400 `parent todo not found: <id>` (fail-closed, parent lookup via `getTodo`), 415/413/400 body |
  | GET | `/memory/todos` | `?project=&limit=1..100&status=&priority=&search=&frontier=&parentId=` | 200 `{todos:[…]}` | 400 bad query |
  | GET | `/memory/todos/:id` | — | 200 `{todo}` | 404 `{error:not_found}`, 400 bad encoding |
  | PATCH | `/memory/todos/:id` | `{title?, description?, priority?, status?, parentId?: string\|null}` strict | 200 `{todo}` | 404, 400 `parent todo not found` / `cannot be its own parent` / `title is required` |
  | DELETE | `/memory/todos/:id` | — | 200 `{deleted:true}` | 404 |
  | GET | `/memory/frontier` | `?project=&limit=1..100` | 200 `{frontier:[…], count}` | 400 |
  Alias: todo request con path `/agentmemory/todos*` o `/agentmemory/frontier*` es reescrito a `/memory/*` antes del guard (compat screenshot `POST http://localhost:3111/agentmemory/todos`). Defaults: `project="default"`, `limit=10`, `sessionId=""` si ausente. `PATCH parentId:null` limpia (stores "" → read undefined). Todo update re-valida parent como en create.

- **REQ-TODO-03 — Search & priority ordering (read contract):** `GET /memory/todos?search=<q>` activa rama BM25: `searchTodosByText(q, project, k=limit)` (`nodeText Todo.title` con tenant `project`) → `filterTodos(hits, input)`; si esa rama devuelve 0 hits, fallback substring `title`/`description` case-insensitive sobre `rawListTodos(project, 200)`. Rama sin `search` va directo a `rawListTodos(project, max(limit*4,100))` luego `filterTodos` y `slice(0,limit)`. `filterTodos` aplica en orden: `status`, `priority`, `parentId` (exact `parentId ?? ""`), `frontier` (solo pending|active), luego **sort** `priorityRank(high=3,medium=2,low=1)` desc → `updatedAt` desc (localeCompare) → `todoId` asc. Mismo sort para `/memory/frontier` (que es `listTodos({frontier:true})`). `limit` bounds 1..100 vía zod coerce; sin `search` se over-fetch 4× para poder filtrar tras paginar app-side.

- **REQ-TODO-04 — parentId opcional con validación 400/clear:** `parentId` es opcional en create y patch; `create` con `parentId !== ""` hace `getTodo(parentId)` → si undefined throw `parent todo not found: ${parentId}` que el route convierte a `HttpError 400 invalid_request`; `update` con `patch.parentId === null` → `parentId=""` (clear); con `string` non-empty → trim 0..200, si `=== todoId` throw `todo cannot be its own parent` → 400, si no existe → 400 `parent todo not found`; ausente mantiene `existing.parentId`. `GET /memory/todos?parentId=` filtra exact-match (`t.parentId ?? "" === input.parentId`). MCP y plugin llevan mismo contrato (ver REQ-05/07). `parentId=self` 400, `parentId=notfound` 400, `PATCH {parentId:null}` limpia — cubierto por KR-2.1.

- **REQ-TODO-05 — MCP 6 tools (stdio contract, `src/mcp.ts`):** Sobre el mismo `MemoryStore` y misma regla bearer ` _meta.authorization = "Bearer <secret>"` vía `isMetaAuthorized`/`handle()` (unauth → `McpError InvalidRequest`; throw → isError + logSafeNote). Herramientas bajo `registerTools`:
  - `memory_todo_create` (input: title 1..500 required, description 0..5000, priority/status enums, project/sessionId/parentId optional; parent validate → isError `{error: "parent todo not found…" | "title is required"}` else `ok {todo}`)
  - `memory_todo_list` (project, limit 1..100, status, priority, search 0..500, frontier bool, parentId)
  - `memory_todo_get` (todoId)
  - `memory_todo_update` (todoId required + patch fields title/description/priority/status/parentId `string|null`; requiere ≥1 campo; parent validate isError con mismos mensajes)
  - `memory_todo_delete` (todoId)
  - `memory_frontier` (project, limit)
  Todas `readOnlyHint`/`destructiveHint` según mutación; `memory_todo_list/get/frontier` idempotent. Nombre `todos` everywhere, nunca `actions`. Stdout lleva solo protocolo MCP (stderr para logs).

- **REQ-TODO-06 — Status flow + frontier semantics (domain contract):** Estados permitidos `pending|active|done|blocked` (zod enums en REST + MCP + plugin + store). Flujo UI `pending → active → done|blocked` es intent, el server acepta cualquier transición entre esos 4 (solo valida pertenencia al enum, no autómata). Frontier = `pending ∪ active` (unblocked, listo para pick), ordenado `high→medium→low` luego `updatedAt` desc (ver REQ-03). `GET /memory/frontier` y `GET /memory/todos?frontier=true` devuelven exactamente ese conjunto; `PATCH status:done|blocked` excluye en el siguiente frontier; `status:pending|active` incluye. Búsqueda respeta frontier cuando ese flag está presente.

- **REQ-TODO-07 — Hooks auto-extract + plugin parity (automation/ops contract):** `hooks/capture.mjs` `extractTodos(event, hook)` solo en `Stop|SessionEnd|PreCompact|PostToolUse`; recoge `body` de `transcript|session_body|body|content|prompt.text|tool_output|result` o array.join o JSON.stringify fallback; si `body.length <400` → 0; split líneas 12..200 chars; heurística `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → `{title: clean(line 0..120), description:"auto-extracted from session", priority:medium}` sino línea >60 con `(should|need to|must|blocked|revisit)` → low; cap 5 hits → dedup case-insensitive por title → retorna array; `main()` los envía fire-and-forget `slice(0,3)` con `POST /memory/todos` (`title/description/priority/project/sessionId`), `AbortSignal.timeout(1500)` cada uno, bearer si `AGENT_MEMORY_SECRET` set, nunca bloquea (toda promesa `.catch(()=>undefined)`, hook siempre exit 0, nunca loguea prompt text ni secret). Plugin `plugins/opencode/plugins/agent-memory.ts` añade 6 tools `memory/todo_create|list|get|update|delete|frontier` (namespace `memory`, codemode) con mismos bounds (`MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200`) y semántica parentId (string|null, null limpia); `todo_create` defaults `project=cfg.project`, `sessionId=toolContext.sessionID`; `todo_list/frontier` build `URLSearchParams` con project/limit/status/priority/search/frontier/parentId; `todo_update` requiere ≥1 campo; `call()` lleva bearer `Authorization` si `cfg.secret`; `recallCache.clear()` tras create/update/delete; total `memory/*` tools = 11 (5 previos + 6 todos/frontier).

Non-functional (heredan BRIEF frozen + HARD):

- **NFR-TODO-A zero new deps:** solo `node:` builtins + HelixDB v3 (`@helix-db/helix-db`), cero deps nuevas en `package.json`/lockfile; `helix.toml` solo añade los 4 índices Todo vía `bootstrapIndexes`.
- **NFR-TODO-B Ley 172-13 / privacy:** hooks nunca capturan prompt text (`UserPromptSubmit` ya fijo, extract solo lee `body` largo con heurística, nunca `hook.prompt` raw); ningún log/event/prompt/export lleva PII cruda; todo store declara purpose (follow-up) — TTL sin expiración NB.
- **NFR-TODO-C nunca matar upstream:** ningún código señala puertos `3111/3112/3113`; contratos `never kill` intactos.
- **NFR-TODO-D BRIEF frozen:** clasificación `bounded-initiative`, scope sin grafo/leases no se expande en este lane.

## 3. Acceptance Criteria

| AC | Requirement | Criterio (given/when/then) | Evidencia / traza a test |
|---|---|---|---|
| AC-TODO-01 | REQ-01 | 12 indexes existen: `bootstrapIndexes()` retorna `todo_id, todo_project, todo_status, todo_title` además de los 8 previos; `Todo {todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId}` round-trip CRUD | `db/queries.ts:127-193` + `src/store.ts:289-322` + tipo `TodoRow`; `npm run typecheck` 0; `scripts/bootstrap.ts` 12 |
| AC-TODO-02 | REQ-02 | `POST /memory/todos 201 {todo}` + `POST /agentmemory/todos 201` (alias); `GET /memory/todos` filtra `?status&priority&parentId&limit`; `GET /memory/todos/:id 200` /404; `PATCH /memory/todos/:id 200` /404; `DELETE /memory/todos/:id 200` /404; `GET /memory/frontier 200 {frontier,count}` + alias `/agentmemory/frontier`; bearer guard salvo `livez` | `src/server.ts:136-177,278-283,470-560,584-588` + `src/store.ts:1314-1465`; curl smoke `POST /memory/todos` 201 y alias 201 |
| AC-TODO-03 | REQ-03 | `GET /memory/todos?search=ship` hace hit (BM25 o substring fallback) y `GET /memory/todos?search=zzz_nomatch` 0; orden `high→medium→low` luego `updatedAt` desc verificado | `src/store.ts:1366-1412` `filterTodos` + `priorityRank`; `db/queries.ts:834-852` `searchTodosByText`; `GET /memory/todos?search=...` hit + miss |
| AC-TODO-04 | REQ-04 | `POST {parentId:<exists>}` vincula y `GET ?parentId=<id>` filtra; `PATCH {parentId:null}` limpia (parentId ausente); `POST {parentId:self}` 400 `cannot be its own parent` o `parent todo not found`; `PATCH {parentId:bad}` 400 `parent todo not found` | `src/store.ts:1323-1330,1433-1445` + `src/server.ts:477-490,531-547`; `POST ?parentId` + `PATCH null` e2e |
| AC-TODO-05 | REQ-05 | MCP `memory_todo_create` 201, `memory_todo_list` con filtros, `memory_todo_get` 200/404, `memory_todo_update` patch + parentId null, `memory_todo_delete` 200/404, `memory_frontier` = pending∪active ordenado; `_meta` bearer guard | `src/mcp.ts:113-147,411-536` `registerTools`; MCP smoke `memory_todo_create/list/frontier` |
| AC-TODO-06 | REQ-06 | `pending→active→done` y `pending→blocked` cierran; `GET /memory/frontier` incluye solo pending|active, excluye done/blocked, orden high→low | `src/store.ts:1388-1403` frontier filter+sort + `src/server.ts:137-138` enums; `PATCH status` + `frontier count` antes/después |
| AC-TODO-07 | REQ-07 | Hook Stop con body ≥400 auto-extrae ≥1 todo (heuristic TODO/decision/revisit/inspect/blocked) y `POST /memory/todos` ≤3; body <400 → 0; plugin `memory/todo_create|list|get|update|delete|frontier` con parentId alcanzables (6 tools) | `hooks/capture.mjs:209-260,236-260` + `plugins/opencode/plugins/agent-memory.ts:924-1097`; `verify` hook + plugin todo tools count 11 |

Verdes existentes deben permanecer: `npm run verify` 243, `verify-lifecycle` 123, `verify-capture` 137, `typecheck` 0, `bootstrap` 8→12 sin regresión.

## 4. Contracts & Interfaces

### 4.1 Helix node + indexes (`db/queries.ts`)

- Label `Todo` (`LABELS.Todo`), props listadas en REQ-01. `todoRowProjection` = `[$id→id, todoId, title, description, priority, status, project, sessionId, createdAt, updatedAt, parentId]`.
- Params: `saveTodoParams {todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId}`, `listTodosParams {project,limit}`, `getTodoByIdParams {todoId}`, `updateTodoParams {todoId,title,description,priority,status,updatedAt,parentId}`, `searchTodosByTextParams {q,project,k}`, `deleteTodoParams {todoId}`.
- Reads: `listTodos` anchor `Todo where project` + `$id desc` + limit + projection; `searchTodosByText` `where project → textSearchWith(Todo,title,q,k,project)`; `getTodoById` `where todoId limit1`. Writes: `saveTodo addN Todo returning [todo]`; `updateTodo where todoId varNotEmpty setProperty(6 fields) returning [updated,todo]`; `deleteTodo where todoId varNotEmpty drop returning [target,deleted]`.

### 4.2 Store (`src/store.ts`)

- `TodoPriority`, `TodoStatus`, `TodoRow`, `CreateTodoInput`, `UpdateTodoInput {parentId?: string|null}`, `ListTodosInput {project,limit,status?,priority?,search?,frontier?,parentId?}`, `MemoryStore {createTodo, listTodos, getTodo, updateTodo, deleteTodo, frontierTodos}`.
- `createTodo`: valida title 1..500, description trim 0..5000, priority/status defaults, parent lookup fail-closed 400, send `saveTodo`, fallback construct si response vacío.
- `listTodos`: rama search BM25 + substring fallback, else `rawListTodos(max(limit*4,100))`, `filterTodos` (status/priority/parentId/frontier) + sort priorityRank→updatedAt→todoId, slice.
- `updateTodo`: re-fetch existing, merge patch, self-parent + parent-exists checks, title non-empty, send `updateTodo`, indicarPresence.

### 4.3 REST (`src/server.ts`)

- Schemas: `todoPrioritySchema`, `todoStatusSchema`, `parentIdSchema 1..200`, `createTodoBodySchema strict`, `updateTodoBodySchema {parentId: string|null}`, `listTodosQuerySchema {status,priority,search 0..500, frontier bool, parentId}`, `frontierQuerySchema`.
- Routes: listadas en REQ-02; `isAgentMemoryAlias` rewriter; bearer guard `isBearerAuthorized` antes de todo salvo `livez`; `HttpError 400 invalid_request` para parent not found / self-parent / title required; alias probado antes del guard.
- Errores: `405 method_not_allowed` con `Allow` header, `415/413/400 body`, `500 internal_error` con `logSafeNote` sin secret.

### 4.4 MCP (`src/mcp.ts`)

- 6 tools descritas en REQ-05, todas vía `handle(name,_meta,op)` (auth primero, catch→isError). Input schemas zod `todoCreateInput todoUpdateInput(todoId required) todoListInput todoGetInput todoFrontierInput`. `handle` nunca expone secret.

### 4.5 Hooks (`hooks/capture.mjs`)

- `extractTodos`, `collectBody` (candidatos `transcript,session_body,body,content,prompt.text,tool_output,result` o array join o JSON stringify), límites 400 y 12..200 por línea, 5→dedup→3, POST ≤3 fire-and-forget. `SUPPORTED` set incluye Stop/SessionEnd/PreCompact/PostToolUse para esta rama (otros eventos no extraen).

### 4.6 Plugin OpenCode (`plugins/opencode/plugins/agent-memory.ts`)

- Namespace `memory`, 6 tools con `MAX_TODO_TITLE/DESC/ID` mirrors server; `call()` con `Authorization` bearer; `recallCache.clear()` en mutaciones; `hasMarker`/`autoRecall` intactos; `OPENCODE` plugin id `agent-memory` version `0.8.0`.

## 5. Out of Scope

- Grafo de dependencias `requires/unlocks/gated_by/conflicts_with`, leases, signals/routines upstream — se dejan para P4.3 multi-agent (BRIEF §Out of Scope).
- Viewer UI completo; solo backend para que la UI del screenshot consuma (`GET /memory/todos` + `frontier` + `search` ya cubren el "Search todos…" field).
- Migración de datos de Actions upstream (no hay datos previos; nombre `todos` es greenfield).
- Índice dedicado para `parentId` (filtro app-side hasta medir >1k lista por padre; open question BRIEF).
- Edges entre todos (jerarquía vía `parentId` scalar only, no edge `PARENT_OF`).

## 6. Dependencies

- Upstream: `BRIEF-todos` approved 2026-09-25, `OKR-todos.md` KR-1.1..2.3.
- Runtime: HelixDB v3 only (`@helix-db/helix-db@3.0.4`-compatible `g()/IndexSpec/PropertyInput/defineParams`), Node ≥20 builtins, `storage="disk"`, Docker/Podman opcional (no se requiere `helix start` para este lane).
- Existing surfaces frozen salvo adición de los 4 índices Todo y el rewrite `/agentmemory/` (no rompe clientes existentes; `/memory/*` estable).
- Hard constraints: `subagents` execution_mode, `zero-new-deps`, `src/db/hooks/plugins only`, `never kill upstream` (puertos 3111/3112/3113 reglados en `src/server.ts:641-661`), `BRIEF frozen`.
- Domain sign-offs: R1 (owner, este spec), R2 security review (bearer guard, no PII en hooks), R8 automation/ops review (hook detached + plugin tool count).

### Risks & Assumptions

- **R1 Low — app-side parentId filter:** listar por padre hace over-fetch hasta 400 rows; residual accepted hasta métrica >1k; owner R1, trigger medir `GET ?parentId` p95 con >1k hijos.
- **R2 Low — Hook heuristic precision:** heurística keyword puede generar falsos positivos/negativos; mitigación: cap 3, low/medium only, nunca bloquea, dedup; aceptado como bounded-initiative.
- **R3 Low — Alias collision:** `/agentmemory/` solo reescribe `todos|frontier` para no afectar memorial routes; resto `/agentmemory/*` 404.
- **A1:** Helix `textSearchWith` con tenant `project` requiere `todo_title` nodeText index con ese tenant — bootstrap lo crea (verified `g().createIndexIfNotExists`).
- **A2:** `searchTodosByText` sobre `title` only — description se cubre vía substring fallback; si se requiere BM25 sobre description se propone nuevo índice en siguiente lane (no ADR ahora).
- **A3:** `AGENT_MEMORY_URL` es el único descubrimiento de base para REST/MCP/plugin/hooks (default `http://127.0.0.1:3111`).

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change (reference, no file writes in this stage) | Evidence |
|---|---|---|---|
| REQ-TODO-01 | AC-01 | `db/queries.ts` Todo node + 12 bootstrap + `src/store.ts` TodoRow types | `bootstrap` 12, `typecheck` 0, CRUD round-trip |
| REQ-TODO-02 | AC-02 | `src/server.ts` 6 routes + alias rewriter + bearer guard; `src/store.ts` CRUD impl | curl `POST /memory/todos` 201 + `POST /agentmemory/todos` 201 + `GET /memory/frontier` |
| REQ-TODO-03 | AC-03 | `src/store.ts` `filterTodos` sort + `searchTodosByText` BM25 + substring fallback | `GET ?search=ship` hit + frontier priority order |
| REQ-TODO-04 | AC-04 | `src/store.ts` parent validate 400/clear + `src/server.ts` 400 mapping + MCP/plugin parentId null | `POST {parentId}` + `GET ?parentId=` + `PATCH {parentId:null}` + self 400 |
| REQ-TODO-05 | AC-05 | `src/mcp.ts` 6 tools + `_meta` bearer | MCP `memory_todo_*` + `memory_frontier` smoke |
| REQ-TODO-06 | AC-06 | `src/store.ts` status frontier filter + `src/server.ts` enums + `src/mcp.ts` frontier tool | `PATCH status done/blocked` excluye frontier; pending|active incluye |
| REQ-TODO-07 | AC-07 | `hooks/capture.mjs` extract ≤3 from ≥400 + `plugins/opencode/plugins/agent-memory.ts` 6 tools (11 total) | `verify-capture` hook + plugin todo tools count; Stop body ≥400 extract |
| NFR-TODO-A | AC-01/02 | zero new deps, 12 indexes | `git diff package.json` 0, `package-lock` 0, `typecheck` 0 |
| NFR-TODO-B | AC-07 | hooks nunca prompt text, solo títulos sanitizados | `hooks/capture.mjs` allowlist + no secret in logs |
| NFR-TODO-C | AC-02 | never kill scope | `src/server.ts` reroute hint, no kill path |
