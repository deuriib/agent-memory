# ADR-0001: Application-side dedup uniqueness (per-key FIFO lock, index #8 as accelerator)

**Status:** Accepted 2026-09-23 · **Lane:** P1-P21 (v0.4.0) · **Domain owner:** engineering
(first ADR in this repo — establishes the `docs/adr/` convention)

## Context

REQ-P1-6 requires that saving the same fact twice returns the existing id with one
retrievable row. Helix v0.0.6 does **not** enforce unique-equality indexes: probe3
proved it empirically — `b2` duplicate `dedupKey` write ACCEPTED, `d1` third duplicate
ACCEPTED, `d2` duplicate rows enumerable, `d3` equality read tolerates them (no
read-time enforcement either), `a3-2` a node *missing* the property is accepted.
CONTRACT §0 pins these as verified facts. The architecture contract therefore changed
(CONTRACT v1 → v1.1: `Memory.dedupKey`, index #8, `findMemoryByDedupKey`) — and this
record exists because that contract change demands an ADR.

## Options

1. **Rely on index enforcement** — REFUTED empirically: probe3 b2/d1/d2/d3; no
   `unique_constraint_violation` exists to catch, so a catch-based design would be dead code.
2. **Application-side pre-check under a per-key FIFO lock; index #8 as lookup
   accelerator** — chosen: sound within a single writer process, fail-closed, testable.
3. **No dedup** — rejected: fails REQ-P1-6 acceptance outright.

## Decision

Option 2, implemented in `src/store.ts`: `remember()` computes
`dedupKey = sha256(project + "\n" + normalize(content))`, serializes per key via
`withDedupLock`, then `findMemoryByDedupKey` pre-checks **fail-closed** — a transport
error or a response missing the frozen `memory` return throws; shape drift is never
read as a miss. `bootstrapIndexes()` still creates index #8 so the pre-check lookup
stays fast; it never carries the uniqueness guarantee.

## Consequences

- **Single-writer-process assumption** — dedup is sound only within ONE writer process;
  cross-process writers to one Helix instance are out-of-contract residual risk
  (CONTRACT §3 "Single-writer assumption (RL-001)", owner: engineering; multi-instance
  is ROADMAP P4.3).
- **Legacy rows lack `dedupKey`** — no retro backfill; harmless per probe3 a3-2
  (missing-property nodes are accepted); documented backfill gap in CONTRACT §3.
- **Dedup first-wins × hook-observations** — repeat hook/lesson observations of
  identical content return the first row (its original origin/session; a dedup hit
  creates no Session node) — declared in CONTRACT §3 and pinned by `verify.ts` F4.
- Guarded by suites: `verify-lifecycle` golden keys, `verify.ts` dedup/race/F4 sections.

**Links:** `docs/CONTRACT.md` §0/§1/§3 · `src/lifecycle.ts` header + `contentHash` ·
`scripts/probe3.ts` (b2/d1/d2/d3/a3-2) · `docs/specs/50_archive/P1-P21/GATE_REPORT.md`
