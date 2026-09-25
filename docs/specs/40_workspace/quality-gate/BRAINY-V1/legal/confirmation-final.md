# R4 Final Confirmations: DAT-001 Correction Sign-off + COND-LEG-01 Closure (BRAINY-V1)

**Reviewer:** `general(subero)` — Legal Owner (R4 lead)
**Date:** 2026-09-25
**Stage:** `frame-ship:quality-gate` (confirmation lane, review-only; rules and co-signs, fixes nothing)
**Packet (reference-only):** `SPEC: docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 / HARD: subagents+single-file-whitelist+no-secrets+alias1version+evidence-allowlist / GATE: CONDITIONAL / DOMAINS: R4 (this lane), R1 (executor), R2 (prior co-signs)`
**Role basis:** `prompts/subero.md` (Legal Owner); gate template `quality-gate/references/gate-report.md`; three-block bar `quality-gate/references/waiver-template.md`.
**Prior artifacts read:** `legal/legal-review.md` (`e4e1808`, COND-LEG-01), `legal/adjudication-dat-erasure.md` (`e0bb3d5`, rulings 1–6).

Method: every claim re-proven by this lane (read-only greps, `git show`/`diff`, file reads, `npx tsx --test`, `npm run typecheck`). No containers, no ports touched, no files modified except this artifact. Zero PII/secrets/tokens (counts, line refs, `sha256` only; sentinel canaries cited by bar reference, values never pasted).

## Confirmation 1 — DAT-001/007/008 correction (`fab7ed3`): ACCEPTED

**Rule: correction ACCEPTED. Clears adjudication ruling 1. DAT-007 and DAT-008 clear with it.**

### 1a. `docs/CONTRACT.md:23` states only reachable surfaces

Read in tree (post-`fab7ed3`): half (a) now lists Memory-row surfaces (`forgetMemory` / `POST /memory/forget` compat audit-silent / `POST /memory/delete` governed with receipt / `scripts/purge.ts` Memory-only batches / `DELETE /memory/todos/:id` Todo rows), then states Note-row erasure as **controller-executed via project-guarded store-level `forgetNote` within the ARCO SLA (item 5), no REST/MCP/CLI self-service surface in v1**, with REST/MCP exposure plus a `purge.ts` Note branch deferred to the next erasure-surface change or v2 (citing the R4 adjudication). This is exactly the ruling-1 required correction. No over-claimed Note procedure remains.

### 1b. Code gap re-proven by this lane (not taken on trust)

| Check | Result |
|---|---|
| `grep -c forgetNote src/server.ts` | **0** |
| `grep -c forgetNote src/mcp.ts` | **0** |
| `grep -c forgetNote scripts/purge.ts` | **0** |
| All `forgetNote` refs in tree | `src/store.ts` (interface + project-guarded impl) and `db/queries.ts` (query def) only |
| CLI `grep -n -i "forget\|note.*delete\|delete.*note" bin/brainy.mjs` | **0 hits** — no CLI Note-erasure surface |
| `grep -n "DELETE /v1/notes" src/server.ts` | **0 hits** — no per-note REST delete, per approved CDR-03 option (a) |

### 1c. `docs/CONTRACT.md:25` byte-identity: HOLDS

`sed -n '25p' docs/CONTRACT.md | sha256sum` → `14f711ecaa1c7b7dfcf3258dac1180933434e4ae8a3d0298a4596cfc3166f41c`, matching the reported value exactly. `diff` of line 25 against both `e0bb3d5` and `a79643c` → identical. The S-LEG-001/CDR-03-C1 boundary record is preserved verbatim; S-LEG-001 stays CONFIRMED, CDR-03 stays un-reopened.

### 1d. README DAT-007 / DAT-008: CLEAR

- DAT-007: `DELETE /v1/notes/:id` and `brainy forget` now appear in `README.md` **only inside explicit negations** ("there is no `DELETE /v1/notes/:id` route and no `brainy forget` subcommand in v1", `:416`; route table row replaced with a controller-executed/`Deferred` row, `:348`). Zero affirmative advertisements. The route-table `DELETE /v1/notes/:id` → "Permanently erase note" claim is gone.
- DAT-008: the blanket "All records adhere to `BRAINY_TTL_DAYS` … purged cleanly via `scripts/purge.ts`" claim is gone. `:415` now scopes TTL to the search paths with OFF semantics, scopes `purge.ts` to Memory rows only, and names the bypassing stores explicitly. No blanket TTL/purge claim remains in the privacy section.

### 1e. Cross-domain answer to R1: `*Deferred*` status-cell vocabulary is legally accurate

The `:348` row pairs status `*Deferred*` with description text stating erasure is controller-executed within the SLA and only the self-service REST/MCP surface is deferred. Read together, the cell is truthful: the **capability** (erasure within SLA) is not deferred; the **surface** (self-service route) is. No legal objection; brand styling stays with R5. One precision note for R5's next touch: a reader skimming only the status column could misread erasure itself as deferred — the description already cures this, so no change is required before release.

### 1f. Observations (not findings, not blocking)

- **OBS-R4-F1 (accuracy, conservative direction):** `README.md:415`'s bypass list ("Note rows … bypass the TTL filter", "`/v1/context/:project` exports … bypass") is now over-broad after `b91821a` (hybrid search filters fused Note rows via `parseCreatedAtMs`; the context route filters listed Notes). The text under-claims protection — legally safe direction, DAT-008 still clear — but it is stale. Owner R1+R5, expiry next README/CONTRACT touch.
- **OBS-R4-F2 (marketing summary):** `README.md:32` ("365-day TTL retention" one-liner) is unscoped summary; the detailed `:415` disclosure cures any subject-facing risk. Owner R5, expiry next brand touch.
- **OBS-R4-F3 (code-comment citation):** `src/server.ts:552` attributes the TTL route assignment to "SPEC-005 §4.3"; the TTL scope actually lives in §4.1/§4.2 + AC-03 (§4.3 is PII checkpoints). Comment-only slip, no behavioral effect. Owner R1, expiry next touch of that block.

## Confirmation 2 — COND-LEG-01: CLEARED

**Rule: COND-LEG-01 is CLEARED.** All four evidence halves assessed below; the breach-drill sub-item converts to a tracked post-release exercise with owner + expiry (the "written waiver with remediation deadline" alternative the condition itself provides).

| COND-LEG-01 half | Evidence (this lane verified by reference + re-execution where named) | Verdict |
|---|---|---|
| ARCO harness (access→rectify→erase→objection, allowlisted IDs) | Lane N slot9 CDR-07 canaries (`TEST_MATRIX.md` bar #10 + CDR-07 table: access 200 → move 200 + distill new-id → `POST /memory/forget` `{forgotten:true}`, Memory rows) + QA `2211b95` scoped live re-proof on a fresh slot2 instance (create/move/distill/export/ARCO-forget/TTL-knobs/hook/C8) with the remainder explicitly accepted (§Slot9 decision). Note-row erasure gap is covered by Confirmation 1 + tracked v2 exposure (adjudication ruling 3). | **MET** |
| Spawned TTL canary (`BRAINY_TTL_DAYS=1` + `signals` line) | Slot9 both-knobs/canonical-silent/alias-WARN-once/invalid+absent-OFF (Lane N bar #10) + slot2 re-proof (QA `2211b95`) + DAT-004 fix `b91821a`: `parseCreatedAtMs` tolerant normalizer (`src/lifecycle.ts:152-170`), `filterExpired` switched to it (`:196`), context route filters Notes + Memories with `signals` (`src/server.ts:545-568,949-966`), hybrid search filters fused Note rows (`src/search.ts:304-307`). This lane ran `npx tsx --test tests/ttl.test.ts tests/ttl-notes.test.ts` → **15 pass, 0 fail**; `npm run typecheck` → 0 errors. | **MET** (code+unit+prior-live; Note-live-canary residual per ruling 2 stands as accepted) |
| `s3cr3t` log grep → 0 across REST/MCP/export | Slot9 sentinel 0 hits over full server stdout/stderr (CDR-07 table) + slot2 sentinel 0 hits in server log (QA `2211b95`) + bar #11 repo-wide secret-shape grep 0 hits (excl. documented test values in SPEC-004:56/SPEC-005:86 + scanner self-descriptions). `gitleaks` not-installed stated honestly; R8 CI gate (C-09b) continues outside this condition. | **MET** for v1 local single-tenant scope |
| Breach drill + redacted log | Docs complete (R2 incident § `SECURITY_REVIEW.md:449-459`; R4 runbook in LEGAL_REVIEW §5); live drill never run (QA gap 9, accepted residual). | **TRACKED post-release** (three-block bar below), not live-met |

**Accepted-risk (drill carry):** the v1 breach procedure is documented but unexercised; a first real incident would execute an unrehearsed runbook.

**Compensating-controls:** incident § with severity mapping + 72h clock + allowlisted evidence shapes exists (`SECURITY_REVIEW.md:449-459`, owner `barrera`); R4 runbook exists (LEGAL_REVIEW §5, owner `subero`); deployment is single-tenant local with no outstanding subject request in evidence.

**Expiry:** tabletop drill + redacted log within 90 days of v1 release or before any provider-backed use, whichever first; re-review owner `subero`, co-owner `barrera`.

**Residual-risk:** unrehearsed runbook until the drill lands + `subero`/`barrera`. No silent PASS.

### 2a. Deferred-TTL-paths ruling (R4, privacy scope — binding on R1)

**Ruling: the deferred paths are genuinely OUT of scope for the v1 TTL declaration. No follow-up implementation is required; none is ordered.**

- **In-scope for TTL (v1, landed):** hybrid search incl. Note hits (`src/search.ts:304-307` via `parseCreatedAtMs`), BM25 Memory rows (`:106`), `GET /v1/context/:project` Notes + Memories (`src/server.ts:555,564-568`). This satisfies SPEC-005 AC-03(a) (Note canary → 0 hits + `signals` on `/v1/search`).
- **Out-of-scope (genuinely, by law and by SPEC):** (i) **Access `GET /v1/notes/:id`** — SPEC-005 AC-04 *requires* the access path to return the row; TTL-hiding there would breach the very right of access the declaration serves. TTL is retrieval hygiene, never erasure (`filterExpired` hides, deletes nothing), so expiry must not suppress access. (ii) **Rectification/move/distill writes** — mutation paths, not retrieval; TTL has no meaning there. (iii) **Recap/handoff digests, session listings, MCP `brainy_reality_check` grounding, `brainy export`** — explicit caller/operator-requested copies under LEG-07 purpose limitation (expose only where explicitly requested); an operator exporting their own project copy receives what is stored, with TTL state visible via the search/context `signals` lines. Erasure on these stores is served by the governed deletion paths (Confirmation 1), not by TTL.
- The v1 TTL declaration (`docs/CONTRACT.md:22` mechanism + `README.md:415` bypass list, modulo OBS-R4-F1 staleness) therefore describes the TTL scope honestly. Owner for any future scope widening: `vasquez`, co-owner `subero`, expiry next erasure-surface change or v2 — the same vehicle already carrying the Note-exposure work, so no new ticket is opened.

## Gate-condition summary

| Item | Severity | Effect after this lane |
|---|---|---|
| DAT-001 correction (`fab7ed3`) | High | **CLEARED** — ACCEPTED (§1); ruling 1 closed |
| DAT-007 (README route/`brainy forget` ads) | Medium | **CLEARED** — negations only, route row replaced |
| DAT-008 (blanket TTL/purge) | Medium | **CLEARED** — per-store scoping landed (OBS-R4-F1 staleness noted) |
| COND-LEG-01 (CDR-07 live evidence) | Gate condition | **CLEARED** — 3 halves met, drill tracked with owner + expiry |
| Deferred TTL paths | Privacy scope question | **RULED out-of-scope** — no follow-up required |
| OBS-R4-F1/F2/F3 | Observations | Recorded with owner + expiry, not findings |
| S-LEG-001 / S-LEG-002 | Accepted residuals | Unchanged — CONFIRMED, `:25` byte-identical, no divergence from R2 |

## Cross-domain requests (no freelance fixes)

- To R1 (`vasquez`): no new implementation ordered. OBS-R4-F1/F3 are yours at next touch (expiry recorded above). The drill carry needs no R1 action.
- To R5 (`vera`): OBS-R4-F2 one-liner scope note at next brand touch; `*Deferred*` cell needs no change.
- To R2 (`barrera`): drill co-ownership accepted above (expiry 90 days post-release or pre-provider-use); S-LEG-001 boundary intact, no divergence.
- To orchestrator: fold these verdicts into GATE_REPORT.md — R4's release-blockers (DAT-001 correction, COND-LEG-01) are both cleared; the only R4-owned future action is the post-release drill carry.
