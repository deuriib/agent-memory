# Proposed Changes: Engineering Owner (R1) — F-01-EMB

**Spec Reference:** SPEC-F01-EMB — `docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06`
**Agent:** general(vasquez) — Engineering Owner
**Date:** 2026-09-24
**Execution_Mode:** subagents
**Domains-Touched:** engineering (R1), security (R2), automation/ops (R8)
**Packet:** `SPEC:docs/specs/20_backlog/SPEC-F01-EMB.md#REQ-F-01-EMB-01..06 / HARD:subagents+storage=disk+no-secrets / GATE:Conditional security C1-C7 + arch C1-C5 no ADR / DOMAINS:R1,R2,R8`

## Summary

Close residual F-01-EMB by adding fourth invariant `embedding` to verifyMergedState, fed by existing getMemoryById fresh re-read projecting embedding. No new query/index/send, heal via existing retryWrite, token-only logs.

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `db/queries.ts` | file-modify | getMemoryById projection + embedding (REQ-01) |
| `src/store.ts` | file-modify | FreshSurvivorRow + readEmbeddingVector + embeddingsEqual + verifyMergedState 4th invariant + heal routing (REQ-02..05) |
| `docs/CONTRACT.md` | file-modify | v1.6 amendment, §2 + §3 + §5 updates (REQ-06) |
| `ROADMAP.md` | file-modify | F-01-EMB CLOSED 2026-09-24 (REQ-06) |
| `scripts/verify-lifecycle.ts` + `scripts/verify.ts` + `scripts/probe4.ts` | file-modify | Seams d1/d2/d3 (8 sends), live checks, f32 proof |

## Rationale

Maps REQ-01..06 to AC-01..05 per spec §7 traceability. No new component, no API change, no DDL.

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| Separate getMemoryEmbedding query | +1 send inside lock, violates envelope |
| Background re-index job | Stale vector window, breaks fail-closed |

## Approval Required From

- [ ] engineering owner (R1) — invariant semantics
- [ ] security owner (R2) — projection audit, token-only logs
- [ ] automation owner (R8) — CI suites green

## Risk Assessment

See full proposal in prior orchestrator synthesis: R-EMB-01 epsilon, R-EMB-02 payload 1.5KB, R-EMB-03 heal leak. Blast radius consolidation path only. Rollback: git revert 6 files.

> Rule honored: no repo file modifications beyond this proposal doc during proposal phase (code already in worktree per execute-spec lane with conditional approval).
