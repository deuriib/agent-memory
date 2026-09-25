# Proposed Changes: general(subero) — Legal/Privacy Owner

**Spec Reference:** SPEC-005-brainy-legal — `docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 + AC-01..09`
**Brief Reference:** `docs/briefs/BRIEF-brainy.md` (architectural-initiative, approved 2026-09-25) + `docs/briefs/OKR-brainy.md` (O2 KR2.1-2.3, O3 KR3.1-3.2, Gate LEGAL_REVIEW)
**Review Basis:** `docs/specs/40_workspace/legal/LEGAL_REVIEW.md` (R4 CONDITIONAL-PASS, commit `cf91d47`, CDR-01..CDR-07) + `docs/specs/40_workspace/legal/DPIA-BRAINY.md` (`dpia-v1`, PASS-with-conditions)
**Contract Reference:** `docs/CONTRACT.md` §0 frozen + v1.4 Concept-retention declaration + v1.7 Brainy amendment
**Agent:** general(subero) — Legal/Privacy Owner (R4)
**Date:** 2026-09-25
**Execution_Mode:** subagents (inherited from spec; max 2 lanes INV-006 — this lane is R4)
**Domains-Touched:** [legal/privacy (R4, owner) · engineering (R1, interface — store/TTL/deletion/routes) · security (R2, interface — STRIDE/PII/bearer) · automation/ops (R8, interface — serverEnv/CI scan) · marketing/brand (R5, interface — CONTRACT copy)]
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 + AC-01..09 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:legal-review=CONDITIONAL-PASS cf91d47, architecture=Approved-with-conditions bf2b595, security-delta=in-flight / DOMAINS:R4,R1,R2,R8,R5`

---

## Summary

This proposal turns the four R4-remediable cross-domain requests from the `cf91d47` legal review (CDR-01..CDR-04) into reviewable, pre-approval change rows. Two items are docs-only frozen-text deltas (CDR-01 CONTRACT declaration + SLA home; CDR-04 SPEC drift correction). One item is a minimal single-read-site code wiring fix (CDR-02 canonical TTL). One item is a decided boundary with a priced alternative (CDR-03 per-note REST erasure/rectification — default recommends the docs-only boundary, option (b) priced for reviewers). Zero implementation files are modified by this proposal.

---

## Gap-vs-existing-proposal check

`grep -n -i "TTL\|BRAINY_TTL_DAYS\|filterExpired\|lifecycle\|purge"` over `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` returns exactly one hit: the `scripts/bootstrap.ts` row, which covers only index-readiness polling language ("bootstrap lifecycle script") — not TTL wiring, not `filterExpired`, not `purge`. No row in the engineering proposal (body or move-route addendum) covers `src/lifecycle.ts`, `BRAINY_TTL_DAYS` canonical reads, TTL-OFF semantics, or purge wiring.

`grep -n -i "DELETE\|lifecycle"` over the same file returns only Todo-scope rows (`DELETE /memory/todos/:id` inside the historical SPEC-020 appendix and the `src/server.ts` todo-route row) — no `DELETE /v1/notes/:id`, no per-note rectification route, no note-erasure surface.

The move-route addendum (`engineering/PROPOSED_CHANGES.md` §Addendum, approved-with-conditions `bf2b595`) adds exactly one REST row: `POST /v1/notes/:id/move`. It does not add, imply, or reserve a delete/rectify row.

**Verdict:** CDR-02 and CDR-03 are **not covered** by any existing approved proposal row. The items below are new proposals, not duplicates. If CDR-03 option (b) is selected by reviewers, its REST row must land together with the already-approved move-route row so the execute lane applies both table deltas in one pass (coordination note, not an edit — this lane does not touch `ARCHITECTURE.md`, `SPEC-001`, or `engineering/PROPOSED_CHANGES.md`).

---

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `docs/CONTRACT.md` (Brainy v1 amendment, new paragraph after v1.7 block) | doc-modify (frozen-contract delta, owner R1) | Add the `Note.content` / compat `Memory.statement` PII declaration in Ley 172-13 shape, mirroring the v1.4 Concept-retention block (`docs/CONTRACT.md:49-50`): **purpose** `segundo cerebro personal CODE/PARA` (SPEC-005 §4.1 canonical text); **legal basis** `consent + legitimate interest`, single-tenant local, caller-supplied `tags`/`concepts` verbatim = caller's responsibility; **minimization** text-only MVP, `title 1..500` `content 1..200k` `tags string[64] 1..200` strict zod, `concepts ≤8`; **TTL** `BRAINY_TTL_DAYS` default `365` (alias `AGENT_MEMORY_TTL_DAYS` 1 version + warning; absent/invalid/≤0 → OFF declared); **deletion** two halves — (a) per-note/memory `forgetNote` / `forgetMemory` / `POST /memory/forget` / `POST /memory/delete {memoryId,reason}` governance allowlist / `scripts/purge.ts --days N --project P\|--all` batches 500 + `DELETE /memory/todos/:id`, (b) operator-run manual orphan `Concept` cleanup, 3-step audit→gate→drop→re-audit, no scheduler in Brainy v1; **honest boundary** a `Concept.name` still referenced by other rows cannot be dropped. Approval basis (quoted): SPEC-005 REQ-BRAINY-LEG-01 — "The declaration lives in `ARCHITECTURE.md` NFR Security row + this SPEC §4.1 (canonical) and is mirrored in `docs/CONTRACT.md` Brainy v1 amendment (docs-only, no route change, closes DAT-001-style for Note)"; traceability row REQ-BRAINY-LEG-01 → AC-01 → "Proposed Change: `docs/CONTRACT.md` Brainy v1 Note amendment". Same amendment records the ARCO SLA home: acknowledge ≤5 business days / resolve ≤15 business days, owner `subero`, delay escalates to orchestrator (closes the AC-04 SLA-doc-line gap; `grep` for `5 business\|15 business` across `ROADMAP.md SECURITY.md docs/CONTRACT.md ARCHITECTURE.md` → 0 hits today per LEGAL_REVIEW §3). Docs-only: no route, MCP tool, or code change. Grounded: `docs/CONTRACT.md:10-17,49-50,435,754`; `docs/specs/20_backlog/SPEC-005-brainy-legal.md:38,70,186`; `docs/specs/40_workspace/legal/LEGAL_REVIEW.md:18-28,70-71`; `docs/specs/10_design/ARCHITECTURE.md:244`. **Frozen-contract delta: requires `review-architecture` sign-off (R1 `vasquez`) before edit.** |
| `src/lifecycle.ts` (`filterExpired`, `src/lifecycle.ts:113-137`) | file-modify (minimal wiring, owner R1) | Read canonical `BRAINY_TTL_DAYS` first with `AGENT_MEMORY_TTL_DAYS` alias fallback + one `WARN deprecated` on stderr, per ARCH §3 and the CONTRACT §6.4 alias table (`docs/CONTRACT.md:772` row: "`BRAINY_TTL_DAYS` \| `AGENT_MEMORY_TTL_DAYS` \| Resolves canonical primary; falls back to alias with stderr warning"). Concretely: replace the single `readPositiveEnv("AGENT_MEMORY_TTL_DAYS")` call (`src/lifecycle.ts:117`) with a canonical-first resolution mirroring the `src/auth.ts:20-34` `secretFromEnv` pattern (`BRAINY_SECRET` first, alias fallback with single static warning via module flag, absent/invalid/≤0 → `undefined` → TTL OFF declared, return all rows). Semantics unchanged otherwise: strict `>` expiry (`ageDays <= ttlDays` kept, `:134`), unparseable `createdAt` kept (`:128-131`), env re-read per call (test control preserved). Also update the doc comment (`:106`) which currently names only `AGENT_MEMORY_TTL_DAYS`. No change to `src/search.ts:106,307` or `src/store.ts:1000,1124` call sites (they consume `filterExpired` as-is); no change to `bin/brainy.mjs:1022-1031` (lifecycle-side fix is sufficient — the spawned `BRAINY_TTL_DAYS` value in `serverEnv` becomes readable; setting both vars in `bin` is rejected as belt-and-braces duplication that would mask the canonical-first contract). Evidence of gap: `grep -Rn "BRAINY_TTL" src/` → 0 hits; `src/lifecycle.ts:117` legacy-only read; `bin/brainy.mjs:1022-1031` passes canonical without setting the alias the reader needs. Grounded: `src/lifecycle.ts:31,95,106-137`; `src/auth.ts:20-34`; `bin/brainy.mjs:400-418,1022-1031`; `docs/specs/10_design/ARCHITECTURE.md:82`; `docs/specs/20_backlog/SPEC-005-brainy-legal.md:44,74`; `docs/specs/40_workspace/legal/LEGAL_REVIEW.md:43-56`. |
| `docs/CONTRACT.md` + `docs/specs/40_workspace/legal/LEGAL_REVIEW.md` (boundary record, §7-adjacent) | doc-modify (accepted-boundary record, owner R4; CONTRACT line requires R1 ack) | **CDR-03 default recommendation: option (a) — "ARCO erasure/rectification is MCP/CLI/store-only in Brainy v1" recorded as an accepted boundary.** Record in CONTRACT (one line in the CDR-01 amendment or adjacent) and reference in LEGAL_REVIEW that: per-note erasure is served by `forgetNote` (`src/store.ts:1950-1956`), `forgetMemory`, `POST /memory/forget` (`src/server.ts:624-634`), `POST /memory/delete {memoryId,reason}` (`:691-709`), `scripts/purge.ts` bulk path, and `DELETE /memory/todos/:id` (`:790-798`); rectification/contest is served by store-level `updateMemoryContent` / `moveNote` plus CLI `brainy move` (`bin/brainy.mjs:196`, `cmdMove :1582-1606`) and `distillNote` + `SUPERSEDES` lineage (`src/server.ts:403-417`); no `DELETE /v1/notes/:id` and no per-note REST rectification route exist (`src/server.ts:402-434` has only `POST …/distill` and `GET /v1/notes/:id`). Rationale: zero new API surface, zero frozen-table delta, zero new STRIDE surface; store coverage already satisfies the ARCO operations (access `GET /v1/notes/:id` + `POST /v1/search` project-scoped; erasure paths listed above; objection via `brainy move`); the residual (no tenant-scoped per-note REST delete for auditors preferring HTTP-surface erasure) is explicit with owner `subero` + expiry Brainy v1 gate. **Condition that invalidates (a):** if the orchestrator or R1 rules that the ARCO SLA (ACK ≤5d / resolve ≤15d) requires an HTTP-surface per-note erasure path for enforceability/auditability, or if `review-security` rules that MCP/CLI-only erasure leaves an ungated exfil window, the default falls and option (b) applies. Grounded: `src/server.ts:402-434,624-634,691-709,790-798`; `src/store.ts:1950-1956`; `bin/brainy.mjs:196,1582-1606`; `docs/specs/20_backlog/SPEC-005-brainy-legal.md:48,76`; `docs/specs/40_workspace/legal/LEGAL_REVIEW.md:58-71`. |
| `src/server.ts` (routes) + `docs/specs/10_design/ARCHITECTURE.md` §7 + `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` §4.3 | file-modify + doc-modify (frozen-API delta, owners R1+R2) — **CDR-03 option (b), priced alternative, NOT the default** | **Only if option (a) is invalidated:** add `DELETE /v1/notes/:id` (project-scoped `?project=` / body tenant, dual bearer `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`, `404 note_not_found`, `400 invalid_tenant_link` on cross-tenant, `401` on auth fail, governance allowlist line `noteId`+`reason`+`at` single-line CWE-117 collapsed, success `200 {deleted:true, receipt:{noteId,deletedAt}}` mirroring the `POST /memory/delete` receipt shape that omits `reason` by design) plus a rectification path (either `PATCH /v1/notes/:id` strict `{title?, content?, tags?}` delegating to `updateMemoryContent`/re-embed, or a documented decision that `POST /v1/notes/:id/move` — already approved `bf2b595` — plus `POST …/distill` jointly serve rectification). Requires one new frozen REST-table row per route in `ARCHITECTURE.md` §7 and `SPEC-001` §4.3 (same one-row-delta shape as the approved move-route addendum) → **`review-architecture` (R1 `vasquez`) + `review-security` (R2 `barrera`: bearer/tenant STRIDE, governance-line PII allowlist) both mandatory before implementation**; R4 signs the ARCO-mapping text. Coordination: the (b) row(s) must land together with the already-approved move-route row so the execute lane applies all table deltas in one pass. Blast radius (b): new destructive HTTP surface (+1..2 routes), new zod schemas + strict-reject matrix, new governance line, expanded AC-04 harness (delete → 404 → re-delete → 404, tenant-mismatch 400, strict-body 400 probes, `s3cr3t` log grep), expanded cross-border/DPIA rows (new erasure path in §4.3 checkpoint table + `DPIA-BRAINY.md` amendment). Grounded: same as option (a) rows + `engineering/PROPOSED_CHANGES.md` Addendum (move-route precedent `bf2b595`). |
| `docs/specs/20_backlog/SPEC-005-brainy-legal.md` (REQ-BRAINY-LEG-04 prose, objection/restriction clause only) | doc-modify (frozen-requirements edit, owner R4) | **CDR-04 recommendation: (i) fix the SPEC text — accepted drift, docs-only. Do NOT implement the switch.** Replace the claim "caller may stop capture via `AGENT_MEMORY_CAPTURE off`" (SPEC-005 REQ-04, `SPEC-005:48`) with the actual objection/restriction paths verified in code: contest PARA classification via `brainy move` / `moveNote` (store); isolate via `project` tenant scoping; omit caller-supplied `concepts`/`tags` (derived ≤8 path); `AGENT_MEMORY_CAPTURE_PATHS=basename` opt-in stays OFF by default (`hooks/capture.mjs:111-112`). Rationale: the real paths fully serve objection/restriction for a single-tenant-local text-only MVP; a new global kill-switch adds a fresh env knob, a hook-bypass branch across 7 events, and a STRIDE review surface for no additional ARCO coverage; a boolean env read that silently disables capture risks masking misconfiguration as compliance (fail-open feel), whereas the documented paths are explicit per-call. Evidence of drift: `grep -Rn "AGENT_MEMORY_CAPTURE" hooks/ src/ bin/ scripts/` excluding `CAPTURE_PATHS` → 0 hits (LEGAL_REVIEW §3 scan table). **Flag: SPEC REQ text is frozen — this prose edit requires orchestrator + R1 (`vasquez`) acknowledgment before landing; this proposal only prices and recommends it, never applies it.** Only the REQ-04 objection clause changes; REQ/AC ids, bounds, and all other prose stay frozen. Grounded: `docs/specs/20_backlog/SPEC-005-brainy-legal.md:48`; `hooks/capture.mjs:63-92,111-125`; `bin/brainy.mjs:196`; `docs/specs/40_workspace/legal/LEGAL_REVIEW.md:62-71`. |

---

## Rationale

- **REQ-BRAINY-LEG-01 / AC-01 (CDR-01):** SPEC-005 REQ-01 names the CONTRACT amendment as the proposed change ("mirrored in `docs/CONTRACT.md` Brainy v1 amendment (docs-only, no route change)") and the traceability table (§7) lists it as the REQ-01 proposed change. The amendment is therefore SPEC-authorized; only the frozen-contract edit gate (`review-architecture`, R1 `vasquez`) stands between proposal and execution. The ARCO SLA home rides in the same amendment because AC-04's only missing doc artifact is the SLA line (all ARCO operations exist; only the owner-signed commitment is absent).
- **REQ-BRAINY-LEG-03 / AC-03 (CDR-02):** The declared TTL (`BRAINY_TTL_DAYS` 365, ARCH §3 + CONTRACT §6.4) is unenforced on the spawned path by a single wrong read site (`src/lifecycle.ts:117`). Canonical-first-with-alias-fallback is the repo-wide contract (auth, CLI, CONTRACT §6.4); extending it to the TTL reader is the minimal fix with zero behavior change for alias-configured operators (alias still resolves, plus one warning) and fail-closed TTL-OFF preserved for absent/invalid/≤0.
- **REQ-BRAINY-LEG-04 / AC-04 (CDR-03):** Default (a) is recommended because every ARCO operation already has a working surface, and the marginal value of a new destructive HTTP route does not justify a second frozen-API delta + STRIDE review + harness expansion in v1. The invalidation condition is stated crisply so reviewers can flip to (b) on grounds of auditability rather than relitigating coverage.
- **REQ-BRAINY-LEG-04 / AC-04 (CDR-04):** Option (i) is recommended because the SPEC claim describes a switch that was never built, while the built objection paths are real, tested surfaces. Rewriting one clause to match verified code is strictly smaller — in risk, review, and blast radius — than building, gating, and hardening a new global capture bypass.

---

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| **CDR-02: set both `BRAINY_TTL_DAYS` and `AGENT_MEMORY_TTL_DAYS` in `bin/brainy.mjs` `serverEnv`** | Masks the canonical-first contract instead of enforcing it; every future reader must repeat the dual-set; a lifecycle-side canonical read fixes all spawn paths at once. `bin` stays untouched. |
| **CDR-02: new `ttlFromEnv` helper in a new module** | Unnecessary indirection; `readPositiveEnv` (`src/lifecycle.ts:31`) plus the `src/auth.ts:20-34` warning-flag pattern compose into the fix inline. No new module, no new export. |
| **CDR-03: default to option (b) (build the REST delete now)** | Premature API expansion: adds a destructive route, two frozen-table rows, STRIDE review, and harness scope to v1 for coverage the store/MCP/CLI surfaces already provide. Revisit only if the stated invalidation condition fires. |
| **CDR-04: implement `AGENT_MEMORY_CAPTURE off` (option ii)** | New env knob + 7-event bypass branch + STRIDE surface for zero new ARCO coverage; risks fail-open misconfiguration masking as compliance. The documented explicit paths are the safer posture. |
| **Cover CDR-05/06/07 in this lane** | Owned elsewhere by design: CDR-05/06 belong to the R2 security lane in flight (writing `SECURITY_REVIEW.md` here would be a freelance cross-domain fix); CDR-07 live harnesses belong to the Step 11 verification pass with containers. This lane records the handoff, not the work. |

---

## Approval Required From

- [ ] **Owning domain owner:** general(subero) — Legal Owner (R4) *(mandatory, legal text + DPIA mapping — signs the proposal, never self-approves the verdict)*
- [ ] **Engineering owner:** general(vasquez) — Engineering Owner (R1) *(mandatory via `review-architecture`: CDR-01 frozen-contract delta, CDR-02 wiring, CDR-03 option (a)/(b) routing, CDR-04 SPEC prose-edit acknowledgment)*
- [ ] **Security owner:** general(barrera) — Security Owner (R2) *(mandatory via `review-security`: CDR-02 TTL enforcement change touches PII retention; CDR-03 (a) boundary acceptance or (b) new destructive route; CDR-01 declaration text co-review per SPEC-005 §6)*
- [ ] *Coordinating review (non-blocking for spec proposal):* general(vera) — Marketing Owner (R5) *(CONTRACT copy wording)*; general(espinoza) — Automation/Ops Owner (R8) *(`serverEnv`/CI-scan implications: none expected — `bin` untouched, C-09b scan gate unaffected)*

> **Rule:** No repository file modifications during proposal phase. For non-code domains, no external sends/filings/launches during proposal phase either. This proposal is authoring documentation only; zero implementation files are modified.

---

## Risk Assessment — SPEC-005 CDR-01..04 remediation

**Proposer:** general(subero) — Legal/Privacy Owner (R4)
**Date:** 2026-09-25
**Domains-Touched:** legal/privacy (R4, owner) · engineering (R1) · security (R2) · automation/ops (R8) · marketing/brand (R5)

### Risk Matrix

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R-L01** | CONTRACT amendment wording drifts from SPEC-005 §4.1 canonical text (purpose/TTL/deletion mismatch re-opens AC-01) | Low | High | Amendment quotes §4.1 verbatim; `review-architecture` + R4 sign-off both required; gate checks `grep -n "BRAINY_TTL_DAYS" docs/CONTRACT.md` ≥1 post-edit. |
| **R-L02** | CDR-02 fix changes TTL behavior for alias-configured operators (surprise expiry) | Low | Medium | Alias still resolves with identical numeric semantics; single deprecation warning is the only new observable; strict-`>` + unparseable-kept + OFF-when-absent semantics frozen; AC-03 canary harness proves both knobs pre-gate (CDR-07). |
| **R-L03** | CDR-03 option (a) is read as "no erasure path" by an auditor | Medium | Medium | Boundary record enumerates all five erasure surfaces with file+line refs; ARCO harness (CDR-07) demonstrates access→rectify→erase→objection end to end; invalidation condition gives reviewers a clean flip to (b). |
| **R-L04** | CDR-03 option (b) doubles the v1 REST delta (move row + delete row) and slips one row through unreviewed | Low | High | Coordination note requires both rows in one execute pass; each row needs its own `review-architecture` + `review-security` verdict; no handoff on CLOSED without waiver. |
| **R-L05** | CDR-04 SPEC prose edit is applied without orchestrator/R1 acknowledgment (silent REQ rewrite) | Low | High | This proposal prices but never applies the edit; the row is explicitly flagged as requiring orchestrator + R1 ack; the edit touches only the REQ-04 objection clause, never REQ/AC ids. |
| **R-L06** | R4 lane is pulled into CDR-05/06/07 work (freelance cross-domain fix) | Low | Medium | Explicit out-of-scope declaration with owner routing; this lane writes no `SECURITY_REVIEW.md`, runs no containers, produces no live harness. |

### Blast Radius

- **Systems:** No runtime change proposed beyond one env-read line in `src/lifecycle.ts` (CDR-02); docs-only otherwise. No schema, index, dimension, route-behavior, or MCP change in the default (a)/(i) path. Option (b) would add 1–2 REST routes + frozen-table rows (priced, not default).
- **Teams:** R1 implements CDR-02 (+ CDR-03(b) if flipped); R4 owns CDR-01/CDR-04 text with R1 ack; R2 rules on all retention/erasure deltas; R5 reviews CONTRACT copy; R8 unaffected (`bin` untouched).
- **Customers / Users / Agents:** No API or MCP behavior change in the default path; alias-configured operators see one new stderr warning (CDR-02). Option (b) adds an erasure route agents could call — bearer-gated, tenant-scoped.
- **Regulators / Legal:** CDR-01 closes the AC-01 declaration gap (Ley 172-13 purpose+TTL+deletion for `Note.content` in the frozen contract); SLA home makes the ARCO commitment auditable; DPIA residuals DPIA-R6/R7 (see `DPIA-BRAINY.md` §6) shrink as CDR-01..04 land.
- **Revenue / Commercial:** Internal infrastructure component; no billing, pricing, or commercial-claim impact. No marketing launch gated on this proposal beyond R5 copy review.

### Rollback Plan

- **Proposal revert:** `git revert <this-commit>` removes exactly one file; no code, contract, or spec file is touched by the proposal itself.
- **Post-execution revert (advisory, for the execute lane):** CDR-01/CDR-04 doc edits revert via `git revert`; CDR-02 one-line env-read revert restores legacy-only behavior (canonical TTL unenforced — the pre-fix residual returns, must re-flag CDR-02).

### Security Considerations

- CDR-02 touches PII retention enforcement → `review-security` mandatory (TTL is a deletion control, not just config).
- CDR-03 in either option touches the erasure boundary → `review-security` mandatory (option (a) as boundary acceptance, option (b) as new destructive surface).
- No secrets, no raw PII in this proposal: evidence by path + line refs + grep counts only; examples placeholder-only (`<note-id>`, `<area-name>`).

### Domain Considerations

- **Legal (R4):** Owns declaration text, SLA commitment, boundary record, SPEC-drift correction; never signs for R1/R2.
- **Engineering (R1):** Owns frozen-contract/API verdicts (`review-architecture`), the lifecycle wiring fix, and SPEC prose-edit acknowledgment.
- **Security (R2):** Owns retention/erasure verdicts (`review-security`); CDR-05/06 (`SECURITY_REVIEW.md` cross-border table + Incident §) stay in the R2 lane.
- **Marketing/Brand (R5):** CONTRACT copy wording review, non-blocking.
- **Automation/Ops (R8):** No `bin`/pipeline change in the default path; pre-push secret scan gate (C-09b) unaffected.

---

## C2 Challenge Hook Trigger Analysis (REQ-002)

### Trigger Checklist

| Trigger Condition | Triggered? | Evidence / Reason |
|-------------------|------------|-------------------|
| **Auth / data / API / PII surface touched** | **YES** | TTL retention wiring (`Note.content` lifetime), erasure/rectification boundary, PII store declaration — all PII-lifecycle surfaces. |
| **Multi-domain scope** | **YES** | 5 domains: R4 (owner), R1, R2, R8, R5. |
| **Blast radius mentions customers / regulators / revenue** | **YES** | Regulators (Ley 172-13 declaration, ARCO SLA, breach-adjacent erasure boundary) explicitly in scope. |
| **Approver request** | Pending | Approver may explicitly request challenge round during review. |

**Verdict:** The C2 Pre-Approval Challenge Round is **TRIGGERED** on multiple independent criteria.

### One-Pass Challenge Budget & Rules

- **Budget:** Exactly one budgeted round per trigger pass consisting of **≤ 3 questions**. Asking a 4th question (N+1) is a methodology violation and will result in an immediate automated **FAIL**.
- **Re-challenge Cap:** An approver may request at most one additional challenge round (total ≤ 2 passes). If issues remain after 2 passes, the decision is escalated to the orchestrator.
- **Masking Reminder:** All challenge prompts and exports must strictly adhere to privacy: *"Por tu privacidad: no compartas PII/secretos/tokens en esta ronda; enmascaramos todo export (Ley 172-13)."*
- **Terminal Decision:** Following the round, the proposal receives a terminal **Approve** or **Reject**. If an exit is initiated prior to a terminal decision, the proposal is marked `grill: exited` and remains unapproved (no silent promotion).
- **Untouched Invariant:** Repository files (beyond this committed proposal doc) remain completely untouched throughout the challenge round.

---

## REQ → Test → Artifact Traceability

| REQ/AC | Test / Evidence | Artifact / Assertion |
|--------|-----------------|----------------------|
| REQ-BRAINY-LEG-01 / AC-01 | Post-execution `grep -n "Note.content\|Memory.statement" docs/CONTRACT.md` → ≥2 (compat row + new declaration); `grep -n "BRAINY_TTL_DAYS" docs/CONTRACT.md` → ≥1 | CONTRACT Brainy v1 amendment diff with purpose+TTL+deletion + SLA home; `review-architecture` verdict |
| REQ-BRAINY-LEG-03 / AC-03 (CDR-02) | `grep -Rn "BRAINY_TTL" src/` → ≥1 (`src/lifecycle.ts`); AC-03 canary harness (CDR-07): `BRAINY_TTL_DAYS=1` hides 2-day-old canary + `signals` line; alias emits single `WARN deprecated`; absent/invalid/≤0 → OFF declared | `src/lifecycle.ts` diff (one read site); `review-security` verdict; canary log (Step 11) |
| REQ-BRAINY-LEG-04 / AC-04 (CDR-03a) | Boundary record present in CONTRACT + LEGAL_REVIEW ref; ARCO harness (CDR-07) access→rectify→erase→objection via store/MCP/CLI paths | Boundary text diff; harness log with allowlisted IDs (`[REDACTED]`/`sha256`) |
| REQ-BRAINY-LEG-04 / AC-04 (CDR-03b, if flipped) | New-route matrix: delete 200 → GET 404 → re-delete 404; tenant-mismatch 400; strict-body 400; `s3cr3t` log grep → 0 | Route + 2× one-row table diffs; `review-architecture` + `review-security` verdicts |
| REQ-BRAINY-LEG-04 / AC-04 (CDR-04) | `grep -n "AGENT_MEMORY_CAPTURE off" docs/specs/20_backlog/SPEC-005-brainy-legal.md` → 0 post-edit; objection clause matches verified paths | SPEC prose diff (one clause); orchestrator + R1 ack record |

---

## Out of Scope (explicit)

- **CDR-05 / CDR-06** (cross-border allowlist table + Incident/breach § in `SECURITY_REVIEW.md`) — assigned to the R2 security lane currently in flight; this proposal does not write `SECURITY_REVIEW.md`. The v1 allowlist (`LEGAL_REVIEW.md` §4, `crossborder-v1` local-only) stands as the R4 baseline the R2 table will mirror.
- **CDR-07** (live harness evidence for AC-02/03/04/07/09) — belongs to the Step 11 verification pass with containers (R1 `vasquez` + R8 `espinoza`); this lane ran no containers and touched no ports.
- **Move-route addendum + `ADR-0003` contract-delta rows** — already approved-with-conditions (`bf2b595`) in the engineering lane; this proposal does not edit `ARCHITECTURE.md`, `SPEC-001`, or `engineering/PROPOSED_CHANGES.md`. CDR-03 option (b) coordination is noted so the execute lane applies both REST rows together.
- **Committed artifacts read, not rewritten:** `LEGAL_REVIEW.md` and `DPIA-BRAINY.md` (own artifacts from `cf91d47`), `engineering/*`, and all code/docs listed off-limits in the dispatch packet.

---

## Assumptions and Risks

Assumptions: (A1) SPEC-005 REQ-01/traceability naming of the CONTRACT amendment constitutes SPEC authorization for the doc delta — the remaining gate is reviewer verdict, not scope. (A2) `src/auth.ts:20-34` is the accepted canonical-first + single-warning pattern to mirror for TTL. (A3) Store/MCP/CLI ARCO coverage is sufficient for v1 absent an auditor-facing HTTP-erasure requirement (the stated flip condition). (A4) Single-tenant-local lawful basis (consent + legitimate interest) is unchanged by all four items. (A5) `bin/brainy.mjs` needs no change once the lifecycle reader is canonical-first.

Risks: see Risk Matrix R-L01..R-L06 above. Residual risk explicit, no silent PASS: until execution lands, canonical TTL stays unenforced on the spawned path (High, owner `vasquez`, expiry Brainy v1 gate); per-note REST erasure stays absent under boundary (a) (accepted, owner `subero`, expiry Brainy v1 gate); CONTRACT Note declaration + SLA home stay missing until CDR-01 executes (High, owners `subero`+`vasquez`, expiry Brainy v1 gate).
