# ADR-0002: Brainy CODE/PARA Architecture on HelixDB with 1536-dim Embeddings and Atomic Rename

**Date:** 2026-09-25  
**Deciders:** general(vasquez) — Engineering Owner (R1), general(vera) — Marketing/Brand Owner (R5), general(espinoza) — Automation/Ops Owner (R8), general(barrera) — Security Owner (R2), general(subero) — Legal/Privacy Owner (R4)  
**Status:** accepted  

## Context

The `agent-memory` repository originated as an autonomous session memory store using flat tuples (`Memory`, `Session`, `Concept`) and lightweight 384-dimensional hash embeddings over HelixDB v0.0.6. While effective for ephemeral agent recall, real-world development workflows demand an active personal knowledge management ("Segundo Cerebro") architecture capable of capturing, organizing, distilling, and expressing knowledge across complex project lifecycles.

To achieve this, the initiative `BRIEF-brainy` (approved 2026-09-25) introduces Tiago Forte's CODE (Capture, Organize, Distill, Express) and PARA (Projects, Areas, Resources, Archives) methodology directly into the graph engine. This evolution requires:
1. Transforming the flat schema into a rich typed graph model (`Note`, `Project`, `Area`, `Resource`, `Archive`) interconnected with 7 domain edges while preserving backward compatibility for existing memory clients.
2. Upgrading semantic search embeddings from 384-dimensional hash bag-of-words to 1536-dimensional vectors (compatible with `text-embedding-3-small` and remote providers) with deterministic offline fallback and hybrid Reciprocal Rank Fusion (RRF k=60).
3. Eliminating historical brand and technical debt (`agentmemory`, `iii-engine`) by executing an atomic product rename from `agent-memory` to **Brainy** across package manifests, CLI binaries, REST APIs, and MCP protocols.
4. Protecting running agent environments (Claude Code, Cursor, OpenCode, Antigravity) from disruption by establishing a strict 1-version backward-compatibility alias window across all public surfaces before sunsetting.

Because this architectural shift creates new invariants (INV-001, INV-014, INV-015, INV-016), adds components to the canonical contract, and alters cross-domain contracts across engineering (R1), brand (R5), automation/ops (R8), security (R2), and legal/privacy (R4), a formal Architecture Decision Record is mandatory under `review-architecture` governance.

## Decision

We adopt the Brainy v1 architecture across all repository domains as specified in `docs/specs/10_design/ARCHITECTURE.md` (v3):

### 1. CODE/PARA Data Model on HelixDB
- **Node Labels:** Introduce `Note`, `Project`, `Area`, `Resource`, and `Archive` in `db/queries.ts` and `src/store.ts`. Retain compat nodes `Memory`, `Agent`, `Context`, `Session`, `Concept`, and `Todo`.
- **Graph Edges:** Implement 7 typed relationship edges:
  - `BELONGS_TO`: Links `Note` to its parent PARA category (`Project`, `Area`, `Resource`, or `Archive`).
  - `REFERENCES`: Explicit cross-note citations (`[[Note]]` wikilinks).
  - `SUPERSEDES`: Immutable distillation lineage linking progressive summary notes to prior versions.
  - `ABOUT`: Links `Memory` to `Resource` or `Project`.
  - `APPLIES_TO`: Links `Memory` to `Context`.
  - `CAPTURED_BY`: Provenance linking `Note` to the capturing `Agent`.
  - `RELATES_TO`: Automatic semantic similarity edge generated between notes when vector cosine similarity exceeds 0.85.
  - Retain legacy `HAS_CONCEPT` edge for backwards compatibility.
- **Index Inventory:** Maintain $\ge 18$ HelixDB indexes (unique equality on node keys, equality on `project` tenant, full-text on `content`, and 1536-dim vector indexes).

### 2. 1536-Dimensional Embeddings & Hybrid Search
- **Standard Dimension:** Establish `EMBED_DIM = 1536` as canonical across all new note captures and memory writes (`INV-014`).
- **Embedding Pipeline:** Implement remote embedding provider routing via HelixDB `Embed()` / OpenAI `text-embedding-3-small` with a deterministic, keyless 1536-bucket FNV-1a + golden-ratio sign bit hash fallback for offline testing and air-gapped CI.
- **Dual-Dimension Fallback:** Support `BRAINY_EMBED_DIM=384` for read-only compatibility during 1 release cycle; provide batch migration script `scripts/migrate-embeddings.ts` using `writeBatch.forEachParam` with `setProperty("embedding", vector)` to upgrade existing records without downtime.
- **Hybrid Retrieval Engine:** In `src/search.ts`, fuse 1536-dim vector ANN search, PARA graph traversal (depth $\le 2$), and BM25 full-text search using Reciprocal Rank Fusion ($score = \sum \frac{1}{60 + rank_i}$, constant $k=60$ frozen per `INV-015`).
- **Resilience:** Hybrid search never throws HTTP 500; individual source failures degrade gracefully and append diagnostic notices to the `signals` array.

### 3. Atomic Rename with 1-Version Compatibility Window
- **Identity:** Rename package to `"name": "brainy"`, engine project to `name = "brainy"` in `helix.toml`, and canonical CLI executable to `bin/brainy.mjs`.
- **CLI Dual-Entry:** Provide `bin/brainy.mjs` as canonical primary while maintaining `bin/agent-memory.mjs` as a 1-version shim that emits a single-line warning to stderr (`WARN deprecated use brainy — agent-memory alias will be removed in next major`) and delegates execution with identical exit codes.
- **Environment Resolution:** Canonical environment variables use prefix `BRAINY_*` (`BRAINY_PORT`, `BRAINY_URL`, `BRAINY_SECRET`, `BRAINY_DATA_DIR`, `BRAINY_TTL_DAYS`, `BRAINY_EMBED_DIM`, `BRAINY_LLM_PROVIDER`, `BRAINY_HOST`). Reading legacy `AGENT_MEMORY_*` variables emits a stderr warning and acts as a 1-version fallback (`INV-001`).
- **REST v1 Surface:** Canonical endpoints live under `/v1/*` (`POST /v1/notes`, `GET /v1/notes/:id`, `POST /v1/search`, `POST /v1/memory`, `GET /v1/context/:project`, `POST /v1/link`). Legacy `/memory/*` endpoints return `308 Permanent Redirect` or in-process rewrite with `X-Deprecated: use /v1/*` HTTP header.
- **MCP Server:** Stdio MCP server registers as `McpServer({ name: "brainy", version: "1.0.0" })` exposing 4 native tools (`brainy_search`, `brainy_capture`, `brainy_link`, `brainy_reality_check`) alongside 11 backward-compatible `memory_*` aliases and 6 `memory_todo_*` tools.
- **Data Migration:** Provide idempotent SQLite migration in `src/compat/agentmemory.ts` conforming to PRD §7.2 entity and link mapping.

### 4. Operational Control Plane & Security Invariants
- **Port Math & Quartet:** Preserve deterministic slot derivation $R(N) = 3111 + 3(N-1)$ and $H(N) = 6969 + (N-1)$; reserved addresses $R+1$ and $R+2$ are never bound and never signaled (`INV-010`).
- **Non-Negotiable Never-Kill Invariant:** Signal only PIDs verified via state file and `/proc/<pid>/cmdline` (`verifyOwnedPid`); never kill foreign occupants or upstream ports 3111/3112/3113 (`INV-003`). Foreign occupants trigger preflight refusal with exit 1 and the canonical two-line `neverKillHint()`.
- **Doctor Precedence:** Doctor executes 5 checks (C1 helix-healthz, C3 ports, C2 rest-health, C4 secret-presence, C5 storage-data-dir) with strict precedence $5 > 4 > 3 > 1 > 0$ and outputs exactly one terminal `VERDICT:` line (`INV-006`). C2 health check is gated behind proven port ownership to prevent credential leakage to foreign listeners.
- **State File Hygiene:** State files live at `<parent-of-data-dir>/state/slot-<N>.json` with directory permissions `0700` and file permissions `0600` strictly outside `HELIX_DATA_DIR` (`INV-007`). State files never contain secrets, memory text, or PII (`INV-004`).
- **Ley 172-13 Privacy & Secret Posture:** `BRAINY_SECRET` and `AGENT_MEMORY_SECRET` are read from environment/vault only and never logged or serialized (`INV-004`). Notes and memories adhere to explicit purpose limitation, default 365-day TTL (`BRAINY_TTL_DAYS`), and permanent deletion via `forgetNote`/`forgetMemory`.

## Consequences

### Positive
- **Unified Graph + Vector + Search Engine:** Eliminates the operational complexity, dual-write synchronization failures, and licensing costs of maintaining external vector databases (e.g. Pinecone/Qdrant) by unifying graph traversal, 1536-dim vector similarity, and BM25 text search inside HelixDB.
- **Rich Personal Knowledge Management:** Transitions the product from an ephemeral agent memory scratchpad into a true Second Brain supporting Tiago Forte's CODE/PARA methodology with automated classification, progressive summarization, and Obsidian markdown export.
- **Zero-Downtime Agent Transition:** The 1-version alias window across CLI, environment variables, REST routes, and MCP tools ensures that existing agent setups (Claude Code, Cursor, OpenCode, Antigravity) continue working without immediate breaking outages.
- **Elimination of Brand Debt:** Cleanses legacy naming confusion (`agentmemory`, `iii-engine`), unifying the ecosystem under the dignified developer brand **Brainy**.
- **Enhanced Retrieval Accuracy:** 1536-dim embeddings combined with Reciprocal Rank Fusion ($k=60$) deliver superior semantic recall while maintaining sub-10ms p95 latency for collections up to 10,000 nodes.
- **Deterministic Operations:** Retains the proven P4 ops foundation, deterministic slot derivation math, fail-closed doctor checks, and strict never-kill process safety.

### Negative / Trade-offs
- **Increased Vector Storage Footprint:** 1536-dimensional float vectors require 4x the storage of legacy 384-dimensional vectors (6,144 bytes vs 1,536 bytes per vector property), increasing disk usage and memory consumption on large collections.
- **Migration & Re-embedding Overhead:** Existing 384-dim databases require offline or batch re-embedding via `scripts/migrate-embeddings.ts` before benefiting from 1536-dim vector indexes.
- **Maintenance Cost of 1-Version Shim:** The codebase must maintain dual binary entrypoints, dual-bearer secret checks, HTTP redirection/rewrite middleware, and 11 legacy MCP tool wrappers until the scheduled sunset in v2.0.0.
- **Single-Writer Constraint Retained:** As documented in ADR-0001, dedup locking and write serialization remain bounded to a single process per HelixDB instance; multi-writer clustering remains deferred to future roadmap phases (`INV-016`).

## Supersedes / Superseded By

- **Extends ADR-0001:** Builds upon `docs/adr/ADR-0001-application-side-dedup-uniqueness.md`. Retains application-side FIFO dedup locking via `dedupKey = sha256(project + "\n" + normalize(content))` and index #8 as lookup accelerator, extending the pattern to `Note` entities and SQLite migration ingestion.
