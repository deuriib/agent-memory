# Architecture Review: SPEC-F01-EMB (embedding verify invariant)

**Reviewer:** engineering owner (vasquez) — per `skills/review-architecture/references/architecture-review.md`
**Date:** 2026-09-24
**Verdict:** Conditional (no ADR; execute-spec blocked on P0, cleared on C1–C5)

**Scope (single review, one per lane — this is the engineering-lane singleton):**

| Input proposal | Spec |
|----------------|------|
| Inline orchestrator proposal: extend `getMemoryById` to project `embedding`; add `embedding` invariant to `verifyMergedState` via `embeddingsEqual`; heal via `retryWrite`; token only in logs | `docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06` — **MISSING (see P0)** |

**Canonical contract:** `docs/CONTRACT.md` (v1.5 frozen singleton — this repo has no
`docs/specs/10_design/ARCHITECTURE.md`; CONTRACT.md is the declared "source of truth
for both build lanes" and carries the §1/§2/§3 interfaces + data-flow tables).
ADR convention lives at `docs/adr/` (established by ADR-0001).

## Contract Compliance

| Invariant | Status | Notes |
|-----------|--------|-------|
| §2 projection rule ("never return `embedding` in search results") | pass | The ban targets the search/hit-stream routes and §3 result row shape. `getMemoryById` is an INTERNAL verify re-read: its row is consumed only by `getFreshSurvivor`, which narrows to `{memoryId, content, createdAt, dedupKey}` (+ in-memory embedding compare). Embedding never reaches a REST body, MCP tool result, search row, or hook payload. |
| §2 frozen exports (`getMemoryById` signature) | pass | Projection widening only: params, `returning(["memory"])`, and export names unchanged. No new query, no new export. |
| §1 labels/edges/`EMBED_DIM` + 8 indexes (no DDL) | pass | `embedding` is already a `Memory` property (f32[384]); read anchors on existing unique index #1. No index, label, edge, or property addition. `storage=disk` untouched. |
| §3 tier-1 (b) ATOMICITY — post-write verify + ONE heal + fail-closed named throw | pass (strengthened) | `embedding` joins content/dedupKey/concepts as a 4th verified invariant. Heal reuses the existing `retryWrite` = identical `sendMergedUpdate(mergedWrite)` (already carries the embedding). Still-violated → existing `REQ-F-01` named throw. This is the closure of the CONTRACT §3 tier-1 (b) **named residual**, explicitly pre-authorized: "add an `embedding` invariant to `verifyMergedState` in its own lane" (`ROADMAP.md` §1.3 row `F-01-EMB`). |
| §3 guard path (link-only heal never touches embedding) | pass | Unchanged: the substring-guard path rewrites no content/embedding/dedupKey; the embedding invariant lives only in `verifyMergedState` (merge path), matching the residual's scope. |
| §3 heal observability (SEC-F02 allowlist, `oneLine` CWE-117, stderr) | pass with condition C3 | Family token `embedding` may join the `invariants=` list (same class as the existing `content`/`dedupKey` tokens); vector VALUES and element dumps stay out of logs/errors forever. |
| §3 RL-001-QUEUE send envelope (6 happy / ≤11 worst-heal / ≤165 s) | pass | Zero additional sends — the embedding rides the existing `getMemoryById` read (before-violations) and the existing retryWrite. Payload grows ~1.5–3 KB per read; negligible vs the 15 s `withTimeout`. Envelope declaration needs no re-declaration. |
| §3 single-writer / same-process scope (RL-001) | pass | Verify still runs under the survivor lock; no new concurrency surface. Cross-process posture unchanged (out of contract until P4.3). |
| §5 verification bar | condition C5 | Suites must grow for the new invariant (see C5); §5 check counts updated in the same lane. |
| HARD `no-secrets` | pass | No credential material touched; logs carry memoryId + family tokens only. |

## ADR Required?

- [ ] Yes — ADR-XXX created
- [x] No — change is within existing contracts

### Reasoning (no-ADR verdict)

ADR trigger test: breaks/creates an invariant, adds a component, or changes a
cross-domain contract. None fires:

1. **No invariant broken.** The verify only *gains* an assertion — and that assertion
   is the sanctioned closure of a residual the contract itself already declares
   (`docs/CONTRACT.md` §3 tier-1 (b) named residual + `ROADMAP.md` §1.3 `F-01-EMB`).
   Closing a declared deviation with its prescribed remediation is contract *execution*,
   not contract change. Fail-closed posture, ONE-heal rule, and named-throw mechanics
   are untouched.
2. **No component added.** No new query function, index (DDL), route, MCP tool, module,
   or service. One projection field on an existing internal read + one pure helper
   (`embeddingsEqual`) inside the existing `verifyMergedState`. Component topology and
   data-flow table unchanged.
3. **No cross-domain contract change.** REST/MCP request/response shapes, the 11 MCP
   tools, hook payloads, and the §3 result row shape are byte-unchanged. `getMemoryById`
   widening is app-internal; the value is compared in memory and never exported.

The §2 `getMemoryById` doc line ("projects `memoryRowProjection + dedupKey`") and the
`db/queries.ts:529` comment ("never `embedding`") become stale — that is factual
bookkeeping amended alongside the code (condition C4), not an ADR-grade decision.

### Condition that invalidates this no-ADR verdict

Execution **STOPs and mints `docs/adr/ADR-000N-<slug>.md` (next free number after
ADR-0001; this repo's convention) with `Status: proposed`** if implementation reveals
that it:

- adds a **new component**: a separate embedding-read query, a repair/janitor job, a
  new route/tool, or a new index/DDL;
- lets an embedding **value** (or derived vector material) reach any response body,
  log line, error message, or hook payload — that would amend the §2 projection ban
  and the SEC-F02 log allowlist (then barrera R2 co-signs);
- **relaxes** fail-closed mechanics: more than ONE heal, silent pass on unverifiable
  state, or dropping the named-throw on still-violated;
- changes a §3 `RememberResult`/REST/MCP shape or the §2 frozen export list beyond the
  projection widening reviewed here.

Default otherwise: citation-only, no ADR.

## Conditions for Approval

**P0 — BLOCKER (packet integrity):** `docs/specs/20_backlog/SPEC-F01-EMB.md`
(`REQ-F-01-EMB-01..06`) **does not exist** (searched repo-wide, 2026-09-24), and no
`PROPOSED_CHANGES.md` has been persisted for this lane. The reference-only packet does
not resolve → `execute-spec` MUST NOT start. Orchestrator: land the spec (translate-to-spec) and persist the proposal, or correct the packet.

**C1 — f32 round-trip-safe equality (Critical if naive):** `embeddingsEqual` must NOT
compare raw JS doubles `===` against the read-back vector. The write coerces to
`f32[384]` (§1) and the read returns f32-decoded numbers, so a naive `===` mismatches
on virtually every element → EVERY merge verify would report an `embedding` violation →
heal → still-violated → `REQ-F-01` throw → all tier-1 merges fail closed (500).
Pin in the spec: normalize the expected side with `Math.fround` per element (or an
explicit epsilon ≤ 1e-6), and prove it on the live dev instance (round-trip evidence).

**C2 — missing/poisoned embedding read is a heal-able violation:** absent property,
non-array, or length ≠ `EMBED_DIM` on the fresh read is recorded as the `embedding`
violation (→ `retryWrite` heal → re-verify → named throw if still wrong). It is exactly
the residual scenario; it must never silently pass and never hard-throw BEFORE the one
heal attempt.

**C3 — token-only logging (R2, SEC-F02 + CWE-117):** logs and error text carry the
family token `embedding` only — never vector values, never element dumps. `oneLine`
collapse, stderr channel, one line per confirmed heal. The §3 COND-RK-02 runbook family
list (`content/dedupKey/links`) gains `embedding` in the same doc pass (C4).

**C4 — in-lane doc amendments with the code (contract never lags shipped code):**
`docs/CONTRACT.md` §2 `getMemoryById` line (+ `embedding`, internal-verify-only), §3
tier-1 (b) named residual → **CLOSED**, §3 heal-line family list, §5 check counts;
`db/queries.ts:529-531` comment rewrite; `ROADMAP.md` §1.3 `F-01-EMB` row → CLOSED
(with closure date + evidence commit).

**C5 — suite evidence (R8):** `verify*.ts` grows three checks: (i) a real committed
merge passes the embedding invariant (live round-trip proof — the C1 guard), (ii) an
induced embedding mismatch → ONE `retryWrite` heal → re-verify green + heal line carries
the `embedding` token, (iii) post-heal still-violated → named `REQ-F-01` throw listing
`embedding`. Existing send-budget assertions stay green (0 new sends).

## Dependencies / cross-cutting

- **R1 (engineering):** owns code (queries.ts, store.ts) + contract/roadmap doc pass (C4).
- **R2 (security):** owns C3 sign-off (log allowlist scope); ADR invalidation trigger #2
  requires barrera co-sign.
- **R8 (automation/ops):** owns C5 suite evidence + §5 count updates.
- Ship-release promotes this review to `docs/specs/50_archive/F01-EMB/` and notes
  residual `F-01-EMB` closure in release notes.

## Sign-off

- [x] engineering owner (vasquez) — **Conditional**: architecture-compliant, **no ADR**;
  cleared for `frame-ship:execute-spec` only after P0 resolves and C1–C5 are carried in
  the spec/proposal.

**Packet:** `SPEC:docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06 (MISSING — P0) / HARD:subagents+storage=disk+no-secrets / GATE:none-yet / DOMAINS:R1,R2,R8`

**Commit:** left to the orchestrator (lane synthesis): `docs(arch-review): F-01-EMB conditional, no ADR`
