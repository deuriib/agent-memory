# Security Review: Brainy v1 Post-Implementation Gate

**Reviewer:** security-reviewer (independent gate auditor; did not write the code under review)
**Date:** 2026-09-25
**Verdict:** pass
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD`
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-004-brainy-security.md#REQ-BRAINY-SEC-01..06 / HARD:subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+never-kill-3111/3112/3113+evidence-allowlist / GATE:pending / DOMAINS:R2,R1,R4,R5,R8`
**Role/checklist/template:** `prompts/security-reviewer.md` + `skills/quality-gate/references/domains/security-review.md` + `skills/quality-gate/references/gate-report.md` (all read before acting)
**Pre-implementation baseline:** `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` (Lane 4 `Conditional C1–C8` + move-route delta `Approved with conditions SC-MOVE-01..05`)

**Checklist**

- [x] Threat model complete (STRIDE) — inherited from Lane 4 review + SC-MOVE delta §2; no new surface in this gate
- [x] AuthN/AuthZ verified — C1 + SC-MOVE-01 below
- [x] Input validation at all boundaries — C4 + SC-MOVE-02 below
- [x] Secrets not in code — C2 + SC-MOVE-05 below (gitleaks `not-installed`, grep fallback)
- [x] Dependencies scanned — n/a (zero new deps per HARD; `package.json` unchanged by Brainy lanes)
- [x] Data handling compliant (PII, retention, Ley 172-13) — C5 below, CONTRACT v1.8 record-text confirmed
- [x] Audit logging in place — governance line on `POST /memory/delete` confirmed; `POST /memory/forget` audit-silent by declared boundary (S-LEG-001)

## 1. C1–C8 proof table (condition → control → file:line → evidence → status)

| Cond | Control | File:line | Evidence | Status |
|------|---------|-----------|----------|--------|
| C1 bearer parity + timingSafeEqual + alias fallback + livez-only exempt + non-loopback WARN | `secretFromEnv` reads `BRAINY_SECRET` first, falls back to `AGENT_MEMORY_SECRET` with single static deprecation notice; `bearerMatches` = `timingSafeEqual` over SHA-256 digests; guard before all routes, livez-only exempt; boot warns on non-loopback + unset secret | `src/auth.ts:20-34,42-49,55-77`; `src/server.ts:375-381,979-982,992-996` | Read: alias + constant-time + `isLivez` exempt + `WARN INSECURE ... non-loopback host ... with authentication disabled`. `npm run typecheck` clean | PASS |
| C2 placeholder hygiene, no literal secrets | Grep for literal secret assignments → zero hits; `which gitleaks` → not-installed; SPEC-004 assumption 4 allows grep fallback | grep `BRAINY_SECRET\s*=\s*[^*$\"']` over `src bin hooks db scripts README.md docs examples` → `SECRET-GREP-DONE`, 0 findings | PASS via fallback (see §3 secret-hygiene ruling) |
| C3 doctor credential isolation, C1→C3→C2→C4→C5 ordering, foreign listener 0 Authorization | `cmdDoctor` runs C1 → C3 → C2 → C4 → C5; C2 gated on `restOwned` (state PID + `verifyOwnedPid` + port-probe PID match); foreign/unresolved → `INFO ... NO request sent, no bearer transmitted`, Authorization header only constructed inside the owned branch | `bin/brainy.mjs:1354-1360,1379-1481`; `scripts/verify-ops.ts:318,332-337` (headerProof: 0 Authorization headers; 0 requests ideal) | PASS (code ordering verified by read; live headerProof harness exists in `verify-ops.ts` §C1, not re-executed in this gate — no helix start per HARD) |
| C4 zod strict + 1 MiB / 200k / 10k / 15s caps | All bodies `.strict()`; `MAX_BODY_BYTES = 1_048_576` → 413; `content-type` → 415; `Note.content 1..200k`, `title 1..500`, `query 1..10k`, `limit 1..100`, `max_depth 1..3`, `vector_top_k 1..20`; `QUERY_TIMEOUT_MS = 15_000` via `withTimeout` | `src/server.ts:32,38-44,178-258,304-326`; `src/store.ts:86,785,853` | PASS |
| C5 PII minimization + hook fixed-string + forget/forgetMemory | `UserPromptSubmit` → fixed `"user prompt submitted"`, `hook.prompt` never read; tool events carry tool NAME ≤80 with `/` `\` rejection; `forgetNote`/`forgetMemory` + `POST /memory/forget` + `POST /memory/delete` + `purge` + `DELETE /memory/todos/:id` declared; CONTRACT v1.8 records Note PII declaration + ARCO SLA + erasure boundary | `hooks/capture.mjs:63-92,72`; `src/store.ts:476,495,1521,1950-1956`; `docs/CONTRACT.md:19-25` | PASS |
| C6 never-kill 3111/3112/3113 + verifyOwnedPid | `NEVER_BIND` includes 3111/3112/3113; `stop` verifies `verifyOwnedPid` before SIGTERM and re-verifies before SIGKILL (C10); upstream occupancy is report-only; `portInUseHint` reroutes to 3151 | `bin/brainy.mjs:76,154,627,1237-1248,1435`; `src/server.ts:952-972` | PASS |
| C7 0700/0600 + closed schemas | State dir `mkdir 0o700` + `chmod 0o700`; state file + audit log + log FD `0o600` + `chmod`; state read via closed-schema validation | `bin/brainy.mjs:479-481,533-535,556-558,1083-1084` | PASS |
| C8 defineParams typed binding + same-tenant edge check | All Helix queries via `defineParams` + `toQueryRequest` + `PropertyInput.param`/`eqParam`; `POST /v1/link` verifies both nodes same tenant → `400 invalid_tenant_link`; `POST /v1/notes/:id/move` mirrors with scoped-lookup + cross-tenant 400 + zero writes | `src/store.ts:135-181`; `src/server.ts:565-596,438-451`; `tests/move.test.ts:276` | PASS |

## 2. SC-MOVE-01..05 table (ADR-0003 move route)

`POST /v1/notes/:id/move` exists: `src/server.ts:427-483` (handler, placed before generic `GET /v1/notes/:id`), `tests/move.test.ts` (8 tests), CLI repointed in `201b1ee` (`bin/brainy.mjs:1629-1653` → `POST /v1/notes/:id/move`, "no dedicated move route" workaround comment removed/replaced).

| Cond | Requirement | File:line | Evidence | Status |
|------|-------------|-----------|----------|--------|
| SC-MOVE-01 bearer reuse | Handler below guard, dual bearer, livez-only exempt, 401 + `www-authenticate: Bearer` | `src/server.ts:375-381,429-432`; `tests/move.test.ts:240` | Test `move route: bearer guard — 401 without/wrong bearer, 200 with correct bearer` PASS (`npx tsx --test tests/move.test.ts`: 8 pass, 0 fail) | MET |
| SC-MOVE-02 strict input + body caps | `.strict()` closed enum `to` + `name` 1..500 + optional `project`; via `parseOr400` over `readJsonBody` (1 MiB/413) | `src/server.ts:252-258,432` | Strict-body probes in `tests/move.test.ts` (8/8 pass) | MET |
| SC-MOVE-03 same-tenant before any write | Scoped `getNoteById(id, project)` miss + other-tenant hit → `400 invalid_tenant_link`, zero writes; store error mapped | `src/server.ts:438-470`; `tests/move.test.ts:276` | Test `400 invalid_tenant_link cross-tenant with zero writes` PASS | MET |
| SC-MOVE-04 query safety | Delegates to approved `HelixStore.moveNote` → `moveNote` query; zero new HelixQL | `src/server.ts:452-459` → `src/store.ts:moveNote`; `db/queries.ts:moveNote` (`defineParams`/`eqParam` only) | PASS (no new query constructor in `src/server.ts` move block) |
| SC-MOVE-05 secrets/PII hygiene | Tests/docs use placeholders (`<note-id>`, `<area-name>` pattern); secret grep 0 findings | `tests/move.test.ts` (placeholder ids `note-1`); §1 C2 grep | MET |

## 3. Rulings on routed items

### COND-RD-003 / RK-013 — hook header comment vs `extractTodos`/`collectBody` (`hooks/capture.mjs:236-286`)

**Ruling: accepted-residual (not a blocker). Owner: `vasquez` + `espinoza`.**

Proof of the actual write path (read, not assumed):

- `collectBody` output is **never posted directly**. Its only consumer is `extractTodos` (`hooks/capture.mjs:239`), which gates on `body.length >= 400`, splits into lines `12..200` chars, keeps at most 5 heuristic hits (`TODO|FIXME|...` → medium, `should|need to|...` → low), dedups, and the caller posts at most 3 with `signal: AbortSignal.timeout(1500)` (`:225-231`).
- Every posted title passes `clean(line.slice(0,120), 120)` (`:246,248`) — control chars → space, whitespace collapsed, 120-char cap. Every posted description is the fixed string `"auto-extracted from session"` (`:246,248`), never body text.
- The other write path (`observationFor`, `:179-206`) posts fixed strings / tool NAME ≤80 (`:63-92,72`), never `hook.prompt` text.

So: captured payloads are **read** but do not reach storage/logs/export verbatim — only sanitized ≤120-char heuristic titles + fixed descriptions. The header comment ("payloads never captured") is imprecise wording, but the PII posture holds: no raw prompt/secret egress. This matches the pre-implementation accepted residual S-004-006 / S-020-001 pattern. Optional non-blocking hardening (owner `vasquez`): tighten the comment wording and/or add a `secret|token|authorization` key-skip in the `JSON.stringify` fallback. No gate condition.

### S-LEG-001 — `POST /memory/forget` without governance line

**Ruling: CONFIRM the accepted residual. Owner: `barrera` + `subero`.**

The expiry condition is MET: `docs/CONTRACT.md:25` (v1.8 amendment, CDR-03-C1) states verbatim that ARCO erasures are served via the governed path (`POST /memory/delete {memoryId,reason}` with governance line + receipt, or `scripts/purge.ts`), and that `POST /memory/forget` (`src/server.ts:690-700`, no log line vs `:770-773` governance line on delete) is a compat path not sufficient for SLA-bound erasure evidence. No code change required; the boundary record is the control. Stays Medium accepted-residual, no gate block.

### S-LEG-002 — provider-region allowlist unpopulated

**Ruling: CONFIRM, scoped to provider-backed use only. Owner: `subero` (allowlist) + `barrera` (DPIA co-sign).**

The block is scoped by construction: `src/embed.ts:114-142` (`embedWithProvider`) only touches a remote endpoint when `BRAINY_EMBEDDING_PROVIDER=openai` **and** `OPENAI_API_KEY` is set; the default path is the deterministic keyless local embedder (`embed`, no network, no key). No `BRAINY_LLM_PROVIDER` remote-distill call site ships in `src/` (local-only default). Therefore the unpopulated `crossborder-v1` allowlist blocks **provider-backed embedding/distill use only** — local Brainy v1 operation is unaffected and is correctly classified NOT-a-transfer. Gate stays open for local use; any provider-backed use before allowlist + DPIA PASS + `subero` written approval → `GATE: CLOSED`.

### RL-001 quiet-failure (`GET /v1/context/:project` → `memories=[]`, `src/server.ts:549-553`)

**Ruling: no security/privacy angle beyond the reliability finding. Owner: reliability reviewer.**

The `catch { memories = [] }` swallows a `searchByText` failure and returns a degraded-but-honest envelope (counts reflect the degradation). No secret, token, PII, or error text crosses the boundary in either direction — the failure signal is the *absence* of rows, and the access log records method/path/status/duration only. At most an availability/observability note (consider a `signals` entry per the hybrid-search pattern); no STRIDE category fires. Defer to the reliability verdict; no security finding filed.

### Secret hygiene — gitleaks not-installed

**Status: `gitleaks` = not-installed (stated honestly; no scan claimed). Ruling: C2 PASS via the allowed grep fallback for this gate.**

SPEC-004 §Assumption 4 permits a `grep` fallback where Docker/tooling is unavailable. The fallback ran: literal-secret assignment grep over `src bin hooks db scripts README.md docs examples` → 0 findings (`SECRET-GREP-DONE`); `BRAINY_SECRET`/`AGENT_MEMORY_SECRET` references are alias reads (`src/auth.ts:21-32`), presence flags (`bearer: armed|unset`), or `***`/`$BRAINY_SECRET` placeholders. This satisfies C2 for this gate as a **condition**: re-run the `gitleaks` gate pre-push/CI where the binary exists (owner `espinoza`, expiry next release). No silent PASS — the gap is recorded here.

## 4. Findings

| ID | Severity | Finding | Evidence | Owner | Remediation |
|----|----------|---------|----------|-------|-------------|
| *(none new)* | — | No new Critical/High/Medium/Low findings from post-implementation verification. C1–C8 all PASS; SC-MOVE-01..05 all MET; routed items ruled above. | `npm run typecheck` clean; `npx tsx --test tests/move.test.ts` 8 pass / 0 fail; greps cited per-row | — | — |

Finding without proof = REFUTED (none filed). No freelance fixes (review-only; no implementation files touched).

## 5. Residual risk + owner

Carried (unchanged, owners/expiry intact): R-SEC-01 open-guard dev mode (`barrera`, permanent design); R-SEC-02 MCP `tools/list` discovery (`vasquez`, MCP-spec governed); R-SEC-03 hook heuristic titles ≤120 (`espinoza`, 2026-12-31 heartbeat); S-LEG-001 audit-silent forget compat path (`subero`, boundary record in CONTRACT v1.8); S-LEG-002 empty provider allowlist blocks provider-backed use only (`subero`+`barrera`, before any provider-backed use); COND-RD-003 hook comment imprecision (`vasquez`, backlog wording). Gitleaks-binary gap → CI pre-push re-scan (owner `espinoza`, expiry next release).

## 6. Verdict rationale

All eight pre-implementation conditions landed in code with file:line proof, the move-route conditions are met with passing tests (8/8), and every routed co-sign item is adjudicated with evidence. Zero new vulnerabilities. **pass** — cleared for handoff; carried residuals remain owned and expiry-bound, none blocking.
