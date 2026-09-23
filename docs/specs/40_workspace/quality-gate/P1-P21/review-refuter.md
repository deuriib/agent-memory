# Refuter Review: P1-P21 (lane quality gate)

**Reviewer:** review-refuter (adversarial, engineering domain — 1 of 9 independent reviewers)
**Date:** 2026-09-23
**Verdict:** **PASS** (final — round 5, 2026-09-23) — bounded confirmation on
the two-cell working-tree fix atop `83e2f3a`: (1) `git diff` shows **exactly**
the two prescribed one-cell doc corrections (`IMPLEMENTATION_PLAN.md` L62 +
`README.md` L505), nothing else — numstat `1 1` ×2, no source/script/other-doc
movement, only the 9 pre-existing untracked quality-gate artifacts alongside;
(2) the original class standard re-run across all six files returns **0
remaining false instances** of "lifecycle / phantom-section attributed to
`npm run verify` / verify.ts content" — NEW-003 closed in round 4, NEW-004 now
closed ("the v1.1 **P1.3/P1.6** sections"), control grep on `scripts/verify.ts`
= 0, every other "lifecycle" hit in the six files is legitimate (lane titles,
`verify-lifecycle` script credits, `src/lifecycle.ts` module refs, ROADMAP
"Memory lifecycle" row, rollback note). Zero behavioral refutations — the diff
is docs-only, code byte-identical to the state where all suites were re-run
green (typecheck 0 · verify-lifecycle 39/39 · verify 152/152). One NEW find of
a **different** class (`dedayImportance` bogus symbol, plan L28) is
dispositioned as tracked **Low** per this round's scope cap, not a gate
condition. Campaign rounds 1–4 verdicts and full findings preserved below,
unchanged.

## Mission

Attempt to **falsify** the lane's claimed acceptance criteria (T-101…T-106,
CONTRACT v1.1 §1/§2/§3/§5). Assume the implementation is wrong until evidence
proves otherwise. Findings only — no fixes applied.

Evidence basis: `git diff 1c410ee..HEAD` (6 commits,25 files), current working
tree, docs/CONTRACT.md v1.1 read as claimed truth, plus cheap local re-runs and
live probes against **our** server on `AGENT_MEMORY_PORT=3151` (started and
stopped by this reviewer; upstream iii on 3111 only ever GET-checked for
liveness and never mutated; Helix on 6969 never restarted).

Local re-runs (this review): `npm run typecheck` exit 0 ·
`verify-lifecycle` **34/34** · `verify-capture` **115/115** · custom read-only
probe file `/tmp/opencode/refuter-probe.ts`.

## Attack Vectors Tried

| ID | Claim (source) | Attempt / Attack | Result |
|----|----------------|------------------|--------|
| RF-001 | T-101: derived concepts ≤8, deterministic, tf DESC → lex ASC, stopwords dropped | Re-ran `verify-lifecycle` A-section; read `src/concepts.ts` (code-unit sort, no locale/clock/random) | **Survived** — 34/34 green, algorithm locale-free |
| RF-002 | Explicit `concepts` win verbatim — derived never sneak into echo | Read `src/store.ts:477-478` (`length > 0 ? copy : extractConcepts`); verify.ts graph-branch asserts derived path only when absent | **Survived** |
| RF-003 | Graph branch fires on plain saves, fused score == 3/61 | `scripts/verify.ts:441-463` asserts rank-1 in all three sources | **Survived** (gate evidence 131/131; assertion read, not re-run — needs live server) |
| RF-004 | T-102: same fact twice → same id + `deduped:true` + one row + cross-project distinct + race same id | Read verify.ts F3 (dedup/race/cross-project/healthCount==1); live probes below re-exercise the dedup path | **Survived** — live probes consistently returned `deduped:true` + same id |
| RF-005 | Empty / whitespace-only content → normalize → one hash collapses distinct empties | Probe A2: `normalizeContent("")==="   "==="\t\n "` → `""`, `same-hash:true` | **Refuted as an attack (unreachable)** — probe A3: REST/MCP `z.string().trim().min(1)` rejects both `""` and `"   \n "`; plugin `str()` requires non-blank; hook contents are fixed non-empty strings. No public surface can deliver an empty/blank memory to `remember()` |
| RF-006 | Content <3 chars → derived `concepts:[]` breaks echo/graph contract | Probe A5: `extractConcepts("ok")==[]`, `("a b")==[]` | **Survived** — contract says ≤8 (0 allowed); empty array proven safe in §0/A1 |
| RF-007 | `importance` >1 or <0 passes through to store | `src/server.ts:46` `.min(0).max(1)`; `src/mcp.ts:41` same; plugin `fraction(0,1)`; decay path clamps (`clamp01`) | **Refuted as an attack** — rejected at every boundary, clamped in ranking |
| RF-008 | TTL boundary equality mishandled (fence deleted or kept wrongly) | `src/lifecycle.ts:116` keeps `ageDays <= ttl` (strictly-greater expires) vs purge `Predicate.ltParam` strict older-than | **Survived** — both sides keep the fence row; matches contract §3 wording exactly; unit-asserted (`boundary` kept) |
| RF-009 | λ huge / tiny / Infinity / negative / garbage | Probe A6: `1e300→0`, `1e-300→1`, `Infinity→1 (OFF)`, unit: `0/-3/"abc"→factor 1` | **Survived** — no NaN, no Infinity leak, fail-closed OFF |
| RF-010 | `purge --all` with 0 sessions | `scripts/purge.ts:306-318`: stderr note, empty loop, governance line `deleted=0`, exit 0 | **Survived** — consistent with contract exit codes (0/1/2) |
| RF-011 | Purge usage/fail-closed (`--days 0`, missing scope, fractional days, unknown arg) | `parseArgs` regex `^[1-9][0-9]{0,5}$`, mutual exclusion, no-progress guard at `purge.ts:284-288` | **Survived** — usage→2, operational→1, `days=0` explicitly refused |
| RF-012 | Hook event with missing / empty / non-string / >80-char / unicode / control-char `tool_name` | `capture.mjs:46-71` `clean()` strips controls, collapses ws, `.slice(0,80)`; non-string→`""`→store nothing; verify-capture negatives (missing/empty/42) green | **Survived** — contract's `≤80 chars` and fail-closed negatives hold; unicode passes as a name (allowed by contract) |
| RF-013 | `UserPromptSubmit` reads payload fields other than prompt / ever reads `prompt` | `observationFor` returns fixed string **before** touching `hook.prompt` (never referenced in `capture.mjs`); canary asserts body/stdout/stderr (verify-capture:336-340) | **Survived** — prompt never read, only `cwd`/`session_id` consumed for project/session |
| RF-014 | Hook exit ≠0 or stdout/stderr noise on any path (incl. dead server, malformed JSON, TTY) | `uncaughtException/unhandledRejection→exit(0)`, `finally→exit(0)`, all catches swallow; verify-capture 115 incl. dead-server + `down: stderr EMPTY` | **Survived** |
| RF-015 | Plugin `execute.before` awaited/throwing, self-observes `memory*`, or reads `event.input` | `plugin:594-613`: detached `void call(...)`, `catch→record`, `startsWith("memory")` skip, only `toolName` used | **Survived** |
| RF-016 | `origin` length >100 accepted | REST/MCP `originSchema .max(100)` → 400; hook origin ≤23 chars, plugin origin 24 chars | **Refuted as an attack** |
| RF-017 | Version lockstep not 0.4.0 everywhere | `package.json:3` 0.4.0 · lock lines 3+9 0.4.0 · `src/mcp.ts:375` 0.4.0 · plugin `VERSION:63` 0.4.0 · README badge `v0.4.0` · CHANGELOG `[v0.4.0]` | **Survived** — 6/6 lockstep |
| RF-018 | CI missing the two new gates | `.github/workflows/ci.yml` runs `verify-lifecycle` + `verify-capture` (and typecheck, verify-injection, gitleaks) | **Survived** |
| RF-019 | `signals` semantics wrong (missing on envelope, silently no ttl signal, stale copy) | `search.ts:95-101` (bm25), `176-221` (hybrid: failure signals + ttl pushed before per-row copy) | **Survived** — envelope and rows always agree; signal only when hidden>0 |
| RF-020 | TTL filter order lets expired rows crowd out fresh ones past `limit` | `search.ts:214-215` filters **after** slice | **Survived (contract-sanctioned)** — §3 explicitly: "No over-fetch buffer … results may thin below limit"; no test asserts this, see residual risks |
| RF-021 | Dedup hit echoes ≠ contract §3 (echo of request `sessionId`/`concepts`) | `store.ts:458-464`; verify.ts race asserts both request sessionIds echoed | **Survived** — code matches the v1.1 dedup bullet verbatim (wording tension noted in residual risks) |
| RF-022 | T-103 evidence: "E2E (verify.ts + purge run log)" | `grep -in "ttl\|lifecycle\|purge\|decay" scripts/verify.ts` → **zero matches** | **Refuted (evidence pointer false)** — see CE-005 |
| RF-023 | **Cross-REQ: P1.6 dedup × P2.1 fixed-string hook content** | Live: ran `capture.mjs SessionStart` twice (sessions 1,2) + `PostToolUse Bash` twice (sessions 2,3), isolated project, server on 3151 | **Refuted (claim falsified)** — see CE-001 |
| RF-024 | Contract §3: "`lesson` is `remember` with `origin` forced to `lesson`" | Live: `remember` (origin rest) then `POST /memory/lesson` same content | **Refuted (claim falsified)** — see CE-002 |
| RF-025 | Contract §3 purge: "Output is an allowlist … never content" + delete-path CWE-117 parity | Probe A4: `projectSchema` accepts internal `\n`; live dry-run `--project $'evil\nFORGED…'` | **Refuted (log-line integrity)** — see CE-003 |
| RF-026 | `contentHash` doc (lifecycle.ts:61-64): "\n" separator makes `(a, "b\nc")` distinct from `("a\nb", c)` | Probe A1: both hashes equal `ea7fb08b…` | **Refuted (comment claim false)** — see CE-004 |

## Counterexamples Found

| ID | Counterexample | Impact (severity) | Reproduction |
|----|----------------|-------------------|--------------|
| CE-001 | **P1.6 dedup swallows P2.1 hook observations.** Hook contents are fixed strings (`agent session started`, `tool used: Bash`, …) and the dedupKey folds only `project+normalize(content)` — no `origin`, no `sessionId`, no time. Every repeated event after the first per project returns `deduped:true` and writes **nothing**, and the short-circuit (`store.ts:429-465`) skips the whole `saveMemory` batch, so the new session's `Session` node is never created either. Live proof: 4 hook events across 3 sessions → `{"counts":{"memories":2,"sessions":2}}` (expected 4/3); `refuter-sess-3` absent from `listSessions`; `recap sessionId=refuter-sess-2` shows only 1 of its 2 observations (its SessionStart is stored under sess-1). ROADMAP P2.1 claims "all 7 `capture.mjs` events land an observation" — refuted for every repeat. `verify-capture` stays green because it counts POSTs against a dedup-free local counting server. Contract §3 documents neither the interaction nor a hook carve-out. Owner: engineering (lane owner). **Medium** — functional regression of the lane's own P2.1 goal + silent session-index loss; no PII/data-loss of the first observation. Mitigation available (e.g., include `sessionId`/`origin`/time in the key for hook-origin writes, or bypass dedup for `hook:*` origins). | Server on 3151; `AGENT_MEMORY_PROJECT=refuter-P21-hook AGENT_MEMORY_URL=http://127.0.0.1:3151 bash -c 'echo "{\"cwd\":\"/tmp/a\",\"session_id\":\"s1\"}" \| node hooks/capture.mjs SessionStart'` ×2 with different session_ids + 2× `PostToolUse` with `tool_name:"Bash"`; then `GET /memory/health?project=…` → 2/2 |
| CE-002 | **`lesson` origin invariant broken on the dedup path + phantom sessionId echo.** `remember` (origin `rest`) then `POST /memory/lesson` with identical content → 201 `{"deduped":true, sessionId:"d2cd6ca7…"}` but the stored row's origin stays `"rest"` and **no row exists** with the echoed sessionId (session auto-generated per request). Contract §3 "`lesson` is `remember` with `origin` forced to `lesson`" is observably violated; recap for the echoed sessionId returns nothing despite a 201. Untested by all suites. Owner: engineering. **Low** — provenance loss + misleading echo; contract §3 dedup bullet has no lesson carve-out. | Live: `POST /memory/remember {content:"refuter origin probe P21 unique text", project:"refuter-P21-origin"}` then `POST /memory/lesson` same content → `deduped:true`; `POST /memory/search` → `origin:"rest"` |
| CE-003 | **Purge governance/health lines are newline-injectable (CWE-117 parity gap).** `projectSchema` (`server.ts:40`) accepts internal `\n` (probe A4: `"proj\nFORGED deleted=9999"` accepted) → stored as `Session.project`/`Memory.project` → `purge.ts:302-304,328-342` interpolates project raw into plan/health/governance lines. Live dry-run: `purge-plan project=evil` / `FORGED governance line days=3 cutoff=…` — one command, two log lines. Contrast: the `delete` path explicitly normalizes for CWE-117 (`server.ts:49-70`); purge does not. Contract §3 promises allowlisted purge output — fields are allowlisted, values are not line-safe. Owner: engineering. **Low** (guardrails) / **Medium** if governance-log integrity is a compliance control — requires memory-write access to plant the name + a purge run to render it (`--all` real runs render discovered names in `purge-health`). | `npx tsx scripts/purge.ts --days 3 --project "$(printf 'evil\nFORGED governance line')" --dry-run` → forged stderr line, exit 0 |
| CE-004 | **`contentHash` documented distinctness guarantee is false.** `src/lifecycle.ts:61-64` claims the `"\n"` separator makes `(project="a", text="b\nc")` distinct from `(project="a\nb", text="c")` — probe A1: both hash to `ea7fb08b7a2d…` (`sha256("a\nb\nc")`). The exported helper invites raw-text callers exactly as the comment describes. **Not reachable through `remember()` today** (normalize strips `\n` from text, and even newline-containing projects cannot collide against newline-free normalized text), so no live dedup bypass. Owner: engineering. **Low** — false guarantee on a security-adjacent primitive; latent for any future non-normalized caller. | `/tmp/opencode/refuter-probe.ts` A1 → `A1 comment collision: true` |
| CE-005 | **T-103's E2E evidence pointer does not exist.** TEST_MATRIX T-103 status says "Unit (verify-lifecycle) + **E2E (verify.ts** + purge run log)", but `scripts/verify.ts` contains **zero** matches for `ttl|decay|lifecycle|purge`. The TTL-hides-from-both-searches + `ttl:` **signal wiring** (`search.ts:95-101, 214-221`) is therefore asserted only at the unit `filterExpired` level — the route-level integration (signal emitted on REST responses, hidden count correct) has never been automatically tested. Contract §5 does not overclaim here (it attributes TTL to verify-lifecycle + purge to standalone runs) — the drift is in TEST_MATRIX. Owner: execute-spec/orchestrator (docs). **Low** — traceability overclaim + one untested integration seam. | `grep -in "ttl\|lifecycle\|purge" scripts/verify.ts` → no output |

**Counts:** 26 attack vectors — **22 survived** (claims held under attack),
**4 refuted against code/contract +1 refuted evidence claim = 5 counterexamples.**

## Verdict Rationale

**CONDITIONAL.** The six REQ acceptance cores (T-101 determinism/bounds, T-102
dedup semantics incl. race/cross-project, T-103 math/fence/fail-closed purge,
T-104 payload/silence/exit-0/privacy, T-105 no-regression re-runs, T-106
contract/docs/lockstep) all **survived** adversarial attack, including every
edge named in the HARD brief (empties, <3-char content, importance bounds, TTL
equality, λ extremes, `--all` empty, weird `tool_name`, prompt fields, origin
>100, echo exactness, signals, version lockstep). Local suites re-ran green
(typecheck 0, 34/34, 115/115).

But CE-001 is a **real, live-reproduced cross-REQ defect**: P1.6 dedup
undermines P2.1's end-to-end purpose and silently drops `Session` nodes — the
kind of interaction the green suites structurally cannot see (verify-capture's
counting server has no dedup). CE-002/003/004/005 are lower-severity
contract/evidence drifts. All have available mitigations; none invalidates the
spec itself → not FAILED, not PASS. Gate should hold until CE-001 is either
fixed or explicitly accepted with the ROADMAP/CONTRACT wording corrected, and
CE-005's TEST_MATRIX pointer repaired.

## Residual Risks (accepted / out of scope for this review)

1. **Multi-process dedup race** — server enforces no uniqueness (§0), the FIFO
   lock is in-process only (`store.ts:409-410`); `findMemoryByDedupKey` uses
   `.limit(1)` with no `orderBy`, so if duplicates ever exist the returned row
   is arbitrary. Documented in code; contract says "in-process" but does not
   spell out the multi-writer gap. Accepted (single-instance deployment).
2. **gitleaks local run unavailable** (2× download timeout) → CI secret-scan
   job is the enforcing gate on push; escalated by the lane, unchanged here.
3. **TTL thinning below `limit`** (filter-after-slice) is contract-sanctioned
   but has no test; combined with CE-005, route-level TTL behavior is
   unasserted.
4. **`Concept.project` is first-writer-wins** (upsert branch never updates it)
   — cross-project concept reuse misattributes metadata; benign because
   `graphSearch` filters `Memory.project`, not `Concept.project`.
5. **Contract §3 wording tension**: "The 201 echoes what was actually stored"
   (auto-concept bullet) vs "echoing the REQUEST's `sessionId`/`concepts`"
   (dedup bullet). Both are stated and the code follows each in its path, but
   a reader can read the first as universal; CE-002 shows the echo can name a
   session with no row.
6. **Plugin `memory*` skip is prefix-wide** — a foreign tool named e.g.
   `memory_bank` is also skipped (contract says "own `memory*` tools"); benign
   false-positive skip, no loop risk.
7. Probe artifacts: `/tmp/opencode/refuter-probe.ts`, server log
   `/tmp/opencode/refuter-server.log`; isolated probe data written under
   projects `refuter-P21-hook` / `refuter-P21-origin` on the dev instance
   (dev seed data per plan assumption §Rollback).

*Environment discipline: our server on 3151 started and stopped by this
review; upstream iii (3111, pid 2465) untouched; Helix (6969) never
restarted. No repository files modified other than this artifact.*

---

# Re-verification Round 2 — against `9210208`

**Reviewer:** review-refuter · **Date:** 2026-09-23
**Target:** `9210208 fix(gate-p1-p21): clear P1+P2.1 quality-gate conditions`
(8 files: purge, store, lifecycle, verify F4, CONTRACT, TEST_MATRIX, PLAN, README)
**Scope:** re-verify ONLY CE-001…CE-005; fresh attacks where cheap. Original
round-1 campaign above stays visible and authoritative for what was tried then.

## Per-CE re-verification

| CE | Round-1 claim | Remediation under test | Fresh attempt this round | Status |
|----|---------------|------------------------|--------------------------|--------|
| CE-001 | P1.6 dedup swallows repeated hook observations + drops Session nodes, undocumented | §3 "Dedup first-wins semantics" bullet (~L183) + `verify.ts` F4 pin + README dedup note | Read full F4 (12+ checks: novel S1 201/deduped:false → S2 same id/deduped:true/count==1/listSessions lacks S2/sessionMemories echo-vs-membership/cross-project new row); **re-ran the whole suite live: `152 passed, 0 failed, VERIFY PASS`** on our server (3151, started+stopped by me) | **SURVIVED-AS-DECLINED** — behavior is now explicit contract §3 semantics, pinned by F4 (green in my own run), README documents the no-Session-node consequence. Declined as a declared design decision (first-wins), not a defect. Residual hygiene: ROADMAP P2.1 (L95) still says all 7 events "land an observation" unqualified — now over-broad (→ NEW-002, Low) |
| CE-002 | `lesson` origin stuck at `rest` + phantom sessionId echo violated §3 lesson invariant | Same §3 paragraph declares first-wins: stored row keeps ORIGINAL origin/importance/sessionId; response echoes REQUEST sessionId; `sessionMemories` of echoed session empty until novel content | Wording-vs-code read (`store.ts:458-464` unchanged on the echo path) + **live re-run**: remember(origin=rest) → lesson same content → `deduped:true`, same id, response echoed NEW sessionId `74aa8a33…`, stored row `origin:"rest"` sessionId `9d0a9461…`, `GET sessions/74aa8a33…/memories` → `{"memories":[]}` | **REFUTED** — declaration matches observed behavior to the letter; the §3 internal wording tension is reconciled by the new bullet |
| CE-003 | Newline-bearing `project` forges standalone purge governance lines (CWE-117) | `oneLine()` (`\s+`→space, trim) at every purge render site, print-site only | Grepped ALL 14 `console.*` sites in purge.ts: every dynamic interpolation wrapped (incl. `failUsage`, ids, progress, health, governance, partial, `describeError` at catch; the 2 static literals need none); throw-time messages carrying raw `project` are oneLine'd at the catch render; **live re-run of the exact round-1 forgery**: output is now ONE line per event (`purge-plan project=evil FORGED governance line days=3 …`), no standalone forged line, exit 0; query still receives the verbatim project (correct print/query separation) | **REFUTED** — forgery repro no longer forges |
| CE-004 | `contentHash` docstring claimed false `"\n"`-split distinctness | Docstring rewritten: states the claim is FALSE at function level (`ea7fb08b…` acknowledged) + honest precondition | Proved the new claim myself: if `text` is newline-free (guaranteed by `normalizeContent`), the **last** `"\n"` in `project+"\n"+text` is exactly the separator (t contains none), so left-of-last-newline = project, right = t — the split uniquely recovers the pair even when project itself contains newlines; `ea7fb08b…` prefix matches my round-1 probe output byte-for-byte | **REFUTED** — new claim is provable and honest; production path stays collision-free |
| CE-005 | T-103 cited nonexistent `verify.ts` E2E; T-102 cited nonexistent `unique_constraint_violation` catch | Matrix rows rewritten; T-107/T-108 track the two real gaps; Coverage Summary fixed | Swept EVERY test pointer in matrix + plan: matrix T-101 "verify.ts D" valid (`verify.ts:300` section D exists), T-102 now says no such catch exists (true), T-103 evidence rewritten to unit+probe3+purge (true), T-107/T-108 rows honest, Coverage Summary corrected, T-105 counts 152 ✓. **BUT the plan was in the same brief and keeps two false cells** → NEW-001 | **SURVIVED (partially fixed)** — the two originally-cited matrix pointers are FIXED and gaps tracked; same-class falsehoods remain in IMPLEMENTATION_PLAN (brief's bar was "anywhere in the matrix/plan") |

**Round-2 counts:** 5 CEs re-attacked → **4 closed (REFUTED)**, **1 SURVIVED-AS-DECLINED (CE-001, declared+pinned)**, **1 partially-survived carried as NEW-001 (CE-005 scope)**. Suite re-runs: typecheck 0 · verify-lifecycle 34/34 · verify **152/152** (my own run on 3151).

## New refutations found this round

| ID | Counterexample | Severity | Location | Evidence |
|----|----------------|----------|----------|----------|
| NEW-001 | Two false cells remain in the lane singleton the same commit maintained: (a) IMPLEMENTATION_PLAN Step 2 still describes the shipped race design as "race → catch `unique_constraint_violation` → re-fetch" — no such catch exists (probe3 proved the server never enforces; matrix T-102 was rewritten to say exactly that, so the two lane docs now contradict each other); (b) Step 3's Target cell still points "lifecycle math + purge e2e on isolated project" at `scripts/verify.ts` — that E2E does not exist (zero `ttl\|decay\|purge` matches in verify.ts), the exact pointer class CE-005 was closed on in the matrix | **Low** (docs/traceability; the brief scoped the sweep to "matrix and plan") | `IMPLEMENTATION_PLAN.md:27` (Step 2 description), `IMPLEMENTATION_PLAN.md:28` (Step 3 target) | `git show 9210208` edited plan L43-52 + L62 but not L27/L28; `grep -n "unique_constraint_violation" IMPLEMENTATION_PLAN.md` → line 27; `grep -in "ttl\|decay\|purge" scripts/verify.ts` → no matches |
| NEW-002 | Doc-hygiene bundle: (a) ROADMAP P2.1 (L95) still claims all 7 events + plugin hook "land an observation" — over-broad now that repeats dedup (first-wins); (b) TEST_MATRIX T-105 evidence range `45380b5..8fbd795` attributes "verify 152/152" to a range not containing `9210208` (where F4/152 came from); (c) T-105 says verify ran "on `AGENT_MEMORY_PORT=3151`" but `verify.ts:24` targets `AGENT_MEMORY_URL` only — wrong env var name in the evidence text (the identity guard makes the mistake loud, no false-green possible) | **Low** (hygiene) | `ROADMAP.md:95`; `TEST_MATRIX.md:17` | commit stat: 9210208 did not touch ROADMAP; verify.ts L24; my round-2 run needed `AGENT_MEMORY_URL=http://127.0.0.1:3151` to pass |

## Fresh attacks that FAILED (no new defect)

- **oneLine coverage**: exhaustively enumerated purge render sites — none missed; ANSI/ESC (`\u001b`, not `\s`) can still ride a project name, but that is display-layer escape parity with the accepted P3.1 delete-reason guard (same transform), out of CE-003's line-forgery scope → residual note only.
- **C3 shape-drift guard false-positive**: novel write after remediation returns 201 with derived concepts (miss shape `null`/`[]` accepted live) and dedup hits still short-circuit through 152 assertions — fail-closed without write outage on the pinned instance.
- **C2 partial-audit line**: static read — usage errors `exit 2` before `audit` is set; dry-run never touches `audit.deleted`; success path prints governance once; partial line only in `main().catch` when `deleted>0`, discriminated `status=partial`. No double-line path found.
- **CE-002/F4 echo wording vs code**: every clause of the new §3 paragraph checked against `store.ts` — matches (including `concepts: []` stays `[]`).

## Round-2 Verdict Rationale

**CONDITIONAL — conditions now documentation-only.** All five behavioral/
evidence counterexamples from round 1 are closed where they mattered: CE-002,
CE-003, CE-004 REFUTED with live/static proof; CE-001 declined as explicitly
declared + test-pinned contract semantics (F4 green in my own 152/152 run);
CE-005's originally-cited matrix pointers fixed with real gaps tracked
(T-107/T-108). Exit condition: correct IMPLEMENTATION_PLAN Step 2's mechanism
cell and Step 3's test pointer (NEW-001, two cells, Low) — NEW-002 is
same-PR hygiene, non-blocking at Low. No source edits were made by this
reviewer; artifact only.

*Environment discipline (round 2): server started ONLY on 3151 (twice — once
died between commands, restarted), stopped after the final run; upstream iii
(3111, pid 2465) alive and untouched (one liveness GET in round 1, none in
round 2); Helix (6969) never restarted; purge probes used `--dry-run` only
(zero deletions); probe projects `refuter-P21-*` are isolated dev data.*

---

# Re-verification Round 3 — against `83e2f3a`

**Reviewer:** review-refuter · **Date:** 2026-09-23
**Target:** `83e2f3a fix(gate-p1-p21): close round-2 gate conditions — docs
truth + render-guard test` (docs truth + `src/logline.ts` render guard)
**Scope:** re-verify ONLY NEW-001 and NEW-002, then sweep plan/matrix/roadmap
for any REMAINING false test pointer or nonexistent-catch claim (round-2 exit
condition bar: "anywhere in the matrix and plan"). Code read-only; this
artifact is the only file touched.

## Per-condition re-verification

| ID | Round-2 condition | Fresh attempt this round | Status |
|----|-------------------|--------------------------|--------|
| NEW-001 (a) | PLAN Step 2 shipped the nonexistent `race → catch unique_constraint_violation → re-fetch` design | Cell now reads "race closed by a per-key in-process FIFO lock around that pre-check (shipped truth: probe3 proved the server does NOT enforce index #8 — application-side pre-check only, no `unique_constraint_violation` catch exists)". Checked against shipped code: `src/store.ts:399-431` `withDedupLock` (per-key FIFO queue, distinct keys never block) wraps `rememberLocked` → `findMemoryByDedupKey` pre-check (`store.ts:446`); index #8 declared at `db/queries.ts:157` (`nodeUniqueEquality(Memory, dedupKey)`); `grep -rn unique_constraint_violation src/ db/ scripts/ hooks/ plugins/` → **zero matches** (the negative claim is true); non-enforcement corroborated by `db/queries.ts:118` comment, CONTRACT §0 fact row (probe3 b2/d1/d2/d3), and ROADMAP P1.6 — plan/matrix/roadmap now tell ONE consistent story | **CLOSED** |
| NEW-001 (b) | PLAN Step 3 pointed "lifecycle math + purge e2e" at nonexistent `verify.ts` content | Target cell now: `verify-lifecycle` (pure: decay/TTL/dedup-hash/concepts) + `probe3` (e) `ltParam`; Evidence cell: "verify-lifecycle count (39) + probe3 GREEN + purge dry-run/exit-2 guard log (real-run not harnessed, code-reviewed)". Verified: `verify-lifecycle.ts` imports only `src/concepts/lifecycle/logline` (pure, no Helix) and **re-run this round → 39 passed, 0 failed**; `scripts/probe3.ts:286-400` section (e) `Predicate.ltParam("createdAt", cutoff)` exists; `purge.ts` supports `--dry-run` (`:97`) and `failUsage → process.exit(2)` (`:86`), with the real-run gap honestly declared (matches T-103 wording). The stale pointer is gone: `grep -in "ttl\|decay\|purge\|lifecycle\|expired" scripts/verify.ts` → **0 matches**, and no cell points there anymore | **CLOSED** |
| NEW-002 (a) | ROADMAP P2.1 over-broad: all 7 events "land an observation" | Now: "records an observation on **first occurrence (repeats dedup — first-wins, contract §3**)" — matches CONTRACT §3:183 "Dedup first-wins semantics (P1.6 × P2.1 interaction, pinned by F4)" bullet and the shipped behavior I reproduced live in round 2 (F4 green in my 152/152) | **CLOSED** |
| NEW-002 (b) | T-105 stale range `45380b5..8fbd795` + wrong env var `AGENT_MEMORY_PORT` in evidence text | Now `45380b5..HEAD (lane + gate remediation)` — `git merge-base --is-ancestor 45380b5 HEAD` OK; the range contains `9210208` + `83e2f3a`, i.e. exactly where F4/152 and the counts came from. Evidence now `verify 152/152 against our server (AGENT_MEMORY_URL=http://127.0.0.1:3151…)` matching `scripts/verify.ts:24` (`process.env["AGENT_MEMORY_URL"] ?? …3111`); **re-run this round with exactly that env var → 152 passed, 0 failed** | **CLOSED** |

## Sweep result (bar: zero remaining false pointers in matrix + plan + roadmap)

- **Nonexistent-catch claims:** only NEGATIVE claims remain — `IMPLEMENTATION_PLAN.md:27` and `TEST_MATRIX.md:14` both state "no `unique_constraint_violation` catch exists" (true: zero source matches); ROADMAP: none. Affirmative catch claims: **0**.
- **`verify.ts` test pointers:** every remaining citation resolves — D (`:300`), graph-branch F2 with the 3/61 pin (`:407`, `:461`), dedup F3 (`:467`), dedup×hook F4 (`:561`), §5 bar (`verify.ts:4`); no ttl/decay/purge/lifecycle pointer remains in matrix/plan/roadmap (Coverage Summary correctly attributes decay/TTL/purge to `verify-lifecycle` + `probe3 (e)` + purge runs + T-107/T-108).
- **Other pointers:** all cited commits exist (`b27364b`, `101e063`, `45380b5`, `8fbd795`; range `45380b5..HEAD` valid); every named script exists (`scripts/` incl. `verify-injection.ts`, wired in `ci.yml:25-28`); P0 `GATE_REPORT.md` exists; `package.json` scripts match plan step 5; ROADMAP P1.1/P1.3/P1.6/P2.1 evidence claims all check out (39 and 152 re-run this round).
- **BUT one NEW false test pointer of the same class surfaced** → NEW-003.

## New refutation found this round

| ID | Counterexample | Severity | Location | Evidence |
|----|----------------|----------|----------|----------|
| NEW-003 | PLAN Quality Gates line claims `npm run verify`'s 152 checks comprise "§5 bar + dedup/**concept/lifecycle** + dedup×hook (F4) **sections**" — `scripts/verify.ts` has **no lifecycle section and zero lifecycle content** (the line lists the three P1 REQ areas as if all were sections of `verify`; P1-1 is exactly the gap T-107/T-108 track as "not yet harnessed"). The lane's own CHANGELOG enumerates the 102→131→152 growth honestly ("derived-concepts, graph-branch, dedup/race, dedup×hook (F4)") — plan L62 disagrees with CHANGELOG, matrix, and verify.ts, the exact CE-005/NEW-001 class in a third cell. Fix is one word: drop "lifecycle" (verify-lifecycle is already credited at L59) | **Low** (docs/traceability only; the same line's numbers — 152 passed, verify-env 21, demo/bootstrap — are TRUE, 152 re-run this round) | `IMPLEMENTATION_PLAN.md:62` | Full section inventory of verify.ts = A, B, C, D, E, F, F2, F3, F4, G–N8, M — none lifecycle; `grep -ic` in verify.ts: `ttl 0, decay 0, purge 0, lifecycle 0, expired 0, filterExpired 0, hidden 0`; `verify.ts:4` defines the §5 bar as "health → remember → bm25 hits → smart-search hits"; `package.json` → `verify = tsx scripts/verify.ts` (no chaining, so "sections" can only mean verify.ts's); `CHANGELOG.md:49-51` (same lane, count updated IN `83e2f3a`) omits lifecycle from the section list; provenance `git log -L 62,62` + `git show 9210208`: wording introduced by `eb279a6`, F4 appended by `9210208`, counts updated by `83e2f3a` with "lifecycle" kept. Steelman considered and rejected: sections I/J/K (forget/gone/count) are a memory's create→delete arc, but this lane's vocabulary pins "lifecycle" to decay/TTL/purge everywhere (`src/lifecycle.ts`, `verify-lifecycle`, REQ-P1-1, step 3) — under that vocabulary the claim is false; under the loose reading it still contradicts CHANGELOG's own enumeration. Missed by my round-2 sweep (focused on steps 2–3): owned, not the lane concealing it |

**Round-3 counts:** 2 conditions re-attacked → **2 CLOSED**; sweep → **1 NEW
false pointer (NEW-003, Low)**; **0 behavioral refutations** (no behavior
claims in scope). Re-runs: `typecheck` exit 0 · `verify-lifecycle`
**39/39** · `verify` **152/152** (my own run,
`AGENT_MEMORY_URL=http://127.0.0.1:3151`).

## Round-3 Verdict Rationale

**CONDITIONAL — one single-line doc condition remains.** NEW-001 and NEW-002
are closed to the letter: both plan cells now match shipped code cell-for-cell
(step-2 mechanism → `store.ts` FIFO-lock pre-check with a provably absent
catch; step-3 tests → `verify-lifecycle`/`probe3 (e)`/purge dry-run+guard with
the count verified live), ROADMAP P2.1 is honest first-wins wording, and
T-105's range + env var are correct and re-proven 152/152 this round. The
round-2 exit condition was explicitly "zero false test pointers anywhere in
the matrix and plan" — NEW-003 means that bar is not yet met. Same Low
doc-only class, zero behavior at risk, one-word fix → **CONDITIONAL**, not
FAILED; unmet exit condition → not PASS.

*Environment discipline (round 3): server started ONLY on 3151 (pid 216419),
verify run once against it, stopped immediately after (port confirmed free);
upstream iii (3111, pid 2465) confirmed alive and untouched before and after;
Helix dev (6969) never restarted (still "Up 5 hours"); no purge or probe writes
this round (probe3 NOT re-run — it writes, and was not in the approved re-run
list; its GREEN verdict rests on the recorded CONTRACT §0 facts and source
review); approved re-runs only (typecheck, verify-lifecycle 39, verify 152);
no repository files modified other than this artifact.*

---

# Re-verification Round 4 — uncommitted fix atop `83e2f3a`

**Reviewer:** review-refuter · **Date:** 2026-09-23
**Target:** working-tree diff (NOT committed) — orchestrator's one-cell fix to
NEW-003 on `IMPLEMENTATION_PLAN.md` at HEAD `83e2f3a`.
**Scope:** (1) prove the diff is exactly that one-cell correction and nothing
else; (2) final six-file sweep — IMPLEMENTATION_PLAN / TEST_MATRIX / ROADMAP /
CHANGELOG / README / docs/CONTRACT — for false test pointers, nonexistent-catch
claims, phantom sections; (3) hunt refutations in the diff itself. Read-only;
this artifact is the only file touched.

## (1) Diff-scope verification — CLEAN

- `git diff --numstat` → **`1 1 IMPLEMENTATION_PLAN.md`** (one hunk, one line);
  `git status -uall` → that file modified plus the 9 pre-existing untracked
  quality-gate artifacts (mine + 8 peers', untracked since round 1 — not part of
  this diff, unchanged). Nothing else in the tree moved: no source, no scripts,
  no other doc.
- The hunk is verbatim the prescribed fix: L62 Quality Gates cell
  `§5 bar + dedup/concept/`**`lifecycle`**` + dedup×hook (F4)` →
  `§5 bar + dedup/concept + dedup×hook (F4) sections` — the word "lifecycle"
  dropped, all other content of the line byte-identical.

## (2) NEW-003 re-verification → **CLOSED**

| Claim on the corrected line | Resolution |
|---|---|
| `§5 bar` | `verify.ts:4` defines it (health → remember → bm25 → smart-search …) |
| `dedup` section | `F3` content-hash dedup, `verify.ts:467` |
| `concept` sections | `D` derived-defaults, `verify.ts:300` + `F2` graph-branch/3-61 pin, `verify.ts:407` |
| `dedup×hook (F4)` | `verify.ts:561` |
| `152 passed` | re-run 152/152 by this reviewer in round 3 on identical code (diff touches no code) |
| `verify-lifecycle` credit | correctly still at L59 ("39 passed") — TTL/decay/purge coverage attributed where it belongs |

Negative control re-run: `grep -icE "ttl|decay|purge|lifecycle|expired|filterExpired"
scripts/verify.ts` → **0**. The phantom-section claim is gone from the plan; the
corrected line now enumerates only sections that exist. **NEW-003: CLOSED.**

## (3) Refutations in the diff — NONE

Docs-only (`tsc` and all suites never read `.md`; code byte-identical to the
state where this reviewer re-ran typecheck 0 / verify-lifecycle 39/39 / verify
152/152 in round 3) → the diff introduces no behavioral surface and no false
claim of its own. **Re-runs skipped deliberately** — repeating them would add
zero verification value (guardrail: no busywork theater); approved list not
consumed.

## Final six-file sweep — standards and results

| Standard (original, round-1/3 evidence) | Result |
|---|---|
| Affirmative `unique_constraint_violation` catch claims (source grep = **0**) | **0 affirmative** — only NEGATIVE claims remain: `IMPLEMENTATION_PLAN.md:27`, `TEST_MATRIX.md:14` ("no … catch exists" — true) |
| Every `verify.ts` pointer resolves (D:300, F2:407+461, F3:467, F4:561, §5:4) | all resolve; zero ttl/decay/purge/lifecycle pointers aimed at `verify.ts` in matrix/plan/roadmap/CHANGELOG/CONTRACT |
| Phantom §-sections | `§0`–`§5` all exist as CONTRACT headers; `§3.2` (plan L11) = ROADMAP §3 item 2 (env prefix) — valid |
| Named scripts / files / commits exist | all ✓ (incl. `GATE_REPORT`, `WAIVERS-P0`, SECURITY/CONTRIBUTING/LICENSE, `src/demo.ts` as CONTRACT:342 claims — no doc claims `scripts/demo.ts`); all 8 cited commits valid (`b27364b`, `101e063`, `45380b5`, `8fbd795`, `9210208`, `83e2f3a`, `eb279a6`, `1c410ee`) |
| Count claims consistent (152/39/115/73/21/8) | mutually consistent across all six docs |
| NEW-003's exact standard: "lifecycle" attached to `npm run verify`'s section-set | **1 hit → NEW-004** (below) |

## New refutation found this round

| ID | Counterexample | Severity | Location | Evidence |
|----|----------------|----------|----------|----------|
| NEW-004 | README's Verification bullet for `npm run verify` says the run covers "… second delete 404 → counts, and **the v1.1 lifecycle sections**: derived default concepts ≤8 → graph-branch proof → content-hash dedup round-trip → race → dedup × hook first-wins". `verify.ts` has **zero** lifecycle content (original NEW-003 control re-run: `grep -icE "ttl\|decay\|purge\|lifecycle\|expired\|filterExpired" scripts/verify.ts` → **0**), and the enumerated members are the P1.3/P1.6/P2.1×P1.6 sections — none is REQ-P1-1 lifecycle (lane vocabulary pins lifecycle = decay/TTL/purge: `src/lifecycle.ts`, `verify-lifecycle`, ROADMAP P1.1). It contradicts the same README bullet 11 lines later (decay/TTL credited to `npm run verify-lifecycle`, README:516), CHANGELOG's own enumeration of the 102→131→152 growth (no lifecycle, CHANGELOG:49-51), and the plan cell just fixed — the exact CE-005 / NEW-003 class, third instance, first in README. README was outside the round-3 sweep bar (matrix+plan+roadmap), so this is newly in scope under round-4's six-file bar, not a regression. Steelman rejected: reading "lifecycle" as describing the v1.1 *release* rather than section content fails too — the release's lifecycle features (decay/TTL/purge) never landed in `verify.ts`, so either parse associates `npm run verify` with coverage that does not exist (and would understate the T-107/T-108 "not yet harnessed" gaps). Fix is one word, same as NEW-003: drop "lifecycle" → "the v1.1 sections:" (`verify-lifecycle` already credited at README:516) | **Low** (docs/traceability only; the colon-list self-defines the sections, all of which are real, so reader harm is limited to the section-identity label) | `README.md:505` | `grep -nE "(npm run verify\`\|\`scripts/verify\.ts\`)[^\n]*lifecycle\|lifecycle sections" <six files>` → single hit `README.md:505`; control grep above = 0 |

**Round-4 counts:** 1 condition re-attacked → **1 CLOSED (NEW-003)**; diff
review → **0 refutations** (docs-only, exact one-cell scope); six-file sweep →
**1 same-class pointer (NEW-004, Low)**, everything else clean. No re-runs
(docs-only diff — reasoning above). No retry loop needed: every grep standard
ran clean on first execution (no FAIL → no retry → no escalation).

## Round-4 Verdict Rationale

**CONDITIONAL — one single-line doc cell remains, outside the fixed file.**
NEW-003 is closed to the letter: the diff is exactly the prescribed one-cell
correction, nothing else in the tree changed, and the corrected line's every
claim resolves against shipped code. Zero behavioral refutations — there is no
behavioral surface in a docs-only diff. But the exit condition for this round is
"zero false test pointers / nonexistent-catch claims / phantom sections anywhere
in [six files]", and README.md:505 carries the same phantom "lifecycle
sections" attribution to `npm run verify` that NEW-003 condemned in the plan —
identical class, identical one-word fix, newly swept file. One Low docs-only
cell unmet → not PASS; one word, zero behavior at risk → not FAILED. Round-1/
2/3 findings and dispositions unchanged.

*Environment discipline (round 4): fully read-only — NO server started (3151
not touched this round), upstream iii (3111) untouched, Helix never restarted,
no probe/purge writes; evidence = `git diff/status/log` + static greps against
the six docs and `scripts/verify*.ts` only; no source or doc edits — this
artifact is the only file modified.*

---

# Re-verification Round 5 (FINAL) — bounded confirmation of the two-cell fix

**Reviewer:** review-refuter · **Date:** 2026-09-23
**Target:** working-tree diff atop `83e2f3a` — the orchestrator's SYSTEMATIC
class-wide sweep result: two uncommitted one-cell doc fixes
(`IMPLEMENTATION_PLAN.md` L62 = NEW-003, `README.md` L505 = NEW-004).
**Scope (bounded, this round only):** (1) prove `git diff` is exactly those two
cells and nothing else; (2) re-run MY original class standard — false
"lifecycle / phantom-section attributed to `npm run verify` / verify.ts
content" — across the six files (README, IMPLEMENTATION_PLAN, TEST_MATRIX,
ROADMAP, CHANGELOG, docs/CONTRACT) → report instance count; (3) hunt any
behavioral refutation in the diff. Any DIFFERENT new class → tracked Low in
this RETURN, never a gate condition (explicit scope cap). Read-only; this
artifact is the only file touched.

## (1) Diff-scope verification — EXACTLY TWO CELLS

- `git diff --numstat` → **`1 1 IMPLEMENTATION_PLAN.md`** and **`1 1 README.md`**
  (`2 files changed, 2 insertions(+), 2 deletions(-)`) — nothing else in the
  tree moved: no source, no scripts, no other doc.
- `git status --porcelain -uall` → the two modified files above + the 9
  pre-existing untracked quality-gate artifacts (mine + 8 peers', untracked
  since round 1, unchanged — not part of the diff).
- Both hunks verbatim the prescribed fixes:
  - `IMPLEMENTATION_PLAN.md` L62: `§5 bar + dedup/concept/`**`lifecycle`**` +
    dedup×hook (F4) sections` → `§5 bar + dedup/concept + dedup×hook (F4)
    sections` (word "lifecycle" dropped, rest byte-identical).
  - `README.md` L505: `and the v1.1 `**`lifecycle`**` sections:` → `and the
    v1.1 P1.3/P1.6 sections:` (word swapped, rest byte-identical).

## (2) Class re-run (original standards) → **0 instances remaining**

Control (unchanged): `grep -icE "ttl|decay|purge|lifecycle|expired|filterExpired"
scripts/verify.ts` → **0** — verify.ts still has zero lifecycle content, so any
line attributing lifecycle sections to `npm run verify` is false by definition.

| Standard (round-3/4, this class) | Result |
|---|---|
| lifecycle attached to `npm run verify`'s section-set / `scripts/verify.ts` content | **0** — dedicated grep (all "lifecycle" lines whose `verify` token is NOT part of `verify-lifecycle`) → no hits |
| `lifecycle sections` / `concept/lifecycle` / `v1.1 lifecycle` phantom patterns | **0** — both former instances (plan L62, README L505) fixed; NEW-003 **CLOSED**, NEW-004 **CLOSED** |
| Full dispositive pass over every `lifecycle` hit in the six files (27 lines) | all legitimate: lane titles (PLAN:1, MATRIX:1, ROADMAP:80), `verify-lifecycle` script credits (README:99/110/516, PLAN:26/28/30/31/59/66, MATRIX:13/14/15/18/24/28, ROADMAP:44/84, CHANGELOG:37, CONTRACT:354), `src/lifecycle.ts` module refs (PLAN:28 target cell, PLAN:52 rollback note, CONTRACT:162 §3), ROADMAP "Memory lifecycle" row (:36/:84), CHANGELOG "Memory lifecycle — corte A" (:24) |
| README:505 corrected label's accuracy | "P1.3/P1.6 sections" matches TEST_MATRIX attributions: T-101 (REQ-P1-3) → verify.ts D + graph-branch; T-102 (REQ-P1-6) → verify.ts dedup + dedup×hook sections — both confirmed existing (D:300, F2:407, F3:467, F4:561) |

Execution note (owned): my first class-grep attempt self-degenerated — an
unescaped backtick in the pattern command-substituted to empty, making an
alternation that matched every line; detected from the output shape, re-ran
with fixed quoting → clean 0 on retry N=1 (no third loop, no escalation).

**Class extinction: instances remaining = N = 0.**

## (3) Behavioral refutation hunt in the two-cell diff — **NONE**

Docs-only (tsc and all suites never read `.md`); code byte-identical to the
state where this reviewer re-ran typecheck 0 / verify-lifecycle 39/39 / verify
152/152 (rounds 2–3). Every remaining claim on both corrected lines resolves
against shipped code (see round-4 table for L62; L505's colon-list enumerates
only real verify.ts sections, correctly labeled P1.3/P1.6). No new class
surfaced in this round's sweep — the one different-class find below is
reported per the scope cap as tracked backlog, not a gate condition.

## Tracked item (different class — NOT a gate condition)

| ID | Item | Severity | Location | Evidence |
|----|------|----------|----------|----------|
| NEW-005 | Plan Step 3 description names the symbol `dedayImportance` (slash-paired with `decayedImportance`) — **no such symbol exists in any source**: `dedayImportance` is a typo'd/stale name; the real export is `decayedImportance` only. Same false-pointer family as CE-005/NEW-001 but a DIFFERENT class from this round's bounded class (bogus symbol name, not lifecycle-to-verify attribution) → per scope cap: tracked Low, orchestrator records in GATE_REPORT with owner (engineering/lane docs) + expiry. Fix is one word if remediated: drop `dedayImportance/`. | **Low** (docs/traceability; the correct symbol is listed right beside it, so a reader lands on working code) | `IMPLEMENTATION_PLAN.md:28` (Step 3 description cell) | `grep -rn 'dedayImportance' src/ db/ scripts/ hooks/ plugins/` → **0 matches**; `src/lifecycle.ts:94` exports `decayedImportance` (imported at `src/search.ts:21`) |

## Round-5 counts and verdict

**Round-5 counts:** exit conditions **2/2 met** (diff exact ✓, class extinct ✓);
behavioral refutations in diff **0**; new different-class finds **1** (NEW-005,
tracked Low, non-blocking); retries 1 (grep quoting, succeeded first re-run).

**FINAL VERDICT: PASS.** The bounded class — "lifecycle / phantom sections
attributed to `npm run verify` / verify.ts content" — is extinct across all six
files (0 instances), the working tree contains exactly the two prescribed
one-cell doc fixes, and the diff carries no behavioral surface to refute.
NEW-005 rides as tracked Low with owner+expiry in GATE_REPORT per the agreed
disposition. Rounds 1–4 campaigns, findings, and dispositions stand unchanged.

*Environment discipline (round 5): fully read-only — NO server started, upstream
iii (3111) untouched, Helix never restarted, no probe/purge writes; evidence =
`git diff/status` + static greps against the six docs and `scripts/verify.ts`
only; no source or doc edits — this artifact is the only file modified.*
