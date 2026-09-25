# Security Review — Engineering & Cross-Domain Singleton (Multi-Lane)

**Reviewer:** security owner (R2, `general(barrera)`) — per `skills/review-security/SKILL.md` (`references/security-review-template.md` + `references/threat-model.md`)
**Singleton:** this file is the security domain's canonical `SECURITY_REVIEW.md` — create-if-missing, update in place, never suffix. One primary section for the active lane; prior lane reviews preserved below separators.

| Lane | Proposal | Spec | Date | Verdict | Status |
|---|---|---|---|---|---|
| **Lane 4 — Brainy Security (current)** | `PROPOSED_CHANGES.md` (engineering, brand, automation) | `SPEC-004-brainy-security` | 2026-09-25 | **Conditional (C1–C8)** | Active review (pre-execute) |
| Lane 3 — Todos follow-ups | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-020-todos` | 2026-09-25 | **Approved** | Shipped & verified (v0.9.0) |
| Lane 2 — P4 ops control plane | `PROPOSED_CHANGES.md` (7 rows) | `SPEC-P4-OPS` | 2026-09-24 | **Conditional (C1–C10)** | Shipped & verified (v0.8.0, Gate OPEN) |

---

# Security Review: SPEC-004-brainy-security (Brainy Security Review) — Lane 4

**Reviewer:** security owner (R2) — `general(barrera)`, per `frame-ship:review-security` (SKILL.md + `references/security-review-template.md` + `references/threat-model.md`)  
**Date:** 2026-09-25  
**Verdict:** **Conditional (C1–C8)** — cleared for `frame-ship:execute-spec` upon domain owner acknowledgement; conditions enforce bearer parity, no-secrets scan, doctor probe credential isolation, DoS bounds, Ley 172-13 PII minimization, never-kill port protections, and 0700/0600 state permissions; verified at `quality-gate`.  
**Methodology:** STRIDE  
**GATE at review time:** Conditional (orchestrator routes this verdict into the gate)  

**Packet (reference-only):**  
`SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC-01..06 / HARD:subagents+max2lanes+no-secrets+alias1version+STRIDE-complete / GATE:none-yet / DOMAINS:R2,R1,R5,R8,R4`

## 1. Scope & Inputs

| Input | Artifact | Role |
|---|---|---|
| Engineering Proposal | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` (10 change rows) | Implementation blueprint: HelixQL schema, 1536-dim embeddings, RRF hybrid search, REST `/v1/*`, MCP tools, SQLite compat |
| Brand/Marketing Proposal | `docs/specs/40_workspace/brand/PROPOSED_CHANGES.md` (12 change rows) | Brand repositioning, README rewrite, 3 examples, migration guide, placeholder hygiene, deprecation policy |
| Automation/Ops Proposal | `docs/specs/40_workspace/automation/PROPOSED_CHANGES.md` (6 change rows) | Ops CLI `bin/brainy.mjs`, dual-bin shim, slot quartet derivation, state file permissions, doctor precedence, never-kill invariants |
| Primary Security Spec | `docs/specs/20_backlog/SPEC-004-brainy-security.md` | REQ-BRAINY-SEC-01..06, AC-01..07, STRIDE §4.1, PII checkpoints §4.3 |
| Sibling Domain Specs | `SPEC-001-brainy-engineering.md`, `SPEC-002-brainy-brand.md`, `SPEC-003-brainy-ops.md`, `SPEC-005-brainy-legal.md` | Interface alignments, NFR-04, Ley 172-13 privacy invariants |
| Grounding Anchors (read-only) | `src/server.ts`, `src/auth.ts`, `src/mcp.ts`, `src/store.ts`, `src/search.ts`, `db/queries.ts`, `bin/agent-memory.mjs`, `hooks/capture.mjs`, `src/errors.ts` | Bearer guard, timingSafeEqual, error sanitization, stdio protocol separation, never-kill hint |

---

## 2. Threat Model

**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

### 2.1 Attack Surface

| Surface | Entry Point | Protocol / Transport | Trust Boundary |
|---|---|---|---|
| **Brainy REST API v1** | `POST /v1/notes`, `GET /v1/notes/:id`, `POST /v1/search`, `GET /v1/context/:project`, `POST /v1/link`, `POST /v1/memory` + legacy `/memory/*` aliases | HTTP `Authorization: Bearer <secret>` on `127.0.0.1:3111` (or slot port $R(N)$) | **Untrusted** client/agent → **Trusted** HTTP server (`isBearerAuthorized` gate; `/v1/livez` and `/memory/livez` exempt only) |
| **Brainy MCP Stdio Server** | Tools: `brainy_search`, `brainy_capture`, `brainy_link`, `brainy_reality_check` + 11 `memory_*` compat tools | JSON-RPC 2.0 over process stdio (`extra._meta.authorization = "Bearer <secret>"`) | **Untrusted** host agent (Claude Code, Cursor, OpenCode) → **Trusted** `MemoryStore` (`isMetaAuthorized` gate) |
| **Operational Control Plane CLI** | `bin/brainy.mjs` & `bin/agent-memory.mjs` subcommands: `start`, `stop`, `status`, `doctor`, `--migrate` | OS CLI flags & process signals (SIGTERM/SIGKILL) | **Untrusted** local operator environment → **Trusted** process supervisor & state manager |
| **Data Layer & Graph Storage** | HelixDB labels (`Note`, `Project`, `Area`, `Resource`, `Archive`, `Memory`, `Session`, `Concept`, `Todo`) + 8 typed edge types | HelixQL queries via HTTP to `HELIX_URL` (`127.0.0.1:6969` or $H(N)$) | **Trusted** Node.js store → **Trusted** HelixDB instance (parameter-bound AST, tenant-scoped) |
| **Background Auto-Capture Hooks** | `hooks/capture.mjs` listening to 7 agent events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `PreCompact`, etc.) | Stdin JSON pipe from agent host | **Semi-trusted** host telemetry (may contain raw PII, file paths, credentials) → **Trusted** sanitizer & loopback POST |
| **State Files & Audit Trail** | `<parent-of-data-dir>/state/slot-<N>.json` and `state/audit.log` | Local filesystem POSIX permissions | Local host non-root users → Protected operational state |
| **Logging & Output Channels** | Server access log, error responses, CLI stdout/stderr, hook silent exit | Stderr, stdout, log files | Ley 172-13 boundary: zero secret/PII egress |

---

### 2.2 STRIDE Analysis

| Threat Category | Applicable? | Specific Vector in Brainy Proposals | Mitigations & Technical Controls | Residual Risk & Owner |
|---|---|---|---|---|
| **Spoofing** | **YES** | 1. Forged bearer tokens on REST `/v1/*`.<br>2. Unauthenticated calls to MCP tools via stdio.<br>3. Bypass via versioned `/memory/*` or `/agentmemory/*` route aliases.<br>4. Open guard exploitation if bound to `0.0.0.0`. | - `src/auth.ts`: `isBearerAuthorized` and `isMetaAuthorized` enforce constant-time `timingSafeEqual` comparison against `BRAINY_SECRET` with fallback to `AGENT_MEMORY_SECRET`.<br>- Aliases rewrite to canonical paths **before** auth middleware executes.<br>- MCP `handle()` enforces auth before every tool execution (`tools/call`); `tools/list` is discovery only.<br>- Only `GET /memory/livez` and `GET /v1/livez` are exempt.<br>- Missing/wrong token returns HTTP 401 with `WWW-Authenticate: Bearer`. | **High (S-004-001):** Running with unset secret on `0.0.0.0` allows unauthenticated access. Mitigated by boot warning and loopback recommendation. Owner: `barrera`. |
| **Tampering** | **YES** | 1. HelixQL injection via user-supplied search queries or note titles.<br>2. Parameter tampering in note moving or edge linking (`REFERENCES`, `BELONGS_TO`).<br>3. In-place content alteration during note distillation.<br>4. Path traversal or hierarchy loops via `parentId`. | - All Helix queries use typed parameter binding via `defineParams` + `toQueryRequest` (`PropertyInput.param`); zero string concatenation or template literal query construction.<br>- Inbound bodies strictly validated via `zod` (`strict()` rejects unknown fields).<br>- Note distillation creates immutable append-only notes linked by `SUPERSEDES` edge; content is never overwritten in place.<br>- `parentId` validated (1..200 chars), self-parent rejected (`parentId === todoId` → 400), target existence verified before link. | **Low (S-004-004):** Cross-project node linking if foreign note ID is known. Mitigated by tenant verification on link operations. Owner: `vasquez`. |
| **Repudiation** | **YES** | 1. Unlogged lifecycle shutdowns or migrations.<br>2. Denial of note deletions or memory purges.<br>3. Log injection (CWE-117) via newline characters in error notes or titles. | - CLI lifecycle events (`stop`, `migrate --apply`) log synchronously to `state/audit.log` (mode `0600`) with timestamp, slot, PID, and action.<br>- Governance deletions (`POST /memory/delete`) log `memoryId` and `reason` single-line collapsed to server log.<br>- `logSafeNote` sanitizes errors: collapses whitespace, strips control chars (`\u0000-\u001f\u007f`), limits length.<br>- MCP stdout reserved strictly for JSON-RPC; all logs and diagnostics routed to stderr. | **Low:** Hook auto-capture drops events on error without audit trail (by design to never block agent). Accepted residual. Owner: `espinoza`. |
| **Information Disclosure** | **YES** | 1. PII leakage from `Note.content` or `Memory.statement` in logs or error traces.<br>2. Plaintext secrets displayed in README, examples, or CLI status.<br>3. Token leakage to foreign rogue HTTP listeners during `doctor` probes.<br>4. Secret leakage to child container environments. | - Ley 172-13 compliant: store purpose ("segundo cerebro CODE/PARA"), TTL (`BRAINY_TTL_DAYS` default 365), and erasure (`forget`, `delete`, `purge`) formally declared.<br>- REST access log restricted to `METHOD PATH STATUS DURATIONms` only (no bodies, query strings, headers, or tokens).<br>- `src/errors.ts`: `logSafeNote` reduces remote Helix errors to error `code` only.<br>- Strict placeholder hygiene: `BRAINY_SECRET=***` and `$BRAINY_SECRET` in all docs; verified by pre-push secret scanner.<br>- `doctor` C2 REST health probe is strictly gated behind C3 verifying `verifyOwnedPid`; unverified/foreign listeners receive zero HTTP requests and zero `Authorization` headers.<br>- CLI `status` outputs presence flags only (`bearer: armed\|unset`), never values.<br>- Helix child process spawn environment explicitly strips secrets. | **Medium (S-004-003):** Local operator inspecting logs if debugging levels misconfigured. Mitigated by allowlist-only logging. Owner: `barrera` / `subero`. |
| **Denial of Service** | **YES** | 1. Memory exhaustion via massive note uploads (>200k chars).<br>2. Slow query DOS via unbounded graph walks or hybrid search limits.<br>3. Port collisions terminating or hijacking services.<br>4. Process kill attacks against upstream production services (`agentmemory`/`iii`). | - Payload bounds: `MAX_BODY_BYTES = 1 MiB` (`1_048_576` bytes) returns HTTP 413; `Note.content` capped at 200,000 chars; `Note.title` capped at 500 chars; search `query` capped at 10,000 chars; `limit ≤ 100`; `max_depth ≤ 3`; `vector_top_k ≤ 20`.<br>- All database operations bounded by 15s `withTimeout`.<br>- Hook fetch capped by `AbortSignal.timeout(1500)`; `MAX_HOOK_BYTES = 1 MiB`; always exits 0.<br>- Non-negotiable **never-kill** invariant: ports 3111/3112/3113 never signaled; `NEVER_BIND = [3111, 3112, 3113, 3151, 6969]`; startup refuses with exit 1 and `neverKillHint()` on occupied port.<br>- Hybrid search catches source errors and degrades to `signals` without returning HTTP 500. | **Low:** Intensive hybrid search load on single-core dev machines. Mitigated by query bounds and timeout. Owner: `vasquez`. |
| **Elevation of Privilege** | **YES** | 1. Local privilege escalation via world-readable state files.<br>2. Rogue process signaling via PID-reuse TOCTOU.<br>3. Arbitrary system file access via malicious data directory paths. | - State directory enforced at mode `0700` (`rwx------`); state file enforced at mode `0600` (`rw-------`) outside `HELIX_DATA_DIR`; closed schema rejects extraneous fields.<br>- Process signaling requires `verifyOwnedPid` (`/proc/<pid>/cmdline` contains `src/server.ts` and `cwd === ROOT`) before SIGTERM, and re-verified immediately before SIGKILL (mitigating PID-reuse TOCTOU / S-010).<br>- Path refusal set strictly rejects system roots (`/`, `/etc`, `/usr`, `/var`, etc.) and `$HOME` itself for data directories.<br>- Queries enforce multi-tenant scoping via `where project` pre-filters before index execution. | **Low:** Root user on host can bypass POSIX permissions (inherent to OS security model). Owner: `espinoza`. |

---

### 2.3 Directed Verification Checks (Packet & HARD Focus)

1. **Bearer Authentication Parity & Alias Resolution (REQ-BRAINY-SEC-01, REQ-BRAINY-SEC-02):**
   - *Status:* **PASS (with conditions C1, C2)**
   - *Verification:* The REST middleware resolves `BRAINY_SECRET` first, falling back to `AGENT_MEMORY_SECRET` with a single stderr deprecation notice. Token validation uses `crypto.timingSafeEqual` over SHA-256 digests to prevent timing attacks. Legacy route aliases (`/memory/*`) rewrite internally before the auth gate, ensuring identical 401 enforcement. MCP stdio tools pass through `handle()` which invokes `isMetaAuthorized` checking `extra._meta.authorization`. Only `/memory/livez` and `/v1/livez` are exempt.
2. **HelixQL Injection Prevention & Query Parameter Binding (REQ-BRAINY-SEC-06, REQ-BRAINY-ENG-03):**
   - *Status:* **PASS (with condition C8)**
   - *Verification:* All HelixQL interactions in `db/queries.ts` use `defineParams` and `PropertyInput.param` (e.g. `saveNote`, `getNoteById`, `distillNote`, `searchByText`, `searchByVector`, `graphSearch`). User inputs (titles, content, queries, tags) are bound to typed AST parameters; zero string concatenation is permitted.
3. **Note Immutability & Provenance via SUPERSEDES (REQ-BRAINY-ENG-07):**
   - *Status:* **PASS**
   - *Verification:* The distillation workflow (`distillNote`, `POST /v1/notes/:id/distill`) strictly enforces append-only semantics. A new `Note` node is created containing the distilled summary, and a directed `SUPERSEDES` edge is created pointing from the new note to the original note. Original note content is never overwritten in place, preserving full historical provenance.
4. **Ley 172-13 PII Minimization & Second Brain Store Declaration (REQ-BRAINY-SEC-05):**
   - *Status:* **PASS (with condition C5)**
   - *Verification:* `Note.content` and `Memory.statement` store declarations define lawful basis, purpose limitation ("segundo cerebro CODE/PARA"), default TTL (`BRAINY_TTL_DAYS` 365), and erasure endpoints (`forget`, `delete`, `purge`). Telemetry and hook captures strictly avoid capturing user prompt text (`UserPromptSubmit` returns fixed string `"user prompt submitted"`). Tool use events capture tool names only (capped at ≤80 chars, rejecting `/` and `\`).
5. **Placeholder Hygiene & Pre-Push Scanning (REQ-BRAINY-SEC-03, REQ-BRAINY-MKT-07):**
   - *Status:* **PASS (with condition C2)**
   - *Verification:* All public examples in `README.md`, `CHANGELOG.md`, `campaigns/`, and docs use synthetic placeholders (`BRAINY_SECRET=***`, `$BRAINY_SECRET`, `http://127.0.0.1:6969`). Pre-push scans using `gitleaks` and grep heuristics block commits containing literal secrets.
6. **Doctor Probe Credential Isolation (REQ-BRAINY-OPS-05, Security C1/C9):**
   - *Status:* **PASS (with condition C3)**
   - *Verification:* The `doctor` command executes checks in strict sequence: `C1 helix-healthz → C3 ports → C2 rest-health → C4 secret-presence → C5 storage-data-dir`. The C2 REST health probe carries a bearer token only if C3 has confirmed that the listener PID is an owned process via `verifyOwnedPid`. Foreign listeners receive 0 HTTP requests and 0 Authorization headers. The `status` command is naked and never transmits credentials.
7. **Denial-of-Service Caps & Timeout Envelopes (REQ-BRAINY-SEC-06, NFR-BRAINY-ENG-01):**
   - *Status:* **PASS (with condition C4)**
   - *Verification:* Inbound REST requests are limited to 1 MiB (`MAX_BODY_BYTES`); `Note.content` is limited to 200,000 characters; search queries are limited to 10,000 characters; database query timeouts are capped at 15s (`withTimeout`); hook network requests timeout in 1.5s; hybrid search returns failure signals rather than 500 when backend components are unavailable.
8. **Never-Kill Invariant & Safe Process Lifecycle Signaling (REQ-BRAINY-OPS-01, REQ-BRAINY-OPS-04):**
   - *Status:* **PASS (with condition C6)**
   - *Verification:* Upstream ports 3111, 3112, and 3113 are protected by non-negotiable invariants. Port conflicts cause startup refusal with exit code 1 and `neverKillHint()`. Process termination in `stop` enforces `verifyOwnedPid` (`/proc/<pid>/cmdline` contains `src/server.ts` and `cwd === ROOT`) before SIGTERM and re-verifies immediately before SIGKILL, eliminating foreign process kill and PID-reuse TOCTOU vulnerabilities.
9. **State File Permissions & Directory Hardening (REQ-BRAINY-OPS-03):**
   - *Status:* **PASS (with condition C7)**
   - *Verification:* State files (`~/.local/share/brainy/state/slot-<N>.json`) and audit logs (`state/audit.log`) are stored in mode `0700` directories with file permissions `0600`. Extraneous schema keys cause fail-closed rejection. State files never contain secrets, tokens, or PII.

---

## 3. Findings

| ID | Severity | Finding Description | Evidence Anchor | Owner | Remediation |
|---|---|---|---|---|---|
| **S-004-001** | **High** | **Open Guard Exposure on Non-Loopback Binding:** When `BRAINY_SECRET` is unset, the server operates in unauthenticated mode for developer ease. If an operator sets `BRAINY_HOST=0.0.0.0` or binds to a public network interface without configuring a secret, all Brainy REST endpoints (`POST /v1/notes`, `POST /v1/search`, etc.) become publicly exposed without authentication. | `src/server.ts:284-290`, `SPEC-004-brainy-security.md:34,159`, `ARCHITECTURE.md §7` | R2 (`barrera`) / R1 (`vasquez`) | **Condition C1:** Server startup MUST detect if `host !== "127.0.0.1"` while secret is unset. In this state, boot log MUST emit a prominent warning: `WARN INSECURE: Server listening on non-loopback host ${host} with authentication disabled`. Production documentation must mandate `BRAINY_SECRET` whenever binding outside loopback. |
| **S-004-002** | **Medium** | **Inadvertent Credential / PII Echoing in Deprecation & Migration Logs:** When `AGENT_MEMORY_SECRET` fallback or SQLite migration runs, deprecation warnings or migration progress could print token names or unmasked user notes to stdout/stderr or log files. | `src/auth.ts:15-20`, `bin/brainy.mjs`, `scripts/import-transcript.ts` | R1 (`vasquez`) / R8 (`espinoza`) | **Condition C2:** Deprecation warnings MUST be static strings (e.g. `WARN deprecated use BRAINY_SECRET — AGENT_MEMORY_SECRET will be removed in next major`) without token values. SQLite migration and transcript imports MUST NOT echo `Note.content` or user prompts to terminal logs. |
| **S-004-003** | **Medium** | **Foreign Listener Credential Harvester Risk:** If an attacker or rogue process occupies the REST port ($R(N)$) and the operator runs diagnostics or probes, sending an `Authorization: Bearer <secret>` header to the foreign listener would compromise the credential. | `bin/brainy.mjs` (`cmdDoctor`, `cmdStatus`), `SPEC-003-brainy-ops.md:41-45` | R8 (`espinoza`) / R2 (`barrera`) | **Condition C3:** Gating verified in Lane 2 MUST be preserved: `doctor` check C2 (REST health) MUST execute only after C3 verifies listener ownership via `verifyOwnedPid`. If C3 fails, C2 must report `INFO skipped (unverified listener; zero credentials transmitted)`. `status` MUST remain naked (no auth header). |
| **S-004-004** | **Medium** | **Cross-Project Node Linking via Unvalidated Foreign IDs:** `POST /v1/link` and `POST /v1/notes` allow creating edges (`REFERENCES`, `RELATES_TO`). If target node UUIDs from other projects are supplied without verifying tenant membership, cross-tenant graph edges could be created, violating project isolation. | `src/store.ts` (`saveNote`, `linkNodes`), `db/queries.ts:36-40` | R1 (`vasquez`) | **Condition C8:** Edge creation logic MUST verify that both `fromId` and `toId` belong to the same `project` tenant before persisting edges in HelixDB, or fail closed with HTTP 400 `invalid_tenant_link`. |
| **S-004-005** | **Low** | **MCP `tools/list` Pre-Authentication Tool Discovery:** Per Model Context Protocol specifications, `tools/list` is executed during transport initialization before request-level `_meta` authorization is passed. A local agent on stdio can inspect tool schemas without the secret. | `src/mcp.ts:162-183`, `SPEC-004-brainy-security.md:36,98` | R1 (`vasquez`) / R2 (`barrera`) | **Accepted Protocol Residual:** Gating occurs strictly at `tools/call`. Tool schemas and descriptions in `src/mcp.ts` MUST NOT contain environment secrets, tenant names, or sensitive context. |
| **S-004-006** | **Low** | **Hook Heuristic Auto-Extraction Residual:** The hook `extractTodos` scans session bodies for keywords (`TODO`, `FIXME`) and extracts up to 3 titles (≤120 chars). If a session body contains sensitive inline tokens or credentials, a snippet might be captured in a Todo title. | `hooks/capture.mjs:209-286`, `SPEC-020-todos.md` | R1 (`vasquez`) / R8 (`espinoza`) | **Accepted Residual (S-020-001):** Titles are sanitized via `clean()` (stripping control chars, collapsing spaces, slicing 0..120). Hook runs locally on loopback. Documentation advises against echoing secrets in conversational prompts. |

---

## 4. Conditions for Approval (C1–C8)

Implementation in `frame-ship:execute-spec` is cleared to proceed subject to satisfying these non-negotiable security conditions, verified at `quality-gate`:

- **[C1] Bearer Guard Parity & Alias Resolution:**  
  REST `/v1/*` routes and MCP stdio tools MUST validate `BRAINY_SECRET` with fallback to `AGENT_MEMORY_SECRET` using `crypto.timingSafeEqual`. Only `/memory/livez` and `/v1/livez` are exempt. Unset secret on non-loopback hosts (`host !== "127.0.0.1"`) MUST log a prominent insecurity warning.
- **[C2] No Secrets in Repository & Strict Placeholder Hygiene:**  
  Literal secrets MUST NEVER appear in code, configuration, logs, examples, or documentation. All public guides and READMEs MUST use placeholders (`BRAINY_SECRET=***`, `$BRAINY_SECRET`). CI pre-push secret scanner (`gitleaks` / grep scan) MUST pass with 0 findings.
- **[C3] Doctor Probe Credential Isolation (C1→C3→C2 Ordering):**  
  The `doctor` CLI subcommand MUST execute checks in sequence `C1 → C3 → C2 → C4 → C5`. Check C2 MUST NEVER transmit an `Authorization` header unless C3 has verified process ownership via `verifyOwnedPid`. `status` MUST NEVER send authorization headers.
- **[C4] Strict Input Validation & Denial-of-Service Caps:**  
  All inbound payloads MUST be parsed using strict `zod` schemas rejecting unknown fields. Maximum payload size MUST be enforced at 1 MiB (HTTP 413). Note content MUST NOT exceed 200,000 characters. All database queries MUST be bound by a 15-second `withTimeout`.
- **[C5] Ley 172-13 PII Minimization & Second Brain Store Declaration:**  
  `Note.content` and `Memory.statement` store declarations MUST define purpose limitation, default TTL (365 days), and deletion pathways (`forget`, `delete`, `purge`). Hook captures MUST NOT store raw prompt text. Quality gate evidence MUST mask user data using `[REDACTED]` or `sha256(content)`.
- **[C6] Never-Kill Invariant & Safe Process Lifecycle Signaling:**  
  Upstream ports 3111, 3112, and 3113 MUST NEVER be killed or signaled. Port collisions MUST fail closed with exit code 1 and `neverKillHint()`. Process termination in `stop` MUST verify `verifyOwnedPid` before SIGTERM and re-verify immediately before SIGKILL.
- **[C7] State & Audit File Hardening (0700/0600 Permissions):**  
  State directories MUST be created with mode `0700` (`rwx------`) and state files/audit logs with mode `0600` (`rw-------`) outside `HELIX_DATA_DIR`. Schemas MUST be strictly closed.
- **[C8] HelixQL Parameter Binding & Tenant Isolation:**  
  All HelixQL queries MUST use typed parameter binding (`defineParams` + `toQueryRequest`); zero string concatenation. Edge creation (`POST /v1/link`, `saveNote`) MUST enforce that linked nodes belong to the same `project` tenant.

---

## 5. Residual Risk

| # | Residual Risk | Likelihood | Impact | Owner | Expiry / Re-review |
|---|---|---|---|---|---|
| **R-SEC-01** | Open authentication guard on loopback (`127.0.0.1`) when `BRAINY_SECRET` is unset for local developer convenience. | Medium | Medium | R2 (`barrera`) | Permanent dev mode design; re-review if default moves beyond loopback. |
| **R-SEC-02** | MCP `tools/list` protocol-level discovery runs unauthenticated before `tools/call` transmits `_meta`. | Low | Low | R1 (`vasquez`) | Governed by MCP specification; re-review if MCP protocol introduces handshake auth. |
| **R-SEC-03** | Hook auto-extract heuristic capturing sensitive code snippets from session text into Todo titles (capped at 120 chars). | Low | Low | R8 (`espinoza`) | 2026-12-31 heartbeat or upon release of dedicated agent privacy filter. |
| **R-SEC-04** | A3 probe migration abort: `doctor --migrate` aborts without writes due to Helix CLI 3.3.0 `HELIX_DATA_DIR` limitation. | Low | Low | R1 (`vasquez`) | Re-evaluate when upstream HelixDB adds runtime data-dir forwarding. |

---

## 6. Sign-off

- [x] **Security Owner (R2) — `general(barrera)`:** **Conditional (C1–C8)**. Complete STRIDE threat analysis delivered. Directed checks 1–9 verified. Findings S-004-001..006 documented. Conditions C1–C8 established. Cleared for `frame-ship:execute-spec`; all conditions to be validated at `frame-ship:quality-gate`.
- [ ] **Engineering Owner (R1) — `general(vasquez)`:** Required countersignature (owner of input schemas, parameter binding, tenant isolation, and distillation immutability).
- [ ] **Automation/Ops Owner (R8) — `general(espinoza)`:** Required countersignature (owner of CLI lifecycle, doctor probe sequence, never-kill invariant, and 0700/0600 state permissions).
- [ ] **Marketing/Brand Owner (R5) — `general(vera)`:** Required countersignature (owner of placeholder hygiene in README/examples and deprecation communication).
- [ ] **Legal/Privacy Owner (R4) — `general(subero)`:** Required countersignature (owner of Ley 172-13 PII store declarations, TTL policies, and data minimization).

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC-01..06 / HARD:subagents+max2lanes+no-secrets+alias1version+STRIDE-complete / GATE:none-yet / DOMAINS:R2,R1,R5,R8,R4`  
**Commit:** left to orchestrator: `docs(sec-004): conditional security review for Brainy v1 (STRIDE complete, C1-C8)`

---

# Security Review: SPEC-020-todos — follow-ups para agentes — Lane 3 (prior, preserved)

**Reviewer:** security owner (R2) — `general(barrera)`, per `frame-ship:review-security` (SKILL.md + `references/security-review-template.md` + `references/threat-model.md`)
**Date:** 2026-09-25
**Verdict:** **Approved** — 0 High / 0 Critical; 3 Low findings accepted as residual (no blocking conditions)
**Methodology:** STRIDE
**GATE at review time:** proposed (orchestrator routes this verdict into the gate)

**Packet (reference-only):**
`SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:proposed / DOMAINS:R1,R2,R8`

## Scope & inputs

| Input | Artifact | Role |
|---|---|---|
| Proposal under review | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` (7 rows) | change rows + risk matrix (R-001..005) |
| Implementation spec | `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07` | REQ-TODO-01..07 + NFR-A..D, §4.1..4.6 contracts |
| Code grounding (read-only) | `src/server.ts:136-177,268-283,470-560` · `src/store.ts:289-351,1313-1472` · `src/mcp.ts:113-147,411-536` · `db/queries.ts:32-34,127-193,720-862` · `hooks/capture.mjs:209-286` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` · `src/auth.ts:15-54` · `src/errors.ts:63-73` | bearer guard + _meta guard + title/parentId validation + hook sanitization + timeout + no-PII posture |
| Brief | `docs/briefs/BRIEF-todos.md` (2026-09-25) + `docs/briefs/OKR-todos.md` | intent frozen: 3 creation vias, single-process, YAGNI cuts |

Retro-doc lane: implementation already shipped and verified in repo (grounded anchors). This review binds `verify-handoff`/`ship-release`: no High/Critical remains; implementation proceeds on Approved.

## Threat Model

**Methodology:** STRIDE — see `references/threat-model.md`.

### Attack Surface

| Surface | Entry Point | Trust Boundary |
|---|---|---|
| REST 6 routes + 2 alias routes: `POST /memory/todos`, `GET /memory/todos`, `GET /memory/todos/:id`, `PATCH /memory/todos/:id`, `DELETE /memory/todos/:id`, `GET /memory/frontier` plus aliases `POST /agentmemory/todos`, `GET /agentmemory/frontier` | HTTP `Authorization: Bearer <secret>` + path + json body + query string (loopback `127.0.0.1:3111`, default) | **untrusted** client → **trusted** server (`isBearerAuthorized` gate); `/memory/livez` exempt only |
| MCP 6 tools: `memory_todo_create|list|get|update|delete`, `memory_frontier` | stdio JSON-RPC `_meta.authorization = "Bearer <secret>"` (`isMetaAuthorized`/`handle()`) | **untrusted** MCP client → **trusted** `MemoryStore` (same bearer rule, same secret, `McpError InvalidRequest` on mismatch) |
| Plugin 6 tools: `memory/todo_create|list|get|update|delete|frontier` (total `memory/*` 11) | `call()` → `Authorization: Bearer <secret>` over HTTP to `AGENT_MEMORY_URL` | **untrusted** OpenCode tool invoke → **trusted** REST (inherits REST guard); `recallCache.clear()` on mutate |
| Hook auto-extract: `hooks/capture.mjs` `extractTodos` + `collectBody` | hook JSON stdin (`transcript|session_body|body|content|prompt.text|tool_output|result` or array join or JSON fallback) on events `Stop|SessionEnd|PreCompact|PostToolUse` | **semi-trusted** host payload (may carry PII/paths/secrets) → **trusted** sanitizer `clean()` + allowlist title only |
| Data layer: Helix `Todo` node `db/queries.ts:727-862` (LABELS.Todo + 4 indexes + 6 batches) + `src/store.ts:1366-1454` (filterTodos/sort, parentId checks, BM25 branch + substring fallback) | `saveTodo/listTodos/getTodoById/updateTodo/searchTodosByText/deleteTodo` via `toQueryRequest(defineParams,values)` with tenant `project` | **trusted** store — params are `defineParams` typed, no string interpolation; tenant scoping via `where eqParam("project")` + `textSearchWith(..., project)` |
| Log/output channels | `src/server.ts:583-613` access log + `respondToError` `logSafeNote` · `src/mcp.ts:179-182` stderr `logSafeNote` · `hooks/capture.mjs:49-51,288-290` never-print + always-exit-0 | Ley 172-13 boundary — raw PII/secret must never reach stdout/stderr/logs/events |

### STRIDE Analysis

| Threat | Applicable? | Mitigation (as implemented) + gap assessment |
|---|---|---|
| **Spoofing** — forged bearer / alias bypass of guard / _meta spoof | **Yes** | **REST:** alias rewriter `src/server.ts:278-286` runs **before** guard: `path.startsWith("/agentmemory/") && (path.startsWith("/agentmemory/todos")||path.startsWith("/agentmemory/frontier"))` → `path.replace("/agentmemory/","/memory/")`; then every `/memory/` route except `livez` hits `isBearerAuthorized(req.headers.authorization, secret)` `:286` → 401 + `www-authenticate: Bearer` on mismatch (identical to other `/memory/*` routes). Alias is scoped to `todos|frontier` only; remainder `/agentmemory/*` falls through to `!path.startsWith("/memory/") → 404`, so no bypass wider than intended. **MCP:** every todo tool goes through shared `handle(name,_meta,op)` `src/mcp.ts:169-182` which calls `isMetaAuthorized(meta,secret)` (`src/auth.ts:48-54` constant-time `bearerMatches`) first → `McpError InvalidRequest: unauthorized`; throw → `isError + logSafeNote` (never crashes, never leaks secret). Secret is `Bearer ${secret}` constant-time via `timingSafeEqual` `:21-27`. **Gap: none blocking** — alias ordering is correct, stdio bearer parity holds. **Verdict PASS.** |
| **Tampering** — parentId injection / path traversal / title injection / NoSQL/Helix param tampering | **Yes** | **parentId:** zod `parentIdSchema z.string().trim().min(1).max(200)` `src/server.ts:139` + `src/mcp.ts:122,130,139` + `plugins/...:108-110` `MAX_TODO_ID 200`; store trims + slices 0..200 `src/store.ts:1323,1436`; `PATCH parentId:null → ""` clear, `""` stored as `parentId=""` read as `undefined` `src/store.ts:484`. Fail-closed: `createTodo` with non-empty `parentId` does `await getTodo(parentId).catch(()=>undefined)` `:1326` → if undefined throw `parent todo not found: ${parentId}` → route maps to `HttpError 400 invalid_request` `:489`; `updateTodo` same plus `parentId===todoId → cannot be its own parent` 400 `:1438`. `GET ?parentId=` exact match `t.parentId ?? "" === input.parentId` `:1393` — tenant still enforced by sibling `where eqParam("project")` on list. Helix injection impossible: `parentId` rides only as `PropertyInput.param("parentId")` / `eqParam` via `defineParams` (`db/queries.ts:741,779,793,806,853`), never string-interpolated. **title/description:** `title z.string().trim().min(1).max(500)` strict (`createTodoBodySchema strict`, `updateTodoBodySchema` `src/server.ts:141-161`); `description z.string().trim().max(5000)`; unknown fields → zod 400 (`strict()`), empty title → 400 zod or `title is required` 400 `:318-319,1445,543`; so no payload stuffing. Hook path: `clean()` `hooks/capture.mjs:54-61` strips control chars (`\u0000-\u001f\u007f` → space), collapses whitespace, trims, slices 0..120 for title — injection to Helix or logs not reachable. **Gap: none blocking** (see S-003 Low for cross-project parent residual). **PASS.** |
| **Repudiation** — untraced deletes/updates / hook fire-and-forget non-repudiation | **Low** | Todos are bounded-initiative, single-process, not governed by purge/delete governance-line contract (`docs/CONTRACT.md:479-495` applies to Memory `delete` with `reason`). No audit-line requirement for todos is declared in SPEC/BRIEF. Mutations return `{todo}`, `{deleted:true}` synchronously; `recallCache.clear()` on create/update/delete `plugins/...:962,1050,1071` ensures no stale cache repudiation. Hook's fire-and-forget loss (R-005 Medium/Low per PROPOSED_CHANGES `R-005`) is by-design: never blocks session, loss = agent still has REST+MCP+plugin creation vias. Accepted residual. **No action.** |
| **Information Disclosure** — secret print / PII in logs / prompt text via hook / error-message leakage | **Yes** | **Secrets:** `src/auth.ts:15-18` `secretFromEnv` non-empty arms guard; `src/server.ts:593,677-680` + `src/mcp.ts:9,179-182,549-559` + `plugins/...:248-304` + `hooks/capture.mjs:199-201,220-221` never print/echo the secret value — `Authorization: Bearer` only rides in headers, never in logs; `logSafeNote` `src/errors.ts:63-73` strips remote Helix envelope to `error code` only. **PII (Ley 172-13):** REST access log `src/server.ts:605-608` logs only `method path status duration` (pathname via `pathnameOf` slicing before `?`), never bodies/query/headers/secrets. `respondToError` `:583-586` sends `logSafeNote` only for 500; 400/404/401 paths send fixed codes + filtered details from zod `safeParse` issues (no secret). MCP stdout is protocol only, stderr is sanitized. Hook `observationFor` for `UserPromptSubmit` returns fixed `"user prompt submitted"` `hooks/capture.mjs:72` — `hook.prompt` is **never touched**; file-edit marker stores only tool NAME `file edited via <tool>` with opt-in basename ≤80 chars (never full path). `extractTodos` titles are `clean(line 0..120)` + fixed `description="auto-extracted from session"` `:246`, not raw body; hook **never logs prompt text nor secret** (invariant checked in PROPOSED_CHANGES Security Considerations). **Error messages:** parent-not-found strings include `parentId` value (trimmed ≤200) — bounded, no secret, fail-closed 400. **Gap: none blocking.** **PASS.** |
| **Denial of Service** — body overfill / overfetch / hook stall / port kill | **Yes** | **Body bounds:** `MAX_BODY_BYTES 1_048_576` + `content-type: application/json required` check 415 → 413 → 400 `src/server.ts:221-243`; zod limits prevent large-field amplification (`title max500`, `description max5000`, `limit 1..100`, search max500 `__listTodosQuerySchema:163-176`). **Overfetch:** `listTodos` without search does `rawListTodos(max(limit*4,100))` `src/store.ts:1384` (upper bounded 400 when limit=100); search branch does `rawListTodos(project,200)` fallback only on 0 hits `:1377`; app-side `filterTodos` + `sort` + `slice(limit)` bounds response. Accepted residual R-001 Low. **Hook stall:** each POST → `AbortSignal.timeout(1500)` `hooks/capture.mjs:231`, `slice(0,3)` cap, `.catch(()=>undefined)` never throws, `process.on(uncaughtException/unhandledRejection -> exit 0)` `:50-51` + `main().catch(()=>undefined).finally(()=>process.exit(0))` `:288-290` guarantees always exit 0, never blocks. **Never-kill upstream:** no code signals ports `3111/3112/3113` (`NFR-TODO-C`, `src/server.ts:641-661` `REROUTE_PORT=3151` hint rather than kill). **PASS.** |
| **Elevation of Privilege** — cross-tenant parentId hijack / tenant bypass via alias or BM25 | **Yes** | Tenant key is `project` everywhere: Helix `todo_project nodeEquality(project)` + `todo_title nodeText(title, project)` with tenant `project` `db/queries.ts:168-177`; `listTodos where eqParam("project",...)` `:784-785`; `searchTodosByText where project → textSearchWith(..., project)` `:842-847` (+ `project` param). `listTodos` always scopes by input `project ?? "default"` `:494-503,513-514`. No route trusts a client-supplied `project` without defaulting/filtering. **Alias:** rewrite preserves original query string (URL object), so `?project=` tenant travels intact before guard; guard applies post-rewrite identically. **Cross-tenant parent:** `getTodo(parentId)` is global (no project filter) `db/queries.ts:797-803`; therefore a todo in `project=B` can be parent of a todo in `project=A` if the child knows the UUID. This is accepted residual (SPEC R1 / PROPOSED_CHANGES R-001 Low, BRIEF allows scalar `parentId` without per-tenant isolation — single-process, non-sensitive tenant). No privilege escalation to secrets or other PII stores results; listing by `parentId` is still scoped by `project` (`filterTodos` keeps tenant filter separate). **No bypass to memory/embedding data.** **PASS with note S-003.** |

### Residual Risk (accepted, owner stated)

1. **S-003 (Low) cross-project parentId link** — global `getTodo` lookup means `project=A` child can reference `project=B` parent UUID if known. Impact Low: ids are `todo_${uuid}` random, no enumeration, listing still project-scoped (`filterTodos` applies project via `rawListTodos`/`searchTodosByText` branch). Owner R1. Trigger for tightening: `GET /memory/todos?parentId=` p95 with >1k children per parent or multi-tenant complaint → add project check on parent lookup or dedicated `parentId+project` index. Accepted.
2. **R-001 (Low) app-side parentId overfetch** — `rawListTodos(max(limit*4,100))` up to 400 rows before app-side `parentId` filter. Owner R1 per SPEC §6. Accepted until >1k metric fires; then introduce `parentId` index (no ADR now, per §5 Out of Scope).
3. **R-002 (Low) hook heuristic precision** — keyword heuristic `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → medium, else `should|need to|must|blocked|revisit` → low, `body.length<400→0`, lines 12..200 chars, cap 5→dedup case-insensitive→3. False positives/negatives possible; mitigated by cap, never-blocks, dedup. Accepted bounded-initiative.
4. **Local single-user blast radius** — Helix dev `storage="disk"` under `HELIX_DATA_DIR`, loopback only (`127.0.0.1:3111` default), no customer data plane, no external send beyond `POST /memory/todos` to `AGENT_MEMORY_URL`. Same envelope as prior lane; secret never leaves `Bearer` header.
5. **Hook fallback body stringify** — `collectBody` fallback does `JSON.stringify(hook).slice(0,4000)` when no long candidate ≥400, but `extractTodos` still runs `clean()` + heuristic + 120-char cap before POST, so no raw secret/PII egress. Accepted.

## Directed checks (packet checklist)

**(1) bearer alias / agentmemory/todos same guard** — **PASS.** `src/server.ts:278-286` alias rewriter precedes guard `src/server.ts:286` `!isBearerAuthorized → 401 + www-authenticate: Bearer`. Plain `/memory/todos` and `/agentmemory/todos` converge to same path before auth, so same 401 behavior. Alias scoped to `todos|frontier` only (`/agentmemory/frontier*` too), remainder `/agentmemory/*` 404 — verified by negative test (no wider rewrite). Only `livez` exempt, unchanged.

**(2) _meta bearer** — **PASS.** `src/mcp.ts:169-182` `handle(name,_meta,op)` calls `isMetaAuthorized(meta,secret)` (`src/auth.ts:48-54` typeof/Record check + `bearerMatches` `timingSafeEqual`) → unauth throws `McpError InvalidRequest: unauthorized`; throw → `isError + logSafeNote` (`src/mcp.ts:180-181`), never crashes, never logs secret/content. All 6 todo tools go through `handle`. `stdout` = MCP only, `stderr` = logs invariant holds (`src/mcp.ts:12,549`). Parity with REST guard proven.

**(3) parentId injection** — **PASS (fail-closed).** `parentIdSchema 1..200` (`src/server.ts:139`, `src/mcp.ts:122`, `plugins/...:108`) + store trim+slice 0..200 (`src/store.ts:1323,1436`) bounds length; Helix param binding via `defineParams` + `PropertyInput.param` (`db/queries.ts:741,814,806,853`) prevents injection into query AST. `parentId===todoId` → `cannot be its own parent` 400 (`src/store.ts:1438`, `src/server.ts:543`); unknown parent → `parent todo not found: ${parentId}` → `HttpError 400 invalid_request` (`src/server.ts:488-489,543-544`, `src/mcp.ts:435,500`). `PATCH {parentId:null}` clears to `""` → read `undefined` (spec `parentId=null cleans`). No raw SQL/Helix string concat.

**(4) todo title sanitized** — **PASS.** REST/MCP/plugin zod `title z.string().trim().min(1).max(500)` strict rejects empty/overlong/unknown fields 400 (`src/server.ts:141-151,153-161`, `src/mcp.ts:116-131`). Hook uses `clean(value,120)` (`hooks/capture.mjs:54-61` control-char → space, `\\s+` collapse, trim, slice) for every title; `description="auto-extracted from session"` fixed (`:246`), never prompt text. No title reaches logs unbounded.

**(5) 1.5s hook timeout always exit 0** — **PASS.** `hooks/capture.mjs:225-232` `slice(0,3)` × `fetch(url,{ signal: AbortSignal.timeout(1500) }).catch(()=>undefined)` each bounded 1.5s; observation `memory/remember` uses `AbortSignal.timeout(2000)` `:204` separately. Global `uncaughtException/unhandledRejection → process.exit(0)` (`:50-51`) + `main().catch(()=>undefined).finally(()=>process.exit(0))` (`:288-290`) guarantees exit 0 on any throw, never blocks `Stop|SessionEnd|PreCompact|PostToolUse`. No retry, no `never kill` violation (no signal to 3111/3112/3113).

**(6) no PII in logs** — **PASS.** Access log `src/server.ts:605-607` logs `method pathname status duration` only (via `pathnameOf` `req.url` before `?`, no body/query/header/secret). `respondToError` sends `logSafeNote` (`src/errors.ts:63-73` remote→code only, local→trimmed, never secret) `:584`. Hook never `console.log` anything; on success/failure it is silent (always exit 0, errors swallowed). Plugin `call()` `plugins/...:278-303` returns `{ok:false, note}` without secret/URL leakage (network error note is generic `"unreachable"`). Ley 172-13 minimization holds: hooks never capture prompt text (`UserPromptSubmit → fixed string` `:72`), extract only heuristic title, `SUPPORTED` set bounded (`:38-46`).

## Findings

Severity per shared foundation: Critical = block · High = fix before next release · Medium = fix within sprint · Low = hygiene/backlog. Critical/High surface same session with severity + evidence + owner. Residual risk explicit. No silent PASS.

| ID | Severity | Finding | Evidence | Owner | Remediation |
|---|---|---|---|---|---|
| S-020-001 | **Low** | Hook `collectBody` fallback could surface a secret-bearing value into `body` string before heuristic filtering (e.g., a hook field carrying a token). Mitigated by downstream `clean` + keyword heuristic + 120-char cap + 5→dedup→3 + never-log posture, but the fallback path is the widest body source. | `hooks/capture.mjs:262-286` fallback `JSON.stringify(hook).slice(0,4000)` → `extractTodos` lines 12..200 + regex `/^(TODO...)`/`\b(should|need to|...)` + `clean(...,120)` | R1 (engineering) + R2 (review) | **Accepted residual.** Hook titles are sanitized via `clean` and heuristic allowlists; fallback only runs when no candidate ≥400 exists and still must pass length/heuristic gates. Optional hardening (non-blocking): exclude `AGENT_MEMORY_SECRET` from `JSON.stringify` replacer or skip fallback when `hook` keys contain `secret|token|authorization` case-insensitive. No GATE. |
| S-020-002 | **Low** | MCP `memory_todo_update` input `parentId: {type:["string","null"]}` schema declares `type:["string","null"]` via `as unknown as string` workaround (`plugins/...:1031` documents MCP SDK `zod→JSON-schema` mapping concern). A JSON Schema consumer could mis-read the union if the SDK inlines it differently; however stdio MCP validation is zod-driven (`todoUpdateInput` uses `z.union([z.string().trim().min(1).max(200), z.null()])` `src/mcp.ts:130`), so server-side enforcement holds regardless of advertised schema. | `src/mcp.ts:124-131` vs `plugins/...:1020-1035` note; `src/server.ts:159` `z.union([parentIdSchema, z.null()])` | R1 | **Accepted.** Zod is the runtime guard for both MCP and REST; the JSON Schema shape is advisory for `tools/list`. Hardening: validate MCP schema round-trip `tools/list → minLength/maxLength` advertises (parity with C3-R17 delete pattern) at `verify-capture`. No GATE. |
| S-020-003 | **Low** | Cross-project parentId linking is permitted (global `getTodo(parentId)` no project filter) — see Residual Risk (1). Not exploitable against secrets but widens logical hierarchy across tenants. Spec declares it (no per-project check) and PROPOSED_CHANGES carries as accepted R-001. | `src/store.ts:1325-1327,1439-1440` vs `db/queries.ts:793-803` global lookup; Spec §6 R1 | R1 | **Accepted residual** with trigger: >1k children p95 or multi-tenant isolation request → enforce `parent.project === input.project` or add `parentId+project` predicate. No GATE. |

**Counts: 3 findings — 0 Critical · 0 High · 0 Medium · 3 Low.**

## Conditions for Approval (Verdict: Approved — no blocking conditions)

No High/Critical findings. The three Lows are accepted as documented residuals with explicit owners and triggers; they do not block `verify-handoff` or `ship-release`. No additional implementation delta is required for this lane; all mandatory postures (zero new deps NFR-TODO-A, Ley 172-13 NFR-TODO-B, never-kill NFR-TODO-C, BRIEF frozen NFR-TODO-D) remain intact.

Traceability to packet focuses:
- **Bearer alias same guard** → condition none: ordering proven `src/server.ts:278-286` rewriter-before-guard, `isBearerAuthorized` `src/auth.ts:33-41` constant-time, `livez` exempt only.
- **_meta bearer** → condition none: `isMetaAuthorized` `src/auth.ts:48-54` + `handle()` `src/mcp.ts:169-182`.
- **parentId injection** → condition none: fail-closed 400 `src/server.ts:488-489,543-544` + `src/mcp.ts:435,500` + `src/store.ts:1438`.
- **Title sanitized** → condition none: zod `1..500 strict` + `clean` `hooks/capture.mjs:54-61`.
- **1.5s hook timeout always exit 0** → condition none: `AbortSignal.timeout(1500)` + `process.exit(0)` guarantees.
- **No PII in logs** → condition none: allowlisted logs, `logSafeNote`, hook never prints.

## Sign-off

- [x] **security owner (R2) — `general(barrera)`:** **Approved.** STRIDE complete, directed checks (1)–(6) PASS, 0 Critical/High to block. Cleared for `verify-handoff` → `ship-release`; no waiver required. Residual Lows explicitly accepted (S-020-001..003, R-001/002).
- [ ] **engineering owner (R1) — `general(vasquez)`:** required countersignature (owner of R-001/R-002/R1 thresholds, parentId cross-project decision, hook heuristic tuning). No ADR delta — additive indexes/alias/scoped rewriter only, per PROPOSED_CHANGES §3.
- [ ] **automation/ops owner (R8) — `general(espinoza)`:** required countersignature (hook detached 1.5s ×3 + exit 0, plugin `memory/*` 5→11 with `recallCache.clear()`, `verify-capture` + `verify-lifecycle` evidence). No pipeline gate weakening.

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07 / HARD:subagents / GATE:proposed / DOMAINS:R1,R2,R8`
**Evidence anchors (scoped):** `src/server.ts:136-177,268-283,470-560,584-588,605-613` · `src/store.ts:289-351,1313-1472` · `src/mcp.ts:113-147,411-536` · `db/queries.ts:32-34,127-193,720-862` · `hooks/capture.mjs:38-51,54-61,209-286,288-290` · `plugins/opencode/plugins/agent-memory.ts:108-111,924-1097` · `src/auth.ts:15-54` · `src/errors.ts:63-73` · `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md:13-33,86-95`
**Commit:** left to orchestrator (lane synthesis): `docs(sec-020): Approved SECURITY_REVIEW for SPEC-020-todos (STRIDE, 0 High, 3 Low)`

---

# Security Review: SPEC-P4-OPS — P4 ops control plane — Lane 2 (prior, preserved)

**Reviewer:** security owner (R2) — `general(barrera)`, per `frame-ship:review-security`  
**Date:** 2026-09-24  
**Verdict:** **Conditional (C1–C10)** — cleared for execute-spec; all conditions landed in code and verified in `GATE_REPORT.md` (OPEN 8/8 PASS, commit `615d06ea`)  
**Methodology:** STRIDE  
**GATE at review time:** Conditional (cleared to OPEN at quality-gate)  

**Packet (reference-only):**  
`SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F / HARD:subagents+<zero new deps, frozen src/db, port guard 3111/3112/3113/3151/6969> / GATE:none-yet / DOMAINS:R1,R8,R2`

## Scope & Inputs

| Input | Artifact | Role |
|---|---|---|
| Proposal | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` (7 rows) | CLI binary `bin/agent-memory.mjs`, slot derivation, lifecycle start/stop/status/doctor |
| Specifications | `SPEC-P4-OPS.md` (R1) · `SPEC-P4-OPS-RUNBOOK.md` (R8) | Operational contracts §1–§5, doctor exit codes, allowlists |
| Grounded Anchors | `bin/agent-memory.mjs`, `scripts/verify-ops.ts`, `helix.toml`, `package.json` | Real process management, socket probes, POSIX permissions |

## Threat Model (STRIDE)

- **Spoofing:** Rogue listener on derived ports. Mitigated by `verifyOwnedPid` (`/proc/<pid>/cmdline` verification) and strictly gating doctor bearer requests behind port ownership.
- **Tampering:** State file tampering, PID poisoning, or arbitrary file overwrite. Mitigated by `0700` state dir, `0600` state file, closed schema validation (`isValidState`), and path refusal list rejecting system roots and `$HOME`.
- **Repudiation:** Unlogged stops or migrations. Mitigated by `appendAudit` recording all lifecycle stop and migrate operations to `state/audit.log` (mode `0600`).
- **Information Disclosure:** Plaintext token display in CLI output or leaks to foreign servers. Mitigated by `bearer: armed|unset` presence-only reporting, stripping secrets from Helix child spawns, and sending 0 Authorization headers to unverified listeners.
- **Denial of Service:** Foreign process kill or port conflicts. Mitigated by fail-closed refusal on occupied ports with `neverKillHint()`, absolute prohibition against killing 3111/3112/3113, and 30s readiness caps.
- **Elevation of Privilege:** Unauthorized process signaling or PID reuse attacks. Mitigated by double-checking `verifyOwnedPid` before SIGTERM and re-verifying immediately before SIGKILL (`C10 / S-010`).

## Findings (S-001..S-014) & Conditions (C1–C10)

| ID | Finding | Severity | Condition Enforced & Verification |
|---|---|---|---|
| **S-001** | Doctor sending `Authorization` header to foreign HTTP listener on port $R(N)$. | **High** | **C1:** Ownership-gated bearer. C2 REST check executes only after C3 verifies PID ownership via `verifyOwnedPid`. Evidence: `scripts/verify-ops.ts:265-287` proves 0 headers sent to synthetic server. |
| **S-002** | Backup archives exposing sensitive memory PII with world-readable permissions. | **High** | **C2:** Backup 0600/0700 permissions and Ley 172-13 declaration. Probe A3 confirmed fail-closed abort (`MIGRATE ABORT: unsupported-runtime`), zero disk writes. |
| **S-003** | State file metadata readable by other local host users. | **Medium** | **C3:** State directory `0700`, state file `0600` outside `HELIX_DATA_DIR`; closed schema validation. |
| **S-004** | Data directory configuration allowing system root paths (`/`, `/etc`). | **Medium** | **C4:** Path refusal list rejecting system roots and `$HOME` itself in `resolveDataDir`. |
| **S-005** | Running `start` against an already running slot causing undefined behavior. | **Medium** | **C5:** Start idempotence: live-verified process exits 0 with `already running`. |
| **S-006** | Lack of durable operational audit trail for process terminations. | **Low** | **C6:** Audit trail: `appendAudit` writes single-line timestamped record to `state/audit.log` (0600). |
| **S-007** | ANSI/newline injection in CLI output (CWE-117). | **Low** | **C7:** Single allowlisted renderer: `oneLine` collapses whitespace and masks paths (`$HOME` → `~`). |
| **S-008** | Authentication secrets leaked to Helix container environment. | **Low** | **C8:** Environment minimization: `helixEnv` explicitly strips `AGENT_MEMORY_SECRET`. |
| **S-009** | Status subcommand transmitting bearer token to REST server. | **Medium** | **C9:** Status never sends bearer; probes `/memory/livez` naked; 401 response interpreted as `armed`. |
| **S-010** | PID-reuse TOCTOU between PID verification and SIGKILL. | **High** | **C10:** Re-verify `verifyOwnedPid` immediately before sending SIGKILL; mismatch aborts with exit 1 without signaling. |

## Sign-off

- [x] **security owner (R2) — `general(barrera)`:** **Conditional (C1–C10)** issued at review; verified and cleared to **OPEN** in `GATE_REPORT.md` (8/8 PASS, commit `615d06ea`).

---

# Security Review: REQ-BRAINY-ENG-06 move-route delta — `POST /v1/notes/:id/move` (R2 delta verdict)

**Reviewer:** `general(barrera)` — Security Owner (R2), per `frame-ship:review-security` (`references/security-review-template.md` + `references/threat-model.md`)
**Date:** 2026-09-25
**Verdict:** **Approved with conditions SC-MOVE-01..05** — satisfies architecture condition C1 (`ADR-0003 § Conditions C1`); execute lane is unblocked subject to the conditions below, verified at `quality-gate`.
**Methodology:** STRIDE
**GATE at review time:** `architecture=Approved-with-conditions C1..C4` (C1 = this R2 approval, now discharged as conditional)

**Packet (reference-only):**
`SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC + SPEC-001#REQ-BRAINY-ENG-06,AC-06,AC-12 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:architecture=Approved-with-conditions C1..C4 (C1 = R2 approval required before execute) / DOMAINS:R2,R1,R8,R4,R5`

## 1. Scope of this delta review

| Input | Artifact | Role |
|---|---|---|
| Proposal addendum | `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` `## Addendum — REQ-BRAINY-ENG-06: REST move route` (commit `a88f0a4`) | One additive route `POST /v1/notes/:id/move`, strict zod, dual bearer, C8 same-tenant `400 invalid_tenant_link`, reuse of `HelixStore.moveNote` — no schema/dependency/bin/MCP/store/query changes |
| Architecture verdict | `docs/adr/ADR-0003-post-v1-notes-move-route.md` (commit `bf2b595`) | Frozen delta (2 one-row doc deltas), reviewer analysis, conditions C1..C4 (C1 = this review) |
| Code grounding (read-only) | `src/auth.ts:1-77` · `src/server.ts:32,236-250,296-310,364-380,498-530,910-916` · `src/store.ts:1887-1909,1962-1972` · `src/mcp.ts:188-223` · `db/queries.ts:147-152,834-879` | Bearer contract, C8 link pattern, body caps, moveNote chain, MCP error boundary |
| Open R2 observation | `src/mcp.ts` `handle()` `isError`-vs-protocol-rejection | Ruled separately in §5 below |

Out of scope (untouched by the delta, carried over from the Lane 4 `Conditional (C1–C8)` review above): legacy `/memory/*` alias posture (1-version), `bin/`, MCP tools, HelixQL schema, PII store declarations, doctor probe ordering, never-kill invariant, state permissions.

## 2. STRIDE analysis — `POST /v1/notes/:id/move`

| Threat | Applicable? | Control + evidence |
|---|---|---|
| **Spoofing** (forged bearer on the new route) | Yes | New route inherits the audited guard by construction: guard `src/server.ts:369` (`!isLivez && !isBearerAuthorized(...)` → `401` + `www-authenticate: Bearer` `:370-372`) sits before all route blocks; only `/memory/livez` and `/v1/livez` exempt (`:367-368`). `secretFromEnv` resolves `BRAINY_SECRET` first with static deprecation notice (`src/auth.ts:20-34`); comparison is constant-time `timingSafeEqual` over SHA-256 digests (`src/auth.ts:42-49`); non-loopback-without-secret boot warns `WARN INSECURE` (`src/server.ts:913-916`). Proposal mandates placement after `GET /v1/notes/:id` (`:419-435`) — i.e. below the guard — with no new auth scheme. **PASS, condition SC-MOVE-01.** |
| **Tampering** (unauthorized `BELONGS_TO` edge rewrite) | Yes | Destructive write is gated twice: (a) strict zod `moveNoteBodySchema` (`to` closed enum, `name` trimmed 1..500, `.strict()` rejects unknown keys — mirrors `linkNodesBodySchema` `src/server.ts:236-243` and `distillNoteBodySchema` `:245-250`); (b) server-side same-tenant verification before any edge write, mirroring the existing `/v1/link` C8 block (`src/server.ts:502-510`: fetch both nodes under resolved tenant, mismatch → `400 invalid_tenant_link` with no write; store-level throw `src/store.ts:1972` mapped at `:519-525`). Proposal mandates cross-tenant input → `400 invalid_tenant_link` with no write. Query layer is typed `moveNoteParams` (`db/queries.ts:147-152`) + `toQueryRequest` (`src/store.ts:1900-1905`); `moveNote` body (`db/queries.ts:834-879`) uses `eqParam`/`PropertyInput.param` only — zero string concatenation (repo-wide `defineParams` count 20+ sites; no `${}` interpolation in `db/queries.ts`). No new HelixQL introduced. **PASS, conditions SC-MOVE-02/03/04.** |
| **Repudiation** (denial of a move) | Low | Move is a PARA reclassification (edge drop+add), not a deletion/erasure under the governance-line contract (`src/server.ts:690-705` governance line applies to `POST /memory/delete` with `reason`). No audit-line requirement is declared for moves in SPEC/BRIEF/ADR. Repudiation coverage: synchronous `200 {id, para:{label,name}}` response plus the allowlisted access log (`METHOD PATH STATUS DURATIONms` only). **Decision: no governance log entry required for move. Accepted, no condition.** |
| **Information disclosure** (404/400 oracle, cross-tenant probe) | Yes | Error envelope unchanged (`{error, details?}`; zod details are field-path messages only, `src/server.ts:279-288`). `false` → `404 note_not_found`; unknown/empty target → `404 para_target_not_found`; cross-tenant → `400 invalid_tenant_link`. Note lookup is tenant-scoped (`getNoteById(id, project)`), so a cross-tenant note id resolves to `404`, not `400` — no tenant-membership oracle beyond what the existing `/v1/link` block already exposes. Exploitation requires a valid bearer on loopback. No new log/export surface; no secret/PII in error text. **PASS with note (Low, accepted).** |
| **Denial of Service** (body overfill, unbounded work) | Yes | `readJsonBody` enforces `content-type: application/json` → `415`, `MAX_BODY_BYTES = 1_048_576` → `413` (`src/server.ts:32,296-310`) — covers the new route by construction since the handler must call `readJsonBody` per the proposal. Field caps (`name` 1..500, closed enum, `.strict()`) bound parsing; work is one scoped `writeBatch` (anchor + drop + anchor-or-create + add, `db/queries.ts:834-879`) under the existing 15s `withTimeout` envelope. **PASS, condition SC-MOVE-02 (must route body through `readJsonBody` + `parseOr400`).** |
| **Elevation of privilege** (tenant escape via move) | Yes | Tenant precedence fixed: body `project` ?? query `?project=` ?? `"default"` (same as link/distill family). Same-tenant check before any write (SC-MOVE-03) plus `DEFAULT_PROJECT` scoping on lookup means a move cannot attach a note to another tenant's PARA node and cannot widen to other PII stores. No new privilege, port, dependency, or MCP surface. Fail-closed throughout (`400`/`404`/`401`, never silent create — empty/unknown target → `404`). **PASS, condition SC-MOVE-03.** |

Blast-radius honesty (verified): `grep -c "move" src/server.ts` = **0** (no route exists yet — purely additive on implementation); no new PII store, no new secret, no new port, no `bin/` change in this lane, no MCP tool, no legacy `/memory/*` change; legacy alias stays 1-version (7 canonical `/v1/*` routes after, per ADR-0003).

## 3. Verdict

**Approved with conditions SC-MOVE-01..05.** Architecture condition C1 is discharged by this review (conditional approval counts as R2 approval under ADR-0003 C1). **`execute may proceed`** subject to all five conditions holding in the implementation and being evidenced at `quality-gate`.

## 4. Security conditions (owner + deadline each)

Mapper note: no `IMPLEMENTATION_PLAN.md` exists in-repo; C1..C8 below map to the canonical table in this file (`SECURITY_REVIEW.md` §4, Lane 4 review).

- **[SC-MOVE-01 — bearer reuse, maps C1]** New handler MUST sit below the existing guard (`src/server.ts:364-380` pattern), rely on the dual-bearer `isBearerAuthorized` gate with `livez`-only exemption, and return `401 unauthorized` + `www-authenticate: Bearer` on mismatch. No new auth scheme, no exemption. **Owner:** R1 execute lane. **Deadline:** at `execute-spec`.
- **[SC-MOVE-02 — strict input + body caps, maps C4]** Body schema MUST be `.strict()` with `to` closed enum + `name` trimmed 1..500 (+ optional `projectSchema`), parsed via `parseOr400` over `readJsonBody` (1 MiB / 413 envelope). Unknown keys, empty/oversize `name`, unknown `to` → `400 invalid_request`. **Owner:** R1 execute lane. **Deadline:** at `execute-spec`, evidenced at `quality-gate` (strict-body probes).
- **[SC-MOVE-03 — same-tenant check before any write, maps C8]** Handler MUST verify note and PARA target belong to the same `project` tenant BEFORE any edge write (mirror `src/server.ts:502-510`); mismatch → `400 invalid_tenant_link` with zero writes. **Owner:** R1 execute lane. **Deadline:** at `execute-spec`, evidenced at `quality-gate` (cross-tenant probe).
- **[SC-MOVE-04 — query safety, maps C8]** Handler MUST delegate to the existing `HelixStore.moveNote` → `moveNote` query chain (`src/store.ts:1887-1909`, `db/queries.ts:834-879`); zero new HelixQL, zero string concatenation, typed `defineParams` + `toQueryRequest` only. **Owner:** R1 execute lane. **Deadline:** at `execute-spec`.
- **[SC-MOVE-05 — secrets/PII hygiene, maps C2/C5]** Tests and docs for the route MUST use placeholders only (`<note-id>`, `<area-name>`); no real secrets, no raw PII in evidence (paths + line numbers + grep counts). Pre-push secret scan MUST pass with 0 findings. **Owner:** R1 execute lane (+ R8 for CLI repoint). **Deadline:** `quality-gate`.
- Cross-ref (not owned here): ADR-0003 C3 — R8 repoints CLI `move` (`bin/brainy.mjs:1582-1606`) to the new route in its own lane. **Owner:** R8 `general(espinoza)`.

Findings count for this delta: **0 Critical · 0 High · 0 Medium · 0 Low** (one Low disclosure-oracle note accepted in §2 table, no finding filed).

## 5. Ruling on the open R2 observation: MCP `isError`-vs-protocol-rejection (`src/mcp.ts`)

**Ruling: ACCEPTED declared residual — no finding, no condition.** The observation as filed does not match the code: auth failures are NOT converted to `isError` results. `handle()` (`src/mcp.ts:209-223`) throws `McpError(ErrorCode.InvalidRequest, "unauthorized")` at `src/mcp.ts:214-215` BEFORE the `try` block — i.e. at protocol level, observable by the MCP client as a request error. Only post-auth store failures fall into the `try` (`:217-222`) and become sanitized `isError` results (`failed({error:"internal_error"})` + `logSafeNote` stderr line), which is the correct posture: a dead Helix must never crash the stdio process and must never leak secrets/content. Auth-first-then-boundary ordering is verified by reading `src/mcp.ts:209-223`. This matches the Lane 4 accepted residual S-004-005 pattern (protocol behavior declared, no secret/schema leakage). **Owner:** R2 (declaration). **Expiry:** re-review only if `handle()` ordering changes or auth moves inside the `try`.

## 6. Evidence hygiene statement

This delta review cites allowlisted references only: file paths, line numbers, grep counts, and error-code strings. No secrets, credentials, tokens, or sessions are recorded (placeholders only). No raw PII appears in evidence (`<note-id>` / `<area-name>` placeholders; `[REDACTED]` convention retained for any future user data).

## 7. Sign-off

- [x] **Security Owner (R2) — `general(barrera)`:** **Approved with conditions SC-MOVE-01..05.** STRIDE complete for `POST /v1/notes/:id/move`; bearer/C4/C8/query-safety claims verified against real code (see evidence summary in commit message thread-back). Cleared for `frame-ship:execute-spec` (discharges ADR-0003 C1); all five conditions to be validated at `frame-ship:quality-gate`.
- [ ] **Engineering Owner (R1) — `general(vasquez)`:** required countersignature (owner of SC-MOVE-01..04 implementation).
- [ ] **Automation/Ops Owner (R8) — `general(espinoza)`:** required countersignature (CLI `move` repoint, ADR-0003 C3).
- [ ] **Legal/Privacy Owner (R4) — `general(subero)`:** consumed as-is (no new PII store; Ley 172-13 posture carried over).

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC + SPEC-001#REQ-BRAINY-ENG-06,AC-06,AC-12 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:architecture=Approved-with-conditions C1..C4 (C1 = R2 approval required before execute) / DOMAINS:R2,R1,R8,R4,R5`
