# Spec Addendum: Todos — Security Controls

**ID:** SPEC-020-todos-security
**Owner:** general(barrera) — Security Owner (R2)
**Domains-Touched:** [security] (R2, cross R1, R8)
**Brief Reference:** docs/briefs/BRIEF-todos.md (approved 2026-09-25) + docs/briefs/OKR-todos.md
**Parent Spec:** docs/specs/20_backlog/SPEC-020-todos.md (R1, engineering)
**Status:** draft
**Priority:** P2 — bounded-initiative (security addendum, no new scope)
**Execution_Mode:** subagents (frozen at frame-intent)
**Verdict:** PASS — controls verified present, no blocking finding; residual risks explicit

**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-todos.md#OKR-todos.md / HARD:subagents+zero-new-deps, no secrets/PII, bearer guard / GATE:none-yet / DOMAINS:R1,R2,R8`

## 1. Context

This is the security-owned addendum to `SPEC-020-todos.md` (Engineering, R1). The parent spec owns the functional Todo contract (`Todo` node, REST CRUD + frontier + alias, MCP 6 tools, plugin parity, hooks auto-extract). This addendum owns **only the security controls** and their evidence, per the packet `HARD: no secrets/PII, bearer guard` and `Domains-Touched:[security]`. It uses the spec-template shape and does not duplicate the engineering contract — it references it.

Grounding (read-only this lane): `src/server.ts:136-177,268-283,470-560,584-588` (schemas + alias rewriter + bearer guard + error boundary), `src/mcp.ts:113-147,169-183,411-536` (bearer via `_meta` + handle boundary), `src/auth.ts:15-55` (bearer timing-safe), `src/errors.ts:20-73` (logSafeNote CWE-117), `hooks/capture.mjs:209-286` (extractTodos + 1.5s timeout + title sanitization), `src/store.ts:289-351,1313-1472` (bounds + parentId fail-closed), `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` (mirror bounds).

## 2. Requirements

Security controls — each maps to an AC in §3 and a trace in §7:

- **REQ-SEC-TODO-01 — Bearer guard, REST (todos + frontier + alias):** Every route under `/memory/` is bearer-guarded except `GET /memory/livez` (the sole exempt path). The guard is `src/auth.ts:isBearerAuthorized(req.headers.authorization, secret)` with `secretFromEnv()` (`AGENT_MEMORY_SECRET` non-empty arms it; unset/empty = open). Mismatch → `401 {error: "unauthorized"}` with `www-authenticate: Bearer` (`src/server.ts:286-290`). The alias path `/agentmemory/todos*` and `/agentmemory/frontier*` is rewritten **before** the guard (`src/server.ts:279-282` `isAgentMemoryAlias` → `path.replace("/agentmemory/","/memory/")`), so `POST http://localhost:3111/agentmemory/todos` from the screenshot is subject to the same guard as `/memory/todos`. `/memory/frontier` (and its alias `/agentmemory/frontier`) has no separate exemption. `livez` remains the only exemption even when the alias is active.

- **REQ-SEC-TODO-02 — Bearer guard, MCP (_meta bearer):** All 6 todo tools (`memory_todo_create/list/get/update/delete`, `memory_frontier`) enforce the same bearer rule over stdio via `src/auth.ts:isMetaAuthorized(_meta, secret)` inside the uniform `handle(name,_meta,op)` boundary (`src/mcp.ts:169-183`). The secret rides in `_meta.authorization = "Bearer <secret>"` (stdio has no HTTP headers). Mismatch → `throw new McpError(ErrorCode.InvalidRequest, "unauthorized")` before any store call; `isError` path never reveals the secret. Stdout carries only MCP protocol; diagnostics go to stderr sanitized.

- **REQ-SEC-TODO-03 — No secret logging (REST + MCP + hooks + plugin):** The secret value is never logged, echoed, or included in any response, log line, state file, or error text. Evidence: `src/server.ts:607` access log prints only `method path status duration` (never bodies, query, headers, secrets); `src/server.ts:584,610` error paths use `logSafeNote(err)` (`src/errors.ts:62-73` — remote Helix errors reduce to stable code only, local errors trimmed); `src/mcp.ts:180` logs `logSafeNote` only; `hooks/capture.mjs:1-290` never prints anything (always exit 0, no secret/payload echo); `src/auth.ts:21-27` uses timing-safe compare without logging.

- **REQ-SEC-TODO-04 — Todo-capture timeout (hooks, 1.5s):** Each fire-and-forget `POST /memory/todos` from `hooks/capture.mjs` is bounded by `AbortSignal.timeout(1500)` (`hooks/capture.mjs:230`). Up to 3 todos per hook invocation (`todos.slice(0,3)`), each with its own 1500 ms signal; the prior `memory/remember` observation uses `2000 ms` (`hooks/capture.mjs:204`). All fetches are `.catch(()=>undefined)` and the hook always exits 0 — a dead or slow server never blocks the coding agent, and no retry loop is introduced.

- **REQ-SEC-TODO-05 — Input bounds (strict, zod-first):** All Todo inputs are bounds-checked before reaching the store, via zod schemas that are the single enforcement point (strict, unknown fields → 400):
  | Field | Bound | Schema location | Error |
  |---|---|---|---|
  | `title` | 1..500 trim, required on create | `src/server.ts:143` `createTodoBodySchema`, `src/mcp.ts:116`, `src/store.ts:289-351` | 400 `invalid_request` (zod), MCP `isError {error:"title is required"}` |
  | `description` | 0..5000 trim, optional | same + `plugins/...:MAX_TODO_DESC 5000` | 400 |
  | `todoId` (path `:id` + `todoId` param) | 1..200 trim | `src/server.ts:139` `parentIdSchema` shape, `src/mcp.ts:125,142` `todoGetInput/todoUpdateInput`, `src/store.ts` | 400 `invalid_path_encoding` or `invalid_request` / MCP `isError not_found` |
  | `parentId` | 1..200 trim, `string\|null` on PATCH (null clears) | `src/server.ts:139,159-160` `parentIdSchema` + `updateTodoBodySchema`, `src/mcp.ts:122` | 400 (see REQ-06) |
  | `search` (query) | 0..500 trim | `src/server.ts:168` `listTodosQuerySchema`, `src/mcp.ts:138` | 400 |
  | `limit` | 1..100 coerce int | `src/server.ts:164,174` | 400 |
  | `priority/status` | enums `low\|medium\|high` / `pending\|active\|done\|blocked` | `src/server.ts:137-138` | 400 |
  Body also enforces `415 unsupported_media_type`, `413 payload_too_large` (1 MiB), `400 invalid_json_body` before schema (`src/server.ts:221-243`). Plugin mirrors the same bounds (`MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200`).

- **REQ-SEC-TODO-06 — parentId validation fail-closed 400 (never 500):** `parentId` is validated fail-closed and surfaced as `400 invalid_request`, never `500 internal_error`. Server: `src/store.ts:1323-1330` (create) throws `parent todo not found: <id>` via `getTodo(parentId)` lookup; `src/server.ts:488-490` maps that to `HttpError 400 invalid_request`; update path `src/store.ts:1433-1445` checks `parentId===todoId` → `todo cannot be its own parent` and the same not-found check, mapped at `src/server.ts:543-545` to 400. MCP: `src/mcp.ts:434-435,499-501` catches the same messages and returns `failed({error: msg})` with `isError:true` instead of throwing. `PATCH {parentId:null}` clears to `""` (stored empty → read as `undefined`), not an error. No code path lets a missing parent become a 500.

- **REQ-SEC-TODO-07 — CWE-117 oneLine collapse implicit via server error handling:** No Todo field is interpolated into a log line without passing through the existing error-handling hygiene that collapses whitespace. The governance-delete path already collapses `memoryId/reason` (`src/server.ts:58-69` + `src/mcp.ts:98-111`), and all Todo error paths go through `HttpError` with `sendJson` (no log interpolation) or `logSafeNote` (`src/errors.ts:20-23,62-73` `trimmed()` does `value.replace(/\s+/g," ").trim()`) plus the access log that never logs bodies/query/headers. ParentId and title values that reach an error are carried only in the `HttpError.details` JSON response (`{error:"invalid_request",details:msg}`) or in an MCP `isError` JSON payload — never as a raw second log line. The `store` error messages (`parent todo not found: ${parentId}`) are the only place a caller-supplied value enters a diagnostic string, and that string is returned as JSON `details` or MCP `isError`, not as a console log line. The implicit guarantee is therefore: any value that reaches a log is passed through `logSafeNote`/`trimmed` oneLine collapse; values that reach the client are JSON-escaped.

- **REQ-SEC-TODO-08 — Ley 172-13 hooks (purpose limitation + minimization, title sanitized):** `hooks/capture.mjs` satisfies Ley 172-13 minimization: it captures **only a sanitized `title`**, never prompt text, never memory content, never a secret. `extractTodos` (`hooks/capture.mjs:236-260`) reads only from `transcript|session_body|body|content|prompt.text|tool_output|result` via `collectBody` (`hooks/capture.mjs:262-286`) and only when `body.length >=400`; it splits into lines `12..200` chars, matches `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → medium or `should|need to|must|blocked|revisit` with `line.length>60` → low; each `title` is `clean(line.slice(0,120),120)` (`clean` → strip `\u0000-\u001f\u007f`, collapse `\s+` to single space, trim, slice). `description` is the fixed string `"auto-extracted from session"`, `priority` is `medium|low` only. `UserPromptSubmit` is not an extractTodos event (only `Stop|SessionEnd|PreCompact|PostToolUse`); even if a future caller added it, the hook would still only store the sanitized title, never `hook.prompt` raw. The Todo store purpose is declared in the parent spec as `follow-up` (BRIEF-todos: decisions to revisit, files to inspect, tasks blocked); TTL is unbounded (no expiry) with deletion via `DELETE /memory/todos/:id` / `memory_todo_delete`. No PII, no secret, no raw transcript is ever POSTed.

Non-functional (inherited, not expanded here):

- **NFR-SEC-A zero new deps:** inherited from BRIEF-todos + SPEC-020-todos NFR-TODO-A — no new dependency is introduced by any control above; all controls use `node:` builtins, `zod`, and `helix-db` already in the repo.
- **NFR-SEC-B BRIEF frozen:** classification `bounded-initiative` unchanged; no graph/leases/signals added.

## 3. Acceptance Criteria

| AC | Requirement | Criterio (given/when/then) | Evidencia / traza |
|---|---|---|---|
| AC-SEC-01 | REQ-01 | Con `AGENT_MEMORY_SECRET` armado: `GET /memory/livez` → 200 sin `Authorization`; `GET /memory/todos` y `GET /memory/frontier` sin header → 401 + `www-authenticate: Bearer`; con header correcto → 200; `POST /agentmemory/todos` y `GET /agentmemory/frontier` sin header → 401 (mismo guard que `/memory/*`), con header → 201/200 | `src/server.ts:279-290,292-296,510-517` + `src/auth.ts:33-41`; curl `livez` 200 vs `todos/frontier` 401→200 + alias 401→200 |
| AC-SEC-02 | REQ-02 | Con secret armado: cualquier `memory_todo_*` / `memory_frontier` sin `_meta.authorization` o con bearer mismatch → `McpError InvalidRequest "unauthorized"` (throw antes del store); con `Bearer <secret>` → `ok`/`isError` según store; stdout nunca lleva secret | `src/mcp.ts:169-183,411-536` `handle` + `isMetaAuthorized`; MCP smoke `_meta` ausente → `unauthorized`, con `_meta` → `todo` |
| AC-SEC-03 | REQ-03 | `AGENT_MEMORY_SECRET` aparece 0 veces en stdout+stderr de REST/MCP/hooks/plugin bajo cualquier entrada (incl. sintético `test_secret_...`), y 0 veces en access log, error log, governance log y state-like surfaces; `rg -n "test_secret" logs` → 0 | `src/server.ts:584-588,598-614` + `src/mcp.ts:180` + `src/errors.ts:62-73` + `hooks/capture.mjs` (exit 0, no print); `scripts/verify-env.ts:314-323` pattern adaptado a `verify todos` |
| AC-SEC-04 | REQ-04 | `hooks/capture.mjs` envía `POST /memory/todos` con `AbortSignal.timeout(1500)` por todo; ≤3 fetches por invocación; servidor caído → 0 bloqueo, exit 0, sin retry; servidor lento >1.5s → abort por todo sin afectar otros | `hooks/capture.mjs:225-232` `slice(0,3)` + `AbortSignal.timeout(1500)` + `.catch(()=>undefined)` + `finally process.exit(0)`; hook harness timing |
| AC-SEC-05 | REQ-05 | `POST /memory/todos` con `title` vacío (>500, `description` >5000, `todoId`/`parentId` >200, `search` >500, `limit` 0/101, `priority/status` fuera de enum, body `unknown field`, `415/413/400 body` → 400/415/413 según caso; MCP con mismos bounds → `isError`; plugin con mismos bounds | `src/server.ts:136-177,221-243` + `src/mcp.ts:113-147` + `src/store.ts:289-351` + `plugins/opencode/...:108-111`; fuzz de bounds → 400/`isError` |
| AC-SEC-06 | REQ-06 | `POST /memory/todos {parentId:"notfound"}` → 400 `parent todo not found`; `POST {parentId:self}` → 400 `parent todo not found` o `cannot be its own parent`; `PATCH /memory/todos/:id {parentId:"notfound"}` → 400; ninguno → 500; MCP equivalentes → `isError` con mismo mensaje | `src/store.ts:1323-1330,1433-1445` + `src/server.ts:488-490,543-545` + `src/mcp.ts:433-435,499-501`; parentId e2e `notfound/self/null` |
| AC-SEC-07 | REQ-07 | Inyección `\n`/`\r` en `parentId`/`title` que llegue a un error no forja segunda línea de log: error va a `details` JSON (REST) o `isError` JSON (MCP), no a log interpolado; cualquier log usa `logSafeNote` oneLine | `src/errors.ts:20-23` `trimmed` + `src/server.ts:498-507,562-588` `sendJson`/`respondToError`; inyección `\n` → log tiene 1 línea + JSON escapado |
| AC-SEC-08 | REQ-08 | Hook Stop con `body` ≥400 contiene `TODO ...` → `extractTodos` produce ≤5 hits dedup por title, `clean` sanitiza título (control chars y `\s+` colapsado), `description="auto-extracted from session"`; `body` <400 → 0; `UserPromptSubmit` nunca entra a extractTodos; ningún POST incluye prompt raw | `hooks/capture.mjs:236-286` + `hooks/capture.mjs:54-61` `clean`; `verify-capture` hook + título sanitizado |

Regresión: `npm run verify` 243, `verify-lifecycle` 123, `verify-capture` 137, `typecheck` 0 siguen verdes; 12 índices bootstrap intactos (SPEC-020-todos AC-TODO-01).

## 4. Contracts & Interfaces

### 4.1 REST guard (src/server.ts + src/auth.ts)

- Exento: `GET /memory/livez` (`path === "/memory/livez"` antes del guard).
- Protegido: toda otra ruta `/memory/*` incl. `POST /memory/todos`, `GET /memory/todos`, `GET /memory/todos/:id`, `PATCH /memory/todos/:id`, `DELETE /memory/todos/:id`, `GET /memory/frontier`, y tras rewrite `POST /agentmemory/todos` → `/memory/todos`, `GET /agentmemory/frontier` → `/memory/frontier` (`src/server.ts:279-282` antes de `src/server.ts:286`).
- Guard: `isBearerAuthorized(req.headers.authorization, secret)` (`src/auth.ts:33-41` timingSafeEqual sobre `Bearer ${secret}`). `secret === undefined` → guard desarmado (dev open). Fallo → `res.setHeader("www-authenticate","Bearer")` + `sendJson 401 {error:"unauthorized"}`.
- Error/Access hygiene: `sendJson` + `respondToError` (`src/server.ts:193-202,564-587`) nunca loguea bodies/query/headers/secrets; access log es `method path status duration` (`src/server.ts:605-607`); errores van por `logSafeNote` (`src/errors.ts:62-73`).

### 4.2 MCP _meta bearer (src/mcp.ts + src/auth.ts)

- Todas las 6 tools todo/frontier pasan por `handle(name,_meta,op)` (`src/mcp.ts:169-183`): `if (!isMetaAuthorized(meta,secret)) throw new McpError(ErrorCode.InvalidRequest,"unauthorized")` antes del store; `catch` → `console.error([agent-memory mcp] ${name}: ${logSafeNote(err)})` + `failed({error:"internal_error"})` (o `failed({error:msg})` para parent/title). `isMetaAuthorized` (`src/auth.ts:48-55`) lee `_meta.authorization` como `string` y aplica el mismo `bearerMatches`.
- Stdout es solo protocolo MCP; stderr sanitizado; los 6 tools mantienen `readOnlyHint/destructiveHint/idempotentHint` del parent spec.

### 4.3 No-secret logging (cross-surface)

- REST: `main()` nunca imprime `secret` value, solo `auth: open|bearer-required` (`src/server.ts:678-680`); `portInUseHint` no incluye env; `state file` no existe en este lane (no PII store nuevo).
- MCP: `main()` no imprime secret; `registerTools` no incluye `secret` en ninguna descripción.
- Hooks: `hooks/capture.mjs` nunca imprime nada; `headers.authorization` se construye solo para `fetch` y nunca se loguea.
- Plugin: `plugins/opencode/plugins/agent-memory.ts` pasa `Authorization` solo en `call()` fetch headers, nunca en logs.

### 4.4 Hook timeout (hooks/capture.mjs)

- `POST /memory/todos` loop `for (const t of todos.slice(0,3)) await fetch(url,{method:"POST",headers,body:JSON.stringify({title,description,priority,project,sessionId}),signal:AbortSignal.timeout(1500)}).catch(()=>undefined)` (`hooks/capture.mjs:225-232`). Precedido por `URL` construction con `try/catch` y `headers` con bearer si `AGENT_MEMORY_SECRET` set. `main().catch(()=>undefined).finally(()=>process.exit(0))` garantiza exit 0.

### 4.5 Input bounds (schemas)

- REST: `todoPrioritySchema`, `todoStatusSchema`, `parentIdSchema 1..200`, `createTodoBodySchema strict`, `updateTodoBodySchema {parentId: string|null}`, `listTodosQuerySchema {search 0..500, frontier bool, parentId}`, `frontierQuerySchema` (`src/server.ts:136-177`). Todo input es `unknown` primero, luego `parseOr400` (`src/server.ts:204-213`) con detalles en `HttpError 400 invalid_request`.
- MCP: `todoCreateInput` `title 1..500`, `todoUpdateInput` `todoId 1..200 + parentId string|null`, `todoListInput`, `todoGetInput`, `todoFrontierInput` (`src/mcp.ts:113-147`). SDK zod→JSON-schema expone `minLength/maxLength`.
- Plugin: `MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200` (`plugins/...:108-111`), mirror del server.

### 4.6 parentId fail-closed mapping

- Store throws: `parent todo not found: ${parentId}` (`src/store.ts:1328,1443`) y `todo cannot be its own parent` (`src/store.ts:1438`) y `title is required` (`src/store.ts:1335` path).
- REST maps: `catch (msg.includes("parent todo not found")) throw new HttpError(400,"invalid_request",msg)` (`src/server.ts:488-490,543-545`); nunca 500.
- MCP maps: `catch (msg.includes(...)) return failed({error: msg})` (`src/mcp.ts:434-435,499-501`); nunca throw 500 (throw → `handle` catch → `internal_error` solo para errores no parent/title).

### 4.7 CWE-117 oneLine (implicit)

- `src/errors.ts:20-23` `trimmed` hace `value.replace(/\s+/g," ").trim()` y `logSafeNote` lo usa para todo log; `src/server.ts:63-73` governance delete ya colapsa, pero Todo errors no necesitan nueva línea `governance` — su valor `\n`-inyectable solo llega a JSON `details` (REST) o `isError` text (MCP), que `JSON.stringify` escapa. Access log no toca bodies. La garantía es implícita: ningún valor caller-supplied se interpola crudo en una línea de log.

### 4.8 Ley 172-13 hooks (minimization)

- `collectBody` allowlist de candidatos (`transcript,session_body,body,content,prompt.text,tool_output,result`, array join, fallback `JSON.stringify(hook).slice(0,4000)`) pero solo si `length >=400`; `extractTodos` filtra por heurística y `clean()`; `description` fijo; eventos autorizados `Stop,SessionEnd,PreCompact,PostToolUse` (no `UserPromptSubmit`). Ver §2 REQ-SEC-TODO-08.

## 5. Out of Scope

- Funcional Todo (node, CRUD, search/priority sort, frontier, plugin 11 tools) — pertenece a `SPEC-020-todos.md` (R1).
- P4 ops (`start/stop/status/doctor --migrate`, state file, backup PII store, PATH hijack, PID re-verify) — pertenece a `SPEC-P4-OPS.md` + `SECURITY_REVIEW.md` (R1/R8) y no se re-abre aquí.
- Índice dedicado para `parentId` (BRIEF open question) y grafo `requires/unlocks/gated_by` — fuera de lane (SPEC-020-todos §5).
- DPIA formal para Todo: este lane es low-risk (purpose `follow-up`, TTL unbounded, deletion explícita, no cross-border, no decisión automatizada) — se registra como no requerido, revisable si el scope crece.

## 6. Dependencies

- Upstream: `BRIEF-todos` approved 2026-09-25, `OKR-todos.md` KR-1.1..2.3, `SPEC-020-todos.md` REQ-TODO-01..07, `ARCHITECTURE.md` §6-§10, `docs/CONTRACT.md:479-495` (governance-line precedent, no se modifica).
- Runtime: HelixDB v3 `g().createIndexIfNotExists` / `textSearchWith` con tenant `project`, Node ≥20 builtins, `storage="disk"`.
- Hard constraints: `subagents`, `zero-new-deps`, `src/db/hooks/plugins only`, `never kill upstream` (puertos `3111/3112/3113` intactos), `BRIEF frozen`.
- Domain sign-offs: R2 (owner, este addendum), R1 (engineering, consume sin ADR nuevo), R8 (automation/ops, hook timeout evidencia).

### Risks & Assumptions

- **R-SEC-01 Low — store error message carries caller-supplied parentId:** `parent todo not found: ${parentId}` puede contener `\n`; mitigación: el mensaje solo va a JSON `details`/`isError` (no a log crudo); residual accepted, owner R2. Trigger: si un nuevo log interpolara ese mensaje, ese log debe pasar por `logSafeNote`/`trimmed`.
- **R-SEC-02 Low — hook heuristic title is caller-influenced plain text:** heurística `TODO/decision/revisit/inspect/blocked` produce títulos desde `body` sanitizado por `clean()`; riesgo de almacenar texto no deseado es funcional (parent spec), no de secreto/PII — `description` fijo y nunca prompt raw. Owner R2, trigger: si se añade `UserPromptSubmit` a extractTodos, re-evaluar Ley 172-13.
- **R-SEC-03 Low — MCP _meta bearer on same-host local trust:** secreto via `_meta` equivale a HTTP bearer; blast radius local same-user (spec no añade multi-tenant). Owner R2, trigger: si se añade transporte HTTP a MCP, re-auditar bearer exposure.
- **A1:** `AGENT_MEMORY_SECRET` es el único secreto; `secretFromEnv()` non-empty lo arma, vacío/unset lo desarma — Guardia igual a `src/server.ts`/`src/mcp.ts`/`hooks/capture.mjs`.
- **A2:** `textSearchWith(Todo,title,q,k,project)` requiere índice `todo_title` nodeText tenant `project` (bootstrap 12, SPEC-020-todos AC-01).
- **A3:** `AGENT_MEMORY_URL` default `http://127.0.0.1:3111` para REST/MCP/plugin/hooks; alias no cambia base URL.

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change (reference, no file writes beyond this addendum) | Evidence |
|---|---|---|---|
| REQ-SEC-TODO-01 | AC-SEC-01 | `src/server.ts` alias rewriter (279-282) antes de bearer guard (286-290) + `frontier` bajo guard | curl `livez` 200 vs `todos/frontier` 401→200 + `/agentmemory/` 401→200 |
| REQ-SEC-TODO-02 | AC-SEC-02 | `src/mcp.ts` `handle` + `isMetaAuthorized` para las 6 tools todo/frontier | MCP `_meta` ausente/bearer mismatch → `unauthorized`; con bearer → `ok` |
| REQ-SEC-TODO-03 | AC-SEC-03 | `src/server.ts` access/error logs + `src/mcp.ts` stderr + `hooks/capture.mjs` no-print + `src/errors.ts:logSafeNote` | `rg secret` 0 en logs + `verify-env` synthetic secret 0 |
| REQ-SEC-TODO-04 | AC-SEC-04 | `hooks/capture.mjs` `AbortSignal.timeout(1500)` + `slice(0,3)` + `.catch` + `exit 0` | hook harness timing + fetch abort |
| REQ-SEC-TODO-05 | AC-SEC-05 | `src/server.ts` zod schemas strict + `src/mcp.ts` input schemas + `plugins/...` MAX_* mirrors | fuzz bounds → 400/`isError` |
| REQ-SEC-TODO-06 | AC-SEC-06 | `src/store.ts` parent lookup throw + `src/server.ts` 400 mapping + `src/mcp.ts` isError mapping | `parentId notfound/self/null` → 400/`isError`, nunca 500 |
| REQ-SEC-TODO-07 | AC-SEC-07 | `src/errors.ts:trimmed` + `src/server.ts:sendJson/respondToError` (no log interpolation) | inyección `\n` → 1 log line + JSON escapado |
| REQ-SEC-TODO-08 | AC-SEC-08 | `hooks/capture.mjs` `clean()` + `collectBody` allowlist + `extractTodos` heuristic + fixed description | `verify-capture` + título sanitizado + body<400 → 0 |

## 8. Sign-off

- [x] **security owner (R2) — `general(barrera)`:** **PASS** — los 8 controles están presentes en las superficies citadas; ningún secreto/PII se loguea o expone; bearer guard cubre REST (incl. alias) y MCP (`_meta`); timeout 1.5s verificado; bounds y parentId 400 verificados; CWE-117 oneLine implícito vía `logSafeNote`+JSON; Ley 172-13 hooks solo título sanitizado. Sin hallazgo bloqueante.
- [ ] **engineering owner (R1) — `general(vasquez)`:** consume (sin ADR nuevo; controles aditivos, sin cambio de shape).
- [ ] **automation/ops owner (R8) — `general(espinoza)`:** consume (hook timeout y evidencia, sin cambio de runbook).

**Packet:** `SPEC:docs/briefs/BRIEF-todos.md#OKR-todos.md / HARD:subagents+zero-new-deps, no secrets/PII, bearer guard / GATE:none-yet / DOMAINS:R1,R2,R8`
