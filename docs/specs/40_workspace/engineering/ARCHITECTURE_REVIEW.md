# Architecture Review — Engineering Lane (R1) singleton (multi-lane)

**Reviewer:** engineering owner (R1, `general(vasquez)`) — per `skills/review-architecture/references/architecture-review.md`
**Singleton:** this file is the engineering lane's `ARCHITECTURE_REVIEW.md` — create-if-missing, update in place, never suffix. One section per lane; prior lane content preserved verbatim below the separator.

| Lane | Proposal | Spec | Date | Verdict | ADR |
|---|---|---|---|---|---|
| **Lane 3 — Todos follow-ups (current)** | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-020-todos` | 2026-09-25 | **Approved** | **none, verdict only (§6)** |
| Lane 2 — P4 ops control plane | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-P4-OPS` | 2026-09-24 | **Approved-with-conditions (C1–C3)** | **none, verdict only** |
| Lane 1 — F01 embedding verify (prior, preserved below) | inline orchestrator proposal | `SPEC-F01-EMB` | 2026-09-24 | Conditional | none |

---

# Architecture Review: SPEC-020-todos (Todos follow-ups) — Lane 3

**Reviewer:** engineering owner (R1, `general(vasquez)`) — per `skills/review-architecture/references/architecture-review.md`
**Date:** 2026-09-25
**Verdict:** **Approved** — per §6 ADR trigger test, no ADR required (verdict only)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:security-Approved / DOMAINS:R1,R2,R8`

| Input | Artifact |
|---|---|
| Proposal (7 rows: 6 file-modify + 1 config/bootstrap) | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` — retro-doc lane, grounded `db/queries.ts:32-34,127-193,720-852` · `src/store.ts:289-351,1313-1472` · `src/server.ts:136-177,268-283,470-560` · `src/mcp.ts:113-147,411-536` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` · `hooks/capture.mjs:209-286` |
| Canonical contract (this lane) | `docs/specs/10_design/ARCHITECTURE.md` v2 — singleton, already merged by `translate-to-spec` (DO NOT MODIFY per packet) |
| Specs | `docs/specs/20_backlog/SPEC-020-todos.md` (REQ-TODO-01..07 + NFR-TODO-A..D) · `docs/briefs/BRIEF-todos.md` (approved 2026-09-25, frozen) |
| Gate | `security-Approved` — bearer parity + hook PII posture co-signed by `general(barrera)` R2; this review does not re-decide R2 |

## Contract Compliance — Interfaces (proposal vs ARCHITECTURE.md v2)

| Contract Ask | ARCHITECTURE.md | PROPOSED_CHANGES.md | Status | Notes |
|---|---|---|---|---|
| **Todo node 12 indexes** (REQ-TODO-01) | §6 DB contract: `Todo {todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId?}` + 4 indexes `todo_id` uniqueEquality `todoId`, `todo_project` equality `project`, `todo_status` equality `status`, `todo_title` text `title` tenant `project` → total 12; `todoRowProjection` + 6 builders `saveTodo/listTodos/getTodoById/updateTodo/searchTodosByText/deleteTodo`; `db/queries.ts:32-34,127-193,727-862` | Row `db/queries.ts` file-modify — identical 4 indexes, identical label `Todo`, identical projection `$id→id + 9 fields` with `parentId="" → undefined` on read, identical param sets/batches; no other DDL; `scripts/bootstrap.ts` 8→12 | **pass** | Proposal is verbatim restatement of §6. Additive only via `bootstrapIndexes`; Types `TodoRow` in `src/store.ts:289-322` carry `parentId` absent-as-"" semantics. |
| **Alias `/agentmemory/`** (REQ-TODO-02) | §7 REST contract: `isAgentMemoryAlias` rewrites `/agentmemory/todos*` and `/agentmemory/frontier*` → `/memory/*` **before** bearer guard; bearer identical to other `/memory/*` (only `livez` exempt, 401 + `www-authenticate: Bearer`); 6 routes with schemas strict, `parentIdSchema 1..200` | Row `src/server.ts` file-modify — same rewriter position before guard, same 6 routes `POST /memory/todos 201`, `GET /memory/todos 200 {todos}`, `GET /memory/todos/:id`, `PATCH /memory/todos/:id {parentId:string\|null}`, `DELETE /memory/todos/:id`, `GET /memory/frontier 200 {frontier,count}` + alias pair; `src/server.ts:136-177,268-283,470-560,584-588` | **pass** | Scope-limited rewriter (only `todos\|frontier`, remainder 404) matches §7 Notes + SPEC R3 Low. No port or guard weakening. |
| **parentId optional hierarchy** (REQ-TODO-04) | INV-012 + §7/Components: scalar `parentId?` only, app-side filter (no dedicated index), fail-closed `parent todo not found: <id>` → 400, `cannot be its own parent` → 400, `PATCH parentId:null` clears (`""` stored → read undefined), `GET ?parentId=` exact-match `parentId ?? ""` | Rows `src/store.ts` + `src/server.ts` + `src/mcp.ts` + `plugins/...` — `createTodo`/`updateTodo` lookup `getTodo(parentId)` → throw 400, `updateTodo` merge `null→""` clear, `===todoId` self 400, `parentIdSchema`/`MAX_TODO_ID 200` bounds; `filterTodos` exact `parentId`; MCP `memory_todo_create/update` + plugin `memory/todo_create/update` mirror `string\|null` | **pass** | INV-012 preserved verbatim; over-fetch `max(limit*4,100)` ≤400 accepted residual (SPEC R1 Low, NFR horizon >1k children). No `PARENT_OF` edge (explicit out-of-scope, SPEC §5). |
| **Frontier semantics** (REQ-TODO-06 + REQ-TODO-03 sort) | §7 `GET /memory/frontier {frontier,count}` = `pending ∪ active` priority-ordered; `filterTodos` order `priorityRank(high3>med2>low1) desc → updatedAt localeCompare desc → todoId asc`; `GET /memory/todos?frontier=true` same set; search branch BM25 `searchTodosByText(q,project,limit)` → `filterTodos` + substring fallback | Rows `src/store.ts` (`filterTodos`, `frontierTodos` delegates to `listTodos({frontier:true})`, `rawListTodos(max(limit*4,100))`) + `src/server.ts` frontier route + `src/mcp.ts` `memory_frontier` + plugin `memory/frontier`; heuristic search BM25 on `todo_title` tenant `project` + fallback `title/description` icase over 200 | **pass** | Frontier = unblocked = `pending∪active`; `done\|blocked` excluded next read; `search+frontier` composition via `filterTodos` as specced. No graph/lease/signal semantics added (INV-011). |
| **Remaining surfaces** — MCP 6 tools (REQ-TODO-05), plugin 6 tools + hook auto-extract (REQ-TODO-07) | §8 MCP `memory_todo_create/list/get/update/delete` + `memory_frontier` via `handle(_meta)` bearer; §9 plugin 6 tools namespace `memory` codemode total 11; §10 hook `Stop\|SessionEnd\|PreCompact\|PostToolUse`, `collectBody` ≥400, lines 12..200, cap 5→dedup→3, 1.5s fire-and-forget, exit 0 | Rows `src/mcp.ts:113-147,411-536` (isMetaAuthorized, `_meta.authorization="Bearer <secret>"`), `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` (`MAX_TODO_TITLE 500` etc), `hooks/capture.mjs:209-286` (extractTodos pure + POST ≤3) | **pass** | Each maps onto existing Components table entry; hook never logs prompt/secret (Ley 172-13 NFR-TODO-B); zero new deps (NFR-TODO-A), never kill intact (NFR-TODO-C). |

## Contract Compliance — Invariants (INV-001..012, `ARCHITECTURE.md:165-198`)

| Invariant | Status | Notes |
|-----------|--------|-------|
| INV-001 zero new deps | pass | `node:` + `@helix-db/helix-db@3.0.4` only; `package.json`/`package-lock.json` untouched per PROPOSED_CHANGES Risk/Alternatives. |
| INV-002 frozen surfaces | pass | Lane is retro-doc — no new `src/**`/`db/**` edit proposed; `helix.toml` additive via `bootstrapIndexes` 12 (sanctioned, §6). Previous P4 lane's `[local.slotN]` + MCP stdio rules unaffected. |
| INV-003 never-kill | pass | No signal/kill path in change set; hook 1.5s timeout bounded; `src/server.ts:641-661` port guards untouched. |
| INV-004 no secret in output/state | pass | Hooks/MCP/plugin never log secret; `logSafeNote` sanitized; bearer passthrough only. |
| INV-005 defaults untouched | pass | REST 3111 / Helix 6969 / `AGENT_MEMORY_URL` default preserved; alias is rewrite, not default change. |
| INV-006 doctor verdict closed set | pass | Not touched by this lane (R1 todos only). |
| INV-007 state file outside HELIX_DATA_DIR | pass | Not touched. |
| INV-008 migration fail-closed | pass | Not touched. |
| INV-009 status ≠ doctor | pass | Not touched. |
| INV-010 env/flags only | pass | Not touched; this lane derives no new slot/quartet. |
| INV-011 todos naming `todos` never `actions`; graph/leases/signals out-of-scope | pass | Proposal + ARCHITECTURE §2/§5 explicitly enforce `todos` everywhere, YAGNI cut `requires/unlocks/gated_by/conflicts_with` deferred to P4.3. |
| INV-012 parentId app-side, fail-closed 400, null clears | pass | Matched above; no dedicated parentId index minted. |

## Cross-Domain Contract Impact

- **R2 (Security) — GATE:security-Approved already:** bearer guard on 6 REST routes + alias before guard, MCP `_meta` bearer (`isMetaAuthorized`/`handle`), hook allowlist (no prompt text, no secret, titles `clean 0..120`), Ley 172-13 purpose/TTL/minimization (NFR-TODO-B) — all consumed as `ARCHITECTURE.md` §7/§8/§10 state and `PROPOSED_CHANGES.md` Security Considerations. This review does not re-decide R2; it records the gate as satisfied.
- **R8 (Automation/Ops):** hook detached `extractTodos` pure + fire-and-forget `slice(0,3)` `AbortSignal.timeout(1500)`, always exit 0; plugin `memory/*` 5→11 with `recallCache.clear()` on mutate; `scripts/bootstrap.ts` 12-index expectation. No pipeline/CI gate weakening (INV-010, R8 scope). Consumed verbatim from ARCHITECTURE §10 + PROPOSED_CHANGES R8 row.
- **No cross-domain delta:** neither proposal nor review edits `SPEC-P4-OPS-RUNBOOK.md` or the §4b allowlist; all cross-domain interfaces enumerated in AGENTS.md guardrails remain satisfied.

## ADR Required? — §6 Trigger Test

- [ ] Yes — ADR created
- [x] **No — change is within existing contracts (verdict only, citing §6)**

### Reasoning (no-ADR verdict, §6)

ADR trigger test — breaks/creates an invariant, adds a component to the canonical contract, or changes a cross-domain contract. None fires:

1. **No invariant broken or created.** Proposal implements INV-011 and INV-012 exactly as `ARCHITECTURE.md` v2 already states them; INV-001..010 untouched. It mints no new invariant. The 4 Todo indexes are not a new invariant — they are the §6 DB contract that `translate-to-spec` already merged into the canonical file.
2. **No component added beyond the contract.** Every proposal row maps onto an existing Components/Interfaces/Data Flow entry: Todo node (§6), REST + frontier (§7), MCP (§8), plugin (§9), hook (§10). Data Flow §5 Todos lifecycle already describes the end-to-end `POST → BM25+fallback → filterTodos → frontier` flow. No watcher, janitor, second binary, new edge type, or new Helix label beyond `Todo`.
3. **No cross-domain contract changed.** R2 security and R8 automation contracts are *consumed* unchanged; the proposal edits neither the R8 runbook nor the R2 allowlist. Blast radius is dev-only (`storage="disk"`, loopback `POST /memory/todos`), no customer/regulator/revenue plane impact.

Comparator applied: **Todo node 12 indexes** (§6), **alias** (`isAgentMemoryAlias` before guard, §7), **parentId scalar app-side** (INV-012 + §7), **frontier `pending∪active` priority-ordered** (§7 + §5 lifecycle) — all four are cited verbatim in both artifacts; no delta.

### Condition that invalidates this no-ADR verdict (§6)

Execution **STOPs and mints `docs/specs/12_adr/ADR-012-todos.md`** (`Status: proposed`; next free number — `docs/adr/ADR-0001` exists, `docs/specs/12_adr/` does not exist yet; one number, one file, never reuse) if reconciliation or implementation reveals any of:

- an **ARCHITECTURE.md amendment** — e.g. adding a `PARENT_OF` edge, a dedicated `parentId` index, a `todo_description` text index for BM25, or a new `TodoHistory` label — any edit to the canonical contract requires an ADR;
- a **new component** outside the Components table (a watcher/janitor, second binary, new route/tool beyond the 6+6+6, or a new Helix label beyond `Todo`);
- an **invariant delta** — any deviation from INV-001..012 (including weakening `INV-012` fail-closed 400, changing frontier to include `blocked`, or adding graph/lease/signal semantics);
- a **cross-domain change** — any edit to `SPEC-P4-OPS-RUNBOOK.md` (R8) or to the R2 §4b allowlist scope rather than consumption by name.

Default otherwise: citation-only, no ADR (this verdict).

## Conditions for Approval

None — **Approved** without conditions. `GATE:security-Approved` satisfied; `HARD:subagents` honored (retro-doc lane, subagents frozen at frame-intent); `ARCHITECTURE.md` v2 requires no in-lane edit per packet. Cleared for `frame-ship:quality-gate` and `frame-ship:verify-handoff`.

## Sign-off

- [x] **engineering owner (R1, `general(vasquez)`)** — **Approved**: proposal matches `ARCHITECTURE.md` v2 on Todo node 12 indexes (§6), alias before guard (§7), parentId scalar app-side (INV-012), frontier `pending∪active` priority-ordered (§7 + Data Flow §5); no invariant break, no new component, no cross-domain delta; **no ADR (verdict only, §6)**.
- [x] **security owner (R2, `general(barrera)`)** — **Approved** (gate carried: `GATE:security-Approved` in packet; bearer + alias-before-guard + MCP `_meta` + hook no-PII posture co-signed).
- [ ] **automation/ops owner (R8, `general(espinoza)`) — PENDING countersignature if required** (hook detached + plugin tool count + bootstrap 12 consumed as written; no pipeline change).

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:security-Approved / DOMAINS:R1,R2,R8`
**ADR:** none, verdict only (§6) — invalidation triggers above; next free number reserved: `ADR-012-todos` (mint only on trigger)
**Commit:** left to orchestrator (lane synthesis): `docs(arch-review): SPEC-020-todos Approved, no ADR (§6)`

### Scoped evidence (this review)

- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md:13-29` (summary + 7 rows), `:32-44` (alternatives), `:61-96` (risk + blast radius + rollback), `:98-106` (C2 hook) — retro-doc lane.
- `docs/specs/10_design/ARCHITECTURE.md:27-44` (Components — 5 Todo rows), `:112-139` (§6–§10 Todos contracts: DB §6, REST §7, MCP §8, plugin §9, hook §10), `:141-198` (Data Flow §5 Todos lifecycle + INV-011/INV-012 + frozen surfaces), `:199-209` (NFRs perf/avail/security).
- `docs/specs/20_backlog/SPEC-020-todos.md:20-53` (REQ-TODO-01..07), `:54-60` (NFR-TODO-A..D), `:61-73` (AC-TODO-01..07 traceability), `:108-145` (dependencies/risks R1..R3 + assumptions A1..A3), grounded anchors `db/queries.ts:32-34,127-193` · `src/store.ts:289-351,1313-1472` · `src/server.ts:136-177,268-283,470-560` · `src/mcp.ts:113-147,411-536` · `hooks/capture.mjs:209-286` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097`.
- Repo state: `docs/specs/10_design/ARCHITECTURE.md` v2 intact (not modified per packet); `docs/specs/12_adr/` does not exist → no ADR minted (verdict only); `docs/adr/ADR-0001-*` exists (convention); `GATE:security-Approved` carried in packet.

---

# Architecture Review: SPEC-P4-OPS (P4 ops control plane)

**Reviewer:** engineering owner (R1, `general(vasquez)`)
**Independent reviewer:** Automation/Ops Owner (R8, `general(espinoza)`) — **sign-off PENDING countersignature** (no live R8 reply exists in this session; the written R8 position is `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md` — §4a verdict contract, §4b allowlist, §4d stop ownership, Blocks A–D — cited below as that position, not as a live approval)
**Date:** 2026-09-24
**Verdict:** **Approved-with-conditions (C1–C3)** — `frame-ship:execute-spec` may start once C1 is reconciled and C2 is recorded; C3 discharges at quality-gate.

**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#Contracts / HARD:subagents+<zero new deps, frozen src/db/hooks/plugins, default 3111 untouched> / GATE:none-yet / DOMAINS:R1 (independent review R8)`

| Input | Artifact |
|---|---|
| Proposal (7 rows: 2 file-create · 1 file-modify · 2 document-update · 1 config-update · 1 reference/no-op) | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` |
| Canonical contract (this lane) | `docs/specs/10_design/ARCHITECTURE.md` v1 — singleton, created in translate-to-spec |
| Specs | `docs/specs/20_backlog/SPEC-P4-OPS.md` (R1) · `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md` (R8, consumed by name) |
| Real surfaces read | `src/server.ts`, `src/store.ts`, `helix.toml`, `package.json`, `git status`/`git diff` |

## Contract Compliance — Interfaces (proposal vs ARCHITECTURE.md)

| Interface | Status | Notes |
|-----------|--------|-------|
| §1 CLI surface (start/stop/status/doctor, flags, exits 0/1/2 + doctor 0–5, `--help` exit 0, `--apply`/`--yes` gates → exit 2) | pass | Proposal row 1 (`PROPOSED_CHANGES.md:21`) matches §1 flag/effect/exit cells for all four subcommands; fail-closed parsing in the style of `src/server.ts:477-483` (parsePort: default `3111`, integer 1–65535 else throw → usage, exit 2). `status` takes `--slot N` only (reports the data dir, no `--data-dir` flag) — same as §1 and SPEC §4.1. |
| §2 Slot→port table `R(N)=3111+3(N−1)`, `H(N)=6969+(N−1)` (A1 accepted) | pass | Proposal rationale (`:37`) restates A1 verbatim; slot 1 = `3111/6969/3112/3113` + instance `dev`, slot 2 = `3114/6970/3115/3116` + `slot2`, slot 3 = `3117/6971/3118/3119`. Math checked: N≥2 ⇒ R(2)=3114>3113 and H(2)=6970>6969, intersection with `{3111,3112,3113,6969}` = ∅; `3151` is unreachable as a REST role (3151−3111=40, not divisible by 3) or Helix role (H starts at 6969) — only slot 14's *reserved* `R+1` = 3151, and reserved ports are never bound, never signaled (§2 invariants; R-007 consistent). |
| §3 Derived env contract (7 variables, env/flags projection only) | pass | Proposal rows 1/4 + rationale project `AGENT_MEMORY_PORT`, `AGENT_MEMORY_URL`, `HELIX_URL`, `HELIX_DATA_DIR`, `AGENT_MEMORY_DATA_DIR` (precedence `--data-dir` > env > `~/.local/share/agent-memory/<slot>/`), `AGENT_MEMORY_SECRET` (passthrough), `AGENT_MEMORY_HOST`. Verified against code: `src/server.ts:525` `parsePort(process.env.AGENT_MEMORY_PORT)`, `:526` `AGENT_MEMORY_HOST ?? "127.0.0.1"`, `:527` `secretFromEnv()`; `src/store.ts:524` `HELIX_URL ?? "http://localhost:6969"`. Slot-1 defaults unchanged — derivation, not a default change. |
| §4 State file schema + path | pass | Fields in proposal (`:106`: `slot`, `pids {rest, helix}`, `helixInstance`, `dataDir`, `startedAt`, `cliVersion`) are the exact §4 field list; path `<parent-of-data-dir>/state/slot-<N>.json` outside `HELIX_DATA_DIR`; never a secret, memory content, or PII. |
| §5 Doctor verdict/exit contract (0/1/2/3/4/5, precedence `5>4>3>1>0`, C1–C5, one terminal `VERDICT: <name>`) | pass | Proposal rationale (`:35`) reproduces the §5 table line-for-line = RUNBOOK §4a (`SPEC-P4-OPS-RUNBOOK.md:262-275`) as both specs declare canonical; triggering checks match (C4/C2-401→5, C1/C2-500→4, C3→3, C5/internal→1, all-pass→0), usage 2 outside precedence; `status` keeps its own 0/1/2 and is not `doctor` (INV-009). Migration backup default `<target>.backup-<UTC-ts>` (RUNBOOK §4c) with §1 `--backup-dir` override — compatible, no conflict. |

## Contract Compliance — Invariants (INV-001..010, `ARCHITECTURE.md:127-150`)

| Invariant | Status | Notes |
|-----------|--------|-------|
| INV-001 zero new deps; `package.json` gains only `bin` + `verify-ops` | pass | Verified `package.json` today: scripts `:17-31`, deps `:32-42`, **no `bin` key**; proposal modifies exactly those two entries, `package-lock.json` untouched. |
| INV-002 frozen surfaces never modified by any subcommand | pass | Change set touches only `bin/` + `scripts/` (new), `package.json` (2 rows), `README.md`, `TEST_MATRIX.md`, `helix.toml` `[local.slotN]` via official `helix add local`. `[local.dev]` (`helix.toml:6-10`, port 6969, tag `v0.0.6`, `storage = "disk"`) frozen per row 6. |
| INV-003 never-kill; tracked PIDs only; forbidden primitives enumerated | pass | Proposal rows 1 + risks R-011 + Q3: signals only to state-file PIDs; `helix stop <instance>` named; forbidden set matches §INV-003/§4.5 incl. `--persist`; `start` refuses with the `NEVER kill` hint (`src/server.ts:514-522`, `REROUTE_PORT=3151` at `:503`), exit 1, occupant untouched; doctor exit 3 report-only (RUN-REQ-04). |
| INV-004 no secret/env value in output or state file; flags only | pass | `bearer: armed\|unset` / `secret: present\|missing` only; matches `src/server.ts:537-542` (prints `auth: open\|bearer-required`, never the value); AC-B synthetic-secret 0-hit assertion. |
| INV-005 defaults untouched (3111 / 6969 / hook-plugin clients 3111) | pass | Slots are derivation through env/flags; `git diff --stat src/ db/` empty today (verified) and must stay so (AC-06/KR2). |
| INV-006 doctor closed set + fixed precedence + one terminal verdict line | pass | Identical table in proposal, ARCHITECTURE §5, RUNBOOK §4a; multi-failure precedence proof delegated to AC-05/AC-OPS-RUN-02 at gate (C3). |
| INV-007 state file outside `HELIX_DATA_DIR`; Helix owns its dir exclusively | pass | Sibling `state/` dir, never inside; proposal `:106` and REQ-07. |
| INV-008 migration fail-closed; MinIO volume never destroyed | pass | Dry-run default → pre-flight → verified backup → copy → verify; no verified backup → ABORT; forbidden `helix prune|delete`, `docker volume rm` (§4.5); rollback plan keeps the old volume as the recovery path. |
| INV-009 `status` is not `doctor` (0/1/2 vs 0–5) | pass | Status row exits 0/1/2 (`:21`); AC-04 requires status exit 1 to be distinct from the doctor verdict `upstream-holds-port`. |
| INV-010 env/flags only; zero `src/**`/`db/**` edits; quartet never intersects protected set; reserved never bound/signaled | pass | Change rows contain no `src/**`/`db/**` edit; reserved ports read-only occupancy probes reported as `reserved`; derivation math checked above. |

## Frozen Surfaces (INV-002, `ARCHITECTURE.md:152-157`)

| Surface | Status | Notes |
|---------|--------|-------|
| `src/**` · `db/**` · `hooks/**` · `plugins/**` | pass | Zero rows modify them; `git diff --stat src/ db/ hooks/ plugins/` empty at review time (verified); AC-06 + KR2 re-assert at gate. |
| `mcp_config.json` — MCP stays **stdio**, no new port | pass | MCP-HTTP explicitly rejected in Alternatives (`:49`); no new MCP port anywhere in the change set. |
| `helix.toml` `[local.dev]` | pass | Additive `[local.slotN]` tables written by official `helix add local` = config registration (A5, sanctioned by brief §3.2), explicitly not a source edit; `[local.dev]` never rewritten (`--persist` forbidden). |
| Dependency manifests + `package-lock.json` | pass | `dependencies`/`devDependencies` and lockfile untouched; `package.json` `bin`+`verify-ops` exemption is explicit in INV-001's own text (resolved, not a conflict). |

## Cross-Domain Contract Impact

- **R8 (Automation/Ops) — runbook consumed by name, unchanged:** the proposal modifies no runbook, no CI workflow (`.github/workflows/ci.yml` unchanged by default, RUN-REQ-09/A1), and no existing suite; `verify-ops` is additive and stays out of CI unless Helix-free (RUN-REQ-12). Verdict/exit contract, §4b allowlist, §4d stop-ownership (PID file + `helix.toml` instance name, cmdline re-verification per RUN-REQ-13) and forbidden primitives (RUN-REQ-14) are consumed as written. **One reconciliation open → C1 below** (flag-syntax friction, pre-existing ARCHITECTURE↔RUNBOOK, not a proposal deviation; RUNBOOK's own R2 already names the orchestrator as the resolver, "before implementation — never silently merged").
- **R2 (Security) — output hygiene cross-cut:** §4b allowlist and C4 presence-only posture are reproduced without relaxation (`NFR-B/F`, proposal Security section); newly exposed surface = the CLI *reads* `AGENT_MEMORY_SECRET` from the operator's env to probe `/memory/health` — presence-checked, never rendered, state file excludes it. R2 co-sign of the allowlist remains a pending approval in the proposal (unchecked) and is discharged at `frame-ship:review-security` (C2 below) — this review does not substitute for it.

## ADR Required?

- [ ] Yes — ADR-XXX created
- [x] **No — change is within existing contracts (verdict only)**

### Reasoning (no-ADR verdict)

ADR trigger test — breaks/creates an invariant, adds a component to the canonical contract, or changes a cross-domain contract. None fires:

1. **No invariant broken or created.** The proposal implements INV-001..010 exactly as `ARCHITECTURE.md` already states them; it mints no new invariant. The CLI itself is not a new component decision — ARCHITECTURE.md's Components table (arg parser, slot derivation, spawn manager, state file, doctor checker, migrator) was codified for *this* lane in translate-to-spec, and `verify-ops` is already named inside INV-001.
2. **No component added beyond the contract.** Every proposal row maps onto an existing Components/Interfaces/Data Flow entry (row-by-row above). `README.md`/`TEST_MATRIX.md` are documentation/evidence, not contract surfaces.
3. **No cross-domain contract changed.** The R8 runbook and R2 hygiene rules are *consumed* unchanged; the proposal edits neither. The one flag-syntax friction (C1) pre-dates this proposal (ARCHITECTURE §1 vs RUNBOOK §4c/REQ-05 literal) and its named resolution path is orchestrator reconciliation (RUNBOOK R2) — minting an ADR now would decide a question the orchestrator owns, before any code exists.

### Condition that invalidates this no-ADR verdict

Execution **STOPs and mints `docs/specs/12_adr/ADR-0002-<slug>.md`** (next free number — `docs/adr/ADR-0001-application-side-dedup-uniqueness.md` consumed; `docs/specs/12_adr/` does not exist yet; one number, one file, never reuse; `Status: proposed`) if reconciliation or implementation reveals any of:

- an **ARCHITECTURE.md §1 amendment** — e.g. adding `--dry-run` or an `INSTANCE` positional to the CLI surface (see C1 route (a)) — any edit to the canonical contract requires an ADR;
- a **new component** outside the Components table (a watcher/janitor, second binary, new route/tool, MCP port);
- an **invariant delta** — any deviation from INV-001..010 (including weakening doctor's closed set/precedence, moving the state file inside `HELIX_DATA_DIR`, or any signal path reachable from `doctor`);
- a **cross-domain change** — any edit to `SPEC-P4-OPS-RUNBOOK.md` requirements/§4a/§4b/§4d (R8) or to the §4b allowlist scope (R2) rather than consumption by name.

Default otherwise: citation-only, no ADR.

## Conditions for Approval

**C1 — Reconcile the cross-domain flag syntax BEFORE execute-spec (orchestrator, per RUNBOOK R2).** Two literal frictions exist between ARCHITECTURE §1 and the R8 runbook; both are testable in R8's ACs:

- (a) RUNBOOK `REQ-OPS-RUN-05` + `AC-OPS-RUN-04` invoke `doctor --migrate --dry-run` literally, while §1/SPEC §4.1 define `--migrate` as *dry-run by default* with no `--dry-run` flag — and the CLI parses fail-closed (unknown flag → exit 2), so the literal command would fail R8's evidence artifact.
- (b) RUNBOOK `REQ-OPS-RUN-01` header and §4d accept an `INSTANCE` positional (`doctor [INSTANCE|--slot N]`, `stop [--slot N | INSTANCE]`), while §1 defines `--slot N` only. Flag/arg surface is R1-owned (RUNBOOK §5 explicitly scopes it out for R8).

**Default (stated, chosen over hedging): route (b1)** — orchestrator rephrases the two R8 invocation literals to the `--slot` surface (substantive requirements — zero-write plan artifact, exit 0, named-instance stop ownership — are already satisfied by §1 as written). No ARCHITECTURE change → no ADR. **Alternative (b2):** orchestrator requires literal alignment → that amends ARCHITECTURE §1 → **STOP, mint ADR-0002 first**, never an in-lane ARCHITECTURE edit. Record the outcome (either way) in this file before `execute-spec` starts; no third loop.

**C2 — Sign-offs recorded, not assumed.** R8 countersignature on the runbook-facing rows (REQ-OPS-RUN-01..02 verdict/precedence, 03 allowlist, 04 report-only, 05..08 migrate, 13..14 stop-guard proofs) is **pending** — this review cites `SPEC-P4-OPS-RUNBOOK.md` as R8's written position only; R8 must countersign before quality-gate. R2 co-sign of the §4b allowlist + C4 posture must land at `frame-ship:review-security` before implementation touches `doctor`/`status` output paths.

**C3 — Invariant evidence at quality-gate (no silent PASS).** Every "pass" above is design-level; at `quality-gate` each maps to allowlisted evidence: INV-001→AC-01/E (`git diff package.json`, lockfile untouched, typecheck) · INV-002→AC-06 + KR2 (`git diff --stat src/ db/ hooks/ plugins/` empty, `helix.toml` delta limited to `[local.slotN]`) · INV-003→AC-A + RUN-REQ-14 proofs (i)–(iv) · INV-004→AC-B (synthetic secret 0 occurrences) + AC-05 · INV-005→AC-C + verify-env PASS · INV-006→AC-05 + AC-OPS-RUN-02 (multi-failure precedence run) · INV-007→AC-07 · INV-008→AC-08 + AC-OPS-RUN-04..07 · INV-009→AC-04 · INV-010→AC-06 derivation table + empty `git diff src/ db/`.

## Invariant Questions (recorded, resolved or escalated)

1. **State file as "sole authority" (§4) vs cmdline re-verification (RUN-REQ-13).** Resolution: the state file remains the sole *source of signal targets*; re-verifying a state-listed PID's command line before SIGTERM is an identity guard on that entry, not a second target source — consistent with INV-003. ARCHITECTURE Data Flow 2 is silent, not contradicted → compliant strengthening, no contract delta, no ADR.
2. **INV-001 (package.json may change) vs INV-002 ("manifests frozen").** Resolved as written: INV-001's explicit `bin` + `verify-ops` exemption controls; `dependencies`/`devDependencies`/lockfile remain frozen. Not a conflict.
3. **Flag-syntax friction (`--dry-run`, `INSTANCE` positional).** Escalated as C1 (orchestrator, pre-execute). Neither is a proposal↔ARCHITECTURE deviation — the proposal follows ARCHITECTURE exactly.
4. **Assumption A3 failure (`HELIX_DATA_DIR` not honored on v0.0.6) → framing 3b.** No invariant question: ARCHITECTURE §3 already codifies `HELIX_DATA_DIR` as "unset for dev **until migration/fallback**" and Data Flow 4 mandates ABORT, never partial migration (INV-008). The fallback is anticipated by the contract; it is an orchestrator decision (R-002), not a contract change.

## Sign-off

- [x] **engineering owner (R1, `general(vasquez)`)** — **Approved-with-conditions**: proposal matches `ARCHITECTURE.md` on all five interfaces, INV-001..010, and every frozen surface; **no ADR (verdict only)**. Cleared for `frame-ship:execute-spec` after C1 is reconciled and recorded here; C2 recorded before gate; C3 discharges at quality-gate.
- [ ] **automation/ops owner (R8, `general(espinoza)`) — PENDING countersignature** (independent reviewer named in packet). Written position on file = `SPEC-P4-OPS-RUNBOOK.md` (§4a/§4b/§4d, REQ-OPS-RUN-01..15); live reply not yet received — this line must be countersigned before quality-gate. Conditions: C1 outcome recorded; stop-guard proofs (i)–(iv) and verdict/precedence rows land in `TEST_MATRIX.md` `## P4 OPS`.
- [ ] **security owner (R2, `general(barrera)`)** — cross-cut, pending `frame-ship:review-security` (§4b allowlist + C4 posture co-sign; C2).

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#Contracts / HARD:subagents+<zero new deps, frozen src/db/hooks/plugins, default 3111 untouched> / GATE:none-yet / DOMAINS:R1 (independent review R8)`
**ADR:** none, verdict only (invalidation triggers above; next free number reserved: ADR-0002)
**Commit:** left to orchestrator (lane synthesis): `docs(arch-review): SPEC-P4-OPS approved-with-conditions, no ADR`

### Scoped evidence (this review)

- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md:13-29` (summary + 7 rows), `:33-39` (rationale), `:41-50` (alternatives), `:61-133` (risk), `:118-133` (C2 self-grill).
- `docs/specs/10_design/ARCHITECTURE.md:27-39` (Components), `:41-102` (Interfaces §1–§5), `:104-125` (Data Flow), `:127-157` (INV-001..010 + frozen surfaces), `:159-169` (NFRs).
- `docs/specs/20_backlog/SPEC-P4-OPS.md:35-120` (REQ/NFR), `:184-252` (§4.1–§4.6), `:273-312` (assumptions/risks), `:314-332` (traceability).
- `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md:46-209` (REQ-OPS-RUN-01..15), `:260-322` (§4a–§4e), `:371-420` (risks R1–R6 incl. R2 divergence rule, assumptions A1–A6).
- Real surfaces: `src/server.ts:477-483` (parsePort default 3111, fail-closed), `:502-522` (REROUTE 3151 + NEVER-kill hint), `:524-527` (host/secret), `:537-542` (presence-only auth log), `:544-549` (SIGTERM/SIGINT drain); `src/store.ts:524` (`HELIX_URL` default `http://localhost:6969`); `helix.toml:6-10` (`[local.dev]` frozen); `package.json:17-42` (no `bin`, deps unchanged).
- Repo state: `git diff --stat src/ db/ hooks/ plugins/` empty (tracked source untouched; only doc-lane artifacts untracked, including this review's sibling files from parallel lanes); `bin/` and `scripts/verify-ops.ts` absent → proposal phase intact (no merged code under a `Status: proposed` record — skill step 3 FAIL condition not met). ADR inventory: `docs/adr/ADR-0001-*` exists (Accepted, P1-P21 lane); `docs/specs/12_adr/` absent → next free number 0002 (reserved, not minted).

---

# Architecture Review: SPEC-F01-EMB (embedding verify invariant) — Lane 1 (prior, preserved)

**Reviewer:** engineering owner (vasquez) — per `skills/review-architecture/references/architecture-review.md`
**Date:** 2026-09-24
**Verdict:** Conditional (no ADR; execute-spec blocked on P0, cleared on C1–C5)

**Scope (single review, one per lane — this is the engineering-lane singleton):**

| Input proposal | Spec |
|----------------|------|
| Inline orchestrator proposal: extend `getMemoryById` to project `embedding`; add `embedding` invariant to `verifyMergedState` via `embeddingsEqual`; heal via `retryWrite`; token only in logs | `docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06` — **MISSING (see P0)** |

**Canonical contract:** `docs/CONTRACT.md` (v1.5 frozen singleton — this repo has no
`docs/specs/10_design/ARCHITECTURE.md`; CONTRACT.md is the declared "source of truth
for both build lanes" and carries the §1/§2/§3 interfaces + data-flow tables).
ADR convention lives at `docs/adr/` (established by ADR-0001).

## Contract Compliance

| Invariant | Status | Notes |
|-----------|--------|-------|
| §2 projection rule ("never return `embedding` in search results") | pass | The ban targets the search/hit-stream routes and §3 result row shape. `getMemoryById` is an INTERNAL verify re-read: its row is consumed only by `getFreshSurvivor`, which narrows to `{memoryId, content, createdAt, dedupKey}` (+ in-memory embedding compare). Embedding never reaches a REST body, MCP tool result, search row, or hook payload. |
| §2 frozen exports (`getMemoryById` signature) | pass | Projection widening only: params, `returning(["memory"])`, and export names unchanged. No new query, no new export. |
| §1 labels/edges/`EMBED_DIM` + 8 indexes (no DDL) | pass | `embedding` is already a `Memory` property (f32[384]); read anchors on existing unique index #1. No index, label, edge, or property addition. `storage=disk` untouched. |
| §3 tier-1 (b) ATOMICITY — post-write verify + ONE heal + fail-closed named throw | pass (strengthened) | `embedding` joins content/dedupKey/concepts as a 4th verified invariant. Heal reuses the existing `retryWrite` = identical `sendMergedUpdate(mergedWrite)` (already carries the embedding). Still-violated → existing `REQ-F-01` named throw. This is the closure of the CONTRACT §3 tier-1 (b) **named residual**, explicitly pre-authorized: "add an `embedding` invariant to `verifyMergedState` in its own lane" (`ROADMAP.md` §1.3 row `F-01-EMB`). |
| §3 guard path (link-only heal never touches embedding) | pass | Unchanged: the substring-guard path rewrites no content/embedding/dedupKey; the embedding invariant lives only in `verifyMergedState` (merge path), matching the residual's scope. |
| §3 heal observability (SEC-F02 allowlist, `oneLine` CWE-117, stderr) | pass with condition C3 | Family token `embedding` may join the `invariants=` list (same class as the existing `content`/`dedupKey` tokens); vector VALUES and element dumps stay out of logs/errors forever. |
| §3 RL-001-QUEUE send envelope (6 happy / ≤11 worst-heal / ≤165 s) | pass | Zero additional sends — the embedding rides the existing `getMemoryById` read (before-violations) and the existing retryWrite. Payload grows ~1.5–3 KB per read; negligible vs the 15 s `withTimeout`. Envelope declaration needs no re-declaration. |
| §3 single-writer / same-process scope (RL-001) | pass | Verify still runs under the survivor lock; no new concurrency surface. Cross-process posture unchanged (out of contract until P4.3). |
| §5 verification bar | condition C5 | Suites must grow for the new invariant (see C5); §5 check counts updated in the same lane. |
| HARD `no-secrets` | pass | No credential material touched; logs carry memoryId + family tokens only. |

## ADR Required?

- [ ] Yes — ADR-XXX created
- [x] No — change is within existing contracts

### Reasoning (no-ADR verdict)

ADR trigger test: breaks/creates an invariant, adds a component, or changes a
cross-domain contract. None fires:

1. **No invariant broken.** The verify only *gains* an assertion — and that assertion
   is the sanctioned closure of a residual the contract itself already declares
   (`docs/CONTRACT.md` §3 tier-1 (b) named residual + `ROADMAP.md` §1.3 `F-01-EMB`).
   Closing a declared deviation with its prescribed remediation is contract *execution*,
   not contract change. Fail-closed posture, ONE-heal rule, and named-throw mechanics
   are untouched.
2. **No component added.** No new query function, index (DDL), route, MCP tool, module,
   or service. One projection field on an existing internal read + one pure helper
   (`embeddingsEqual`) inside the existing `verifyMergedState`. Component topology and
   data-flow table unchanged.
3. **No cross-domain contract change.** REST/MCP request/response shapes, the 11 MCP
   tools, hook payloads, and the §3 result row shape are byte-unchanged. `getMemoryById`
   widening is app-internal; the value is compared in memory and never exported.

The §2 `getMemoryById` doc line ("projects `memoryRowProjection + dedupKey`") and the
`db/queries.ts:529` comment ("never `embedding`") become stale — that is factual
bookkeeping amended alongside the code (condition C4), not an ADR-grade decision.

### Condition that invalidates this no-ADR verdict

Execution **STOPs and mints `docs/adr/ADR-000N-<slug>.md` (next free number after
ADR-0001; this repo's convention) with `Status: proposed`** if implementation reveals
that it:

- adds a **new component**: a separate embedding-read query, a repair/janitor job, a
  new route/tool, or a new index/DDL;
- lets an embedding **value** (or derived vector material) reach any response body,
  log line, error message, or hook payload — that would amend the §2 projection ban
  and the SEC-F02 log allowlist (then barrera R2 co-signs);
- **relaxes** fail-closed mechanics: more than ONE heal, silent pass on unverifiable
  state, or dropping the named-throw on still-violated;
- changes a §3 `RememberResult`/REST/MCP shape or the §2 frozen export list beyond the
  projection widening reviewed here.

Default otherwise: citation-only, no ADR.

## Conditions for Approval

**P0 — BLOCKER (packet integrity):** `docs/specs/20_backlog/SPEC-F01-EMB.md`
(`REQ-F-01-EMB-01..06`) **does not exist** (searched repo-wide, 2026-09-24), and no
`PROPOSED_CHANGES.md` has been persisted for this lane. The reference-only packet does
not resolve → `execute-spec` MUST NOT start. Orchestrator: land the spec (translate-to-spec) and persist the proposal, or correct the packet.

**C1 — f32 round-trip-safe equality (Critical if naive):** `embeddingsEqual` must NOT
compare raw JS doubles `===` against the read-back vector. The write coerces to
`f32[384]` (§1) and the read returns f32-decoded numbers, so a naive `===` mismatches
on virtually every element → EVERY merge verify would report an `embedding` violation →
heal → still-violated → `REQ-F-01` throw → all tier-1 merges fail closed (500).
Pin in the spec: normalize the expected side with `Math.fround` per element (or an
explicit epsilon ≤ 1e-6), and prove it on the live dev instance (round-trip evidence).

**C2 — missing/poisoned embedding read is a heal-able violation:** absent property,
non-array, or length ≠ `EMBED_DIM` on the fresh read is recorded as the `embedding`
violation (→ `retryWrite` heal → re-verify → named throw if still wrong). It is exactly
the residual scenario; it must never silently pass and never hard-throw BEFORE the one
heal attempt.

**C3 — token-only logging (R2, SEC-F02 + CWE-117):** logs and error text carry the
family token `embedding` only — never vector values, never element dumps. `oneLine`
collapse, stderr channel, one line per confirmed heal. The §3 COND-RK-02 runbook family
list (`content/dedupKey/links`) gains `embedding` in the same doc pass (C4).

**C4 — in-lane doc amendments with the code (contract never lags shipped code):**
`docs/CONTRACT.md` §2 `getMemoryById` line (+ `embedding`, internal-verify-only), §3
tier-1 (b) named residual → **CLOSED**, §3 heal-line family list, §5 check counts;
`db/queries.ts:529-531` comment rewrite; `ROADMAP.md` §1.3 `F-01-EMB` row → CLOSED
(with closure date + evidence commit).

**C5 — suite evidence (R8):** `verify*.ts` grows three checks: (i) a real committed
merge passes the embedding invariant (live round-trip proof — the C1 guard), (ii) an
induced embedding mismatch → ONE `retryWrite` heal → re-verify green + heal line carries
the `embedding` token, (iii) post-heal still-violated → named `REQ-F-01` throw listing
`embedding`. Existing send-budget assertions stay green (0 new sends).

## Dependencies / cross-cutting

- **R1 (engineering):** owns code (queries.ts, store.ts) + contract/roadmap doc pass (C4).
- **R2 (security):** owns C3 sign-off (log allowlist scope); ADR invalidation trigger #2
  requires barrera co-sign.
- **R8 (automation/ops):** owns C5 suite evidence + §5 count updates.
- Ship-release promotes this review to `docs/specs/50_archive/F01-EMB/` and notes
  residual `F-01-EMB` closure in release notes.

## Sign-off

- [x] engineering owner (vasquez) — **Conditional**: architecture-compliant, **no ADR**;
  cleared for `frame-ship:execute-spec` only after P0 resolves and C1–C5 are carried in
  the spec/proposal.

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06 (MISSING — P0) / HARD:subagents+storage=disk+no-secrets / GATE:none-yet / DOMAINS:R1,R2,R8`

**Commit:** left to the orchestrator (lane synthesis): `docs(arch-review): F-01-EMB conditional, no ADR`
