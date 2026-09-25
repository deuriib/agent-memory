# Resilience Review: Brainy v1 (SPEC-001..005)

**Reviewer:** review-resilience (independent; did not write the code under review)
**Date:** 2026-09-25
**Verdict:** conditional
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..de518b7` (HEAD `de518b7`)
**Role prompt:** `/mnt/DATA/GitHub/dotfiles/dot_config/opencode/prompts/review-resilience.md`
**Checklist:** `/mnt/DATA/GitHub/frame-ship/skills/quality-gate/references/engineering/resilience-review.md`

## Checklist

- [x] Graceful degradation under partial failure (all search paths degrade via `signals` — one exception: RL-001)
- [x] Circuit breakers / retries with backoff (fail-fast, no retry loops; per-source isolation; per-key FIFO locks; see analysis)
- [x] Resource limits (memory, CPU, connections) (1 MiB body → 413; 200k content; 10k query; limit 1..100; max_depth 1..3; vector_top_k 1..20)
- [x] Recovery from crash / restart (Helix disk storage; 0600/0700 state; append-only audit; idempotent stop/start; restart survival proven live)
- [x] No single point of failure introduced (per-source independence; per-key lock partitioning; no new SPOF)
- [x] Observability (logs, metrics, traces) (safe access log; `logSafeNote` on 500; `signals` envelopes; `VERDICT` line on doctor)
- [~] Chaos scenarios tested (restart-window incident + re-run green; live 413/15s-timeout probes honestly not-run — TEST_MATRIX gap item 6)

## Stress Scenarios

| ID | Scenario | Expected | Observed | Pass? |
|----|----------|----------|----------|-------|
| RS-001 | HelixDB down / unreachable mid-request | writes fail-closed (500, never silent success); reads degrade to `results: []` + `signals` | writes: `send()` throws after 15s `withTimeout` (`src/store.ts:852-854`), `respondToError` → 500 + `logSafeNote` (`src/server.ts:885-894`); reads: per-source `runSource` catch → `signals` (`src/search.ts:81-90,241-249`); live incident (Helix restart window → `internal_error`, green on re-run, TEST_MATRIX lane note) | yes |
| RS-002 | Embed provider timeout / failure | keyless deterministic fallback, no network on hot path | hot paths (`src/store.ts:1013`, `src/search.ts:195`) use sync `embed()` — pure, no network, no key, no failure mode. `embedWithProvider` (`src/embed.ts:114-142`) has zero callers in `src/` (grep: definition only) — provider failure cannot touch any request path | yes |
| RS-003 | MinIO / object storage unavailable | fail-closed abort, volume never destroyed | Brainy code never talks to MinIO directly (Helix container owns it); `--migrate --apply` fails closed `MIGRATE ABORT: unsupported-runtime` before any write (Probe A3); old volume never destroyed (`bin/brainy.mjs` abort-first branch; verify-ops §H) | yes |
| RS-004 | Oversize / abusive input | 413 / 400 fail-closed, never OOM | `MAX_BODY_BYTES` 1 MiB → 413 `payload_too_large` (`src/server.ts:32,314`); zod caps 200k content / 10k query / limit 1..100 / `max_depth` 1..3 / `vector_top_k` 1..20; CLI mirrors caps (200k text, 10k query). Live 413 probe honestly not-run (TEST_MATRIX gap 6) | yes* (code proven, live probe gap noted) |
| RS-005 | Crash / restart recovery | state survives, no secret leak, idempotent lifecycle | state `<parent>/state/slot-N.json` closed-schema 0600 in 0700 dir, secret-free (`bin/brainy.mjs:478-539`); audit line per destructive action (`:550-566`); remember→search survives `helix restart` + stop/start (TEST_MATRIX bar #10, REQ-P4-OPS-07); SIGINT/SIGTERM graceful close + 500ms force-exit (`src/server.ts:999-1005`) | yes |
| RS-006 | Port collision (incl. 3111/3112/3113) | refuse exit 1 + reroute hint, never signal foreign PID | pre-flight quartet probe → `REFUSE` + neverKillHint, zero signals (`bin/brainy.mjs:963-998`); `verifyOwnedPid` re-verified pre-SIGTERM *and* pre-SIGKILL (`:1187-1296`); verify-ops §B/§C/§I 124/124 re-run green this review | yes |
| RS-007 | Stop/restart idempotency | double-stop exit 0, stale state handled | absent state → `not running` 0; dead PID → `already exited`; start with live owned PID → `already running` 0; stale state removed with notice (`bin/brainy.mjs:939-961,1199-1203`); proven live slot-2 double-stop (TEST_MATRIX bar #10) | yes |
| RS-008 | Partial source failure in hybrid search | surviving sources still contribute; failure recorded | per-source `runSource` outcomes fused independently; failures → `signals`, never 500 (`src/search.ts:239-249`); traversal-enrichment failure degrades silently *by design* (enrichment-only, base row intact, `:297-299`) | yes |
| RS-009 | `GET /v1/context/:project` text-probe failure | LOUD degradation (`signals` entry, like every sibling) | QUIET: `catch { memories = []; }` with no signal (`src/server.ts:549-553`) — response reports `memoriesCount: 0` as fact. See RL-001 | **no** |

## Findings

| ID | Severity | Location | Finding + Evidence |
|----|----------|----------|--------------------|
| RL-001 (adopted) | Med | `src/server.ts:549-553` | Quiet failure: `GET /v1/context/:project` substitutes `memories=[]` on text-probe failure with no `signals` entry — the sole search-adjacent path that degrades silently. Every sibling degrades LOUD (`src/search.ts:241-249`, `src/server.ts:721-734` handoff counts). Evidence: `read src/server.ts:546-562` (try/catch → `memories = []`, 200 payload has no `signals` key); reliability review FM-008/RL-001 concurs. Owner: R1. Remediation (bounded): append a `signals: ["text: <failureSignal>"]` entry to the context payload — additive, no contract break. |

Non-findings (analyzed, accepted as observations — not counted):

- `withTimeout` (`src/store.ts:785-799`) races rather than cancels: the timer rejects the caller at 15s while the underlying Helix promise continues unobserved. No leak (timer cleared on settle), no caller-side harm, and the standard shape for SDK calls without abort support. No action.
- `embedWithProvider` fetch (`src/embed.ts:118-129`) carries no `AbortSignal.timeout` — unbounded wait on OpenAI outage. Zero callers in `src/` (ripgrep `embedWithProvider` → definition only); hot paths use sync `embed()`. If it is ever wired into a request path, a bounded timeout + `signals` degradation is mandatory. Owner if wired: R1. Module-cohesion drift already tracked as RD-004 (Info).
- `appendAudit` (`bin/brainy.mjs:550-566`) swallows audit-write failure (`catch → return false`, return value ignored by callers). Audit continuity is best-effort by design; the audited action itself still succeeds or fails LOUD. No action; noted so a future audit-reliability pass has a baseline.

## Ruling on RL-001 (reliability reviewer's finding)

**Concur — genuine resilience condition, severity Med, not a blocker.** The resilience contract requires every degraded path to be LOUD (no silent empty success); RS-009 proves this route is the single exception. Read-only context assembly, no data loss, no crash propagation, bounded one-line-class fix — hence **conditional**, not fail. Adopted as this review's sole finding (no duplicate ID minted).

## Ruling on COND-RD-003 (readability `hooks/capture.mjs` header vs `extractTodos`/`collectBody`)

**Documentation condition, not a resilience or privacy blocker from this lens — concur with readability, defer substance to security.** Resilience facts: the hook is exemplary fault isolation — always exits 0 (`:50-51,288-290`), bounded 2s/1.5s `AbortSignal.timeout` on every fetch (`:200-205,226-232`), fire-and-forget, never blocks the agent. The drift (header `:27-29` "payloads deliberately NOT captured" vs `extractTodos`/`collectBody` reading `transcript/session_body/body/content/prompt.text/tool_output/result` at `:236-286`, plus the JSON-stringify fallback at `:280-282`) changes no failure behavior; it is a comment-accuracy + PII-allowlist question. The privacy half is already cross-domain-requested to the security reviewer by readability (RD-003 residual). This review adds no second request — one owner (security) dispositions the allowlist; engineering reconciles the header. No verdict impact here.

## REQ rows covered (resilience lens)

| REQ-ID | Resilience lens | Basis |
|--------|-----------------|-------|
| REQ-BRAINY-ENG-09 | hybrid/bm25 never-500, per-source degradation | `src/search.ts`, RS-001/RS-008, live `signals:[]` no-500 |
| REQ-BRAINY-ENG-05/06/07 | write-path fail-closed under contention (FIFO locks, no lost append) | `src/store.ts` dedup/survivor locks, T-RL-001 E2E |
| REQ-BRAINY-OPS-02/03 | start refuse + never-kill; stop idempotent, owned-PID-only signals | `bin/brainy.mjs`, RS-006/RS-007, verify-ops 124/124 |
| REQ-BRAINY-OPS-05 | doctor ordered checks + single VERDICT, exit precedence | `bin/brainy.mjs` cmdDoctor, verify-ops §E |
| REQ-BRAINY-OPS-07 | restart durability, 0600/0700 state, audit continuity | RS-005, TEST_MATRIX bars #7/#10 |
| NFR-BRAINY-ENG-01 | p95 latency (gap: 10k leg not run — RL-003, adopted by reference, not re-counted) | `docs/benchmarks/SCORECARD.md` |
| NFR-BRAINY-OPS-01 | never-kill, secret non-printing, port parity | verify-ops §I/§J/§L 124/124 |

## Independently re-verified (read-only, this review)

- `npm run typecheck` — exit 0, 0 errors.
- `npm test` — 80 passed, 0 failed.
- `npx tsx scripts/verify-lifecycle.ts` — 123 passed, 0 failed / VERIFY PASS.
- `npx tsx scripts/verify-ops.ts` — 124 passed, 0 failed / VERIFY PASS (incl. never-kill §I, C1 zero-Auth proof).
- Ports 3111/3112/3113 never touched, never probed; no file modified except this artifact. Commit range `7757ac1..de518b7`.

## Verdict Rationale

Degradation posture is strong and LOUD everywhere it matters: every Helix call bounded at 15s, every search source isolated with `signals`, hot-path embedding failure-proof by construction (no network), port collisions fail closed with reroute hints, lifecycle fully idempotent with restart survival proven live, and two full verify harnesses re-run green. One genuine quiet failure (RL-001, Med) on a read-only assembly route prevents PASS; bounded fix with a named owner — hence **conditional**, not fail.

## Residual risk + owner

- `GET /v1/context/:project` may under-report `memoriesCount` as fact until RL-001 carries a signal. Owner: R1.
- p95 at 10k-node scale unknown until the scale harness exists (RL-003, by reference). Owner: R1/R8.
- `HELIX_URL`-only store construction misdirects canonical-only configs loudly, never corruptively (RL-002, by reference). Owner: R1.
- Live 413/15s-timeout probes not run (TEST_MATRIX honest gap 6) — code caps proven by suite + schema, live probe outstanding. Owner: R1/R8.

## Cross-domain requests (for orchestrator)

- None new. COND-RD-003 privacy half already owned by the security reviewer via readability's request (RD-003 residual); RL-002/RL-003 remediation owned by R1/R8 via reliability's conditions. This review concurs by reference and opens no duplicate lanes.
