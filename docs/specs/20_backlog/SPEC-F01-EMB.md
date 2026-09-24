# Spec: F-01-EMB — Embedding invariant in the tier-1 post-write verify

**ID:** SPEC-F01-EMB
**Owner:** general(vasquez) — Engineering Owner (R1)
**Domains-Touched:** engineering (R1) | security (R2, log-line/data-minimization review only) | automation/ops (R8, CI evidence only)
**Brief Reference:** BRIEF-f01-emb (bounded, approved in chat 2026-09-24)
**Status:** approved
**Priority:** P1
**Execution_Mode:** subagents (inherited from brief, frozen at frame-intent)

**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06 / HARD:subagents+storage=disk+no-secrets / GATE:Conditional security C1-C7 + arch C1-C5 no ADR / DOMAINS:R1,R2,R8`

## 1. Context

Gate RL001-F01 CLOSED the `updateMemoryContent` mid-batch atomicity risk for `content` + `dedupKey` + concept links — but the batch's `embedding` write escaped the verify. A partial commit that lands those three while dropping the embedding refresh passes every current invariant while the vector index keeps serving the pre-merge embedding (silently stale vector recall on the survivor). This is the named residual `F-01-EMB` in `ROADMAP.md` §1.3 and `docs/CONTRACT.md` §3 tier-1 (b) (expiry ≤ 2026-12-31 or next Helix engine upgrade). This spec closes that residual by extending the EXISTING verify + ONE-heal machinery with a fourth (`embedding`) invariant. No new query, no new index, no extra send.

## 2. Requirements

- **REQ-F-01-EMB-01:** `getMemoryById` (db/queries.ts) additionally projects `embedding` alongside `memoryRowProjection` + `dedupKey` (`PropertyProjection.new("embedding")`). Anchor stays `memoryId` + `project` where-clause (index #1); **no new index**, bootstrap count unchanged (8).
- **REQ-F-01-EMB-02:** `FreshSurvivorRow` (src/store.ts) gains `embedding: number[]`. `getFreshSurvivor` validates the projected value is an array of exactly `EMBED_DIM` (384) finite numbers and **fails closed** on shape drift: missing key, wrong type, or wrong length → treat as violation (not silent pass).
- **REQ-F-01-EMB-03:** `mergeUnderSurvivorLock` computes `expectedEmbedding = embed(nextContent)` and passes it to `verifyMergedState` as `expectedEmbedding: readonly number[]`.
- **REQ-F-01-EMB-04:** `verifyMergedState` asserts a 4th invariant: fresh `embedding` ≈ `expectedEmbedding` via helper `embeddingsEqual(actual, expected)` — element-wise `|a-b| ≤ 1e-6` after `Math.fround` normalization. An `embedding` violation **routes to `viaRetryWrite`** (full `updateMemoryContent` re-send), same single heal, re-verify, still wrong → throw naming `embedding`.
- **REQ-F-01-EMB-05:** Heal observability extends to embedding: confirmed heal emits after re-verify one stderr line `heal survivor=<id> invariants=...,embedding` — family token only, `oneLine` (CWE-117), stderr.
- **REQ-F-01-EMB-06:** **No embedding exposure in search results.** `memoryRowProjection` stays embedding-free; only `getMemoryById` internal read grows. Docs closure: `docs/CONTRACT.md` v1.6 + `ROADMAP.md` CLOSED.
- **NFR-F-01-EMB-A (no extra send):** happy-path send count unchanged, overhead +384 f32 per fresh re-read only.
- **NFR-F-01-EMB-B (lock envelope unchanged):** 6 happy / ≤11 worst / ≤165 s.
- **NFR-F-01-EMB-C (fail-closed posture):** every new failure mode throws.

## 3. Acceptance Criteria

- [ ] **AC-01:** `npm run typecheck` clean.
- [ ] **AC-02:** `verify-lifecycle` §I seam proves embedding drift heals: 8 sends + heal token `embedding`, still-violated throws naming `embedding`.
- [ ] **AC-03:** `scripts/probe4.ts` still green.
- [ ] **AC-04:** Vector recall of merged content finds survivor.
- [ ] **AC-05:** No regression — `verify` + `verify-lifecycle` green, no new index.

## 4. Contracts & Interfaces

| Contract | Change |
|----------|--------|
| `db/queries.ts` → `getMemoryById(): ReadBatch` | Projection becomes `memoryRowProjection + dedupKey + embedding`. Params/anchor unchanged. |
| `src/store.ts` → `FreshSurvivorRow` | `+ embedding?: readonly number[] | undefined` |
| `src/store.ts` → `verifyMergedState(args)` | `args += expectedEmbedding: readonly number[]`, invariants content/dedupKey/concepts/**embedding**, embedding → viaRetryWrite |
| `src/store.ts` → `embeddingsEqual` | Pure helper, epsilon 1e-6 with Math.fround |
| Heal line | `invariants=...,embedding` token only |

## 5. Out of Scope

- RL-001-QUEUE cap, crash-window journal, embedding re-index job, search shapes, bootstrap indexes.

## 6. Dependencies

- Upstream: BRIEF-f01-emb, gate RL001-F01 COND-RF-01
- Downstream: CONTRACT v1.6, ROADMAP CLOSED, TEST_MATRIX extension
- Domain sign-offs: R2 security, R8 automation

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change | Evidence |
|-------------|---------------------|-----------------|----------|
| REQ-F-01-EMB-01 | AC-03, AC-05 | PROPOSED_CHANGES.md — `db/queries.ts` | probe4 + bootstrap 8 |
| REQ-F-01-EMB-02 | AC-01, AC-02 | PROPOSED_CHANGES.md — `src/store.ts` FreshSurvivorRow | typecheck + seam |
| REQ-F-01-EMB-03 | AC-01, AC-04 | PROPOSED_CHANGES.md — mergeUnderSurvivorLock | typecheck + vector recall |
| REQ-F-01-EMB-04 | AC-02 | PROPOSED_CHANGES.md — embeddingsEqual + verify | seam 8 sends + throw |
| REQ-F-01-EMB-05 | AC-02 | PROPOSED_CHANGES.md — heal token | stderr line |
| REQ-F-01-EMB-06 | AC-05 | PROPOSED_CHANGES.md — docs closure | CONTRACT + ROADMAP diff |
