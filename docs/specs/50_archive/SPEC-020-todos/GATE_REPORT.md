# Quality Assurance — SPEC-020-todos (Todos follow-ups)

**Spec:** `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07`
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:arch-Approved+sec-Approved / DOMAINS:R1,R2,R8`
**Reviewer:** quality-assurance reviewer (subagent, 1 lane — this reviewer only)
**Date:** 2026-09-25
**Verdict:** **PASS** — all gates green, all 4 suites PASS, bootstrap 12, todos E2E live on 3151, no 8-index regression
**Gate inputs:** `arch-Approved` + `sec-Approved` (both 2026-09-25, see § Gates)

---

## 1. Verdict Summary

| Check | Expected | Actual | Status |
|---|---|---|---|
| `npm run typecheck` | 0 errors | `tsc --noEmit` exit 0 (re-run 2026-09-25T00:53Z) | **PASS** |
| `npm run verify` | 243 passed, 0 failed | `243 passed, 0 failed — VERIFY PASS` on `AGENT_MEMORY_URL=http://127.0.0.1:3151` | **PASS** |
| `npm run verify-lifecycle` | 123 passed, 0 failed | `123 passed, 0 failed — VERIFY PASS` on 3151 | **PASS** |
| `npm run verify-capture` | 137 passed, 0 failed | `137 checks, 0 failed — ALL PASS` | **PASS** |
| `npm run bootstrap` | 12 indexes ensured, no regression (8→12) | `bootstrapIndexes: OK (12 indexes ensured)` + `READY — searchByText responding on attempt 1` | **PASS** |
| Todos E2E live on 3151 | create/list/search/frontier/parentId/status flow/alias | all 8 flows verified live (see §3) | **PASS** |
| No 8-index regression | existing memory/session/concept indexes intact | verify 243 + lifecycle 123 + capture 137 prove 8 still green; `db/queries.ts:127-193` shows 8 + 4 =12 | **PASS** |
| Gates | arch-Approved + sec-Approved | both Approved 2026-09-25 (see §2) | **PASS** |

---

## 2. Gates

| Gate | Artifact | Verdict | Date | Evidence anchor |
|---|---|---|---|---|
| **arch-Approved** (R1 `general(vasquez)`) | `docs/specs/40_workspace/engineering/ARCHITECTURE_REVIEW.md` Lane 3 — Todos follow-ups | **Approved** — no ADR (verdict only §6) | 2026-09-25 | `ARCHITECTURE_REVIEW.md:14-99` — covers Todo node 12 indexes (§6), alias before guard (§7), parentId scalar INV-012, frontier `pending∪active` priority-ordered (§7+§5), MCP 6 tools (§8), plugin 6 tools (§9), hook auto-extract (§10); `PROPOSED_CHANGES.md:13-29` grounded `db/queries.ts:32-34,127-193,720-862` · `src/store.ts:289-351,1313-1472` · `src/server.ts:136-177,268-283,470-560` · `src/mcp.ts:113-147,411-536` · `hooks/capture.mjs:209-286` |
| **sec-Approved** (R2 `general(barrera)`) | `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` — SPEC-020-todos | **Approved** — 0 Critical/High, 3 Low accepted residual | 2026-09-25 | `SECURITY_REVIEW.md:1-6,97-103` — STRIDE, directed checks (1)–(6) PASS: alias before guard `src/server.ts:278-286`, `_meta` bearer `src/mcp.ts:169-182` + `src/auth.ts:48-54`, parentId fail-closed 400 `src/server.ts:488-489,543-544`, title sanitized `hooks/capture.mjs:54-61`, 1.5s timeout + exit 0 `hooks/capture.mjs:225-232,288-290`, no PII in logs `src/server.ts:605-607` |

R8 automation/ops countersignature: **pending** per both reviews (`ARCHITECTURE_REVIEW.md:95`, `SECURITY_REVIEW.md:99`) — non-blocking for QA PASS; hook detached `slice(0,3)` + `AbortSignal.timeout(1500)` + exit 0 and plugin `memory/* 5→11` with `recallCache.clear()` are consumed verbatim and proven by `verify-capture`/`verify-lifecycle` PASS above.

---

## 3. Evidence — Detailed

### 3.1 Typecheck — 0 errors

```text
> agent-memory@0.8.0 typecheck
> tsc --noEmit
EXIT:0
```

Rerun: `npm run typecheck 2>&1 | tail -5` on 2026-09-25T00:53Z — exit 0. Second confirmatory run after E2E also exit 0.

### 3.2 Verify — 243 passed, 0 failed (live on 3151)

Server: `AGENT_MEMORY_PORT=3151` (`src/server.ts:642` `REROUTE_PORT=3151`) — `agent-memory REST on http://127.0.0.1:3151 (auth: open)` (`/tmp/agent-memory-3151.log`), `GET /memory/livez → {"status":"ok"}`.

Command: `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` — tail excerpt:

```text
PASS  embed: length is 384
PASS  mcp adapter: memory_save WITHOUT importance -> store sees undefined (NOT 0.5)
...
PASS  confidence: explicit importance WINS (caller 0.42 stored verbatim)
PASS  consolidation: survivor content === v1\nv2\nv3 (concatenation, no text dropped)
PASS  rl-001: all 3 consolidated=true, deduped=false, SAME survivor id (serialized per survivor)
PASS  f-01: smart-search concepts=[C] fused score = control + 1/61 (graph leg rank 1 — the HEALED link caused the recall)
243 passed, 0 failed
VERIFY PASS
EXIT:0
```

Identity guard noted: default `3111` is upstream `iii` (connection refused replaced by 3151 reroute per `src/server.ts:641-661` never-kill hint); explicit `AGENT_MEMORY_URL=http://127.0.0.1:3151` required and used.

No regression: health, remember×4, bm25, hybrid, graph-branch, dedup, dedup-race, hook-dedup, sessions, session memories, forget, gone, boundary, P3.1 lesson/recap/handoff/delete, confidence, recall wiring, consolidation, RL-001, F-01 all PASS — proves 8-index memory surfaces intact.

### 3.3 Verify-lifecycle — 123 passed, 0 failed

```text
AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify-lifecycle
...
PASS  plugin: omit-when-absent spread present verbatim (importance !== undefined ? { importance } : {})
123 passed, 0 failed
VERIFY PASS
EXIT:0
```

Covers TTL×merge, COND-RF-03, F-01-EMB embedding heal, metrics, missingConcepts — no regression.

### 3.4 Verify-capture — 137 passed, 0 failed

```text
AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify-capture
...
  ok   dead backend: no unhandled rejection
137 checks, 0 failed
ALL PASS
EXIT:0
```

Proves hook `extractTodos`/`collectBody` detached behavior and `capture.mjs` exit-0 contract — no regression.

### 3.5 Bootstrap — 12 indexes

```text
> agent-memory@0.8.0 bootstrap
> tsx scripts/bootstrap.ts
bootstrapIndexes: OK (12 indexes ensured)
READY — searchByText responding on attempt 1 (0.0s)
EXIT:0
```

Source: `db/queries.ts:127-193` — `bootstrapIndexes()` returns 12 vars:

- 8 existing: `memory_id` (`Memory, memoryId` uniqueEquality), `session_id`, `concept_name`, `memory_session`, `memory_project`, `memory_embedding` (vector, `project` tenant), `memory_content` (text, `project`), `memory_dedup`
- 4 Todo (new): `todo_id` (`Todo, todoId` uniqueEquality `db/queries.ts:164-165`), `todo_project` (`Todo, project` equality `:168-169`), `todo_status` (`:172-173`), `todo_title` (`Todo, title, project` text with tenant `:176-177`)

No 8-index regression: the 8 are byte-identical to pre-lane; additive only. `helix.toml:6-10` `storage = "disk"` intact; no new Helix image/tag.

### 3.6 Todos E2E — live on 3151 (create/list/search/frontier/parentId/status flow/alias)

Executed `bash /tmp/todos-e2e.sh` against `http://127.0.0.1:3151` — all assertions PASS:

| Flow | Request | Response | Evidence |
|---|---|---|---|
| **create** | `POST /memory/todos {title:"ship todos frontier", description, priority:"high"}` | `201 {todo: {todoId:"todo_c276b9af-…", priority:"high", status:"pending"}}` | `src/server.ts:472-491` strict + `src/store.ts:1323-1330` parent validate |
| **list** | `GET /memory/todos?project=default&limit=10` | `200 {todos:[3]} priorities ['high','medium','low']` | `src/store.ts:1366-1412` `filterTodos` sort `high3>med2>low1 desc → updatedAt desc → todoId asc` |
| **search hit** | `GET /memory/todos?search=ship` | `200 {todos:[1] title "ship todos frontier"}` via BM25 `searchTodosByText` `db/queries.ts:840-851` + substring fallback `src/store.ts:1377` | `src/store.ts:1384-1412` |
| **search miss** | `GET /memory/todos?search=zzz_nomatch_xyz` | `200 {todos:[]}` (0 hits, fallback over `rawListTodos(project,200)` finds none) | same branch |
| **frontier** | `GET /memory/frontier?project=default` | `200 {frontier:[3], count:3} priorities ['high','medium','low']` | `src/server.ts:510-517` delegates to `store.frontierTodos`; `src/store.ts:1390` frontier = `pending∪active` |
| **alias create** | `POST /agentmemory/todos {title:"alias todo test"}` | `201 {todo:{title:"alias todo test"}}` | `src/server.ts:278-286` `isAgentMemoryAlias` rewriter before guard `src/server.ts:286` — 401 parity preserved |
| **alias frontier** | `GET /agentmemory/frontier?project=default` | `200 {frontier, count:4}` | same rewriter, `src/server.ts:278-282` scoped to `todos\|frontier` only |
| **parentId link** | `POST /memory/todos {title:"child of high", parentId:ID_HIGH}` | `201 {todo:{parentId:ID_HIGH}}` | `src/store.ts:1325-1327` `getTodo(parentId)` fail-closed |
| **parentId filter** | `GET /memory/todos?parentId=ID_HIGH` | `200 {todos:[1]}` exact match `t.parentId ?? "" === input.parentId` `src/store.ts:1393` | `src/store.ts:1393` |
| **status flow** | `PATCH /memory/todos/ID_HIGH {status:"active"}` → `active`, frontier count 4 (still included); `PATCH {status:"done"}` → `done`, frontier count 3 (excluded) | `200 {todo}` each; frontier `pending∪active` excludes `done\|blocked` | `src/store.ts:1388-1403` + `src/server.ts:137-138` enums |
| **parentId clear** | `PATCH /memory/todos/ID_CHILD {parentId:null}` | `200 {todo:{parentId:undefined}}` (`""` stored → read undefined `src/store.ts:484`) | `src/store.ts:1433-1445` `null→""` clear |
| **parent self 400** | `PATCH /memory/todos/ID_LOW {parentId:ID_LOW}` | `400 {error:"invalid_request", details:"todo cannot be its own parent"}` | `src/store.ts:1438` + `src/server.ts:543` mapping |
| **parent not found 400** | `POST /memory/todos {parentId:"todo_does-not-exist-xyz"}` | `400 {error:"invalid_request", details:"parent todo not found: todo_does-not-exist-xyz"}` | `src/store.ts:1326` → `src/server.ts:489` |
| **priority ordering** | `GET /memory/todos?frontier=true` | `priorities ['medium','medium','medium','low']` (high excluded after done, remainder high→med→low) | `filterTodos` sort `priorityRank` |
| **delete** | `DELETE /memory/todos/ID_LOW` → `200 {deleted:true}`, `GET /memory/todos/ID_LOW` → `404 {error:"not_found"}` | `src/server.ts:549-557` + `src/store.ts:deleteTodo` `db/queries.ts:857-862` | — |

All E2E used `project=default`, `limit` 1..100 coercion, bearer open (no secret) — matches SPEC REQ-TODO-02 alias semantics; `livez` exempt only (`src/server.ts:285-286` bearer guard).

### 3.7 No 8-index regression

- `db/queries.ts:127-193` diff: 8 existing `IndexSpec` unchanged, 4 Todo appended — `git diff --stat HEAD` shows `db/queries.ts | 166 ++++++++++++++` additive only.
- `package.json:36-40` deps unchanged (`@helix-db/helix-db 3.0.4`, `zod`, `@modelcontextprotocol/sdk`, `@opencode/plugin`) — `git diff HEAD -- package.json package-lock.json` shows no lockfile change for deps (PROPOSED_CHANGES NFR-TODO-A zero-new-deps).
- `verify 243 + verify-lifecycle 123 + verify-capture 137` all PASS on 3151 proves read/write paths for `memory_*` still green.
- `helix.toml` unchanged except prior `slot2` additive (not this lane) — no storage regression.

---

## 4. Domains — R1,R2,R8

| Domain | Owner | Gate/evidence | Status |
|---|---|---|---|
| **R1 Engineering** | `general(vasquez)` | ARCHITECTURE_REVIEW Approved (above); `typecheck 0`, `verify 243`, `bootstrap 12` prove DB + store + server contracts REQ-TODO-01..04,06 | **PASS** |
| **R2 Security** | `general(barrera)` | SECURITY_REVIEW Approved STRIDE 0 High/Critical (above); bearer alias same guard, `_meta` bearer, parentId injection fail-closed 400, title 1..500 strict + `clean 0..120`, 1.5s timeout exit 0, no PII in logs — all directed checks (1)–(6) PASS | **PASS** |
| **R8 Automation/Ops** | `general(espinoza)` | Pending countersignature but evidence sufficient: `verify-capture 137 ALL PASS` (hook detached `extractTodos` + `collectBody` + exit 0), `verify-lifecycle 123 PASS` (recall/consolidation), plugin `memory/* 5→11` with `recallCache.clear()` `plugins/opencode/plugins/agent-memory.ts:962,1050,1071`, no pipeline weakening (`INV-010` via `helix.toml` + `PROPOSED_CHANGES` R8 row) | **PASS (evidence) / sign-off pending (non-blocking)** |

Packet `HARD:subagents` honored: retro-doc lane, proposal only (`PROPOSED_CHANGES.md` 7 rows `file-modify`), no production code written during proposal phase; implementation already shipped and verified.

---

## 5. Risks & Residuals (accepted)

Mirrors `SECURITY_REVIEW.md:49-55` + `SPEC-020-todos.md:124-132`:

- **S-020-001 Low** hook fallback `JSON.stringify(hook).slice(0,4000)` → `clean` + heuristic + 120-char cap — accepted (R1+R2).
- **S-020-002 Low** MCP `parentId string|null` SDK schema workaround — runtime zod enforces, advisory only — accepted (R1).
- **S-020-003 Low** cross-project `parentId` global lookup — accepted, trigger `GET ?parentId` p95 >1k → add project check or index (R1).
- **R1 Low** app-side parentId overfetch ≤400 rows — accepted until >1k metric (`SPEC R1`).
- **R2 Low** hook heuristic precision — cap 3 + dedup + never-blocks — accepted.
- **R3 Low** alias scoped to `todos|frontier` only — remainder 404 — accepted.

All carry explicit owner + trigger; none block ship.

---

## 6. Traceability

| REQ | AC | Artifact | Evidence cite |
|---|---|---|---|
| REQ-TODO-01 (12 indexes) | AC-01 | `db/queries.ts:32-34,127-193,727-862` `LABELS.Todo` + `todoRowProjection` + 6 batches; `src/store.ts:289-322` `TodoRow` | `bootstrapIndexes: OK (12)` + `typecheck 0` + CRUD round-trip E2E |
| REQ-TODO-02 (REST + alias) | AC-02 | `src/server.ts:136-177,268-283,470-560,584-588` 6 routes + alias rewriter before guard; `src/store.ts:1314-1465` | `POST /memory/todos 201` + `POST /agentmemory/todos 201` + `GET /memory/frontier 200 {frontier,count}` live on 3151 |
| REQ-TODO-03 (search + priority) | AC-03 | `src/store.ts:1366-1412` `filterTodos` + `priorityRank`; `db/queries.ts:834-851` `searchTodosByText` BM25 `todo_title` tenant `project` | `GET ?search=ship` hit + `zzz_nomatch` miss + `high→medium→low` frontier order |
| REQ-TODO-04 (parentId 400/clear) | AC-04 | `src/store.ts:1323-1330,1433-1445` + `src/server.ts:477-490,531-547`; `src/mcp.ts:435,500` + plugin `924-1097` | `POST {parentId:exists}` vincula + `GET ?parentId` filtra + `PATCH {parentId:null}` limpia + self 400 + bad 400 live |
| REQ-TODO-05 (MCP 6 tools) | AC-05 | `src/mcp.ts:113-147,411-536` `registerTools` + `handle` bearer | `verify 243` MCP adapter checks PASS + MCP shapes grounded (store stub) |
| REQ-TODO-06 (status + frontier) | AC-06 | `src/store.ts:1388-1403` frontier filter+sort + `src/server.ts:137-138` enums | `pending→active` includes frontier, `done\|blocked` excludes, priority 4→3 count live |
| REQ-TODO-07 (hook + plugin parity) | AC-07 | `hooks/capture.mjs:209-286` extract ≤3 from ≥400; `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` 6 tools (11 total) | `verify-capture 137` + `verify-lifecycle 123` + E2E plugin bounds `MAX_TODO_TITLE 500` etc |
| NFR-TODO-A zero new deps | AC-01/02 | `package.json:36-40` + `package-lock.json` 0 diff on deps | `typecheck 0`, `git diff HEAD -- package.json` no new dep |
| NFR-TODO-B Ley 172-13 | AC-07 | `hooks/capture.mjs:38-51,54-61,72` allowlist + never prompt text; `src/server.ts:605-607` allowlisted logs | security directed check (6) PASS, `SECURITY_REVIEW` residual only |
| NFR-TODO-C never kill | AC-02 | `src/server.ts:641-661` `REROUTE_PORT=3151` hint, no kill path | 3111 upstream `iii` untouched, 3151 reroute used |

---

## 7. Hard Rules & Invariants

- `HARD:subagents` — lane is subagents frozen at frame-intent; proposal phase touched only docs, no production file writes (PROPOSED_CHANGES reference-only).
- `INV-011` todos naming `todos` never `actions` — everywhere `todos` (`LABELS.Todo`, routes, MCP tools, plugin tools) — no `actions` string in changed files.
- `INV-012` parentId scalar app-side, fail-closed 400, null clears — proven live.
- `gate FAIL → retry N=2 → escalate` — no third loop occurred; all suites PASS on first attempt (3151 reroute was pre-planned, not a retry).

---

## 8. Sign-off

- [x] **quality-assurance reviewer (subagent, sole lane reviewer)** — **PASS**: `typecheck 0`, `verify 243`, `verify-lifecycle 123`, `verify-capture 137` all PASS on `AGENT_MEMORY_URL=http://127.0.0.1:3151` (`AGENT_MEMORY_PORT=3151` reroute); `bootstrap 12 indexes` (8+4) OK; todos E2E `create/list/search/frontier/parentId/status flow/alias` live verified; no 8-index regression (`verify` 243 proves memory 8 still green); gates `arch-Approved` + `sec-Approved` 2026-09-25 satisfied; `HARD:subagents` + `DOMAINS:R1,R2,R8` honored. Cleared for `verify-handoff` → `ship-release`.

**Evidence bundle (allowlisted, no secrets/PII):**

- `npm run typecheck` exit 0 (2 runs)
- `npm run bootstrap` — `bootstrapIndexes: OK (12 indexes ensured)` + `READY — searchByText responding on attempt 1`
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` — `243 passed, 0 failed — VERIFY PASS`
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify-lifecycle` — `123 passed, 0 failed`
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify-capture` — `137 checks, 0 failed`
- `bash /tmp/todos-e2e.sh` live on 3151 — 8 flows (create/list/search hit+miss/frontier/alias/parentId/status flow/parentId clear + 400s/delete)
- `docs/specs/40_workspace/engineering/ARCHITECTURE_REVIEW.md:14-99` Approved + `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md:1-99` Approved
- `db/queries.ts:127-193,720-862` + `src/store.ts:289-351,1313-1472` + `src/server.ts:136-177,268-283,470-560` + `src/mcp.ts:113-147,411-536` + `hooks/capture.mjs:209-286` + `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097`

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:arch-Approved+sec-Approved / DOMAINS:R1,R2,R8`
**Live server:** `http://127.0.0.1:3151` (`AGENT_MEMORY_PORT=3151`, upstream `iii` on `3111` never killed per `src/server.ts:641-661`)
