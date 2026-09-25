# Launch Campaign Brief: Brainy v1.0.0

**Campaign Owner:** `general(vera)` — Marketing & Brand Owner (R5)  
**Date:** 2026-09-25  
**Audience:** AI Engineers, Full-Stack Developers, Agent Builders (Claude Code, Cursor, OpenCode, Antigravity)  
**Product Identity:** Brainy — Segundo cerebro aumentado con agentes  
**Release Target:** Brainy v1.0.0 (CODE/PARA sobre HelixDB unificado)  

---

## 1. Narrative & Strategic Positioning

### The Core Narrative
Developers building with modern AI agents face a frustrating barrier: **agent amnesia**. Every new task requires re-explaining architectural boundaries, package manager choices, and domain conventions. Current memory tools offer flat, unstructured string lists that lack semantic organization, while passive PKMs (Obsidian, Notion) sit isolated outside the agent's reasoning loop.

**Brainy** bridges this divide. It is the first active **second brain for AI coding agents**, implementing Tiago Forte's **CODE** (*Capture, Organize, Distill, Express*) and **PARA** (*Projects, Areas, Resources, Archives*) frameworks directly on top of **HelixDB**.

### Key Value Pillars
1. **Grounded Agent Context:** Agents don't just "remember facts"; they navigate an active relational graph of projects, technical areas, and living resources.
2. **Unified HelixDB Engine:** Graph relationships, 1536-dimensional vector ANN search, and scoped BM25 full-text queries are fused in a single query engine. Sub-10ms p95 latency at 10,000 nodes without external vector clouds or complex microservices.
3. **Progressive Distillation:** Notes aren't static. Brainy models knowledge lineage: distilled summaries supersede older notes (`SUPERSEDES` edge) while preserving complete provenance.
4. **Developer-First Ergonomics:** Zero runtime dependencies in the CLI, strict placeholder security hygiene (`BRAINY_SECRET=***`), and full compatibility with Dominican Republic Ley 172-13 privacy standards.

---

## 2. Release Announcement Copy

### Tagline
> **Brainy v1.0: Tu segundo cerebro aumentado con agentes.**  
> *Memoria relacional, CODE/PARA y búsqueda híbrida sobre HelixDB para Claude Code, Cursor y OpenCode.*

### Announcement Text (GitHub / Developer Forums / Community)

```markdown
Say goodbye to agent amnesia. 🧠⚡

We are proud to introduce **Brainy v1.0.0** — an augmented second-brain system designed specifically for AI coding agents.

Until today, giving memory to agents meant flat key-value pairs or passive Markdown files that your agent had to scan manually. Brainy changes that by bringing Tiago Forte's **CODE & PARA** methodologies into an active, autonomous relational knowledge base:

- **Organize by Intent (PARA):** Automatically classify knowledge into Projects, Areas, Resources, and Archives.
- **Unified Hybrid Search (RRF k=60):** Fuses 1536-dimensional vector cosine search, graph traversal (BELONGS_TO, REFERENCES, RELATES_TO), and scoped BM25 text search in <10ms.
- **Zero Cloud DBs Required:** Runs on a self-hosted, persistent HelixDB instance (Docker/Podman). No Pinecone, no Neo4j, no external model API bills.
- **Obsidian & Markdown Ready:** Export your agent's knowledge graph directly into a clean, human-readable Obsidian vault with `brainy export`.
- **Ecosystem Ready:** Native MCP tools (`brainy_search`, `brainy_capture`, `brainy_reality_check`), auto-capture hooks, and seamless IDE integration.

Migrating from `agent-memory`? We’ve got you covered with a complete 1-version backward compatibility window and transparent SQLite-to-HelixDB migration.

Get started in 60 seconds:
$ helix start dev --disk --persist
$ npm install && npm run bootstrap
$ brainy add "Strict TypeScript and pnpm only" --title "Core Conventions"

Check out the release notes and quickstart guide:
👉 https://github.com/deuriib/brainy
```

---

## 3. Developer Personas & Scenarios

### Persona 1: María (Staff Engineer / Monorepo Architect)
- **Scenario:** Leading a fast-moving team with strict conventions (e.g., pnpm mandatory, zero `any`, strict boundary modules).
- **Brainy Impact:** María captures her project rules once using `brainy add`. When her team runs Claude Code or Cursor, the agent calls `brainy_reality_check` before generating code, ensuring compliance with architectural standards without manual PR nitpicking.

### Persona 2: Alex (Independent Agent Builder)
- **Scenario:** Developing multi-step reasoning agents that research and synthesize documentation across sessions.
- **Brainy Impact:** Alex uses `brainy_capture` and `brainy_link` to build a rich concept graph. Distillation edges (`SUPERSEDES`) allow the agent to refine complex problem summaries over time without generating redundant context noise.

---

## 4. Channels & Distribution Plan

| Channel | Format | Core Message |
|---|---|---|
| **GitHub Releases** | Official Release Notes | Comprehensive changelog, breaking changes, migration table, and quickstart examples. |
| **Discord / Slack Communities** | Technical Showcase | Highlighting sub-10ms hybrid retrieval and zero-external-deps CLI. |
| **Developer Documentation** | Quickstart & API Guides | Step-by-step guides for Claude Desktop, OpenCode, and Cursor configuration. |
| **Social / X** | Announcement Thread | Problem/solution framing, architecture diagram, and copyable terminal snippet. |
