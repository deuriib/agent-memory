# Test / Evidence Matrix: REQ-RL-001 + REQ-F-01 (residual closure lane)

**Agent:** vasquez (Engineering Owner R1, execute-spec lane)
**Date:** 2026-09-23 (gate RL001-F01 remediation pass: 2026-09-24)
**Domains-Touched:** engineering (R1)

Prior lane evidence preserved in git history (this file is the lane singleton,
updated in place per execute-spec).

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-RL-001 | T-RL-001 | Per-survivor FIFO lock closes the lost-append on CONCURRENT distinct near-dup variants: `survivorTails` + `withSurvivorLock` (lock ordering dedupKey OUTER → survivor INNER, one survivor per merge, no cycle) + ADDITIVE `getMemoryById()` fresh re-read under the lock (filterExpired re-run → expired-while-waiting falls to plain insert; fresh-read miss → fail-closed throw) + §P concurrent test: base variant saved, then N=3 DISTINCT near-dup variants fired CONCURRENTLY via `Promise.all` on one fresh project → all three `consolidated:true` with the SAME survivor id, healthCount memories = 1, sessions = 1, and the session read shows ALL THREE variant wordings in the survivor content (no lost append) | E2E live (`verify.ts` §P `RL-001 concurrent` block, server :3151) + pure seam (`verify-lifecycle` §I TTL×merge control now serves the fresh read — `consolidated=true`, no insert write, canned-reply queue traps any unexpected send) | **DONE** — counts pasted below | commit 1 (see git log) |
| REQ-F-01 | T-F-01 | Post-write verify + heal for `updateMemoryContent`: ADDITIVE `memoryConcepts()` (memoryId+project → HAS_CONCEPT → `["names"]`) + ADDITIVE `linkMemoryConcepts()` (link-only WriteBatch, content/embedding/dedupKey untouched) + pure `missingConcepts(linked, incoming)`; `consolidateInto` verifies content / dedupKey / linked-concept invariants after every merge write, heals ONCE (content-state wrong → full `updateMemoryContent` retry; links-only missing → `linkMemoryConcepts`), re-verifies, still wrong → fail-closed throw naming the invariant; substring-guard path now runs the concept-link verify+heal instead of returning without a read. §P heal test: A → survivor, B → merged (content `A\nB`), re-save B + NEW explicit concept C → guard path links C; `smart-search concepts=[C]` recalls the survivor with fused-score Δ == 1/61 vs the no-concepts control (graph-branch causality) while content byte-length stays exactly `A\nB` (no duplicate append); response keeps `consolidated:true` + survivor id + REQUEST concept echo | E2E live (`verify.ts` §P `F-01 heal` block) + pure goldens (`verify-lifecycle` §G `missingConcepts`: order-independence over shuffled input, dedup, exact-name/case match, no substring match, empty-set cases) + seam (§I guard path serves the concepts read) | **DONE** — counts pasted below | commit 2 (this release lane) |

## Coverage Summary

- Evidence coverage: 2/2 REQ-IDs, each → test → artifact row.
- RL-001 acceptance covered by T-RL-001 E2E (the exact failure mode: 3
  concurrent distinct variants, post-state content includes all three).
- F-01 acceptance covered by T-F-01 E2E (heal observable via the graph branch
  while content provably untouched) + §G pure goldens for the set-difference
  helper.
- No-regression: §G consolidation goldens, §I fail-closed probe + TTL×merge,
  §P original 3-variant sequence (P1–P8) all green in the final bar below.
- Docs: ROADMAP / CONTRACT / README untouched by this lane (second lane owns
  them); contract deltas reported in the lane report for verbatim pickup.

## Commit-1 bar (REQ-RL-001 tree, run 2026-09-23, server :3151, Helix dev untouched)

- `npm run typecheck` — exit 0 (no errors).
- `npx tsx scripts/bootstrap.ts` — `bootstrapIndexes: OK (8 indexes ensured)` + `READY` (no index added).
- `npm run verify-lifecycle` — **104 passed, 0 failed** / `VERIFY PASS` (§I TTL×merge control re-based to the fresh read: `TTL OFF control -> same candidate consolidates (consolidated=true, pre-check + fresh re-read, no insert)` PASS).
- `npm run verify` — **227 passed, 0 failed** / `VERIFY PASS`; T-RL-001 block verbatim:
  - `PASS rl-001: base status 201`
  - `PASS rl-001: base body`
  - `PASS rl-001: base is a plain insert (deduped=false, consolidated=false)`
  - `PASS rl-001: variant 0 body` / `variant 1 body` / `variant 2 body`
  - `PASS rl-001: all 3 concurrent variants -> status 201`
  - `PASS rl-001: all 3 consolidated=true, deduped=false, SAME survivor id (serialized per survivor)`
  - `PASS rl-001: health envelope after 3 concurrent merges`
  - `PASS rl-001: 1 base + 3 concurrent merges -> memories = 1, sessions = 1`
  - `PASS rl-001: sessionMemories(rlSid0) envelope`
  - `PASS rl-001: survivor content contains ALL THREE variant wordings verbatim (no lost append)`
  - `PASS rl-001: cleanup forget survivor -> 200`

## Final verification bar (run on the commit-2 tree, server :3151, Helix dev untouched)

- `npm run typecheck` — exit 0 (no errors).
- `npx tsx scripts/bootstrap.ts` — `bootstrapIndexes: OK (8 indexes ensured)` + `READY` (no index added by either REQ).
- `npm run verify-lifecycle` — **113 passed, 0 failed** / `VERIFY PASS` (includes §G `missingConcepts` goldens + §I guard-path heal seam: `TTL OFF control -> consolidates via guard; guard path heals missing concept links offline (consolidated=true, 5 sends, NO insert)` PASS).
- `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` — **243 passed, 0 failed** / `VERIFY PASS`; T-RL-001 block (13 checks) green in the same run; T-F-01 `f-01:` block verbatim (tail):
  - `PASS f-01: guard re-save -> 201, consolidated=true, deduped=false, SAME survivor id`
  - `PASS f-01: response echoes REQUEST concepts [C] (first-wins echo unchanged on the guard path)`
  - `PASS f-01: response echoes the REQUEST sessionId (contract §3 echo unchanged on the guard path)`
  - `PASS f-01: sessionMemories(fSidA) envelope (after heal)`
  - `PASS f-01: survivor content BYTE-IDENTICAL after the guard-path heal (A\nB — no re-append, no rewrite)`
  - `PASS f-01: control smart-search (no concepts) envelope`
  - `PASS f-01: smart-search concepts=[C] envelope`
  - `PASS f-01: smart-search concepts=[C] fused score = control + 1/61 (graph leg rank 1 — the HEALED link caused the recall)`
  - `PASS f-01: cleanup forget survivor -> 200`
- Adjacent suites (no-regression on the shared store): `verify-capture` **137 checks, 0 failed**; `verify-env` **21 passed, 0 failed**; `verify-skills --structural` **73 passed, 0 failed**; `verify-injection` **ALL PASS** (exit 0).
- Incident note (harness, not product): the first commit-2 `verify` attempt returned `internal_error` on `health`/`remember` because the Helix dev CONTAINER was inside a restart window (`helix status` uptime reset to <1s; SDK `fetch failed … Cannot reach Helix at http://localhost:6969/v2/query`). Re-run green once the container was back; no code change came from this. One test-fixture root cause was found and fixed in-lane (Phase-1 single hypothesis): the §I canned reply at call 5 fed `names` as a STRING array while `memoryConcepts` returns RECORDS `{name}` (`PropertyProjection.new("name")`) and `readLinkedConcepts` drops non-record rows via `toRecords` — so the re-read saw zero linked names and failed closed with all 7 missing. Fixture corrected to `i5ExpectedConcepts.map((name) => ({ name }))`; product code unchanged (fail-closed behavior was correct).

## Gate-remediation bar (gate RL001-F01, lane 2026-09-24)

Full verification bar after the RL001-F01 condition-clearance changes (one run, in order, each command pasted with its own counts). `scripts/verify.ts` mints fresh uuid test sessions per run: the memory rows self-clean via `forget` at test end, but **no Session deletion path exists**, so each run leaves **+17 Session nodes** (the run-budget declaration lands in `docs/CONTRACT.md` §5, commit 2).

| # | Command | Result |
| - | ------- | ------ |
| 1 | `npm run typecheck` | exit 0 (0 errors) |
| 2 | `npx tsx scripts/bootstrap.ts` | exit 0 — `OK (8 indexes ensured)` + READY (still 8 indexes) |
| 3 | `npm run verify-lifecycle` | **117 passed, 0 failed** (2026-09-23 baseline 113; +4 = RF-03 seams a/b/c + RK-02 response-shape assert) |
| 4 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` | **243 passed, 0 failed** (:3151; §P f-01 covers RF-04) |
| 5 | `npm run verify-env` | **21 passed, 0 failed** |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** |
| 7 | `npm run verify-capture` | **137 passed, 0 failed** (incidental, not part of the gate bar) |
| 8 | Session-node run budget (RK-01 evidence) | `helix query dev -e '… nWithLabel("Session").count() …'`: 490 → 507 → **524** — **+17 per `verify` run**, measured ×2 (2026-09-24); accumulation unbounded until reset → declared in `docs/CONTRACT.md` §5 (commit 2) |

COND → test/evidence → artifact:

| COND | Test / evidence | Artifact |
| ---- | --------------- | -------- |
| RD-01 | `verify-lifecycle` §M write-path doc contract (`WITHOUT a write`, `receive-and-wait`, `vanishes`, `heal`, `req_id`) | `src/store.ts:809-821` |
| RF-01 | Re-scope to CONTRACT §3 tier-1 **(b)** — doc-level, no code | `docs/CONTRACT.md` §3 |
| RF-02 | §P f-01: one-time-hash secret hash proven never → embedding path (243 bar, 1 call) | `scripts/verify.ts` §P f-01 |
| RF-03 | `verify-lifecycle` §I-c seam cases — (a) expired-while-waiting → **insert sent** (3 sends), (b) fresh-read miss → reject, `links` stale after heal → **8 sends** (merge-path `verifyMergedState` retryWrite variant = the exact cited location), (c) post-heal still-violated → named throw (8 sends); plus RK-02 response-shape assert in §I | `scripts/verify-lifecycle.ts` §I-c |
| RF-04 | Typecheck (0) + §P f-01 live embed pass after DB-API param-order pin | `db/queries.ts:111` |
| RS-02 | Doc declaration of the AU-002 send envelope (NO queue cap / waiter deadline / circuit breaker) | `docs/CONTRACT.md` §3 |
| RK-01 | `docs/CONTRACT.md` §5 session-node run budget declared (+17/run, measured 490→507→524, re-review P4.1/2026-12-31) + §3b crash-window carve-out + `ROADMAP.md` §1.3 `VERIFY-SESSION-NODES` row; `verify` 243 green post-declaration (evidence #8) | `docs/CONTRACT.md` §5, §3; `ROADMAP.md` §1.3 |
| RK-02 | Two heal log sites + §I message-stability assert + `heal survivor=expired-hit links=7` observed on a live run (stderr) | `src/store.ts:1048, 1166` |
| RK-03 | `README` §G line count → 117; structural `verify-skills` gate-line pass (73 bar) | `README.md:607` |
| QA-05 | This section — per-command counts, single consolidated bar | `TEST_MATRIX.md` |
| QA-06 | ROADMAP verification row counts → 243 / 117 / 137 | `ROADMAP.md:44` |

Deviations from the packet's literal wording, resolved toward the gate reports' verbatim clear criteria (truth + "confirm totals first" over stale literals): lifecycle **117** (packet predates the +4 checks RF-03/RK-02 mandate); RK-02 log on **stderr** (store may not write stdout — `src/mcp.ts:381`; both streams are the §3 governance log); RK-01 "zero NO rows remain" required the §5 run-budget addition + §3b carve-out; RF-01 via re-scope option (b); RS-02 keeps the AU-002 numbers as criterion (c) alternative; archived docs (`docs/specs/50_archive/**`, `RELEASE_NOTES`) and reviewer-owned gate reports keep their historical counts.

## P4 OPS — ops control plane (SPEC-P4-OPS, executed 2026-09-24, server :3151 + slot2 live window 3114/6970)

**Spec:** `docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` · **Harness:** `scripts/verify-ops.ts` (§A–§L) + live slot-2 window (3114/3115/3116/6970, instance `slot2`, `dev` 6969 read-only) · **A3:** FAIL — HELIX_DATA_DIR not forwarded (see IMPLEMENTATION_PLAN §Step 0), P4.4 framing 3b pending orchestrator

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P4-OPS-01 | T-P4OPS-01 | CLI surface: `bin/agent-memory.mjs` (Node ≥20 ESM, `node:` builtins only) registered as `bin.agent-memory`, `--help` lists start\|stop\|status\|doctor (exit 0), unknown subcommand/flag or invalid `--slot` → usage on stderr exit 2; `package.json` only gains `bin` + `verify-ops`, `package-lock.json` untouched (AC-01) | E2E harness `verify-ops` §A + `git diff` | **DONE** | f8e29f1 |
| REQ-P4-OPS-02 | T-P4OPS-02 | `start --slot 2` spawns Helix `slot2` (`helix add local --name slot2 --port 6970` once, then `helix start slot2`, never `--persist`) + `npx tsx src/server.ts` with §4.3 env (AGENT_MEMORY_PORT=3114, HELIX_URL=6970, state 0600/0700), readiness gate Helix `/healthz` + `/memory/livez` ≤30 s, pre-flight quartet refuse + NEVER-kill hint exit 1 no signal, `git diff --stat src/ db/` empty (AC-02, KR2) | E2E harness `verify-ops` §B + live slot-2 (see bar #10) | **DONE** | f8e29f1, 8d6ae81 |
| REQ-P4-OPS-03 | T-P4OPS-03 | `stop --slot 2` SIGTERM→SIGKILL tracked PIDs only with `verifyOwnedPid()` pre-SIGTERM and pre-SIGKILL (C10), `helix stop slot2`, removes state, idempotent exit 0; foreign quartet PIDs unchanged, stale/mismatch → `stale-pid` note exit 1 no signal (AC-03) | E2E harness `verify-ops` §C + live slot-2 | **DONE** | f8e29f1 |
| REQ-P4-OPS-04 | T-P4OPS-04 | `status --slot N` read-only quartet + REST/Helix probes + data-dir + `bearer: armed\|unset` (presence-only, never value, never Authorization header; 401=armed) exits 0/1/2 distinct from doctor (AC-04, KR1) | E2E harness `verify-ops` §D + KR1 session | **DONE** | f8e29f1 |
| REQ-P4-OPS-05 | T-P4OPS-05 | `doctor --slot N` C1→C3→C2→C4→C5 (C3 ports before C2 bearer), one `PASS\|FAIL\|INFO <check-id>` per check + exactly one `VERDICT: <name>`, closed exits 0/1/2/3/4/5 precedence 5>4>3>1>0; KR1 verdicts `healthy` 0 / `upstream-holds-port` 3 / `helix-down` 4 (+ `secret-missing` 5, `doctor-check-failed` 1), foreign listener receives zero bearer requests (C1), output allowlisted (AC-05, KR1) | E2E harness `verify-ops` §E + KR1 session (bar #10) | **DONE** | f8e29f1 |
| REQ-P4-OPS-06 | T-P4OPS-06 | Slot derivation `R(N)=3111+3(N−1)`, `H(N)=6969+(N−1)` §4.2 slots 1–3 table exact, `--slot 0`/`abc` → exit 2, slot N≥2 ∩ {3111,3112,3113,6969}=∅, never 3151, derived via env/flags only, `[local.dev]` frozen (AC-06) | E2E harness `verify-ops` §F + `git diff` | **DONE** | f8e29f1 |
| REQ-P4-OPS-07 | T-P4OPS-07 | Data-dir precedence `--data-dir` > `AGENT_MEMORY_DATA_DIR` > `~/.local/share/agent-memory/<slot>/`, state `<parent>/state/slot-N.json` outside `HELIX_DATA_DIR`, remember→search survives `helix restart` + stop/start cycle, state contains no secret (AC-07, KR3* — A3 FAIL see note) | E2E harness `verify-ops` §G + live | **DONE* partial** — state-path precedence + state secret-free proven; HELIX_DATA_DIR forwarding not claimed (A3 FAIL) | f8e29f1 |
| REQ-P4-OPS-08 | T-P4OPS-08 | `doctor --migrate` dry-run default zero writes (counts+allowlisted paths only), `--migrate --apply --yes` fail-closed `MIGRATE ABORT: unsupported-runtime` (Probe A3 FAIL — `helix start` does not forward `HELIX_DATA_DIR` on CLI 3.3.0), audit line, MinIO volume never destroyed (AC-08, P4.4 not claimed — framing 3b pending orchestrator) | E2E harness `verify-ops` §H + session log | **DONE* partial** — abort path proven; no data moved per A3 | f8e29f1 |
| REQ-P4-OPS-09 | T-P4OPS-09 | Docs closure: README ops section (derivation table, data-dir default, backup+recovery, never-kill, Ley 172-13 PII-store declaration) + `TEST_MATRIX.md` KR1–KR3 rows (this section) linking evidence (AC-09) | doc diff | **DONE** | (this commit) |
| NFR-P4-OPS-A | T-P4OPS-10 | Never-kill-upstream: no kill-by-port/`fuser`/`prune`/`delete`/`docker rm|kill|volume rm`/`--persist` in source; foreign listeners on stand-in quartet survive all four subcommands unchanged PIDs (AC-A) | static grep + live `verify-ops` §I | **DONE** | f8e29f1, bd65360 |
| NFR-P4-OPS-B | T-P4OPS-11 | Secret non-printing: synthetic `AGENT_MEMORY_SECRET` value 0 occurrences in stdout+stderr of all four subcommands and in state file, output `bearer: armed` only (AC-B) | E2E harness `verify-ops` §J | **DONE** | bd65360 |
| NFR-P4-OPS-C | T-P4OPS-12 | Port-parity default untouched: bare `npm run dev` still `3111`, `HELIX_URL` `6969`, hook/plugin defaults unchanged; `status --slot 1` reports 3111/6969; `verify-env` PASS (AC-C) | E2E harness `verify-ops` §L + `verify-env` | **DONE** | bd65360 |
| NFR-P4-OPS-D | T-P4OPS-13 | Durability across restart: save → `helix restart <instance>` → search + save → stop/start cycle → search (AC-D, KR3*) | E2E harness `verify-ops` §G | **DONE* partial** — harness §G proves state-path durability; HELIX_DATA_DIR restart not claimed (A3) | bd65360 |
| NFR-P4-OPS-E | T-P4OPS-14 | Zero new deps + suites green: `package-lock.json` untouched, `npm run typecheck` 0, `verify`/`verify-env`/`verify-lifecycle`/`verify-capture`/`verify-skills` PASS, port guard 3111/3112/3113/3151/6969 never bound by harness (AC-E) | suite logs + `git diff` | **DONE** | bd65360, f8e29f1 |
| NFR-P4-OPS-F | T-P4OPS-15 | Ley 172-13 output hygiene: canary memory string 0 occurrences in `doctor`/`status`/`--migrate` outputs; migration report counts+allowlisted paths only (AC-F) | E2E harness `verify-ops` §K | **DONE** | bd65360 |

Per-command bar (live evidence, server :3151 + slot2 window 3114/6970, instance `slot2`, `dev` read-only):

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck` | exit 0 (0 errors) — bin `.mjs` outside TS program |
| 2 | `npx tsx scripts/verify-ops.ts` | **99 passed, 0 failed** / VERIFY PASS (C1 header proof: synthetic server 0 Authorization headers; §A–§L + never-kill + secret + canary + port-parity all green; live-slot checks DEFER where noted) |
| 3 | `npm run verify-env` | **21 passed, 0 failed** / VERIFY PASS |
| 4 | `npm run verify-lifecycle` | **123 passed, 0 failed** / VERIFY PASS (prior lane 117 + 6 goldens since v0.7.1) |
| 5 | `npm run verify-capture` | **137 passed, 0 failed** / ALL PASS |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** / VERIFY SKILLS PASS |
| 7 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 AGENT_MEMORY_SECRET=test-secret-p4-ops-fixed npm run verify` | **243 passed, 0 failed** / VERIFY PASS (server on 3151, never 3111; Helix dev 6969; T-RL-001 + T-F-01 green) |
| 8 | `git diff --stat src/ db/ hooks/ plugins/` | empty (0 files) |
| 9 | `git diff package-lock.json` | empty (0 lines) |
| 10 | Live slot-2 window `AGENT_MEMORY_SECRET=test-secret-p4-ops-fixed bin/agent-memory start --slot 2` → `doctor healthy` → `remember`→`search` 3114 → `stop --slot 2` → idempotent | **DONE**: `start` exit 0 (helix registered `slot2:6970` + `storage="disk"` patch + ready 200/200); `doctor --slot 2` → `PASS C1` 200, `PASS C3` owned 3114, `PASS C2` 200/200, `PASS C4` present, `PASS C5` disk → `VERDICT: healthy` exit 0; `POST /memory/remember` → `{"id":"0b0a4b43-…","deduped":false}`; `POST /memory/search` → 1 result `bm25` score 0.86 `signals:[]`; bootstrap 6970 `OK (8 indexes ensured)` before remember; `stop --slot 2` exit 0 + second `stop` exit 0 idempotent; `helix status` dev unchanged (6969 up), `git diff --stat src/ db/` empty, `helix.toml` only `[local.slot2]` additive (sanctioned) |

*Notes:* P4.4 `HELIX_DATA_DIR` forwarding / MinIO migration (REQ-07/08/NFR-D partial) — Probe A3 FAIL (see IMPLEMENTATION_PLAN §Step 0 + PROPOSED_CHANGES Appendix): `helix start` 3.3.0 does not forward `HELIX_DATA_DIR`; `--migrate` fails closed `unsupported-runtime`; framing 3b (data-dir for new instances only) escalated to orchestrator, not claimed in this lane. All other REQs implemented.

---

## Brainy v1 (SPEC-001..005)

**Agent:** general(vasquez) — Engineering Owner (R1, execute-spec Step 11 verification pass)
**Date:** 2026-09-25
**Packet:** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md#NFR-BRAINY-ENG-01..04 + AC-NFR01..04, SPEC-003 #REQ-BRAINY-OPS-06, SPEC-005 #CDR-07 / HARD:subagents+max2lanes+no-secrets+alias1version+never-kill-3111 / GATE:evidence-pass / DOMAINS:R1,R8,R5,R2,R4`
**Scope of this lane:** evidence ONLY — no gate verdicts, no implementation changes. FAILs are recorded honestly; nothing is papered over.
**Live window (this lane only):** Helix instance `slot9` (:6977, `helix start slot9`, container `helix-brainy-slot9`) + REST `HELIX_URL=http://localhost:6977 BRAINY_PORT=38911 npx tsx src/server.ts` (PID 210521). Shared `dev` :6969 and ports 3111/3112/3113 never touched, never signaled. `helix.toml` section reorder is a `helix start` side effect, left dirty for the owning lane.
**Prior sections of this file are preserved untouched** (lane-singleton rule); full history in `git log -p -- TEST_MATRIX.md`.

### Verification bar (this lane, 2026-09-25)

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck` | exit 0, 0 errors |
| 2 | `npm test` | **80 passed, 0 failed** (incl. `ttl.test.ts` CDR-02 canaries) |
| 3 | `npx tsx scripts/verify-ops.ts` | **124 passed, 0 failed** / VERIFY PASS (§A–§L + C1 header proof: foreign listener 0 Authorization headers) |
| 4 | `npx tsx scripts/verify-lifecycle.ts` | **123 passed, 0 failed** / VERIFY PASS |
| 5 | `npm run bootstrap` (shared dev :6969) | **FAIL (evidence)** — `index_definition_conflict vector_dimension` (pre-existing 384-dim indexes on shared dev); attempt 1 of 2, recorded, dev left untouched |
| 6 | `helix start slot9` + `BRAINY_URL=http://localhost:6977 npm run bootstrap` | exit 0 — `bootstrapIndexes: OK (25 indexes ensured)` + `READY — Brainy indexes verified (searchByText responding on attempt 5, 8.1s)` |
| 7 | `AGENT_MEMORY_URL=http://127.0.0.1:38911 npm run verify` | **238 passed, 5 failed / VERIFY FAIL** — all 5 are legacy 384-dim expectations in `scripts/verify.ts` (off-limits to this lane): `embed: length is 384 — got 1536`, `embed: empty input zero vector of length 384`, embed golden snapshot drift, 2 RRF-score goldens pinned to 384-dim rankings. 243 total = historical 243 bar. Retried (2 runs, same deterministic 5). Cross-domain request filed, no freelance edit. |
| 8 | `AGENT_MEMORY_URL=http://127.0.0.1:38911 npx tsx scripts/eval.ts` | **EVAL PASS** — R@5/MRR/nDCG 1.0000 both modes (40 docs / 15 queries); scorecard rewritten by harness, refreshed by this lane |
| 9 | Latency probe (50× `POST /memory/search`, `/tmp/opencode/latprobe.mjs`) | min 3.92ms, p50 5.23ms, **p95 8.68ms**, max 70.79ms (single outlier) at N=40 rows — **NFR-01 NOT proven at ~10k scale** (no scale harness; see NFR row) |
| 10 | CDR-07 live canaries (slot9/:38911, projects `cdr07-probe`/`tmp`) | TTL both-knobs/canonical-silent/alias-WARN/OFF all proven (unit `filterExpired` + `ttl.test.ts`); hook `UserPromptSubmit` stores exactly `user prompt submitted` (no prompt text); export fixture frontmatter `project`+`tags` only; ARCO access→move→distill→forget proven for Memory rows; sentinel `s3cr3t-cdr07-sentinel-9f2k` 0 hits in server stdout/stderr (details in CDR-07 table) |
| 11 | Secret hygiene | `gitleaks`: **not-installed** (never claimed). Grep fallback: `ghp_/sk-live|test-/AKIA` → 0 hits repo-wide (excl. node_modules/.helix/.git); `BRAINY_SECRET=`/`AGENT_MEMORY_SECRET=` assignments → only `s3cr3t` test-value docs in SPEC-004:56 / SPEC-005:86 (documented test values, not credentials) + scanner self-descriptions |

### REQ → test/evidence → artifact → commit (45 rows)

| REQ-ID | Evidence ID | Test / evidence | Artifact | Commit |
|--------|-------------|-----------------|----------|--------|
| REQ-BRAINY-ENG-01 | T-ENG-01 | `tests/step1.test.ts` package/bin/env rename + dual-bin; live: shim `WARN deprecated` observed on `export` via alias (`WARN deprecated use BRAINY_URL — AGENT_MEMORY_URL alias will be removed in next major`) | `package.json:2,14-17`, `helix.toml:2`, `bin/brainy.mjs`, `bin/agent-memory.mjs` | `53f5588` |
| REQ-BRAINY-ENG-02 | T-ENG-02 | `tests/step1.test.ts`; brand-debt grep (R5 lane owns the sweep; this lane did not re-run the full `agentmemory\|iii-engine` grep — **gap noted**) | `docs/CONTRACT.md`, `ARCHITECTURE.md` v3 | `53f5588`, `c02a0e0` |
| REQ-BRAINY-ENG-03 | T-ENG-03 | `tests/step2.test.ts` LABELS/EDGES; live bootstrap `25 indexes ensured` + note CRUD live (`POST /v1/notes` 201, `BELONGS_TO` auto `resource/inbox`) | `db/queries.ts` | `befa3c7` |
| REQ-BRAINY-ENG-04 | T-ENG-04 | `tests/step2.test.ts` (indexes 1536) + `tests/step3.test.ts` (EMBED_DIM=1536, L2 norm, determinism) + `tests/step9.test.ts` (migration); **contradicted in part** by legacy `verify.ts` 384-dim goldens (5 FAIL, bar #7) — unit evidence stands, harness drift filed | `db/queries.ts`, `src/embed.ts`, `scripts/migrate-embeddings.ts` | `befa3c7`, `74ec6eb`, `18a5ea4` |
| REQ-BRAINY-ENG-05 | T-ENG-05 | `tests/step4.test.ts`; live `POST /v1/notes {title,content,project:cdr07-probe}` → 201 `{deduped:false, paraCategory:resource}` | `src/store.ts:HelixStore.saveNote`, `src/server.ts:390`, `src/mcp.ts:brainy_capture` | `5b40c8e` |
| REQ-BRAINY-ENG-06 | T-ENG-06 | `tests/step4.test.ts` + `tests/move.test.ts`; live `POST /v1/notes/:id/move {to:area,name:inbox,project}` → 200; cross-tenant move → 400 `invalid_tenant_link` (C8 live); ADR-0003 | `src/store.ts`, `db/queries.ts:moveNote`, `src/server.ts:427` | `5b40c8e`, `a1d71c9`, `201b1ee` |
| REQ-BRAINY-ENG-07 | T-ENG-07 | `tests/step4.test.ts`; live `POST /v1/notes/:id/distill` → new Note `Distilled: …` (append-only, new id) | `src/server.ts:410`, `db/queries.ts:distillNote` | `5b40c8e` |
| REQ-BRAINY-ENG-08 | T-ENG-08 | Live `brainy export --format markdown` → 1 note, fixture `--- project: cdr07-probe / tags: [] ---` + content only (allowlist `project/tags/[[links]]`, no secret/PII beyond the row itself) | `src/server.ts:GET /v1/context/:project`, `bin/brainy.mjs:375` | `a1e2e89` |
| REQ-BRAINY-ENG-09 | T-ENG-09 | `tests/step5.test.ts`; live eval hybrid 1.0000 R@5/MRR/nDCG; `signals:[]` observed on all live searches (no 500) | `src/search.ts:hybridSearch`, `db/queries.ts:searchByVector/Text/graphSearch` | `7a7691f` |
| REQ-BRAINY-ENG-10 | T-ENG-10 | `tests/step7.test.ts` (`McpServer name=brainy`, 4 native + 11 `memory_*` aliases, `_meta.authorization` gate); live count `brainy_*` registrations = 5 incl. `brainy_reality_check` (grep `src/mcp.ts:719`) | `src/mcp.ts:162-535,719` | `fb9c274` |
| REQ-BRAINY-ENG-11 | T-ENG-11 | `tests/step9.test.ts` (compat mapping + import-transcript round-trip); live `POST /v1/memory` legacy row + `POST /memory/forget` erase proven in ARCO flow | `src/compat/agentmemory.ts`, `scripts/import-transcript.ts` | `18a5ea4` |
| REQ-BRAINY-ENG-12 | T-ENG-12 | `tests/step6.test.ts`; live route table exercised: `POST /v1/notes`, `GET /v1/notes/:id?project=`, `POST /v1/notes/:id/move`, `POST /v1/notes/:id/distill`, `POST /v1/memory`, legacy `/memory/*` + `X-Deprecated` alias | `src/server.ts` | `af40e87` |
| REQ-BRAINY-MKT-01 | T-MKT-01 | Doc diff: `package.json:2 name=brainy`, `helix.toml:2 project=brainy`, dual-bin (no automated test — doc evidence) | `package.json`, `helix.toml`, `bin/*` | `53f5588`, `c02a0e0` |
| REQ-BRAINY-MKT-02 | T-MKT-02 | R5 sign-off matrix (commit `d41ded1`); full purge grep owned by concurrent R5 lane — **not independently re-verified by this lane (gap noted)** | `README.md`, docs sweep | `c02a0e0`, `d41ded1` |
| REQ-BRAINY-MKT-03 | T-MKT-03 | Doc diff: hero/tagline + `package.json description` + `plugin.json` (doc evidence) | `README.md`, `package.json`, `plugin.json` | `c02a0e0` |
| REQ-BRAINY-MKT-04 | T-MKT-04 | Doc diff: README quickstart + 3 examples + migration (doc evidence; examples not re-executed live by this lane — **gap noted**) | `README.md` | `c02a0e0` |
| REQ-BRAINY-MKT-05 | T-MKT-05 | Doc diff: `CHANGELOG.md ## [v1.0.0] / [brainy v1]` breaking entry (doc evidence) | `CHANGELOG.md` | `c02a0e0` |
| REQ-BRAINY-MKT-06 | T-MKT-06 | Doc diff: `docs/CONTRACT.md` header `Brainy — v1 Frozen Contract` (doc evidence) | `docs/CONTRACT.md` | `a79643c`, `c02a0e0` |
| REQ-BRAINY-MKT-07 | T-MKT-07 | Bar #11 secret/placeholder scan (0 real findings); R5 sign-off `d41ded1` | `README.md`, `CHANGELOG.md`, docs | `c02a0e0`, `d41ded1` |
| REQ-BRAINY-OPS-01 | T-OPS-01 | `tests/step8.test.ts` + `verify-ops` §A/§F (bin rename, slot math, quartet, NEVER_BIND); live export ran via `bin/brainy.mjs` | `bin/brainy.mjs`, `bin/agent-memory.mjs` | `a1e2e89`, `339c511` |
| REQ-BRAINY-OPS-02 | T-OPS-02 | `tests/step8.test.ts`; **live finding:** `src/store.ts:848` reads `HELIX_URL` only (no `BRAINY_URL` canonical-first) — server had to be started with `HELIX_URL=:6977` (`BRAINY_URL` alone → `invalid_vector_dimension` via dev :6969). Cross-domain request to R1 (SPEC-003 REQ-OPS-02 vs implementation). Bootstrap/import scripts do resolve `BRAINY_URL` first. | `bin/brainy.mjs`, `src/store.ts:848`, `scripts/bootstrap.ts:25` | `a1e2e89` |
| REQ-BRAINY-OPS-03 | T-OPS-03 | `verify-ops` §G (state path/0700/0600/closed schema, verified in bar #3) | `bin/brainy.mjs` | `a1e2e89`, `339c511` |
| REQ-BRAINY-OPS-04 | T-OPS-04 | `verify-ops` §B/§C/§D + move repoint commits; live: preflight never-kill not re-proven live by this lane (covered by harness §I) | `bin/brainy.mjs` | `a1e2e89`, `201b1ee` |
| REQ-BRAINY-OPS-05 | T-OPS-05 | `verify-ops` §E (C1→C3→C2→C4→C5 order, precedence 5>4>3>1>0, one VERDICT, C1 zero-auth proof — bar #3) | `bin/brainy.mjs` | `a1e2e89`, `339c511` |
| REQ-BRAINY-OPS-06 | T-OPS-06 | `verify-ops` §H (fail-closed `MIGRATE ABORT: unsupported-runtime`); data-dir precedence; CI gates (typecheck+suites green per bar #1–4) | `bin/brainy.mjs` | `a1e2e89`, `339c511` |
| REQ-BRAINY-SEC-01 | T-SEC-01 | `tests/step6.test.ts` + `verify-ops` C1 proof; live server ran open-auth on loopback (documented dev posture, `auth: open` in boot log); **live 401 matrix with `BRAINY_SECRET` set NOT run (no `verify-auth-matrix.ts` harness exists — gap noted)** | `src/server.ts:284-290`, `src/auth.ts:33-41` | `af40e87` |
| REQ-BRAINY-SEC-02 | T-SEC-02 | `tests/step7.test.ts` (`isMetaAuthorized` gate, unauthorized `tools/call`); live MCP handshake not exercised (stdio) — **gap noted** | `src/mcp.ts:162-183`, `src/auth.ts:48-55` | `fb9c274` |
| REQ-BRAINY-SEC-03 | T-SEC-03 | Bar #11 (0 findings) + live sentinel 0 hits in server stdout/stderr (CDR-07 table) | `src/server.ts:463-465,605-607`, `src/errors.ts:62-73` | `af40e87`, `fb9c274` |
| REQ-BRAINY-SEC-04 | T-SEC-04 | `SECURITY_REVIEW.md §4.1` STRIDE table + `4626695` R2 verdict + `2a6bf20` co-review (review artifacts, not re-judged by this lane) | `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` | `4626695`, `2a6bf20` |
| REQ-BRAINY-SEC-05 | T-SEC-05 | Hook proof (`hooks/capture.mjs:72` fixed string; live row content exactly `user prompt submitted`) + export allowlist + TTL store declaration (`a79643c`) — CDR-07 table | `hooks/capture.mjs`, `src/errors.ts`, `docs/CONTRACT.md` | `a79643c` |
| REQ-BRAINY-SEC-06 | T-SEC-06 | `tests/step6.test.ts` (zod bounds) + live: oversize/cross-tenant 400s observed (`invalid_tenant_link` live; 1MiB/413 not probed live — **gap noted**); `signals:[]` no-500 observed | `src/server.ts` schemas, `src/search.ts` signals | `af40e87`, `7a7691f` |
| REQ-BRAINY-LEG-01 | T-LEG-01 | `a79643c` CONTRACT PII-store declaration (`Note.content` purpose+TTL+deletion, ARCO SLA) — doc evidence | `docs/CONTRACT.md` | `a79643c` |
| REQ-BRAINY-LEG-02 | T-LEG-02 | Minimization checkpoints: hook fixed-strings + export allowlist + evidence allowlist (this file carries counts/ids only) — live hook/export proof in CDR-07 table | `hooks/capture.mjs`, `bin/brainy.mjs:export` | `a79643c`, `cf91d47` |
| REQ-BRAINY-LEG-03 | T-LEG-03 | `tests/ttl.test.ts` (80/80 bar) + live `filterExpired` canary: both-knobs canonical-wins silent / alias-only exactly one WARN / canonical-only silent / invalid+zero+absent OFF (kept 2/2); `5ee1728` canonical-first read | `src/lifecycle.ts:57-69,144`, `bin/brainy.mjs:1061` | `5ee1728` |
| REQ-BRAINY-LEG-04 | T-LEG-04 | Live ARCO flow on :38911: access `GET /v1/notes/:id?project=` 200 → rectify `POST .../move` 200 + `POST .../distill` new-id → erase `POST /memory/forget` `{forgotten:true}` (Memory rows). **Gap:** `store.forgetNote` has NO REST/MCP caller (`grep forgetNote src/server.ts src/mcp.ts` → 0) — Note-row erasure is code-only, unexposed. CDR-04 ack `2232087` covers the spec drift. | `src/store.ts:1950`, `src/server.ts:689` | `2232087`, `a1d71c9` |
| REQ-BRAINY-LEG-05 | T-LEG-05 | `2a6bf20` R2 co-review cross-border table (review artifact — doc evidence, not live-probed) | `docs/specs/40_workspace/*` | `2a6bf20` |
| REQ-BRAINY-LEG-06 | T-LEG-06 | `cf91d47` DPIA baseline (review artifact — doc evidence) | `docs/specs/40_workspace/legal/*` | `cf91d47` |
| REQ-BRAINY-LEG-07 | T-LEG-07 | Privacy-by-design: allowlist logs/exports + `filterExpired` fail-keep + tenant scoping live (`?project=` miss → 404, cross-tenant → 400) | `src/server.ts`, `src/lifecycle.ts` | `af40e87`, `5ee1728` |
| REQ-BRAINY-LEG-08 | T-LEG-08 | Breach-notification path declared in `2a6bf20`/`cf91d47` (doc evidence; no live breach drill — **gap noted**) | review artifacts | `2a6bf20`, `cf91d47` |
| REQ-BRAINY-LEG-09 | T-LEG-09 | Bar #11 + live sentinel grep (0 hits); evidence in this file allowlisted (ids/counts only, `sha256` dedupKey redacted to prefix-free form — no raw content) | repo-wide | (this commit) |
| NFR-BRAINY-ENG-01 | T-NFR-01 | p95 **8.68ms at N=40** (probe, SCORECARD) — **NOT proven at ~10k nodes**: `scripts/eval.ts` has no scale knob/latency column. Gate FAIL-or-waiver belongs to quality-gate; this lane claims no waiver. | `docs/benchmarks/SCORECARD.md` | (this commit) |
| NFR-BRAINY-ENG-02 | T-NFR-02 | `helix.toml [local.*] storage="disk"` + live `READY` poll (8.1s, attempt 5) + save→search→forget round-trips on slot9 | `helix.toml`, `scripts/bootstrap.ts` | `53f5588`, `18a5ea4` |
| NFR-BRAINY-ENG-03 | T-NFR-03 | `tests/step3.test.ts` + `tests/step9.test.ts` + `scripts/migrate-embeddings.ts`; legacy 384 goldens in `verify.ts` contradict (bar #7, filed) | `src/embed.ts`, `scripts/migrate-embeddings.ts` | `74ec6eb`, `18a5ea4` |
| NFR-BRAINY-ENG-04 | T-NFR-04 | = T-SEC-03 + T-LEG-01..03 + bar #11 (no secrets; PII declared w/ TTL+erasure) | (see SEC/LEG rows) | `a79643c`, `5ee1728` |
| NFR-BRAINY-OPS-01 | T-NFR-OPS-01 | `verify-ops` §I never-kill + §J secret + §L port-parity (bar #3, 124/124) + AC-NFR01 grep hints in SPEC-003 | `bin/brainy.mjs:452-469`, `src/server.ts:653-661` | `a1e2e89`, `339c511` |

### Coverage summary

- 45/45 REQ+NFR rows mapped to a test/evidence id + artifact + real commit hash.
- Honest gaps (no test/evidence, or evidence short of the gate): (1) `verify.ts` 5 FAILs — legacy 384-dim goldens vs 1536-dim implementation (harness drift, cross-domain request to owning lane; `scripts/*.ts` off-limits here). (2) NFR-01 `@10k nodes` — not-run, no scale harness exists. (3) Note-row erasure surface — `forgetNote` unexposed via REST/MCP. (4) Live 401 matrix with `BRAINY_SECRET` set — no harness, not run. (5) Live MCP stdio handshake — not exercised. (6) 1MiB/413 + 15s-timeout live probes — not run. (7) README 3 examples — not re-executed live. (8) Brand-debt full-repo grep — owned by concurrent R5 lane, not re-run here. (9) Breach drill — doc only. (10) `src/store.ts:848` reads `HELIX_URL` only (no `BRAINY_URL` canonical-first) — SPEC-003 REQ-OPS-02 deviation, cross-domain request to R1.

### Security C1..C8 audit proof table (mapping: IMPLEMENTATION_PLAN.md §Security Conditions)

| Cond | Control location | Proving test / grep | Result |
|------|------------------|---------------------|--------|
| C1 Bearer parity + alias | `src/server.ts:284-290`, `src/auth.ts:33-41`, `src/mcp.ts:162-183` | `tests/step6.test.ts` + `tests/step7.test.ts` (80/80 bar); `verify-ops` C1 foreign-listener 0-Auth proof (124 bar) | **pass** (unit+harness; live 401 matrix not-run — gap 4) |
| C2 No secrets + placeholders | repo-wide | `gitleaks` not-installed (stated, not claimed); fallback `ghp_/sk-/AKIA` 0 hits + `BRAINY_SECRET=` only `s3cr3t` test-value docs; live sentinel 0 hits in server out/err | **pass** (fallback only — no gitleaks) |
| C3 Doctor probe isolation C1→C3→C2 | `bin/brainy.mjs`, `scripts/verify-ops.ts` §E | verify-ops C1 header proof: synthetic server 0 Authorization headers; order + precedence asserts (124 bar) | **pass** |
| C4 Strict validation + DoS caps | `src/server.ts` zod schemas, 1MiB cap | `tests/step6.test.ts`; live cross-tenant 400 `invalid_tenant_link`; 413/timeout live probes not-run | **pass*** (partial: 413/timeout not probed live) |
| C5 Ley 172-13 minimization + store | `src/store.ts`, `hooks/capture.mjs:72`, export, `docs/CONTRACT.md` | hook live row = `user prompt submitted` exactly; export fixture allowlist; `tests/ttl.test.ts`; `a79643c` declaration | **pass** |
| C6 Never-kill + safe signaling | `bin/brainy.mjs:452-469 signalOwned/verifyOwnedPid`, `src/server.ts:653-661` | verify-ops §I foreign listeners survive (124 bar); this lane signaled ONLY its own PID 209471/210521, never 3111/3112/3113; `helix stop slot9` by instance name at teardown | **pass** |
| C7 State/audit 0700/0600 | `bin/brainy.mjs` | verify-ops §G (124 bar) | **pass** (harness; not re-probed live by this lane) |
| C8 Param binding + tenant isolation | `db/queries.ts` (defineParams, no concat), `src/server.ts:427-456` move guard, `src/store.ts` | `tests/step2/step6.test.ts`; live: unscoped `GET /v1/notes/:id` → 404, cross-tenant move → 400 `invalid_tenant_link` | **pass** |

### CDR-07 live evidence (R4/R2 gate-blocking item)

| Item | Procedure (slot9/:38911) | Result |
|------|--------------------------|--------|
| TTL both-knobs | `filterExpired` live import: canonical100+alias200 → canonical wins silent; alias200 → exactly one `WARN deprecated use BRAINY_TTL_DAYS`; canonical100 → silent; abc/0/absent → OFF (kept 2/2) | **pass** |
| Hook payload | stdin with PII prompt text → exit 0, zero stdout/stderr; stored row content exactly `user prompt submitted` (project `tmp`, searched live); `hooks/capture.mjs:72` never reads `hook.prompt` | **pass** |
| Export allowlist | `brainy export --format markdown` → fixture `--- project/tags ---` + content; no secret, no extra fields (`[[links]]` absent = no links on canary, nothing else emitted) | **pass** |
| ARCO flow | access `GET /v1/notes/:id?project=` 200 → rectify `move` 200 + `distill` new-id → erase `POST /memory/forget` `{forgotten:true}` (Memory rows; hook + secret canaries forgotten too) | **pass*** (Memory rows; Note-row erase unexposed — gap 3) |
| Live secret grep | sentinel `s3cr3t-cdr07-sentinel-9f2k` sent in bearer header + remember content → `grep -c` over full server stdout/stderr = **0 hits** | **pass** |

### Incidents / deviations observed by this lane (for orchestrator)

1. `helix start slot9` reordered `helix.toml` sections (tool side effect) — file left dirty, owned by another lane; this commit stages ONLY the two approved files.
2. First hook probe ran without `AGENT_MEMORY_URL` set → POSTed one fixed-string observation (`user prompt submitted`, no PII) to the default `:3111` upstream. No prompt text, no secret, no content left the lane — but it was a write to a protected port's server. Reported, not repeated (second probe targeted :38911).
3. `npm run verify`'s harness resolves the server via `AGENT_MEMORY_URL`, not `BRAINY_URL` — same alias-direction observation as T-OPS-02.
4. Canary Note rows (`cdr07-probe` project + distilled copy) remain in slot9's disk volume — no Note-delete surface exists to remove them (gap 3); content is synthetic, no PII.

