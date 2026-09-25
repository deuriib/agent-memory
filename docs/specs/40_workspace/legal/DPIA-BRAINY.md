# DPIA — Brainy v1 baseline (Ley 172-13)

**Spec:** `docs/specs/20_backlog/SPEC-005-brainy-legal.md` REQ-BRAINY-LEG-06 / AC-06 (§4.4 triggers, §4.3 controls)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 + AC-01..AC-09 + §4.1..§4.5 / HARD:subagents+max2lanes+no-secrets+alias1version+zero-code-edits / GATE:none-yet,security=Conditional-C1-C8 / DOMAINS:R4,R1,R2,R8,R5`
**Owner:** `general(subero)` (R4) · **Reviewer:** `general(barrera)` (R2, pending)
**Date:** 2026-09-25 · **Version:** `dpia-v1` · **Status:** `PASS-with-conditions` (conditions §8; full PASS only with `barrera` signature)
**Path decision (assumption A6):** the Brainy v1 DPIA baseline lives at this path, `docs/specs/40_workspace/legal/DPIA-BRAINY.md`. Later high-risk changes amend this file in place, never duplicate it. Scope note: this DPIA covers the new Brainy stores (`Note.content` + compat `Memory.statement`) and their widened surfaces; the pre-existing `Memory`/`Concept` posture (CONTRACT v1.4) is incorporated by reference, not re-assessed.
No raw PII and no secrets in this artifact — evidence by file+line refs and grep counts; content commitments as `[REDACTED]` / `sha256(content)`.

## 1. Purpose

Brainy is the active second brain (CODE/PARA on unified HelixDB): capture/organize/distill/express persistent knowledge for agents, ending session amnesia. Personal `segundo cerebro` purpose covers `Note{noteId,title,content,tags,project,embedding[1536],created_at,updated_at,status,paraType}` and compat `Memory.statement` (= `Memory.content`): capture → PARA organize → distill lineage → hybrid retrieval (vector 1536 + graph + BM25, RRF `1/(60+rank)`) → local markdown export. Single-tenant local deployment; legal basis consent + legitimate interest; caller-supplied `tags`/`concepts` verbatim = caller's responsibility (CONTRACT v1.4 posture, SPEC-005 §4.1). Text-only MVP: no images/audio (BRIEF Out-of-Scope).

## 2. Necessity and proportionality

Necessity: session amnesia forces agents to re-derive context every session (BRIEF-brainy §Problem); persistent, structured, retrievable memory is the stated product goal (OKR-brainy O1-O3). Each data element maps to a function: `content` (the knowledge itself), `title/tags` (routing + recall), `embedding[1536]` (semantic retrieval), `project` (tenant isolation), `created_at` (TTL), `status/paraType` (lifecycle). No element serves ads, secondary profiling, or campaign enrichment — any such repurposing needs fresh consent + a DPIA amendment.
Proportionality: minimization is structural, not promised. Capture allowlist (`hooks/capture.mjs:63-92`: fixed strings, tool NAME ≤80, path-smuggle → `null`, prompt never read); strict zod bounds (`title` 1..500, `content` 1..200k, `query` 1..10k, `project` 1..200, `limit` 1..100, unknown keys → 400 — `src/server.ts:38-44,179-194`); concepts bounded (`tags ≤64`, derived `extractConcepts` ≤8 or caller verbatim); logs carry allowlists only (method/path/status/duration; `memoryId`+`reason`+`at`; `logSafeNote` code-only — `src/server.ts:850`, `:704-706`, `src/errors.ts:62-73`); TTL 365 default declared (`BRAINY_TTL_DAYS`; wiring gap CDR-02 recorded, enforcement via `filterExpired` + `purge`); erasure via `forgetNote`/`forgetMemory`/`POST /memory/delete`/`DELETE /memory/todos/:id` + orphan Concept procedure. Bulk collection beyond `Note` + compat `Memory` is out of scope and would trigger re-assessment.

## 3. Triggers assessed (all 4 — each independently triggered this DPIA)

- (a) **Automated classifier embeddings + `RELATES_TO >0.85`.** `saveNote` embeds `content` (1536-dim, `src/store.ts:1714`), auto-classifies PARA when the caller omits a category (`:1706-1711`, classifier `:518-580` with keyword confidence up to 0.85-1.0), and auto-links notes with cosine similarity `>0.85` (`:1719-1731`, same-project candidates top-10, vector-unready → graceful skip). Inference about interests/projects/resources (e.g. probe-reidentified preferences such as strict-TypeScript/pnpm conventions) is created without per-inference consent; contest path is `brainy move` (CLI) / `moveNote` (store) — no REST rectification route exists (CDR-03).
- (b) **MCP cross-agent sharing incl. `tools/list` pre-auth discovery.** `brainy_search/capture/link/reality_check` + 17 compat `memory_*` aliases over stdio (`src/mcp.ts:235-566+`); the only gate is `_meta.authorization` (`src/mcp.ts:214-216`, `src/auth.ts:70-77`); tool-call auth failures throw `McpError InvalidRequest`, but store/validation failures surface as `isError` tool results rather than protocol rejections (`src/mcp.ts:192-194,217-222`). `tools/list` advertises tool shapes (schemas with `minLength`/`maxLength` kept advertised per `src/mcp.ts:94`) before any authorization — capability disclosure to unauthenticated local peers. Consumed by Claude/Cursor/Gemini CLIs: every tool result crossing that boundary is a cross-agent PII transfer gated solely by the bearer.
- (c) **Vector tenant `project` vs global `Concept.name`.** Retrieval is tenant-scoped (`where project` before vector/text search per SPEC-004 §4.3; link tenant check `src/server.ts:503-510`; dedup key folds project `src/store.ts:921`), but `Concept.name` is globally unique shared vocabulary (CONTRACT §1 index #3, TTL none intentional per CONTRACT v1.4) with per-memory drop unimplemented. Re-identification via shared vocabulary (a concept name surviving erasure while referenced by other rows) is the honest right-to-erasure boundary (SPEC-005 §4.2): derived ≤8 tokens accepted as non-PII (gate W-3), verbatim caller labels remain caller-responsible.
- (d) **Bulk export / `GET /v1/context/:project` graph traversal.** `GET /v1/context/:project` returns notes + memories + graph counts project-scoped (`src/server.ts:476-496`); hybrid search enriches rows with `graph_path` (`src/search.ts:277-302`); `brainy export` writes up to 100 notes' full content to local markdown (`0600`, frontmatter `project/tags`, no secret — `bin/brainy.mjs:1652-1691`). Over-share shape: one authenticated call materializes a large PII slice; vault push to remote is operator-responsible with no enforcement hook.

## 4. Risks to data subjects (mapped to SPEC-004 §4.1 S/T/R/I/D/E categories)

| # | Category (SPEC-004 §4.1) | Risk | Trigger | Severity pre-controls |
|---|---|---|---|---|
| R-1 | I — PII in logs / PII leak | `Note.content`/query/secret echoed into access/governance/MCP logs or evidence artifacts | a, b | High |
| R-2 | I — PII in query echo / `graph_path` over-share | Retrieval returns cross-project content or excessive graph context | c, d | High |
| R-3 | I — prompt/file content capture | Hook captures prompt text, file paths, or command output into the store | a | High |
| R-4 | I — active-memories exfil beyond project | `reality_check`/search/context cross tenant boundaries | b, c, d | High |
| R-5 | S — forged agent / stdio peer spoof | Spoofed caller captures or links under another tenant; unauthenticated local peer enumerates `tools/list` | b | Medium |
| R-6 | T — content injection → PARA misclassify | Crafted content skews classification/linking; edge spoof across tenants | a, b | Medium |
| R-7 | R — deny capture / deny link | Repudiation of destructive or linking actions | a, b | Low |
| R-8 | D — 200k×batch flood / unbounded traversal | Availability loss; deep graph walk / unbounded `vector_top_k` cost | a, d | Medium |
| R-9 | E — link across tenants | Privilege to join tenants via forged edges | b, c | Medium |
| R-10 | Transfer — unapproved cross-border | Embeddings/content leave adequate jurisdiction via provider region, S3 region, or vault push | d (+ §4.4) | High |
| R-11 | Inference — automated classification without contest | PARA label + `RELATES_TO` edges profile interests without per-inference consent | a | Medium |
| R-12 | Retention — TTL unenforced / orphan vocabulary | `Note` retained past declared 365 (CDR-02 wiring gap); `Concept.name` outlives erasure | c (+ AC-03) | Medium |

## 5. Controls (mapped to SPEC-005 §4.3 checkpoints)

| Risk | Control (code evidence) |
|---|---|
| R-1 | Access log allowlist (`src/server.ts:850`); governance line `memoryId+reason+at`, CWE-117 collapsed (`src/server.ts:58-69,704-706`; `src/mcp.ts:453`); `logSafeNote` remote→code-only (`src/errors.ts:62-73`); MCP stderr `oneLine` + stdout=protocol-only (`src/mcp.ts:220,734`); hooks zero-output (`hooks/capture.mjs:14-15,288-290`); evidence `[REDACTED]`/`sha256` rule; AC-09 scans (LEGAL_REVIEW §3) |
| R-2 | Scoped `where project` before search (SPEC-004 §4.3); link same-tenant check (`src/server.ts:503-510`); dedup key folds project (`src/store.ts:921`); bearer on all non-`livez` routes (`src/server.ts:368-373`) and every tool call (`src/mcp.ts:214-216`) |
| R-3 | Hook allowlist (`hooks/capture.mjs:63-92`); `UserPromptSubmit` never reads prompt (`:72`); `PreCompact` never reads payload (`:67`); path-smuggle → `null` (`:83`); basename opt-in OFF default (`:111-112`); `MAX_HOOK_BYTES` 1MiB (`:47`) |
| R-4 | Same as R-2 + `reality_check` project-scoped + bearer + allowlist (SPEC-004 §4.1 row) |
| R-5 | Bearer fail-closed both surfaces (`src/auth.ts:20-34,55-77`, timing-safe compare `:42-49`); single deprecation warning (`:27-30`); non-loopback+open boot warning (`src/server.ts:913-916`); boot flag never value (`:928-930`); `tools/list` discovery residual declared (DPIA-R2) |
| R-6 | Strict zod (`src/server.ts:38-44,179-194`, `.strict()` everywhere); MCP `inputSchema` mirrors REST; link enum (`src/server.ts:240`, `src/mcp.ts:180`); dedup FIFO + survivor locks (`src/store.ts:880-918`) |
| R-7 | Governance audit lines as non-repudiation record (`src/server.ts:704-706`, `src/mcp.ts:453`, `scripts/purge.ts:380-382` + `status=partial`) |
| R-8 | Bounds `content ≤200k`, body ≤1MiB → 413 (`src/server.ts:296-310`); `limit ≤100`, `max_depth ≤3`, `vector_top_k ≤20`; per-source catch → `signals`, never 500 (`src/search.ts:81-90,100-101,245-249`); purge `MAX_BATCHES` + no-progress guard (`scripts/purge.ts:285-322`) |
| R-9 | Link enum + tenant check (R-2 rows); MCP gate per call |
| R-10 | Default local-only (`helix.toml:10`, `src/server.ts:909-910`); cross-border allowlist `crossborder-v1` local-only (LEGAL_REVIEW §4); provider/S3/relay forbidden until allowlisted + DPIA PASS + consent + minimization; export local-only, push operator-gated |
| R-11 | Contest via `brainy move`/`moveNote` (CLI/store); explicit-tag override wins (`src/store.ts:525-537` tag check first); rectification route gap filed (CDR-03) |
| R-12 | `filterExpired` strict-`>` + unparseable-kept (`src/lifecycle.ts:113-137`) wired into bm25/hybrid/consolidation (`src/search.ts:106,307`, `src/store.ts:1000,1124`) + `signals` line; `purge.ts` bulk path; orphan 3-step procedure (SPEC-005 §4.2, CONTRACT v1.4); wiring gap filed (CDR-02) |

## 6. Residual risk (owner + expiry; accepted, never silent)

| ID | Residual | Owner | Expiry |
|---|---|---|---|
| DPIA-R1 | Live-harness evidence pending (hook proof, 400 matrix, TTL canary, purge line, ARCO flow, `s3cr3t` grep → 0) — controls verified statically only in the R4 lane | `vasquez` + `espinoza` (CDR-07) | Brainy v1 gate |
| DPIA-R2 | `tools/list` pre-auth discovery + `isError`-instead-of-protocol-rejection in `src/mcp.ts:192-194,217-222` — declared. **Flag to R2:** rule whether STRIDE expects transport-level (`McpError`) rejection for failed tool calls, or whether `isError` results are the accepted contract | `barrera` | 2026-12-31 or next MCP change |
| DPIA-R3 | Global `Concept.name` vocabulary outlives per-row erasure (honest boundary; derived tokens non-PII W-3) | `subero` (accepted) | 2026-12-31 or next high-risk change |
| DPIA-R4 | `GET /v1/context/:project` + export + `graph_path` bulk-share shape; vault remote-push operator-responsible without enforcement hook | `subero` + `barrera` | 2026-12-31 or next export/context change |
| DPIA-R5 | Cross-process single-writer out-of-contract (`src/store.ts:880-918` locks are same-process) | engineering (recorded in code) | P4.3 or 2026-12-31 |
| DPIA-R6 | CONTRACT Brainy v1 Note declaration + ARCO SLA home + R2 Incident §/cross-border table missing (CDR-01/05/06) | `subero` + `barrera` + `vasquez` | Brainy v1 gate |
| DPIA-R7 | Canonical `BRAINY_TTL_DAYS` unenforced on spawned path until CDR-02 lands; no per-note REST delete/rectify until CDR-03; capture kill-switch claim-vs-code until CDR-04 | `vasquez` + `espinoza` | Brainy v1 gate |

## 7. Mitigation list (committed)

M-1: AC-02/07/09 static verification complete this lane (LEGAL_REVIEW §2-§3); live harnesses transfer to R1/R8 (CDR-07). M-2: canonical-TTL wiring + note delete/rectify routes transfer to R1/R8 (CDR-02/03). M-3: CONTRACT declaration + SLA home transfer to R1/R5 (CDR-01). M-4: kill-switch claim resolved code-or-SPEC (CDR-04). M-5: R2 Incident § + cross-border table + drill transfer to R2 (CDR-05/06). M-6: allowlist `crossborder-v1` frozen local-only; any provider/region use needs prior `subero` written approval. M-7: this DPIA amends in place on every later high-risk trigger (register: LEGAL_REVIEW §4).

## 8. Verdict

**`PASS-with-conditions`** for Brainy v1 processing of `Note.content`/`Memory.statement` under the purpose, controls, and allowlist in §§1-2/5 and LEGAL_REVIEW §4, subject to:
1. `barrera` (R2) co-review signature on this DPIA (else status never advances past conditional).
2. CDR-01..06 resolved or waived in writing with remediation deadlines before gate CLOSE (CDR-07 live evidence likewise).
3. No `BRAINY_LLM_PROVIDER`-backed `distill`/embedding call and no new export/region/relay until allowlist v2 + transfer DPIA PASS + recorded consent.
4. `tools/list` + `isError` residuals (DPIA-R2) explicitly accepted or re-ruled by R2.
5. Any trigger re-occurrence (register LEGAL_REVIEW §4, esp. new inference, new sharing boundary, new export, new transfer) amends this DPIA before merge — FAIL blocks merge without it.

Sign-off: `Approved-by: general(subero) R4 — CONDITIONAL (2026-09-25)` · `Reviewed-by: general(barrera) R2 — pending`.
