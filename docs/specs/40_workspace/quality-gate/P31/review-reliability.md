# Reliability Review: P3.1 (recap/handoff/lesson/delete)

**Reviewer:** review-reliability
**Date:** 2026-09-22
**Verdict:** PASS

**Scope:** `git diff e9fd325..HEAD` (6 commits) against
`references/engineering/reliability-review.md`, `IMPLEMENTATION_PLAN.md`,
`TEST_MATRIX.md`, `docs/CONTRACT.md` §3 P3.1 rows.
Evidence re-checked independently: `npm run typecheck` green (tsc exit 0);
`npm run verify` reported `101 passed, 0 failed` in the packet (not re-run —
review is read-only).

## Checklist

- [x] Error paths handled explicitly — every P3.1 path maps to an explicit
      status/result: `HttpError` → 4xx; digest store failures → `signals` +
      200; write-route store failures → explicit `500 internal_error`
      (`respondToError`, server.ts:460-476); MCP unexpected failure →
      `isError` result (`handle`, mcp.ts:165-182).
- [x] No swallowed exceptions — the two `try/catch` blocks in
      `buildDigestLines` both push `failureSignal(err)` into `signals`
      (server.ts:231-253, mcp.ts:131-153); `healthCounts` catch pushes
      `counts: …` (server.ts:400-405, mcp.ts:345-350). No empty catches in
      the diff.
- [x] Input validation at boundaries — all 4 bodies are `.strict()` zod
      (server.ts:76-102): `reason` 1..1000, `importance` 0..1, `limit` 1..100,
      `sessionId`/`project` 1..200; MCP `inputSchema` shapes mirror them.
- [x] Deterministic behavior — digest order is defined (session order, then
      memory order, one fixed bullet format); no hidden state; fresh arrays
      per call.
- [x] Edge cases tested — empty digest post-delete (`count === 0`,
      verify N9), unknown id → 404, repeat delete → 404, missing reason →
      400, extra `origin` key → 400, non-JSON body → 415 (frozen L).
- [x] Idempotency where required — `memory_recap`/`memory_handoff`
      annotated idempotent (pure reads); `memory_delete` annotated like the
      frozen `memory_forget`; repeat delete deterministically 404, matching
      the contract row.
- [~] Timeouts on external calls — no explicit timeouts on store calls; see
      RL-002 (pre-existing, bounded, out-of-lane).

## Focus Questions (packet)

| Focus | Verdict | Evidence |
|---|---|---|
| Recap/handoff per-call catch → signals, never 500 | **Yes, code does it** | `appendSession` wraps its own `store.sessionMemories` call; `listSessions` separately wrapped (server.ts:230-254, mcp.ts:130-154). No other store call exists on those routes; `respondToError` 500 is unreachable for store failures on recap/handoff. |
| Handoff counts-zeroing on `healthCounts` failure | **Yes** | `let counts = {memories: 0, sessions: 0}` — reassigned only on success; failure keeps `{0,0}` + `counts:` signal, header still renders, still 200 (server.ts:400-412, mcp.ts:345-356). |
| Lesson defaults | **Yes** | `sessionId: body.sessionId ?? randomUUID()` (node:crypto, server.ts:14/423), `project ?? "default"`, `importance ?? 0.5`, `origin: LESSON_ORIGIN` (server.ts:426, mcp.ts:377). Extra `origin` key → strict schema → 400 (verify N2); on MCP, unknown keys are stripped by the SDK validator but the handler forces `origin` anyway — fail-closed either way. |
| Delete validate-before-lookup ordering | **Yes** | `parseOr400(deleteBodySchema, …)` runs before `store.forget` (server.ts:435-436). Discriminating proof: verify `del3` sends an **already-deleted** id with no reason and asserts **400** — a lookup-first implementation would have returned 404. Unknown-id with reason → 404 (`del4`). |
| MCP governance write via `console.error` (stdout invariant) | **Yes** | mcp.ts:399 `console.error` for the governance line; grep shows **zero** `console.log` in `src/mcp.ts` (only `console.error` at 179/399/417); invariant comment at mcp.ts:412. REST uses `console.log` (server.ts:446) — correct for HTTP, and the access log line itself remains method/path/status/duration only. |
| verify.ts section N proves round-trip + doesn't break A–M math | **Yes** | N runs on a second fresh project `verify-p31-<uuid>`; K's `3 memories / 4 sessions` assertions target `project` and execute **before** N; N's health checks scope to `p31project`; only the summary (M) follows. Round-trip chain: lesson 201 + echo + uuid (N1) → strict `origin` rejected 400 (N2) → bm25 finds row with `origin === "lesson"` (N3) → recap echoes session, `count >= 1`, contains content (N4) → handoff frozen first line + `counts.memories >= 1` + content (N5) → health exactly 1/1, which also proves N2 stored nothing (N6) → delete 200 receipt (N7) → gone: bm25 + health 0 + repeat 404 + missing-reason 400 + unknown-id 404 + recap count 0 (N8). Abort guard if `rL` missing prevents cascading false FAILs. |

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | `sessionMemories` fails for one session mid-digest | `memories(<sid>): …` signal; other sessions still contribute lines; 200 | yes |
| FM-002 | `listSessions` fails (project-wide digest) | `sessions: …` signal; 200 with empty recap | yes |
| FM-003 | `healthCounts` fails on handoff | counts stay `{0,0}` + `counts:` signal; header renders; 200 | yes |
| FM-004 | lesson payload carries `origin` key | strict zod → 400, nothing stored (N2 + N6 prove) | yes |
| FM-005 | delete missing `reason` | 400 before any lookup (even for a deleted id) | yes |
| FM-006 | delete unknown / repeat id | 404 `{error:"not_found"}` (REST + MCP `isError`) | yes |
| FM-007 | store failure on lesson/delete writes | explicit 500 `internal_error`, `logSafeNote` log (fail-fast for writes; contract only mandates degradation for recap/handoff) | yes |
| FM-008 | unexpected MCP tool failure | `handle()` → `isError {error:"internal_error"}` + `console.error`; process survives, stdout stays protocol-only | yes |
| FM-009 | malformed / oversized / wrong content-type body | 400 / 413 / 415 before any store call (frozen `readJsonBody`) | yes |
| FM-010 | hung/slow store during digest | bounded to `1 + limit` (≤101) sequential calls, but no explicit timeout — see RL-002 | partial |

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RL-001 | Low | src/server.ts:446; src/mcp.ts:400 | Governance log line interpolates caller-supplied `reason` and `memoryId` raw. `reasonSchema`/`memoryIdSchema` use `.trim()` (edges only), so an embedded `\n` can forge extra log lines (log injection) — the helpers built for exactly this (`logSafeNote`/`trimmed`, errors.ts:19-22) are bypassed. Non-blocking: contract mandates logging `reason`; route it through `trimmed()` (or equivalent single-line normalization) to restore the one-line invariant. No secret and no memory content is at risk. |
| RL-002 | Low | src/server.ts:221-255; src/mcp.ts:125-159 | `buildDigestLines` issues up to `1 + limit` sequential store round-trips with no explicit timeout; a hung store hangs the request until the client gives up (MCP: until the call is cancelled). Pre-existing pattern — no store call anywhere in the repo sets a timeout, and `db/queries.ts`/store are frozen additive-only in this lane — and call count is bounded by `limit` (1..100, default 10). Track as a follow-up, not a P3.1 regression. |

## Verdict Rationale

**PASS** — every packet focus item is provably implemented as specified: digest
store failures degrade to `signals` with a 200 (never a 500), handoff counts
zero with a signal on `healthCounts` failure, lesson defaults and strict-origin
rejection hold, delete validates before lookup (discriminatingly tested),
MCP governance logging preserves the stdout protocol invariant, and section N
proves the full round-trip on an isolated second project without touching the
A–M count math. Two Low hygiene findings (log-line sanitization; pre-existing
missing store timeouts) are non-blocking follow-ups — neither violates the
contract nor the reliability checklist's core bars. Typecheck re-run green.
