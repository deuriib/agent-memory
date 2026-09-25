# Brand & Surface Deprecation Policy — Brainy v1

**Policy Owner:** `general(vera)` — Marketing & Brand Owner (R5)  
**Co-Owners:** `general(vasquez)` (R1, Engineering), `general(espinoza)` (R8, Ops), `general(barrera)` (R2, Security)  
**Effective Date:** 2026-09-25  
**Governing Release:** Brainy v1.0.0  
**Sunset Milestone:** Brainy v2.0.0  

---

## 1. Purpose & Scope

This policy governs the deprecation schedule, communication mechanisms, and backwards compatibility guarantees during the atomic transition from `agent-memory` to **Brainy** ("segundo cerebro aumentado con agentes", CODE/PARA sobre HelixDB unificado).

The policy applies to all public surfaces:
1. **Command Line Interface (CLI):** `bin/agent-memory.mjs` shim delegating to `bin/brainy.mjs`.
2. **Environment Variables:** `AGENT_MEMORY_*` fallbacks for `BRAINY_*` primaries.
3. **HTTP REST Endpoints:** Legacy `/memory/*` endpoints routing to canonical `/v1/*` handlers.
4. **Model Context Protocol (MCP):** Legacy `memory_*` and `memory_todo_*` tool identifiers.
5. **Ecosystem Configurations:** Plugin and client manifests (`plugin.json`, `mcp_config.json`).

---

## 2. The 1-Version Compatibility Window

Brainy operates under a strict **1-version deprecation window**:
- Throughout the entire `v1.x` release series, all deprecated interfaces remain fully operational.
- Existing developer scripts, IDE extensions (Claude Code, Cursor, OpenCode, Antigravity), and CI pipelines continue working without immediate breaking failures.
- Deprecated interfaces will be permanently removed in **Brainy v2.0.0**.

---

## 3. Surface Deprecation & Warning Contracts

To ensure high visibility without disrupting programmatic workflows, Brainy emits structured deprecation signals:

### 3.1 CLI Deprecation (`bin/agent-memory.mjs`)
When invoked via `agent-memory`, the binary outputs a single-line warning to `stderr` before delegating execution and propagating exit codes:
```
[brainy] deprecation: 'agent-memory' is deprecated and will be removed in next major version; use 'brainy'
```
*Channel rule:* Protocol channels (stdout) remain clean; diagnostics and warnings route exclusively to `stderr`.

### 3.2 Environment Variables Fallback (`AGENT_MEMORY_* → BRAINY_*`)
Primary environment variables use the `BRAINY_*` prefix. If a `BRAINY_*` variable is unset but the legacy `AGENT_MEMORY_*` equivalent is present, Brainy falls back to the legacy variable and emits a name-only notice to `stderr`:
```
[brainy] deprecation: environment variable AGENT_MEMORY_SECRET is deprecated; use BRAINY_SECRET
```
*Security Invariant:* Variable *names* only are emitted; variable values or tokens are NEVER printed or logged.

### 3.3 HTTP REST Headers (`/memory/*`)
All responses to legacy `/memory/*` requests include the RFC-compliant deprecation header:
```http
X-Deprecated: use /v1/*
```
No breaking HTTP error codes (e.g., 404 or 410) are returned during the v1.x window for valid legacy payloads.

### 3.4 MCP Server Tool Aliases
The Brainy stdio MCP server exposes native `brainy_*` tools while retaining 11 legacy `memory_*` tools and 6 `memory_todo_*` tools. Deprecation notices are logged to `stderr` during server initialization and tool discovery.

---

## 4. Invariants & Guardrails

1. **Non-Negotiable Never-Kill Rule (INV-003):**  
   Under no circumstances does Brainy kill, signal, or stop processes listening on upstream ports `3111, 3112, or 3113`. On collision, Brainy fails closed with exit code 1 and prints rerouting advice (`BRAINY_PORT=3151`).
2. **Secret & PII Hygiene (INV-004):**  
   Tokens and secrets (`BRAINY_SECRET`, `AGENT_MEMORY_SECRET`) must never appear in logs, CLI output, or documentation. Public guides use synthetic placeholders (`BRAINY_SECRET=***`, `$BRAINY_SECRET`).
3. **Data Integrity (INV-016):**  
   Migration from legacy schemas or SQLite is idempotent and non-destructive. Deduplication locks prevent data loss or duplicate node creation.

---

## 5. Sunset Schedule

| Milestone | Target Version | Action |
|---|---|---|
| **Deprecation Start** | `v1.0.0` (2026-09-25) | Brand rename, dual-bin shim, `X-Deprecated` headers, `BRAINY_*` primaries. |
| **Deprecation Maintenance** | `v1.x` patches & minors | Full backwards compatibility preserved; no new legacy aliases added. |
| **Final Sunset** | `v2.0.0` (Next Major) | Permanent removal of `bin/agent-memory.mjs`, `/memory/*` routes, `memory_*` MCP aliases, and `AGENT_MEMORY_*` fallbacks. |
