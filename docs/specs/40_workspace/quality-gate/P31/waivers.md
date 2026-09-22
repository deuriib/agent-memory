# Quality Gate Waivers: P3.1

**Issued By:** engineering owner + orchestrator (single-maintainer repo: both
roles recorded under the frame-ship delegation contract — stated explicitly as
the assumption behind this judgment call; security owner co-signs the
security-domain waiver W1)
**Date:** 2026-09-22
**Gate Status at Waiver:** CONDITIONAL — C3 FAIL was carried by record gaps
(R2, R6, R14, R15, R16) plus two substantive rows since fixed in `d7a7628`
(R13 masking declaration) and `addc589` (R17 schema bounds), which need no
waiver and flip on proof.
**Expiry default:** 90 days or next release, whichever first
(orchestrator-confirmed; re-review owner mandatory per record below)

## Reviewer(s) Overridden

| Reviewer | Verdict | Reason for Override |
|----------|---------|---------------------|
| review-refuter (via C3 R2/R14) | conditional | Unknown-key behavior on the MCP lane accepted with compensating controls — W1 |
| review-risk (via C3 R6) | conditional | Receipt-omits-reason accepted as by-design with the governance log as the reason of record — W2 |
| security-reviewer (via C3 R2/R14) | conditional | Same acceptance as W1, security-domain co-sign required |
| review-data (via C3 R15) | conditional | `project` newline in returned digest text accepted — no log sink exists — W3 |
| review-resilience (via C3 R16) | conditional | Best-effort digest budget accepted against the frozen store interface — W4 |

No verdict is being flipped by force: every CONDITIONAL's substantive
conditions were remediated (COND-001..006, R13, R17 — proof in
`c3-interrogation.md`); these records cover only the residual accepted risks
that C3 found without a mandatory Expiry + re-review owner block.

---

## W1 — MCP lane strips unknown keys instead of rejecting (C3 R2 + R14; security domain)

**Accepted-risk:** MCP `tools/call` input is SDK-mediated: unknown keys
(e.g. an extra `origin` on `memory_lesson`) are silently stripped rather than
400-rejected as the REST lane does (CE-002/SEC-003). Why accept: forcing
reject requires custom MCP schema middleware outside P3.1's approved file
list; the dangerous key (`origin`) is server-forced in BOTH lanes, so the
stripping cannot be leveraged to spoof provenance; the behavioral difference
is documented rather than hidden.

**Compensating-controls:** (1) REST strict-rejects unknown keys — proven by
verify N2 (extra `origin` → 400) in `scripts/verify.ts`; (2) `origin` forced
`"lesson"` server-side in `src/mcp.ts` regardless of stripping; (3) README
Defaults/notes paragraph states the REST-rejects vs MCP-strips difference
(`fff74ad`); (4) all 11 MCP tools pass the `_meta.authorization` gate —
unauthenticated callers cannot reach the tool at all. Owner: engineering
owner (implementation), security owner (acceptance). Evidence-ref:
`docs/specs/40_workspace/quality-gate/P31/review-refuter.md` CE-002,
`security-review.md` SEC-003, commits `fb2e451`, `fff74ad`.

**Expiry:** 2026-12-21 (90 days) or the next change to the MCP input layer /
MCP tool surface, whichever first. Re-review owner: security owner.

**Sign-off:** engineering owner + orchestrator + security owner.

**Residual-risk:** non-`origin` unknown keys dropped without error on the
MCP lane only — Low — owner: engineering.

---

## W2 — Governance receipt omits `reason` (C3 R6; engineering domain)

**Accepted-risk:** the `/agentmemory/delete` receipt returns only
`{memoryId, deletedAt}`; the caller's justification is not echoed back. Why
accept: by design the reason has exactly ONE durable place — the governance
log line — and duplicating it into the receipt would create a second copy
with no retention policy; contract §3 documents the omission explicitly
(`f2a65d4`).

**Compensating-controls:** (1) governance line carries `memoryId` +
single-line-normalized `reason` + `at` on both lanes (`5df18b6`), emitted
only after a confirmed delete; (2) contract §3 declares the line's
purpose/store/retention/deletion and the receipt semantics (`f2a65d4`,
`d7a7628`); (3) field allowlist + no-PII-in-reason operator rule (`d7a7628`).
Owner: engineering owner. Evidence-ref: `docs/CONTRACT.md` §3,
`src/server.ts` delete handler.

**Expiry:** 2026-12-21 (90 days) or the next contract revision touching the
delete route (a natural moment to thread `reason` into the receipt), whichever
first. Re-review owner: engineering owner.

**Sign-off:** engineering owner + orchestrator.

**Residual-risk:** if the host discards process logs, the receipt↔reason link
is lost — Low — owner: deploying operator (log retention).

---

## W3 — `project` newline reaches returned digest text (C3 R15; engineering domain)

**Accepted-risk:** `project` is interpolated into the handoff header line
(`project=<project> …`) without newline normalization, so a project value
containing `\n` could visually split the returned digest text. Why accept:
there is NO log or export sink for digest output — recap/handoff text is
returned only to the same authenticated caller who supplied the project;
memory content legitimately contains newlines, so normalizing digest bodies
would be wrong, and the tenant key itself (`project` ≤200 chars) is bounded.

**Compensating-controls:** (1) digest text never reaches any log — access log
is method/path/status/duration only; MCP stdout is protocol-only
(`console.error` for diagnostics); (2) bearer guard precedes the routes;
(3) `project` bound 1..200 at the boundary. Owner: engineering owner.
Evidence-ref: `src/server.ts` access-log + digest call sites,
`src/mcp.ts` stdout invariant.

**Expiry:** 2026-12-21 (90 days) or immediately upon ANY change that gives
recap/handoff output a log/export sink (that change re-triggers security
review). Re-review owner: engineering owner; security owner co-reviews if a
sink is added.

**Sign-off:** engineering owner + orchestrator.

**Residual-risk:** none while no sink exists — `none + engineering owner`;
converts to a security finding the moment a sink is added.

---

## W4 — Digest budget is best-effort wall-clock (C3 R16; engineering domain)

**Accepted-risk:** `DIGEST_BUDGET_MS = 20_000` is checked BETWEEN store
calls; one in-flight call may still run its full 15s cap, so worst-case
latency is ≈35s (20 + 15), not a hard 20s kill. Why accept: hard-killing
mid-call would break the per-call `signals[]` degradation model (the row that
was in flight would be silently lost instead of reported), and eliminating
sequential fan-out would require a new batched sessionMemories query — a
`db/queries.ts` change explicitly outside P3.1's frozen file list.

**Compensating-controls:** (1) budget stop + `digest: budget exceeded` signal
(`3221b93`) — bounded, visible degradation instead of the prior ~25-minute
theoretical fan-out; (2) inherited per-call 15s store timeout
(`src/store.ts` QUERY_TIMEOUT_MS); (3) `limit` bound 1..100 caps call count.
Owner: engineering owner. Evidence-ref: `src/digest.ts`, verify 102/0 green
post-change.

**Expiry:** 2026-12-21 (90 days) or the next digest/performance change,
whichever first. Re-review owner: engineering owner.

**Sign-off:** engineering owner + orchestrator.

**Residual-risk:** worst-case ≈35s recap/handoff latency under a degraded-but-
alive Helix — Medium (latency only, no data impact) — owner: engineering.

---

## PII checkpoint (REQ-SEC-003/004 + REQ-P-006 co-sign)

Zero PII/secrets/tokens/credentials/sessions in this waiver text. Evidence
cited is commit SHAs, file paths, and finding IDs only — allowlisted evidence
only; Ley 172-13 minimization: the governance log's purpose/TTL/deletion and
field allowlist are declared in `docs/CONTRACT.md` §3 (`d7a7628`). No raw
memory content, reason text, or secret value appears anywhere in this file.

## Sign-off

- [x] orchestrator — 2026-09-22, P3.1 gate lane
- [x] engineering owner — W2, W3, W4 (single-maintainer delegation, assumption stated above)
- [x] security owner — W1 only (security-domain waiver co-sign)
