# R4 Adjudication: DAT/ARCO Erasure-Path Requests (BRAINY-V1)

**Adjudicator:** `general(subero)` — Legal Owner (R4 lead; C-QA-03 co-owned with R1)
**Date:** 2026-09-25
**Stage:** `frame-ship:quality-gate` (adjudication lane, review-only)
**Packet (reference-only):** `SPEC: docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 / HARD: subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+evidence-allowlist / GATE: pending / DOMAINS: R4 (lead), R1, R2`
**Requesting artifacts:** `data/data-review.md` (`d56d14f`), `engineering/quality-assurance-review.md` (`2211b95`)
**Role basis:** `prompts/subero.md` (Legal Owner); checklist `quality-gate/references/domains/legal-review.md`; three-block bar `quality-gate/references/waiver-template.md` (missing block = FAIL, no promotion).

Method: every code-gap claim re-proven by this lane (read-only greps, file reads, one `node -e` stdlib evaluation). No containers, no ports, no file modified except this artifact. Zero PII/secrets/tokens.

## Exact CONTRACT text under ruling

`docs/CONTRACT.md:23` (v1.8 amendment, commit `a79643c`):

> 4. **Deletion procedure (the two halves):** (a) Per-note/memory: `forgetNote` / `forgetMemory` / `POST /memory/forget` / `POST /memory/delete {memoryId,reason}` governance allowlist / `scripts/purge.ts --days N --project P|--all` (batches 500 `listExpired` + `forgetMemory` per id, allowlist output) / `DELETE /memory/todos/:id`; (b) operator-run manual orphan `Concept` cleanup ...

`docs/CONTRACT.md:24` (ARCO SLA home): acknowledge ≤5 business days, resolve ≤15 business days, owner `subero`, delay escalates to orchestrator.

`docs/CONTRACT.md:25` (CDR-03-C1 erasure-evidence boundary): ARCO erasure served via governed `POST /memory/delete` + receipt or `purge` bulk path; `POST /memory/forget` compat-insufficient.

## Code-gap proof (this lane, not taken on trust)

- `grep -c forgetNote src/server.ts` → **0**. `grep -c forgetNote src/mcp.ts` → **0**. `grep -c forgetNote scripts/purge.ts` → **0**. (Re-ran this session; matches both reviewers.)
- All `forgetNote` references in tree: `src/store.ts:32-33,476,495,1950-1960` (interface + project-guarded impl) and `db/queries.ts:167,911` (query def). Nothing else.
- CLI: `grep -n -i "forget\|note.*delete\|delete.*note" bin/brainy.mjs` → **0 hits**. No CLI Note-erasure surface.
- REST: `src/server.ts` has `POST /v1/notes`, `POST /v1/notes/:id/distill`, `POST /v1/notes/:id/move`, `GET /v1/notes/:id` (`:390-496`). No `DELETE /v1/notes/:id`.
- `POST /memory/forget` → `store.forget` → `forgetMemory` only (`src/server.ts:689-700`, `src/store.ts:1519-1524`). `POST /memory/delete` → same `store.forget` underneath (`src/server.ts:756-776`). MCP `memory_forget`/`memory_delete` → same (`src/mcp.ts:330-340,435-455`). `scripts/purge.ts` imports `forgetMemory, listExpired` only (`scripts/purge.ts:46-51`) and deletes per id via `forgetMemory` (`:301-310`). Every reachable erasure procedure addresses Memory rows or Todo rows exclusively.
- `saveNote` writes `createdAt`/`updatedAt` as epoch-ms numbers (`src/store.ts:1717`, `:1758-1759`) into `param.dateTime()` fields (`db/queries.ts:123`); Memory writes ISO strings (`src/store.ts:1018`). `filterExpired` runs `Date.parse(row.createdAt)` and keeps unparseable rows (`src/lifecycle.ts:152-160`). This lane evaluated: `node -e` → `Date.parse("1758800000000")` = `NaN`, `Date.parse` of ISO = valid. An epoch-ms-shaped value therefore fails toward keep. Producer-type risk (DAT-004) stands as proven at the parse layer; live stored-shape confirmation belongs to R1.

## Ruling (1) — DAT-001 (High): CONTRACT v1.8 vs code reality

**Verdict: (i) — High declaration-accuracy defect requiring a docs correction before release. Not an accepted residual as written. Blocks release in current text; clears to CONDITIONAL-met when the correction lands (docs-only, no code change).**

The declaration lists `forgetNote` inside deletion half (a) as one item in a slash-separated per-note/memory procedure list. `forgetNote` exists (`src/store.ts:1950-1960`) but is caller-unreachable over REST (0 refs), MCP (0 refs), CLI (0 refs), and bulk purge (0 refs). A data-subject erasure request against a Note row therefore has no reachable self-service procedure, while the declaration + ARCO SLA home (`:24`, resolve ≤15 days, owner `subero`) jointly imply one.

Severity is High, not Critical. Erasure remains exercisable: the controller can execute store-level `forgetNote` (project-guarded) within the SLA, deployment is single-tenant local, and no outstanding subject request is in evidence. The defect is declaration accuracy, not loss of the erasure capability.

Required correction (docs-only, preserves the CDR-03-C1 boundary sentence at `:25` verbatim — see S-LEG-001 note under ruling (6)):

- Qualify `forgetNote` in `:23` half (a) as store/operator-level (no REST/MCP/CLI surface in v1).
- State the v1 governed Note-erasure path: data-subject Note erasure is served controller-executed (operator runs store-level `forgetNote` within the `:24` SLA), not self-service; bulk Note coverage and exposure deferred per ruling (3).

**Owner:** `subero` (correction text) + `vasquez` (CONTRACT lane). **Expiry:** Brainy v1 gate — correction lands before CLOSE.

## Ruling (2) — DAT-002 (High): TTL as mitigation for unreachable Note erasure

**Verdict: TTL-as-mitigation REJECTED. The v1.8 TTL declaration itself remains truthful; it cannot carry the Note-erasure gap. Stays CONDITIONAL until ruling (1) correction + ruling (3) tracked path land.**

The TTL declaration (`docs/CONTRACT.md:22`) accurately describes the mechanism: canonical-first knob, absent/invalid/≤0 → OFF declared, strict-greater expiry, unparseable kept, `signals` line. That matches `src/lifecycle.ts:48-68,144-161` and `tests/ttl.test.ts` 6/6. No correction to `:22` required.

As Note-erasure mitigation it fails on three independent grounds: (a) `filterExpired` only hides, on search paths only (`src/search.ts:106,307`; consolidation re-checks `src/store.ts:1000,1124`) — every export/read surface in data-review §1 bypasses it; (b) the only deleter, `scripts/purge.ts`, iterates `listExpired` + `forgetMemory`, Memory rows exclusively; (c) Note `createdAt` epoch-ms (`src/store.ts:1717-1759`) against `Date.parse`-based expiry risks fail-toward-keep indefinitely (parse-layer proven above).

Lesser included case — slot9/slot2 canary Note rows (synthetic, no PII per QA `2211b95` §Slot9): accepted residual under the three-block bar.

**Accepted-risk:** synthetic canary Note rows persist on spent slot volumes with no delete surface and no reliable TTL hide; rows carry no PII, no subject request attaches to them.

**Compensating-controls:** canary content synthetic-only (QA re-proof `2211b95`); volumes reset at next harness run or on Note-branch landing; no export of canary content into evidence (owner: engineering).

**Expiry:** Note-delete surface lands or v2, whichever first; re-review owner `vasquez`, co-owner `subero`.

**Residual-risk:** canary Note rows persist until then + engineering. No silent PASS.

## Ruling (3) — C-QA-03 (QA condition): `forgetNote` exposure decision

**Verdict: route Note erasure through the declared controller-executed governed path in v1; DEFER REST/MCP exposure + `purge.ts` Note branch to next erasure-surface change or v2. CDR-03 is NOT reopened. Stays CONDITIONAL until the ruling (1) correction records this path.**

CDR-03 option (a) — approved by R2 (`2a6bf20` §2), concurred by R1 (`e1c541a` §2), recorded at `docs/CONTRACT.md:25` — froze v1 as docs-only boundary with no new HTTP erasure surface (`grep -n "DELETE /v1/notes" src/server.ts` → 0, as approved). Exposing `forgetNote` over REST/MCP now would breach that approved boundary and WOULD require reopening CDR-03 with fresh R1+R2 review. I decline that trade: building a new authenticated destructive surface days before gate increases attack surface (STRIDE tampering/repudiation on a new delete route) for zero SLA gain, because Ley 172-13 requires erasure within the legal timeframe — satisfied by controller execution within the `:24` SLA — not a self-service endpoint.

Preferred option, with deadline and owner: v1 serves Note ARCO erasure controller-executed via project-guarded store-level `forgetNote` inside ACK ≤5d / resolve ≤15d (owner `subero`); the CONTRACT correction (ruling 1) records exactly this; REST/MCP exposure plus `purge.ts` Note branch plus `createdAt` normalization (DAT-004) are tracked work expiring at next erasure-surface change or v2 (owner `vasquez`, co-owner `subero`).

**To R1 (`vasquez`):** (a) land the CONTRACT correction per ruling (1); (b) file the deferred exposure + purge-Note-branch + `createdAt` normalization as tracked v2/next-surface work with this expiry; (c) own C-QA-01/C-QA-02 disposal (noted, not ruled here). This ruling is consistent with the CDR-03 option (a) boundary; no reopen.

## Ruling (4) — OBS-1 (legal gate observation): DPIA `dpia-v1` CDR-02-gap language

**Verdict: post-release amendment permitted. Clears as observation (not a gate condition).**

DPIA §5 R-12 control row and DPIA-R7 record the CDR-02 wiring gap as open. As of `5ee1728` the gap is closed at code+unit level (`src/lifecycle.ts:48-68`, `tests/ttl.test.ts` 6/6); only the live-canary half is carried under CDR-07. The stale sentence is historically true of versioned baseline `dpia-v1` (history is not rewritten) and carries no subject-facing risk, since the residual it guarded no longer holds at code level. Concurs with legal-review (`e4e1808` §3) OBS-1 disposition.

Required: one dated amendment line at next DPIA touch ("CDR-02 executed `5ee1728`, unit-evidenced; live canary pending CDR-07"). **Owner:** `subero`. **Expiry:** next DPIA amendment or 2026-12-31, whichever first.

## Ruling (5) — DAT-006 (Low): Todo store retention declaration

**Verdict: accepted residual under the three-block bar. Clears. A one-line Todo retention declaration is recommended at next CONTRACT touch, not required before release.**

**Accepted-risk:** Todo auto-extract stores ≤120-char session-body slices as `Todo.title` (`hooks/capture.mjs:236-260`, heuristic-gated, body ≥400 chars, fixed description `auto-extracted from session`) with no TTL filter on `listTodos` (`src/store.ts:1595-1616`, no `filterExpired` call) and no Todo retention line in `docs/CONTRACT.md:19-25`. Payload-derived content is bounded, sanitized, and deletable per row.

**Compensating-controls:** per-todo deletion exists and is declared — `DELETE /memory/todos/:id` (`src/server.ts:856-863`, listed in CONTRACT `:23` half (a)); titles bounded ≤120 chars with fixed non-payload description; R2 minimization accepted-residual stands (data-review §4). Control owner: engineering.

**Expiry:** next release or next Todo-surface change, whichever first; re-review owner `subero`.

**Residual-risk:** expired Todo rows hide nowhere and drop only via per-row DELETE until a retention line or TTL filter lands + `subero`. No silent PASS.

## Ruling (6) — S-LEG-001 confirm/overturn (co-owned with `barrera`)

**Verdict: CONFIRM. No divergence from the risk reviewer or the security reviewer. Clears as accepted residual with expiry.**

The expiry condition is met: the CDR-03-C1 boundary record exists at `docs/CONTRACT.md:25` (read and quoted above — ARCO erasure via governed `POST /memory/delete` + receipt, `/memory/forget` compat-insufficient). `POST /memory/forget` remains audit-silent by declaration (`src/server.ts:689-700` vs governance line at `:756-776`).

**Residual:** audit-silent compat path retained, SLA-evidence-insufficient by declaration + `subero`. **Expiry:** next erasure-surface change or v2, whichever first. **Re-review owner:** `subero`.

Boundary-protection note: the ruling (1) correction must preserve the `:25` boundary sentence verbatim. Any edit weakening it reopens S-LEG-001 and CDR-03.

## Gate-condition summary

| Item | Severity | Gate effect |
|---|---|---|
| DAT-001 | High | Stays CONDITIONAL — blocks release until docs correction lands |
| DAT-002 (mitigation claim) | High | Stays CONDITIONAL — rides DAT-001 correction + ruling (3) tracking; canary sub-case clears as accepted residual |
| C-QA-03 | Medium | Stays CONDITIONAL — clears when correction records the controller-executed path; deferred exposure tracked to next surface change or v2 |
| OBS-1 | Observation | Clears — post-release amendment, owner + expiry recorded |
| DAT-006 | Low | Clears — accepted residual, owner + expiry recorded |
| S-LEG-001 | Medium (residual) | Clears — CONFIRMED, expiry + re-review owner recorded |

## Cross-domain requests (no freelance fixes)

- To R1 (`vasquez`): CONTRACT correction per ruling (1) preserving `:25` verbatim; file deferred exposure + purge Note branch + `createdAt` normalization as tracked work per ruling (3); dispose C-QA-01/C-QA-02 (noted only).
- To R2 (`barrera`): S-LEG-001 co-sign acknowledged, no divergence; ruling (3) preserves your CDR-03 option (a) boundary — flag any objection same session.
- To orchestrator: collect these verdicts into GATE_REPORT.md; DAT-001/C-QA-03 corrections are the R4 release-blockers, all docs-only.
