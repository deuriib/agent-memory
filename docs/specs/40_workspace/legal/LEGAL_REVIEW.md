# LEGAL REVIEW — SPEC-005-brainy-legal (Ley 172-13)

**Spec:** `docs/specs/20_backlog/SPEC-005-brainy-legal.md` (REQ-BRAINY-LEG-01..09, AC-01..AC-09, §4.1..§4.5)
**Brief:** `docs/briefs/BRIEF-brainy.md` (Constraints Regulatory) · **OKR:** `docs/briefs/OKR-brainy.md` (O2 KR2.1-2.3, O3 KR3.1-3.2, Gate LEGAL_REVIEW)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 + AC-01..AC-09 + §4.1..§4.5 / HARD:subagents+max2lanes+no-secrets+alias1version+zero-code-edits / GATE:none-yet,security=Conditional-C1-C8 / DOMAINS:R4,R1,R2,R8,R5`
**Owner:** `general(subero)` — Legal/Privacy Owner (R4) · **Co-reviewer:** `general(barrera)` — Security Owner (R2, pending)
**Date:** 2026-09-25 · **Execution mode:** `subagents`
**Lane type:** review/attestation (non-code deliverables). Zero code edits, zero frozen-doc edits, zero containers, zero bound ports. Static reads + greps + existing test artifacts only. No raw PII and no secrets in this artifact — commitments use `[REDACTED]` / `sha256(content)`.

## 1. Method

Each AC row states what the SPEC demands, what actually exists in the repo today (verified by reading, never assumed), a verdict (`PASS` / `GAP` / `N-A`), allowlisted evidence (file path + line refs or grep counts / existing test ids), and residual risk with owner + expiry. Finding without proof = REFUTED. No silent PASS: every conditional verdict enumerates its conditions.

`npm run typecheck` at lane start and end: 0 errors (this lane changed no code; any failure would be reported, not fixed).

## 2. AC-01..AC-09 verification matrix

### AC-01 (REQ-01 — store declaration frozen) → `GAP`

SPEC demands: `ARCHITECTURE.md` NFR Security holds `Note.content` with purpose + TTL + deletion; `docs/CONTRACT.md` Brainy v1 amendment holds matching `purpose+TTL+deletion` for `Note.content`/`Memory.statement`; `grep -n "BRAINY_TTL_DAYS"` ≥2 and `grep -n "segundo cerebro"` ≥1 across both files.

What exists:
- `docs/specs/10_design/ARCHITECTURE.md:244` — NFR Security line contains `Note.content` PII-purpose `segundo cerebro`, TTL `BRAINY_TTL_DAYS` 365, `purge/forgetNote`, mask/tokenize, DPIA-if-high-risk, breach 72h. Declaration side present.
- `docs/CONTRACT.md` — v1.7 amendment (`docs/CONTRACT.md:10-17`) covers Brainy v1 routes/entities/tools but contains **no** `Note.content`/`Memory.statement` purpose+TTL+deletion declaration. `grep -n "Note.content\|Memory.statement" docs/CONTRACT.md` → 1 hit only (`docs/CONTRACT.md:754`, a compat rename row `memories.statement → Memory.statement`). The v1.4 Concept-retention declaration (`docs/CONTRACT.md:49-50`, `:435`) is the only Ley 172-13-shaped declaration in the file.
- `grep -n "BRAINY_TTL_DAYS" docs/specs/10_design/ARCHITECTURE.md` → hits (`:82` env table, `:244` NFR). `grep -n "segundo cerebro" docs/specs/10_design/ARCHITECTURE.md` → hit (`:244`). CONTRACT side contributes zero to either count for Note scope.

Evidence: `docs/specs/10_design/ARCHITECTURE.md:82,244` + `docs/CONTRACT.md:10-17,49-50,435,754` + grep counts above.
Residual: Brainy v1 ships PII stores whose Ley 172-13 declaration lives in ARCH + SPEC-005 §4.1 but not in the frozen contract. Owner `subero` (declaration text) + `vasquez`/`vera` (CONTRACT amendment lane). Expiry: Brainy v1 gate. Cross-domain request CDR-01.

### AC-02 (REQ-02 — purpose limitation + minimization) → `PASS` with 1 condition

SPEC demands: hook allowlist proof, zod bound rejections (`content` 200001 → 400, empty title → 400, same on MCP), export fixture allowlist.

What exists:
- `hooks/capture.mjs:63-92` — `observationFor`: fixed strings for `SessionStart/Stop/PreCompact/SessionEnd` (`:65-68`); `UserPromptSubmit` returns `"user prompt submitted"` without touching `hook.prompt` (`:72` + comment `:69-71` naming Ley 172-13); tool NAME only, `clean(hook.tool_name, 80)` (`:77`), `/`/`\` in tool name → `null` fail-closed (`:83`); edit-marker `file edited via <tool>` (`:89`), basename opt-in OFF unless `AGENT_MEMORY_CAPTURE_PATHS=basename` (`:111-112`), basename ≤80, no dirs (`:122-125`); `MAX_HOOK_BYTES 1MiB` (`:47`); zero-output guarantee (`:14-15`, `:288-290`).
- `src/server.ts` zod bounds: `contentSchema` 1..200000 (`:38`), `projectSchema` 1..200 (`:39`), `queryTextSchema` 1..10000 (`:43`), `limitSchema` 1..100 (`:44`), `noteTitleSchema` 1..500 (`:179`), `noteContentSchema` 1..200000 (`:180`), `noteTagsSchema` ≤64 (`:181`); every body schema `.strict()` (unknown keys → 400: `:80`, `:88`, `:97`, `:119`, `:127`, `:184`, `:194`, `:202`, `:236`, `:243`, `:250`); non-JSON → 415 (`:296-299`), `>1MiB` → 413 (`:306`), empty body → 400 (`:310`).
- `bin/brainy.mjs` `cmdExport` (`:1652-1691`): frontmatter allowlist `project:` + `tags: [...]` (`:1685`), per-file `0600` (`:1686-1690`), `--out` traversal guard (`:1679`), no secret field exists on notes so none can be written.
- Existing harnesses (not executed in this read-only lane): `scripts/verify-capture.ts`, `tests/step7.test.ts`.

Evidence: `hooks/capture.mjs:14-15,47,63-92,111-125` + `src/server.ts:38-44,80,179-181,184,296-310` + `bin/brainy.mjs:1652-1691`.
Condition C-02: live harness log (hook fixed-string proof + 400 matrix + MCP bounds + export fixture) must be produced by the R1/R8 lane before gate CLOSE. Owner `vasquez`. Expiry: Brainy v1 gate. No raw PII involved.

### AC-03 (REQ-03 — TTL 365 + purge + forget + orphan cleanup) → `GAP`

SPEC demands: (a) `BRAINY_TTL_DAYS=1` canary hidden + `signals` line, OFF-behavior declared; (b) `scripts/purge.ts` allowlist output + alias warning; (c) orphan 3-step audit→gate→drop→re-audit.

What exists:
- `src/lifecycle.ts:113-137` — `filterExpired`: strict `>` expiry (`ageDays <= ttlDays` kept, `:134`), unparseable `createdAt` kept (`:128-131`), env re-read per call. BUT reads **only** `AGENT_MEMORY_TTL_DAYS` (`src/lifecycle.ts:122` via `readPositiveEnv("AGENT_MEMORY_TTL_DAYS")`); `grep -Rn "BRAINY_TTL" src/` → **0 hits**. The canonical Brainy knob is unread in-process.
- `bin/brainy.mjs:1022-1037` — derives `brainyTtl = canonicalEnv("BRAINY_TTL_DAYS","AGENT_MEMORY_TTL_DAYS") ?? "365"` and passes `BRAINY_TTL_DAYS` into `serverEnv`, but does **not** set `AGENT_MEMORY_TTL_DAYS`. Net effect: a server spawned by `bin/brainy.mjs` enforces TTL only when the operator sets the legacy alias; canonical-only configuration (`BRAINY_TTL_DAYS=1`) leaves `filterExpired` OFF. Declared-365 TTL is therefore unenforced on the spawned path.
- `src/search.ts:106-115` (bm25) and `:304-309` (hybrid) — `filterExpired` before return + `ttl: hidden N expired rows` signal (`:34-36`, `:114`, `:309`). `src/store.ts:1000` (consolidation candidates) and `:1124` (fresh-survivor re-check) apply the same filter. `listNotes`/`getNoteById` do **not** filter (declared boundary: purge is the deletion path; recorded, not silent).
- `scripts/purge.ts` — `--days ≥1` (`:110-112`), `--project | --all` required (`:123-125`), batches of 500 (`:58`, `:289-296`), `forgetMemory` per id (`:301-310`), allowlist output plan/progress/governance (`:340-342`, `:314-316`, `:380-382`), `status=partial` on failed runs (`:391-395`), CWE-117 `oneLine` at print-site (`:26`, `:315`, `:381`), content never printed, exit codes 0/1/2 (`:30`, `:385-398`).
- `src/store.ts:1950-1956` — `forgetNote(id, project)` exists. `POST /memory/forget` (`src/server.ts:624-634`), `POST /memory/delete` with governance line (`:691-709`), `DELETE /memory/todos/:id` (`:790-798`) exist. **No** `DELETE /v1/notes/:id` route exists (`src/server.ts:402-434` has only `POST …/distill` and `GET /v1/notes/:id`); SPEC-005 §4.2's "`POST /v1/notes/:id` delete alias" has no code counterpart.
- Orphan cleanup: procedure documented in SPEC-005 §4.2 and CONTRACT v1.4 (`docs/CONTRACT.md:49-50`); no live audit run in this lane (read-only, no containers).

Evidence: `src/lifecycle.ts:113-137` + `grep -Rn "BRAINY_TTL" src/` → 0 + `bin/brainy.mjs:1022-1037` + `src/search.ts:34-36,106-115,304-309` + `scripts/purge.ts:58,110-125,289-316,380-398` + `src/store.ts:1950-1956` + `src/server.ts:402-434,624-634,691-709,790-798`.
Residual: canonical TTL unenforced on spawned path; per-note REST delete missing; live canary + orphan audit pending. Owners `vasquez` (R1: lifecycle canonical read, note delete route) + `espinoza` (R8: serverEnv alias compat) — CDR-02, CDR-03. Expiry: Brainy v1 gate.

### AC-04 (REQ-04 — ARCO rights within legal timeframe) → `GAP` (procedural; operations exist)

SPEC demands: live harness access→rectification→erasure→objection + governance-line shape + SLA doc line (ACK ≤5d / resolve ≤15d, owner `subero`).

What exists:
- Access: `GET /v1/notes/:id` (`src/server.ts:420-434`, 404 when absent), `POST /v1/search` (`:437-450`), `GET /v1/context/:project` (`:476-496`), all project-scoped (`project ?? DEFAULT_PROJECT`); tenant guard on link (`:503-510` same-project check).
- Rectification: `POST /v1/notes/:id/distill` (`:403-417`); `updateMemoryContent`/`moveNote` exist at store level (`src/store.ts` `updateMemoryContentQuery` import `:74`, `moveNoteQuery` `:58`) with **no** dedicated REST route in `src/server.ts` (grep `updateMemoryContent|moveNote` in `src/server.ts` → 0 route hits); CLI `brainy move` exists (`bin/brainy.mjs:196` COMMANDS, `cmdMove` path). Contest path for PARA classification exists via CLI/store, not via REST.
- Erasure: `forgetNote` (`src/store.ts:1950`), `forgetMemory` (`:1521`), `POST /memory/forget` (`src/server.ts:624`), `POST /memory/delete {memoryId,reason}` → `200 {deleted:true, receipt:{memoryId,deletedAt}}` with receipt omitting `reason` by design (`:707`) + governance line `memoryId=… reason=… at=…` (`:704-706`, CWE-117 collapsed schemas `:58-69`); second delete → 404 (`:695-698`); `DELETE /memory/todos/:id` (`:790-798`); `scripts/purge.ts` bulk erasure.
- Objection/restriction: PARA contest via `brainy move` (CLI) exists. The SPEC-claimed `AGENT_MEMORY_CAPTURE off` kill-switch does **not** exist in code: `grep` for `AGENT_MEMORY_CAPTURE` (excluding `CAPTURE_PATHS`) across `hooks/capture.mjs src/ bin/brainy.mjs` → 0 hits. Only `AGENT_MEMORY_CAPTURE_PATHS`, `AGENT_MEMORY_URL`, `AGENT_MEMORY_SECRET`, `AGENT_MEMORY_PROJECT` are read.
- SLA: `grep` for `5 business|15 business|ACK.*day|resolve.*day` across `ROADMAP.md SECURITY.md docs/CONTRACT.md docs/specs/10_design/ARCHITECTURE.md` → 0 hits. SPEC-005 Assumption 5 states the commitment; no owner-signed doc line records it.
- Live harness: not run in this read-only lane.

Evidence: routes and lines above + zero-hit greps recorded.
Residual: SLA doc line missing; capture kill-switch claim vs code drift; per-note REST rectification/delete missing; live ARCO harness pending. Owners `subero` (SLA record — done §5-adjacent in this review, needs CONTRACT/SLA home), `vasquez` (routes/switch). CDR-01 (SLA home), CDR-03, CDR-04. Expiry: Brainy v1 gate.

### AC-05 (REQ-05 — cross-border only approved jurisdictions) → `GAP` (procedural; default posture proven)

SPEC demands: allowlist of approved jurisdictions + `helix.toml` non-transfer proof + gate behavior for new regions.

What exists:
- Default non-transfer: `helix.toml:10` `storage = "disk"`; REST defaults `127.0.0.1:3111` (`src/server.ts:909-910`); Helix default `http://localhost:6969` (`src/store.ts:848`, `scripts/purge.ts:329`); `BRAINY_URL http://127.0.0.1:3111` local-only per SPEC-005 §4.4.
- Allowlist: exists **only** as SPEC-005 §4.4 text (initial `local`-only + conditional LLM-provider rule). `grep -n "cross-border|Cross-border|jurisdiction|adequate|BRAINY_LLM_PROVIDER" docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` → 0 hits: no R2-owned cross-border table exists yet. No `BRAINY_LLM_PROVIDER` region allowlist exists anywhere in code or docs (env name appears in SPEC/ARCH text only).
- `brainy export` local vault write confirmed not-a-transfer by construction (`bin/brainy.mjs:1652-1691` writes local files only); remote push remains operator-responsible (declared, no enforcement hook — accepted residual).
- Negative test (non-allowlisted region → CLOSED gate): not executable in this lane; no gate thread exists.

Evidence: `helix.toml:10` + `src/server.ts:909-910` + `src/store.ts:848` + zero-hit grep on engineering `SECURITY_REVIEW.md` + this review §4 (v1 allowlist, owned by `subero`).
Residual: R2 cross-border table missing; provider-region allowlist unpopulated; any `BRAINY_LLM_PROVIDER` use before population is unapproved-transfer risk (High). Owner `subero` (allowlist) + `barrera` (R2 table). CDR-05. Expiry: before any provider-backed `distill` use; review at Brainy v1 gate regardless.

### AC-06 (REQ-06 — DPIA high-risk before merge) → `PASS` with conditions

SPEC demands: `DPIA-BRAINY.md` (or `SECURITY_REVIEW.md` DPIA §) with purpose/necessity/proportionality, S/T/R/I/D/E across all 4 triggers, controls, residual+owner+expiry; `subero`+`barrera` sign-off; FAIL blocks merge.

What exists after this lane: `docs/specs/40_workspace/legal/DPIA-BRAINY.md` (new, this lane) covering all 4 triggers ((a) classifier embeddings + `RELATES_TO >0.85` auto-link `src/store.ts:1719-1731`; (b) MCP cross-agent incl. `tools/list` pre-auth discovery; (c) vector tenant `project` vs global `Concept.name`; (d) bulk export / `GET /v1/context/:project` traversal), SPEC-004 §4.1 category mapping, SPEC-005 §4.3 controls, residuals with owners + expiries, verdict `PASS-with-conditions` with enumerated conditions.

Evidence: `docs/specs/40_workspace/legal/DPIA-BRAINY.md` (this commit) + `src/store.ts:518-580,1719-1731` + `src/mcp.ts:190-230` + `docs/specs/20_backlog/SPEC-004-brainy-security.md` §4.1-§4.3.
Conditions C-06a: `barrera` (R2) co-review signature still pending — DPIA status stays `PASS-with-conditions`, never full PASS, until signed. C-06b: any later high-risk change amends the DPIA in place (SPEC-005 §4.4 rule). Owner `subero` + `barrera`. Expiry: Brainy v1 gate (C-06a), ongoing (C-06b).

### AC-07 (REQ-07 — privacy by design/default checkpoints allowlist) → `PASS` with conditions

SPEC demands: validation matrix (201/400/415/413), hook path-smuggle `null`, access-log shape, `logSafeNote` shape, export allowlist, evidence `[REDACTED]` rule.

What exists:
- Validation: strict schemas + codes as listed in AC-02 evidence (`src/server.ts:38-44,179-194,279-318`). `POST /v1/link` enum `REFERENCES|BELONGS_TO|RELATES_TO` (`src/server.ts:240`, `src/mcp.ts:180`) + same-tenant check (`src/server.ts:503-510`).
- Hook smuggle: `tool.includes("/") || tool.includes("\\")` → `null` (`hooks/capture.mjs:83`).
- Access log: `METHOD PATH STATUS DURATIONms` only (`src/server.ts:850`); 500 path uses `logSafeNote` (`:825`, `:854`).
- `logSafeNote`: remote → `HelixError:remote:<code>` only (`src/errors.ts:62-73`); local messages kept (operator-survivable, never request content — content never reaches these functions per `:15-16`).
- MCP: stdout = protocol only; diagnostics on stderr `oneLine` + `heal` lines (`src/mcp.ts:220,453,734`); auth failures throw `McpError InvalidRequest` (`:214-216`), store failures become `isError` tool results (`:192-194`, `:217-222`) — declared residual DPIA-R2 (see DPIA §7), flagged to R2 on whether transport-level rejection is expected.
- Export: allowlist frontmatter + `0600` (AC-02 evidence). Drift noted: SPEC-005 §4.3 claims frontmatter `project/tags/[[links]]`; code writes `project/tags` + content body, no `[[links]]` section (`bin/brainy.mjs:1685`). Export writes raw `Note.content` into the owner's own vault file by design (local, `0600`) — not a leak, but `quality-gate` evidence must never paste vault content (rule restated §5/§8).
- Dedup locks: per-key FIFO + per-survivor lock (`src/store.ts:880-918`) — write-race control, cross-process single-writer out-of-contract (documented residual, owner engineering).

Evidence: lines above + `src/mcp.ts:190-230` + `bin/brainy.mjs:1685-1690`.
Conditions C-07: live validation matrix execution belongs to the R1/R8 lane (this lane ran none — no containers). Owner `vasquez`. Expiry: Brainy v1 gate.

### AC-08 (REQ-08 — breach 72h) → `GAP` (procedural; runbook now drafted here)

SPEC demands: incident entry + governance-line example (redacted) + ledger rows with owner+justification+expiry + runbook link.

What exists:
- `grep -n "72|breach|Breach|incident|Incident" SECURITY.md` → 0 hits. `grep -n "Incident|72h|breach" docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` → 0 hits. The `SECURITY_REVIEW.md` Incident § referenced by SPEC-005 §4.5 does not exist yet.
- Governance audit primitives exist: `src/server.ts:704-706` delete line, `src/mcp.ts:453` delete line, `scripts/purge.ts:380-382` purge line (+ `status=partial` `:391-395`).
- This review §5 provides the R4 breach-72h runbook (severity mapping, 72h clock, notification duties, evidence allowlist, accepted-risk ledger shape), pointing at the Shared Foundation severity/Incident contract + CONTRACT governance-log + SPEC-004 §4.2 as the standing process.

Evidence: zero-hit greps above + `src/server.ts:691-709` + `src/mcp.ts:444-453` + this review §5.
Residual: R2-owned Incident § still missing; no drill log. Owner `barrera` (Incident § + drill) + `subero` (72h clock/arco notice). CDR-06. Expiry: Brainy v1 gate.

### AC-09 (REQ-09 — no secrets/PII in logs/exports/evidence, scan 0) → `PASS` with conditions

SPEC demands: `s3cr3t` log grep → 0 across surfaces, boot flag without value, `gitleaks` 0, `BRAINY_SECRET` grep allowlist-only, evidence `[REDACTED]` rule.

What exists (scans run by this lane, 2026-09-25):
- `grep -Rn "BRAINY_SECRET" src/ hooks/ bin/ scripts/ db/` (code only): `src/auth.ts:4,17,21,29` (doc comment + `env["BRAINY_SECRET"]` read + alias read + single deprecation warning), `src/mcp.ts:9` (doc comment only), `bin/brainy.mjs:186` (help text), `:416-418` (canonical-env read), `:768` (state-key skip), `scripts/import-transcript.ts:96-97,233`, `scripts/verify-ops.ts:287-292,359` (test harness uses `TEST_SECRET` variable, asserts stdout+stderr never contain value + `bearer: armed` flag). No literal values anywhere in code.
- `grep -Rn "AGENT_MEMORY_SECRET" src/` → `src/auth.ts:5,17,25,29` (alias path only) + `src/server.ts:6` (doc comment) — alias-1-version posture intact.
- Literal-secret heuristic `grep -RnE 'BRAINY_SECRET\s*=\s*[^*$"'\'' ]'` → hits are only the `BRAINY_SECRET=s3cr3t` harness descriptions inside `docs/specs/20_backlog/SPEC-004-brainy-security.md:56` and `docs/specs/20_backlog/SPEC-005-brainy-legal.md:86` (test-value documentation, not credentials). Zero real assignments.
- `gitleaks detect --no-git -v` → `not-installed` in this environment; grep fallback used instead (stated, never claimed as run).
- Placeholders: `README.md:178` (`Bearer $BRAINY_SECRET`), `:385,401` (`"BRAINY_SECRET": "***"`).
- Boot log prints armed-flag only: `src/server.ts:928-930` (`auth: bearer-required|open`, never the value). Non-loopback + open guard warns (`:913-916`).
- This artifact and the DPIA contain no raw PII and no secrets (commitments as `[REDACTED]`/`sha256`).

Evidence: grep outputs above + `src/auth.ts:20-34` + `src/server.ts:913-916,926-931` + `README.md:178,385,401`.
Conditions C-09: (a) live log-capture grep (`s3cr3t` → 0 across REST/MCP/export surfaces) must be produced by the R1/R8 lane with containers; (b) pre-push `gitleaks`/CI gate is R8-owned. Owners `espinoza` (C-09b), `vasquez` (C-09a). Expiry: Brainy v1 gate; C-09b ongoing.

## 3. Scans executed by this lane

| Scan | Command | Result |
|---|---|---|
| Secret-name grep (code) | `grep -Rn "BRAINY_SECRET" src/ hooks/ bin/ scripts/ db/ --exclude-dir=node_modules` | Allowlist-only: `src/auth.ts` reads + deprecation warning; `src/mcp.ts:9` comment; `bin/brainy.mjs` help/read/skip; `scripts/import-transcript.ts`, `scripts/verify-ops.ts` harness. No values. |
| Alias grep | `grep -Rn "AGENT_MEMORY_SECRET" src/` | `src/auth.ts` alias path + `src/server.ts:6` comment only. |
| Literal-secret heuristic | `grep -RnE 'BRAINY_SECRET\s*=\s*[^*$"'\'' ]'` (repo-wide excl. `.helix`, `node_modules`) | 2 doc hits, both `s3cr3t` harness descriptions in SPEC-004/005 AC text. 0 real assignments. |
| `gitleaks detect --no-git -v` | `command -v gitleaks` | `not-installed` — grep fallback used; scan never claimed. R8 CI gate pending (C-09b). |
| TTL wiring | `grep -Rn "BRAINY_TTL" src/` | 0 hits → CDR-02 evidence. |
| CONTRACT declaration | `grep -n "Note.content\|Memory.statement" docs/CONTRACT.md` | 1 hit (`:754` compat row) → CDR-01 evidence. |
| Breach runbook | `grep -n "72\|breach\|incident" SECURITY.md` + engineering `SECURITY_REVIEW.md` | 0 hits both → CDR-06 evidence. |
| SLA line | `grep -Rn "5 business\|15 business" ROADMAP.md SECURITY.md docs/CONTRACT.md ARCHITECTURE.md` | 0 hits → CDR-01 evidence. |
| Capture kill-switch | `grep -Rn "AGENT_MEMORY_CAPTURE\b" hooks/ src/ bin/` (excl. `CAPTURE_PATHS`) | 0 hits → CDR-04 evidence. |
| Cross-border table (R2) | `grep -n "cross-border\|jurisdiction\|BRAINY_LLM_PROVIDER" engineering/SECURITY_REVIEW.md` | 0 hits → CDR-05 evidence. |
| REST note-delete route | `grep -n "DELETE\|/v1/notes/:id" src/server.ts` (notes scope) | absent → CDR-03 evidence. |
| Typecheck | `npm run typecheck` | 0 errors (pre- and post-lane; no code touched). |

## 4. Cross-border allowlist v1 + DPIA trigger register

### 4.4 Cross-border allowlist (versioned, owned by `subero`)

**Version:** `crossborder-v1` (2026-09-25). Status: `local-only`. Any addition/removal is a written `subero` amendment with justification + expiry.

| Destination | Status | Condition |
|---|---|---|
| `local` HelixDB `storage=disk` on operator host (`helix.toml:10`); `BRAINY_DATA_DIR` under `$HOME`/slot dir; REST `127.0.0.1:3111`; Helix `127.0.0.1:6969` | ALLOWED — not a transfer | Default posture; evidence `helix.toml:10`, `src/server.ts:909-910` |
| `brainy export --format markdown` local vault write (`0600`, `bin/brainy.mjs:1652-1691`) | ALLOWED — not a transfer | Operator push of the vault to any remote needs the same gate as a transfer |
| `BRAINY_LLM_PROVIDER=openai\|gemini\|anthropic` (remote `distill`/embeddings) | FORBIDDEN until allowlisted | Requires (a) destination region on this list with adequacy basis, (b) DPIA PASS for that transfer, (c) recorded consent/contractual necessity, (d) minimized payload (summary slice, never full vault). No region listed in v1 → any provider use today needs prior `subero` written approval + remediation deadline + explicit residual |
| S3/MinIO bucket region outside operator host; MCP cross-host relay moving `Note.content` | FORBIDDEN by default | Same four conditions + `subero` written approval; gate CLOSED without |

### DPIA trigger register (all 4 documented triggers — any one triggers a DPIA amendment)

| # | Trigger | Presence in Brainy v1 | DPIA coverage |
|---|---|---|---|
| T-a | Classifier embeddings + `RELATES_TO >0.85` auto-link | PRESENT — `src/store.ts:1719-1731` cosine `>0.85` auto-link; `classifyPara` `src/store.ts:518-580` | `DPIA-BRAINY.md` §4 trigger (a) |
| T-b | MCP cross-agent sharing incl. `tools/list` pre-auth discovery | PRESENT — `brainy_*` + `memory_*` tools `src/mcp.ts:235-566+`; `_meta.authorization` gate `src/mcp.ts:214-216`; list-is-discovery residual | `DPIA-BRAINY.md` §4 trigger (b), residual DPIA-R2 |
| T-c | Vector tenant `project` vs global `Concept.name` | PRESENT — tenant-scoped search (`src/search.ts`, `where project` per SPEC-004 §4.3) vs `Concept.name` global uniqueness (CONTRACT §1 index #3) | `DPIA-BRAINY.md` §4 trigger (c), residual DPIA-R3 |
| T-d | Bulk export / `GET /v1/context/:project` traversal | PRESENT — `GET /v1/context/:project` `src/server.ts:476-496`; `brainy export` `bin/brainy.mjs:1652-1691` | `DPIA-BRAINY.md` §4 trigger (d), residual DPIA-R4 |

## 5. Breach 72h runbook (R4 section; R2 Incident § pending — CDR-06)

1. **Detect / declare.** Any confirmed or suspected breach involving `Note.content`/`Memory.statement`/embeddings (exfil via logs/exports/prompts, bearer bypass, unapproved cross-border, vector-store dump) is declared an incident in-session.
2. **Severity.** Critical (exploitable / prod impact / data loss / legal exposure): block, fix immediately. High (probable impact): fix before next release. Surface same-session with severity + evidence + owner. No silent PASS. (Shared Foundation Severity.)
3. **Assign.** Owners: `subero` (legal — 72h clock, subject notice) + `barrera` (security — containment, forensics) + `vasquez` (engineering — remediation). Post `severity + evidence + owner` in-session; FAIL → retry N=2 differently → escalate to orchestrator; no third loop.
4. **Contain.** Rotate `BRAINY_SECRET` (vault/env, revoke + restart); re-bind to `127.0.0.1` if exposed; stop the exfil path (log/export/prompt/relay). Preserve allowlisted evidence only.
5. **Evidence (allowlisted).** Governance lines (`src/server.ts:704-706`, `src/mcp.ts:453`, `scripts/purge.ts:380-382`) are the audit trail. Evidence artifacts use `[REDACTED]` or `sha256(content)` commitments — never raw `Note.content`. Finding without proof = REFUTED.
6. **72h clock.** Notify the competent authority and affected data subjects within 72 hours of confirmation where Ley 172-13 requires it. Owner `subero` owns the clock; delay beyond the ARCO SLA (ACK ≤5 business days / resolve ≤15 business days, contractual for single-tenant local) escalates to the orchestrator.
7. **Ledger.** Accepted residual risks are recorded with owner + justification + expiry (this review §8 and `DPIA-BRAINY.md` §6 are the first ledger rows; standing ledger home: R2 Incident § once CDR-06 lands).
8. **Post-mortem.** Blameless; own mistakes; ask for help early. (Shared Foundation Conduct.)

## 6. Sign-off

- `R4 subero: CONDITIONAL-PASS` — 9 AC verdicts above (2 PASS-with-conditions, 1 PASS-with-conditions DPIA, 6 procedural/substantive GAPs filed as CDR-01..06 with owners). Gate may CLOSE only when CDR-01..06 are resolved or waived in writing with remediation deadlines, plus `barrera` co-review signed.
- `R2 barrera: pending` — co-review of this LEGAL_REVIEW and the DPIA baseline requested; R4 never signs for R2.

## 7. Cross-domain requests (no freelance fixes — owner remediates)

| ID | Target file | Why | Suggested owner | Severity |
|---|---|---|---|---|
| CDR-01 | `docs/CONTRACT.md` (Brainy v1 amendment) + SLA home (CONTRACT or `SECURITY.md`) | AC-01: add `Note.content`/`Memory.statement` purpose+TTL+deletion declaration in Ley 172-13 shape (mirror v1.4 Concept block); AC-04: record ARCO SLA ACK ≤5d / resolve ≤15d with `subero` owner | R1 `vasquez` (contract lane) + R5 `vera` (copy) | High |
| CDR-02 | `src/lifecycle.ts` (`filterExpired` env read) | AC-03: read canonical `BRAINY_TTL_DAYS` with `AGENT_MEMORY_TTL_DAYS` alias fallback + single deprecation warning (ARCH §3 pattern); today `grep -Rn "BRAINY_TTL" src/` → 0, canonical TTL unenforced | R1 `vasquez` | High |
| CDR-03 | `src/server.ts` (routes) | AC-03/AC-04: add per-note `DELETE /v1/notes/:id` (project-scoped, bearer, governance allowlist line) and per-note rectification route (`moveNote`/`updateMemoryContent` REST surface or documented MCP/CLI-only decision) | R1 `vasquez` | Medium |
| CDR-04 | `hooks/capture.mjs` or SPEC-005 text | AC-04: `AGENT_MEMORY_CAPTURE off` kill-switch claimed in REQ-04 but unread in code (0 hits) — either implement the switch or amend the SPEC to the actual objection paths (`brainy move`, project isolation, omit concepts) | R1 `vasquez` (code) / R4 `subero` (SPEC amendment) | Medium |
| CDR-05 | R2 `SECURITY_REVIEW.md` (cross-border table) + allowlist population | AC-05: R2-owned cross-border table missing (0 hits); no `BRAINY_LLM_PROVIDER` region allowlist; provider-backed `distill` before population = unapproved-transfer risk | R2 `barrera` (table) + R4 `subero` (allowlist v2) | High |
| CDR-06 | R2 `SECURITY_REVIEW.md` (Incident §) + drill log | AC-08: Incident § + 72h runbook link + accepted-risk ledger + breach drill (redacted) missing in both `SECURITY.md` and engineering `SECURITY_REVIEW.md` (0 hits) | R2 `barrera` | High |
| CDR-07 | R1/R8 live-harness evidence (AC-02/03/04/07/09) | This lane ran no live harnesses (read-only, no containers): hook fixed-string proof, 400/415/413 matrix, TTL canary + `signals`, purge dry-run line, ARCO access→erase flow, `s3cr3t` log grep → 0 | R1 `vasquez` + R8 `espinoza` | High (gate-blocking until produced) |

## 8. Assumptions and residual risks

Assumptions: (A1) single-tenant local default — consent + legitimate interest is the lawful basis; multi-tenant/SaaS hosting needs a new DPIA (escalate `subero`/orchestrator). (A2) caller-supplied `tags`/`concepts` verbatim = caller's responsibility (CONTRACT v1.4 posture preserved; SPEC-005 §4.1). (A3) `BRAINY_TTL_DAYS` 365 single canonical default, alias 1 version (SPEC-005 Assumption 3) — code wiring pending CDR-02. (A4) orphan Concept cleanup stays operator-run manual, no scheduler (SPEC-005 Assumption 4). (A5) ARCO SLA contractual ACK ≤5d / resolve ≤15d — doc home pending CDR-01. (A6) DPIA path decision: the Brainy v1 DPIA baseline lives at `docs/specs/40_workspace/legal/DPIA-BRAINY.md` (this lane); later high-risk changes amend it in place.
Residuals: (R-i) `tools/list` pre-auth discovery + `isError`-instead-of-protocol-rejection in `src/mcp.ts` are declared residuals (DPIA-R2; R2 to rule on transport-level rejection). (R-ii) cross-process single-writer out-of-contract (`src/store.ts:880-918` locks are same-process). (R-iii) TTL OFF when env absent/invalid/≤0 is declared, not silent — but canonical-knob OFF-by-wiring (CDR-02) is the sharper risk until fixed. (R-iv) export writes raw content to the owner's local vault by design (`0600`); remote push is operator-responsible. (R-v) `GET /v1/context/:project` + `graph_path` over-share bounded by project scoping (DPIA-R4). Expiry for all CDR-linked residuals: Brainy v1 gate; DPIA-R2/R3/R4: 2026-12-31 or next high-risk change, whichever first.
