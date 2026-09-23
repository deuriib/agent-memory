# Resilience Review: P1 (recall quality & lifecycle) + P2.1 (capture breadth)

**Reviewer:** review-resilience (engineering domain, 1 of 9 independent reviewers)
**Lane:** P1-P21 · **Scope:** `1c410ee..HEAD` (6 commits) + current files, against `docs/CONTRACT.md` v1.1
**Date:** 2026-09-23
**Verdict:** PASS

## Checklist

- [x] Graceful degradation under partial failure — every fusion/digest path degrades to 200 + `signals`; hook/plugin clients fail soft on every path (walkthrough a–d below)
- [x] Circuit breakers / retries with backoff — no retries anywhere by design (bounded cost: single-shot requests with hard timeouts, error caches in the plugin); fail-fast instead of retry storms
- [x] Resource limits (memory, CPU, connections) — 1 MiB hook stdin, 1 MiB REST body, 15 s store queries, 1.5 s/2 s client timeouts, LRU 64-entry caches, purge batch caps; two low findings on queue depth / ghost requests below
- [x] Recovery from crash / restart — REST/MCP stateless (only in-memory dedup tails, lost harmlessly on restart); SIGINT/SIGTERM graceful shutdown; Helix dev runs `storage = "disk"` (contract §0)
- [x] No single point of failure introduced — new surfaces (dedup lock, TTL/decay, purge, 4 hook events, `tool.execute.before`) add no new dependency a failure of which takes down the agent; Helix remains the pre-existing single store
- [x] Observability (logs, metrics, traces) — access log (method/path/status/duration), `signals` on every degraded path, `lastError` surfaced via `memory_health`, purge governance line; no metrics/traces — pre-existing scope, not required by contract
- [x] Chaos scenarios tested — dead server, dead backend, malformed/unsupported input, negatives all exercised live (115 capture + 73 injection checks); two code-only paths noted in the stress table

## Findings (5: 0 Critical, 0 High, 1 Medium, 4 Low)

### F1 — MEDIUM — Dedup pre-check fails OPEN on an unrecognized response shape
**Location:** `src/store.ts:435-466` (`rememberLocked`)
**Evidence:** The pre-check does `if (isRecord(existing)) { rowsOf(existing, ["memory"]) … }` and otherwise falls through to the INSERT. A genuine miss returns `null` (probe3 c2, `db/queries.ts` `findMemoryByDedupKey` comment) — but a *shape drift* (response object without a recognizable array, or a non-record payload) is indistinguishable from a miss and silently writes a second row. This contradicts contract §3 (“errors propagate: a broken lookup must never let a possible duplicate through”) and the file’s own doctrine: the sibling read paths all throw on shape drift — `saveMemory` asserts its `memory` return (`store.ts:498-500`), `healthCounts` throws on missing counts (`store.ts:588-593`), `hitsFrom` throws (`store.ts:249-254`). The one read whose contract explicitly promises fail-closed is the only one that fails open. Impact is conditional (requires a response-shape change from the pinned SDK/server) and degrades to duplicate rows (recall noise), not an outage — Medium per severity guide (conditional impact, fix within sprint).

### F2 — LOW — Purge loses partial-progress reporting on mid-run failure
**Location:** `scripts/purge.ts:259-291` (`purgeProject` local `deleted`), `311-347` (`main` + catch)
**Evidence:** The `deleted` counter and `results[]` are only printed after **all** projects complete; any mid-purge throw (Helix dies after 50k deletes, or the `healthCount` after-phase fails) discards them and the sole output is `purge failed: <err>` + exit 1. No governance line, no partial `deleted=<m>`, no indication that a destructive run was in fact partially applied. Exit code is correct and re-running converges (re-listing finds the remainder), so impact is reporting-only.

### F3 — LOW — Store timeout does not abort the underlying Helix request
**Location:** `src/store.ts:366-395` (`withTimeout` / `send`)
**Evidence:** `withTimeout` rejects the wrapper at `QUERY_TIMEOUT_MS` (15 s) but never cancels `client.query(request).send()` — no abort signal exists on that path. Against a black-hole Helix (accepts, never answers) the caller unblocks but the ghost request/socket stays in flight until the SDK/TCP layer gives up, so in-flight connections scale with call rate × 15 s. The dedup lock itself still releases on schedule (the lock awaits the wrapper, which settles) — no lock leak; this is a connection/resource bound only.

### F4 — LOW — Per-key FIFO queue: unbounded depth, no client-disconnect cancellation
**Location:** `src/store.ts:412-427` (`dedupTails` / `withDedupLock`)
**Evidence:** Leak-on-throw check: **clean** — the tail is `result.then(noop, noop)` (always resolves, a failed predecessor cannot poison the queue) and each waiter’s `finally` deletes its entry when it is still the tail, so the Map holds at most one entry per in-flight key. Stuck-request check: **bounded** — each hop runs two `send()`s capped at 15 s (≤ ~30 s hold), so no single request holds the lock forever. Residual: the promise *chain* under one key has no depth bound and queued work for already-disconnected callers (hook/plugin give up at 2 s) still executes; under sustained same-key arrival with a slow-but-alive Helix (plausible: hook contents like `tool used: Read` repeat → identical dedup keys) tail latency grows without backpressure. Affects `remember` only — searches, digests and recall take no lock.

### F5 — LOW — Hook stdin read has no time bound; >1 MB guard path untested
**Location:** `hooks/capture.mjs:94-108` (`readStdin` / `main`), `scripts/verify-capture.ts` (no such case)
**Evidence:** Every awaited step in `main()` is bounded (fetch 2 s via `AbortSignal.timeout`) **except** the stdin drain: `for await` over `process.stdin` only exits when the pipe closes or size > `MAX_HOOK_BYTES`. A host that writes its payload but never closes stdin hangs the hook indefinitely, and hosts typically wait for hook exit — the one path where a memory-side hiccup could touch the agent. Standard hosts close stdin after writing, and `verify-capture` always calls `child.stdin.end()`, so the hang path is untested by construction. Related gap: the >1 MB guard itself (break → truncated JSON → silent exit 0) has no test case — assurance is code-review-only (the path is sound by construction: truncated content cannot parse, and even a pathological parse yields allowlisted, length-bounded fields).

## Degradation-path walkthrough

**(a) `hooks/capture.mjs` — exit 0 + zero stdout/stderr on every path.**
All four gate paths hold: dead server → `AbortSignal.timeout(2000)` rejects → `.catch(() => undefined)` → `.finally(() => process.exit(0))`; malformed stdin → `JSON.parse` in try/catch → return; unsupported event → `SUPPORTED.has` → return; huge stdin >1 MB → break → unparseable → return (F5: untested, sound by review). Belt-and-braces `uncaughtException`/`unhandledRejection` handlers force exit 0 (lines 43-44). Diff `1c410ee..HEAD` confirms the old 3 events were **not weakened**: the exit-0 machinery, 2 s timeout, silence guarantees and the `SessionStart`/`Stop` fixed strings are byte-identical; only `observationFor` grew (old `PostToolUse` fallthrough preserved, now explicitly guarded). New events add fixed strings + one more fail-closed `null` case (missing/non-string `tool_name` stores nothing). Re-run: **115/115** (incl. section E dead-server).

**(b) Plugin `tool.execute.before`.**
`captureToolStart` (`plugins/.../agent-memory.ts:594-613`): `memory*` prefix skip → no self-observation loop; `void call(...).catch(() => undefined)` → detached, `AbortSignal.timeout(AUTO_TIMEOUT_MS = 1500)` bounds the POST; outer try/catch records a sync throw into `lastError` (clip 300 = `MAX_ERROR_CHARS`) so a throwing hook can never abort the turn; `call()` itself never throws (endpoint build, `fetch`, body read all caught). The registration wrapper (`:941-943`) is sync. The other hooks (`context`, `compaction`) wrap `autoRecall` in try/catch → “no injection” instead of a thrown turn; failed recalls are cached (`block: null`) for the 45 s TTL so a dead service costs one attempt per TTL, not one per turn. Re-run: capture D-section (dead backend: no sync throw, no unhandled rejection) green.

**(c) Dedup under Helix outage + lock bounds.**
Pre-check error **propagates** (fail closed) → `withDedupLock` never poisons the queue → `remember()` rejects → REST `/memory/remember` and `/lesson` return **500**, MCP `memory_save` returns an `isError` result — correct fail-closed semantics for a write: no duplicate is written, and the MCP `handle()` boundary (`src/mcp.ts:131-145`) means a dead Helix never crashes the stdio bridge. 500-on-down is contract-conformant: contract §3 forbids 500 only on the search/digest fusion paths, which do not touch the lock (walkthrough d). Lock: no leak on throw (F4, verified), never held forever (each hop ≤ two 15 s-bounded sends), distinct keys never block each other. Residuals: F1 (shape-drift fail-open), F3 (ghost requests), F4 (queue depth).

**(d) Search degradation + digest budget.**
`runSource` wraps each source; `embed()` is invoked *inside* the wrapped closure, so even an embed failure becomes a signal. All-sources-down → `Promise.all` of never-rejecting outcomes → empty `results` + per-source `signals` → **200, never 500** (bm25 and hybrid both). TTL and decay cannot break the contract: `filterExpired`/`decayedImportance` are pure, re-read env per call, and `readPositiveEnv` maps absent/NaN/`<=0` to OFF/factor 1 — a bad value degrades the feature, it cannot throw. TTL appends `ttl: hidden N expired rows` to the envelope *and* per-row signals — the signals contract survives filtering. `src/digest.ts` is untouched by this lane; its `DIGEST_BUDGET_MS` (20 s) is checked between sessions and every store call is individually wrapped → recap/handoff stay 200 with partial lines (worst case ≈ budget + one 15 s session call, bounded). Re-run: injection **ALL PASS (73)**.

**(e) Purge runaway guards.**
`MAX_BATCHES` 10 000 (hard stop even with progress), `BATCH_LIMIT` 500/page, `DRY_RUN_LIMIT` 100 000 (with cap warning), `SESSION_SCAN_LIMIT` 100 000, plus a no-progress guard: a batch whose `forgetMemory` calls report 0 deletions aborts instead of looping — so neither a non-deleting server nor an infinite page return can run unbounded. Helix down mid-purge → any `await` throws → `main().catch` → `purge failed: …`, exit 1 (operational, distinct from usage exit 2) — with F2: partial deletions already applied are not reported. Re-run: usage guard **exit 2** (before any Helix contact), `--dry-run` on `probe-p1-ttl` → `would-delete=1`, exit 0. Output stays allowlisted (plan line, ids/counts, governance line) — no content on any path, including the failure path.

**(f) Env knobs.**
Feature knobs fail to OFF, never to a crash: `AGENT_MEMORY_TTL_DAYS` / `AGENT_MEMORY_DECAY_LAMBDA` via `readPositiveEnv` (`src/lifecycle.ts:31-37`) — unparseable/non-finite/`<=0` → OFF/factor 1, read per call, zero throw paths; plugin `AGENT_MEMORY_INJECT[_LIMIT|_TTL_MS]` via `parseBool`/`envInt` → invalid → default; invalid `AGENT_MEMORY_URL` → `endpoint()` returns undefined → fail-soft note, no throw. Assumption stated: `AGENT_MEMORY_PORT` is a binding parameter, not a feature knob — invalid values **fail fast at boot** (`parsePort` throws, `server.ts:475-481`) rather than silently defaulting (a silent default could collide with the upstream-held 3111); failing to bind at all is the correct behavior there, never a half-started server. Re-run: `verify-env` **21/21**.

## Stress Scenarios

| ID | Scenario | Expected | Observed | Pass? |
|----|----------|----------|----------|-------|
| RS-001 | Hook vs dead memory server (port closed) | exit 0, stdout/stderr empty, 0 stores | capture §E: `down: exit 0 / stdout EMPTY / stderr EMPTY`, re-run 115/115 | yes |
| RS-002 | Hook vs hung server (accepts, never responds) | 2 s `AbortSignal.timeout` → exit 0 silent | by code review (`capture.mjs:151`); no black-hole-socket test case — timeout wiring is one line, reviewed | yes (code) |
| RS-003 | Malformed JSON / empty stdin / unsupported event / missing tool_name | 0 stores, exit 0, silence | capture §C: all negatives green (incl. non-string `tool_name`, secret-canary header-only) | yes |
| RS-004 | Huge stdin > 1 MB | guard breaks the read, still exit 0 silent | by code review (`MAX_HOOK_BYTES` → truncated JSON → parse fail); no test case (F5) | yes (code) |
| RS-005 | Plugin `captureToolStart` vs dead backend | no sync throw, no unhandled rejection, turn continues | capture §D: `dead backend: no synchronous throw / no unhandled rejection` | yes |
| RS-006 | Helix down mid-`remember` (pre-check throws) | fail closed: error propagates, no duplicate write, lock tail resolves, next waiter proceeds, MCP/REST error — no process crash | by code walkthrough (store.ts:394-432); REST 500 / MCP `isError` is contract-correct for writes | yes (code) |
| RS-007 | All search sources down | 200 + empty results + signals, never 500 | by code walkthrough (search.ts:70-101,150-224) + injection 73 green; TTL/decay env-defensive (lifecycle.ts:31-37,102-119) | yes (code) |
| RS-008 | Purge runaway / no-progress / missing args | bounded batches, abort on 0 deletions, usage exit 2 | guard exit 2 re-run OK; dry-run would-delete=1 exit 0; `MAX_BATCHES` + no-progress guard read at `purge.ts:259-288` | yes |
| RS-009 | Bad env values (TTL, decay, inject, URL) | feature OFF / default, boot never crashes | verify-env 21/21 re-run green; invalid port fails fast by stated assumption (f) | yes |
| RS-010 | Dedup pre-check returns an unrecognized shape | fail closed (contract §3) | **fails open → duplicate write** (F1) — conditional, Medium | no (F1) |

## Gate evidence (cheap re-runs executed 2026-09-23)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 — no errors |
| `verify-lifecycle` | 34/34 (dead-server-independent, pure) |
| `verify-capture` | 115/115 (incl. dead-server section E, dead-backend section D) |
| `verify-injection` | ALL PASS (73) |
| `verify-env` | 21/21 |
| `purge.ts` no-args guard | exit 2 |
| `purge.ts --dry-run --days 30 --project probe-p1-ttl` | `would-delete=1`, exit 0 |
| Packet-trusted (not re-run): `verify` 131/131 on OUR server 3151 (upstream iii on 3111 untouched), `probe3` GREEN, demo OK, gitleaks → CI P0.2 | as recorded in IMPLEMENTATION_PLAN / TEST_MATRIX |

## Verdict Rationale

**PASS.** No Critical or High findings: the two surfaces where a memory hiccup could become an agent outage — the capture hook and the OpenCode plugin hooks — are bounded and fail-soft on every path (exit 0 + silence by construction, detached POSTs with hard timeouts, sync throws caught, error caches), proven live by 115 capture + 73 injection checks. Search and digest paths cannot produce a 500 under any upstream failure, TTL/decay/purge/env knobs degrade to OFF with no throw path, and the dedup lock answers both gate questions cleanly: no leak on throw, never held forever (≤ ~30 s per hop).

The single Medium (F1) is a conditional fail-open in a path the contract labels fail-closed — tracked for remediation within the sprint, does not block release per severity guide (exploitability/prod-impact/data-loss criteria not met: pinned SDK shape, worst case = duplicate rows). Four Lows are bounded residuals of deliberate design choices (serialised dedup correctness, fail-fast purge exit, wrapper-style timeout, stdin protocol assumption), each documented with owner-visible evidence above; residual risk is explicit and accepted for this release.
