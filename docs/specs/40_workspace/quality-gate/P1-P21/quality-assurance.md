# Quality Assurance Review: P1-P21

**Reviewer:** quality-assurance (engineering domain — 1 of 9 independent reviewers; runs the real suite)
**Date:** 2026-09-23
**Verdict:** **PASS** — **re-verified 2026-09-23 (round 3, remediation `83e2f3a`): both remaining conditions C-R1 (T-107/T-108 owner+expiry) and C-R2 (doc-truth cells) MET; all suites re-run green at current counts (typecheck 0 · verify-lifecycle 39 · verify-capture 115 · injection 73 · env 21 · verify 152 on our 3151 server) — see §Re-verification round 3 at the end** (round-1 CONDITIONAL and round-2 narrowed CONDITIONAL kept below as historical record)

**Mission:** judge TEST ADEQUACY and traceability only — does every REQ have a
test → evidence artifact → green result, is the matrix truthful, are the
assertions meaningful (non-vacuous)? Builds on the completed adversarial review
(`review-refuter.md`) — its attacks are not re-run. Findings only; no fixes.

## Evidence basis

- Read: `IMPLEMENTATION_PLAN.md` steps 1–7, `TEST_MATRIX.md` T-101…T-106,
  `docs/CONTRACT.md` §5, all six suites + `probe3.ts` + `purge.ts`,
  `src/search.ts` (TTL/decay wiring), `src/store.ts` (dedup/FIFO lock),
  `.github/workflows/ci.yml`, `git diff 1c410ee..HEAD` (6 commits,
  b27364b→eb279a6, 25 files).
- Re-ran this review (all green, exit codes observed):
  `npm run typecheck` → **0** · `verify-lifecycle` → **34/34** ·
  `verify-capture` → **115/115** · `verify-injection` → **ALL PASS** (73
  authored `check()` call sites) · `verify-env` → **21/21** ·
  `verify` vs **our** server on `AGENT_MEMORY_PORT=3151` → **131/131**
  (server started by this review and stopped after — livez confirmed dead) ·
  `purge --days 3 --project probe-p1-ttl --dry-run` → `would-delete=1`, exit 0 ·
  `purge` usage guards (`--days 0`, missing `--days`, missing scope) →
  **exit 2** each.
- Trusted from lane + refuter evidence (not re-run; write-side or probe data):
  `probe3.ts` GREEN (incl. section (e) `ltParam` dateTime), demo OK, bootstrap
  8 indexes, gitleaks local unavailable (2× download timeout, escalated →
  CI `secret-scan` job enforces on push).
- Environment discipline: upstream iii (3111) never touched; Helix (6969) never
  restarted — only read (purge dry-run, verify-env health probe).

## Checklist

- [x] All acceptance criteria have tests — **core criteria yes; 4 seams uncovered (QA-01…QA-05)**
- [~] All REQ-IDs traceable to test IDs — 6/6 rows exist, but **T-103's E2E evidence pointer is false** (QA-11) and T-102's description names a mechanism that does not exist (QA-06)
- [x] Unit + integration + e2e coverage as appropriate — unit `verify-lifecycle`, integration `verify-capture`, e2e `verify.ts` F2/F3, live probes `probe3`
- [x] Regression suite updated — `verify.ts` gained graph-branch (F2) + dedup/race (F3); §5 bar preserved; CI += `verify-lifecycle` + `verify-capture`
- [~] No flaky tests introduced — no order dependence, no unbounded waits; bounded fixed sleeps in `verify-capture` (150/300 ms) noted as minor surface (QA-10)
- [n/a] Coverage threshold met — no coverage tooling in repo (no c8/istanbul); gate is assertion-count based. Acceptance-criteria coverage: **6/6 REQ rows with artifacts; 4 route-level seams uncovered**
- [x] Manual exploratory testing — refuter live probes (26 vectors) + this review's suite re-runs and purge/live traces

## Traceability (REQ → test file/assertions → result → artifact)

| REQ | Matrix row | Test file / exact assertions | Result (this review) | Artifact |
|-----|-----------|------------------------------|----------------------|----------|
| REQ-P1-3 | T-101 | `scripts/verify-lifecycle.ts` A: determinism (3-call identical), ≤8 cap from 24 tokens, stopwords dropped (pure + mixed), <3-char dropped, 1..200 bound, empty/punct → [], tf DESC `["dog","cat","bird"]`, lex tie-break `["alpha","mike","zeta"]` · `scripts/verify.ts` D: `derived default concepts non-empty ≤8` + F2: `M1 derived concepts lead with 'quantum'`, `no graph: failure signal`, `M1 ranks first`, `M1 fused score == 3/61` | 34/34 + 131/131 green | this review's runs; TEST_MATRIX T-101 |
| REQ-P1-6 | T-102 | `verify-lifecycle` B: normalize golden, 3 hard-coded sha256 golden keys, same/diff project & content key relations · `verify.ts` F3: `first insert deduped=false`, `identical content -> SAME id + deduped=true`, `case/whitespace variant -> SAME id`, `collapse to exactly 1 memory`, `different project -> different id, deduped=false`, race: `both 201`, `SAME id, flags {false,true}`, `sessionId echoes each REQUEST`, `healthCount +1 only` · `probe3.ts` (a1)(a2)(a3) index #8 on legacy data + (b)(c)(d) no-enforcement facts | 34/34 + 131/131 green; probe3 GREEN (trusted) | same; TEST_MATRIX T-102 (see QA-06) |
| REQ-P1-1 | T-103 | `verify-lifecycle` C: λ absent/invalid/0/`-3` → factor 1, half-life golden `0.5±1e-12`, monotonic, clamps, bad date → 1 · D: `age>30 dropped, age==30 + unparseable kept`, OFF ×4 variants, purity · `probe3` (e): `ltParam` strict older-than, project-scoped, ordered · `purge.ts`: dry-run `would-delete=1` + usage guards exit 2 | 34/34 green; dry-run exit 0; guards exit 2 (re-run) | TEST_MATRIX T-103 — **E2E pointer false (QA-01/QA-11)**; no purge real-run artifact (QA-03) |
| REQ-P2-1 | T-104 | `verify-capture.ts` A: 7 events × (1 POST, path, exit 0, stdout EMPTY, stderr EMPTY, exact content, origin, project, sessionId) · B: prompt/trigger canaries absent + cwd fallback (exit 0) · C: 6 negatives × (0 stores, exit 0, silence) + secret header-only · D: `captureToolStart` never throws, exact body/origin, `memory*` 0 requests, dead backend no unhandled rejection · E: server down → exit 0 + silence | 115/115 green | TEST_MATRIX T-104 (suite structurally blind to store dedup — QA-05) |
| ALL | T-105 | `verify-injection` ALL PASS (73 call sites); `verify` 131/131 incl. §5 bar; `verify-env` 21/21; typecheck 0; gitleaks → CI | all green (re-run) | gate log / this review |
| ALL | T-106 | docs/CI review: CONTRACT v1.1, CI runs `verify-lifecycle` + `verify-capture` (read `ci.yml:27-28`), version 0.4.0 lockstep ×6 (refuter RF-017) | consistent | TEST_MATRIX T-106 |

### Assertion-meaningfulness judgments (HARD items)

- **Graph-branch 3/61 isolates the graph contribution?** Yes. RRF with k=60:
  two sources max out at 2/61, so `score == 3/61` (±1e-9) requires rank-1 in
  exactly three sources, and only three tasks exist (vector+text always,
  graph only when concepts present). Combined with `no graph: failure signal`
  and an isolated 2-memory project where M1 was stored with NO caller
  concepts (derived asserted: `quantum` first) and M2 shares zero tokens, the
  assertion proves *derived* stored concepts drove a real graph rank-1. The
  FAIL line records actual score + fused order — never loosened. Meaningful.
- **Does the race really race?** It fires two concurrent `remember` POSTs via
  `Promise.all` — real HTTP-level concurrency. The asserted outcome
  (`same id` + flags exactly `{false,true}` + healthCount 1) is the correct
  invariant under the per-key FIFO lock and would fail on double-insert or
  double-dedup. It cannot *prove* the requests interleaved before the
  pre-check (they may serialize in the HTTP layer), and the multi-process
  race is explicitly untested (accepted residual, refuter #1). Outcome-
  meaningful; interleaving not proven — QA-08.
- **Does verify-capture prove silence AND exit 0 for every path?** Almost —
  not every path. Section A (7 events), all C negatives, and E (dead server)
  assert both. Section B cwd-fallback asserts exit 0 but **no stdout/stderr
  check**; the C secret path asserts canary absence, not full silence;
  section D is in-process (exit code N/A). → QA-07.
- **TTL/decay: pure unit math only?** Yes — confirmed by grep: the only
  occurrences of `AGENT_MEMORY_TTL_DAYS`/`AGENT_MEMORY_DECAY_LAMBDA` outside
  `src/` are in `verify-lifecycle.ts`. **No test anywhere exercises the
  search-route signal `ttl: hidden N expired rows` end-to-end**, and no test
  runs `/smart-search` with λ on to observe the decayed tie-break ordering
  (`src/search.ts:133-143, 95-101, 214-221`). → QA-01, QA-02.

## Matrix truthfulness

| Row | Verdict | Detail |
|-----|---------|--------|
| T-101 | **Truthful** | Every described test exists and is meaningful. |
| T-102 | **Mostly truthful — one false claim** | Description says "race path catches `unique_constraint_violation`" — grep proves that code exists **nowhere** outside TEST_MATRIX/IMPLEMENTATION_PLAN (design adapted to the FIFO lock; status column does disclose). → QA-06. |
| T-103 | **False evidence pointer** | Status claims "E2E (`verify.ts` + purge run log)": `verify.ts` contains **zero** matches for `ttl\|decay\|lifecycle\|purge`; no purge run log artifact is linked, and the description's "real" purge has no cited run. Confirms refuter CE-005. → QA-01, QA-03, QA-11. |
| T-104 | **Truthful (scope caveat)** | 115/115 re-run; claims match the suite. Caveat: the suite's counting server has no dedup, so it cannot see the hook×store interaction T-104's roadmap wording implies (QA-05) — a coverage gap, not a false row. |
| T-105 | **Truthful** | 131/131, 73, 21, typecheck 0, gitleaks escalation — all re-verified. |
| T-106 | **Truthful** | CI additions and lockstep confirmed by read. |

## Coverage-gap findings

| ID | Severity | Finding | Location | Evidence |
|----|----------|---------|----------|----------|
| QA-01 | **Medium** | TTL route wiring never tested end-to-end: no suite asserts `ttl: hidden N expired rows` on `/search` or `/smart-search`, or that expired rows actually vanish from route results with `AGENT_MEMORY_TTL_DAYS` on. Only pure `filterExpired` math is tested. | `src/search.ts:95-101, 214-221` | grep: env var appears only in `verify-lifecycle.ts`; zero `ttl` matches in `verify.ts` |
| QA-02 | **Medium** | Decay fused tie-break wiring never tested at route level: `decayedImportance` is unit-tested, but no `/smart-search` run with `AGENT_MEMORY_DECAY_LAMBDA` set observes ordering change in `compareFusedAt`. | `src/search.ts:133-143` | same grep |
| QA-03 | **Medium** | Purge **real (non-dry) deletion** path has zero automated test and no cited run artifact: batch loop, per-id `forgetMemory`, no-progress guard (fail-closed), health before/after are only code-read (refuter RF-010/011), never executed. | `scripts/purge.ts:257-292` | gate evidence lists dry-run + exit 2 only; TEST_MATRIX T-103 description claims "real" without evidence |
| QA-04 | **Medium** | Dedup × ORIGIN interaction untested: `remember` (origin rest) then `lesson` same content → dedup hit keeps stored `origin:"rest"` and echoes a sessionId with no row; contract §3 "lesson is remember with origin forced to lesson" observably broken. Zero tests. | `src/store.ts:458-464` | refuter CE-002 (live-reproduced) |
| QA-05 | **Medium — top gap** | Hook event → real store dedup interaction untested: fixed-string hook contents collapse under dedup (repeats store nothing, new session's `Session` node never created). `verify-capture` is structurally blind (counting server has no dedup), so P2.1's "all 7 events land an observation" goal is silently falsified while suites stay green. | `src/store.ts:429-465` × `hooks/capture.mjs` | refuter CE-001 (live: 4 events → 2 memories/2 sessions) |
| QA-06 | **Low** | T-102 description names a nonexistent mechanism (`unique_constraint_violation` catch) — no such code exists; design adapted to in-process FIFO lock. Status column discloses; description column is false. | `TEST_MATRIX.md:14` | grep across repo: phrase only in docs |
| QA-07 | **Low** | Silence not asserted on every hook path: cwd-fallback (B) checks exit 0 only; secret path (C) checks canary absence only. | `verify-capture.ts:359-362, 405-407` | file read |
| QA-08 | **Low** | Race test proves outcome invariants, not genuine pre-check interleaving; multi-process race explicitly untested (accepted: single-instance deployment). | `verify.ts:516-559` | file read |
| QA-09 | **Low** | CI runs typecheck + injection + lifecycle + capture + gitleaks, but **not** `verify-env` (21) — a §5 number not CI-enforced (needs live Helix; `verify`'s omission is documented in `ci.yml:24`, `verify-env`'s is not). | `.github/workflows/ci.yml` | file read |
| QA-10 | **Low (hygiene)** | Bounded fixed sleeps (`verify-capture` 150/300 ms, `waitFor` 25 ms polls; `probe3` 2–3 s index-settle waits). All bounded, cleanup kills children in `finally`, no order dependence, no wall-clock assertions. Minor flake surface only. Exit codes verified correct (suites 0/1; purge 0/1/2 re-probed). | `verify-capture.ts:454,470` | re-runs |
| QA-11 | **Low** | T-103 evidence pointer (`E2E (verify.ts…)`) does not exist — matrix overclaim (same root as QA-01; mirrors CE-005). Owner: docs/execute-spec. | `TEST_MATRIX.md:15` | grep: zero matches in `verify.ts` |

**Not a gap (checked per brief):** `listExpired` real execution IS covered
live by `probe3 (e)` (exact query shape, three cutoffs) **and** by the
repeated purge dry-run (`would-delete=1` reads it through `purge.ts`);
index #8 creation on legacy data IS covered by `probe3 (a1)-(a3)` (create →
read-ready poll → double legacy write OK) — probe-only, not CI, which matches
its one-shot decision-gate design.

## Coverage summary

- Line/branch coverage: **not measured** — repo ships no coverage tooling; gate is assertion-count based.
- Acceptance-criteria coverage: **6/6 REQ-IDs have test → artifact → green result**; route-level TTL (QA-01), route-level decay (QA-02), purge-real (QA-03), hook×dedup (QA-05), dedup×origin (QA-04) uncovered.
- CI-runnable suites: 4/4 green on re-run; live suites (verify, verify-env, purge, probe3) green on re-run or trusted evidence.

## Verdict Rationale

**CONDITIONAL.** The traceability spine holds: every REQ maps to exact,
non-vacuous assertions that I re-ran green (typecheck 0; 34/34; 115/115; 73;
21/21; 131/131 on our 3151 server; purge dry-run + exit-2 guards), and the
§5 bar matches shipped counts on every number I could observe. The graph-branch
3/61 and dedup-race assertions survive the meaningfulness test.

CONDITIONAL because (a) TEST_MATRIX T-103 cites an E2E artifact that does not
exist and T-102 describes a mechanism that was never built — the matrix is not
fully truthful (QA-06, QA-11); and (b) five real coverage seams remain, two of
them live-proven defects the green suites structurally cannot see (QA-05
hook×dedup Session loss, QA-04 dedup×origin echo), plus route-level TTL/decay
wiring (QA-01, QA-02) and the never-executed purge-real path (QA-03). Not
FAILED: the spec, the core acceptance tests, and the §5 bar are sound; every
gap has a named mitigation. Gate should hold until T-103's pointer and T-102's
description are repaired, CE-001/QA-05 is fixed or explicitly accepted with
CONTRACT/ROADMAP wording corrected, and QA-03 (purge real run) is either
executed once as evidence or the matrix row is scoped to dry-run.

*Counts: 11 findings — 5 coverage gaps (Medium), 6 truthfulness/adequacy/hygiene (Low).*

---

# Re-verification (round 2) — 2026-09-23

**Trigger:** remediation commit `9210208` *"fix(gate-p1-p21): clear P1+P2.1
quality-gate conditions"*. Scope: re-verify ONLY the round-1 gate conditions
(matrix truthfulness incl. `IMPLEMENTATION_PLAN.md` check, tracked-gap
disposition, QA-05/F4 adequacy, full trace re-run). Read-only on code; only
this artifact updated. Round-1 content above is kept as historical record —
the disposition table and traceability table here supersede it.

**Updated overall verdict: CONDITIONAL (narrowed).** Every suite, count,
matrix-row, and F4 condition is MET and re-run green. The hold is reduced to
two docs/tracking conditions: **C-R1** (tracked gaps lack the owner+expiry the
accept rule requires) and **C-R2** (three stale/false docs lines, incl. the
`IMPLEMENTATION_PLAN` step wording I was asked to re-check). All are
Low/hygiene — no open code, test, or matrix defect among my conditions.

## Runs observed (round 2, all by this reviewer)

| Run | Result |
|-----|--------|
| `npm run typecheck` | exit **0** |
| `verify-lifecycle` | **34/34**, exit 0 |
| `verify-capture` | **115/115**, exit 0 |
| `verify-injection` | **ALL PASS** (73 authored `check()` call sites), exit 0 |
| `verify-env` | **21/21**, exit 0 |
| `verify` vs our server on `AGENT_MEMORY_PORT=3151` | **152 passed, 0 failed** — `VERIFY PASS`, exit 0; server started by this review and **stopped after** (`SERVER_STOPPED` confirmed); iii/3111 never touched; Helix never restarted |
| `purge` guards re-probe (purge.ts changed in `9210208`) | `--days 0` → **2**, missing `--days` → **2**, dry-run `probe-p1-ttl` → `would-delete=1` exit **0** |
| F4 delta | `git show 9210208` → **+21** `check(`/`shape(` call sites in `verify.ts` = 131+21 = **152** (arithmetic matches the observed count) |
| §5 count docs | `docs/CONTRACT.md:358` → **152** ✓ · `README.md:499` → **152** ✓ · `IMPLEMENTATION_PLAN.md:62` → **152** ✓ · `TEST_MATRIX.md:17` → **152** ✓ · **stale: `CHANGELOG.md:49` (v0.4.0 entry) still says "102 → 131 passed"** ✗ |

## Per-condition status

### Condition 1 — Matrix truthfulness: **MET for TEST_MATRIX; PLAN sub-item NOT MET → C-R2**

- **T-102 matches shipped reality exactly.** Row now states enforcement is
  application-side (`findMemoryByDedupKey` pre-check under per-key in-process
  FIFO lock), the `unique_constraint_violation` mention is a *negative*
  statement ("no catch exists, by design: probe3 proved the server does not
  enforce"), probe3 findings cited as b2/d1-d3, race assertions stated as
  SAME id + flags {false,true} — all four claims verified against
  `src/store.ts:398-431`, `scripts/verify.ts` F3, `scripts/probe3.ts`.
- **T-103 matches shipped reality exactly.** Evidence now = unit
  (verify-lifecycle 34 incl. half-life + TTL boundary/OFF/purity) + `probe3 (e)`
  + ops run (dry-run + exit-2 guard); route-level gaps explicitly deferred to
  T-107/T-108; **"purge REAL-run path is not harnessed (code-reviewed only)"**
  — my allowed remedy (scope the row) taken. Phantom `verify.ts` TTL E2E
  pointer **removed**.
- **Matrix-wide pointer sweep:** all 8 rows' test pointers verified to exist
  (T-101 D/F2, T-102 dedup+F4, T-103 as above, T-104 verify-capture, T-105
  152/73/21, T-106 `ci.yml:27-28` + lockstep, T-107/T-108 honestly
  "not yet harnessed"); Coverage Summary (`TEST_MATRIX.md:26-29`) updated and
  truthful. **Zero false test pointers remain in the matrix.**
- **PLAN rollback: fixed.** `IMPLEMENTATION_PLAN.md:46-51` now says index #8
  is *orphaned, not dropped* (no drop mechanism exists — matches repo
  reality: `bootstrapIndexes` only creates).
- **PLAN step wording: NOT fixed.** `IMPLEMENTATION_PLAN.md:27` still asserts
  *"race → catch `unique_constraint_violation` → re-fetch"* — the same
  affirmative falsehood flagged in QA-06 (grep across repo: TEST_MATRIX:14 is
  now the negative-truthful form; **PLAN:27 is the only remaining affirmative
  occurrence**). → **C-R2**.
- **Extra find:** `CHANGELOG.md:49` (under `## [v0.4.0]`, heading line 8)
  still claims the bar is *131 passed* while §5/README/PLAN/T-105 all say
  152 — same release entry, stale after F4. → **C-R2**.

### Condition 2 — Tracked gaps disposition (QA-01/QA-02): **REJECTED for this gate (per the accept rule)**

- **Recorded ✓:** `TEST_MATRIX.md:19` (T-107 — route-level
  `ttl: hidden N expired rows` E2E on a running server with
  `AGENT_MEMORY_TTL_DAYS`) and `:20` (T-108 — fused ordering under
  `AGENT_MEMORY_DECAY_LAMBDA>0`) exist, REQ-linked, precise intent, honest
  "not yet harnessed / server-env harness needed".
- **owner+expiry ✗:** grep across the repo (excluding this gate workspace)
  shows T-107/T-108 appear only in `TEST_MATRIX.md`; neither row — nor any
  other file — carries an **owner** or an **expiry/due date** (the only
  substring hits were `listExpired`/`expired rows` themselves).
- The accept rule for this gate is "tracked **with owner+expiry**" →
  **disposition as recorded does not qualify → REJECTED.**
- **Required to land (state of record — either add owner+expiry to both rows,
  or land these tests before handoff):**
  - **T-107 test:** harness spawns `src/server.ts` on an isolated port with
    `AGENT_MEMORY_TTL_DAYS` small; seeds one row with an old `createdAt` and
    one fresh via REST; asserts on BOTH `POST /memory/search` and
    `POST /memory/smart-search`: (i) expired row absent from `results`,
    (ii) `signals` contains exactly `ttl: hidden N expired rows` with N equal
    to the hidden count, (iii) control run with TTL off emits no ttl signal.
    Exit-code gated; documented as server-env (the reason it cannot be a
    CI-runnable pure suite).
  - **T-108 test:** same harness with `AGENT_MEMORY_DECAY_LAMBDA` > 0; two
    rows tied on RRF score and stored importance but different ages; asserts
    the fused `/smart-search` order puts the newer row first with λ on, and
    that the order differs from (or is asserted against) the λ-off control —
    i.e. the env knob's effect on `compareFusedAt` observed at the route,
    not only in unit math.

### Condition 3 — QA-05 / F4 adequacy: **MET (blind spot closed)**

`scripts/verify.ts:561-692` (F4, +21 assertions, counted from the commit
diff). Assertion-meaningfulness judgment, group by group:

| Group | Assertions | Fails when… | Vacuous? |
|-------|-----------|-------------|----------|
| S1 novel | 201, shape, `deduped=false`, echo S1 | pre-check false-positives on a fresh key | No |
| S2 repeat | 201, `deduped===true` **AND** `id===rhd1.id`, echo = request S2 | dedup bypasses (new row) or returns wrong row | No — conjunction + ids printed in FAIL detail |
| Store-level count | `health.memories === 1` | double-write even if the echo lied | No — independent of the response body |
| Session materialization | `sessions.size===1 && has(S1) && !has(S2)` | Session node created on dedup hit (or list empty) | No — `size===1` blocks the empty-list vacuity |
| Echo ≠ membership | `sessionMemories(S1)` contains id; `sessionMemories(S2)` does NOT | row stored under the echoed session, or endpoint echoes instead of filtering | No — both directions keyed on the real `rhd1.id` |
| Cross-project scope | `deduped===false && id!==rhd1.id` + other project count 1 | dedup key loses the project component | No |

**Closes the structural blind spot? YES.** Hook-shaped fixed content
(`"agent session stopped"`, `origin="hook:Stop"`, no nonce — byte-identical
to what `capture.mjs` sends, itself pinned by verify-capture section A) now
flows through the **real** `remember()` + real Helix store inside the same
E2E suite that forms the §5 bar — the counting-server blindness is bridged,
and CE-001's three observable impacts (memory count, Session-node loss,
echo-vs-membership) are each pinned. Semantics documented in
`docs/CONTRACT.md:183-192` (first-wins paragraph — which also *declares* the
QA-04 origin divergence: "its stored origin may differ … first-wins,
declared"). Residuals (Low, → C-R2 / note): `ROADMAP.md:95` still claims all
7 events flatly "land an observation" without the first-wins caveat — the
CONTRACT half of my original condition is met, the ROADMAP half is not; and
no single test runs the full chain `capture.mjs process → real store`
(composition is covered by the two abutting suites — accepted).

### Condition 4 — Trace re-run & §5 counts: **MET**

Exact observed count: **verify = 152 passed, 0 failed** (plus typecheck 0,
34, 115, 73, 21 — see runs table). §5, README, PLAN, T-105 all say 152; only
`CHANGELOG.md:49` lags at 131 → C-R2.

## Updated traceability (supersedes round-1 table)

| REQ | Matrix row | Test file / exact assertions | Result (round 2) | Artifact |
|-----|-----------|------------------------------|------------------|----------|
| REQ-P1-3 | T-101 | `verify-lifecycle` A (determinism/cap/stopwords/rank) + `verify.ts` D (derived ≤8) + F2 (graph-branch `3/61`, no `graph:` failure) | 34/34 + **152/152** green | this review; matrix T-101 (unchanged, truthful) |
| REQ-P1-6 | T-102 | `verify-lifecycle` B (goldens) + `verify.ts` F3 (dedup/race) **+ F4 dedup×hook (S1 novel / S2 first-wins / session materialization / cross-project)** + `probe3` (a)(b)(c)(d) | 34/34 + **152/152**; probe3 trusted | matrix T-102 **rewritten — truthful**; `store.ts:398-431` |
| REQ-P1-1 | T-103 (+T-107/T-108 tracked) | `verify-lifecycle` C+D (decay math, TTL boundary/OFF/purity) + `probe3 (e)` + purge dry-run + exit-2 guards; route-level TTL/λ E2E **not harnessed — tracked** | 34/34; guards exit 2; dry-run `would-delete=1` | matrix T-103 **rewritten — truthful**; T-107/T-108 rows (**lack owner+expiry → C-R1**) |
| REQ-P2-1 | T-104 | `verify-capture` A–E (payload/silence/exit-0/canaries/negatives/dead/plugin) + F4 store-side composition | 115/115 green | matrix T-104 (truthful); F4 closes QA-05 test axis |
| ALL | T-105 | typecheck + injection 73 + verify **152** + env 21 + purge guards | all green (re-run) | matrix T-105 updated to 152 ✓ |
| ALL | T-106 | CONTRACT v1.1 (§3:183-192 first-wins, §5:358 152) + CI unchanged (still runs the two suites) + lockstep ×6 | consistent (stale `CHANGELOG.md:49` → C-R2) | matrix T-106 |

## Prior-findings disposition (all 11 marked)

| ID | Status | Evidence |
|----|--------|----------|
| QA-01 (Medium, TTL route E2E) | **OPEN → C-R1** | Tracked as T-107 ✓ but no owner/expiry ✗ → disposition rejected per rule; required test spec stated above |
| QA-02 (Medium, decay route E2E) | **OPEN → C-R1** | Tracked as T-108 ✓ but no owner/expiry ✗ → same |
| QA-03 (Medium, purge real-run) | **RESOLVED** | My allowed remedy taken: T-103 now says "purge REAL-run path is not harnessed (code-reviewed only)"; guards re-probed after `9210208` purge changes (2/2/0). Residual: real path still unexecuted — now honestly disclosed, Low backlog |
| QA-04 (Medium, dedup×origin) | **RESOLVED** (contradiction) | `CONTRACT.md:183-192` declares first-wins incl. stored-origin divergence for repeat lesson ("first-wins, declared"); behavior == contract now. Residual Low: differing-origin dedup-hit has no test (F4 uses same origin both sides) — backlog, not a gate condition |
| QA-05 (Medium, hook×dedup blind spot) | **RESOLVED** | F4 (verify.ts:561-692, +21) pins CE-001's impacts through the real store; assertions non-vacuous (table above); §3 documents. Residuals → C-R2 (ROADMAP:95) + full-chain note (accepted) |
| QA-06 (Low, phantom mechanism claim) | **OPEN (partial) → C-R2** | TEST_MATRIX:14 fixed (negative-truthful) ✓; PLAN rollback fixed ✓; **PLAN:27 still asserts the nonexistent catch** ✗ |
| QA-07 (Low, capture silence paths) | **OPEN — backlog, non-blocking** | `verify-capture` unchanged by `9210208` (115 identical); not a named round-2 condition |
| QA-08 (Low, race interleaving) | **ACCEPTED-TRACKED** | Unchanged; assumption now formalized in `CONTRACT.md:193-197` (single-writer, owner: engineering) |
| QA-09 (Low, CI omits verify-env) | **OPEN — backlog, non-blocking** | `ci.yml` untouched by `9210208`; not a named round-2 condition |
| QA-10 (Low, bounded sleeps) | **ACCEPTED-TRACKED** | Unchanged; purge exit codes re-verified post-change (0/2/2) |
| QA-11 (Low, T-103 false pointer) | **RESOLVED** | T-103 evidence rewritten; matrix-wide pointer sweep clean |

## Remaining conditions (the entire hold)

- **C-R1** — `TEST_MATRIX.md:19-20` (T-107/T-108): add **owner + expiry**, or
  land the two server-env tests specified in Condition 2 before handoff.
- **C-R2** — three stale/false docs lines: `IMPLEMENTATION_PLAN.md:27`
  (affirmative `unique_constraint_violation` catch claim — false),
  `ROADMAP.md:95` (unqualified "land an observation" — needs first-wins
  caveat), `CHANGELOG.md:49` (says 131 — shipped bar is 152).

## Verdict rationale (round 2)

**CONDITIONAL, narrowed.** Round-1 hold conditions are otherwise cleared: the
matrix is now exact (T-102/T-103 + coverage summary + all pointers swept),
the plan rollback is truthful, QA-05's structural blind spot is closed by a
non-vacuous F4 whose 21 new assertions I read and re-ran at 152/152, QA-03
was scoped as offered, QA-04's contract contradiction is declared away, and
§5/README/PLAN/T-105 all read 152 — matching the observed run. Not PASS
solely because (a) the accept rule for the tracked gaps is unmet on its face
(no owner, no expiry anywhere for T-107/T-108), and (b) two of the docs
falseholes/stale claims I was explicitly told to re-check persist
(`IMPLEMENTATION_PLAN.md:27`, plus `ROADMAP.md:95`/`CHANGELOG.md:49` in the
same class). All are one-line docs/tracking fixes, severity Low — zero open
code, suite, or matrix defects among my conditions. Clear C-R1 + C-R2 → PASS.

*Round-2 counts: 2 open conditions (C-R1, C-R2); dispositions — 5 RESOLVED,
2 ACCEPTED-TRACKED, 4 OPEN (2 driving the hold, 2 Low backlog non-blocking).*

---

# Re-verification (round 3) — 2026-09-23

**Trigger:** remediation commit `83e2f3a` *"fix(gate-p1-p21): close round-2
gate conditions — docs truth + render-guard test"*. Scope: re-verify ONLY the
round-2 hold (C-R1 tracked-gap disposition, C-R2 doc-truth cells), confirm
F4/QA-05 adequacy is unchanged, and reconcile the count ripple (verify-lifecycle
34 → 39). Read-only on code; only this artifact updated. Round-1 and round-2
content above is kept as historical record — the disposition table and
traceability table here supersede theirs.

**Updated overall verdict: PASS.** Both remaining conditions are MET. The
remediation also fixed the count ripple everywhere my traceability table cites
it, and one extra stale doc cell I had not made a condition (ROADMAP P1.1 /
tests-CI row at 34/131) is corrected in the same pass. Zero new defects found.

## Runs observed (round 3, all by this reviewer)

| Run | Result |
|-----|--------|
| `npm run typecheck` | exit **0**, no errors |
| `verify-lifecycle` | **39 passed, 0 failed**, exit 0 (new section E = 5 render-guard checks, +5 over round-2's 34 — arithmetic matches) |
| `verify-capture` | **115 checks, 0 failed**, exit 0 |
| `verify-injection` | **ALL PASS** (73 authored `check()` call sites), exit 0 |
| `verify-env` | **21 passed, 0 failed**, exit 0 |
| `npm run bootstrap` | `8 indexes ensured`, `READY` on attempt 1, exit 0 |
| `verify` vs our server on `AGENT_MEMORY_PORT=3151`, `AGENT_MEMORY_URL=http://127.0.0.1:3151` | **152 passed, 0 failed** → `VERIFY PASS`, exit 0; server started by this review for the run and **stopped after** (livez `000` = dead); iii/3111 never touched (pid 2465 still listening); Helix/6969 never restarted (read-only, alive) |
| `purge` guards re-probe (`purge.ts` changed in `83e2f3a` — `oneLine` extraction) | `--days 0` → **2**, missing `--days` → **2**, dry-run `probe-p1-ttl` → `would-delete=1` exit **0** — identical to round 2, behavior byte-identical as claimed |
| `git diff 9210208..83e2f3a` file touch check | **neither `scripts/verify.ts` nor `src/store.ts` touched** → F4 section (round-2 +21 assertions) byte-identical → QA-05 adequacy judgment unchanged |

## Per-condition status

### C-R2 — doc-truth cells: **MET (all four cells + count ripple)**

- **PLAN step-2 cell fixed.** `IMPLEMENTATION_PLAN.md:27` no longer asserts the
  affirmative falsehood: it now reads *"race closed by a per-key in-process FIFO
  lock around that pre-check (shipped truth: probe3 proved the server does NOT
  enforce index #8 — application-side pre-check only, no
  `unique_constraint_violation` catch exists)"* — matches shipped code
  (`src/store.ts` FIFO pre-check) exactly.
- **PLAN step-3 cells repointed.** Target/Files no longer cites the nonexistent
  `verify.ts` purge-e2e; now = `verify-lifecycle.ts (pure) + probe3 (e)
  ltParam; purge evidence = dry-run + exit-2 guard run log (real-run not
  harnessed, code-reviewed)`; Evidence cell = `verify-lifecycle count (39) +
  probe3 GREEN + purge dry-run/exit-2 guard log`. My allowed remedy (scope the
  row to real artifacts) taken — the "real run not harnessed" disclosure
  persists, honest per QA-03's disposition.
- **Repo-wide phrase sweep:** `unique_constraint_violation` has exactly **two**
  occurrences outside reviewer artifacts — `IMPLEMENTATION_PLAN.md:27` and
  `TEST_MATRIX.md:14` — **both negative-truthful** ("no … catch exists, by
  design"). Zero affirmative claims remain. → QA-06 fully RESOLVED.
- **CHANGELOG fixed.** `CHANGELOG.md:49`: *"102 → 131 → **152 passed** across
  lane + gate remediation (derived-concepts, graph-branch, dedup/race,
  dedup×hook (F4) sections)"* — F4 explicitly in the list as required; the
  remaining `131` is the intentional progression, not a stale claim.
- **ROADMAP P2.1 fixed.** Now *"records an observation on first occurrence
  (repeats dedup — first-wins, contract §3)"* with the `verify-capture 115`
  clause kept — the QA-05 round-2 residual (ROADMAP:95 flat claim) is closed.
- **Count ripple swept (stale `34`/`131` grep, active docs):** zero stale hits
  outside reviewer artifacts (50_archive = historical record; this gate
  workspace = my own). The one live-doc `131` is the CHANGELOG progression above.

### C-R1 — tracked-gap disposition (T-107/T-108): **MET → ACCEPTED**

- **owner+expiry present on both rows** (`TEST_MATRIX.md:19-20` status cells):
  `(owner: engineering — orchestrator; expiry: 2026-10-31 or v0.5.0 release,
  whichever first)` — a named accountable owner plus a deterministic expiry
  bound (date **or** release milestone, whichever triggers first). This
  satisfies my accept rule verbatim ("tracked **with owner+expiry**") → the
  round-2 **REJECTED** disposition flips to **ACCEPTED-TRACKED** for this gate.
- **Rows otherwise unchanged → my required-test specs remain the tracked
  intent.** T-107 still specifies the exact `signals:["ttl: hidden N expired
  rows"]` assertion on both `/search` and `/smart-search` on a running
  `AGENT_MEMORY_TTL_DAYS` server; T-108 still specifies fused `/smart-search`
  ordering observed under `AGENT_MEMORY_DECAY_LAMBDA>0` at the route. Neither
  description was weakened, and the full test specs in Condition 2 above
  (incl. the λ-off / TTL-off control runs) remain state-of-record for whoever
  picks up owner: engineering.

### F4 / QA-05 adequacy: **UNCHANGED — still MET**

`83e2f3a` does not touch `scripts/verify.ts` or `src/store.ts` (diff file list
verified), so the F4 section and my round-2 group-by-group non-vacuity table
carry over byte-identical. The only test-code delta is `verify-lifecycle`
section E (+5 `oneLine` render-guard checks pinning the CWE-117 fix moved into
`src/logline.ts`) — read in the diff: collapse matrix, no `\n`/`\r` in output,
idempotency, byte-identical names/digits/ISO/booleans, number/boolean
coercion. Non-vacuous, deliberately excludes U+0085/NEL (SEC-P121-03 backlog
stated in the test comment). Purge behavior after the `oneLine` extraction
re-probed identical (guards 2/2, dry-run 0/would-delete=1).

### Count consistency in the traceability-table-cited places: **MET**

| Place | Reads | Observed run |
|-------|-------|--------------|
| `docs/CONTRACT.md` §5 (:354/:357/:359/:368) | 39 / 115 / 152 / 73 / 21 | all match |
| `README.md` Verification (:499/:516/:522) | 152 / 39 / 115 | all match |
| `TEST_MATRIX.md` evidence cells (T-101/T-103/T-104/T-105) | 39/39 · 39/39 · 115/115 · 152/152 + 73 + 21, commit `45380b5..HEAD` | all match |
| `IMPLEMENTATION_PLAN.md` Quality Gates (:59-:62) | 39 / 115 / 73 / 152 / +21 env | all match |

Matrix pointer sweep (8-row standard, re-run): T-101…T-106 pointers all exist;
T-107/T-108 honestly "not yet harnessed"; PLAN step-3 phantom pointer gone —
**zero false test pointers.**

## Updated traceability (supersedes round-1/2 tables)

| REQ | Matrix row | Test file / exact assertions | Result (round 3) | Artifact |
|-----|-----------|------------------------------|------------------|----------|
| REQ-P1-3 | T-101 | `verify-lifecycle` A (determinism/cap/stopwords/rank) + `verify.ts` D (derived ≤8) + F2 (graph-branch `3/61`, no `graph:` failure) | 39/39 + **152/152** green | this review; matrix T-101 (39/39, truthful) |
| REQ-P1-6 | T-102 | `verify-lifecycle` B (goldens) + `verify.ts` F3 (dedup/race) **+ F4 dedup×hook** + `probe3` (a)(b)(c)(d) | 39/39 + **152/152**; probe3 trusted | matrix T-102 truthful; PLAN:27 now matches shipped FIFO-pre-check truth |
| REQ-P1-1 | T-103 (+T-107/T-108 tracked) | `verify-lifecycle` C+D+E (decay math, TTL boundary/OFF/purity, render guard) + `probe3 (e)` + purge dry-run + exit-2 guards (re-probed post-change); route-level TTL/λ E2E not harnessed — **tracked with owner+expiry** | 39/39; guards 2/2/0; dry-run `would-delete=1` | matrix T-103 truthful; T-107/T-108 **owner: engineering — orchestrator, expiry 2026-10-31 or v0.5.0 → ACCEPTED** |
| REQ-P2-1 | T-104 | `verify-capture` A–E + F4 store-side composition | 115/115 green | matrix T-104 truthful; ROADMAP P2.1 first-wins wording now matches §3 |
| ALL | T-105 | typecheck 0 + injection 73 + verify **152** + env 21 + purge guards 2/2/0 | all green (re-run) | matrix T-105 (`45380b5..HEAD`, 3151 wording) truthful |
| ALL | T-106 | CONTRACT §5 (39/115/152/73/21) + README + PLAN Gates + CI + lockstep | consistent (CHANGELOG progression `102 → 131 → 152` truthful) | matrix T-106 |

## Prior-findings disposition (final — all 11 marked)

| ID | Status | Evidence |
|----|--------|----------|
| QA-01 | **ACCEPTED-TRACKED → C-R1 cleared** | T-107 now carries owner+expiry; required spec retained |
| QA-02 | **ACCEPTED-TRACKED → C-R1 cleared** | T-108 same |
| QA-03 | **RESOLVED** (scope remedy; real path honestly disclosed) | unchanged this round; guards re-probed 2/2/0 after purge.ts delta |
| QA-04 | **RESOLVED** (contract declares first-wins origin divergence) | unchanged |
| QA-05 | **RESOLVED** (F4 closes blind spot; ROADMAP residual closed by 83e2f3a) | F4 untouched → round-2 adequacy table stands |
| QA-06 | **RESOLVED** | both remaining phrase occurrences negative-truthful (PLAN:27, MATRIX:14) |
| QA-07 | OPEN — Low backlog, non-blocking | unchanged, not a named condition |
| QA-08 | ACCEPTED-TRACKED (single-writer, CONTRACT §3) | unchanged |
| QA-09 | OPEN — Low backlog, non-blocking | unchanged, not a named condition |
| QA-10 | ACCEPTED-TRACKED (bounded sleeps) | unchanged |
| QA-11 | **RESOLVED** | phantom pointer gone; 8-row sweep clean |

## Remaining conditions

**None.** C-R1 and C-R2 — the entire round-2 hold — are MET.

## Verdict rationale (round 3)

**PASS.** The two conditions that held round 2 are closed on the evidence:
T-107/T-108 now satisfy the accept rule (owner: engineering — orchestrator;
expiry: 2026-10-31 or v0.5.0, whichever first) with their required-test
intent intact, and every doc cell I named as false/stale now matches shipped
reality (PLAN step-2/step-3, CHANGELOG progression + F4, ROADMAP first-wins —
plus the incidental 34/131 ripple in ROADMAP/CONTRACT/README/PLAN/MATRIX).
Counts reconcile end to end: I observed typecheck 0, **39**, **115**, **73**,
**21**, and **152** on my own bootstrap + 3151 server (stopped after; iii and
Helix untouched), and all four cited doc locations read exactly those numbers.
F4/QA-05's non-vacuity judgment carries over unchanged (`verify.ts` untouched).
The render-guard +5 assertions are real, not count padding. Remaining findings
are QA-07/QA-09 (Low backlog) — no open condition, no severity ≥ Medium among
my conditions. Gate: **CLEAR.**

*Round-3 counts: 0 open conditions; dispositions — 7 RESOLVED,
3 ACCEPTED-TRACKED, 2 OPEN (Low backlog, non-blocking).*
