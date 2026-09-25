# Release Notes: v0.9.0

**Date:** 2026-09-25
**Release Manager:** orchestrator (Montilla, CEO) — ship mechanics by operations/engineering per ship-release role binding — role assumption stated for this lane
**Specs Included:** SPEC-020-todos — Todos follow-ups para agentes (bounded-initiative, BRIEF-todos approved 2026-09-25) — `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07`
**Domains-Touched:** engineering (R1, owner vasquez) · security (R2) · automation/ops (R8) (finance / legal / marketing / people / revenue: **N/A** — local developer tool, no billing/quota/compliance surface)
**Ship Type:** deploy (minor, new Todo entity 12 indexes; additive REST/MCP/plugin/hook; no breaking change; version 0.8.0 → 0.9.0 across 6 carriers + tag v0.9.0)

## Highlights

- **Todo node + 12 indexes (`db/queries.ts:32-34,127-193,720-862` + `src/store.ts:289-351`).** Label `Todo` — `{todoId,title 1..500, description 0..5000, priority low|medium|high (default medium), status pending|active|done|blocked (default pending), project, sessionId, createdAt, updatedAt, parentId?}`. `bootstrapIndexes()` 12 = 8 existing (memory/session/concept) + 4 Todo: `todo_id nodeUniqueEquality(Todo,todoId)`, `todo_project nodeEquality(Todo,project)`, `todo_status nodeEquality(Todo,status)`, `todo_title nodeText(Todo,title,project)` tenant `project`; `todoRowProjection` `$id→id + 9 fields` with `parentId=""→undefined` on read; 6 builders `saveTodo/listTodos/getTodoById/updateTodo/searchTodosByText/deleteTodo` via `defineParams` param binding (no string concat); zero new deps.
- **REST CRUD + frontier + alias (`src/server.ts:136-177,268-283,470-560`).** `POST /memory/todos 201 {todo}`, `GET /memory/todos?project&limit=1..100&status&priority&search&frontier&parentId 200 {todos}`, `GET /memory/todos/:id 200/404`, `PATCH /memory/todos/:id {parentId:string|null} 200/404/400`, `DELETE /memory/todos/:id 200/404`, `GET /memory/frontier 200 {frontier,count}` — all under `/memory` bearer guard identical to other `/memory/*` (only `livez` exempt, 401+`www-authenticate: Bearer` on mismatch). Alias `isAgentMemoryAlias` rewrites `/agentmemory/todos*` and `/agentmemory/frontier*` → `/memory/*` **before** guard (compat `POST http://localhost:3111/agentmemory/todos` screenshot), scoped to `todos|frontier` only (remainder `/agentmemory/*` 404); defaults `project="default" limit=10 sessionId=""`, strict zod, `parentIdSchema 1..200`, body `MAX_BODY_BYTES 1_048_576` 415/413/400.
- **Search & priority ordering (`src/store.ts:1366-1412` + `db/queries.ts:834-851`).** `GET /memory/todos?search=<q>` → BM25 `searchTodosByText(q,project,limit)` (`todo_title` tenant `project`) → `filterTodos` else fallback substring `title/description` case-insensitive over `rawListTodos(project,200)` if 0 hits; branch without `search` → `rawListTodos(project,max(limit*4,100))` then `filterTodos` then `slice(limit)`. `filterTodos` exact `status/priority/parentId/frontier(pending|active)` + sort `priorityRank(high3>med2>low1) desc → updatedAt localeCompare desc → todoId asc`; `GET /memory/frontier` and `GET ?frontier=true` are same `pending∪active` priority-ordered set; `limit` 1..100 via zod coerce; over-fetch bounded ≤400.
- **parentId optional hierarchy — 400 fail-closed/clear (`src/store.ts:1323-1445`).** `POST {parentId:<exists>}` links via `getTodo(parentId)` lookup → 400 `parent todo not found: <id>` if missing; `PATCH {parentId:null}` clears (`""` stored → read `undefined` `src/store.ts:484`); `PATCH {parentId:self}` → 400 `todo cannot be its own parent`; `GET ?parentId=` exact `parentId ?? "" === input.parentId`; bounds `MAX_TODO_ID 200`, `defineParams` binding prevents injection; cross-project parentId global lookup accepted Low S-020-003 (random `todo_${uuid}` not enumerable, listing still project-scoped).
- **MCP 6 tools (`src/mcp.ts:113-147,411-536`).** `memory_todo_create` (title 1..500 req + parent validate → isError `parent todo not found`/`title is required`), `memory_todo_list` (filters project/limit 1..100/status/priority/search 0..500/frontier bool/parentId), `memory_todo_get`, `memory_todo_update` (todoId+patch `parentId string|null` ≥1 field), `memory_todo_delete`, `memory_frontier` (project,limit) — all via shared `handle(name,_meta,op)` bearer `_meta.authorization="Bearer <secret>"` (`isMetaAuthorized` constant-time `timingSafeEqual`) → unauth `McpError InvalidRequest` isError + `logSafeNote`; `readOnlyHint/destructiveHint`; `todos` everywhere never `actions`; stdout MCP only.
- **Plugin 6 tools (`plugins/opencode/plugins/agent-memory.ts:108-111,924-1097`).** Namespace `memory` codemode `memory/todo_create|list|get|update|delete|frontier` (total `memory/*` = 11 = 5 prev + 6 todos) mirroring MCP bounds `MAX_TODO_TITLE 500/MAX_TODO_DESC 5000/MAX_TODO_ID 200` and `parentId string|null` null-cleans; `todo_create` defaults `project=cfg.project sessionId=toolContext.sessionID`; `todo_list/frontier` `URLSearchParams` with all filters; `todo_update` ≥1 field; `call()` bearer `Authorization` if `cfg.secret`; `recallCache.clear()` on create/update/delete; version `0.9.0`.
- **Hooks auto-extract 3×1.5s (`hooks/capture.mjs:209-286`).** `extractTodos(event,hook)` gated `Stop|SessionEnd|PreCompact|PostToolUse`; `collectBody` from `transcript,session_body,body,content,prompt.text,tool_output,result` or array join or `JSON.stringify(hook).slice(0,4000)` fallback; `body.length<400→0`; lines 12..200 chars; heuristic `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → medium `{title:clean 0..120, description:"auto-extracted from session"}` else long line `should|need to|must|blocked|revisit` → low; cap 5→dedup icase→return; `main()` fire-and-forget `slice(0,3)` `POST /memory/todos` `AbortSignal.timeout(1500)` each `.catch(()=>undefined)` bounded 1.5s×3, bearer if `AGENT_MEMORY_SECRET`, always exit 0 (`process.on uncaughtException/unhandledRejection → exit 0` + `finally(()=>process.exit(0))`), never logs prompt text nor secret.
- **Verification bar (QA PASS).** `typecheck 0` · `verify 243/0` · `verify-lifecycle 123/0` · `verify-capture 137/0` · `bootstrap 12` + todos E2E 8 flows live on `http://127.0.0.1:3151` (`AGENT_MEMORY_PORT=3151` reroute, upstream `3111` never killed): `POST /memory/todos 201` + `POST /agentmemory/todos 201` alias + `GET ?search=ship` hit + `zzz_nomatch` miss + `GET /memory/frontier {frontier,count}` + alias frontier + `POST {parentId:exists}` + `GET ?parentId` + `PATCH {parentId:null}` clear + self 400 + bad 400 + `PATCH status done|blocked` excludes frontier; no 8-index regression (`verify` 243 proves memory 8 still green).

## Contract

`docs/specs/10_design/ARCHITECTURE.md` v2 already canonical for this lane — `§6` DB 12 indexes, `§7` REST 6 routes + alias before guard + `filterTodos` sort, `§8` MCP 6 tools via `handle(_meta)`, `§9` plugin 6 tools total 11, `§10` hook `Stop|SessionEnd|PreCompact|PostToolUse` `collectBody ≥400` + cap 5→3 + 1.5s; Data Flow §5 Todos lifecycle `POST → BM25+fallback → filterTodos → frontier`; INV-011 `todos` never `actions` + INV-012 `parentId` app-side fail-closed 400 null-clears. No migration, no breaking change — additive only via `bootstrapIndexes`.

## Known Issues

- **Six Low residuals accepted (owner+trigger, non-blocking):** S-020-001 hook fallback `JSON.stringify(hook).slice(0,4000)` → `clean`+heuristic+120-char+never-log (R1+R2, harden: skip fallback on `secret|token|authorization`); S-020-002 MCP `parentId string|null` SDK schema `as unknown as string` advisory (R1, runtime zod enforces); S-020-003 cross-project `parentId` global lookup `getTodo(parentId)` no project filter (R1, trigger p95>1k or multi-tenant complaint → add `parent.project` check or `parentId+project` index) — plus SPEC R1 app-side parentId overfetch ≤400 rows until >1k metric → dedicated index, R2 hook heuristic precision cap 3+dedup never-blocks, R3 alias scoped `todos|frontier` only remainder 404. All declared in `SECURITY_REVIEW.md:49-55` + `security-reviewer.md:85-90` + `quality-assurance.md:161-171` + `SPEC-020-todos.md:124-132`. No Medium/High/Critical open.
- **Other push-forward (not at gate):** graph edges `PARENT_OF`, `todo_description` text index, dedicated `parentId` index, leases/signals, viewer UI — per SPEC §5 Out of Scope for P4.3.

## Verification

typecheck 0 · `verify` **243/0** (3151) · `verify-lifecycle` **123/0** · `verify-capture` **137/0** · `bootstrap` **12** `bootstrapIndexes: OK (12 indexes ensured)` + `READY — searchByText responding` · todos E2E **8 flows** live on 3151 (see Highlights) · `verify-env` **21/0** · `verify-skills --structural` **73/0** · no 8-index regression (`verify` 243 still green).

## Quality gate

5 independent reviews → **all PASS, 0 Critical/High/Medium, 0 conditional** → gate **OPEN**: `ARCHITECTURE_REVIEW.md` **Approved** no ADR (§6) + `SECURITY_REVIEW.md` **Approved** STRIDE 0 High/3 Low + `quality-assurance.md` **PASS** (all 4 suites + bootstrap 12 + 8 E2E) + `security-reviewer.md` **PASS** + `automation-reviewer.md` **PASS** (6/6: extract ≤3, 1.5s, exit 0, bootstrap 12, pipeline not weakened, dead-server exit 0). Cross-domain Engineering↔Security and Engineering↔Automation both PASS; Legal/Privacy N/A local tool (Ley 172-13 via output allowlist only). R8 countersignature pending per both arch/sec reviews but evidence sufficient (`verify-capture 137` + live dead-server exit 0) — non-blocking per `HANDOFF.md:131` gatekeeper.

## Rollback / Undo

Lane commits touching 7 files `db/queries.ts` `src/store.ts` `src/server.ts` `src/mcp.ts` `plugins/opencode/plugins/agent-memory.ts` `hooks/capture.mjs` `scripts/bootstrap.ts` (+ docs `ARCHITECTURE.md` v2 already canonical) tagged **v0.9.0** — rollback steps:

1. `git revert` range `db/queries.ts` `src/store.ts` `src/server.ts` `src/mcp.ts` `plugins/opencode/plugins/agent-memory.ts` `hooks/capture.mjs` `scripts/bootstrap.ts` (owner engineering, ETA <30 min) — reverts 4 Todo indexes (12→8), 6 REST routes + alias, BM25+fallback+sort, parentId hierarchy, 6 MCP + 6 plugin tools, hook extractTodos.
2. **Data rollback:** delete all `Todo` nodes (`deleteTodo` per `todoId` or Helix label drop in dev) and bootstrap expectation 12→8; no migration of prior data (label greenfield, `todos` never `actions`, no upstream Actions).
3. `git checkout -- docs/specs/10_design/ARCHITECTURE.md` reverts Todos §6-§10 only if not desired; otherwise retain v2 (canonical).
4. No `helix.toml` shape change beyond `bootstrapIndexes` expectation — no file to revert; `package.json`/`package-lock.json` 0.9.0→0.8.0 via `git checkout HEAD~1 -- package.json package-lock.json` (deps unchanged, zero new deps).
5. `npm run typecheck && npm run verify && npm run bootstrap` proves clean 8 indexes, 243 still green. Check out tag **v0.8.0** for full undo. No schema migration beyond Todo label; volumes retained. Owner: engineering + orchestrator. ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence only (ports, counts, PIDs, verdicts, `~`-collapsed paths, owners by role); `AGENT_MEMORY_SECRET` presence-only (`armed|unset` / `present|missing`); hook titles `clean 0..120` + fixed `description="auto-extracted from session"` never prompt text; access log `src/server.ts:605-607` `method pathname status duration` via `pathnameOf` slicing before `?`; `logSafeNote` `src/errors.ts:63-73` remote→code only; `UserPromptSubmit` fixed string `hooks/capture.mjs:72` never `hook.prompt`; `verify-capture` privacy canaries `348-358,416-419` PASS.

---

# Release Notes: v0.8.0

**Date:** 2026-09-24
**Release Manager:** orchestrator (Montilla, CEO) — ship mechanics by operations/engineering per ship-release role binding — role assumption stated for this lane
**Specs Included:** P4 ops control-plane — CLI binary + slot derivation + data-dir state-path (SPEC-P4-OPS + SPEC-P4-OPS-RUNBOOK) — `ROADMAP.md` §P4 **P4.1/P4.3 CLOSED**, **P4.4 DONE* partial (A3 FAIL framing 3b pending orchestrator)**
**Domains-Touched:** engineering (R1, owner vasquez) · automation/ops (R8) · security (R2) (finance / legal / marketing / people / revenue: **N/A** — local developer tool, no billing/quota/compliance surface)
**Ship Type:** deploy (minor, new CLI control-plane; no REST/MCP route or index change; version 0.7.1 → 0.8.0 across 6 carriers + tag v0.8.0)

## Highlights

- **CLI binary `bin/agent-memory.mjs` — `start|stop|status|doctor` (+ `--help`).** Node ≥20 ESM, `node:` builtins only (`child_process, fs, net, os, path, url`), zero new dependencies. Registered as `"bin":{"agent-memory":"./bin/agent-memory.mjs"}` + `"verify-ops":"tsx scripts/verify-ops.ts"` in `package.json` (only 2 rows). Fail-closed arg parsing (`--slot` integer ≥1 else exit 2, unknown flag/subcommand → exit 2 on stderr, `--help` → exit 0).
- **Slot derivation — 4-port quartet `R(N)=3111+3(N-1) H(N)=6969+(N-1)`.** Derived exclusively via env/flags (`AGENT_MEMORY_PORT`, `helix add local --port`, `HELIX_URL`, `AGENT_MEMORY_URL`); zero edits to `src/**`, `db/**`, `hooks/**`, `plugins/**`. Slot 1 reuses `[local.dev]` (3111/6969/3112/3113); N≥2 → `[local.slotN]` (3114/6970/3115/3116 for slot2, never 3151). Invariants: N≥2 ∩ `{3111,3112,3113,6969}` = ∅, reserved `R+1`/`R+2` never bound. `helix add local` appending `[local.slotN]` is config registration (sanctioned, not source edit).
- **Multi-instance slot2 live-verified.** `start --slot 2` → `helix add local --name slot2 --port 6970` once (with `storage="disk"` patch for C5) then `helix start slot2` + `npx tsx src/server.ts` (env §4.3), 30 s readiness Helix `/healthz` + `/memory/livez`; `doctor --slot 2` → `PASS C1 200` `PASS C3 owned 3114` `PASS C2 200/200` `PASS C4 present` `PASS C5 disk` → `VERDICT: healthy` exit 0; `remember→search` on 3114 round-trips (1 bm25 hit score 0.86 `signals:[]`); `stop --slot 2` exit 0 + idempotent second `stop` exit 0; `helix status dev` unchanged 6969 up. No dev restart, no upstream 3111/3112/3113 signaled.
- **Data-dir & state-path (REQ-07/NFR-D, state contract §4.4).** Precedence `--data-dir` > `AGENT_MEMORY_DATA_DIR` > `~/.local/share/agent-memory/<slot>/`. CLI state is sibling `<parent>/state/slot-N.json` (never inside `HELIX_DATA_DIR`), state dir `0700` file `0600`, closed schema (slot/pids/instance/dataDir/startedAt/cliVersion), never secret/content/PII. `stop`/`doctor` re-derive `helixInstance` from `helix.toml` and re-verify `pids.rest` cmdline before **each** signal (SIGTERM and SIGKILL individually, C10).
- **A3 FAIL framing 3b — HELIX_DATA_DIR not forwarded on Helix CLI 3.3.0.** Probe `IMPLEMENTATION_PLAN.md` Step 0: binary 0 hits `HELIX_DATA_DIR`, `helix start --help` no `--data-dir`, `docker inspect` no passthrough. Consequently `HELIX_DATA_DIR` is never set, `--data-dir` controls only the state path (verified 0600/0700 secret-free), and `doctor --migrate` is fail-closed `MIGRATE ABORT: unsupported-runtime` (any form, zero writes, no backup created, MinIO volume retained). KR3 not claimed; framing 3b (data-dir for new instances only, no dev migration) escalated to orchestrator — reversible, not a defect.
- **Security C1..C10 landed as code + proof.** C1 ownership-gated bearer (C3 `verifyOwnedPid`+`isDescendant` before C2 probe, `verify-ops` §E header proof 0 Authorization to foreign synthetic server on 3135); C2 backup 0600/0700 declared in `README.md:715-727` but abort supersedes write while A3 FAIL; C3 state hardening 0700/0600+closed schema; C4 path refusal `/, $HOME, system roots`; C5 start idempotent; C6 audit `state/audit.log` 0600/0700; C7 one allowlist renderer (`oneLine+collapse+~`); C8 `helixEnv` strips secret; C9 `status` never sends bearer (401=armed); C10 re-verify before SIGKILL + `stale-pid` note. J/K/I: `verify-ops` §J 0 secret, §K 0 canary, §I foreign 3135 survives + static grep 0 forbidden primitives (`helix prune/delete/docker rm|kill/volume rm/fuser/pkill/killall/--persist`).
- **Verification `verify-ops` 99/0 + `TEST_MATRIX.md` P4 OPS rows T-P4OPS-01..15 (12 DONE + 3 DONE* partial).** Per-command bar `#1-10`: `typecheck` 0, `verify-ops` **99/0** (§A–§L + header proof + never-kill/secret/canary/port-parity), `verify-env` **21/0**, `verify-lifecycle` **123/0** (117+6), `verify-capture` **137/0**, `verify-skills --structural` **73/0**, `verify` **243/0** (3151, T-RL-001+F-01 green) + live slot-2 window above. `git diff src/ db/ hooks/ plugins/` empty; `package-lock.json` empty; `[local.dev]` frozen `port 6969 storage="disk" tag v0.0.6`.

## Contract

`docs/CONTRACT.md` unchanged (no route/tool/schema/index change — this is an ops control-plane lane). `README.md:601-784` adds Operations — P4 control plane (slot derivation table `R(N)/H(N)`, CLI usage + exit-code matrix 0/1/2/3/4/5, data-dir/state layout `0700/0600` sibling, backup/recovery/Ley 172-13 declaration `README.md:715-727`, never-kill hint). No migration, no index change.

## Known Issues

- **A3 FAIL carried (Residual #1, Medium×High, owner R1+R8 → orchestrator, expiry 2026-12-31 or framing-3b decision).** `HELIX_DATA_DIR` forwarding unsupported on Helix CLI 3.3.0; `doctor --migrate` abort-only; KR3 not claimed; `HELIX_DATA_DIR` never set. Reversible via framing 3b or Helix CLI upgrade. See `GATE_REPORT.md:60-72` 8 residuals + `HANDOFF.md:116-129` + `IMPLEMENTATION_PLAN.md:24-44` Step 0.
- **P4.4 DONE* partial (3 rows):** T-P4OPS-07 (data-dir state-path proven, HELIX_DATA_DIR forwarding not claimed), T-P4OPS-08 (migrate abort zero writes, no data moved), T-P4OPS-13 (state-path durability proven, HELIX restart with HELIX_DATA_DIR not claimed) — honest by-design, not silent PASS.
- **Other push-forward (not at gate):** P4.2 docker-compose/k8s, P4.5 npm publish, P4.6 zero-container mode still missing (ROADMAP/P4 scope).
- **Low hygiene (backlog, not gate-blocking):** RD-P4-001 dead no-op `bin:842-844`, RD-P4-002 depth-4 `bin:786-822`, RD-P4-003 `r1/r2` terse; QA O-01 `T-P4OPS-09 "(this commit)"`; `helix.toml` additive `[local.slot2]` inert until `git checkout -- helix.toml`.

## Verification

typecheck 0 · `verify-ops` **99/0** (VERIFY PASS, §A–§L + header proof) · `verify-env` **21/0** · `verify-lifecycle` **123/0** · `verify-capture` **137/0** · `verify-skills --structural` **73/0** · `verify` **243/0** (3151, Helix dev read-only) · live slot-2 window **DONE** (3114/6970 slot2 healthy + remember→search 1 hit + bootstrap 6970 `OK (8 indexes ensured)` + stop idempotent + dev untouched).

## Quality gate

8 independent reviewers → **8/8 PASS, 0 Critical/High, 0 conditional** → gate **OPEN**: `docs/specs/50_archive/P4-OPS/GATE_REPORT.md` (consolidated) + 8 artifacts (`quality-assurance`, `security-reviewer` C1..C10+J/K/I, `automation-reviewer` runbook §4a/4c/4d+CI, `readability` 7/7 with 3 Low, `reliability` bounded timeouts, `resilience` blast-radius/rollback, `risk`, `refuter` 6 claims). Cross-domain Engineering↔Security and Engineering↔Automation both PASS; Legal/Privacy N/A local tool (Ley 172-13 via output allowlist only).

## Rollback / Undo

Branch `main` ahead of `origin/main`; this ship commit `chore(release-0.8.0)` (+ lane commits `f8e29f1..2a7bc18`) tagged **v0.8.0** — rollback steps:

1. `rm bin/agent-memory.mjs && rm scripts/verify-ops.ts` (or revert `f8e29f1`/`bd65360`).
2. `git checkout HEAD~1 -- package.json package-lock.json` (reverts only the 2 added rows `bin` + `verify-ops`; `dependencies/devDependencies` and `package-lock.json` were empty diffs — `git diff package-lock.json` empty).
3. `git checkout -- helix.toml` — removes additive `[local.slot2]` (`port 6970 storage="disk"`) — sanctioned config registration, not source edit.
4. If slot2 still running: `bin/agent-memory stop --slot 2` (or `helix stop slot2`) — stops only slot2 owned processes; volumes retained (no `helix prune/delete/docker volume rm` reachable).
5. `npm run typecheck && npm run verify-env` proves clean (no CLI references remain in `src/`/`db/`/`hooks/`/`plugins/`). Check out tag **v0.7.1** for full undo. No schema, index, or migration change; storage remains `disk`. Owner: engineering + orchestrator. ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence only (ports, counts, PIDs, verdicts, `~`-collapsed paths, owners by role); `AGENT_MEMORY_SECRET` presence-only (`armed|unset` / `present|missing`); state file 0600 secret-free; synthetic `TEST_SECRET` 0 occurrences (`verify-ops` §J); canary 0 occurrences (§K); backup declaration `README.md:715-727` but no archive created while A3 FAIL — abort path proves never-a-write.

---

# Release Notes: v0.7.1

## Highlights

- **F-01-EMB closed — no more silently stale vector.** `verifyMergedState` now asserts `embedding === Math.fround(embed(nextContent))` ±1e-6; drift → ONE `retryWrite` heal → re-verify → named throw. `getMemoryById` projection + `embeddingsEqual` pure helper; no new query/index/send. Proven offline (§I-d d1 8 sends heal token `embedding`, d2 throw) + live (`probe4` `maxDiff=0 dims=384` VERDICT A, `verify` `f-01:` heal).

## Contract

`docs/CONTRACT.md` v1.5 → **v1.6**: `getMemoryById` projects `embedding` (internal verify only, never returned), `verifyMergedState` lists 4 invariants, heal family adds `embedding`, `F-01-EMB` CLOSED. Backward compatible: no route/tool/schema changes. Migration: N/A.

## Known Issues

- Accepted Low hygiene: shape-drift (missing key) has no dedicated seam (code fail-closed, arch C2 names it — next lane) + `TEST_MATRIX.md` not yet extended (trace in spec §7). Owner R1, expiry 2026-12-31 or Helix upgrade.

## Verification

typecheck 0 · `verify-lifecycle` **123/123** (§I-d) · `probe4` **13/13** VERDICT A `maxDiff=0` · `verify` **243/243** (3151) · bootstrap 8 · CI **36044780528 success** on `f772e45`.

## Quality gate

Reliability PASS, security PASS, automation CONDITIONAL→cleared by CI, readability PASS, QA CONDITIONAL (2 Low) → gate **OPEN** with documented residuals.

## Rollback / Undo

Commit `f772e45` (+ this `chore(release-0.7.1)`), tagged **v0.7.1** — reverse-order revert restores 0.7.0; no migration, no index change. Owner: engineering. ETA: immediate.

---

# Release Notes: v0.7.0

**Date:** 2026-09-24
**Release Manager:** orchestrator (frame-ship lane; ship mechanics by the
operations function per ship-release role binding — role assumption stated
for this lane)
**Specs Included:** RL-001 + F-01 residual closure (per-survivor merge
serialization + `updateMemoryContent` post-write verify/heal) — `ROADMAP.md`
§1.3
**Domains-Touched:** engineering, security, automation/ops, data lens
(finance / legal / marketing / people / revenue: **N/A** — code+docs lane)
**Ship Type:** deploy (local library/server release; no external deployment
target; no breaking changes; version 0.6.0 → 0.7.0 across 6 carriers +
tag v0.7.0)

## Highlights

- **REQ-RL-001 — concurrent distinct-variant merges no longer lose an append.**
  Consolidation now serializes per *survivor* (`survivorTails` +
  `withSurvivorLock`; lock order dedupKey OUTER → survivor INNER, no cycle)
  with a fresh `getMemoryById` re-read under the lock (expired-while-waiting
  → plain insert, never absorbs). §P `rl-001:` block: 3 concurrent distinct
  variants → same survivor id, all three wordings present; pre-fix
  counterfactual fails exactly these assertions. Same-process scope;
  cross-process writers remain out of contract until P4.3.
- **REQ-F-01 — merge commits verified + healed, not trusted.** Post-write
  verify under the survivor lock (content, dedupKey, every effective concept
  linked) with ONE heal (full retry on content drift, link-only
  `linkMemoryConcepts` otherwise) and a fail-closed throw naming any
  still-violated invariant. The substring-guard path heals missing links
  while keeping content byte-identical. §P `f-01:` block: healed link proven
  by graph-branch fused score = control + 1/61.
- **Three additive contract §2 queries** (`getMemoryById`, `memoryConcepts`,
  `linkMemoryConcepts`; bootstrap stays 8 indexes) + one allowlisted stderr
  heal line (`heal survivor=<id> …`, never content/names) + operator runbook
  (`docs/CONTRACT.md` §3).
- **Gate-hardened before ship** — 9 independent reviewers (2 pass, 7
  conditional→cleared), 0 Critical/High, 12/12 canonical CONDs cleared with
  evidence (3 duplicates retired, no contradictions); no waivers.

## Contract

`docs/CONTRACT.md` v1.4 → **v1.5**: §2 three additive queries; §3 tier-1 (a)
CONCURRENCY CLOSED (in-process) + (b) ATOMICITY CLOSED (detected-and-healed
app-side) with named residuals `F-01-EMB` (embedding; probe4 verdict A covers
refresh) and `RL-001-QUEUE` (no queue cap; re-review P4.3); §5 bar
(`verify` 243, `verify-lifecycle` 117). Backward compatible: no
route/tool/schema changes. Migration: N/A.

## Known Issues

- Residuals with owner + expiry in `GATE_REPORT.md` / `ROADMAP.md` §1.3:
  `F-01-EMB`, `RL-001-QUEUE`, crash-window lazy heal, session-node run
  budget (+17/run) — all dated, owner engineering. RL-001 / F-01 rows CLOSED
  at this release.

## Verification

Full pre-ship bar 2026-09-24 (server :3151, Helix dev untouched; upstream
`iii` on 3111 untouched): `typecheck` 0 · `verify` **243/243** (`rl-001:`
13, `f-01:` 16) · `verify-lifecycle` **117/117** · `verify-capture`
**137/137** · `verify-env` **21/21** · `verify-skills --structural`
**73/73** · `verify-injection` ALL PASS · bootstrap 8 indexes · CI green on
the pushed head (runs 36022455544, 36022643924). Helix-restart incident
mid-lane behaved fail-closed (500s, no false 201s, automatic recovery).

## Quality gate

9 independent reviewers → 2 pass / 7 conditional-with-findings; all cleared
with evidence → gate **OPEN**:
`docs/specs/50_archive/RL001-F01/GATE_REPORT.md`.

## Rollback / Undo

Lane commits `01224cc` + `a0257d6` + `fb8e661` + `f371eb9` + `0834704` (+ this
`chore(release-0.7.0)` commit), tagged **v0.7.0** — reverse-order whole-commit
revert only (probes re-verified: 1/0/0 at `fb8e661`); check out tag **v0.6.0**
for a full undo. Version markers return to 0.6.0; no schema, index, or
migration change; merged rows stay valid under old code. Owner: engineering.
ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence
only (suite counts, paths, verdicts, owners by role); verify fixtures
synthetic; new content reads stay in-process, never logged (lengths/counts
only).

---

# Release Notes: v0.6.0

**Date:** 2026-09-23
**Release Manager:** orchestrator (frame-ship lane; ship mechanics by the
operations function per ship-release role binding — role assumption stated
for this lane)
**Specs Included:** P2 remainder (P2.2 file-edit/failure capture + P2.3
transcript import + P2.4 session summarization) — `ROADMAP.md` §P2
**Domains-Touched:** engineering, security, legal, automation/ops, data lens
(finance / marketing / people / revenue: **N/A** — code+docs lane)
**Ship Type:** deploy (local library/server release; no external deployment
target; no breaking changes; version 0.5.0 → 0.6.0 across 6 carriers +
tag v0.6.0)

## Highlights

- **File-edit + failure capture (P2.2)** — `PostToolUse` with an edit-like
  tool name stores `file edited via <tool>` (name only); `PostToolUseFailure`
  + plugin `tool.execute.after` store `tool failed: <tool>`; basename opt-in
  (`AGENT_MEMORY_CAPTURE_PATHS=basename`) appends the sanitized basename
  only; path-bearing tool names fail closed; Antigravity adapter mirrors.
- **Transcript import (P2.3)** — script-only
  (`npm run import-transcript -- --file … --dry-run`), Claude Code JSONL +
  generic fallback, prompts skipped by default, origins coerced to `import:*`.
- **Session summarization (P2.4)** — deterministic, no-LLM summary + lessons
  saved as `/memory/lesson` rows under the same sessionId
  (`npm run summarize-session -- --session-id …`).
- **Gate-hardened before ship** — 10 independent reviews; the refuter falsified
  two privacy claims (generic-user prompt bypass, path-bearing tool name) + one
  robustness hole (plugin throw on non-string tool); all fixed + re-proven
  (137/137 capture checks); gate **OPEN** with owned residuals.
- **DAT-001 closed at trigger** — Concept retention (TTL none, intentional)
  + orphan-cleanup procedure declared in `docs/CONTRACT.md` v1.4 §3 and
  **proved live** against dev (audit → zero-in-edge gate → drop → re-audit:
  189→188 Concepts, linked 128 unchanged); docs-only, no code change.

## Changes

### Features

- Edit-marker + failure observations across both capture hooks + plugin
  (P2.2, engineering/security)
- `scripts/import-transcript.ts` + `scripts/summarize-session.ts` +
  `src/summarize.ts` (P2.3/P2.4, engineering/automation)
- `docs/CONTRACT.md` v1.2 → v1.4 (P2 semantics + DAT-001 declaration, no
  route/tool changes)

### Fixes

- Gate remediation C1–C6: prompt-gate bypass, path-bearing tool names,
  plugin non-string throw + unguarded before-hook, origin-namespace coercion,
  entry-guard side effect on import, README staleness (engineering, security,
  legal, automation)

### Breaking Changes

- **None — additive; no behavior removed or renamed.** Behavioral notes:
  `PostToolUse` with edit-like tool names now stores `file edited via`
  instead of `tool used` (same endpoint, dedup, retention either way);
  version 0.5.0 → 0.6.0 (6 carriers: `package.json`, `package-lock.json`
  root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`, README badge).
  Migration: N/A.

## Known Issues

- Residuals with owner + expiry in `GATE_REPORT.md`: G1 Antigravity coverage
  gap, G2 import/summarize live-leg automation gap, F2 summarize re-run
  appends, F6 CI gap, R-P2-01…04, L-P2-01…03, S-03 + standing RL-001 / F-01
  (`ROADMAP.md` §1.3; DAT-001 closed at this release — CONTRACT v1.4).

## Contract

`docs/CONTRACT.md` v1.2 → **v1.4**: v1.3 P2.2 allowlist + plugin after-origin,
P2.3/P2.4 script surface, §5 bar (`verify-capture` 137); v1.4 DAT-001
Concept-retention declaration + orphan-cleanup procedure (§3). Backward
compatible: no route/tool/schema changes.

## Verification

Full pre-ship run 2026-09-23 (consolidated log at HEAD `2035e18`): `typecheck` 0 ·
`verify-capture` **137/137** · `verify-lifecycle` **104/104** · `verify-env`
**21/21** · `verify-injection` ALL PASS · `verify-skills --structural` **73/73**
· `purge` usage guard exit 2 · `verify` **214/214** on our 3151 reroute
(upstream `iii` on 3111 untouched) · `verify-skills` live **119/119** · import
dry-runs (4/1 default vs 5/0 `--include-prompts`) + live
import→search→summarize→sessionMemories (rows cleaned) · server torn down
clean (no leftover pid). DAT-001 procedure proof (same instance): audit →
zero-in-edge gate (`in_edges:0, out_edges:0`) → drop → re-audit — 189→188
Concepts, linked 128 pinned, orphans 61→60 (one write; no restart; port 3111
untouched).

## Quality gate

10 independent reviewers → 6 pass / 4 conditional-with-findings; all ❌-grade
holes fixed + re-proven → gate **OPEN**:
`docs/specs/50_archive/P2-COMPLETE/GATE_REPORT.md`.

## Rollback / Undo

Two commits: `2035e18` (feature + gate remediation) + the
`chore(release-0.6.0)` commit (lockstep, notes, DAT-001 declaration), tagged
**v0.6.0** — `git revert` either (or check out tag **v0.5.0** for a full undo)
restores pre-P2 behavior; version markers return to 0.5.0; no schema, index,
or migration change; `import:*`/`lesson` rows from the lane are inert data
(clean via `forget`/`delete`). Test projects (`verify-p2*`) cleaned at
verification. Owner: engineering. ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence
only (suite counts, paths, verdicts, owners by role); prompt canary asserted
non-stored; hook observations name-only by default.

---

# Release Notes: v0.5.0

**Date:** 2026-09-23
**Release Manager:** orchestrator (frame-ship lane; ship mechanics by the
operations function per ship-release role binding — role assumption stated
for this lane)
**Specs Included:** P1 remainder (P1.4 derived confidence + P1.2 tier-1
consolidation + P1.5 eval harness) + P3.2 skill set — `ROADMAP.md` §P1 + §P3
**Domains-Touched:** engineering, automation/ops, data lens, docs
(finance / legal / marketing / people / revenue: **N/A** — code+docs lane)
**Ship Type:** deploy (local library/server release; no external deployment
target; additive API — one behavior change: omitted `importance` is derived)

## Highlights

- **Derived confidence (P1.4)** — `importance` omitted by the caller is
  computed from provenance + structure (lesson 0.75 / `hook:*` 0.55 / else
  0.5 base + 0.025·min(concepts,8), clamp01) instead of defaulting to `0.5`;
  the fused tie-break applies a recall boost AFTER decay over an in-process
  ledger (per-process, cap 10k); explicit caller values always win; the
  OpenCode plugin no longer pins a client-side `0.5`.
- **Tier-1 consolidation (P1.2)** — near-duplicates (Jaccard ≥
  `AGENT_MEMORY_MERGE_JACCARD`, default 0.9, fail-closed OFF on bad config)
  merge into ONE survivor: content concatenated (substring guard closes the
  re-merge loop), `embedding`/`dedupKey` rewritten in place, survivor
  `memoryId` stable, response gains `consolidated:true`; TTL-expired
  survivors are excluded from the probe. probe4 proved the in-place rewrite
  refreshes both text and vector indexes (VERDICT A, 12 checks).
- **Eval harness (P1.5)** — adapter-pluggable `EvalClient` (`EVAL_MODE`),
  deterministic in-repo corpus (40 docs / 15 queries + qrels, zero network),
  R@5/R@10/MRR@10/nDCG@10 for bm25 + hybrid, our own numbers in
  `docs/benchmarks/SCORECARD.md` (corpus-specific, disclaimed on its face;
  metric math regression-tested by `verify-lifecycle` §H goldens).
- **Skill set (P3.2)** — 8 invocable skills (`recall`, `remember`, `recap`,
  `handoff`, `forget`, `lesson`, `commit-context`, `session-history`),
  contract-accurate tables + examples, indexed by `skills/memory/SKILL.md`;
  `verify-skills` structurally validates all 8 (server-free `--structural`
  mode, CI-wired) and live round-trips every frozen route (119 checks).

## Changes

### Features

- Derived confidence — provenance-derived `importance` + recall-boost
  tie-break (P1.4 / REQ-P1-4, engineering)
- Tier-1 consolidation — near-dup merge into one survivor with in-place
  index-fresh rewrite (P1.2 / REQ-P1-2, engineering)
- Adapter-pluggable eval harness + in-repo corpus scorecard (P1.5 /
  REQ-P1-5, automation/ops)
- Eight invocable skills + structural/live skill gate (P3.2 / REQ-P3-2,
  docs/automation)

### Fixes

- **Gate P1R-P32 remediation — 16/16 conditions closed:** hand-computed
  eval-metric goldens (`verify-lifecycle` §H), decay-THEN-boost order golden
  (§F-bis), induced probe-failure fail-closed test (§I), MCP adapter
  pass-through test + plugin no-default source check, TTL×expired-survivor
  guard on the merge probe, `probe4` log-line hardening (CWE-117),
  corpus-specific scorecard disclaimer + actual-URL reproduce block,
  `verify-skills --structural` server-free mode wired into CI, and the full
  declaration set (concurrency exception, atomicity assumption, TTL×merge,
  merge provenance, index dependency, session run budget, eval retention)
  (engineering, docs, automation/ops — evidence: `50_archive/P1R-P32/GATE_REPORT.md`)

### Domain Ships

- Automation/ops: CI gains `verify-skills --structural` (73 checks, no
  server) — `.github/workflows/ci.yml`
- Data lens: retention/deletion declared for `agent-memory-eval` and
  `verify-skills` sessions (CONTRACT §5) + Concept-orphan re-baselined
  (`ROADMAP.md` §1.3)
- Finance / Legal / Marketing / People / Revenue: N/A (code + docs lane,
  no external surface touched)

### Breaking Changes

- **None breaking** — no route or MCP tool renames; `RememberResult
  .consolidated` is additive; README/INSTALL/MIGRATION templates are
  conditional on breaking changes → cited, not required (no `INSTALL.md` /
  `MIGRATION.md` exists in this repo).
- Behavior-change compat note (not breaking): an OMITTED `importance` is now
  derived from provenance instead of defaulting to `0.5`. Callers wanting
  the legacy value must send `importance: 0.5` explicitly; undo = send the
  explicit value, **no data migration** (stored rows are never rewritten by
  this change).

## Known Issues

- Six accepted residuals from gate P1R-P32, each with owner + expiry:
  W-1 concurrent distinct-variant lost append (engineering, 2026-12-31 or
  P4.3), W-2 merge mid-batch atomicity assumption (engineering, Helix
  upgrade or 2026-12-31), W-3 Concept-orphan (engineering, 2026-12-31 or
  v0.6.0), W-4 `verify-skills` Session residue (engineering, P4.1 or
  2026-12-31), W-5 write-path probe coupling (engineering, 2026-12-31),
  W-6 base-URL echo into logs/scorecard (ops, next eval touch) — full
  three-block waivers in `docs/specs/50_archive/P1R-P32/GATE_REPORT.md` C3;
  W-1…W-3 also tracked in `ROADMAP.md` §1.3. Workarounds: single-writer
  local contract, `bootstrap` before first write, localhost-only
  `AGENT_MEMORY_URL`.

## Contract

`docs/CONTRACT.md` v1.1 → **v1.2**: derived-importance default replaces
`importance=0.5`, `RememberResult.consolidated`, tier-1 merge semantics +
gate P1R-P32 declarations (concurrency exception, atomicity assumption,
TTL×merge guard, merge provenance, index dependency), recall-boost tie-break
order, `updateMemoryContent` in §2, probe4 fact in §0. Backward compatible:
additive response fields, no route/tool renames.

## Verification

`typecheck` 0 · `verify-lifecycle` **104/104** · `verify` **214/214** (3151) ·
`verify-skills` **119/119** (+ `--structural` 73/73) · `probe4` 12 (VERDICT A)
· `eval` EVAL PASS · `verify-capture` 115 · `verify-injection` 73 ·
`verify-env` 21 · `purge` usage guard exit 2 · counts in `TEST_MATRIX.md`.

## Quality gate

9 independent reviewers → 3 pass / 6 conditional / 0 closed; all conditions
fixed or waived with owner + expiry → gate **OPEN**:
`docs/specs/40_workspace/quality-gate/P1R-P32/GATE_REPORT.md`.

## Rollback / Undo

Six separable commits (`df39d7d`, `591c79c`, `39fec28`, `c69636d`,
`2deda68` + gate remediation) — revert to `d17294b` restores v0.4.0
behavior; merged rows in the dev instance are seed/verify data only.

---

# Release Notes: v0.4.0 (previous)

**Date:** 2026-09-23
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the operations function per ship-release role binding — stated as the role
assumption for this lane)
**Specs Included:** P1 (P1.1 + P1.3 + P1.6) + P2.1 — `ROADMAP.md` §P1
"Recall quality & lifecycle" + §P2 "Capture breadth"
**Domains-Touched:** engineering, security, automation/ops, data lens
(finance / legal / marketing / people / revenue: **N/A** — code+docs lane, no
such surface in the diff)
**Ship Type:** deploy (local library/server release; no external deployment
target; no breaking changes → README/INSTALL/MIGRATION templates cited, not
required)

## Highlights

- **Recall quality** — explicit `concepts` win verbatim, and a save without
  them now derives a deterministic top-8 concept set, so plain saves feed the
  concept-graph branch of hybrid search — proven live: the derived-concepts
  graph branch contributes fused score == **3/61** (`scripts/verify.ts`
  D-section).
- **Write-side dedup, first-wins** — saving the same fact twice returns the
  existing id with `deduped:true` and creates one retrievable row; Helix does
  not enforce unique indexes, so uniqueness is application-side under a
  per-key FIFO lock — decision record:
  `docs/adr/ADR-0001-application-side-dedup-uniqueness.md`.
- **Memory lifecycle (corte A, opt-in)** — TTL hides expired rows from both
  searches with an explicit `ttl: hidden N expired rows` signal; read-time
  decay (`importance · e^(−λ·ageDays)`) is a fused tie-break only — stored
  `importance` never mutates; `scripts/purge.ts` is the fail-closed governance
  CLI (`--days/--project|all/--dry-run`). Both env knobs default **OFF**.
- **Hook breadth** — all 7 `capture.mjs` events plus the OpenCode plugin's
  `tool.execute.before` observe; prompt text is **never** stored (privacy
  canary asserted non-stored, `verify-capture` 115/115).
- **Quality gate OPEN** — 9/9 dedicated reviewers pass after 3 remediation
  rounds, 10/10 conditions cleared, waivers W1/W2 recorded with the
  three-block bar; final evidence: typecheck 0 · verify **152/152** ·
  lifecycle **39/39** · capture **115/115** · injection **73** · env **21/21** ·
  probe3 GREEN · bootstrap 8 indexes · purge dry-run + usage guards exit 2 ·
  demo OK.

## Changes

### Features

- Auto concept extraction: `src/concepts.ts` (deterministic top-8, tf → lex
  tie-break, stopwords dropped) + `src/embed.ts` `tokenize` export; derivation
  only when `concepts` is absent (explicit wins verbatim) (P1.3 / REQ-P1-3,
  engineering)
- Write-side dedup: `dedupKey = sha256(project + "\n" + normalize(content))`
  property + index #8 + `findMemoryByDedupKey` + `remember()` pre-check under
  the per-key in-process FIFO lock; a hit returns the existing row with the
  additive `deduped:true` field (P1.6 / REQ-P1-6, engineering)
- Memory lifecycle: `src/lifecycle.ts` decay/TTL pure functions + fused
  tie-break integration in `src/search.ts` + `scripts/purge.ts` governance
  CLI (`AGENT_MEMORY_TTL_DAYS` / `AGENT_MEMORY_DECAY_LAMBDA`, default OFF)  (P1.1 / REQ-P1-1, engineering/ops)
- Hook coverage: `capture.mjs` 3 → 7 events (`PostToolUseFailure`,
  `PreCompact`, `SessionEnd`, `UserPromptSubmit`) + OpenCode plugin
  `tool.execute.before` observe (fire-and-forget, own `memory*` tools
  skipped) (P2.1 / REQ-P2-1, engineering/security)
- `docs/CONTRACT.md` v1 → v1.1: §0 probe3 facts, §1 `dedupKey` + index #8,
  §2 new exports, §3 dedup/decay/TTL/hook semantics + single-writer
  assumption, §4 decay removed from do-not-build, §5 verification bar
  (REQ-P1-1/P1-3/P1-6/P2-1, engineering)
- `docs/adr/ADR-0001-application-side-dedup-uniqueness.md` — first ADR of the
  repo, required by the contract change v1 → v1.1 (engineering)
- Version 0.4.0 lockstep across all 6 carriers: `package.json`,
  `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`,
  README badge (engineering, this release)
- Docs sync: CHANGELOG v0.4.0 entry, README (env knobs, purge, 7 events,
  verification counts, badge), ROADMAP P1.1/P1.3/P1.6/P2.1 ticks, TEST_MATRIX
  T-101..T-108 (engineering)
- CI gains `verify-lifecycle` + `verify-capture` jobs in
  `.github/workflows/ci.yml` alongside typecheck / verify-injection /
  sha256-pinned gitleaks secret-scan (automation/ops)

### Fixes

- CWE-117 newline forgery in purge governance/audit lines — print-side
  `oneLine()` normalizer extracted to `src/logline.ts` + 5 CI assertions in
  `verify-lifecycle` section E (gate COND-004 / COND-007, security)
- Store dedup pre-check now fails **closed** on shape drift — a transport
  error or a response missing the frozen `memory` return throws instead of
  being read as a miss (gate resilience F1, engineering)
- Purge failure paths write an allowlisted single-line `status=partial` audit
  record before exit 1 whenever deletions happened, plus per-batch
  `purge-progress` (gate COND-006, automation/ops)
- Doc-truth corrections: falsified `contentHash` docstring + nonexistent-test
  citations, plan/README false-pointer cells, `dedayImportance` →
  `decayedImportance` typo — class swept to 0 instances across all six docs
  (gate COND-005 / COND-008 / COND-010, engineering)

### Domain Ships

- **Security:** SEC-01 (CWE-117) + SEC-02 both FIXED-VERIFIED by the
  independent security reviewer — path:
  `docs/specs/50_archive/P1-P21/security-reviewer.md`; SEC-03/SEC-04 (Low)
  tracked with owner + expiry (P1-P21)
- **Automation/ops:** `verify-lifecycle` + `verify-capture` wired into CI and
  green; waiver **W1** pre-merge condition stands — first sha256-pinned CI
  `secret-scan` run green at/after `9210208`, owner: orchestrator (P1-P21)
- **Data:** `dedupKey` lineage documented (CONTRACT §1 — hash never leaves
  store projections), no backfill by design (probe3 a3-2: legacy nodes  missing the property are harmless), Concept-orphan finding DAT-001 tracked
  with owner + expiry (P1-P21)
- **Engineering:** gate record
  `docs/specs/50_archive/P1-P21/GATE_REPORT.md` (**OPEN** — 9/9 pass,
  COND-001..010 cleared, W1/W2 three-block) +
  `docs/specs/50_archive/P1-P21/HANDOFF.md` (Status: complete) + ADR-0001 for
  the contract change (P1-P21)

### Breaking Changes

- **None — additive; no behavior removed or renamed.** Behavioral notes:
  - Repeat saves return the **first** row (first-wins): a dedup hit creates no
    second row and no `Session` node — sessions materialize on novel writes
    only; tests asserting "one new row per save" must expect the first id.
  - `remember` / `lesson` responses gain the additive `deduped` boolean field
    (201 bodies now carry it).
  - Two new env knobs exist — `AGENT_MEMORY_TTL_DAYS` and
    `AGENT_MEMORY_DECAY_LAMBDA` — both default **OFF**: unset ⇒ behavior
    identical to v0.3.0 (opt-in, no ranking/hide surprises).
  - `capture.mjs` now accepts **7** events (was 3): hosts wired to
    `PostToolUseFailure` / `PreCompact` / `SessionEnd` / `UserPromptSubmit`
    start capturing — teams asserting event **silence** for those names must
    update expectations (in-repo suite asserts all 7 already).
  - Migration guide **N/A**: README/INSTALL/MIGRATION templates cited, not
    required (ship-type `deploy` without breaking changes). Undo path:
    rollback plan below.

## Known Issues

- **W1 — pre-merge condition (owner: orchestrator):** local gitleaks was
  unavailable this session (2× download timeout, escalated); do not merge
  until the first CI `secret-scan` run green at/after `9210208`.
  Compensating control: the sha256-pinned gitleaks job was untouched by this
  lane (`.github/` diff `eb279a6..83e2f3a` = 0 lines).
  **RESOLVED (2026-09-23):** first green run = `35830679212` (commit
  `69a9a8d`, job success); the 2 first-run findings were reviewed
  fingerprint-scoped false positives — dedup golden test vectors, recomputation
  proof in the `69a9a8d` commit body.
- **W2 — purge has no Helix request timeout** (accepted risk; the SDK exposes
  none): compensating controls = fail-closed arg guard, `BATCH_LIMIT` /
  `MAX_BATCHES` bounds, per-batch `purge-progress`, operator Ctrl-C;
  re-review at v0.5.0 or 2026-12-22, whichever first — owner: engineering.
- **Tracked findings (owner + expiry each)** → table in
  `docs/specs/50_archive/P1-P21/GATE_REPORT.md`: DAT-001 (Concept orphans on
  forget, Medium), T-107/T-108 (route-level TTL / λ-on E2E coverage gaps,
  Medium), SEC-03/SEC-04 (Low), plus RL-004/RL-007 and hygiene rows —
  expiries 2026-10-31 / v0.5.0 unless the row says otherwise.
- **Single-writer-process assumption** — application-side dedup is sound only
  within ONE writer process; cross-process writers to one Helix instance are
  out of contract (CONTRACT §3 "Single-writer assumption"; multi-instance =
  ROADMAP P4.3) — owner: engineering.

## Rollback / Undo

- **Code:** revert the feature range `1c410ee..97e9d9b` — 10 commits:
  `b27364b` (REQ-P1-3) → `101e063` (REQ-P1-6) → `45380b5` (REQ-P1-1) →
  `8fbd795` (REQ-P2-1) → `6f7f708` (v0.4.0 lockstep + CI) → `eb279a6`
  (contract v1.1) → `9210208` + `83e2f3a` (gate remediation) → `d59d23a`
  (gate OPEN) → `97e9d9b` (handoff + ADR) — plus the release commit appended
  at ship; or check out tag **`v0.3.0`** for a full undo. Version markers
  return to 0.3.0 (README badge, `package-lock.json`, `src/mcp.ts`, plugin
  `VERSION`, `package.json`).
- **Additive-inert by design:** old code ignores the `dedupKey` property and
  index #8 — the repo has no index-drop (`bootstrapIndexes` only creates), so
  a bootstrapped instance keeps an orphaned, unused unique index, which
  probe3 proved is inert; both env knobs are OFF by default, so a revert is
  behavior-neutral; **no destructive backfill ran** — legacy rows were never
  rewritten. Per-step points (`IMPLEMENTATION_PLAN.md` "Rollback Points"):
  step 1 revert `src/concepts.ts` + store/embed hunks (no schema touched);
  step 2 revert `db/queries.ts` + store dedup hunks (index orphaned, not
  dropped; `deduped` removal is additive-reversible); step 3 revert
  `src/search.ts` + `src/lifecycle.ts` + `scripts/purge.ts` (defaults OFF ⇒
  no live behavior change); step 4 revert `capture.mjs` + plugin registration
  + `verify-capture.ts` (per-event exit-0 guarantee preserved).
- **Data:** none needed — dev-instance data is seed/verify data (probe writes
  isolated to `probe-p1-*` projects); no production data risk.
- Owner: engineering owner + orchestrator. ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence
only (suite counts, commit SHAs, paths, verdicts, owners by role); prompt-text
canary asserted non-stored (`verify-capture` 115/115); hook observations are
fixed-string/tool-name only; wide disclosure: none.

---

# Release Notes: v0.3.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the owning domain owner / operations function per ship-release role binding —
stated as the role assumption for this lane)
**Specs Included:** P0 — `ROADMAP.md` §2 "Publishable foundations"
(REQ-P0-1..6)
**Domains-Touched:** engineering, security, legal, automation/ops
**Ship Type:** deploy (no breaking changes → README/INSTALL/MIGRATION
templates cited, not required)

## Highlights

- **Publishable foundations** — Apache-2.0 `LICENSE` + matching `package.json`
  `"license"` field, plus a CI gate (typecheck + verify-injection + pinned
  gitleaks v8.30.1 secret scan) green on `main` across 5 runs
  (35781376642, 35781958949, 35784838135, 35786040704, 35787110447).
- **Durable persistence default** — `storage = "disk"` in `helix.toml`, so a
  plain `helix start dev` survives restarts; proven by the restart canary
  artifact (`docs/specs/50_archive/P0/evidence/p0-4-restart-canary.log`:
  BM25 hit on attempt 1 post-restart, `RESULT: PASS`).
- **Legacy env acceptance** — servers started under old `AGENTMEMORY_*` names
  keep working: name-only warning on server/MCP/bootstrap (never prints
  values), bearer guard armed, hooks stay silent.
- **Port ownership settled** — `EADDRINUSE` prints the reroute hint
  (`AGENT_MEMORY_PORT=3151`, never kill the upstream); README states
  definitively which port is ours.
- **Quality gate OPEN** — 9 dedicated reviewers; trail CLOSED → CONDITIONAL →
  OPEN with all 15 conditions closed and both ❌ verdicts cleared on scoped
  recheck; waivers W1..W6 recorded with owners, compensating controls, and
  expiries.

## Changes

### Features

- `LICENSE` (Apache-2.0) + `package.json` `"license": "Apache-2.0"` as the
  license of record (P0 / REQ-P0-1, legal)
- `.github/workflows/ci.yml` — typecheck + verify-injection + pinned gitleaks
  v8.30.1 secret scan on every push/PR (P0 / REQ-P0-2, automation/ops)
- `SECURITY.md` + `CONTRIBUTING.md` governance docs, linked from README
  alongside `CHANGELOG.md` (P0 / REQ-P0-3, security)
- Durable persistence default `storage = "disk"` in `helix.toml` + bootstrap
  advisory warning when the key is missing (P0 / REQ-P0-4, engineering)
- Legacy `AGENTMEMORY_*` acceptance: name-only warning + armed guard, with
  `scripts/verify-env.ts` as the proof harness (P0 / REQ-P0-5, engineering)

### Fixes

- `EADDRINUSE` dead end → actionable reroute hint (`AGENT_MEMORY_PORT=3151`,
  never-kill-upstream note) + README `## Known limitations` port-ownership
  statement (P0 / REQ-P0-6, engineering)

### Domain Ships

- **Legal:** `LICENSE` (Apache-2.0) shipped + 248-package manual license scan
  with zero copyleft hits — path: `docs/specs/50_archive/P0/legal-reviewer.md`
  (LGL-004; residual under waiver W1) (P0 / REQ-P0-1)
- **Automation/ops:** CI on `main` all green — runs 35781376642, 35781958949,
  35784838135, 35786040704, 35787110447 all `conclusion=success`
  (P0 / REQ-P0-2)
- **Security:** gitleaks pinned at v8.30.1 (sha256-verified, fingerprint-scoped
  `.gitleaksignore`) + governance docs `SECURITY.md` / `CONTRIBUTING.md` —
  path: `docs/specs/50_archive/P0/security-reviewer.md`
  (P0 / REQ-P0-2, REQ-P0-3)
- **Engineering:** gate record `docs/specs/50_archive/P0/GATE_REPORT.md`
  (**OPEN**), waivers `docs/specs/50_archive/P0/WAIVERS-P0.md` (W1..W6), and
  handoff `docs/specs/50_archive/P0/HANDOFF.md` (Status: complete) archived
  together with the nine reviewer artifacts (P0)

### Breaking Changes

- **None — no behavior removed or renamed.** Migration guide **N/A**:
  README/INSTALL/MIGRATION templates cited, not required (ship-type `deploy`
  without breaking changes). Undo path: rollback plan below.

## Known Issues

- **Waivers W1..W6 active** — W1: no license/CVE scan in CI; W2: `verify-env`
  not gated in CI/PR bar; W3: no backup/DR automation + advisory false
  negatives; W4: gitleaks same-origin checksum + tag-pinned actions; W5:
  precedence/backstop tests deferred; W6: empty-new-name divergence across
  surfaces. Expiry: **2026-12-21** or the named milestone (P1..P4), whichever
  first; re-review owners per waiver — full text:
  `docs/specs/50_archive/P0/WAIVERS-P0.md`. Compensating controls documented
  in README (durability & recovery, never-empty, split-brain guidance).
  Owner: domain owners + orchestrator.
- **~50 Low findings** → roadmap backlog — non-blocking per severity
  guardrail; owner: orchestrator (triage).

## Rollback / Undo

- **Code:** `git revert` of the P0 delivery + release merge range, or check
  out tag `v0.2.0` for a full code undo — no schema, index, or migration
  change; version markers return to 0.2.0.
- **Archive undo:** reverse `git mv` restoring `50_archive/P0/` to its
  pre-archive lane under `docs/specs/40_workspace/` — exact source paths
  recorded in `docs/specs/50_archive/P0/ARCHIVE-RECORD.md`.
- Owner: engineering owner + orchestrator. ETA: immediate.

---

# Release Notes: v0.2.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the engineering-specialist function, per `agents/orchestrator.md` +
`agents/vasquez.md` delegation — stated as the role assumption for this lane)
**Specs Included:** P3.1 — ROADMAP.md §P3 "MCP tool parity for the useful subset"
**Domains-Touched:** engineering, security, data lens
**Ship Type:** deploy (local library/server release; no external deployment target)

## Highlights

- **MCP/REST parity for the useful subset** — `recap`, `handoff`, `lesson`,
  and governance-style `delete` now exist on both surfaces over the same
  `MemoryStore`: 12 REST routes, 11 MCP tools, one contract.
- **Every feature round-trips** — `npm run verify` proves the full chain
  (lesson → search with `origin:"lesson"` → recap membership → handoff
  header/counts → governed delete with receipt → gone → second delete 404 →
  counts) at **102 passed, 0 failed → VERIFY PASS**.
- **Gate-hardened before ship** — 8 independent reviews + a 17-row C3
  interrogation produced real fixes: log-forgery sanitize, an upstream identity
  guard in `verify`, a shared digest module with a 20s fan-out budget, and a
  declared PII allowlist/masking rule for the governance log.

## Changes

### Features

- `POST /agentmemory/recap` — deterministic session/project digest, per-source
  `signals[]` degradation, never 500 (P3.1, engineering)
- `POST /agentmemory/handoff` — recap + `healthCounts` as next-agent context
  block (P3.1, engineering)
- `POST /agentmemory/lesson` — remember with server-forced
  `origin="lesson"`, strict body (extra `origin` → 400) (P3.1, engineering)
- `POST /agentmemory/delete` — governance delete: required single-line
  `reason` (1..1000), receipt `{memoryId, deletedAt}`, 404 `{error:"not_found"}` (P3.1, engineering)
- MCP tools `memory_recap`, `memory_handoff`, `memory_lesson`,
  `memory_delete` — same envelopes behind the unchanged
  `_meta.authorization` gate; surface 7 → 11 (P3.1, engineering)
- `src/digest.ts` — shared digest builder for both lanes with
  `DIGEST_BUDGET_MS = 20_000` + `digest: budget exceeded` signal (P3.1 gate
  COND-005, engineering)
- `CHANGELOG.md` — Keep-a-Changelog history created (ship-release step 3;
  resolves the changelog open item routed from verify-handoff)

### Fixes

- Governance log forgery via embedded newlines in `reason`/`memoryId` —
  normalized to one line before logging, both lanes (P3.1 gate COND-001,
  security; findings RK-P31-1 / CE-001 / SEC-001 / DAT-001)
- `npm run verify` no longer writes test rows into a foreign instance —
  read-only identity probe before the first write aborts with the
  `AGENT_MEMORY_URL` instruction (P3.1 gate COND-002, engineering; finding
  RK-P31-7, High)
- MCP delete input schemas advertise `minLength`/`maxLength` again
  (bounds on both sides of normalize) (P3.1 gate C3-R17, engineering)
- Recap asserts per-bullet session membership, not just an echoed id
  (P3.1 gate COND-004, engineering; finding CE-003)

### Domain Ships

- **Quality gate: OPEN** — 4 pass + 4 conditional-with-conditions-cleared,
  C3 17/17 PASS, waivers W1–W4 (three-block bar, expiring 2026-12-21).
  Record: commits `0fe0b97` (gate report, 8 reviews, C3) and `e9b0504`
  (handoff) — paths at those commits: the P31 quality-gate lane under
  `docs/specs/40_workspace/` (workspace purged at archive
  per ship-release hygiene; history is the record).
- **Security:** governance log declares purpose, store, retention/deletion,
  field allowlist + masking rule (P3.1 gate COND-003 + C3-R13,
  `f2a65d4` + `d7a7628`); zero secrets/content in logs verified by review.
- **Data:** contract §1/§2 and `db/queries.ts` byte-untouched — no new
  labels, edges, indexes, or migration (data review, PASS).

### Breaking Changes

- **None — additive.** Behavioral note: clients asserting *exactly 7* MCP
  tools now see 11; update count assertions (in-repo assertions already
  updated). Migration path: none required. Undo path: revert range below.

## Known Issues

- **MCP behavioral round-trip unasserted in E2E** (QA F-4, accepted with
  shared-digest mitigation) — workaround: handshake probe covers registration;
  recommend a stdio harness in P3.x — owner: engineering.
- **Upstream residue:** a pre-guard verify run wrote project
  `verify-18637b3b` into the user's upstream `agentmemory` (port 3111); the
  upstream instance is currently down. Purge when it's back: enumerate
  `GET /agentmemory/sessions?project=verify-18637b3b` → per-session
  memories → `POST /agentmemory/forget {memoryId}` each → health 0.
  Recurrence prevented by the identity guard — owner: user/deploying
  operator.
- **ESC/NUL advisory gap:** sanitize collapses whitespace but not
  `ESC`/`NUL` control chars in `reason` (no forgery primitive — no ANSI
  decoding in the log path) — owner: engineering, re-review with W1 expiry.
- **MCP lane strips unknown keys** instead of 400-rejecting (SDK-mediated;
  REST strict-rejects; `origin` server-forced both lanes) — accepted, waiver
  W1 — owner: security re-review 2026-12-21.

## Rollback / Undo

- **Code:** `git revert` of the release commit reverts docs/version; the
  feature range is `e9fd325..` (14 P3.1 commits) + release commit. Pure
  revert — no schema, index, or migration change; `origin:"lesson"` rows
  persist as inert data; version markers return to 0.1.0. Owner:
  engineering owner. ETA: ≤15 min (risk review, RK rollback analysis).
- **Data undo:** none needed — no backfill; delete receipts are audit-only.
- **Non-code undo:** restore prior README/CONTRACT wording via the same
  revert; no comms/filings/launches exist for this ship.

## Documentation audit (ship-release step 4)

- `README.md` — version badge v0.2.0, CHANGELOG/release-notes links,
  P3.1 route/tool tables + examples already synced (verified this release).
- `CHANGELOG.md` — created; `[v0.2.0] — 2026-09-22` entry.
- `INSTALL.md` — **N/A-justified:** README Quick start is the install guide;
  every command in it (helix/bootstrap/dev/verify) executed successfully this
  session. Owner: engineering.
- `MIGRATION.md` — **N/A-justified:** no breaking changes (additive release).
- Version lockstep — manual 3-marker sync (this repo has no
  `scripts/bump-version.mjs`; N/A script): `package.json`,
  `.opencode/plugins/agent-memory.ts` `VERSION`, `src/mcp.ts` `McpServer`
  version → all `0.2.0`. Zero remaining `0.1.0` markers (grep-verified).
- `docs/specs/` lifecycle — **no backlog spec to archive (N/A-justified):**
  P3.1 originated in ROADMAP.md, not a `20_backlog/SPEC-*.md`; the lane
  record is ROADMAP (marked done) + history (`33849ee..e9b0504`).
  `40_workspace/` purged at release per ship-release hygiene.

## Verification (pre-ship, this release)

- `npm run typecheck` → clean (no `any`, no `@ts-ignore`, no TODO/FIXME).
- `npm run verify` (target: our server, `AGENT_MEMORY_URL=…:3151`) →
  **102 passed, 0 failed → VERIFY PASS**.
- MCP handshake → exactly 11 tools, delete schemas advertise bounds.
- Plain `npm run verify` (no `AGENT_MEMORY_URL`) → identity-guard abort,
  exit 1, zero writes.
