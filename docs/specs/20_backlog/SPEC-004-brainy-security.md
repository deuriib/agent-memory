# Spec: Brainy Security — STRIDE + Bearer + Secrets + PII (Ley 172-13)

**ID:** SPEC-004-brainy-security
**Owner:** general(barrera) — Security Owner (R2)
**Domains-Touched:** security (R2, owner) · engineering (R1, interface — auth guard+store) · legal/privacy (R4, interface — Ley 172-13 DPIA/TTL) · automation/ops (R8, interface — env/CI scan) · marketing/brand (R5, interface — no secrets in examples/docs)
**Brief Reference:** docs/briefs/BRIEF-brainy.md#OKRs (approved 2026-09-25, architectural-initiative)
**OKR Reference:** docs/briefs/OKR-brainy.md (O3 KR3.1-3.2 §Gate links SECURITY_REVIEW; maps to NFR-BRAINY-ENG-04)
**PRD Reference:** ../brainy/docs/PRD.md §4-§11 (surfaces §5.2, §6, §8; NFR §10)
**Contract Reference:** docs/CONTRACT.md §0 frozen + docs/specs/10_design/ARCHITECTURE.md §7-§8 + SECURITY.md
**Status:** draft
**Priority:** P0
**Execution_Mode:** subagents (frozen at frame-intent; max 2 lanes INV-006 — this lane is R2)
**GATE:** none-yet
**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-brainy.md#OKRs / HARD:subagents+max2lanes+no-secrets+alias1version / GATE:none-yet / DOMAINS:R1,R5,R8,R2,R4`
**Skill:** `frame-ship:translate-to-spec` (`skills/translate-to-spec/SKILL.md` Process 0-7, `references/spec-template.md`)

## 1. Context

`agent-memory` secures REST (`src/server.ts:26-31,284-290` bearer guard on `/memory/*` except `/memory/livez`) and MCP stdio (`src/mcp.ts:162-183` `handle(_meta)` gate via `_meta.authorization`) with a single vault/env secret `AGENT_MEMORY_SECRET` (SECURITY.md Secrets policy: env only, `127.0.0.1` compensating control, `AGENT_MEMORY_HOST=0.0.0.0` removes it silently). Brainy adds new attack surfaces that reuse the same guard but widen data sensitivity: `POST /v1/notes` (capture with `Note.content` 1..200k), `POST /v1/search` (hybrid vector+graph+BM25 RRF), `GET /v1/context/:project` (graph traversal depth ≤2 + exports), `POST /v1/link` (edge creation), and MCP tools `brainy_search`/`brainy_capture`/`brainy_link`/`brainy_reality_check` (+ compat `memory_*` alias 1 versión) plus hooks `hooks/capture.mjs` (7 events, fire-and-forget). All carry PII `Note.content`/`Memory.statement` (BRIEF Constraints + NFR-BRAINY-ENG-04: propósito `segundo cerebro`, TTL `BRAINY_TTL_DAYS` default 365, borrado `forget`/`purge`).

This SPEC (R2, complement to SPEC-001 R1) freezes the STRIDE model, bearer contract (REST `Authorization` / MCP `_meta.authorization`, `livez` exempt, fail-closed 401, alias `BRAINY_SECRET` primary + `AGENT_MEMORY_SECRET` fallback + warning), no-secrets posture (vault/env only, scan pre-push, never in code/logs/examples/events/prompts/tickets/exports), and PII checkpoints (every port/adapter/event/log/prompt/export is a checkpoint — mask/tokenize, allowlist only, no raw PII in evidence). Evidence is allowlisted only. No freelance fixes — Critical/High surface same-session with severity+evidence+owner `barrera/subero`.

Base evidence (reference-only, never paste full context):
- `ARCHITECTURE.md §7` REST Brainy v1 table + §8 MCP contract (bearer except `livez`, `401 unauthorized` + `www-authenticate: Bearer`, alias 1 versión)
- `src/server.ts:284-290` guard + `src/auth.ts:15-55` `secretFromEnv`/`isBearerAuthorized`/`isMetaAuthorized` (timingSafeEqual) + `src/errors.ts:62-73` `logSafeNote` (remote → code only)
- `src/mcp.ts:162-183` `handle(name,_meta,op)` throws `McpError InvalidRequest unauthorized`
- `hooks/capture.mjs:18-35` zero-output guarantee, prompt text never read, `UserPromptSubmit` fixed string only
- `SPEC-001-brainy-engineering.md` REQ-12 + NFR-04

## 2. Requirements

### Functional — Bearer & Fail-Closed

- **REQ-BRAINY-SEC-01 — REST bearer guard fail-closed, livez exempt, alias 1 versión (O3, NFR-04, STRIDE S+I):** When `BRAINY_SECRET` (primary) or fallback `AGENT_MEMORY_SECRET` (single-line `WARN deprecated use BRAINY_SECRET` on stderr per ARCH §3) is non-empty, every `POST /v1/notes`, `POST /v1/search`, `GET /v1/context/:project`, `POST /v1/link`, `POST /v1/memory`, legacy `/memory/*` (except `/memory/livez` and `/v1/livez`) requires `Authorization: Bearer <secret>` (`src/auth.ts:33-41` constant-time `timingSafeEqual`, duplicate header → first value only, missing/wrong/length-mismatch → `401 {error:"unauthorized"}` + `www-authenticate: Bearer`). Unset/empty secret → open (dev posture) only on loopback `127.0.0.1`; combining open guard with non-loopback `BRAINY_HOST`/`AGENT_MEMORY_HOST=0.0.0.0` is a documented Critical misconfig that boot log must not hide (`auth: open` + host in log; SECURITY.md §Secrets). Env read via `secretFromEnv` extended to `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`. Evidence: `src/server.ts:284-290` diff + `src/auth.ts` unit + curl matrix.

- **REQ-BRAINY-SEC-02 — MCP bearer gate over _meta.authorization fail-closed (O3 KR3.1, STRIDE S+I):** Every MCP tool call (`brainy_search`, `brainy_capture`, `brainy_link`, `brainy_reality_check`, plus compat `memory_*` 11 tools) is gated by `isMetaAuthorized(_meta, secret)` (`src/auth.ts:48-55`, `src/mcp.ts:169-176`) — `_meta.authorization === "Bearer <secret>"` with same secret/alias as REQ-01; mismatch/missing/wrong type → `throw McpError(ErrorCode.InvalidRequest,"unauthorized")` without leaking store state or secret; `handle` is the ONLY auth boundary (no per-tool bypass). `livez` has no MCP equivalent (MCP `tools/list` is pre-auth discovery; auth enforced at `tools/call` only per MCP spec — document residual). Secret read path identical to REST; `AGENT_MEMORY_SECRET` fallback emits same warning. Evidence: `src/mcp.ts:162-183` + `src/auth.ts` + `InMemoryTransport` harness.

### Functional — No Secrets Posture

- **REQ-BRAINY-SEC-03 — No secrets in code/config/logs/examples/events/prompts/tickets/exports, vault/env only, scan pre-push (NFR-04, HARD no-secrets):** `BRAINY_SECRET` lives in vault/env only; never in `src/**`, `db/**`, `hooks/**`, `bin/**`, `helix.toml`, `README`, `docs/`, `examples`, `logs`, `events`, `prompts`, `tickets`, `chats`, or commits. Access log records `method path status duration` only (`src/server.ts:605-607`); governance delete log (`src/server.ts:463-465`, `src/mcp.ts:404-406`) logs `memoryId`+`reason` collapsed single-line (CWE-117) but never content or secret; `src/errors.ts:62-73` `logSafeNote` reduces remote diagnostics to `code` only (caller query not echoed in logs); MCP diagnostics go to stderr `oneLine` + heal lines only, stdout = protocol only (`src/mcp.ts:543`). `hooks/capture.mjs` zero-output guarantee upheld for Brainy (never prints secret, never logs prompt/hook payload). Examples use placeholder `BRAINY_SECRET=***` / `$BRAINY_SECRET`. Pre-push scan (`gitleaks` or `grep -R BRAINY_SECRET|AGENT_MEMORY_SECRET` + `trufflehog` where available) blocks on any literal secret value. Evidence: `grep -R "BRAINY_SECRET" --exclude-dir=.helix --exclude-dir=node_modules` shows alias read + placeholder only + scan CI log 0 findings.

### Functional — STRIDE Model for Brainy Surfaces

- **REQ-BRAINY-SEC-04 — STRIDE threat model for new Brainy surfaces, controls + residual (GATE R2):** Model every new surface: `POST /v1/notes` (create Note + BELONGS_TO + embeddings), `POST /v1/search` (hybrid RRF), `GET /v1/context/:project` (graph traversal + export precursor), `POST /v1/link` (edge creation), MCP `brainy_search`/`brainy_capture`/`brainy_link`/`brainy_reality_check`, and `hooks/capture.mjs` events (`SessionStart…UserPromptSubmit`). Produce STRIDE table (§4.1) with per-surface threats S/T/R/I/D/E + controls (zod strict, bearer, allowlist logs, scoped search `where project` before `vectorSearchWith`/`textSearchWith`, dedup lock, single-writer) + residual risk explicit + owner. No silent PASS. Cross-domain triggers: new boundary/dependency/secret handling → `barrera` review before merge; PII store/export/cross-border → `subero` + DPIA if high-risk (ARCH NFR Security). Evidence: `SECURITY_REVIEW.md` (§4.1 table) + this SPEC.

### Functional — PII Checkpoints & Ley 172-13

- **REQ-BRAINY-SEC-05 — PII checkpoints allowlist-only + Ley 172-13 store declaration (NFR-04, BRIEF Constraints):** Every port, adapter, event, log, prompt, export, form, campaign, invoice that touches `Note.content` or `Memory.statement` is a PII checkpoint. Controls: (a) Store declaration — purpose `segundo cerebro CODE/PARA`, TTL `BRAINY_TTL_DAYS` default 365, deletion `forget`/`purge`/`DELETE /memory/todos/:id` enforced; `ARCHITECTURE.md` NFR Security + this SPEC §4.3 declare it. (b) Allowlist-only in logs/exports/prompts/evidence: access log `method/path/status/duration` only; governance log `memoryId`+`reason` collapsed, never content/secret; `hooks/capture.mjs:18-35` fixed strings for `SessionStart/Stop/PreCompact/SessionEnd`, `UserPromptSubmit` never reads `hook.prompt` (PII), tool events carry tool NAME only (≤80 chars, reject `/`/`\`); `brainy export --format markdown` frontmatter uses `project/tags` + `[[links]]`, never raw secret. (c) Data subject rights, cross-border only to approved jurisdiction, DPIA for high-risk processing, breach notification 72h (escalation path to `subero`/`barrera`). (d) No raw PII in evidence: PASS requires allowlisted evidence only; repro logs mask/tokenize `Note.content` with `[REDACTED]` or `sha256(content)` commitment. Evidence: `src/errors.ts:62-73` + `hooks/capture.mjs:63-92` + export fixture allowlist + `SECURITY_REVIEW.md` PII §.

### Functional — Boundaries & DoS

- **REQ-BRAINY-SEC-06 — Validation, DoS bounds, and Helix failure containment (STRIDE D+I):** All Brainy inputs start `unknown` then `zod` strict: `Note.title 1..500`, `Note.content 1..200k`, `query 1..10k`, `limit 1..100`, `max_depth 1..3`, `vector_top_k 1..20`, `project 1..200`, `tags string[64] 1..200`, `type enum REFERENCES|BELONGS_TO|RELATES_TO`; body `1 MiB` cap → `413`, non-JSON → `400`, wrong `content-type` → `415`, strict unknown keys → `400 invalid_request` with details (never secret). MCP inputSchema mirrors REST bounds (shared constants). `hooks/capture.mjs` `MAX_HOOK_BYTES 1MiB`, stdin JSON parse fail → exit 0, tool name with `/`/`\` → store nothing. Single-writer `dedupKey sha256(project+normalize(content))` + `survivorTails` FIFO lock prevents write race on `Note`. Hybrid search never `500` on Helix down — per-source catch + `signals` degraded. Re-embeddings batched `forEachParam empty` safe per CONTRACT §0. Evidence: `src/server.ts` schemas + `src/mcp.ts` inputSchema + `hooks/capture.mjs:38-130` + `src/search.ts` signals.

## 3. Acceptance Criteria

- [ ] **AC-01 — Auth matrix REST livez exempt + wrong bearer 401:** With `BRAINY_SECRET=s3cr3t` (and repeat with alias `AGENT_MEMORY_SECRET=s3cr3t` + warning on stderr), table executes: `GET /v1/livez` without bearer → `200 {status:"ok"}`; `GET /memory/livez` without bearer → `200`; `POST /v1/notes {title,content}` without bearer → `401 {error:"unauthorized"}` + `www-authenticate: Bearer`; with `Authorization: Bearer wrong` → `401`; with correct bearer → `201`; duplicate `Authorization: Bearer good, Bearer bad` → first wins (good→201). Unset secret → all routes `200/201` on `127.0.0.1` (open documented), `auth: open` in boot log. No bearer value appears in logs. Evidence: `scripts/verify-auth-matrix.ts` or curl harness log + boot log snippet redact secret flag only.

- [ ] **AC-02 — Auth matrix MCP _meta.authorization + livez boundary:** With same secrets, `InMemoryTransport` harness: `mcp.call("brainy_search",{query:"x"}, {_meta:{}})` without auth → `McpError InvalidRequest unauthorized`; with `_meta:{authorization:"Bearer wrong"}` → same; with `_meta:{authorization:"Bearer s3cr3t"}` → `ok` (hybrid result). Same for `brainy_capture`/`brainy_link`/`brainy_reality_check` and compat `memory_search`. `tools/list` succeeds without auth (discovery). No secret in `logSafeNote` stderr. Evidence: `src/mcp.test.ts` or `scripts/verify-mcp-auth.ts` log.

- [ ] **AC-03 — Secret never logged/echoed + access log allowlist:** Start server with `BRAINY_SECRET`, issue `POST /v1/notes`, `POST /v1/search`, `POST /v1/link`, `GET /v1/context/:project`, governance `POST /memory/delete {memoryId,reason}` (success). Grep entire log capture (`stdout+stderr`) for literal secret value → `0` hits; boot log shows `auth: bearer-required` not value; access lines match `METHOD PATH STATUS DURATIONms` only (no bodies/headers/query/secret); governance line is `memoryId=… reason=… at=…` single-line, collapsed, never content/secret; MCP `logSafeNote` for Helix `Remote` is `HelixError:remote:<code>` only. Evidence: `grep -c "s3cr3t" server.log →0` + log fixture.

- [ ] **AC-04 — Scan pre-push 0 findings + grep hygiene + placeholder contract:** `gitleaks detect --no-git -v` (or `grep -R "BRAINY_SECRET.*=.*[^*$\"]" README.md docs/ examples/` heuristic) → `0` findings; `grep -R "BRAINY_SECRET\|AGENT_MEMORY_SECRET" --exclude-dir=.helix --exclude-dir=node_modules` shows only (a) alias read `BRAINY_SECRET ?? AGENT_MEMORY_SECRET` in `src/auth.ts|server.ts|mcp.ts|bin/brainy.mjs` with deprecation warning line, (b) placeholder `BRAINY_SECRET=***` or `$BRAINY_SECRET` in docs/examples. No literal secret in `hooks/capture.mjs`, `plugins/*`, `mcp_config.json`, `opencode.json`. Evidence: scan CI log + `grep -n` allowlist.

- [ ] **AC-05 — STRIDE model delivered + Critical/High surfaced:** `SECURITY_REVIEW.md` contains §4.1 STRIDE table with ≥6 rows (the 4 REST + 4 MCP + hooks) each with S/T/R/I/D/E verdict + control + residual; at least one `High` residual (e.g., open guard on `0.0.0.0` misconfig) is surfaced same-session with severity+evidence+owner `barrera`; `barrera` sign-off line present. Evidence: `SECURITY_REVIEW.md` diff + review thread.

- [ ] **AC-06 — PII checkpoints + store declaration + no raw PII in evidence:** `Note.content`/`Memory.statement` purpose/TTL/deletion declared in this SPEC §4.3 and `ARCHITECTURE.md` NFR Security; `hooks/capture.mjs` `UserPromptSubmit` test proves `hook.prompt.text` never touches `observationFor` (fixed string only); tool event with `tool_name="/etc/passwd"` via MCP or hook → stored `null` (path rejected); `brainy export --format markdown` fixture contains allowlisted `project/tags/[[links]]` not raw secret; every evidence artifact in `quality-gate` for PII uses `[REDACTED]` or `sha256` not raw content. Evidence: `hooks/capture.mjs:63-84` test + export fixture + evidence checklist.

- [ ] **AC-07 — Validation & DoS bounds + Helix-down never 500:** Fuzz matrix: `POST /v1/notes {content:""}` → `400`; `content 200001 chars` → `400`; missing `content-type` → `415`; body `>1MiB` → `413`; `POST /v1/search {query:""}` → `400`; `POST /v1/link {type:"UNKNOWN"}` → `400`; MCP `brainy_capture {content:""}` → validation error (not `internal_error`). With Helix stub throwing `HelixError Remote`, `POST /v1/search` → `200 {results:[], signals:["remote: …"]}` not `500`; `brainy_search` MCP → `ok {results:[], signals}` not crash. `hooks/capture.mjs` with malformed stdin → `exit 0` no output. Evidence: `scripts/verify-bounds.ts` harness log.

## 4. Contracts & Interfaces

### 4.1 STRIDE — Brainy surfaces (controls reference §7-§8)

| Surface | S Spoofing | T Tampering | R Repudiation | I Information Disclosure | D Denial of Service | E Elevation of Privilege | Controls | Residual |
|---|---|---|---|---|---|---|---|---|
| `POST /v1/notes` | forged Agent | content injection → PARA misclassify | deny capture | PII `Note.content` in logs/PII leak | 200k×batch flood, 1MiB×N | — | bearer fail-closed, zod 1..500/1..200k strict, dedup lock, `logSafeNote` code-only, allowlist logs | Medium — open guard on `127.0.0.1` by default requires operator to set `BRAINY_SECRET` before exposing (owner `barrera`) |
| `POST /v1/search` | — | RRF rank manipulation via crafted query | — | PII in query echo / `graph_path` over-share | unbounded `vector_top_k`/`max_depth` | — | bounds `1..10k`/`1..20`/`1..3`/`1..100`, scoped `where project` before search, per-source catch→`signals` never 500 | Low |
| `GET /v1/context/:project` | project enumeration | traversal depth abuse | — | export exfil cross-project | deep graph walk | — | `project` 1..200, `max_depth≤2` export, bearer project tenant | Low |
| `POST /v1/link` | edge spoof cross-project | id reuse, type inject | deny link | — | batch link flood | privilege to link across tenants | strict `type` enum, `fromId/toId` 1..200, bearer tenant | Low |
| MCP `brainy_capture` | stdio peer spoof via `_meta` | content inject | — | same PII as notes | same 200k | — | `handle(_meta)` fail-closed, same zod, no stdout leak, `logSafeNote` | Same as notes |
| MCP `brainy_search` | — | — | — | query leak in stderr signal | same as REST search | — | bound inputSchema, `failureSignal` in `signals` caller-facing only, logs keep code | Low |
| MCP `brainy_link` | — | forged edge | deny link | — | — | — | enum + handle gate | Low |
| MCP `brainy_reality_check` | — | rules injection | — | active memories exfil beyond project | — | — | project-scoped, bearer + allowlist | Low |
| `hooks/capture.mjs` (7 events) | N/A (local) | `tool_name` with `/` → path smuggle | no audit if silently dropped | prompt/file content capture | `MAX_HOOK_BYTES 1MiB`, malformed JSON | — | fixed strings except tool NAME ≤80, `/`/`\` reject→null, `UserPromptSubmit` never read prompt, exit 0, timeout 1.5-2s | Low — residual is heuristic TODO→todo auto-extract may store sanitized titles from long bodies (allowlist titles ≤120) |

Precedence: `S/I` bearer > `I` PII allowlist > `D` bounds. New boundary/dependency/secret handling → `barrera` review before merge (Cross-Domain Interface). New PII store/export/cross-border → `subero` + DPIA if high-risk.

### 4.2 Bearer derivation & fail-closed matrix (reference-only, cites §7-§8)

```
secret = nonEmpty(BRAINY_SECRET) ?? nonEmpty(AGENT_MEMORY_SECRET) // second emits WARN deprecated
if secret === undefined → guard disarmed (open) // allowed only on 127.0.0.1
else
  REST: isBearerAuthorized(req.headers.authorization, secret) // src/auth.ts timingSafeEqual
        path === "/memory/livez" || path === "/v1/livez" → exempt
        else mismatch → 401 {error:"unauthorized"} + www-authenticate: Bearer
  MCP:  isMetaAuthorized(extra._meta, secret) // _meta.authorization
        tools/list → exempt (discovery); tools/call → fail-closed McpError InvalidRequest
        stdout never carries auth diagnostics; stderr logSafeNote only
```

Env slots: `BRAINY_SECRET` (canonical), `AGENT_MEMORY_SECRET` (alias 1 versión), `BRAINY_HOST`/`AGENT_MEMORY_HOST` (host), `BRAINY_PORT`/`AGENT_MEMORY_PORT` (port). State file never stores secret (ARCH §4 INV-004).

### 4.3 PII checkpoints — store declaration & allowlist (Ley 172-13)

| Store field | Purpose | Legal basis | TTL | Deletion | Checkpoint locations |
|---|---|---|---|---|---|
| `Note.content` | segundo cerebro CODE/PARA — persistent knowledge for agents | consent + legitimate interest (single-tenant local) | `BRAINY_TTL_DAYS` default 365 (`AGENT_MEMORY_TTL_DAYS` alias) | `POST /memory/forget` / `POST /memory/delete {memoryId,reason}` / `DELETE /memory/todos/:id` / `purge` | `src/server.ts` POST /v1/notes, `src/store.ts saveNote`, `hooks/capture.mjs observationFor`, `plugins/*/capture.mjs`, `brainy export`, `src/search.ts` graph_path, `src/errors.ts` logs |
| `Memory.statement` (compat) | same | same | same | same | `src/server.ts POST /v1/memory`, `src/mcp.ts memory_save` |

Checkpoint rule: every `port` (REST/MCP), `adapter` (HelixStore), `event` (hook 7 events), `log` (access/governance/MCP stderr), `prompt` (`reality_check`), `export` (`brainy export`), `form/campaign/invoice` (future R5/R7) → mask/tokenize `Note.content`/`Memory.statement` with allowlist (`method/path/status/duration`, `memoryId` `reason` collapsed, `title≤500` todo allowlist). Evidence artifacts use `[REDACTED]` or `sha256(content)` only — raw PII never in `SECURITY_REVIEW.md`/`quality-gate` evidence.

### 4.4 No-secrets contract

```
Allowed: process.env["BRAINY_SECRET"] ?? process.env["AGENT_MEMORY_SECRET"]  // read only
Forbidden: any literal secret value in repo, any console.log(secret), any header echo,
           any error.details containing secret, any example with real value
Verified: gitleaks/trufflehog pre-push + grep placeholder contract + logSafeNote remote-code-only
```

## 5. Out of Scope

- Finance pricing, unit economics, budgets, tax (R3); headcount/payroll/governance mediation (R6); deal structuring/revenue recognition (R7) — no budget/headcount impact in MVP (BRIEF Stakeholders R6/R7/R3 Informed only).
- Brand copy/positioning/README rewrite beyond placeholder hygiene (R5 — SPEC-002 owns `brainy` rename + positioning).
- HelixQL schema/CODE flows/embeddings/RRF ranking/CLI `bin/brainy` slots (R1 — SPEC-001 owns; R2 only reviews their auth/PII boundaries).
- Multi-writer, docker-compose/k8s, npm publish, viewer UI / session replay / 54-tool MCP full (BRIEF Out of Scope; P4.3 separate).
- DPIA full text / cross-border adequacy decision (R4 — `subero` owns; R2 consumes its verdict and blocks on missing DPIA for high-risk).
- Key rotation schedule beyond "revoke+restart" (SECURITY.md — operator-owned).

## 6. Dependencies

- **Upstream:** `docs/briefs/BRIEF-brainy.md` + `docs/briefs/OKR-brainy.md` O3; `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` NFR-04; `docs/specs/10_design/ARCHITECTURE.md §7-§8` (frozen bearer/exempt tables); `SECURITY.md` Secrets policy.
- **Parallel lanes:** `SPEC-002-brainy-brand` (R5) — shares `BRAINY_SECRET` placeholder contract; `SPEC-001` (R1) — `src/server.ts`/`src/mcp.ts`/`src/auth.ts`/`src/errors.ts`/`hooks/capture.mjs` implementation; `SPEC-brainy-ops` (R8) — `bin/brainy` env passthrough + CI `gitleaks` gate.
- **External:** `@modelcontextprotocol/sdk` `McpError`, `zod`, `node:crypto timingSafeEqual`, `@helix-db/helix-db HelixError`, `gitleaks` (CI).
- **Downstream:** `frame-ship:propose-changes` (PROPOSED_CHANGES.md diff `src/auth.ts` alias + `src/server.ts` guard + `src/mcp.ts` handle) → `review-security`/`review-architecture` (required: `barrera` STRIDE verdict + `subero` DPIA check) → `execute-spec` (max 2 lanes) → `quality-gate` (this SPEC's AC as gate evidence) → `verify-handoff`/`ship-release`.
- **Sign-offs:** Security Owner `barrera` (STRIDE PASS/FAIL per §4.1), Legal Owner `subero` (PII store TTL + DPIA gate).

## 7. Traceability

| Requirement | Acceptance Criterion | OKR | Proposed Change | Evidence |
|---|---|---|---|---|
| REQ-BRAINY-SEC-01 | AC-01, AC-03, AC-04 | O3 KR3.2 + NFR-04 | `src/server.ts:284-290` guard + `src/auth.ts:15-55` alias | curl matrix livez exempt + wrong bearer 401 + boot log + grep placeholder |
| REQ-BRAINY-SEC-02 | AC-02, AC-03 | O3 KR3.1 + NFR-04 | `src/mcp.ts:162-183` handle + `src/auth.ts:48-55` | `InMemoryTransport` harness unauthorized + tools/list discovery |
| REQ-BRAINY-SEC-03 | AC-03, AC-04 | NFR-04 | `src/server.ts:463-465,605-607` + `src/mcp.ts:404-406,543` + `src/errors.ts:62-73` + `hooks/capture.mjs` | `grep secret 0` + gitleaks 0 + access/governance log fixtures |
| REQ-BRAINY-SEC-04 | AC-05 | O3 Gate | `SECURITY_REVIEW.md §4.1 STRIDE` | table + `barrera` sign-off + residual High `0.0.0.0+open` |
| REQ-BRAINY-SEC-05 | AC-06, AC-03 | NFR-04 + Ley 172-13 | `hooks/capture.mjs:18-92` + `brainy export` allowlist + TTL store doc | fixed-string proof + export fixture + `[REDACTED]` checklist |
| REQ-BRAINY-SEC-06 | AC-07, AC-01 | O3 KR3.1-3.2 | `src/server.ts` zod 1..200k/1..10k + `hooks/capture.mjs:38-48` MAX | bounds fuzz log + Helix-down 200 signals + hook exit 0 |

**Handoff packet (next stage):** `SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC-01..06 / HARD:subagents+max2lanes+no-secrets+alias1version / GATE:none-yet / DOMAINS:R1,R5,R8,R2,R4` → `frame-ship:propose-changes` (PROPOSED_CHANGES.md, untouched repo) → `review-security` (`barrera` STRIDE + `subero` DPIA) / `review-architecture` → `execute-spec` (max 2 lanes) → `quality-gate`.

**Assumptions.**
1. `BRAINY_SECRET` alias `AGENT_MEMORY_SECRET` with single deprecation warning per derivation (ARCH §3) — `secretFromEnv` will be extended to read `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`.
2. `livez` exemption is `path === "/memory/livez" || path === "/v1/livez"` inclusive of versioned alias; no other path exempt.
3. MCP `tools/list` is intentionally unauthenticated (discovery) — `tools/call` is gated; residual documented in §4.2.
4. Scan harness is `gitleaks` preferred, `grep` fallback allowed in constrained sandboxes where Docker unavailable.

**Risks.**
- **High — open guard on non-loopback:** `BRAINY_SECRET` unset + `BRAINY_HOST=0.0.0.0` exposes unauthenticated `POST /v1/notes|search|link` on every interface; boot log `auth: open` + host mitigates but requires operator discipline. Owner `barrera`, mitigated by AC-01 + docs warning.
- **Medium — PII in evidence:** reviewer may paste `Note.content` in `SECURITY_REVIEW.md`; escapes via `logSafeNote` + checklist + `[REDACTED]` rule.
- **Medium — Helix down information leak:** `failureSignal` echoes short remote message to caller (by design caller-facing); logs keep code only — split `failureSignal` vs `logSafeNote` prevents log exfil.

**Evidence (allowlisted only).**
- `src/server.ts:284-290` bearer guard + `src/auth.ts:15-55` + `src/mcp.ts:162-183` handle + `src/errors.ts:62-73` + `hooks/capture.mjs:18-92` diffs
- `ARCHITECTURE.md §7` REST table + `§8` MCP contract snapshot
- `scripts/verify-auth-matrix.ts` + `scripts/verify-mcp-auth.ts` harness logs (no secret values)
- `gitleaks` / `grep` scan log `0 findings`
- `SECURITY_REVIEW.md` STRIDE §4.1 + `barrera` sign-off
- Export fixture `vault/<Project>/<title>.md` allowlist sample (placeholder content)

**Skill path:** `frame-ship:translate-to-spec` Process 0-7 (subagents only, reference-only packet, full-wave).
