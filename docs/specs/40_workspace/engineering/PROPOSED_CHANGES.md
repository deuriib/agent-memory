# Proposed Changes: general(vasquez) — Engineering Owner

**Spec Reference:** SPEC-020-todos — `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07`
**Brief Reference:** `docs/briefs/BRIEF-todos.md` (approved 2026-09-25) + `docs/briefs/OKR-todos.md` KR-1.1..2.3
**Agent:** general(vasquez) — Engineering Owner (R1)
**Date:** 2026-09-25
**Execution_Mode:** subagents (frozen at frame-intent; trivial <15 lines → CEO fast-path checkpoint-only, outside methodology)
**Domains-Touched:** [engineering (R1, owner), security (R2), automation/ops (R8)]
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents+zero-new-deps / GATE:none-yet / DOMAINS:R1,R2,R8`

> Retro-doc lane: implementation already shipped and verified in repo (grounded below). This proposal documents the as-implemented change set for review approval; no new impl edits are introduced by this doc (reference-only packet).

## Summary

Documents the bounded-initiative Todos lane — Helix `Todo` node with 12-index bootstrap, REST CRUD + frontier + `/agentmemory/` alias, BM25+fallback search with priority ordering, optional `parentId` hierarchy with 400 fail-closed/clear, 6 MCP tools, 6 OpenCode plugin tools, and fire-and-forget hook auto-extract — all under `subagents` execution, `zero-new-deps`, `src/db/hooks/plugins only`, `never kill upstream`, `BRIEF frozen`.

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `db/queries.ts` | file-modify | Add `LABELS.Todo="Todo"` + 4 Todo indexes to 12-index `bootstrapIndexes()` — `todo_id nodeUniqueEquality(Todo, todoId)`, `todo_project nodeEquality(Todo, project)`, `todo_status nodeEquality(Todo, status)`, `todo_title nodeText(Todo, title, project)` tenant `project`; add `todoRowProjection` (`$id→id + todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId` with `parentId="" → undefined` on read); add param sets + batches `saveTodo`, `listTodos`, `getTodoById`, `updateTodo`, `searchTodosByText` (`where project → textSearchWith(Todo,title,q,k,project)`), `deleteTodo` (see SPEC §4.1). No other DDL. Grounded: `db/queries.ts:32-34,127-193,720-852` |
| `src/store.ts` | file-modify | Add `TodoPriority/Status`, `TodoRow`, `CreateTodoInput`, `UpdateTodoInput {parentId?: string\|null}`, `ListTodosInput`; implement `MemoryStore.createTodo` (title 1..500 trim, description 0..5000, defaults `priority=medium/status=pending`, parent lookup `getTodo(parentId)` → throw `parent todo not found` 400, `saveTodo`), `listTodos` (search branch `searchTodosByText(q,project,limit)` → `filterTodos` else `rawListTodos(max(limit*4,100))`, substring fallback `title/description` icase if 0 hits, `filterTodos` exact `status/priority/parentId/frontier(pending\|active)` + sort `priorityRank(high3>med2>low1) desc → updatedAt localeCompare desc → todoId asc → slice(limit)`, `frontierTodos` delegates), `getTodo`, `updateTodo` (re-fetch, merge, `parentId:null→""` clear / `string` non-empty trim 0..200, `===todoId→cannot be its own parent` 400, existence check 400, title non-empty), `deleteTodo`. Grounded: `src/store.ts:289-351,1313-1472` |
| `src/server.ts` | file-modify | Add zod schemas `todoPrioritySchema`, `todoStatusSchema`, `parentIdSchema 1..200`, `createTodoBodySchema strict`, `updateTodoBodySchema {parentId:string\|null}`, `listTodosQuerySchema {status,priority,search 0..500,frontier bool,parentId}`, `frontierQuerySchema`; add `isAgentMemoryAlias` rewriter — ` /agentmemory/todos*` or `/agentmemory/frontier*` → `/memory/*` before bearer guard (compat `POST http://localhost:3111/agentmemory/todos`); add 6 routes `POST /memory/todos 201`, `GET /memory/todos 200 {todos}`, `GET /memory/todos/:id 200/404/400`, `PATCH /memory/todos/:id {parentId:string\|null} 200/404/400`, `DELETE /memory/todos/:id 200/404`, `GET /memory/frontier 200 {frontier,count}` (+ alias pair) with bearer guard identical to other `/memory/*` (only `livez` exempt, 401+`www-authenticate: Bearer` on mismatch) and `HttpError 400 invalid_request` mapping for parent errors; defaults `project="default" limit=10 sessionId=""`. Grounded: `src/server.ts:136-177,268-283,470-560,584-588` |
| `src/mcp.ts` | file-modify | Add 6 tools under `registerTools` via shared `handle(name,_meta,op)` bearer `_meta.authorization="Bearer <secret>"` (`isMetaAuthorized`, unauth→`McpError InvalidRequest`, throw→`isError+logSafeNote`): `memory_todo_create` (title 1..500 req, description 0..5000, priority/status enums, project/sessionId/parentId opt; parentValidate→isError `{error:"parent todo not found…"\|"title is required"}`), `memory_todo_list` (project,limit1..100,status,priority,search0..500,frontier bool,parentId), `memory_todo_get` (todoId), `memory_todo_update` (todoId req+patch title/description/priority/status/parentId string\|null, ≥1 field), `memory_todo_delete` (todoId), `memory_frontier` (project,limit); `readOnlyHint/destructiveHint` and idempotence per tool; `todos` everywhere, never `actions`; stdout = MCP only, stderr = logs. Grounded: `src/mcp.ts:113-147,411-536` |
| `plugins/opencode/plugins/agent-memory.ts` | file-modify | Add 6 tools namespace `memory` codemode `memory/todo_create|list|get|update|delete|frontier` mirroring MCP bounds (`MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200`) and `parentId string\|null` null-cleans semantics; `todo_create` defaults `project=cfg.project sessionId=toolContext.sessionID`; `todo_list/frontier` build `URLSearchParams` with project/limit/status/priority/search/frontier/parentId; `todo_update` ≥1 field; `call()` adds `Authorization Bearer` if `cfg.secret`; `recallCache.clear()` on create/update/delete; total `memory/*` tools `11 =5 prev+6`. Version `agent-memory 0.8.0`. Grounded: `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` |
| `hooks/capture.mjs` | file-modify | Add `extractTodos(event,hook)` + `collectBody` — gated to `Stop|SessionEnd|PreCompact|PostToolUse`; body from `transcript|session_body|body|content|prompt.text|tool_output|result` or array join or JSON fallback; `body.length<400→0`; split lines `12..200` chars; heuristic `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → `{title:clean 0..120, description:"auto-extracted from session", priority:medium}` else line>60 with `(should|need to|must|blocked|revisit)`→low; cap 5→dedup icase title→return; `main()` fire-and-forget `slice(0,3)` `POST /memory/todos` with `title/description/priority/project/sessionId`, `AbortSignal.timeout(1500)` each, bearer if `AGENT_MEMORY_SECRET` set, never blocks (`.catch(()=>undefined)`, hook exit 0, never logs prompt text nor secret). Grounded: `hooks/capture.mjs:209-286` |
| `scripts/bootstrap.ts` | file-modify | Update bootstrap to expect/create **12** indexes (was 8) — verifies `todo_id, todo_project, todo_status, todo_title` alongside 8 memory/session/concept indexes; no new dep, HelixDB v3 only |

Change types: `file-create | file-modify | file-delete | document-create | campaign-update | contract-update | policy-update | model-update | workflow-update | config-update`. Engineering uses `file-*`.

## Rationale

Each row traces 1:1 to SPEC §7 / REQ-TODO-01..07 + AC-TODO-01..07 + NFR-TODO-A..D and to `BRIEF-todos` Scope (3 creation vías, single-process, YAGNI cuts `requires/unlocks/gated_by`). Zero new deps (`node:` + `@helix-db/helix-db@3.0.4`), frozen surfaces elsewhere, `helix.toml` additive only via `bootstrapIndexes`, `/memory/*` bearer parity preserved, alias scoped to `todos|frontier` so other `/agentmemory/*` 404, hook privacy preserves Ley 172-13 (allowlisted title only, no prompt text), and 5→dedup→3 + `1500ms` timeout bounds cost. All grounded paths are verified in repo (see Changes column line anchors).

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| Upstream `Actions` name + full dependency graph edges `requires/unlocks/gated_by/conflicts_with`, leases, signals | Over-engineering for single-process contract; YAGNI per BRIEF F1; deferred to P4.3 multi-agent |
| Separate `PARENT_OF` edge table for hierarchy | Adds edge DDL + traversal cost for a bounded-initiative; scalar `parentId` with app-side filter suffices until >1k children metric fires (BRIEF open question, SPEC R1) |
| BM25 over `title+description` with dedicated `todo_description` text index | Requires new index + tenant plumbing now; `title` BM25 + substring fallback covers description at this scope; next lane if metric demands (SPEC A2, no ADR now) |
| Dedicated `parentId` index | Premature until `GET ?parentId` p95 with >1k children proves need; over-fetch 4× accepted residual (SPEC R1 Low) |
| Block hook on POST failure / log prompt text for fidelity | Violates automation/ops `never block` and Ley 172-13 minimization; chosen fire-and-forget + exit 0 + sanitized titles |

## Approval Required From

- [ ] Owning domain owner: **general(vasquez) — Engineering Owner (R1)** — mandatory (spec owner)
- [ ] engineering owner (architecture/API/model/cross-cutting) — **general(vasquez) R1** (same, self-approval not permitted — requires independent engineering review if distinct reviewer)
- [ ] security owner (auth/data/external-API/PII) — **general(barrera) — Security Owner (R2)** — required: bearer guard on 6 REST routes + alias rewriter before guard, MCP `_meta` bearer, hook no-PII/no-secret, Ley 172-13 purpose/TTL

> **Rule:** No repository file modifications during proposal phase. For non-code domains, no external sends/filings/launches during proposal phase either. This lane is retro-doc — implementation files already reflect the changes; this document is the only new/updated file in the proposal phase.

## Risk Assessment — SPEC-020-todos

**Proposer:** general(vasquez) — Engineering Owner (R1)
**Date:** 2026-09-25
**Domains-Touched:** R1 engineering (owner) · R2 security · R8 automation/ops

### Risk Matrix

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R-001 | App-side `parentId` filter over-fetches up to 400 rows (max 200*4 via `rawListTodos`) before filtering | Low | Low | Accepted residual until >1k children metric fires; owner R1, trigger `GET /memory/todos?parentId=` p95 with >1k hijos; next lane adds dedicated index if needed (SPEC R1) |
| R-002 | Hook heuristic false positives/negatives (keyword `TODO/decision/revisit/...` may miss or over-capture) | Medium | Low | Cap 3, low/medium only, dedup, never blocks, hook exit 0; bounded-initiative accepted (SPEC R2) |
| R-003 | Alias collision (`/agentmemory/` rewrites unintended routes) | Low | Low | Scoped rewriter: only `todos|frontier` rewrites to `/memory/`; remainder `/agentmemory/*` 404 (SPEC R3) |
| R-004 | BM25 tenant mismatch / search miss (no hit on `title` BM25) | Low | Low | Substring fallback on `title/description` icase over `rawListTodos(project,200)` guarantees recall; `todo_title nodeText` with tenant `project` verified via `g().createIndexIfNotExists` (SPEC A1) |
| R-005 | Hook fire-and-forget failure silently drops auto-todos | Medium | Low | By design never blocks session; `.catch(()=>undefined)` + `AbortSignal.timeout(1500)` bounds; agent still has MCP + REST creation vías; no session impact |

### Blast Radius

- **Systems:** Helix **dev** instance only (`storage="disk"` under `HELIX_DATA_DIR`, local `http://127.0.0.1:6969` / REST `3111`); additive 4 indexes, no new port, no new service.
- **Teams:** Engineering (R1) owns all changed surfaces; Security (R2) reviews bearer parity; Automation/Ops (R8) reviews hook detached behavior + plugin tool count — no other domain teams affected.
- **Customers / regulators / revenue:** **No cross-project**, no customer data plane, no multi-tenant surface, no external send beyond loopback `POST /memory/todos`; no revenue/billing path; no regulator filing. **No secrets** in code/config/logs/events/prompts/tickets/chats/commits — vault/env only (`AGENT_MEMORY_SECRET` passed as bearer header, never logged via `logSafeNote`), hook never logs prompt text (Ley 172-13 minimization, PII allowlist).
- **Timeout / availability:** Hook POSTs bounded `AbortSignal.timeout(1500)` (1.5s) each, `slice(0,3)`, fire-and-forget — cannot stall `Stop|SessionEnd|PreCompact|PostToolUse`.
- **Failure isolation:** REST/MCP/plugin failures are per-request isError (400 `parent todo not found` / `cannot be its own parent`) or transport error; no cascade to existing 243/123/137 suites.

### Rollback Plan

- **Code revert:** revert commits touching 7 files (`db/queries.ts`, `src/store.ts`, `src/server.ts`, `src/mcp.ts`, `plugins/opencode/plugins/agent-memory.ts`, `hooks/capture.mjs`, `scripts/bootstrap.ts`) via `git revert` (owner: general(vasquez), ETA <30 min).
- **Data rollback:** **drop `Todo` label** — delete all `Todo` nodes (`deleteTodo` per `todoId` or Helix label drop in dev) and remove 4 Todo indexes from bootstrap expectation (8→12 revert); no migration of prior data (label greenfield, name `todos` never `actions`, no upstream Actions to restore). No cross-project data to reconcile.
- **Config rollback:** no `helix.toml` shape change beyond `bootstrapIndexes` expectation — revert does not touch `helix.toml` or `package.json`/lockfile (zero-new-deps invariant holds).
- **Verification after rollback:** `npm run typecheck` 0, `npm run verify` 243, `verify-lifecycle` 123, `verify-capture` 137 (subtract Todo suites), `scripts/bootstrap.ts` 12→8 indexes.

### Security Considerations

- Auth: 6 REST routes under `/memory` share identical bearer guard with existing `/memory/*` (only `livez` exempt; 401 + `www-authenticate: Bearer` on mismatch); alias rewriter runs **before** guard. MCP bearer via `_meta.authorization="Bearer <secret>"` (`isMetaAuthorized`/`handle()`); plugin `Authorization` header only if `cfg.secret` set.
- Input validation: zod strict (`createTodoBodySchema strict`, `parentId 0..200`, `title 1..500`, `description 0..5000`, `limit 1..100 coerce`, enums `priority/status`), 400 on unknown field / empty title / bad enum; parent existence fail-closed via `getTodo` lookup → `HttpError 400 invalid_request`; no raw secret/PII in logs (`logSafeNote`).
- PII: Todo store purpose = follow-up, TTL none (dev), Ley 172-13 hooks only sanitize titles (`clean 0..120`), never raw prompt text; `SUPPORTED` set bounded.
- Secrets: vault/env only, scanned pre-push; hooks/MCP/plugin never log secret.

### Domain Considerations

- **Automation/ops (R8):** hook detached (`extractTodos` pure + fire-and-forget POST ≤3, `1500ms`, exit 0 always), plugin `memory/*` tool count `5→11` with `recallCache.clear()` on mutations, no pipeline change requiring security+platform gate weakening.
- **Engineering (R1):** HelixDB v3 only, Node ≥20 builtins, `never kill upstream` (no signal to `3111/3112/3113`), over-fetch bounds documented.
- **Security (R2):** co-sign required for bearer-before-alias ordering + hook PII posture (see approvers).

### C2 budget note (REQ-002 — additive)

One-pass budget: a triggered challenge round runs exactly once, where pass = ≤3 questions (question 4/N+1 = FAIL, blocked), then terminal approve/reject; approver-requested re-grill ≤1 extra pass (total ≤2), then Retry N=2 → escalate orchestrator. Exit before decision = pause + recorded `grill: exited` + escalate, proposal stays unapproved. Blast-radius trigger pointer: any blast-radius line mentioning customers/regulators/revenue (with synonyms: users/clients/members/consumers, GDPR/Ley 172-13/authorities, pipeline/quota/money) fires the C2 round — independent scan rule applies even when prose says "internal only". In this proposal blast radius is **internal dev-only** with no customer/regulator/revenue mention, so C2 does not fire unless approver requests it. Rollback/approve-reject terminal preserved — the round challenges the plan, it never rewrites it. Glossary single source C1 (`skills/frame-intent/SKILL.md` §C1); canonical clauses single source people SPEC §4.

## C2 challenge hook (REQ-002 — additive, no new required section)

- Trigger checklist — challenge round fires on ANY: auth/data/API/PII surface; multi-domain scope; blast radius mentioning customers/regulators/revenue (synonyms fire: customers/users/clients/members/consumers; regulators/GDPR/Ley 172-13/authorities; revenue/pipeline/quota/money; independent blast-radius + API-surface scan fires even when prose says "internal only"); approver request.
- One-pass budget: exactly one budgeted round per trigger (pass = ≤3 questions; question 4 (N+1) = FAIL, blocked), then terminal approve/reject; approver-requested re-challenge ≤1 extra pass (total ≤2), then Retry N=2 → escalate orchestrator; pause/exit offered after the round. Exit before decision = pause + recorded `grill: exited` + escalate, proposal stays unapproved (no silent promote).
- Masking reminder: grill prompt + every export carry the people SPEC §4 masking clause ("Por tu privacidad: no compartas PII/secretos/tokens en esta ronda; enmascaramos todo export (Ley 172-13)."); allowlisted evidence only.
- Single source: glossary lives once in C1 (`skills/frame-intent/SKILL.md` §C1); opener/warmth/masking canonical wording lives in people SPEC §4 inserts 1–6 — this hook points there, never redefines.
