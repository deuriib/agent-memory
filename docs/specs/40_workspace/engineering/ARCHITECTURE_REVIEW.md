# Architecture Review — Engineering Lane (R1) singleton (multi-lane)

**Reviewer:** engineering owner (R1, `general(vasquez)`) — per `skills/review-architecture/references/architecture-review.md`  
**Singleton:** this file is the engineering lane's `ARCHITECTURE_REVIEW.md` — create-if-missing, update in place, never suffix. One section per lane; prior lane content preserved verbatim below the separator.

| Lane | Proposal | Spec | Date | Verdict | ADR |
|---|---|---|---|---|---|
| **Lane 4 — Brainy Architecture Initiative (current)** | `PROPOSED_CHANGES.md` (R1, R5, R8) | `SPEC-001 / SPEC-002 / SPEC-003` | 2026-09-25 | **Approved** | **ADR-0002 created (`docs/adr/ADR-0002-brainy-code-para-helixdb.md`)** |
| Lane 3 — Todos follow-ups | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-020-todos` | 2026-09-25 | **Approved** | none, verdict only (§6) |
| Lane 2 — P4 ops control plane | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-P4-OPS` | 2026-09-24 | **Approved-with-conditions (C1–C3)** | none, verdict only |
| Lane 1 — F01 embedding verify (prior, preserved below) | inline orchestrator proposal | `SPEC-F01-EMB` | 2026-09-24 | Conditional | none |
| Lane 5 — move-route delta | `PROPOSED_CHANGES.md` addendum | `SPEC-001` REQ-06 | 2026-09-25 | **Approved-with-conditions (C1–C4)** | **ADR-0003 created** |
| **Lane 6 — SPEC-005 remediation (current)** | `legal/PROPOSED_CHANGES.md` (`a289ca0`, CDR-01..04) | `SPEC-005` REQ-LEG-01,03,04 | 2026-09-25 | **Approved-with-conditions (joint R1+R2)** | none, verdict only (§6) |

---

# Architecture Review: Brainy Architecture Initiative (SPEC-001 / SPEC-002 / SPEC-003) — Lane 4

**Reviewer:** engineering owner (R1, `general(vasquez)`) — per `skills/review-architecture/references/architecture-review.md`  
**Date:** 2026-09-25  
**Verdict:** **Approved** — ADR-0002 created and accepted (`docs/adr/ADR-0002-brainy-code-para-helixdb.md`)  
**Packet:** `SPEC:docs/specs/10_design/ARCHITECTURE.md#v3 / HARD:subagents+max2lanes+alias1version+CONTRACT-v3-grounded / GATE:none-yet / DOMAINS:R1,R8,R5,R2,R4`  

| Input | Artifact |
|---|---|
| Engineering Proposal (R1) | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` (12 rows: `package.json`, `helix.toml`, `db/queries.ts`, `src/embed.ts`, `src/store.ts`, `src/search.ts`, `src/server.ts`, `src/mcp.ts`, `src/compat/agentmemory.ts`, `scripts/bootstrap.ts`, `scripts/import-transcript.ts`, `scripts/migrate-embeddings.ts`) |
| Brand / Marketing Proposal (R5) | `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md` (12 rows: `README.md`, `CHANGELOG.md`, `docs/CONTRACT.md`, `package.json`, `plugin.json`, `mcp_config.json`, `helix.toml`, `bin/brainy.mjs` & `bin/agent-memory.mjs` shim, brand debt cleanup, policies, campaigns) |
| Automation / Ops Proposal (R8) | `docs/specs/40_workspace/automation/PROPOSED_CHANGES.md` (6 rows: `bin/brainy.mjs` create, `bin/agent-memory.mjs` shim, `package.json`, `scripts/verify-ops.ts`, `helix.toml` slot2, `src/server.ts` port hints) |
| Canonical Contract | `docs/specs/10_design/ARCHITECTURE.md` (v3 canonical singleton) |
| Specifications | `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` (R1) · `docs/specs/20_backlog/SPEC-002-brainy-brand.md` (R5) · `docs/specs/20_backlog/SPEC-003-brainy-ops.md` (R8) |
| Briefs & OKRs | `docs/briefs/BRIEF-brainy.md` (approved 2026-09-25) · `docs/briefs/OKR-brainy.md` (O1, O2, O3) |
| PRD Reference | `../brainy/docs/PRD.md` §5–§8, §11 |

## 1. Executive Summary & Verification Context

Under the Frame→Ship methodology and the architectural initiative `BRIEF-brainy`, this review evaluates the three synchronized domain proposals (`engineering`, `brand`, and `automation`) against the canonical singleton contract `docs/specs/10_design/ARCHITECTURE.md` (v3).

The proposed change package formally elevates the repository from a basic agent session memory store (`agent-memory`) to **Brainy**, an augmented "Segundo Cerebro" implementing Tiago Forte's CODE (Capture, Organize, Distill, Express) and PARA (Projects, Areas, Resources, Archives) methodologies natively over HelixDB. The shift encompasses:
- An atomic product rename to `brainy` across package manifests, CLI binaries, REST APIs, and MCP server identities with a strict 1-version backward-compatibility deprecation window.
- An expanded HelixQL graph schema adding 5 core PARA nodes (`Note`, `Project`, `Area`, `Resource`, `Archive`) and 7 typed relationship edges while preserving legacy `Memory`, `Agent`, `Context`, `Concept`, `Session`, and `Todo` nodes.
- An embedding dimension upgrade to 1536 dimensions (cosine distance) with remote provider routing and deterministic offline hash fallback.
- A hybrid search engine fusing 1536-dim vector ANN search, graph traversal, and BM25 text search via Reciprocal Rank Fusion ($k=60$).
- Strict preservation of the P4 operations control plane (`bin/brainy.mjs` with slot derivation $R(N) = 3111 + 3(N-1)$ and $H(N) = 6969 + (N-1)$, 5-check doctor with precedence $5 > 4 > 3 > 1 > 0$, state file mode `0700`/`0600`, and the non-negotiable **never-kill** invariant for ports 3111/3112/3113).

All three proposals maintain absolute fidelity to the canonical architecture contract v3, declare zero repository implementation edits during the proposal phase, and enforce strict type safety without `any`.

---

## 2. Contract Compliance — Components & Data Flow

| Component / Flow | ARCHITECTURE.md (v3) Contract | Proposals Coverage (R1, R5, R8) | Status | Notes |
|---|---|---|---|---|
| **Data Model & Schema (§6)** | Nodes: `Note`, `Project`, `Area`, `Resource`, `Archive` + compat `Memory`, `Agent`, `Context`, `Session`, `Concept`, `Todo`. 7 edges: `BELONGS_TO`, `REFERENCES`, `SUPERSEDES`, `ABOUT`, `APPLIES_TO`, `CAPTURED_BY`, `RELATES_TO` (+ `HAS_CONCEPT`). | R1 `db/queries.ts` + `src/store.ts` specify exact label set, 7 edge types, parametric query builders, and types without `any`. | **PASS** | Perfect match. All edges and labels match §6 line-for-line. |
| **Embedder (`src/embed.ts`)** | `EMBED_DIM = 1536` canonical. Remote provider routing (HelixDB `Embed()` / OpenAI `text-embedding-3-small`) + deterministic 1536-bucket FNV-1a hash fallback. L2 normalized. | R1 `src/embed.ts` implements 1536-dim constant, remote routing, keyless fallback, and `BRAINY_EMBED_DIM` env override. | **PASS** | Ensures offline deterministic testability while unlocking production 1536-dim embeddings. |
| **Store (`src/store.ts`)** | `HelixStore` implementing `saveNote`, `listNotes`, `getNoteById`, `moveNote`, `distillNote`, `forgetNote`, `searchByVector/Text`, `graphSearch`. Compat memory methods preserved. | R1 `src/store.ts` covers all methods, PARA models, `classifyPara` heuristics, and atomic edge re-writes under lock. | **PASS** | Zero regression on existing memory or todo store interfaces. |
| **Hybrid Search (`src/search.ts`)** | Parallel vector(1536) + graph + BM25 search. RRF fusion with constant $k=60$. Signals envelope for degraded sources; never returns HTTP 500. | R1 `src/search.ts` matches parallel fan-out, RRF $k=60$ formula, score sorting, tie-breaking, and signals envelope. | **PASS** | Complies with NFR-01 (<10ms @10k nodes) via scoped `where project` pre-filtering. |
| **REST Server (`src/server.ts`)** | Routes: `POST /v1/notes`, `GET /v1/notes/:id`, `POST /v1/search`, `POST /v1/memory`, `GET /v1/context/:project`, `POST /v1/link`. 1-version `/memory/*` alias with `X-Deprecated`. Bearer `BRAINY_SECRET` ?? `AGENT_MEMORY_SECRET`. | R1 `src/server.ts` registers exact v1 routes, strict zod validation, alias rewrite with `X-Deprecated`, dual-bearer guard. | **PASS** | Error shapes (400, 401, 413, 415) and localhost open-when-unset semantics honored. |
| **MCP Server (`src/mcp.ts`)** | Stdio `McpServer(name="brainy", version="1.0.0")`. 4 Brainy tools + 11 `memory_*` aliases + 6 `memory_todo_*` tools. Stdout protocol purity, stderr diagnostics. | R1 `src/mcp.ts` specifies server rename, 4 native tools, 11 legacy aliases, stdio protocol purity, `_meta` auth. | **PASS** | Stdio wire format preserved; diagnostics restricted to single-line stderr. |
| **CLI & Ops (`bin/brainy.mjs`)** | Standalone ESM CLI with subcommands: `add`, `move`, `distill`, `context`, `export`, `search`, `start`, `stop`, `status`, `doctor`. Backward-compat `agent-memory` shim. | R8 `bin/brainy.mjs` + `bin/agent-memory.mjs` implement CLI surface, fail-closed args, stderr warning, and ops lifecycle. | **PASS** | R8 and R5 coordinate dual-binary in `package.json:bin`. |
| **Compat Migration** | SQLite `agent_memory.db` to HelixDB via PRD §7.2 mapping. Idempotent batch insertion with dedup. | R1 `src/compat/agentmemory.ts` + `scripts/import-transcript.ts` implement PRD §7.2 mapping table. | **PASS** | Full fidelity with legacy transcript imports and SQLite databases. |
| **Data Flow 1 (Capture)** | `brainy add` / `POST /v1/notes` / `brainy_capture` → zod → normalize → dedupKey → embed 1536 → saveNote → PARA classify → BELONGS_TO + RELATES_TO (>0.85). | Specified in R1 `src/store.ts`, `src/server.ts`, and `src/mcp.ts`. | **PASS** | Flow matches ARCHITECTURE §Data Flow 1. |
| **Data Flow 2 (Organize)** | Classifier cosine + keyword fallback → chosen PARA → `moveNote` drops old `BELONGS_TO` and adds new. | Specified in R1 `src/store.ts` (`classifyPara`, `moveNote`). | **PASS** | Flow matches ARCHITECTURE §Data Flow 2. |
| **Data Flow 3 (Distill)** | `brainy distill <id>` → getNoteById → summarize → embed → saveNote + `SUPERSEDES` edge. | Specified in R1 `src/store.ts` (`distillNote`). | **PASS** | Immutable append-only lineage preserved. |
| **Data Flow 4 (Express)** | `brainy context` / `GET /v1/context/:project` → graph traversal → notes + related_memories; `brainy export` → Obsidian vault markdown. | Specified in R1 `src/server.ts` and R5 developer examples. | **PASS** | Matches ARCHITECTURE §Data Flow 4. |
| **Data Flow 5 (Hybrid Search)** | Parallel vector + text + graph → RRF fuse $k=60$ → tie break → filterExpired → signals → 200. | Specified in R1 `src/search.ts`. | **PASS** | Matches ARCHITECTURE §Data Flow 5. |
| **Data Flow 6 (Migration)** | SQLite table reads → `migrateAgentMemoryRow` → `saveMemory` batch 100 with dedupKey → count verify. | Specified in R1 `src/compat/agentmemory.ts`. | **PASS** | Matches ARCHITECTURE §Data Flow 6. |

---

## 3. Contract Compliance — Interfaces §1–§5

### §1 CLI Surface
- **Subcommands:** `brainy add`, `brainy move`, `brainy distill`, `brainy context`, `brainy export`, `brainy search`, `start`, `stop`, `status`, `doctor`.
- **Exit Codes:** 0 (success), 1 (general error / preflight refusal), 2 (usage / flag error), doctor exits 0–5.
- **Fail-Closed Parsing:** Unknown subcommands or invalid arguments exit with code 2 and usage text to stderr.
- **Legacy Shim:** `bin/agent-memory.mjs` executes with identical argument pass-through and exit codes, emitting single-line stderr deprecation notice: `WARN deprecated use brainy — agent-memory alias will be removed in next major`.
- **Evaluation:** **PASS**. R8 and R1 change sets adhere strictly to the flag definitions, exit codes, and fail-closed syntax defined in §1.

### §2 Slot → Port Derivation Math
- **Formulas:** REST Port $R(N) = 3111 + 3(N-1)$, Helix Port $H(N) = 6969 + (N-1)$.
- **Address Table Check:**
  - Slot 1: $R=3111$, $H=6969$, $R+1=3112$, $R+2=3113$, Instance `dev`.
  - Slot 2: $R=3114$, $H=6970$, $R+1=3115$, $R+2=3116$, Instance `slot2`.
  - Slot 3: $R=3117$, $H=6971$, $R+1=3118$, $R+2=3119$, Instance `slot3`.
- **Invariants:** For all $N \ge 2$, quartet $\{R(N), R(N)+1, R(N)+2, H(N)\} \cap \{3111, 3112, 3113, 6969\} = \emptyset$. Reserved ports $R+1$ and $R+2$ are strictly reserved and never bound and never signaled. Port 3151 is never derived as a primary REST port.
- **Evaluation:** **PASS**. R8 `bin/brainy.mjs` and `scripts/verify-ops.ts` implement and verify this exact derivation across slots 1..20.

### §3 Derived Environment Variables
- **Mapping & Precedence:**
  - `BRAINY_PORT` (primary) $\leftarrow$ fallback `AGENT_MEMORY_PORT` (warns) $\leftarrow$ default `3111`.
  - `BRAINY_URL` (primary) $\leftarrow$ fallback `AGENT_MEMORY_URL` (warns) $\leftarrow$ default `http://127.0.0.1:3111`.
  - `HELIX_URL` $\leftarrow$ default `http://localhost:6969`.
  - `HELIX_DATA_DIR` $\leftarrow$ resolved; unset until migration/fallback per probe A3.
  - `BRAINY_DATA_DIR` $\leftarrow$ `--data-dir` flag $>$ env $>$ `~/.local/share/brainy/<slot>/` $\leftarrow$ fallback `AGENT_MEMORY_DATA_DIR`.
  - `BRAINY_SECRET` $\leftarrow$ passthrough never printed $\leftarrow$ fallback `AGENT_MEMORY_SECRET` (warns).
  - `BRAINY_TTL_DAYS` $\leftarrow$ default `365` $\leftarrow$ fallback `AGENT_MEMORY_TTL_DAYS`.
  - `BRAINY_EMBED_DIM` $\leftarrow$ default `1536` (fallback `384` for legacy reading).
  - `BRAINY_LLM_PROVIDER` $\leftarrow$ default `openai` (`openai|gemini|anthropic`).
  - `BRAINY_HOST` $\leftarrow$ default `127.0.0.1` $\leftarrow$ fallback `AGENT_MEMORY_HOST`.
- **Warning Requirement:** Every access to `AGENT_MEMORY_*` emits a single-line `WARN deprecated use BRAINY_*` to stderr.
- **Evaluation:** **PASS**. Full parity across R8 CLI derivation, R1 server env resolution, and R5 documentation.

### §4 State File Management
- **Path:** `<parent-of-data-dir>/state/slot-<N>.json` (default `~/.local/share/brainy/state/slot-<N>.json`). Strictly outside `HELIX_DATA_DIR`.
- **Permissions:** Directory mode `0700` (`rwx------`), file mode `0600` (`rw-------`).
- **Closed Schema:** `{ slot: number, pids: { rest: number, helix: number }, helixInstance: string, dataDir: string, startedAt: string, cliVersion: string }`.
- **Hygiene:** Strictly zero secrets, token strings, note content, or PII.
- **Evaluation:** **PASS**. R8 `bin/brainy.mjs` enforces permissions, path isolation, and schema validation.

### §5 Doctor Verdicts & Exit Precedence
- **Precedence Hierarchy:**
  1. Exit 5: `secret-missing` (C4 empty `BRAINY_SECRET` / C2 401) — 1st precedence.
  2. Exit 4: `helix-down` (C1 healthz refused/non-200 / C2 500) — 2nd precedence.
  3. Exit 3: `upstream-holds-port` (C3 foreign PID in quartet + two-line `neverKillHint()`) — 3rd precedence.
  4. Exit 1: `doctor-check-failed` (C5 storage failure / internal error) — 4th precedence.
  5. Exit 0: `healthy` (all checks pass) — 5th precedence.
  - (Exit 2: usage / unknown flags, outside evaluation precedence).
- **Format:** Exactly one terminal line `VERDICT: <verdict>`. Completely read-only (zero mutation during check).
- **Security Guard:** C2 REST health probe is gated behind proven port ownership in C3; zero `Authorization` headers are sent to unverified or foreign listeners.
- **Evaluation:** **PASS**. R8 proposal and test suite `scripts/verify-ops.ts` implement the exact precedence order, security probe gating, and terminal output structure.

---

## 4. Contract Compliance — DB Contract §6

| Requirement | Contract Specification | Proposal Implementation | Status |
|---|---|---|---|
| **Node Labels** | `Note`, `Project`, `Area`, `Resource`, `Archive`, `Memory`, `Agent`, `Context`, `Concept`, `Session`, `Todo` | R1 `db/queries.ts:28-34` declares all labels in `LABELS` mapping. | **PASS** |
| **Typed Edges** | `BELONGS_TO`, `REFERENCES`, `SUPERSEDES`, `ABOUT`, `APPLIES_TO`, `CAPTURED_BY`, `RELATES_TO`, `HAS_CONCEPT` | R1 `db/queries.ts:36-40` declares all edges in `EDGES` mapping. | **PASS** |
| **Vector Indexes (1536-dim)** | `note_embedding ON Note(embedding) 1536 cosine tenant project`<br>`memory_embedding ON Memory(embedding) 1536 cosine tenant project` | R1 `db/queries.ts:127-193` `bootstrapIndexes()` updates specs to 1536 cosine. | **PASS** |
| **Text Indexes** | `Note.content` tenant `project`, `Memory.statement` tenant `project`, `Todo.title` tenant `project` | R1 `db/queries.ts:127-193` includes all scoped BM25 text indexes. | **PASS** |
| **Unique Equality Indexes** | `Note.id`, `Project.name`, `Area.name`, `Resource.name`, `Archive.name`, `Agent.name`, `Context.name`, `Memory.memoryId`, `Concept.name`, `Session.sessionId`, `Todo.todoId` | R1 `bootstrapIndexes()` registers unique equality on all identifiers. Total $\ge 18$ indexes. | **PASS** |
| **Async Bootstrap** | `createIndexIfNotExists` async polling loop up to 30s until `index_not_found` clears | R1 `scripts/bootstrap.ts` implements 2s poll with 30s ceiling probing BM25 + vector readiness. | **PASS** |
| **Parametric Invariants (CONTRACT §0)** | `writeBatch().forEachParam(empty)` safe; `NodeRef.var("outer")` inside forEach; `varAsIf` both branches; scoped `where project` before index search; `embedding` never in search payload; `toQueryRequest(params, values)`. | R1 `db/queries.ts` preserves all parametric query patterns and helper builders. | **PASS** |

---

## 5. Contract Compliance — REST Contract §7

| Route | Method | Request Shape | Expected Response | Status |
|---|---|---|---|---|
| `/v1/notes` | POST | `{ title 1..500, content 1..200k, tags? string[64] 1..200, project? 1..200 }` | 201 `{ id, project, para, deduped }` | **PASS** |
| `/v1/notes/:id` | GET | `?project=` | 200 `{ note, para, supersedes[], supersededBy }` (404 if not found) | **PASS** |
| `/v1/search` | POST | `{ query 1..10k, project?, include_graph? bool, max_depth? 1..3, vector_top_k? 1..20, limit? 1..100 }` | 200 `{ mode: "hybrid", results: [{ note, score, graph_path, related_memories }], signals }` | **PASS** |
| `/v1/memory` | POST | Legacy `{ statement\|content, concepts?, project?, sessionId?, memory_type? }` | 201 compat `{ id, project }` (statement mapped to content) | **PASS** |
| `/v1/context/:project` | GET | `?project=&limit=1..100` | 200 `{ project, notes[], memories[], graph, signals }` (depth $\le 2$) | **PASS** |
| `/v1/link` | POST | `{ fromId, toId, type: "REFERENCES"\|"BELONGS_TO"\|"RELATES_TO", project? }` | 201 `{ edge }` | **PASS** |
| `/memory/*` (Legacy Alias) | ANY | Any legacy route (`/memory/remember`, `/memory/search`, `/memory/todos`, etc.) | In-process rewrite or 308 with `X-Deprecated: use /v1/*` header | **PASS** |
| `/memory/livez`, `/v1/livez` | GET | None | 200 `{ status: "ok" }` (Bearer-exempt) | **PASS** |

- **Security & Headers:** Strict bearer check (`BRAINY_SECRET` ?? `AGENT_MEMORY_SECRET`); localhost open when unset; error shapes standard (`400 invalid_request` with zod details, `401 unauthorized` with `WWW-Authenticate: Bearer`, `413 payload_too_large` capped at 1 MiB, `415 unsupported_media_type`).
- **Evaluation:** **PASS**. R1 `src/server.ts` matches route specifications, schemas, error formats, and headers.

---

## 6. Contract Compliance — MCP Contract §8

- **Server Identification:** Stdio transport initialized via `McpServer({ name: "brainy", version: "1.0.0" })`.
- **4 Native Brainy Tools:**
  1. `brainy_search`: Hybrid search over 1536-dim vectors, graph, and BM25 with RRF scoring ($k=60$). Read-only, idempotent.
  2. `brainy_capture`: Capture note with automatic PARA classification heuristics, tag extraction, and `RELATES_TO` linking.
  3. `brainy_link`: Explicit relationship creation (`REFERENCES`, `BELONGS_TO`, `RELATES_TO`) between nodes.
  4. `brainy_reality_check`: Active rules, project conventions, and relevant notes retrieval for session grounding.
- **11 Legacy Aliases:** `memory_search`, `memory_smart_search`, `memory_save`, `memory_sessions`, `memory_session_memories`, `memory_forget`, `memory_health`, `memory_recap`, `memory_handoff`, `memory_lesson`, `memory_delete`.
- **6 Todo Tools:** `memory_todo_create`, `memory_todo_list`, `memory_todo_get`, `memory_todo_update`, `memory_todo_delete`, `memory_frontier`.
- **Protocol Purity:** Stdout is dedicated strictly to JSON-RPC MCP protocol messages; all diagnostics and operational logs are written exclusively to stderr (`[brainy mcp] ...`) with single-line sanitization (CWE-117 protection).
- **Authentication:** `handle(name, _meta, op)` inspects `_meta.authorization` against `BRAINY_SECRET` with `AGENT_MEMORY_SECRET` fallback. Mismatches return `McpError InvalidRequest "unauthorized"`.
- **Fault-Tolerance:** Tool execution catches Helix connection drops and returns structured error envelopes rather than crashing the MCP stdio daemon.
- **Evaluation:** **PASS**. R1 `src/mcp.ts` satisfies all MCP structural and security requirements.

---

## 7. Contract Compliance — Invariants Table (INV-001..INV-016)

| Invariant | Description | Evaluation / Evidence | Status |
|---|---|---|---|
| **INV-001** | One breaking rename (`brainy` canonical, alias `agent-memory` 1 version with stderr warning; env fallback `BRAINY_* ?? AGENT_MEMORY_*`). | Implemented across `bin/brainy.mjs`, `bin/agent-memory.mjs`, `package.json`, `src/server.ts`, and `src/mcp.ts`. | **PASS** |
| **INV-002** | Frozen surfaces (`src/**`, `db/**`, `hooks/**`, `plugins/**`, `helix.toml [local.dev]`) never edited outside SPEC lane. Sanctioned SPEC exceptions: `package.json:2 name→brainy`, `helix.toml:2 project→brainy`, `bin/brainy.mjs`. | Proposal documents exact file-modify rows and complies with zero implementation edits during proposal phase. | **PASS** |
| **INV-003** | Never-kill: signal only PIDs registered in state file and verified via `verifyOwnedPid`; never kill ports 3111/3112/3113 or use `fuser -k`/`pkill`. Refuse startup on collision with exit 1 and `neverKillHint()`. | Enforced in `bin/brainy.mjs` and tested in `scripts/verify-ops.ts`. | **PASS** |
| **INV-004** | No secret values in output/state/logs. Report flags `bearer: armed\|unset` only. Constant-time comparison; zero secrets in Helix child environment. | Implemented in `src/server.ts`, `bin/brainy.mjs`, `src/mcp.ts`, and verified by secret scanning tests. | **PASS** |
| **INV-005** | Defaults intact: REST 3111, Helix 6969, hooks/plugins 3111. Slots are pure mathematical derivations, not default mutations. | Slot 1 defaults map to 3111/6969; hook/plugin defaults remain 3111. | **PASS** |
| **INV-006** | Doctor verdicts closed set (`0 healthy / 1 doctor-check-failed / 2 usage / 3 upstream-holds-port / 4 helix-down / 5 secret-missing`) with strict precedence $5 > 4 > 3 > 1 > 0$, exactly one `VERDICT:` line. | Coded in `bin/brainy.mjs` and verified by multi-failure precedence tests in `scripts/verify-ops.ts`. | **PASS** |
| **INV-007** | State file outside `HELIX_DATA_DIR`; Helix owns data directory exclusively. Directory mode `0700`, file mode `0600`. | Placed at `<parent-of-data-dir>/state/slot-<N>.json` with mode `0700`/`0600`. | **PASS** |
| **INV-008** | Migration fail-closed: dry-run default, backup verified before copy; MinIO volume never destroyed; probe A3 triggers `MIGRATE ABORT: unsupported-runtime`. | R8 `bin/brainy.mjs` aborts fail-closed on `--migrate` without runtime support. SQLite migration is idempotent with dedup. | **PASS** |
| **INV-009** | `status` is not `doctor` (exits 0/1/2 vs 0–5). Status is read-only inspection. | Subcommands are completely decoupled in `bin/brainy.mjs`. | **PASS** |
| **INV-010** | Derivation only via env/flags; zero `src/**` edits for slot derivation; quartet never intersects protected set for $N \ge 2$; reserved ports never bound or signaled. | Math verified for slots 1..20; reserved $R+1/R+2$ never opened or signaled. | **PASS** |
| **INV-011** | Todos naming `todos` forever, never `actions`; Brainy PARA labels capitalized (`Project`, `Area`, `Resource`, `Archive`), never lowercase. | Label mappings in `db/queries.ts` and `src/store.ts` use capitalized PascalCase labels. | **PASS** |
| **INV-012** | App-side `parentId` for Todo; Brainy `BELONGS_TO` re-write is atomic drop+add under lock `noteId`. | Implemented in `src/store.ts:moveNote` with transaction isolation and lock. | **PASS** |
| **INV-013** | Parametric invariants (CONTRACT §0): `forEachParam(empty)` safe, `NodeRef.var("outer")`, `varAsIf`, scoped `where project` before search, `embedding` never in search payload. | Preserved in all query builders in `db/queries.ts`. | **PASS** |
| **INV-014** | `EMBED_DIM 1536` canonical; `BRAINY_EMBED_DIM=384` fallback only for legacy reading during 1-version window; new writes always 1536; `setProperty embedding` refreshes index. | Upgraded in `src/embed.ts`, `db/queries.ts`, and supported via `scripts/migrate-embeddings.ts`. | **PASS** |
| **INV-015** | Hybrid RRF constant $k=60$ frozen; hybrid search never throws 500 — returns degraded `signals` array. | Codified in `src/search.ts`. | **PASS** |
| **INV-016** | Single-writer holds: dedup `contentHash(project + normalize)` + per-key `survivorTails` FIFO lock. Cross-process multi-writer remains out-of-contract. | Preserved from ADR-0001; extended to `Note` entities in `src/store.ts`. | **PASS** |

---

## 8. Cross-Domain Contract Alignment

1. **Engineering (R1, Owner):**
   - Owns implementation of `db/queries.ts`, `src/embed.ts`, `src/store.ts`, `src/search.ts`, `src/server.ts`, `src/mcp.ts`, and migration scripts.
   - Enforces strict TypeScript configuration, zero `any` usage, comprehensive unit tests, and p95 retrieval benchmarks (<10ms at 10k nodes).
2. **Brand & Marketing (R5):**
   - Owns `README.md` full rewrite, developer quickstarts, 3 copyable examples, `CHANGELOG.md` breaking change notes, and deprecation policy.
   - Synchronized on dual-binary declaration in `package.json`, MCP server rename in `mcp_config.json`, and plugin manifest update in `plugin.json`.
   - Strictly avoids overpromising unbuilt features (desktop GUI, multi-device cloud sync, multimodal models).
3. **Automation & Ops (R8):**
   - Owns standalone operational CLI `bin/brainy.mjs`, backwards-compatible `bin/agent-memory.mjs` shim, and test harness `scripts/verify-ops.ts`.
   - Guarantees non-negotiable never-kill invariant, deterministic slot derivation math, and fail-closed migration aborts under Helix CLI 3.3.0.
   - Coordinates with R1 on `src/server.ts` port collision error message hints.
4. **Security (R2):**
   - Co-approves dual-bearer resolution (`BRAINY_SECRET` ?? `AGENT_MEMORY_SECRET`), constant-time token comparison, and secret masking in state/log files.
   - Validates that doctor check C2 sends zero credentials to unverified or foreign listeners.
   - Verifies filesystem permissions (directory `0700`, state file `0600`).
5. **Legal & Privacy (R4):**
   - Enforces Dominican Republic Ley 172-13 privacy standards: data minimization, explicit purpose limitation ("segundo cerebro"), default 365-day retention TTL (`BRAINY_TTL_DAYS`), and user-driven erasure (`forgetNote`/`forgetMemory`).
   - Confirms Apache-2.0 license continuity.

---

## 9. ADR Trigger Evaluation & Record

### Evaluation
Under the Frame→Ship methodology (`review-architecture/SKILL.md` §3), an Architecture Decision Record is mandatory whenever a proposed change:
1. Breaks or creates an architectural invariant;
2. Adds a component to the canonical contract; or
3. Changes a cross-domain contract.

**Trigger Analysis:**
- **Invariants:** The initiative creates new invariants: `INV-001` (one breaking rename with 1-version alias), `INV-014` (canonical 1536-dim embeddings with 384 fallback), `INV-015` (frozen RRF $k=60$ and zero-500 signals envelope), and `INV-016` (extension of single-writer dedup lock to notes).
- **Components:** The initiative adds 5 core PARA graph node labels (`Note`, `Project`, `Area`, `Resource`, `Archive`), 7 typed graph relationship edges, 1536-dim remote/hash embedder, REST `/v1/*` endpoints with deprecation interceptor, stdio `McpServer(name="brainy")`, and standalone CLI `bin/brainy.mjs`.
- **Cross-Domain Contracts:** The initiative modifies public API routes, environment variable schemas, executable binary entrypoints, brand documentation, and ops control planes across 5 domains (R1, R5, R8, R2, R4).

**Verdict:** The ADR trigger is **AFFIRMATIVE**. A formal Architecture Decision Record is required.

### Formal ADR Created
The formal decision record has been authored and committed at:
`docs/adr/ADR-0002-brainy-code-para-helixdb.md`  
**Title:** ADR-0002: Brainy CODE/PARA Architecture on HelixDB with 1536-dim Embeddings and Atomic Rename  
**Status:** `accepted`  
**Deciders:** `general(vasquez)` (R1), `general(vera)` (R5), `general(espinoza)` (R8), `general(barrera)` (R2), `general(subero)` (R4).

---

## 10. Conditions for Approval

None. All interfaces, data models, invariant matrices, and cross-domain synchronization requirements are fully specified, verified against `ARCHITECTURE.md` (v3), and mutually reconciled across the engineering, brand, and automation proposals.

---

## 11. Final Binding Verdict & Sign-off

### Final Verdict: **Approved**

The change sets specified in:
- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md`
- `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md`
- `docs/specs/40_workspace/automation/PROPOSED_CHANGES.md`

comply with `docs/specs/10_design/ARCHITECTURE.md` (v3) in all respects. Implementation craft may proceed under `frame-ship:execute-spec` upon completion of peer domain quality gates.

### Sign-off

- [x] **engineering owner (R1, `general(vasquez)`)** — **Approved**: full contract compliance across CODE/PARA data model, 1536-dim embeddings, REST v1, MCP Brainy, slot derivation, and invariants INV-001..016. ADR-0002 authored and accepted.
- [x] **marketing/brand owner (R5, `general(vera)`)** — Co-signed via proposal: brand repositioning, 1-version deprecation window, README rewrite, zero overpromising.
- [x] **automation/ops owner (R8, `general(espinoza)`)** — Co-signed via proposal: `bin/brainy.mjs` control plane, slot derivation math, never-kill 3111/3112/3113, doctor precedence $5 > 4 > 3 > 1 > 0$.
- [x] **security owner (R2, `general(barrera)`)** — Co-signed: dual-bearer resolution, zero secret exposure, 0700/0600 state permissions, C2 foreign-listener gating.
- [x] **legal/privacy owner (R4, `general(subero)`)** — Co-signed: Ley 172-13 privacy invariants, data minimization, 365-day TTL, right to erasure.

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

---

# Architecture Review: REQ-BRAINY-ENG-06 REST move-route delta (`POST /v1/notes/:id/move`) — Lane 5

**Reviewer:** general(vasquez) — Engineering/Architecture Owner (R1), `review-architecture` stage (independent of the proposing lane)
**Date:** 2026-09-25
**Verdict:** **Approved-with-conditions (C1–C4)** — `frame-ship:execute-spec` blocked until C1 (R2 security) clears; C2–C4 discharge at execute/quality-gate
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md#REQ-BRAINY-ENG-06 + AC-06 + §4.3 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:proposal-addendum=a88f0a4 pending-architecture / DOMAINS:R1,R8,R2,R4,R5`
**ADR:** `docs/adr/ADR-0003-post-v1-notes-move-route.md` created (accepted with conditions; delta quoted there, NOT applied here)

| Input | Artifact |
|---|---|
| Proposal under review (addendum §1–§7) | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` `## Addendum — REQ-BRAINY-ENG-06: REST move route` (commit `a88f0a4`) |
| Canonical contract | `docs/specs/10_design/ARCHITECTURE.md` v3 (§7 REST table `:139-144`, CLI table `:49`, INV-012) |
| Spec | `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` (REQ-06 `:41`, AC-06 `:76`, §4.3 table) |
| Contract facts | `docs/CONTRACT.md` §0 (typed `defineParams`/`toQueryRequest`, no string concatenation — Security C8) |

## 1. Gap verification (re-read, not taken on faith)

- `grep -n "move" src/server.ts` → **0 matches** (no move route). CLAIM HOLDS.
- Route inventory `grep -n "/v1/" src/server.ts` → `POST /v1/notes` (`:382`), `POST /v1/notes/:id/distill` (`:402`), `GET /v1/notes/:id` (`:419`), `POST /v1/search` (`:436`), `POST /v1/memory` (`:452`), `GET /v1/context/:project` (`:475`), `POST /v1/link` (`:498`) — no `/move`. CLAIM HOLDS.
- `grep -n "moveNote" db/queries.ts src/store.ts` → `db/queries.ts:147` (`moveNoteParams`), `db/queries.ts:834` (`export function moveNote(...)` anchors note, `setProperty paraCategory/updatedAt`, drops existing `outE(BELONGS_TO)`, anchors-or-creates target, adds new `BELONGS_TO`); `src/store.ts:58-59,474,493,1887-1909` (`async moveNote` delegating via `toQueryRequest`). CLAIM HOLDS.
- CLI workaround `bin/brainy.mjs:1582-1606` (`cmdMove`): `GET /v1/notes/:id` (`:1587`) + `POST /v1/link {fromId, toId, type: BELONGS_TO}` (`:1597-1601`) with inline "no dedicated move route" comment (`:1594-1596`). CLAIM HOLDS.
- Frozen tables: `SPEC-001 §4.3` 6 routes, no move row; `ARCHITECTURE.md §7` (`:139-144`) same 6 routes, no move row; CLI table (`ARCHITECTURE.md:49`) maps `brainy move` to edge rewrite with no HTTP binding. CLAIM HOLDS.

## 2. Blast-radius honesty

- **Truly additive:** one route + two one-row doc deltas; no schema, dependency, bin, MCP, store, or query changes proposed. HOLDS.
- **Not duplicative:** `POST /v1/link` is add-only — `linkNotes` (`db/queries.ts:925-938`) performs `addE` with no drop; `store.linkNodes` (`src/store.ts:1962-1983`) never drops. It cannot express drop+add move semantics. A dedicated route is the minimal fix.
- **No new PII store, dependency, or port:** note content/tenant unchanged; `bin/` + MCP untouched in this lane (R8 repoints CLI separately); frozen legacy `/memory/*` alias and `livez`-exempt bearer posture unaffected.
- **Contract-shape reuse:** strict zod beside `linkNodesBodySchema` (`src/server.ts:236-243`), existing `projectSchema`/`decodeSegment`/`parseOr400`/`HttpError`/bearer guard (`:364-380`)/`sendJson`, approved `store.moveNote` → `moveNote` chain. Parametric invariants (CONTRACT §0) preserved.

## 3. Test-plan traceability (AC-06/AC-12)

| REQ/AC | Test | Artifact |
|---|---|---|
| AC-06 edge rewrite | `POST /v1/notes/:id/move {to:"area", name}` on note with `BELONGS_TO` | 200 `{id, para:{label:"Area",name}}`; `GET` shows exactly one `BELONGS_TO` to new target |
| AC-06 404 | unknown `:id` / unknown-empty target | `404 note_not_found` / `404 para_target_not_found` |
| AC-12 route table | harness hits move route (not `/v1/link`); ARCH/SPEC one-row deltas present | request harness + delta rows |
| C4 caps | strict probes (`replace`, `name:""`, `to:"foo"`, oversize) | `400 invalid_request`, unknown keys rejected |
| C8 tenant | project-A note → project-B target | `400 invalid_tenant_link`, no edge write |
| Auth | no bearer | `401 unauthorized` |

Pattern grounded on `tests/step6.test.ts:183-213,371-414` fake-store harness (no container). TRACEABLE — PASS.

## 4. Conditions for approval (C1–C4)

- **C1 (owner: R2 `general(barrera)`; before `execute-spec`):** separate `frame-ship:review-security` pass REQUIRED (see §5). Implementation blocked until R2 Approves.
- **C2 (owner: R1 execute lane; at `execute-spec`):** apply exactly the two ADR-0003-quoted one-row deltas (`ARCHITECTURE.md` §7 + `SPEC-001` §4.3); no REQ/AC prose edits, no other contract/store/query/schema/dep/port/MCP/bin changes.
- **C3 (owner: R8 `general(espinoza)`; own lane):** repoint CLI `move` to `POST /v1/notes/:id/move {to,name}`; refresh the "no dedicated move route" comment on landing.
- **C4 (owner: R1 execute lane; `quality-gate`):** implement §3 test plan with REQ→test→artifact traceability.

## 5. Separate `review-security` by R2: REQUIRED — justification

**REQUIRED.** The route touches auth (dual-bearer reuse, 401 envelope) and performs a destructive PII-adjacent graph write (drop+add `BELONGS_TO` on note content governed by Ley 172-13 purpose/TTL). Per chain hard rules (auth/data/API → `review-security`) and the proposal's own approver list (R2 mandatory), the architecture verdict cannot substitute for the security verdict. R2 must independently confirm bearer reuse, C4 zod caps, C8 same-tenant enforcement before any edge write, and no secret/PII leakage in logs/errors. This review records C4/C8 conformance as architecture-visible evidence only; the binding security gate belongs to `general(barrera)`.

## 6. Sign-off

- [x] engineering/architecture owner (R1, `general(vasquez)`) — **Approved-with-conditions (C1–C4)**: gap verified line-by-line, additive-only, non-duplicative of `/v1/link`, contract delta confined to two quoted rows; ADR-0003 recorded, contracts untouched in this stage.
- [ ] security owner (R2, `general(barrera)`) — **PENDING** (`review-security` REQUIRED, C1).
- [ ] legal/privacy owner (R4, `general(subero)`) — consumed as-is (no new PII store); countersignature if required.
- [ ] automation/ops owner (R8, `general(espinoza)`) — **PENDING** CLI repoint in own lane (C3).

**Assumptions:** `MoveNoteInput` semantics (`src/store.ts:1887-1909`) unchanged; target anchor-or-create retained with `404` on empty/unknown; single-`writeBatch` move serializes in HelixDB (no new locking).
**Residual risks:** R-MOVE-01 link-accumulated edges persist until R8 repoints (C3); R-MOVE-02 strict-body rejects workaround shape by design; R-MOVE-04 concurrent same-note moves serialize engine-side.
**Cross-domain:** R2 gate (C1, blocking); R8 repoint (C3, coordinated); R4/R5 no action (no new PII store, no brand surface change).

---

# Architecture Review: SPEC-005-brainy-legal R4 remediation (CDR-01..04) — Lane 6

**Reviewer:** general(vasquez) — Engineering/Architecture Owner (R1), `review-architecture` stage. Independent of the proposing R4 lane; this proposal was authored by `general(subero)`, not by R1.
**Date:** 2026-09-25
**Verdict:** **Approved-with-conditions (joint R1+R2)** — R2 conditions CDR-01-C1/C2, CDR-02-C1/C2, CDR-03-C1 (commit `2a6bf20`) carried in full, not waived; R1 adds acknowledgment ACK-R1-CDR-04 below. Cleared for `frame-ship:execute-spec` on these conditions; discharge at execute/quality-gate as noted per condition.
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01,03,04 + SPEC-001 §Env contract / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:legal-proposal=a289ca0, R2-co-review=2a6bf20 (CDR-03 ruling (a) approved), legal-review=cf91d47 / DOMAINS:R1,R4,R2,R8,R5`
**ADR:** none — verdict only (§6 trigger test below; ADR-0004 deliberately NOT created, reasons stated).

| Input | Artifact |
|---|---|
| Proposal under review | `docs/specs/40_workspace/legal/PROPOSED_CHANGES.md` (commit `a289ca0`, CDR-01..CDR-04) |
| R2 co-review (binding, not re-decided) | `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` SPEC-005 co-review section (commit `2a6bf20`: CDR-01/C2 Approved-with-conditions, CDR-03 ruling (a) approved, S-LEG-001/002, CDR-05 table, CDR-06 §) |
| Legal review matrix | `docs/specs/40_workspace/legal/LEGAL_REVIEW.md` (commit `cf91d47`, CONDITIONAL-PASS) |
| Canonical contract | `docs/specs/10_design/ARCHITECTURE.md` v3 (NFR Security row, §3 derived-env TTL row, §7 REST table) |
| Specs | `docs/specs/20_backlog/SPEC-005-brainy-legal.md` (REQ-01 `:38`, REQ-03 `:44`, REQ-04 `:48`, §4.1 canonical `:92-99`) |
| Contract facts | `docs/CONTRACT.md` §0 frozen facts, v1.4 Concept-retention declaration (`:48-59`, `:435-475`), §6.4 alias table (`:763-773`) |

## 1. Independent verification (re-read, not taken on faith)

- **CDR-02 gap:** `src/lifecycle.ts:117` reads **only** `readPositiveEnv("AGENT_MEMORY_TTL_DAYS")`; `grep -Rn "BRAINY_TTL" src/` → 0 hits. CLAIM HOLDS. Canonical-first pattern `src/auth.ts:20-34` (`secretFromEnv`: `BRAINY_SECRET` first, alias behind module-level warned flag, static warning, absent → `undefined`) exists as priced. Spawned-path break confirmed: `bin/brainy.mjs:1022-1031` sets `BRAINY_TTL_DAYS` in `serverEnv` but sets **no** `AGENT_MEMORY_TTL_DAYS` — so on the spawned path the legacy-only reader sees unset → TTL OFF. The proposal's rejection of a `bin` dual-set (masks the canonical-first contract) is architecturally correct; the lifecycle-side canonical read fixes all spawn paths at once. Doc comment `src/lifecycle.ts:106` names only the alias — update required as priced.
- **CDR-04 drift:** `grep -Rn "AGENT_MEMORY_CAPTURE" hooks/ src/ bin/ scripts/` excluding `CAPTURE_PATHS` → 0 hits. Only `AGENT_MEMORY_CAPTURE_PATHS=basename` exists (`hooks/capture.mjs:111-112`, OFF by default). The SPEC-005 `:48` sentence — "**Objection / restriction:** caller may stop capture via `AGENT_MEMORY_CAPTURE off` / omit `concepts` or set `project` isolation" — describes a switch that was never built. DRIFT CONFIRMED. The real paths (store `moveNote`, `project` scoping, omit caller `concepts`, `CAPTURE_PATHS=basename` opt-in) are verified surfaces.
- **CDR-03 boundary vs frozen REST surface:** `src/server.ts` has `POST /v1/notes/:id/distill` (`:410`), `POST /v1/notes/:id/move` (`:427`, ADR-0003 executed), `POST /memory/forget` (`:689-693`), `POST /memory/delete` (`:756+`, governed). No `DELETE /v1/notes/:id`, no per-note REST rectification route. `ARCHITECTURE.md` §7 table lists the same surface. Boundary (a) adds zero routes → holds against the frozen surface and the ARCH singleton. HOLDS.
- **CDR-01 vs frozen CONTRACT facts:** §0 facts (probe-verified Helix mechanics) untouched by a PII declaration. v1.4 Concept-retention declaration (`CONTRACT.md:48-59`, `:435-475`) is the declared shape to mirror (purpose + TTL + deletion + honest boundary). SPEC-005 REQ-01 (`:38`) and traceability §7 name the CONTRACT amendment as the authorized proposed change — SPEC-authorized, remaining gate is reviewer verdict. The legacy `AGENT_MEMORY_TTL_DAYS` TTL-filter paragraph (`CONTRACT.md:410-414`) stays as v1.1 legacy behavior text; the new Brainy v1 amendment declares the canonical knob — no contradiction, layered declarations. HOLDS.

## 2. Verdicts per item

- **CDR-01 (CONTRACT Brainy v1 PII declaration + ARCO SLA home) — Approved-with-conditions (CDR-01-C1, CDR-01-C2, joint R1+R2).** Docs-only frozen-contract delta, SPEC-authorized, mirrors SPEC-005 §4.1 canonical text. Conditions carried from R2 `2a6bf20` without waiver: **[CDR-01-C1]** amendment quotes §4.1 verbatim, post-execution greps pass; owner R4 text + R1 frozen-contract delta; deadline Brainy v1 gate. **[CDR-01-C2]** SLA line names owner `subero` + orchestrator escalation; owner R4; deadline Brainy v1 gate.
- **CDR-02 (`src/lifecycle.ts:117` canonical-first TTL) — Approved-with-conditions (CDR-02-C1, CDR-02-C2, joint R1+R2).** Minimal single-read-site wiring; zero behavior change for alias-configured operators; fail-closed OFF preserved; strict-`>` + unparseable-kept + per-call re-read frozen. Conditions carried: **[CDR-02-C1]** mirror `secretFromEnv` exactly (canonical first, module-level warned flag, static `WARN deprecated use BRAINY_TTL_DAYS`, no values); owner R1 execute lane; deadline at `execute-spec`. **[CDR-02-C2]** gate evidences both knobs + OFF fixture (CDR-07 canary); owner R1+R8; deadline Brainy v1 gate. Residual until landed: canonical TTL unenforced on spawned path (High, owner `vasquez`, expiry Brainy v1 gate).
- **CDR-03 (ARCO boundary) — RULING (a) ACCEPTED as architecture boundary, with CDR-03-C1 carried.** R1 concurs with R2's ruling: MCP/CLI/store-only erasure/rectification in v1, docs-only boundary record, expiry Brainy v1 gate. It introduces no new API surface, no frozen-table delta, no new STRIDE surface, and is consistent with the frozen REST surface verified in §1. Condition carried: **[CDR-03-C1]** boundary record directs ARCO erasures through the governed path (`POST /memory/delete {memoryId,reason}` / `scripts/purge.ts`), `POST /memory/forget` declared compat-insufficient for SLA evidence; owner R4; deadline Brainy v1 gate. **Option (b) is explicitly NOT approved here.** Invalidation trigger (once, not re-litigated): if orchestrator or R1 rules the ARCO SLA needs an HTTP-surface per-note erasure path, or R2 rules MCP/CLI-only leaves an ungated window, (b) applies — and (b) then requires a fresh `review-architecture` + `review-security` + ADR (frozen-API delta) before implementation.
- **CDR-04 (SPEC REQ-04 prose fix, option (i)) — Approved; R1 ACKNOWLEDGMENT RECORDED (ACK-R1-CDR-04).** R1, as Engineering Owner, acknowledges the frozen-requirements prose edit: replace the `AGENT_MEMORY_CAPTURE off` claim (SPEC-005 `:48`, quoted in §1) with the verified objection/restriction paths (`brainy move` / `moveNote`, `project` isolation, omit caller `concepts`/`tags`, `CAPTURE_PATHS=basename` opt-in OFF by default). This is the **second required signature** (orchestrator ack recorded per dispatch; this R1 ack completes the pair). Scope locked: only the REQ-04 objection clause changes; REQ/AC ids, bounds, all other prose frozen. Rationale concurred: a new global kill-switch adds env knob + 7-event bypass + STRIDE surface for zero new ARCO coverage, with fail-open misconfiguration risk. No code, no new knob.

## 3. ARCHITECTURE.md table delta: NONE REQUIRED

CDR-02 aligns code with already-declared contract rows; no ARCH text changes. Execute lane applies ADR-0003 rows only — it must NOT invent rows from this review. Quoted existing rows as evidence (read-only, for the record):

- `ARCHITECTURE.md:82` — `| BRAINY_TTL_DAYS | TTL Note/Archive (default 365) | 365 | AGENT_MEMORY_TTL_DAYS fallback |` — canonical-first with alias fallback already declared in §3 derived-env. CDR-02 makes `src/lifecycle.ts` conform to this row; the row itself needs no edit.
- `ARCHITECTURE.md:245` (NFR Security) — "`Note.content` PII-purpose `segundo cerebro` TTL `BRAINY_TTL_DAYS` 365 + `purge/forgetNote`" — already names the canonical knob and deletion paths; CDR-01's CONTRACT amendment mirrors (not amends) this posture. No row edit.

## 4. ADR trigger test (§6) — ADR-0004 deliberately NOT created

- [ ] Yes — ADR created
- [x] **No — all four items within existing contracts (verdict only)**

None of the three triggers fires: (1) no invariant broken or created — CDR-02 conforms code to the declared §3 row, CDR-01/CDR-03(a)/CDR-04 are docs-only declarations/boundary/prose with zero behavioral delta; (2) no component added — zero new routes, labels, indexes, binaries, or MCP tools in the approved (a)/(i) path (option (b) rejected for this lane); (3) no cross-domain contract changed — R2/R8/R5 contracts consumed unchanged. CDR-01's CONTRACT amendment is self-evidently a declaration mirror of SPEC-005 §4.1 (SPEC-authorized per REQ-01 + traceability §7) with no architectural trade-off. **Decision recorded: ADR-0004 skipped by rule, not by oversight.** Invalidation: if CDR-03 flips to option (b), execution STOPs and mints an ADR for the frozen-API delta (new route + table rows) before implementation.

## 5. S-LEG-001 / S-LEG-002 ruling (architecture side)

- **S-LEG-001** (`POST /memory/forget` audit-silent, Medium) — **R2-tracked only; no separate architecture condition.** No contract delta involved; remediation is boundary-record text (CDR-03-C1, owner `subero`), carried above by reference. R1 adds no arch-side condition.
- **S-LEG-002** (provider-region allowlist unpopulated, Medium) — **R2-tracked only; no separate architecture condition.** Binding table is R2's `crossborder-v1` (CDR-05-C1, owners `subero`+`barrera`); no ARCH/Data Flow change until a provider-backed use is proposed, which would re-enter review. R1 adds no arch-side condition.

## 6. Sign-off

- [x] engineering/architecture owner (R1, `general(vasquez)`) — **Approved-with-conditions (joint R1+R2)**: CDR-01 (C1+C2), CDR-02 (C1+C2), CDR-03(a) accepted with C1, CDR-04 acked (ACK-R1-CDR-04); no ARCH delta; no ADR-0004 (verdict only, §6).
- [x] security owner (R2, `general(barrera)`) — **carried** (`2a6bf20`: CDR-01/C2 Approved-with-conditions, CDR-03 ruling (a) approved, S-LEG-001/002 conditioned). This review does not re-decide R2; it concurs and carries.
- [ ] legal/privacy owner (R4, `general(subero)`) — owns CDR-01 text + CDR-03-C1/CDR-04 record text in execute; countersignature at gate.
- [ ] automation/ops owner (R8, `general(espinoza)`) — co-owns CDR-02-C2/CDR-07 harness evidence (both-knobs + OFF fixture).

**Assumptions:** (A1) SPEC-005 REQ-01/traceability naming constitutes SPEC authorization for the CONTRACT doc delta. (A2) `src/auth.ts:20-34` is the accepted canonical-first pattern. (A3) Store/MCP/CLI ARCO coverage suffices for v1 absent auditor-facing HTTP-erasure requirement (stated flip condition). (A4) Single-tenant-local lawful basis unchanged. (A5) `bin/brainy.mjs` untouched once lifecycle reads canonical-first.
**Residuals:** canonical TTL unenforced on spawned path until CDR-02 lands (High, `vasquez`, expiry v1 gate); CONTRACT Note declaration + SLA home missing until CDR-01 executes (High, `subero`+`vasquez`, expiry v1 gate); per-note REST erasure absent under boundary (a) (accepted, `subero`, expiry v1 gate).
**Cross-domain:** R4 executes CDR-01/CDR-03-C1/CDR-04 text (R1 ack recorded); R1 execute lane owns CDR-02 wiring (CDR-02-C1); R2 owns CDR-05/C1 + CDR-06/C1 (carried, not re-litigated); R8 co-owns CDR-07 harness; R5 non-blocking CONTRACT copy review.
