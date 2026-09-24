# Resilience Review: REQ-RL-001 + REQ-F-01 (residual-closure lane)

**Reviewer:** review-resilience (independent gate reviewer, resilience lens)
**Date:** 2026-09-24
**Scope (commits, main, unpushed):** `01224cc` REQ-RL-001 (per-survivor FIFO
lock + fresh re-read), `a0257d6` REQ-F-01 (post-write verify + ONE heal +
fail-closed named throw; guard-path concept heal; `getMemoryById` /
`memoryConcepts` / `linkMemoryConcepts`), `fb8e661` docs (CONTRACT v1.5,
README, CHANGELOG). Diff reviewed: `git diff a9ef417..HEAD`.
**Packet (accepted by reference):** SPEC:ROADMAP.md#1.3-rows-RL-001,F-01 +
docs/CONTRACT.md#v1.5-amendment (§2+§3-tier-1+§5) / HARD:subagents+
review-only+no-code-edits+no-push / GATE:execution-evidence-
commits-01224cc,a0257d6,fb8e661-bar-green / DOMAINS:R1-engineering,resilience.
**Verdict:** ⚠️ **conditional** — 3 conditions (COND-RS-01..03).

## Checklist

- [x] Graceful degradation under partial failure — search keeps its
  never-500 `signals[]` posture (unchanged by this lane; live-confirmed);
  write path degrades the OTHER way BY DESIGN: every new failure throws
  fail-closed → `500 {"error":"internal_error"}` (src/server.ts:439-447),
  never `consolidated:true` without a committed+verified write.
- [~] Circuit breakers / retries with backoff — none exist, none added.
  Deliberate fail-fast posture with exactly ONE bounded retry (the F-01
  heal). Acceptable for the single-writer deployment, but the lock-queue
  has no wait bound (finding 2).
- [~] Resource limits — both FIFO `Map`s clean up correctly under failure
  (head-checked delete, settled tails: src/store.ts:522-533); entry count
  bounded by in-flight ops **per key**, but queue DEPTH per key is
  unbounded and hold time grew (finding 2).
- [x] Recovery from crash / restart — in-process locks cannot go stale
  (fresh Maps on restart; fail-closed on Helix restart); disk-side crash
  window honestly small but under-documented (finding 4).
- [x] No single point of failure introduced — Helix remains the documented
  SPOF (pre-existing, contract §0); no new SPOF; a dead lock owner
  (process) resets cleanly.
- [x] Observability — new throws name the violated invariant
  (src/store.ts:1036-1038, 988-990); logged via `logSafeNote`
  (src/errors.ts:63-73, remote diagnostics reduced to stable code);
  500 body carries no detail; access log = method/path/status/duration
  only (src/server.ts:466-469).
- [~] Chaos scenarios tested — the REAL incident (Helix container restart
  mid-lane → `internal_error` 500s → green after recovery) is documented
  with evidence (TEST_MATRIX.md:62), and the §I seam traps skipped/extra
  sends offline; but no test drives the NEW throw families (finding 3).

## Failure-mode traces (resilience lens specifics)

1. **Helix dies mid-merge (probe → fresh read → write → verify → heal).**
   Every step goes through `send()` (src/store.ts:477-479, 15s per-send
   timeout). A death/reject at the fresh read
   (src/store.ts:834-878), the write (889-916), a verify read
   (1017-1026), or a heal (959-992) throws → `mergeUnderSurvivorLock`
   rejects → `withSurvivorLock`/`withDedupLock` `finally` blocks delete
   their tail entries (src/store.ts:529-533) → `rememberLocked` rejects
   WITHOUT falling through to the plain insert (src/store.ts:632-633
   only catches the `undefined` expired-fallthrough, not throws) →
   `respondToError` → clean `500 internal_error`. The caller NEVER gets
   `consolidated:true` for an unverified write. A rejected predecessor
   does **not** poison the queue: every tail is
   `result.then(()=>undefined, ()=>undefined)` (src/store.ts:524-527), so
   the next waiter chains on a resolved promise. Observed live in-lane:
   TEST_MATRIX.md:62 (container restart window → 500s → re-run green, no
   code change) — today's re-run: green (Evidence § below).
2. **Partial heal states / crash between write and verify.** Write
   committed, verify read fails → 500, but the merge IS on disk; a
   retrying caller re-sends the same content → exact-dedup misses
   (incoming key ≠ merged key) → probe → fresh read → SUBSTRING GUARD
   (incoming ⊂ fresh, src/store.ts:752-753) → guard path runs
   `ensureConceptLinks` (764) → no duplicate append, missing links healed,
   `consolidated:true` accurate. Content can never be lost (merge only
   grows, src/store.ts:707-708) and never duplicated (substring guard +
   exact-dedup on merged text). If NO retry ever comes, a links-only
   partial commit persists until the next near-dup save — lazy heal, no
   journal (finding 4).
3. **`signals[]` contract consistency.** The diff touches no search code
   (diff stat: src/search.ts absent); the new paths live only in the
   WRITE path. Read paths still degrade to `200 + results[] + signals[]`
   (src/search.ts:88-111, 186-264) — live-confirmed today: bm25 and
   hybrid probes both `200` with `signals` present. Remember keeps its
   fail-closed posture: no new silent-skip — every new read asserts its
   shape (getFreshSurvivor 838-867, readLinkedConcepts 931-941,
   linkMemoryConcepts presence 975-984, verify 1017-1039), and the old
   blind guard-return (return-without-read) was REMOVED (753-773).
4. **Two nested FIFO Maps under sustained distinct-key load.** Per-key
   entry is deleted only when still the head (src/store.ts:532) — correct
   under interleaved waiters, no leak, no deadlock (fixed acyclic order
   documented 495-503: dedupKey OUTER → survivor INNER, one survivor per
   merge). Unbounded aspects: queue depth per key and the lock-WAIT time
   of a waiter (its own outer lock is held while queued) have no cap and
   no deadline (finding 2).
5. **Test resilience (§P / §G / §I).** Order-independent by construction:
   unique per-run projects `verify-rl001-<uuid>` /
   `verify-f01-<uuid>` (scripts/verify.ts:1477, 1592), explicit forget
   cleanup asserts (1568, 1717); §I seam is fully offline (unreachable
   `127.0.0.1:9`, scripts/verify-lifecycle.ts:856-866) with a call-ORDER
   trap that fails loudly on any skipped/extra send (983-1015). Flake
   analysis: jaccard geometry worst case 31/34 ≈ 0.912 ≥ 0.9 is covered
   in the construction comment (verify.ts:1453-1466); `Promise.all`
   concurrency is the subject under test, and asserts hold under every
   interleaving; the f-01 `1/61` delta is deterministic — local
   deterministic embedder (src/embed.ts), unique UUID concept ⇒ graph
   rank 1, and the recall ledger affects tie-BREAK order only, never
   scores (src/search.ts:169-179, 214-246). Residual flake classes:
   index visibility right after a Helix restart window (pre-existing,
   probe4 verdict-A dependency, documented) — a variant probe seeing no
   base row would fall to plain insert and fail `memories = 1` loudly,
   never silently pass.
6. **Restart-survival honesty.** Locks and recall ledger are in-process by
   design and documented as such (contract §3 single-writer :263, ledger
   reset :339; README #8 :547); a restart cannot leave a stale lock. The
   honest gap is the Helix-side crash window between write and verify —
   see finding 4.

## Stress Scenarios

| ID | Scenario | Expected | Observed | Pass? |
|----|----------|----------|----------|-------|
| RS-001 | Helix dies between probe and fresh re-read | throw propagates, both locks released via `finally`, no queue poison, caller gets 500, never `consolidated:true` | code-trace src/store.ts:524-533, 632-633, 834-878; live incident TEST_MATRIX.md:62 behaved exactly so | yes |
| RS-002 | Helix dies between write and verify | caller told error (fail-closed), retry idempotent via substring guard, no loss/duplication | code-trace src/store.ts:752-773; guard-path byte-identical E2E `f-01: survivor content BYTE-IDENTICAL…` | yes |
| RS-003 | Partial commit: content ok, concept links lost, Helix healthy | ONE link-only heal + re-verify, else named throw | §I seam canned partial commit → 5 sends, NO insert (verify-lifecycle.ts:983-1015); f-01 E2E graph-delta proves heal | yes |
| RS-004 | Rejected predecessor in a FIFO queue | tail settles resolved; later waiters run; entry cleaned when head | static: src/store.ts:522-533; induced probe rejection exists (verify-lifecycle.ts:889) | yes |
| RS-005 | Store/search failure on READ path | 200 + `signals[]`, never 500 | live probes today: bm25 + hybrid `200 {"…","signals":[]}` | yes |
| RS-006 | Sustained load, identical keys, hung (not dead) Helix | bounded queue/wait or documented bound | no cap anywhere: src/store.ts:517-534, per-send-only timeout :50, no handler deadline src/server.ts:456-475 | **no → finding 2** |
| RS-007 | Re-run / order independence / cleanup | isolated projects, rows forgotten, counts deterministic | 2 full green runs (lane TEST_MATRIX.md:50-51 + mine below), forget asserts present | yes |
| RS-008 | Restart of our server / of Helix | no stale locks; disk rows survive; in-flight requests fail closed | fresh-Maps reasoning + incident note; crash-window doc gap → finding 4 | partial |

## Findings

1. **[Medium] ROADMAP anchor rows contradict the CLOSED verdict.**
   `ROADMAP.md:68` (RL-001) and `ROADMAP.md:70` (F-01) still declare both
   residuals OPEN in present tense — "can lose one append", "does not heal
   a partial commit" — with expiry 2026-12-31, while the same lane's docs
   commit declares them closed: `docs/CONTRACT.md:52-72` (v1.5
   amendment, tier-1 (a)+(b) "CLOSED 2026-09-24"), `README.md:547`
   (limitation #8 REMEDIATED), `README.md:582` (#11 REMEDIATED),
   `CHANGELOG.md:20,29`. The packet's own SPEC anchor is this ROADMAP
   table; the established closure pattern sits one row above
   (`ROADMAP.md:69`, DAT-001 "**CLOSED**"). `fb8e661` picked up CONTRACT,
   README, CHANGELOG — and missed ROADMAP. → **COND-RS-01**.
2. **[Medium] Unbounded FIFO-lock queue depth and no end-to-end request
   deadline; the lane amplifies worst-case hold time.** `withFifoLock`
   has no queue cap, wait timeout, or bail-out (src/store.ts:517-534) and
   `QUERY_TIMEOUT_MS` bounds each send, not the request (src/store.ts:50).
   RL-001/F-01 add up to ~6 extra 15s-timeout round-trips INSIDE the
   outer dedup lock (fresh read :744, guard concept read/heal :764,
   write+verify :795-809, verify reads :1018-1019, heal :1030-1032), so a
   HUNG (accepting-but-silent) Helix plus a client retry storm — exactly
   the incident's blast pattern (TEST_MATRIX.md:62) — stacks identical-key
   waiters unboundedly: last-in-line latency ≈ N × full-merge duration,
   promise-chain memory grows with N, and there is no circuit breaker to
   shed it. Single-writer, low-concurrency deployment makes this
   conditional-impact, not probable-impact. → **COND-RS-02**.
3. **[Medium] The NEW fail-closed throw families have no negative tests
   (chaos checklist partial).** CONTRACT claims fresh-read
   fail-closed on vanished/wrong-id/non-string-content
   (`docs/CONTRACT.md:297-311`) and a post-heal named throw
   (`docs/CONTRACT.md:312-333`), but no seam/E2E test drives
   src/store.ts:850-867 (fresh-read miss/wrong row), :931-941
   (`memoryConcepts` shape drift), or :1035-1039 (verify still violated
   after one heal). §I only proves the success call-order (trap on
   skipped sends, verify-lifecycle.ts:983-1015) plus the PRE-EXISTING
   induced probe error (:889). The claims rest on code-reading + one
   observed incident, not on assertions. → **COND-RS-03**.
4. **[Low] Crash-window honesty gap in the v1.5 amendment.** A process
   crash between write and verify leaves an unverified (possibly
   links-partial) merge on disk with no journal; it is healed only lazily
   by the NEXT guard-path save, and only when that save's effective
   concepts cover the lost links (src/store.ts:795-809, 753-764).
   CONTRACT v1.5 says "DETECTED-and-healed app-side, not engine-
   guaranteed" (`docs/CONTRACT.md:62-70`) but never states the crash
   window, the no-journal reality, or the lazy-heal precondition —
   README #11 (`README.md:582-598`) inherits the same wording.
5. **[Low] Session-node accumulation grows per run, budget undeclared
   for `verify.ts`.** The new blocks novel-write once each → +2 `Session`
   nodes per run (base insert `rlSid0`, `fSidA`; merges create none —
   scripts/verify.ts:1477-1482, 1592-1596) and no session deletion path
   exists. The run-budget residual (COND-DAT-002 style) is declared only
   for `verify-skills` (docs/CONTRACT.md §5); `verify.ts` has no declared
   budget. Pre-existing class, increment only.

**Severity counts:** Critical 0 · High 0 · Medium 3 · Low 2.

## Conditions

- **COND-RS-01** (finding 1): update `ROADMAP.md` §1.3 rows RL-001 and
  F-01 to the DAT-001 CLOSED pattern (CLOSED date, residual now
  "same-process only / engine atomicity detected-and-healed", pointers to
  CONTRACT v1.5 §3 tier-1 (a)/(b)), or explicitly annotate why they stay
  open (e.g., the cross-process boundary) — the two docs must not
  contradict each other at ship.
- **COND-RS-02** (finding 2): pick ONE and record it — default: **document**
  the unbounded lock-queue wait + amplified in-lock hold time as a dated
  residual (owner: engineering, trigger: P4.3 multi-instance or first
  observed retry storm, expiry aligned with RL-001's) in CONTRACT §3 /
  README Known limitations; alternative: add a queue-depth cap or
  end-to-end request deadline (code change → needs its own proposal
  lane; do NOT hotfix in this docs condition).
- **COND-RS-03** (finding 3): add offline §I seam cases for the two new
  throw families — (a) fresh-read reply = `memory: []` → `remember`
  rejects and NO insert send occurs; (b) verify round 1 violates → one
  heal → round 2 still violates → rejection message names the invariant —
  then paste the counts into TEST_MATRIX.md.

## Evidence (runs on 2026-09-24, reviewer-executed)

- `npm run typecheck` → exit 0 (no errors).
- `npx tsx scripts/verify-lifecycle.ts` → **113 passed, 0 failed /
  VERIFY PASS** (includes §G `missingConcepts` 9 goldens and the §I
  guard-path heal seam: `consolidated=true, 5 sends, NO insert`).
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` → **243 passed,
  0 failed / VERIFY PASS**; `rl-001:` block 13 checks green (reconciled:
  10 literal labels + `variant ${index} body` ×3 = 13, matching the
  contract §5 claim), `f-01:` block all green incl. `fused score = control
  + 1/61` and both `cleanup forget survivor -> 200`.
- Read-only probes: `GET /memory/livez` → 200; `GET /memory/health` →
  200; `POST /memory/search` and `POST /memory/smart-search` (project
  `review-resilience`) → 200 with `signals` present, empty results — no
  fixture rows written, nothing to forget.
- Helix lifecycle: OBSERVED only — never restarted/stopped/upgraded;
  no container bounce occurred during this review (all queries
  succeeded first try). Upstream :3111 untouched.
- No memory content, embeddings, or secrets reproduced anywhere in this
  report.

## Verdict Rationale

The code's failure modes are fail-closed end to end: every new read/write
asserts shape, every failure rejects the `remember()` promise, HTTP maps it
to a detail-free 500, both FIFO locks release through `finally`, and a
rejected predecessor can never poison the queue — the real Helix-restart
incident in this lane behaved exactly as designed (500s, then green).
Partial-commit recovery is real and idempotent (substring guard + guard-path
link heal), the degraded-search `signals[]` invariant is untouched and
live-confirmed, and the new tests are isolated, self-cleaning, and
deterministic with two independent green bars (113 + 243). Nothing
Critical/High. What holds the gate at ⚠️ conditional is one hard docs
contradiction (the SPEC-anchor ROADMAP rows still say OPEN — COND-RS-01),
one unbounded-wait posture that this lane amplified and nobody has declared
(COND-RS-02, default = document), and the new fail-closed claims being
asserted by inspection rather than by negative tests (COND-RS-03). Clear
the three conditions and this is a clean ✅ pass.
