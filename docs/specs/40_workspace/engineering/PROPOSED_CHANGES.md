# Proposed Changes: general(vasquez) — Engineering Owner

**Spec Reference:** SPEC-001-brainy-engineering — `docs/specs/20_backlog/SPEC-001-brainy-engineering.md#REQ-BRAINY-ENG-01..12+NFR-01..04`
**Brief Reference:** `docs/briefs/BRIEF-brainy.md` (architectural-initiative, approved 2026-09-25) + `docs/briefs/OKR-brainy.md` (O1 KR1.1-1.2, O2 KR2.1-2.3, O3 KR3.1-3.2)
**PRD Reference:** `../brainy/docs/PRD.md` §5–§8, §11
**Contract Reference:** `docs/CONTRACT.md` §0 verified facts frozen
**Agent:** general(vasquez) — Engineering Owner (R1)
**Date:** 2026-09-25
**Execution_Mode:** subagents (inherited from spec; max 2 lanes INV-006 — this lane is R1)
**Domains-Touched:** [engineering (R1, owner) · marketing/brand (R5) · automation/ops (R8) · security (R2) · legal/privacy (R4)]
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md#REQ-BRAINY-ENG-01..12+NFR-01..04 / HARD:subagents+max2lanes+no-secrets+alias1version+zero-impl-edits / GATE:none-yet / DOMAINS:R1,R5,R8,R2,R4`

---

## Summary

This proposal establishes the technical implementation blueprint for **Brainy v1** (renaming `agent-memory` → `Brainy` and evolving from a flat memory store into a personal knowledge management "Segundo Cerebro" system grounded in Tiago Forte's CODE/PARA methodology over HelixDB). The change set introduces structured HelixQL graph nodes (`Note`, `Project`, `Area`, `Resource`, `Archive`) alongside preserved backward-compatibility nodes (`Memory`, `Agent`, `Context`), 1536-dimensional vector embeddings with cosine similarity, Reciprocal Rank Fusion (RRF k=60) hybrid retrieval across vector, graph, and BM25 text search, REST `/v1/*` endpoints with a 1-version deprecated `/memory/*` alias carrying `X-Deprecated`, a stdio MCP server (`McpServer(name="brainy")`) exposing 4 primary Brainy tools with 11 `memory_*` aliases, dual-bearer secret resolution (`BRAINY_SECRET` with fallback to `AGENT_MEMORY_SECRET`), and operational migration tools for SQLite legacy imports and batch re-embedding — all under zero-any TypeScript strictness and zero repository implementation edits during proposal phase.

---

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `package.json` | file-modify | Update package metadata and entrypoints: rename `"name": "agent-memory"` → `"name": "brainy"` (line 2); update `"bin"` table (lines 14–16) to provide `"brainy": "./bin/brainy.mjs"` and retain dual-bin alias `"agent-memory": "./bin/agent-memory.mjs"` emitting a stderr deprecation notice for 1 version; add migration and validation scripts `"migrate-embeddings": "tsx scripts/migrate-embeddings.ts"` (line 35). Grounded: `package.json:2,14-16,21-35`. |
| `helix.toml` | file-modify | Update project name declaration: change `[project] name = "agent-memory"` → `name = "brainy"` (line 2); preserve container runtime (`docker`), image (`ghcr.io/helixdb/helixdb:v0.0.6`), storage (`disk`), and dev/slot2 ports 6969/6970 unchanged. Grounded: `helix.toml:1-17`. |
| `db/queries.ts` | file-modify | Expand HelixQL schema, parameter contracts, and batch query builders: (1) update `LABELS` (lines 28–34) adding `Note: "Note"`, `Project: "Project"`, `Area: "Area"`, `Resource: "Resource"`, `Archive: "Archive"`, and compat `Agent: "Agent"`, `Context: "Context"` alongside existing `Memory`, `Session`, `Concept`, `Todo`; (2) update `EDGES` (lines 36–40) adding `BELONGS_TO: "BELONGS_TO"`, `REFERENCES: "REFERENCES"`, `SUPERSEDES: "SUPERSEDES"`, `ABOUT: "ABOUT"`, `APPLIES_TO: "APPLIES_TO"`, `CAPTURED_BY: "CAPTURED_BY"`, `RELATES_TO: "RELATES_TO"`, and `HAS_CONCEPT: "HAS_CONCEPT"`; (3) update `EMBED_DIM` (line 43) from 384 to 1536; (4) update `bootstrapIndexes()` (lines 127–193) to create unique equality indexes on `Note.id`, `Project.name`, `Area.name`, `Resource.name`, `Archive.name`, `Agent.name`, `Context.name`, equality indexes on `project` tenants, vector indexes `note_embedding ON Note(embedding) 1536 cosine tenant project` and `memory_embedding ON Memory(embedding) 1536 cosine tenant project`, and BM25 text indexes `Note.content` and `Memory.statement` on tenant `project`; (5) declare parameter sets and export query builders `saveNote`, `listNotes`, `getNoteById`, `moveNote`, `distillNote`, `forgetNote`, `searchByVector`, `searchByText`, `graphSearch` (with note traversal), while preserving legacy memory builders (`saveMemory`, `forgetMemory`, `findMemoryByDedupKey`, etc.) and CONTRACT §0 facts (`writeBatch().forEachParam(empty)` safe, `NodeRef.var("outer")`, `varAsIf`, async `createIndexIfNotExists`). Grounded: `db/queries.ts:28-44,127-193,340-450`. |
| `src/embed.ts` | file-modify | Upgrade embedding pipeline to 1536 dimensions: update exported constant `EMBED_DIM = 1536` (line 16); implement remote embedding provider routing via HelixDB `Embed()` / OpenAI `text-embedding-3-small` (when provider configured) with deterministic keyless 1536-bucket FNV-1a + golden-ratio sign bit hash fallback (lines 28–97) with L2 normalization for deterministic, offline, and keyless test execution; support `BRAINY_EMBED_DIM` env override (default 1536, fallback 384 for migration). Grounded: `src/embed.ts:15-17,28-48,68-97`. |
| `src/store.ts` | file-modify | Implement second-brain PARA domain logic in `HelixStore` while maintaining full `MemoryStore` backward compatibility: (1) declare TypeScript models `NoteRow`, `ProjectRow`, `AreaRow`, `ResourceRow`, `ArchiveRow`, `ParaCategory ("project" | "area" | "resource" | "archive")`, `SaveNoteInput`, `ListNotesInput`, `MoveNoteInput`, `DistillNoteInput`, and `ParaClassificationResult`; (2) implement `HelixStore.saveNote` generating 1536-dim embeddings via `embed()`, evaluating automatic PARA classification heuristics, executing `saveNote` query batch with initial `BELONGS_TO` edge to PARA node, and querying candidate notes for `RELATES_TO` edge linking if cosine similarity >0.85; (3) implement `HelixStore.listNotes`, `HelixStore.getNoteById` (projecting linage `SUPERSEDES` and `BELONGS_TO`), `HelixStore.moveNote` (dropping previous `BELONGS_TO` and attaching new PARA target), `HelixStore.distillNote` (appending progressive summary note with `SUPERSEDES` edge), and `HelixStore.forgetNote`; (4) implement `classifyPara` heuristic rules based on title, content keywords, and tag analysis; (5) preserve existing memory methods (`remember`, `getMemory`, `forgetMemory`, `listMemories`, `searchByText`, `searchByVector`, todo methods) unaltered. Grounded: `src/store.ts:23-60,289-351,616-624,1313-1472`. |
| `src/search.ts` | file-modify | Upgrade hybrid retrieval engine to support 1536-dim vectors, graph relations, and RRF fusion: update `hybridSearch` (lines 110–264) to execute parallel retrieval across (a) 1536-dim vector similarity on `Note` + `Memory`, (b) BM25 full-text search on `Note.content` / `Memory.statement`, and (c) graph traversal across `BELONGS_TO`, `REFERENCES`, and `RELATES_TO` edges up to `max_depth` (default 2); apply Reciprocal Rank Fusion (RRF) with constant `k = 60` ($score = \sum \frac{1}{60 + rank_i}$); preserve fault-tolerant signals envelope where upstream source failure records `signals: ["vector: ..."]` without returning HTTP 500. Grounded: `src/search.ts:30-70,110-264`. |
| `src/server.ts` | file-modify | Expand REST routing to Brainy v1 specification with 1-version deprecated legacy alias: (1) define strict zod schemas `createNoteBodySchema`, `updateNoteBodySchema`, `searchNotesQuerySchema`, `linkNodesBodySchema`, `contextQuerySchema`; (2) register routes `POST /v1/notes` (201), `GET /v1/notes/:id` (200/404), `POST /v1/search` (200), `POST /v1/memory` (201, legacy compat translating `statement` to `content`), `GET /v1/context/:project` (200), `POST /v1/link` (201); (3) add route alias interceptor for legacy `/memory/*` endpoints responding with `308 Permanent Redirect` or in-process routing with HTTP header `X-Deprecated: use /v1/*`; (4) update bearer auth middleware (lines 20, 180–285) to check `BRAINY_SECRET` from environment with backward-compatible alias to `AGENT_MEMORY_SECRET` emitting a deprecation log warning on fallback; preserve `livez` health route. Grounded: `src/server.ts:20,26-33,38-60,180-285,470-650`. |
| `src/mcp.ts` | file-modify | Upgrade stdio MCP server: (1) rename server instance to `McpServer({ name: "brainy", version: "1.0.0" })` (line 541); (2) register 4 core Brainy tools via `registerTools`: `brainy_search` (hybrid 1536 vector + graph + BM25), `brainy_capture` (capture with automatic PARA classification), `brainy_link` (typed edge creation `REFERENCES` / `BELONGS_TO` / `RELATES_TO`), `brainy_reality_check` (active rules, conventions, and project context); (3) maintain 11 legacy `memory_*` tools (`memory_save`, `memory_search`, `memory_todo_*`, etc.) as aliases forwarding to store methods with deprecation annotations; (4) validate `_meta.authorization` against `BRAINY_SECRET` with `AGENT_MEMORY_SECRET` fallback; maintain stdio stdout purity (protocol only) and stderr diagnostics. Grounded: `src/mcp.ts:14-23,35-60,113-147,520-560`. |
| `src/compat/agentmemory.ts` | file-create | Implement SQLite to HelixDB migration module conforming to PRD §7.2: map `memories.statement` → `Memory.statement`, `memories.type` → `Memory.memory_type`, `objects.name` → `Resource.name`, `contexts.name` → `Context.name`, `links.about` → `E::ABOUT`, `links.context` → `E::APPLIES_TO`; provide idempotent import function `migrateAgentMemoryDatabase(sqlitePath, project)` executing batched writes via `migrateAgentMemoryRow` query batch. |
| `scripts/bootstrap.ts` | file-modify | Update bootstrap lifecycle script: update environment resolution to read `BRAINY_URL` with `HELIX_URL` fallback (default `http://localhost:6969`); execute updated `bootstrapIndexes()` creating all PARA and compat indexes; update async polling loop to probe both BM25 (`Note.content`) and vector index readiness (`note_embedding`) with 2s interval and 30s cap until `index_not_found` clears; print `READY — Brainy indexes verified` on completion. Grounded: `scripts/bootstrap.ts:10-18,51-95`. |
| `scripts/import-transcript.ts` | file-modify | Update transcript import utility: resolve server URL and authentication using `BRAINY_URL` and `BRAINY_SECRET` with `AGENT_MEMORY_*` fallbacks; route transcript text blocks to `POST /v1/notes` or `POST /v1/memory` based on `--mode` flag; preserve Ley 172-13 privacy invariants (omitting user prompt text unless `--include-prompts` is explicitly set). Grounded: `scripts/import-transcript.ts:29-85,200-289`. |
| `scripts/migrate-embeddings.ts` | file-create | Create operational embedding migration script: scan existing `Memory` and `Note` records with 384-dimensional vectors; generate new 1536-dimensional embeddings in batches using `embed()`; update embeddings in HelixDB using `writeBatch.forEachParam` with `setProperty("embedding", vector)` without downtime; verify 100% completion against vector index. |

---

## Rationale

Each proposed modification traces directly to the requirements and non-functional requirements established in `docs/specs/20_backlog/SPEC-001-brainy-engineering.md`:

- **REQ-BRAINY-ENG-01 (Rename atómico con alias 1 versión):** Addressed via `package.json`, `helix.toml`, and CLI wrapper bin setup, enabling seamless transition from `agent-memory` to `brainy` while maintaining dual-bin support and stderr deprecation warnings for 1 version.
- **REQ-BRAINY-ENG-02 (Cleanup deuda iii/agentmemory):** Addressed by eliminating all non-compat references to `iii` and `agentmemory`, relegating SQLite legacy support exclusively to `src/compat/agentmemory.ts`.
- **REQ-BRAINY-ENG-03 (Nodos & edges CODE/PARA + compat):** Addressed in `db/queries.ts` and `src/store.ts` through the definition of `Note`, `Project`, `Area`, `Resource`, `Archive`, `Agent`, `Context`, and the 7 typed edge relationships.
- **REQ-BRAINY-ENG-04 (Vector & text indexes 1536-dim):** Addressed in `db/queries.ts` via `bootstrapIndexes()` configuring 1536-dim cosine vector indexes (`note_embedding`, `memory_embedding`) and scoped full-text indexes.
- **REQ-BRAINY-ENG-05 (Capture Flow):** Addressed via `HelixStore.saveNote`, `POST /v1/notes`, and MCP tool `brainy_capture` with strict zod input validation.
- **REQ-BRAINY-ENG-06 (Organize PARA automático + move):** Addressed via `HelixStore.classifyPara`, `moveNote` edge mutation, and automatic `RELATES_TO` linking when cosine similarity exceeds 0.85.
- **REQ-BRAINY-ENG-07 (Distill con SUPERSEDES):** Addressed via `distillNote` batch query and `POST /v1/notes/:id/distill` route, enforcing immutable append-only versioning.
- **REQ-BRAINY-ENG-08 (Express context & export):** Addressed via `GET /v1/context/:project` graph traversal and CLI export formatting for Obsidian markdown vaults.
- **REQ-BRAINY-ENG-09 (Búsqueda híbrida RRF):** Addressed in `src/search.ts` via Reciprocal Rank Fusion ($k=60$) over vector, graph, and BM25 text search with graceful failure signals.
- **REQ-BRAINY-ENG-10 (Servidor MCP Brainy):** Addressed in `src/mcp.ts` with 4 native Brainy tools and 11 legacy `memory_*` aliases.
- **REQ-BRAINY-ENG-11 (Compat SQLite → HelixDB):** Addressed in `src/compat/agentmemory.ts` implementing the type mapping table from PRD §7.2.
- **REQ-BRAINY-ENG-12 (REST Brainy + legacy):** Addressed in `src/server.ts` with the complete PRD §8 route table and 1-version `X-Deprecated` header handling on `/memory/*`.
- **NFR-BRAINY-ENG-01 (Perf híbrido p95 <10ms @10k nodos):** Enforced via scoped queries (`where project` before index operations) and ANN index parameters.
- **NFR-BRAINY-ENG-02 (Persistencia ACID & bootstrap async):** Guaranteed by HelixDB disk storage mode and async poll loop in `scripts/bootstrap.ts`.
- **NFR-BRAINY-ENG-03 (Migración dims 384→1536):** Addressed via `scripts/migrate-embeddings.ts` and `BRAINY_EMBED_DIM` fallback support.
- **NFR-BRAINY-ENG-04 (No secrets / Ley 172-13):** Enforced via vault/env resolution of `BRAINY_SECRET`, PII minimization, and strict single-line sanitization in access and error logging.

---

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| **Hard breaking cut without 1-version aliases** | Immediate breaking change for existing Claude Code and OpenCode agents would crash live developer environments; 1-version deprecation window preserves operational continuity. |
| **Separate vector database (e.g. Qdrant/Pinecone) alongside SQLite** | Violates architectural goal of unified graph + vector + full-text in HelixDB; introduces distributed transaction sync issues and increased operational complexity. |
| **Synchronous external LLM call on every note capture for PARA classification** | Adds 500ms–2000ms latency to every write, introduces external network dependency, and increases inference cost; heuristic and embedding similarity classification is fast (<5ms) and local. |
| **In-place destructive mutation of note content during distillation** | Violates auditability, second-brain provenance, and contract requirements; append-only notes with `E::SUPERSEDES` maintain full historical lineage. |
| **Dynamic runtime dimension sniffing per query** | Causes index mismatch errors in HelixDB vector indexes; explicit 1536-dim standard with batched migration script and static env fallback is deterministic and safe. |

---

## Approval Required From

- [ ] **Owning domain owner:** general(vasquez) — Engineering Owner (R1) *(mandatory, architecture & spec compliance)*
- [ ] **Security owner:** general(barrera) — Security Owner (R2) *(mandatory, auth alias, secret leakage prevention, PII/Ley 172-13 boundary)*
- [ ] **Legal owner:** general(subero) — Legal Owner (R4) *(mandatory, Ley 172-13 privacy compliance, data minimization, Apache-2.0 license integrity)*
- [ ] *Coordinating review (non-blocking for spec proposal):* general(vera) — Marketing Owner (R5) *(brand rename consistency)*; general(espinoza) — Automation/Ops Owner (R8) *(CLI binary alias and port governance)*

> **Rule:** No repository file modifications during proposal phase. For non-code domains, no external sends/filings/launches during proposal phase either. This proposal is authoring documentation only; zero implementation files are modified.

---

## Risk Assessment — SPEC-001-brainy-engineering

**Proposer:** general(vasquez) — Engineering Owner (R1)  
**Date:** 2026-09-25  
**Domains-Touched:** engineering (R1, owner) · marketing/brand (R5) · automation/ops (R8) · security (R2) · legal/privacy (R4)

### Risk Matrix

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R-001** | Vector dimension mismatch (384 vs 1536) on unmigrated legacy databases causing vector search failures | Medium | High | Support `BRAINY_EMBED_DIM=384` fallback flag; provide automated batch migration script (`scripts/migrate-embeddings.ts`); gracefully catch vector search errors and report via `signals` without 500 error. |
| **R-002** | Downstream agent tooling breakage due to package/binary rename (`agent-memory` → `brainy`) | Medium | High | Maintain dual-bin entrypoints in `package.json` (`agent-memory` wrapper delegates to `brainy` with stderr warning); maintain HTTP alias route table with `X-Deprecated` header for 1 release cycle. |
| **R-003** | PARA automatic classification miscategorizing critical notes under wrong category | Medium | Low | Provide instant CLI/API correction (`brainy move <id> --to <category>`); default ambiguous notes to `Resource` inbox; ensure classification rules are deterministic and transparent. |
| **R-004** | Performance degradation in hybrid retrieval exceeding p95 10ms threshold at 10k nodes | Low | Medium | Scoped pre-filtering (`where project` before `vectorSearchWith` and `textSearchWith`); enforce strict query limits (`limit ≤ 100`, `max_depth ≤ 3`); benchmark via `scripts/eval.ts`. |
| **R-005** | Unauthorized access or secret leakage during dual-env transition (`AGENT_MEMORY_SECRET` / `BRAINY_SECRET`) | Low | High | Constant-time bearer token verification; secret values never printed in error notes, console logs, or HTTP responses (`logSafeNote`); pre-push git secret scanner. |
| **R-006** | HelixDB async index creation race condition during initial service startup | Low | Medium | Async polling loop in `scripts/bootstrap.ts` retries every 2s up to 30s until `index_not_found` clears before accepting incoming search traffic. |

### Blast Radius

- **Systems:** Local HelixDB instance (`http://localhost:6969`, disk storage on MinIO/local filesystem); Brainy REST daemon (port 3111, fallback ports 3112/3113 never-kill); MCP stdio bridge used by AI coding agents.
- **Teams:** Engineering (R1) implements data and server layer; Security (R2) audits bearer authentication and PII handling; Legal (R4) monitors Ley 172-13 privacy invariants; Marketing (R5) coordinates brand messaging and deprecation warnings; Automation/Ops (R8) coordinates binary distribution and port allocation.
- **Customers / Users / Agents:** External developers and autonomous agents (Claude Code, Cursor, OpenCode) interacting via REST or MCP. Any disruption is mitigated by 1-version backward compatibility on CLI flags, tool names, and API routes.
- **Regulators / Legal:** Ley 172-13 privacy compliance covering user notes and transcripts; no unmasked personal data exported or logged; explicit opt-in for prompt ingestion.
- **Revenue / Commercial:** Internal infrastructure component with no direct billing integration; developer productivity shielded from downtime via dual-bin fallback.

### Rollback Plan

- **Code Revert:** Execute clean git rollback of all SPEC-001 commits via `git revert <commit-hashes>` (owner: general(vasquez), estimated execution time < 15 minutes).
- **Data Rollback:** If 1536-dim schema requires rollback: drop `Note`, `Project`, `Area`, `Resource`, `Archive` nodes; retain existing `Memory`, `Session`, `Concept`, and `Todo` nodes intact; rerun `scripts/bootstrap.ts` with 384-dim schema.
- **Configuration Rollback:** Revert `package.json` name to `"agent-memory"` and `helix.toml` project to `"agent-memory"`; restore `AGENT_MEMORY_*` environment variables as primary.
- **Verification After Rollback:** Execute `npm run typecheck`, run test suite `npm run verify`, and verify that `searchByText` and `searchByVector` respond without `index_not_found`.

### Security Considerations

- **Authentication & Token Parity:** Both `BRAINY_SECRET` and legacy `AGENT_MEMORY_SECRET` are read from environment variables or vault only. Bearer tokens are validated in constant time; unmatched requests fail closed with HTTP 401 (`WWW-Authenticate: Bearer`).
- **Input Boundaries & CWE-117 Protection:** Inbound payloads are validated through strict zod schemas rejecting arbitrary properties; strings are constrained in length (`content` ≤ 200,000 chars, `title` ≤ 500 chars); single-line sanitization ensures no newline log injection.
- **Privacy & Ley 172-13 Compliance:** Note content is stored solely for second-brain retrieval and distillation; sensitive user transcripts are excluded by default in `scripts/import-transcript.ts`; deletion routines (`forgetNote`, `forgetMemory`) drop data permanently.

### Domain Considerations

- **Engineering (R1):** Enforce strict TypeScript typing (`noImplicitAny`), pure functions, decoupled store architecture, and immutable append-only versioning for note distillation.
- **Security (R2):** Confirm constant-time token comparison, lack of secrets in logs, and secure handling of `BRAINY_SECRET`.
- **Legal (R4):** Guarantee Ley 172-13 adherence regarding data minimization, clear purpose limitation, and user-initiated deletion.
- **Marketing/Brand (R5):** Ensure consistent naming across developer touchpoints with clear, friendly deprecation guidance on legacy aliases.
- **Automation/Ops (R8):** Guarantee non-blocking behavior in hooks, deterministic exit codes, and respect for upstream port reservations (ports 3111, 3112, 3113).

---

## C2 Challenge Hook Trigger Analysis (REQ-002)

### Trigger Checklist

| Trigger Condition | Triggered? | Evidence / Reason |
|-------------------|------------|-------------------|
| **Auth / data / API / PII surface touched** | **YES** | Introduces new REST `/v1/*` endpoints, MCP tools, HelixQL schema (`Note`, `Project`, `Area`, etc.), 1536-dim vector embeddings, and touches PII in note contents and transcripts. |
| **Multi-domain scope** | **YES** | Involves 5 distinct domains: R1 (Engineering), R5 (Marketing/Brand), R8 (Automation/Ops), R2 (Security), R4 (Legal/Privacy). |
| **Blast radius mentions customers / regulators / revenue** | **YES** | Mentions developer users / agents (Claude Code, OpenCode, Cursor) and regulatory privacy frameworks (Ley 172-13, GDPR data minimization). |
| **Approver request** | Pending | Approver may explicitly request challenge round during review. |

**Verdict:** The C2 Pre-Approval Challenge Round is **TRIGGERED** on multiple independent criteria.

### One-Pass Challenge Budget & Rules

- **Budget:** Exactly one budgeted round per trigger pass consisting of **≤ 3 questions**. Asking a 4th question (N+1) is a methodology violation and will result in an immediate automated **FAIL**.
- **Re-challenge Cap:** An approver may request at most one additional challenge round (total ≤ 2 passes). If issues remain after 2 passes, the decision is escalated to the orchestrator.
- **Masking Reminder:** All challenge prompts and exports must strictly adhere to the people SPEC §4 privacy clause:  
  > *"Por tu privacidad: no compartas PII/secretos/tokens en esta ronda; enmascaramos todo export (Ley 172-13)."*
- **Terminal Decision:** Following the round, the proposal receives a terminal **Approve** or **Reject**. If an exit is initiated prior to a terminal decision, the proposal is marked `grill: exited` and remains unapproved (no silent promotion).
- **Untouched Invariant:** Repository files remain completely untouched throughout the challenge round.

---

## Appendix / Historical Proposals

<details>
<summary>Historical Proposal: Lane 3 — SPEC-020 Todos (Shipped & Verified)</summary>

# Proposed Changes: general(vasquez) — Engineering Owner

**Spec Reference:** SPEC-020-todos — `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07`
**Brief Reference:** `docs/briefs/BRIEF-todos.md` (approved 2026-09-25) + `docs/briefs/OKR-todos.md` KR-1.1..2.3
**Agent:** general(vasquez) — Engineering Owner (R1)
**Date:** 2026-09-25
**Execution_Mode:** subagents (frozen at frame-intent; trivial <15 lines → CEO fast-path checkpoint-only, outside methodology)
**Domains-Touched:** [engineering (R1, owner), security (R2), automation/ops (R8)]
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents+zero-new-deps / GATE:none-yet / DOMAINS:R1,R2,R8`

> Retro-doc lane: implementation already shipped and verified in repo (grounded below). This proposal documents the as-implemented change set for review approval; no new impl edits are introduced by this doc (reference-only packet).

### Summary

Documents the bounded-initiative Todos lane — Helix `Todo` node with 12-index bootstrap, REST CRUD + frontier + `/agentmemory/` alias, BM25+fallback search with priority ordering, optional `parentId` hierarchy with 400 fail-closed/clear, 6 MCP tools, 6 OpenCode plugin tools, and fire-and-forget hook auto-extract — all under `subagents` execution, `zero-new-deps`, `src/db/hooks/plugins only`, `never kill upstream`, `BRIEF frozen`.

### Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `db/queries.ts` | file-modify | Add `LABELS.Todo="Todo"` + 4 Todo indexes to 12-index `bootstrapIndexes()` — `todo_id nodeUniqueEquality(Todo, todoId)`, `todo_project nodeEquality(Todo, project)`, `todo_status nodeEquality(Todo, status)`, `todo_title nodeText(Todo, title, project)` tenant `project`; add `todoRowProjection` (`$id→id + todoId,title,description,priority,status,project,sessionId,createdAt,updatedAt,parentId` with `parentId="" → undefined` on read); add param sets + batches `saveTodo`, `listTodos`, `getTodoById`, `updateTodo`, `searchTodosByText` (`where project → textSearchWith(Todo,title,q,k,project)`), `deleteTodo` (see SPEC §4.1). No other DDL. Grounded: `db/queries.ts:32-34,127-193,720-852` |
| `src/store.ts` | file-modify | Add `TodoPriority/Status`, `TodoRow`, `CreateTodoInput`, `UpdateTodoInput {parentId?: string\|null}`, `ListTodosInput`; implement `MemoryStore.createTodo` (title 1..500 trim, description 0..5000, defaults `priority=medium/status=pending`, parent lookup `getTodo(parentId)` → throw `parent todo not found` 400, `saveTodo`), `listTodos` (search branch `searchTodosByText(q,project,limit)` → `filterTodos` else `rawListTodos(max(limit*4,100))`, substring fallback `title/description` icase if 0 hits, `filterTodos` exact `status/priority/parentId/frontier(pending\|active)` + sort `priorityRank(high3>med2>low1) desc → updatedAt localeCompare desc → todoId asc → slice(limit)`, `frontierTodos` delegates), `getTodo`, `updateTodo` (re-fetch, merge, `parentId:null→""` clear / `string` non-empty trim 0..200, `===todoId→cannot be its own parent` 400, existence check 400, title non-empty), `deleteTodo`. Grounded: `src/store.ts:289-351,1313-1472` |
| `src/server.ts` | file-modify | Add zod schemas `todoPrioritySchema`, `todoStatusSchema`, `parentIdSchema 1..200`, `createTodoBodySchema strict`, `updateTodoBodySchema {parentId:string\|null}`, `listTodosQuerySchema {status,priority,search 0..500,frontier bool,parentId}`, `frontierQuerySchema`; add `isAgentMemoryAlias` rewriter — ` /agentmemory/todos*` or `/agentmemory/frontier*` → `/memory/*` before bearer guard (compat `POST http://localhost:3111/agentmemory/todos`); add 6 routes `POST /memory/todos 201`, `GET /memory/todos 200 {todos}`, `GET /memory/todos/:id 200/404/400`, `PATCH /memory/todos/:id {parentId:string\|null} 200/404/400`, `DELETE /memory/todos/:id 200/404`, `GET /memory/frontier 200 {frontier,count}` (+ alias pair) with bearer guard identical to other `/memory/*` (only `livez` exempt, 401+`www-authenticate: Bearer` on mismatch) and `HttpError 400 invalid_request` mapping for parent errors; defaults `project="default" limit=10 sessionId=""`. Grounded: `src/server.ts:136-177,268-283,470-560,584-588` |
| `src/mcp.ts` | file-modify | Add 6 tools under `registerTools` via shared `handle(name,_meta,op)` bearer `_meta.authorization="Bearer <secret>"` (`isMetaAuthorized`, unauth→`McpError InvalidRequest`, throw→`isError+logSafeNote`): `memory_todo_create` (title 1..500 req, description 0..5000, priority/status enums, project/sessionId/parentId opt; parentValidate→isError `{error:"parent todo not found…"\|"title is required"}`), `memory_todo_list` (project,limit1..100,status,priority,search0..500,frontier bool,parentId), `memory_todo_get` (todoId), `memory_todo_update` (todoId req+patch title/description/priority/status/parentId string\|null, ≥1 field), `memory_todo_delete` (todoId), `memory_frontier` (project,limit); `readOnlyHint/destructiveHint` and idempotence per tool; `todos` everywhere, never `actions`; stdout = MCP only, stderr = logs. Grounded: `src/mcp.ts:113-147,411-536` |
| `plugins/opencode/plugins/agent-memory.ts` | file-modify | Add 6 tools namespace `memory` codemode `memory/todo_create|list|get|update|delete|frontier` mirroring MCP bounds (`MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200`) and `parentId string\|null` null-cleans semantics; `todo_create` defaults `project=cfg.project sessionId=toolContext.sessionID`; `todo_list/frontier` build `URLSearchParams` with project/limit/status/priority/search/frontier/parentId; `todo_update` ≥1 field; `call()` adds `Authorization Bearer` if `cfg.secret`; `recallCache.clear()` on create/update/delete; total `memory/*` tools `11 =5 prev+6`. Version `agent-memory 0.8.0`. Grounded: `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` |
| `hooks/capture.mjs` | file-modify | Add `extractTodos(event,hook)` + `collectBody` — gated to `Stop|SessionEnd|PreCompact|PostToolUse`; body from `transcript|session_body|body|content|prompt.text|tool_output|result` or array join or JSON fallback; `body.length<400→0`; split lines `12..200` chars; heuristic `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → `{title:clean 0..120, description:"auto-extracted from session", priority:medium}` else line>60 with `(should|need to|must|blocked|revisit)`→low; cap 5→dedup icase title→return; `main()` fire-and-forget `slice(0,3)` `POST /memory/todos` with `title/description/priority/project/sessionId`, `AbortSignal.timeout(1500)` each, bearer if `AGENT_MEMORY_SECRET` set, never blocks (`.catch(()=>undefined)`, hook exit 0, never logs prompt text nor secret). Grounded: `hooks/capture.mjs:209-286` |
| `scripts/bootstrap.ts` | file-modify | Update bootstrap to expect/create **12** indexes (was 8) — verifies `todo_id, todo_project, todo_status, todo_title` alongside 8 memory/session/concept indexes; no new dep, HelixDB v3 only |

</details>

---

## Addendum — REQ-BRAINY-ENG-06: REST move route

**Date:** 2026-09-25
**Author:** general(vasquez) — Engineering Owner (R1)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md#REQ-BRAINY-ENG-06 + AC-06 + §4.3 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:proposal=approved,move-route=gap / DOMAINS:R1,R5,R8,R2,R4`
**Status:** proposal only — zero implementation files modified.

### 1. Problem statement (gap re-verified, not taken on faith)

- `REQ-BRAINY-ENG-06` (`docs/specs/20_backlog/SPEC-001-brainy-engineering.md:41`) requires CLI `brainy move <noteId> --to <project|area|resource|archive>` to rewrite the edge (drop old `BELONGS_TO` + add new); `AC-06` (`SPEC-001:76`) asserts it end-to-end.
- Store/query layers for the move already exist and were shipped in approved steps 2/4: `db/queries.ts:147` (`moveNoteParams`), `db/queries.ts:834` (`export function moveNote(...)` — anchors note, `setProperty paraCategory/updatedAt`, drops existing `outE(BELONGS_TO)`, anchors-or-creates target PARA node, adds new `BELONGS_TO`); `src/store.ts:1887` (`async moveNote(input: MoveNoteInput)` delegating to `moveNoteQuery(targetLabel).toQueryRequest(...)`, `src/store.ts:58-59,474,493,1900`).
- `src/server.ts` exposes **no** move route: grep `move` over `src/server.ts` returns 0 matches; route inventory grep `/v1/` over `src/server.ts` returns only `POST /v1/notes` (`:382`), `POST /v1/notes/:id/distill` (`:402`), `GET /v1/notes/:id` (`:419`), `POST /v1/search` (`:436`), `POST /v1/memory` (`:452`), `GET /v1/context/:project` (`:475`), `POST /v1/link` (`:498`) — no `/move`.
- The frozen REST tables confirm the gap: `SPEC-001 §4.3` (`SPEC-001:123-132`) lists 6 routes with no move row; `ARCHITECTURE.md §7` REST table (`ARCHITECTURE.md:139-144`) lists the same 6 routes with no move row, and its CLI table (`ARCHITECTURE.md:49`) maps `brainy move` only to "rewrite `BELONGS_TO` edge" with no HTTP binding.
- Lane R8 worked around the gap in `bin/brainy.mjs:1582-1606` (`cmdMove`): `GET /v1/notes/:id` (`:1587`) + `POST /v1/link {fromId, toId, type: BELONGS_TO}` (`:1597-1601`), with an inline comment (`bin/brainy.mjs:1594-1596`) admitting "the server has no dedicated move route" and that PARA-category targets surface as `400 invalid_tenant_link`. This proposal closes the gap at the HTTP layer so CLI `move` has a first-class target.
- The existing body of this proposal covers `HelixStore.moveNote` at store level (Changes row `src/store.ts`, Rationale REQ-06 line 49) but proposes no HTTP exposure. This addendum adds only that exposure.

### 2. Proposed changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `src/server.ts` | file-modify | Add one route `POST /v1/notes/:id/move` after the existing `GET /v1/notes/:id` block (`src/server.ts:419-435`), before `POST /v1/search` (`:436`). Add strict zod schema `moveNoteBodySchema = z.object({ to: z.enum(["project","area","resource","archive"]), name: z.string().trim().min(1).max(500), project: projectSchema.optional() }).strict()` beside `linkNodesBodySchema` (`src/server.ts:236-243`) and `distillNoteBodySchema` (`:245-250`); reuse existing `projectSchema`, `decodeSegment`, `parseOr400`, `HttpError`, bearer guard (`:364-380`, only `livez` exempt), and `sendJson`. Handler: decode `:id`, parse body (400 on schema fail), resolve tenant `project` (body `project` ?? query `?project=` ?? `"default"`), call already-approved `store.moveNote({ id, toCategory: body.to, toTarget: body.name, project })` (`src/store.ts:1887-1909` → `db/queries.ts:834-874` drop+add, no new HelixQL), map `false` → `404 note_not_found`, map unknown/empty target → `404 para_target_not_found`, map cross-tenant note/target mismatch → `400 invalid_tenant_link` (Security C8), success → `200 { id, para: { label, name } }`. Grounded: `src/server.ts:236-250,364-380,419-436,498-513`; `src/store.ts:1887-1909`; `db/queries.ts:147,834-874`. |
| `tests/step-move-route.test.ts` (new; or extend `tests/step6.test.ts`) | file-create (preferred) or file-modify | Add REST move-route coverage following the `tests/step6.test.ts:183-213,371-414` request-harness pattern (fake store with `moveNote`, bearer on/off, strict-body 400 probe). Cases: `POST /v1/notes/:id/move` 200 rewrites `BELONGS_TO` (assert single edge to new target via `getNoteById`); 404 unknown note; 404 unknown/empty target; 400 strict-zod reject (`replace`, empty `name`, unknown `to`); 400 `invalid_tenant_link` cross-tenant; 401 without bearer. No HelixDB container required (fake store, same as step6/7: `tests/step6.test.ts:74`, `tests/step7.test.ts:121`). Grounded: `tests/step6.test.ts:74,183-213,371-414`; `tests/step7.test.ts:121-127`. |
| `docs/specs/10_design/ARCHITECTURE.md` §7 REST table | doc-modify (contract delta, owner R1) | Add one row after the `GET /v1/notes/:id` row (`ARCHITECTURE.md:140`): `POST /v1/notes/:id/move` with strict `{to: project\|area\|resource\|archive, name: 1..500, project?}` → `200 {id, para:{label,name}}`, drop+add `BELONGS_TO` via `HelixStore.moveNote`, 404/400 tenant. No other §7 text changes. Grounded: `ARCHITECTURE.md:139-144`; `SPEC-001:123-132`. |
| `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` §4.3 table | doc-modify (contract delta, owner R1 — ONLY this table row) | Add one row after the `GET /v1/notes/:id` row (`SPEC-001:128`): `POST /v1/notes/:id/move` with strict `{to, name 1..500, project?}` → `200 {id,para}`, drop+add `BELONGS_TO`, 404/400. REQ/AC prose (`SPEC-001:41,76`) stays frozen and untouched. Grounded: `SPEC-001:41,76,123-132`. |

### 3. Contract shape (normative for implementation lane)

- **Method/route:** `POST /v1/notes/:id/move` (`:id` = note id, URL-decoded via existing `decodeSegment`).
- **Body (strict zod, unknown keys rejected):** `{ to: "project" | "area" | "resource" | "archive", name: string(trimmed, 1..500), project?: string }`. Tenant may also arrive via `?project=` query; precedence: body `project` ?? query `?project=` ?? `"default"`.
- **Auth:** existing dual bearer — `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`, constant-time compare, `401 unauthorized` + `WWW-Authenticate: Bearer` on mismatch; only `livez` exempt (`src/server.ts:364-380` pattern).
- **Tenant isolation (Security C8):** both the note and the PARA target must belong to the same `project` tenant; mismatch → `400 invalid_tenant_link` (same code the CLI workaround already surfaces, now enforced server-side before any edge write).
- **Semantics:** delegate to the already-approved `HelixStore.moveNote` (`src/store.ts:1887`) → `moveNote` query (`db/queries.ts:834`): drop previous `BELONGS_TO`, add new edge to anchored-or-created target. No new HelixQL beyond what step 2 shipped.
- **Responses:** `200 { id, para: { label, name } }` (`label` = `Project|Area|Resource|Archive`, `name` = target name); `404 note_not_found` (unknown `:id`); `404 para_target_not_found` (unknown/empty target); `400 invalid_request` (zod schema fail) / `400 invalid_tenant_link` (cross-tenant); `401 unauthorized`; error envelope = existing `{ error, details? }` shape.
- **Example (placeholders only, no PII/secrets):** `POST /v1/notes/<note-id>/move` `{ "to": "area", "name": "<area-name>" }` → `200 { "id": "<note-id>", "para": { "label": "Area", "name": "<area-name>" } }`.

### 4. Blast radius & affected REQs/ACs

- **Fixes:** REQ-BRAINY-ENG-06 / AC-06 — gives CLI `brainy move` (R8) a real HTTP binding that drops + re-adds `BELONGS_TO` instead of link-add-only.
- **Touched:** REQ-BRAINY-ENG-12 / AC-12 (REST route table gains one row — contract delta, see §5); Security C4 (zod caps: `to` enum, `name` 1..500, strict reject) and C8 (same-tenant check, `400 invalid_tenant_link`); no other REQ/AC changes.
- **NFR:** none (move is a single scoped write; p95/perf harness unaffected; no new index, no dimension change).
- **Blast radius:** one additive route + two one-row doc deltas; no schema change, no existing route behavior change, no MCP/bin change in this lane (R8 repoints CLI `move` to the new route in its own lane).

### 5. Contract-delta declaration (for review-architecture — ADR required, not written here)

- This addendum adds exactly **one row** to the frozen REST surface (`SPEC-001 §4.3` + `ARCHITECTURE.md §7`): `POST /v1/notes/:id/move`.
- Per methodology (contract change → ADR), an **ADR/delta record is required before implementation**. This lane does **not** write the ADR; the architecture reviewer lane owns the verdict and records the delta.
- Implementation lane is blocked on that verdict; `GATE:proposal=approved,move-route=gap` stays until the reviewer approves.

### 6. Test plan (REQ-ID → test → artifact) and risks/assumptions

**Test plan:**

| REQ/AC | Test | Artifact / assertion |
|--------|------|----------------------|
| AC-06 move rewrites edge | `POST /v1/notes/:id/move {to:"area", name:"<n>"}` on a note with existing `BELONGS_TO` | 200 `{id, para:{label:"Area",name}}`; `GET /v1/notes/:id` shows exactly one `BELONGS_TO` to the new target |
| AC-06 404 | move unknown `:id` | `404 note_not_found` |
| AC-12 route table | move route registered alongside §4.3 table | request harness hits `POST /v1/notes/:id/move` (not `/v1/link`); ARCH/SPEC one-row deltas present |
| C4 caps | strict body probes (`{replace}`, `name:""`, `to:"foo"`, oversize `name`) | `400 invalid_request` with zod details; unknown keys rejected |
| C8 tenant | note in project A → target in project B | `400 invalid_tenant_link`, no edge write |

**Risks/assumptions:**

- R-MOVE-01: `/v1/link` cannot express a move — `linkNodesBodySchema` (`src/server.ts:236-243`) + handler (`:498-513`) only *adds* edges (`store.linkNodes`); it never drops the previous `BELONGS_TO`, so repeated CLI `move` calls accumulate edges and PARA-category targets fail tenant checks (`bin/brainy.mjs:1594-1603`). Assumption: reviewers accept that link-add-only is insufficient and a dedicated drop+add route is the minimal fix (reuses approved query, no new HelixQL).
- R-MOVE-02: strict zod rejects the R8 workaround payload shape (`{fromId,toId,type}`) on the new route by design; R8 must repoint CLI `move` to `{to,name}` in its own lane — coordinated, not done here.
- R-MOVE-03: target auto-create (anchor-or-create in `db/queries.ts:857-867`) is retained; empty/unknown target maps to `404`, never to silent creation of a garbage node. Assumption: `MoveNoteInput` semantics in `src/store.ts:1887-1909` are unchanged.
- R-MOVE-04: no concurrency change — single-note move is one `writeBatch`; concurrent moves to the same note serialize in HelixDB; no new locking proposed.

### 7. Out of scope (explicit)

- No schema changes (no new nodes/edges/indexes beyond step 2 shipped).
- No new dependencies.
- No changes to `bin/` (R8 repoints CLI separately), no MCP tool changes, no `src/store.ts` / `db/queries.ts` changes (reuse as-is).
- No ADR authorship (reviewer lane owns it); no REQ/AC prose edits (only the §4.3 table row).
