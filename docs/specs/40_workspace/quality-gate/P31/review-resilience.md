# Resilience Review: P3.1

**Reviewer:** review-resilience
**Date:** 2026-09-22
**Verdict:** PASS

## Checklist

- [x] Graceful degradation under partial failure — every digest store call is individually wrapped; Helix down on recap/handoff → 200 + `signals`, never 500; write paths (lesson/delete) fail to sanitized 500 `internal_error`.
- [ ] Circuit breakers / retries with backoff — N/A: none introduced; the inherited per-call 15s timeout (`src/store.ts:36,388`) is the failure bound, no retry loops added.
- [ ] Resource limits (memory, CPU, connections) — payload bounded by `limit` ≤ 100 sessions × ≤ 100 rows; **latency aggregate unbounded → RS-F1**.
- [x] Recovery from crash / restart — no new in-process state; `server.on("error")` exits 1 with `logSafeNote` (`src/server.ts:521-524`); MCP `main().catch` exits 1 sanitized (`src/mcp.ts:416-419`).
- [x] No single point of failure introduced — same single HelixStore as before; digests degrade *around* it instead of failing with it.
- [x] Observability (logs, metrics, traces) — access log unchanged (method/path/status/duration, `src/server.ts:496-499`); governance delete line on both surfaces; `signals`-in-body matches the frozen §3 fusion pattern (`src/search.ts` does not log them either); 500s logged sanitized to stderr.
- [ ] Chaos scenarios tested — partial: `scripts/verify.ts` asserts the count-0/404/400 paths live, but no automated dead-store test exists; store-down paths verified by code trace (below).

## Stress Scenarios

| ID | Scenario | Expected | Observed | Pass? |
|----|----------|----------|----------|-------|
| RS-001 | Helix down during `recap`/`handoff` (REST) | 200 with partial/empty text + `signals`, never 500 | `buildDigestLines` wraps `sessionMemories` per session (`src/server.ts:227-240`) and `listSessions` (`:246-252`); handoff wraps `healthCounts` (`:398-404`). Failures land as `memories(<sid>): …` / `sessions: …` / `counts: …`; route returns 200 | yes |
| RS-002 | Helix down during `recap`/`handoff` (MCP) | `ok()` result with `signals`, not `isError` | Identical digest in `src/mcp.ts:110-157`; `counts` wrapped at `:344-350` → tool returns `ok` with signals | yes |
| RS-003 | Helix down during `lesson` (`remember` throws) | 500 `{"error":"internal_error"}`, sanitized log, access line still written | `store.remember` rejection escapes `routeRequest` → `respondToError` non-HttpError branch (`src/server.ts:469-477`) → 500 + `logSafeNote` stderr; access log status 500 via `.then` (`:496-499`) | yes |
| RS-004 | Helix down during `delete` (`forget` throws) | 500 `internal_error`; receipt and governance line NOT emitted on failure | Receipt `sendJson` (`src/server.ts:447`) and governance `console.log` (`:441-445`) are both strictly after `await store.forget` — a throw skips both and hits the 500 path; `!deleted` → 404 before receipt; no false audit trail | yes |
| RS-005 | Helix slow during digest fan-out | Per-call capped at 15s | `withTimeout(…, 15_000)` in `store.send()` (`src/store.ts:36,388`) — all five store methods used by P3.1 route through it; but calls are sequential, so aggregate = 15s × N → **RS-F1** | partial |
| RS-006 | MCP process survival, store dead | `handle()` catch → `isError` `internal_error`, process alive, stdout protocol-only | `src/mcp.ts:168-182`: op throw → stderr `logSafeNote` + `failed({error:"internal_error"})`; grep confirms zero `console.log` in mcp.ts — governance line uses `console.error` (`:399`) | yes |
| RS-007 | Upstream holds port 3111 | Clean exit, documented 3151 procedure | `server.on("error")` → `logSafeNote` + `exit(1)` (`src/server.ts:521-524`); README procedure `AGENT_MEMORY_PORT=3151 npm run dev` / `AGENT_MEMORY_URL=…3151 npm run verify` untouched by diff and `scripts/verify.ts:22` honors `AGENT_MEMORY_URL` — still correct | yes |
| RS-008 | Empty session / empty project recap | Graceful 200, caller can distinguish emptiness | 0 memories → `{recap:"", count:0, signals:[]}`; empty project → `sessions=[]`, loop skipped, same shape; handoff still emits `project=… memories=0 sessions=0 recent:` header. Live-asserted post-delete (`scripts/verify.ts:616-621`); empty-*project* variant shares the identical code path | yes |
| RS-009 | Frozen guarantees survive | 15s timeout, hooks exit-0, access-log shape, stdout protocol-only, additive-only | `git diff --name-only e9fd325..HEAD` touches only plan/readme/matrix/contract/verify/mcp/server — `hooks/`, `db/queries.ts`, `helix.toml`, `src/store.ts` untouched; typecheck green rerun on review | yes |

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RS-F1 | Medium | `src/server.ts:218-254` + `:396-405`; `src/mcp.ts:110-157` + `:342-351`; bound at `src/store.ts:36,388` | Recap/handoff is the first route that fans out N sequential store calls (`listSessions` + N × `sessionMemories` [+ `healthCounts`]), each capped at 15s. With a slow-but-alive Helix (queries hang, connection up), default `limit=10` → ~165s before the 200-with-signals response; `limit=100` → up to ~1500s. Degradation is *correct* (no 500, no wrong data) but latency-unbounded — clients/MCP hosts may time out first, masking the signals payload. Conditional impact: fully-down Helix fails fast (ECONNREFUSED), so only the slow-store case pays. Remediation suggestion for implementer (not this reviewer): an aggregate deadline or `Promise.allSettled` fan-out. |
| RS-F2 | Low | `src/server.ts:441-445`; `src/mcp.ts:397-401`; `reasonSchema` `src/server.ts:44` / `src/mcp.ts:79` | Governance `reason` is validated only `trim().min(1).max(1000)` — embedded `\n`/control chars pass through into the audit line, letting a caller forge extra log lines (`memoryId=… reason=a\n[agentmemory] fake`). Observability-integrity failure mode of the new delete route: the audit trail's one-line guarantee is caller-forgeable. Secret and access log unaffected; memory content never logged. Sanitize to printable/single-line at the boundary. |

## Verdict Rationale

Every mandated failure path traces clean: digests degrade per-call to 200 + `signals` on both surfaces, write routes fail to sanitized 500/`isError` without emitting receipts or audit lines on failed deletes, MCP survives a dead store, port-conflict and empty-digest behavior are graceful, and all four frozen guarantees survive untouched — PASS with 1 Medium (conditional slow-store latency, scheduled-fix profile) and 1 Low (log-line hygiene) recorded for GATE_REPORT; neither blocks the gate.
