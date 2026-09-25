# Security Review — SPEC-020-todos (quality-gate)

**Spec:** `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07`
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:arch-Approved / DOMAINS:R1,R2,R8`
**Reviewer:** security-reviewer (R2, `general(barrera)` — 1 reviewer only, did NOT author implementation)
**Date:** 2026-09-25
**Verdict:** **PASS** — 0 Critical / 0 High / 0 Medium; 3 Low accepted residual (no blocking conditions). STRIDE re-check on alias guard, _meta bearer, parentId validation, no secrets/PII all PASS.

---

## 1. Scope & Inputs

| Input | Artifact |
|---|---|
| Spec | `docs/specs/20_backlog/SPEC-020-todos.md` REQ-TODO-01..07 + NFR-TODO-A..D |
| Architecture gate | `docs/specs/40_workspace/engineering/ARCHITECTURE_REVIEW.md:14-99` — Lane 3 Approved, no ADR (§6) |
| Prior security opinion | `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md:1-103` — Approved 2026-09-25, 0 High/Critical, 3 Low accepted |
| Code (reference-only, read) | `src/server.ts:136-177,268-286,470-560,583-613` · `src/store.ts:289-351,1313-1454` · `src/mcp.ts:113-147,169-182,411-536` · `db/queries.ts:32-34,127-193,720-862` · `hooks/capture.mjs:38-61,209-286,288-290` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` · `src/auth.ts:15-54` · `src/errors.ts:63-73` |
| QA evidence (consumed) | `docs/specs/40_workspace/quality-gate/SPEC-020-todos/quality-assurance.md:1-218` — typecheck 0, verify 243, verify-lifecycle 123, verify-capture 137, bootstrap 12, E2E 8 flows on 3151 |

Retro-doc lane: implementation already shipped and verified live. This gate is a **re-check** (STRIDE) of the four packet focuses; it does not re-decide R1 architecture (arch-Approved carried).

---

## 2. STRIDE Re-check — Packet Focuses

### Spoofing — alias guard & _meta bearer

| Check | Result | Evidence |
|---|---|---|
| **Alias guard: `/agentmemory/todos*` and `/agentmemory/frontier*` rewrite before bearer** — same guard as `/memory/*`, only `livez` exempt, 401 + `www-authenticate: Bearer` on mismatch | **PASS** | `src/server.ts:278-286` scoped rewriter `path.startsWith("/agentmemory/") && (path.startsWith("/agentmemory/todos") \|\| path.startsWith("/agentmemory/frontier"))` → `path.replace("/agentmemory/","/memory/")` **before** `src/server.ts:286` `isBearerAuthorized(req.headers.authorization, secret)` → `res.setHeader("www-authenticate","Bearer")` + 401. Remainder `/agentmemory/*` not rewritten → `!path.startsWith("/memory/") → 404` `src/server.ts:285` — no wider bypass. Parity proven live: QA E2E `POST /agentmemory/todos 201` and `GET /agentmemory/frontier 200 {frontier,count}` `quality-assurance.md:127-128` used same open/401 semantics as `/memory/*`. |
| **_meta bearer: MCP stdio `_meta.authorization = "Bearer <secret>"`** — constant-time, fail-closed, never leaks | **PASS** | `src/mcp.ts:169-182` single `handle(name,meta,op)` gate calls `isMetaAuthorized(meta,secret)` `src/auth.ts:48-54` (typeof/Record check + `bearerMatches` `src/auth.ts:21-27` `timingSafeEqual` with length pre-check) → unauth throws `McpError(ErrorCode.InvalidRequest,"unauthorized")`; catch → `console.error([agent-memory mcp] name: logSafeNote)` + `isError` `src/mcp.ts:179-181`, never crashes, never logs secret/content. All 6 todo tools (`memory_todo_create/list/get/update/delete`, `memory_frontier` `src/mcp.ts:412-536`) route through `handle`. stdout = protocol only `src/mcp.ts:11`. Parity with REST `isBearerAuthorized` `src/auth.ts:33-41` identical `bearerMatches`. |

### Tampering — parentId validation (fail-closed, no injection)

| Check | Result | Evidence |
|---|---|---|
| **parentId bounds + injection impossible + fail-closed 400 + self-parent 400 + null clears** | **PASS** | Bounds: zod `parentIdSchema z.string().trim().min(1).max(200)` `src/server.ts:139` + `src/mcp.ts:122,130,139` + plugin `MAX_TODO_ID 200` `plugins/opencode/plugins/agent-memory.ts:108-110` + store `trim().slice(0,200)` `src/store.ts:1323,1436`. Helix binding only via `defineParams` + `PropertyInput.param("parentId")` / `eqParam` `db/queries.ts:741,779,793,806,853,857` — no string concat, no AST injection. Fail-closed: create `parentId!==""` → `getTodo(parentId).catch(()=>undefined)` `src/store.ts:1326` → undefined throw `parent todo not found: ${parentId}` → route `HttpError 400 invalid_request` `src/server.ts:488-489`; update same + `parentId===todoId → cannot be its own parent` `src/store.ts:1438` → 400 `src/server.ts:543` + `src/mcp.ts:435,500` `failed({error:msg})`. `PATCH {parentId:null}` → `parentId=""` `src/store.ts:1434` stored `""` read as `undefined` `src/store.ts:484`. `GET ?parentId=` exact `t.parentId ?? "" === input.parentId` `src/store.ts:1393` + zod `src/server.ts:170` + `strict()` body 400 `src/server.ts:141,153`. E2E live: `POST {parentId:exists} 201` + `GET ?parentId` filter + `PATCH {parentId:null} cleans` + `PATCH self 400 "cannot be its own parent"` + `POST bad 400 "parent todo not found"` `quality-assurance.md:129-133` `src/server.ts:489,543`. |

### Information Disclosure — no secrets/PII in code, logs, events, prompts

| Check | Result | Evidence |
|---|---|---|
| **No secrets in code/logs/examples/events/prompts/tickets/commits; vault/env only; never PII; Ley 172-13 minimization** | **PASS** | **Secrets:** `secretFromEnv()` non-empty arms guard `src/auth.ts:15-18` + `src/server.ts:666`; bearer rides only in `Authorization` / `_meta.authorization` headers/metadata `src/mcp.ts:7-9,18,174` `src/server.ts:7-8,286` `hooks/capture.mjs:198-201,220-221` `plugins/...:278-303` (`call()` adds `Authorization` header) — never in code, config, logs, examples, events. Server never echoes value: listen line `auth: open\|bearer-required` only `src/server.ts:677-680`; EADDRINUSE hint is ports/commands only `src/server.ts:651`. **PII (Ley 172-13):** `UserPromptSubmit` stores fixed `"user prompt submitted"` `hooks/capture.mjs:72` — `hook.prompt` never touched; other hook payloads use allowlist `clean()` `hooks/capture.mjs:54-61` (control-char→space, `\s+` collapse, trim, slice 0..120) for titles `hooks/capture.mjs:246` + fixed `description="auto-extracted from session"`. Access log allowlisted `method pathname status duration` only `src/server.ts:605-607` via `pathnameOf(req)` slicing before `?` `src/server.ts:258-262` — no bodies/query/headers/secrets. 500 path uses `logSafeNote` `src/errors.ts:63-73` (remote→code only, never secret/content). MCP stderr sanitized `src/mcp.ts:180` `logSafeNote`; stdout protocol-only `src/mcp.ts:544`. `bootstrapIndexes` never logs PII. No `grep -R secret\|Authorization` hits outside header construction (see shell grep above). |

### STRIDE — remaining threats (no new surface)

| Threat | Applicable | Disposition |
|---|---|---|
| **Repudiation** | Low | Todos are bounded-initiative single-process, not governed by purge `reason` audit line. Mutations return `{todo}`/`{deleted:true}` synchronously; `recallCache.clear()` on create/update/delete `plugins/opencode/plugins/agent-memory.ts:962,1050,1071`. Hook fire-and-forget loss (cap 3, 1.5s) is by-design; never-blocks. No action. |
| **Denial of Service** | Yes | `MAX_BODY_BYTES 1_048_576` + `content-type: application/json required` 415→413→400 `src/server.ts:221-243`; zod limits `title 500/description 5000/limit 1..100/search 500` `src/server.ts:136-177`; `listTodos` overfetch bounded `max(limit*4,100)` ≤400 `src/store.ts:1384`; hook `AbortSignal.timeout(1500)` `hooks/capture.mjs:231` × `slice(0,3)` + `process.exit(0)` guarantees `src/capture.mjs:50-51,288-290` always exit 0, never blocks `Stop\|SessionEnd\|PreCompact\|PostToolUse`. Never-kill upstream: no signal to 3111/3112/3113 `src/server.ts:641-661` `REROUTE_PORT=3151`. PASS. |
| **Elevation of Privilege** | Yes | Tenant scoping `project` via `todo_project nodeEquality(project)` + `todo_title nodeText(title,project)` `db/queries.ts:168-177` + `where eqParam("project")` `db/queries.ts:784-785` + `textSearchWith(...,project)` `db/queries.ts:842-847`; all routes default `project="default"` `src/server.ts:470-517`. Alias preserves `URL.project` query before guard. Cross-project `parentId` global lookup `src/store.ts:1326,1439` vs `db/queries.ts:797-803` is accepted Low S-020-003 (see §3) — no secret/embedding elevation, listing still project-scoped via `filterTodos` `src/store.ts:1393`. PASS with note. |

---

## 3. Findings

Severity per shared foundation: Critical = block · High = fix before next release · Medium = sprint · Low = hygiene/backlog. Critical/High surface same session with owner + evidence; residual explicit; no silent PASS. Accepted risks carry owner + trigger + expiry.

| ID | Severity | Finding | Evidence | Owner | Disposition |
|---|---|---|---|---|---|
| S-020-001 | **Low** | Hook `collectBody` fallback `JSON.stringify(hook).slice(0,4000)` widest body source before heuristic; a hook field carrying token could enter `body` string before `clean` + keyword + 120-char + 5→dedup→3 + never-log gates filter it. | `hooks/capture.mjs:262-286` fallback → `extractTodos` `hooks/capture.mjs:242-259` `clean(line,120)` + regex `^(TODO\|FIXME\|HACK\|decision\|revisit\|inspect\|blocked on\|follow-?up)` / `\b(should\|need to\|must\|blocked\|revisit)` | R1 + R2 | **Accepted residual.** Hardening non-blocking: skip fallback when keys match `secret\|token\|authorization` or add replacer excluding `AGENT_MEMORY_SECRET`. No GATE. |
| S-020-002 | **Low** | MCP `memory_todo_update` `parentId: {type:["string","null"]}` workaround (`as unknown as string`) could mis-advertise in `tools/list` JSON Schema; runtime zod `z.union([z.string().trim().min(1).max(200), z.null()])` `src/mcp.ts:130` still enforces server-side. | `src/mcp.ts:124-131` vs `plugins/opencode/plugins/agent-memory.ts:1031`; `src/server.ts:159` | R1 | **Accepted.** Zod is the guard; schema is advisory. Non-blocking. |
| S-020-003 | **Low** | Cross-project parentId link permitted (global `getTodo(parentId)` no project filter) — `project=A` child can reference `project=B` parent if UUID known. Random `todo_${uuid}` not enumerable; listing still project-scoped `filterTodos` `src/store.ts:1393`. | `src/store.ts:1325-1327,1439-1440` vs `db/queries.ts:797-803` global lookup; SPEC §6 R1; prior review S-003 | R1 | **Accepted residual** with trigger: `GET ?parentId` p95 >1k children or multi-tenant complaint → enforce `parent.project === input.project` or add `parentId+project` index. No GATE. |

**Counts: 3 findings — 0 Critical · 0 High · 0 Medium · 3 Low (all accepted).** No new finding beyond `SECURITY_REVIEW.md:73-80` — this gate re-confirms that set and its triggers.

---

## 4. Directed Checks — Packet Checklist (re-verified)

**(1) alias guard / `agentmemory/todos` same guard — PASS.** `src/server.ts:278-286` rewriter-before-guard; `src/server.ts:286` `!isBearerAuthorized → 401 + www-authenticate: Bearer` `src/auth.ts:33-41` constant-time; scoped to `todos|frontier` only.

**(2) _meta bearer — PASS.** `src/mcp.ts:169-182` `handle(_meta)` + `src/auth.ts:48-54` `isMetaAuthorized` + `timingSafeEqual` `src/auth.ts:21-27`; all 6 todo tools through it.

**(3) parentId validation — PASS (fail-closed).** `parentIdSchema 1..200` + `defineParams`/`PropertyInput.param` prevents Helix injection; `parent todo not found` → 400 `src/server.ts:488-489`; `cannot be its own parent` → 400 `src/server.ts:543`; `null` clears `src/store.ts:1434`.

**(4) no secrets/PII — PASS.** No secret in code/logs/events/prompts (`grep` above: headers only); `logSafeNote` `src/errors.ts:63-73` remote→code only; access log allowlisted `src/server.ts:605-607` `pathnameOf`; hook allowlist `hooks/capture.mjs:72` fixed string for `UserPromptSubmit` + `clean` `hooks/capture.mjs:54-61`; titles `clean(0..120)` `hooks/capture.mjs:246` description fixed.

Supporting: **title sanitized** — `title 1..500 strict` `src/server.ts:141-151` + hook `clean 0..120`; **1.5s hook timeout always exit 0** — `AbortSignal.timeout(1500)` `hooks/capture.mjs:231` ×3 + `process.on(uncaughtException/unhandledRejection→exit 0)` + `main().catch(()=>undefined).finally(()=>process.exit(0))` `hooks/capture.mjs:50-51,288-290`.

---

## 5. Residual Risk (accepted, owner stated)

- **S-020-001 Low** hook fallback stringify → mitigated by `clean` + heuristic + cap + dedup + never-log — accepted R1+R2.
- **S-020-002 Low** MCP `parentId string|null` SDK schema advisory — runtime zod enforces — accepted R1.
- **S-020-003 Low** cross-project `parentId` — accepted R1, trigger p95 >1k or tenant isolation request.
- Plus SPEC Rs: **R1 Low** app-side parentId overfetch ≤400 rows `src/store.ts:1384` until >1k; **R2 Low** hook heuristic precision cap 3 + dedup + never-blocks; **R3 Low** alias scoped `todos|frontier` only.

All carry explicit owner + trigger; none block ship. No silent PASS.

---

## 6. Verdict Rationale

STRIDE re-check complete against reference-only implementation. Directed checks (1)–(4) all PASS with allowlisted evidence; no new Critical/High/Medium beyond the prior Approved review. Three Lows are explicitly accepted residuals with owners and triggers; they do not violate HARD `subagents` or DOMAINS `R1,R2,R8`.

**GATE: arch-Approved already satisfied** (`ARCHITECTURE_REVIEW.md` Lane 3) — this review does not re-decide R1 and is consistent with it.

---

## 7. Sign-off

- [x] **security-reviewer (R2, `general(barrera)` — sole reviewer of this gate):** **PASS.** STRIDE re-check on alias guard, _meta bearer, parentId validation, no secrets/PII all PASS per allowlisted evidence above. 0 Critical/High to block. Cleared for `verify-handoff` → `ship-release`; no waiver required. Residual Lows explicitly accepted (S-020-001..003).

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:arch-Approved / DOMAINS:R1,R2,R8`
**Evidence anchors (scoped, no secrets/PII):** `src/server.ts:136-177,268-286,470-560,583-613` · `src/store.ts:289-351,1313-1454` · `src/mcp.ts:113-147,169-182,411-536` · `db/queries.ts:32-34,127-193,720-862` · `hooks/capture.mjs:38-61,209-286,288-290` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` · `src/auth.ts:15-54` · `src/errors.ts:63-73`
**Commit:** left to orchestrator (lane synthesis)
