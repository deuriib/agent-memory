# Data Review: P3.1 (recap/handoff/lesson/delete)

**Reviewer:** review-data (data cross-cutting lens)
**Date:** 2026-09-22
**Verdict:** CONDITIONAL

## Checklist

- [x] Schema changes versioned — no schema change: `db/queries.ts` and `helix.toml` diff vs `e9fd325` is 0 lines; contract §1/§2 lines 26–109 hash-identical (`204ed61…` both sides). Zero new labels/edges/indexes/properties.
- [x] Data lineage documented — contract §3 P3.1 paragraph declares recap/handoff bullet shape, `lesson` = remember with forced `origin="lesson"`, `delete` = forget + governance line; verify.ts round-trip traces it (101 assertions).
- [~] Quality checks (nulls, types, ranges) — zod `.strict()` bodies, `reason` 1..1000 trimmed; gap: internal newlines/control chars not rejected (DAT-001).
- [~] PII handling compliant — access log unchanged (method/path/status/duration only, src/server.ts:498); no content/embedding/secret in any log (logSafeNote path); governance line logs id+reason+timestamp only. Gaps: free-text `reason` verbatim + no TTL/deletion declared for the new log store (DAT-001, DAT-002).
- [x] Migration path defined — additive-only; §4 "out of scope" text updated to un-scope these routes; nothing frozen touched.
- [x] Backfill strategy (if applicable) — n/a, no data migration.
- [x] Analytics impact assessed — none; no new fields on stored memories (`lesson` writes through `store.remember` with existing props only).

## Findings

| ID | Severity | Finding | Mitigation |
|----|----------|---------|------------|
| DAT-001 | Medium | Caller-supplied `reason` (and `memoryId`) logged verbatim on the new governance line: `reasonSchema = z.string().trim().min(1).max(1000)` only trims the ends, so an embedded `\n` forges extra log lines — audit-integrity break (CWE-117) and an open channel for PII into logs (src/server.ts:445, src/mcp.ts memory_delete `console.error`). | Strip/reject control chars (`[^\P{C}\n]` / `\s+ → " "`) or replace free text with an allowlisted reason vocabulary before logging; keep the contract's "reason is metadata, never content" guarantee enforceable. |
| DAT-002 | Medium | The governance log line is a NEW PII-capable store with purpose declared (contract §3 L146–148) but no TTL/deletion procedure — privacy baseline requires purpose + TTL + deletion for every store (Ley 172-13). Retention today is whatever the container/journald default is, undeclared. | Declare in contract §3 the log stream's retention (e.g. 30–90d rotation) and deletion path, or state that `reason` must be non-identifying so the line carries no personal data. |
| DAT-003 | Low | `deletedAt` is `new Date()` at receipt time in the route/tool handler, not a store-confirmed commit timestamp (src/server.ts:442) — receipt lineage is "acknowledged at", not "deleted at". Cosmetic unless a clock gap ever matters for erasure SLAs. | Optional: label it as acknowledgement time in contract §3, or source it from the store. |

No findings on the other packet items: recap/handoff content goes only to callers passing the same bearer gate as existing search routes (src/server.ts:273, src/mcp.ts `handle()` auth-first) — no new exposure class; receipt `{memoryId, deletedAt}` is minimal (2 fields, no content); signals/`failureSignal` appear in responses only, and logs go through `logSafeNote` (remote → stable code) — no embedding or memory content leaks into logs or new stored fields.

## Verdict Rationale

CONDITIONAL: schema/lineage/exposure/receipt are all clean (zero diff on frozen §1/§2 and `db/queries.ts`, no new stored properties), but the new governance log line needs newline sanitization of `reason` (DAT-001) and a declared TTL/deletion (DAT-002) before it can be called a compliant audit store — both are small, additive, non-schema fixes. DAT-003 informational.
