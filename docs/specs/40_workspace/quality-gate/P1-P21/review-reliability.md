# Reliability Review: P1-P21 (lane P1 + P2.1)

**Reviewer:** review-reliability (engineering domain — 1 of 9 independent reviewers)
**Date:** 2026-09-23
**Scope:** commits `1c410ee..HEAD` (b27364b, 101e063, 45380b5, 8fbd795, 6f7f708, eb279a6) via `git show`/`diff` + current files
**Verdict:** **PASS** — re-verified 2026-09-23 after remediation commit `9210208`; both conditions CLEARED (see [Re-verification](#re-verification-round-2026-09-23-remediation-9210208)). Original CONDITIONAL verdict and findings preserved below.

## Checklist

- [x] Error paths handled explicitly — REST `respondToError` (src/server.ts:423-446), MCP `handle` catch → `internal_error` (src/mcp.ts:131-145), search sources → `signals` (src/search.ts:70-79), purge `main().catch` → exit 1 (scripts/purge.ts:345-348), hook fail-soft by contract (hooks/capture.mjs:43-44,155-157). Exception: purge's Helix sends have **no timeout** (RL-002).
- [x] No swallowed exceptions — store/search/purge propagate; hook/plugin swallow **by documented design** (exit-0 / never-block-the-agent contract), asserted by verify-capture incl. dead-server path (115/115 evidence).
- [x] Input validation at boundaries — zod `.strict()` on every REST body/query (src/server.ts:72-135), MCP zod schemas (src/mcp.ts:31-111), purge `--days` regex `^[1-9][0-9]{0,5}$` + scope requirement (scripts/purge.ts:84-99), plugin `str`/`strList`/`fraction` narrowing (plugins/opencode/plugins/agent-memory.ts:346-373).
- [x] Deterministic behavior — one fixed clock per search (`nowMs` captured once, src/search.ts:178), deterministic embed/tokenize/hash/concepts (no locale/randomness/clock), `$id` ordering where the server can't sort DateTime (db/queries.ts:294,482).
- [x] Edge cases tested — TTL exact boundary survives, unparseable `createdAt`, empty/punctuation input, λ invalid/0/negative, usage guard exit 2, dead server (verify-lifecycle 34/34, verify-capture 115/115, verify-env 21/21 — evidence trusted).
- [x] Idempotency where required — duplicate `remember` → same id + `deduped:true` (incl. concurrent race → same id, verify.ts F3/race); `forget` second call → `not_found`; hook always exit 0.
- [ ] Timeouts on external calls — store wraps every send in 15 s `withTimeout` (src/store.ts:366-396); plugin 1.5-2 s and hook 2 s `AbortSignal.timeout`. **purge.ts sends have none** → RL-002 (this is the one checklist line not fully met).

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | Dedup pre-check lookup throws (Helix error/network) | Error propagates, **no insert** (fail-closed), lock released via `finally` | yes (src/store.ts:435-440,422-426) |
| FM-002 | Two concurrent `remember` same key, **one process** | Per-key FIFO lock serializes; waiter re-runs pre-check → same id, `deduped:true` | yes — race test green (verify.ts:516-557) |
| FM-003 | Two concurrent `remember` same key, **separate processes** (REST + stdio MCP) | Not serialized — duplicate can be admitted (server does NOT enforce index #8) | **NO — RL-001** (assumption must be stated: single writer process) |
| FM-004 | Pre-check error / missing `memoryId` on hit / hit from other project | Throw — never return a bad or foreign id | yes (src/store.ts:447-457) |
| FM-005 | Dedup hit echoes stored row's sessionId/concepts instead of request's | Must echo REQUEST (contract §3) | yes (src/store.ts:460-463) |
| FM-006 | Invalid/`<=0`/non-finite `AGENT_MEMORY_TTL_DAYS` / `DECAY_LAMBDA` | Feature OFF, factor 1 — bad config never invents decay/expiry | yes (src/lifecycle.ts:31-37), tested |
| FM-007 | Unparseable `createdAt` | Never inflates/zeroes score (factor 1), row never hidden | yes (src/lifecycle.ts:86-87,110-114), tested |
| FM-008 | Row exactly at TTL boundary (`age == ttl`) | Survives (strict `>` expiry) | yes (src/lifecycle.ts:116), tested |
| FM-009 | Future-dated `createdAt` (clock skew) | `exp(+)` grows → clamped to 1; order-only, stored value untouched | yes, bounded (src/lifecycle.ts:89) — see RL-005 (Info) |
| FM-010 | Helix down during search | `results: []` + `signals`, never a 500 | yes (src/search.ts:70-101) |
| FM-011 | Helix down during remember | Propagates → REST 500 / MCP `internal_error`; no phantom write | yes (src/store.ts:498-500 also rejects no-op writes) |
| FM-012 | `saveMemory` returns without `memory` var | Throw — silent no-op write can't masquerade as success | yes (src/store.ts:498-500) |
| FM-013 | purge bad args (`--days` missing/0/float, no scope, unknown flag) | Usage + **exit 2**, nothing executed | yes (scripts/purge.ts:57-100) |
| FM-014 | purge `--dry-run` | Zero deletions — return before any `forgetMemory` | yes (scripts/purge.ts:239-255) |
| FM-015 | purge batch makes no progress / runaway | Abort on `batchDeleted === 0` and `MAX_BATCHES=10000` → exit 1 | yes (scripts/purge.ts:260-262,284-288) |
| FM-016 | purge `listExpired` row missing `memoryId` / bad shape | Throw → exit 1 (fail-closed) | yes (scripts/purge.ts:169-183) |
| FM-017 | Helix hangs (accepts connection, never responds) during purge | Should time out and exit 1 | **NO — RL-002** |
| FM-018 | Dedup lock predecessor rejects | Tail still resolves (`then(noop, noop)`) → queue never poisons, no deadlock/starvation; FIFO per key, distinct keys never block | yes (src/store.ts:414-427) |
| FM-019 | Hook: server dead/slow, malformed stdin, unsupported event | Exit 0 + silence within 2 s abort — agent pipeline never blocked | yes (hooks/capture.mjs:151,155-157), tested |
| FM-020 | Hook/plugin auto-path failure | Fail-soft: no injection + `lastError`, cached per TTL (no hammering) | yes (plugin :557-573) |

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RL-001 | Medium | src/store.ts:412-427; src/mcp.ts:373; src/server.ts:455; scripts/verify.ts:516-557 | **Cross-process dedup race (probe3 finding honored, assumption must be explicit).** The per-key FIFO lock is correct — no deadlock (predecessor tails always settle resolved), no starvation (strict FIFO per key), released on throw (`finally` at :422-426 deletes only if still tail, no map leak) — and the pre-check is fail-closed (errors propagate, project double-check at :447-453, request echo at :460-463, `project` inside sha256 at src/lifecycle.ts:68-70). BUT the lock lives **per HelixStore instance**: REST (`createDefaultStore` server.ts:455) and stdio MCP (`createDefaultStore` mcp.ts:373) each build their OWN store writing **directly to Helix**, and probe3 b2/d1 proved the server does NOT enforce index #8. README documents running REST + MCP side by side (hooks/plugin → REST, MCP → direct Helix), so concurrent identical saves across the two processes can both pass the pre-check and insert twice — violating T-102 "one retrievable row". The green race test only races inside ONE REST process. **Stated assumption: application-side dedup is sufficient only for a single writer process (single instance) per Helix store.** The limit is code-documented (store.ts:409-410 "documented residual risk") but carries no owner/expiry in the gate record and no operational constraint in README/CONTRACT. Evidence: git 101e063, probe3 GREEN, store.ts:398-411. |
| RL-002 | Medium | scripts/purge.ts:158-160, 207-211, 240-248, 263-278; node_modules/@helix-db/helix-db/dist/index.js:226 | **No timeout on purge's Helix sends — checklist "Timeouts on external calls" fails for this path.** The v3 client's `send()` is a bare `fetch` with no `AbortSignal`; store.ts wraps every call in `withTimeout(15s)` but purge talks to Helix **directly** (by design) with no wrapper. A hung instance after the plan line leaves the CLI blocked forever — no exit code, no failure signal to cron/CI (destructive runs that already deleted some rows just stop mid-loop; re-run resumes correctly, so impact is availability of the tool, not data corruption). Evidence: index.js:226 `fetch(url, {method, headers, body})` (verified no timeout/abort in the client); purge has zero timeout constants. |
| RL-003 | Low | src/store.ts:441-466 | **Pre-check treats a non-record response as "miss" and proceeds to insert.** Errors propagate correctly (fail-closed), but if `send()` ever resolves a non-object body (array/string/`null` from a shape anomaly), `isRecord(existing)` is false → falls through to the write. Every other reader (`hitsFrom`, `healthCounts`, purge `expiredIds`) throws `missingShapeError` on an absent result array; the dedup pre-check — the one path whose job is to never admit a possible duplicate — is the only reader that silently accepts a missing/malformed shape. Legit miss (`{memory: null}`, probe3 c2) stays a miss; only a non-throwing malformed body is at issue, hence Low. Evidence: contrast src/store.ts:252/556/590 (throw) vs :441-466 (insert). |
| RL-004 | Low | src/search.ts:214-217, 94-96 | **TTL filter runs after the limit cut.** Both paths slice to `limit` first, then drop expired rows — expired rows consume slots, so a response can be shorter than `limit` even when fresh candidates existed just below the cut. Documented as a deliberate "no over-fetch" tradeoff (comments :92-93, :212-213); correctness and the `ttl: hidden N` signal (only when N>0) are intact. Recall shortfall only when TTL is ON. Evidence: hybrid slices then filters; bm25 filters the store's already-capped k. |
| RL-005 | Info | src/lifecycle.ts:88-89; scripts/verify-lifecycle.ts:229-233 | **Future-dated `createdAt` (clock skew) grows the decay factor above 1 → clamped to 1**, giving a skewed row maximum tie-break weight. Bounded by `clamp01`, affects ORDER only, displayed importance stays the STORED value, and it is explicitly tested ("clamp high → 1"). No action required; recorded for completeness of the TTL/decay edge-case sweep. |

## Gate Evidence Consumed (trusted, not re-run)

typecheck 0 · verify 131/131 (incl. concurrent race → same id + `deduped {false,true}`) · verify-lifecycle 34/34 (env fail-closed, clamp, TTL boundary/unparseable, concept determinism) · verify-capture 115/115 (7 events, silence, exit 0, dead server) · verify-injection 73 · verify-env 21 · probe3 GREEN (server does not enforce unique index; `ltParam` dateTime strict older-than) · purge `--dry-run` would-delete=1 + usage guard exit 2 · demo OK. gitleaks local unavailable (2 timeouts, escalated) → CI P0.2 secret-scan enforces on push (not an engineering-reliability blocker).

## Checklist Coverage & HARD-Focus Map

- (a) dedup correctness → RL-001 (single-process sufficiency + stated assumption), RL-003 (pre-check shape); lock deadlock/starvation/release-on-throw, fail-closed pre-check, project double-check, request echo, project-inside-sha256 all verified **pass**.
- (b) decay/TTL → env fail-closed, clamp01, unparseable `createdAt`, strict `age > ttl` boundary, both search paths filter, signal only when N>0, displayed importance = stored value: all verified **pass**; RL-004/RL-005 recorded as Low/Info.
- (c) purge CLI → `--days` int ≥1 required, `--project`|`--all` required + mutually exclusive (both argument orders), `--dry-run` returns before any delete, batch/no-progress/runaway caps, exit 0/1/2, per-id `forgetMemory` (never multi-drop), Helix direct: all **pass**; RL-002 is the one gap (no send timeout).
- (d) probe3 finding honored → yes: index #8 documented as read-accelerator only (CONTRACT §0, db/queries.ts:117-120, lifecycle.ts:10-15); app-side pre-check+lock judged sufficient **under the single-writer-process (single instance) assumption** — surfaced as RL-001 with owner/expiry condition.
- (e) concept extraction → deterministic (shared tokenizer, fixed stopwords, tf-desc → code-unit lex asc, top-8) and explicit-concepts-win invariant (src/store.ts:477-478; deduped echo keeps `[]` as `[]`) verified **pass** (T-101 evidence trusted).

## Verdict Rationale

**CONDITIONAL** — no Critical/High findings; every hard focus area except the purge timeout line holds under evidence, and the dedup lock is mechanically sound within one process. Two Medium conditions must be closed or formally accepted (owner + expiry) before this lane is called PASS:

1. **RL-002** — add a timeout wrapper to purge's Helix sends (mirror store.ts `withTimeout`), or record it as an accepted risk with owner/expiry in the gate record.
2. **RL-001** — record the **single-writer-process (single instance)** assumption as an accepted risk with owner/expiry (CONTRACT/README operational note), or enforce it; today it is only a code comment.

RL-003 (Low) and RL-004 (Low) go to backlog; RL-005 is informational. Residual risk is explicit: cross-process dedup admits duplicates in an REST+MCP-simultaneous deployment — Medium, conditional impact, fix within sprint.

---

# Re-verification round (2026-09-23, remediation `9210208`)

**Reviewer:** review-reliability (same reviewer, round 2 — no third loop needed)
**Date:** 2026-09-23
**Verdict:** **PASS**

Scope of this round: re-verify ONLY conditions C1 (RL-001) and C2 (RL-002) from the
original CONDITIONAL verdict, from code/docs, independently. Read-only on source
(no source edits); only this artifact updated. No server started; upstream iii on
3111 untouched; Helix never restarted (one read-only `purge --dry-run` query issued).

## Per-condition status

### RL-001 (single-writer-process assumption only in a code comment) — **CLEARED**

**Condition:** record the single-writer-process assumption as an accepted risk with
owner (CONTRACT/README operational note), or enforce it.

**Evidence independently read (not taken from the commit message):**

- `docs/CONTRACT.md` §3 lines 193-197 now carry a named, contract-level bullet:
  *"**Single-writer assumption (RL-001):** Dedup is application-side and sound
  within ONE writer process (REST or MCP in a single server instance — our
  documented deployment, §4 non-goal = multi-instance); cross-process writers to
  one Helix instance are out of contract (residual risk, owner: engineering)."*
  → assumption stated explicitly, residual risk declared, **owner: engineering**
  recorded. This is no longer "only in a comment": it sits in the canonical
  contract surface (§3 semantics), which is where my condition asked for it.
- The mechanism itself was already sound and is unchanged: per-key FIFO lock
  (src/store.ts:414-427) with `finally` release, fail-closed pre-check, project
  double-check, request echo, project inside sha256.

**Judgment:** the condition is satisfied — accepted-risk record exists at
contract level with owner + justification. It does **not** need to remain a waiver
row: a waiver row is required when a condition is unmet or only partially met;
here the record my condition explicitly allowed ("or record it as an accepted
risk…") is present and findable by anyone reading the contract.

**Notes (non-blocking, do not reopen the condition):**

- The bullet's justification cites *"§4 non-goal = multi-instance"*, but §4
  (`docs/CONTRACT.md:345-349`, "Out of scope for v1") does **not** list
  multi-instance among its items (4-tier consolidation, LLM auto-compress,
  viewer UI, Replay, JSONL import, agent adapters, 54-tool MCP surface).
  Conversely `ROADMAP.md:116` row **P4.3 "Multi-instance"** describes a second
  instance as a *planned* row. The pointer is therefore stale/mis-cited —
  harmless to the condition (the operative clause is "out of contract, residual
  risk, owner: engineering", which stands on its own), but I record it so the
  next docs pass fixes the cross-reference rather than propagating it.
- Expiry was not demanded by my original C1 wording (I required owner + record),
  and a hard expiry for an architectural non-goal has no natural date — owner +
  "out of contract" boundary is the right shape here. Not a condition.

### RL-002 (purge.ts Helix Client has no timeout) — **CLEARED (accepted-risk record acceptable)**

**Condition:** add a timeout wrapper (mirror store.ts `withTimeout`), OR record as
accepted risk with owner in the gate record with compensating controls.

**SDK claim independently confirmed** (told to verify myself — did):

- `node_modules/@helix-db/helix-db/dist/index.d.ts`: `Client.constructor(url?:
  string | null)` takes only a URL (:90); `QueryExecutionRequest.send()` /
  `sendBytes()` take **no options at all** (:125-126); grep of all `dist/*.d.ts`
  for `timeout|AbortSignal|signal` returns **zero** timeout/abort API hits (only
  unrelated index-build `abortIndexOperation`/`IndexOperationStage` names).
- Cross-checked the implementation from my round-1 review:
  `dist/index.js:226` is a bare `fetch(url, { method, headers, body })` — no
  `AbortSignal`, no timeout. The specialist's claim is **accurate**: the SDK
  exposes no Client/transport timeout knob, so a wired timeout would have to
  wrap at call sites (which store.ts does via `withTimeout`) — and the documented
  instruction not to hack SDK internals is a legitimate call. Note the nuance:
  store.ts *does* wrap every one of its sends in `withTimeout(15s)` around the
  public `send()`, so an equivalent wrap was technically reachable without
  touching SDK internals; the specialist's path B (accepted risk) was the
  explicitly permitted alternative in my condition, and the compensating
  controls are real, so I clear rather than escalate. Recorded as a
  follow-up-worthy nuance, not a condition.

**Accepted-risk record + compensating controls independently verified:**

- `scripts/purge.ts:31-38` header: named RL-002/C6, SDK-claim citation with the
  exact inspection points (`dist/index.d.ts`, `send()` no options), compensating
  controls listed, "Residual risk accepted — owner: engineering", "Do NOT fake a
  timeout via SDK internals".
- `docs/CONTRACT.md:226-230`: same accepted-risk text at contract level
  (owner: engineering).
- Compensating controls are present in code, not just prose:
  fail-closed arg guard — re-run live: missing `--days` → **exit 2**,
  `--days 0` → **exit 2**, missing scope → **exit 2** (usage errors exit before
  any deletion, so a hung Helix is never even contacted on a bad invocation);
  batch bounds `BATCH_LIMIT=500` / `MAX_BATCHES=10000` + no-progress guard
  (unchanged from round 1, verified again in file); NEW per-batch
  `purge-progress project=… batch=… deleted=…` stderr line (purge.ts, after each
  batch) giving operator liveness; operator Ctrl-C documented as the bounded
  exit. Partial-failure audit line (`status=partial` before exit 1) further
  limits the blast radius of an interrupted run.

**Judgment:** condition **CLEARED**. The accepted-risk record — the alternative
my condition explicitly offered — exists in TWO places (tool header + contract),
owner assigned, SDK claim verified true by me, and compensating controls are
real code, not documentation theater. A waiver row is not warranted: a waiver is
for unmet conditions; this one is met by the permitted path. Residual risk
(a hung Helix stalls the CLI indefinitely) is accepted, owned by engineering,
and bounded in impact (no data corruption — deletions are per-id idempotent and
re-runnable; the guardrails' accepted-risk pattern is satisfied).

## Cheap re-runs (this round)

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit **0** |
| `npx tsx scripts/verify-lifecycle.ts` | **34 passed, 0 failed** — VERIFY PASS |
| purge usage guard: missing `--days` | **exit 2** (stderr usage, no query sent) |
| purge usage guard: `--days 0` | **exit 2** |
| purge usage guard: missing scope | **exit 2** |
| `purge.ts --days 7 --project probe-nonexistent-zzz --dry-run` | plan + `would-delete=0`, **exit 0** — no deletions, single-line output (oneLine guard visible) |

Server: none started this round. Upstream iii/3111: untouched. Helix: never
restarted; only read-only queries issued. Note: `verify` was NOT re-run this
round (specialist reports 152/152 incl. new F4 section; trusted per gate-evidence
rule, and no server was started to avoid lifecycle churn) — if the orchestrator
wants it observed green again it is a cheap separate run on 3151.

## Round-2 findings (append to the findings table above)

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RL-006 | Low | docs/CONTRACT.md:195 vs :345-349 | Single-writer bullet justifies itself as *"§4 non-goal = multi-instance"*, but §4 does not list multi-instance; `ROADMAP.md:116` (P4.3) actually treats multi-instance as a planned row. Mis-cited cross-reference — fix the pointer in the next docs pass; does not weaken the operative out-of-contract clause. |
| RL-007 | Info | scripts/purge.ts:31-38; docs/CONTRACT.md:226-230; node_modules/@helix-db/helix-db/dist/index.d.ts:90,125-126 | SDK no-timeout claim **confirmed true** by independent inspection; accepted-risk record present with owner + compensating controls. Nuance for the record: a call-site wrapper around the public `send()` (the `withTimeout` pattern store.ts already uses) was technically reachable without touching SDK internals — future work if the CLI hang ever matters in practice; not a condition. |

## Round-2 status of prior findings

| ID | Prior severity | Status after 9210208 |
|----|----------------|----------------------|
| RL-001 | Medium | **CLEARED** — contract §3:193-197 accepted-risk record (owner: engineering). Residual: RL-006 (mis-cited §4 pointer). |
| RL-002 | Medium | **CLEARED** — SDK claim verified, accepted-risk record ×2, compensating controls live (guards re-run exit 2). Residual: RL-007 (Info). |
| RL-003 | Low | **Resolved by 9210208 (C3)**, verified in diff: `!isRecord(existing) \|\| !Object.hasOwn(existing, "memory")` → throw; non-array non-null `memory` → throw; `null`/`[]` remain legitimate misses — shape drift can no longer be read as a miss. |
| RL-004 | Low | **Open, backlog** — TTL filter still runs after the limit cut (unchanged; documented "no over-fetch" tradeoff in contract §3:210). Not a condition. |
| RL-005 | Info | **Open, informational** — future-dated `createdAt` clamps to 1 (tested). Not a condition. |

## Round-2 overall verdict: **PASS**

Both original conditions are CLEARED: RL-001 by a contract-level accepted-risk
record with owner (the record path my condition allowed), RL-002 by a
verified-true SDK claim plus an accepted-risk record with owner and real
compensating controls (the record path my condition allowed). No remaining
condition has severity Medium or higher; remaining items are Low (RL-004, RL-006)
and Info (RL-005, RL-007) — backlog/hygiene, none block the lane. No third loop
was needed (both conditions cleared on first re-verification); nothing escalated.
