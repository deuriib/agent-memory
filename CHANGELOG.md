# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [v0.9.0] — 2026-09-25

### Added

- **Todos — follow-ups para agentes (SPEC-020-todos, bounded-initiative, zero new deps).** Helix `Todo` node `{todoId,title 1..500, description 0..5000, priority low|medium|high (default medium), status pending|active|done|blocked (default pending), project, sessionId, createdAt, updatedAt, parentId?}` with **12 indexes total** (8 existing memory/session/concept + 4 Todo: `todo_id nodeUniqueEquality(Todo, todoId)`, `todo_project nodeEquality(Todo, project)`, `todo_status nodeEquality(Todo, status)`, `todo_title nodeText(Todo, title, project)` tenant `project` via `db/queries.ts:32-34,127-193` + `todoRowProjection` + 6 builders `saveTodo/listTodos/getTodoById/updateTodo/searchTodosByText/deleteTodo` `db/queries.ts:720-862`, `src/store.ts:289-351,1313-1472`). `scripts/bootstrap.ts` 8→12.
- **REST CRUD + frontier + alias (`src/server.ts:136-177,268-283,470-560`).** `POST /memory/todos 201 {todo}`, `GET /memory/todos 200 {todos:[…]}`, `GET /memory/todos/:id 200/404`, `PATCH /memory/todos/:id 200/404/400`, `DELETE /memory/todos/:id 200/404`, `GET /memory/frontier 200 {frontier,count}` (+ alias pair `POST /agentmemory/todos` and `GET /agentmemory/frontier` rewritten by `isAgentMemoryAlias` **before** bearer guard `src/server.ts:278-286` — compat screenshot `POST http://localhost:3111/agentmemory/todos` — scoped to `todos|frontier` only, remainder 404). Bearer guard identical to other `/memory/*` (only `livez` exempt, 401 + `www-authenticate: Bearer`), defaults `project="default" limit=10 sessionId=""`, strict zod 400 on unknown field/empty title/bad enum, 415/413/400 body bounds `1_048_576`.
- **Search & priority ordering (`src/store.ts:1366-1412`).** `GET /memory/todos?search=<q>` → BM25 `searchTodosByText(q,project,k=limit)` (`todo_title` tenant `project` `db/queries.ts:834-851`) → `filterTodos(hits,input)` else fallback substring `title/description` case-insensitive over `rawListTodos(project,200)`; branch without `search` → `rawListTodos(project,max(limit*4,100))` → `filterTodos` → `slice(limit)`. `filterTodos` applies `status,priority,parentId` exact then `frontier (pending|active)` then **sort** `priorityRank(high3>med2>low1) desc → updatedAt localeCompare desc → todoId asc`. Same sort for `/memory/frontier` (`listTodos({frontier:true})`). `limit` 1..100 via zod coerce; over-fetch 4× bounded ≤400.
- **parentId optional hierarchy with 400 fail-closed/clear (`src/store.ts:1323-1445` + `src/server.ts:488-489,543-544`).** `POST {parentId:<exists>}` links + `GET ?parentId=<id>` exact `t.parentId ?? "" === input.parentId` filter; `PATCH {parentId:null}` clears (`""` stored → read `undefined` `src/store.ts:484`); `parentId=self` → 400 `todo cannot be its own parent` `src/store.ts:1438`; unknown parent → 400 `parent todo not found: <id>` (create+update fail-closed via `getTodo(parentId)` lookup); trim 0..200 + `parentIdSchema 1..200` bounds; `defineParams` param binding prevents Helix injection.
- **MCP 6 tools (`src/mcp.ts:113-147,411-536`).** `memory_todo_create` (title 1..500 req), `memory_todo_list` (filters project/limit 1..100/status/priority/search 0..500/frontier bool/parentId), `memory_todo_get` (todoId), `memory_todo_update` (todoId+patch `parentId string|null` ≥1 field), `memory_todo_delete` (todoId), `memory_frontier` (project,limit) — all via shared `handle(name,_meta,op)` bearer `_meta.authorization="Bearer <secret>"` (`isMetaAuthorized` constant-time) → unauth `McpError InvalidRequest` isError + `logSafeNote`; `readOnlyHint/destructiveHint` set; `todos` everywhere never `actions`; stdout MCP only.
- **Plugin 6 tools (`plugins/opencode/plugins/agent-memory.ts:108-111,924-1097`).** Namespace `memory` codemode `memory/todo_create|list|get|update|delete|frontier` (total `memory/*` = 11 = 5 prev + 6 todos) mirroring MCP bounds (`MAX_TODO_TITLE 500`, `MAX_TODO_DESC 5000`, `MAX_TODO_ID 200`) and `parentId string|null` null-clears; `todo_create` defaults `project=cfg.project, sessionId=toolContext.sessionID`; `todo_list/frontier` build `URLSearchParams` with all filters; `todo_update` requires ≥1 field; `call()` bearer `Authorization` if `cfg.secret`; `recallCache.clear()` on create/update/delete; version `agent-memory 0.9.0`.
- **Hooks auto-extract (`hooks/capture.mjs:209-286`).** `extractTodos(event,hook)` gated `Stop|SessionEnd|PreCompact|PostToolUse`; `collectBody` candidates `transcript,session_body,body,content,prompt.text,tool_output,result` or array join or JSON fallback; `body.length<400→0`; lines 12..200 chars; heuristic `^(TODO|FIXME|HACK|decision|revisit|inspect|blocked on|follow-?up)\b` → medium else `should|need to|must|blocked|revisit` long→low; cap 5→dedup icase→return; `main()` fire-and-forget `slice(0,3)` `POST /memory/todos` `AbortSignal.timeout(1500)` each `.catch(()=>undefined)` bounded 1.5s×3, bearer if `AGENT_MEMORY_SECRET`, always exit 0, never logs prompt text nor secret; `verify-capture` private.
- **Version 0.8.0 → 0.9.0 across 6 carriers:** `package.json`, `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`, README badge (engineering, release)

### Notes

- **Gate OPEN 5 reviews for SPEC-020-todos (2026-09-25):** `ARCHITECTURE_REVIEW.md` Approved no ADR (§6) + `SECURITY_REVIEW.md` Approved STRIDE 0 High/3 Low (S-020-001..003) + `quality-assurance.md` PASS (typecheck 0, verify 243, verify-lifecycle 123, verify-capture 137, bootstrap 12, todos E2E 8 flows on 3151) + `security-reviewer.md` PASS + `automation-reviewer.md` PASS (hook 3×1.5s, bootstrap 12, pipeline not weakened). Six Low residuals accepted with owner+trigger (cross-project parentId, overfetch ≤400, heuristic precision, alias scoped) — non-blocking; no silent PASS.
- **Zero new deps, never-kill intact, BRIEF frozen:** `package.json` deps unchanged (`@helix-db/helix-db 3.0.4` only), `helix.toml` additive via `bootstrapIndexes` only, `src/server.ts:641-661` `REROUTE_PORT=3151` never signals `3111/3112/3113`, BRIEF-todos bounded-initiative YAGNI cuts (`requires/unlocks` deferred to P4.3).
- **Out-of-scope carries (not at gate):** graph edges `PARENT_OF`, dedicated `parentId`/`todo_description` indexes, leases/signals, viewer UI — per SPEC §5.

## [v0.8.0] — 2026-09-24

### Added

- **P4 ops control-plane CLI — `bin/agent-memory.mjs` (SPEC-P4-OPS, Node ≥20 ESM, `node:` builtins only, zero new deps).** Subcommands `start|stop|status|doctor` + `--help` registered as `"bin":{"agent-memory":"./bin/agent-memory.mjs"}` and `"verify-ops":"tsx scripts/verify-ops.ts"` in `package.json` (only 2 rows, `package-lock.json` empty diff). `start --slot N` spawns Helix instance (`helix add local --name slotN --port H(N)` once for N≥2, never `--persist`) + `npx tsx src/server.ts` with derived env `R(N)=3111+3(N-1) H(N)=6969+(N-1)`, pre-flight quartet refuse + `NEVER kill 3111/3112/3113` hint exit 1 no signal, idempotent already-running exit 0, 30 s readiness `Helix /healthz` + `/memory/livez`, state `0700/0600` sibling `state/slot-N.json` (never inside `HELIX_DATA_DIR`). `stop --slot N` SIGTERM→SIGKILL tracked PIDs only with `verifyOwnedPid` re-verify before EACH signal (C10) then `helix stop <instance>` + remove state, idempotent. `status` read-only quartet/REST/Helix/data-dir + `bearer: armed|unset` presence-only never `Authorization`. `doctor` C1→C3→C2→C4→C5 one `PASS|FAIL|INFO <check-id>` each + single `VERDICT:` with precedence `5>4>3>1>0` (exits 0/1/2/3/4/5), C3 ownership gates C2 bearer (foreign listener 0 requests, `verify-ops` header proof on 3135). Data-dir precedence `--data-dir` > `AGENT_MEMORY_DATA_DIR` > `~/.local/share/agent-memory/<slot>/`; `helix.toml` `[local.dev]` frozen `port 6969 storage="disk" tag v0.0.6`, `[local.slot2]` additive only. Security C1..C10 landed as code + `verify-ops` §§J/K/I, Ley 172-13 output allowlist (`oneLine`+`~`+counts/ports/PIDs only, no memory content/secret/PII), state 0600 secret-free. Evidence `TEST_MATRIX.md` P4 OPS section `T-P4OPS-01..15` (12 DONE + 3 DONE* partial by A3).
- **Harness `scripts/verify-ops.ts` (§A–§L, 99/0 VERIFY PASS).** Sections `check()` counters `finally` reap, header proof synthetic server on 3135 receives 0 Authorization, secret/canary/port-parity/never-kill proofs, `DEFER` for live-slot where noted; live slot-2 window 3114/3115/3116/6970 `slot2` healthy→remember→search→stop idempotent (see `TEST_MATRIX.md:119-132` bar #1-10).
- **Docs — `README.md:601-784` Operations — P4 control plane** (slot derivation table `R(N)/H(N)`, CLI usage + exit codes 0/1/2/3/4/5, data-dir/state layout `0700/0600` sibling, backup/recovery, Ley 172-13 PII-store declaration `README.md:715-727`, never-kill hint) + `TEST_MATRIX.md:97-134` 15-row P4 OPS section + per-command bar `#1-10` + live slot-2 window.
- **Version 0.7.1 → 0.8.0 across 6 carriers:** `package.json`, `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`, README badge (engineering, release)

### Fixed

- **Slot Helix `storage="disk"` patch for C5 (doctor).** `bin/agent-memory.mjs` now patches `[local.slotN]` `storage="disk"` on registration so `doctor C5` never mis-reports `memory` for a freshly `helix add local` slot while `helix.toml` is still disk-default. Evidence `TEST_MATRIX.md:132` `storage="disk"` before remember (commit `8d6ae81`) (engineering)

### Notes

- **A3 FAIL — HELIX_DATA_DIR not forwarded on Helix CLI 3.3.0 → framing 3b pending orchestrator (Residual #1).** Probe `IMPLEMENTATION_PLAN.md:24-44` Step 0: binary 0 hits `HELIX_DATA_DIR`, `helix start --help` no `--data-dir`, `docker inspect` no env passthrough; `helix add local` skill documents `HELIX_DATA_DIR` as direct-Docker mode only. Consequently `HELIX_DATA_DIR` is never set, `--data-dir` controls only state path, `doctor --migrate` is fail-closed `MIGRATE ABORT: unsupported-runtime` zero writes (MinIO `helix-agent-memory-dev-minio-data` retained). KR3 not claimed; **P4.4 not claimed** in this lane — reversible per brief §7, not a defect. Expiry **2026-12-31** or framing-3b decision. See `docs/specs/50_archive/P4-OPS/GATE_REPORT.md:60-72` + `HANDOFF.md:116-129`.
- **Out-of-scope carries (not at gate):** P4.2 `docker-compose.yml`/k8s manifests, P4.5 npm publish, P4.6 zero-container mode still missing (brief §6). Gate **OPEN 8/8 PASS** (`quality-assurance`, `security-reviewer` C1..C10+J/K/I, `automation-reviewer` §4a/4c/4d+CI, `readability` 7/7 3 Low, `reliability` bounded 30s/5s/3s, `resilience` blast-radius/rollback, `risk`, `refuter` 6 claims — see `GATE_REPORT.md`).

## [v0.7.1] — 2026-09-24

### Added

- **F-01-EMB closure — embedding invariant in tier-1 post-write verify** (`docs/CONTRACT.md` v1.6, `ROADMAP.md` §1.3 `F-01-EMB` **CLOSED** 2026-09-24): `getMemoryById` now projects `embedding` (internal verify only, never returned by search routes, existing index #1, bootstrap stays 8); `FreshSurvivorRow` carries `embedding`, `readEmbeddingVector` fails closed on missing/malformed; `embeddingsEqual` element-wise `Math.fround` ±1e-6; `verifyMergedState` 4th invariant `embedding` routes to `retryWrite` (full `updateMemoryContent` re-send) → re-verify → named `REQ-F-01 … embedding` throw; heal line `invariants=…,embedding` token-only (`oneLine`, stderr) — evidence `verify-lifecycle` **123** (§I-d d1 8 sends heal, d2 throw, d3 f32 green) + `probe4` **13** `maxDiff=0 dims=384` VERDICT A + `verify` **243** + `typecheck` clean + CI **36044780528** success on `f772e45` (engineering, security, automation/ops)

### Changed

- Version 0.7.0 → 0.7.1 across 6 carriers: `package.json`, `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`, README badge (engineering, release)

## [v0.7.0] — 2026-09-24

### Added

- **Per-confirmed-heal observability line** (gate RL001-F01 / COND-RK-02):
  `ensureConceptLinks` and `verifyMergedState` each emit ONE allowlisted
  single-line **stderr** entry after a CONFIRMED heal —
  `heal survivor=<memoryId> links=<n>` (link-only, after the confirming
  re-read) / `heal survivor=<memoryId> invariants=content,dedupKey|links`
  (full-write, after the confirming re-verify) — memoryId + count/family
  tokens only, never content and never concept names (SEC-F02), `oneLine`
  collapsed (CWE-117); stderr because stdout is the MCP protocol channel
  (`src/mcp.ts:381`) (engineering)
- **Three additive contract §2 queries** (`db/queries.ts`, contract v1.5):
  `getMemoryById` (fresh survivor re-read under the merge lock — memoryId +
  project fail-closed where-filter, existing index #1 only, bootstrap stays 8),
  `memoryConcepts` (anchor + `HAS_CONCEPT` → dedup → concept names), and
  `linkMemoryConcepts` (link-only heal — never writes content/embedding/
  dedupKey; the caller's re-read via `memoryConcepts` is the real gate)
  (engineering)

### Fixed

- **REQ-RL-001 — in-process lost-append on concurrent distinct near-dup
  variants**: tier-1 merges now serialize per SURVIVOR (`survivorTails` +
  shared `withFifoLock`; lock order dedupKey OUTER → survivor INNER, one
  survivor per merge — no cycle) and re-read the row FRESH via
  `getMemoryById` under that lock (expired-while-waiting → plain insert,
  never absorbs; vanished/wrong-id/non-string-content fail closed) — 3
  concurrent distinct variants land on ONE survivor with every wording
  present (§P `rl-001:` 13 checks); contract §3 tier-1 (a) CLOSED
  2026-09-24, code `01224cc` (engineering)
- **REQ-F-01 — mid-batch atomicity assumption on tier-1 merge writes**:
  post-write verify under the survivor lock (content === merged content,
  dedupKey === its hash, every effective concept linked via
  `missingConcepts`) with ONE heal — full `updateMemoryContent` retry for
  content/dedupKey drift, link-only `linkMemoryConcepts` for links — then
  fail-closed throw naming any still-violated invariant; the
  substring-guard path now runs the same concept-link verify + heal while
  keeping content byte-identical (§P `f-01:` heal E2E, §G goldens, §I
  guard-path heal seam); contract §3 tier-1 (b) CLOSED 2026-09-24, code
  `a0257d6` (engineering)
- **Gate RL001-F01 remediation — 11 clearable-now conditions cleared**
  (2026-09-24, two commits): RD-01 merge-docstring no longer says
  "WITHOUT a write" unqualified (concept-link verify + heal now runs on the
  guard path); RF-03 the three contract-claimed fail-closed sub-paths gain
  asserting §I-c seam cases (expired-while-waiting → plain insert, 3 sends;
  fresh-read miss → stale links → merge-path retryWrite, 8 sends;
  post-heal still-violated → named throw, 8 sends) + the RK-02
  heal-response envelope assert (verify-lifecycle 113 → **117**); RF-04
  `linkMemoryConceptsParams` pinned to the frozen §2 order
  `memoryId, project, concepts` (behavior-neutral: named params);
  RF-01 "ATOMICITY CLOSED" re-scoped to content/dedupKey/links with
  `embedding` named as residual (≤2026-12-31 / engine upgrade);
  RF-02/RS-01/QA-003 ROADMAP §1.3 rows reconciled to CLOSED past-tense +
  surviving boundaries and `:44` counts → 243/117/137; RS-02 lock-queue
  envelope declared (6 sends happy / ≤11 worst-heal / ≤165 s, no queue cap,
  trigger P4.3 or first retry storm); RK-01 residual ledger completed
  (`F-01-EMB`, `RL-001-QUEUE`, `VERIFY-SESSION-NODES` + crash-window
  carve-out + session-node run budget +17/run); RK-02 operator runbook
  line; RK-03 rollback rewritten to the proven reverse-order whole-commit
  revert (probes 1/0/0 re-verified at `fb8e661`; at the remediated HEAD they
  read 1/1/0, hence "revert this lane first"); QA-05 README Verification →
  243/117 with v1.5
  blocks named; QA-06 plan Quality Gates ticked + Commit-2 evidence entry
  (engineering, docs)

## [v0.6.0] — 2026-09-23

### Added

- **P2 capture breadth** (P2.2–P2.4): `PostToolUse` with an edit-like tool
  name stores `file edited via <tool>` (name only; `AGENT_MEMORY_CAPTURE_PATHS=
  basename` opt-in appends the sanitized basename, default OFF; path-bearing
  tool names fail closed); plugin `tool.execute.after` records
  `tool failed: <tool>` (`hook:tool.execute.after`, memory* skipped);
  Antigravity adapter mirrors the edit marker — `hooks/capture.mjs`,
  `plugins/opencode/plugins/agent-memory.ts` (`captureToolFailure`),
  `plugins/antigravity/scripts/capture.mjs` (engineering/security)
- **Transcript import** (P2.3): script-only
  `scripts/import-transcript.ts` (`--file/--project/--session-id/--dry-run/
  --include-prompts`) through the existing `POST /memory/remember` surface —
  Claude Code JSONL + generic `{content}` fallback, prompts skipped by
  default, origins coerced into `import:*` (engineering/automation)
- **Session summarization** (P2.4): deterministic no-LLM
  `src/summarize.ts` (top concepts, origin counts, top-5 picks, top-3
  lessons) + `scripts/summarize-session.ts` saving summary + lessons as
  `/memory/lesson` rows under the same sessionId (engineering)
- **Contract v1.3** (`docs/CONTRACT.md`): P2 allowlist + plugin after-origin +
  script surface + §5 bar (`verify-capture` 137); no route/tool/schema
  changes (engineering)

### Fixed

- Gate P2-COMPLETE remediation C1–C6 (10 reviewers, gate OPEN): generic-user
  prompt-gate bypass, path-bearing tool-name storage, plugin non-string
  throw + unguarded `execute.before`, generic origin minting `lesson`/
  `hook:*`, entry-guard side effect on import, README staleness
  (engineering, security, legal, automation)

### Changed

- Version 0.5.0 → 0.6.0 across 6 carriers: `package.json`,
  `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`,
  README badge (engineering, release)
- **DAT-001 closed at its v0.6.0 trigger** — `docs/CONTRACT.md` v1.4 §3
  declares Concept retention (TTL none, intentional: globally-unique shared
  vocabulary) + a live-verified operator-run orphan-cleanup procedure
  (audit → zero-in-edge gate → drop → re-audit; 189→188 Concepts, linked 128
  unchanged, 2026-09-23); `ROADMAP.md` §1.3 row closed, README
  known-limitation #10 added (data/legal, engineering)

## [v0.5.0] — 2026-09-23

### Added

- **Derived confidence** (P1.4 / REQ-P1-4): `importance` omitted by the caller
  is now computed at write time from provenance + structure
  (`deriveWriteImportance`: lesson 0.75 / `hook:*` 0.55 / else 0.5 base +
  0.025·min(concepts,8), clamp01) instead of defaulting to `0.5`; ranking-time
  `confidenceBoost` (recall ledger, cap 10k, per-process) applied AFTER decay
  on the fused tie-break — stored `importance` is never rewritten; the OpenCode
  plugin no longer pins captures at a client-side 0.5 (engineering, P1)
- **Tier-1 consolidation** (P1.2 / REQ-P1-2): `remember` merges
  near-duplicates — `Jaccard(tokens) ≥ AGENT_MEMORY_MERGE_JACCARD` (default
  0.9, fail-closed OFF on bad config) over a `searchByText` probe under the
  dedup FIFO lock: content concatenated (substring guard closes the re-merge
  loop), `embedding`/`dedupKey` rewritten via `updateMemoryContent`,
  incoming's concepts re-linked from the survivor, survivor `memoryId` stable,
  response gains `consolidated: true`; `probe4` proved live that `setProperty`
  refreshes text+vector indexes (engineering, P1)
- **Eval harness** (P1.5 / REQ-P1-5): adapter-pluggable `EvalClient`
  (`scripts/eval.ts`, `EVAL_MODE=rest`), deterministic in-repo corpus
  (`eval/corpus.ts`, 40 docs / 15 queries with qrels, zero network), scores
  R@5/R@10/MRR@10/nDCG@10 for bm25 + hybrid in project `agent-memory-eval`,
  writes our own numbers to `docs/benchmarks/SCORECARD.md` — upstream's
  benchmark numbers are never claimed (engineering/ops, P1)
- **Skill set** (P3.2 / REQ-P3-2): 8 invocable skills — `recall`, `remember`,
  `recap`, `handoff`, `forget`, `lesson`, `commit-context`, `session-history`
  — contract-accurate route/tool tables + examples, indexed by
  `skills/memory/SKILL.md` (whose stale "7 tools" became all 11); plus
  `scripts/verify-skills.ts`: 73 structural checks + 46 live route round-trips
  (engineering/docs, P3)

### Changed

- `docs/CONTRACT.md` **v1.1 → v1.2**: derived-importance default replaces
  `importance=0.5`, `RememberResult.consolidated`, tier-1 consolidation +
  `AGENT_MEMORY_MERGE_JACCARD` semantics, recall-boost tie-break order,
  `updateMemoryContent` in §2, tier-1 out of §4's do-not-build, §5 bar (86 /
  212 / 119 / probe4 / eval) (engineering, P1+P3.2)
- `scripts/verify.ts` bar 152 → **214 passed**; `verify-lifecycle` 39 → **104
  passed** (confidence, consolidation + gate-remediation goldens: decay-then-
  boost order, eval metrics, fail-closed probe, TTL×merge, plugin no-default;
  + MCP adapter pass-through in `verify`)
- Version 0.4.0 → 0.5.0 across `package.json`, lockfile, plugin `VERSION`,
  MCP server identifier, and README badge (engineering, P1+P3.2)

### Fixed

- **Gate P1R-P32 remediation** (quality gate, 2026-09-23): hand-computed
  eval-metric goldens (`eval/metrics.ts` + `verify-lifecycle` §H) so a wrong
  R@/MRR/nDCG can no longer ship green; decay-THEN-boost order golden
  (`tieBreakImportance`, §F-bis); induced probe-failure fail-closed test
  (§I); MCP adapter importance pass-through via `InMemoryTransport` + plugin
  no-default source check; TTL×merge guard (probe candidates run through
  `filterExpired`); `verify-skills --structural` server-free mode + CI step;
  probe4 log-line hardening (CWE-117); scorecard corpus-specific disclaimer +
  actual-URL reproduce block; `RELEASE_NOTES.md` v0.5.0; CONTRACT §3 tier-1
  declarations (concurrency exception, atomicity assumption, TTL×merge,
  provenance, index dependency) (engineering, docs)

## [v0.4.0] — 2026-09-23

### Added

- **Auto concept extraction** (P1.3 / REQ-P1-3): `remember` without an
  explicit `concepts[]` derives up to 8 deterministic concepts (shared
  tokenizer → stopwords → tf DESC → lex ASC); caller-supplied concepts win
  verbatim, so the §3 echo contract is preserved; derived concepts power the
  graph branch on plain saves (fused score == 3/61 proof) —
  `src/concepts.ts` (engineering, P1)
- **Dedup on write** (P1.6 / REQ-P1-6): `dedupKey =
  sha256(project + "\n" + normalize(content))` property + index #8 +
  `findMemoryByDedupKey` pre-check under a per-key FIFO lock; duplicate saves
  return the existing id with additive `deduped: true` and create no second
  row; uniqueness is application-side (probe3: the server does not enforce
  the unique index) (engineering, P1)
- **Memory lifecycle — corte A** (P1.1 / REQ-P1-1): read-time decay
  `importance · e^(−λ·ageDays)` on the fused tie-break
  (`AGENT_MEMORY_DECAY_LAMBDA`, default OFF) + TTL hiding of expired rows with
  an explicit `ttl: hidden N expired rows` signal
  (`AGENT_MEMORY_TTL_DAYS`, default OFF) + fail-closed `scripts/purge.ts`
  (`--days N --project P|all [--dry-run]`, project-scoped `listExpired` +
  per-id `forgetMemory`, allowlisted governance line) (engineering/ops, P1)
- **Hook coverage** (P2.1 / REQ-P2-1): `capture.mjs` 3 → 7 events
  (`PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`) with
  a per-event content allowlist — `UserPromptSubmit` never reads prompt text
  (Ley 172-13) — plus the OpenCode plugin's 5th hook
  `tool.execute.before` (fire-and-forget `tool started: <name>`, own
  `memory*` skipped) (engineering/security, P2)
- Local suites `scripts/verify-lifecycle.ts` (39 passed) and
  `scripts/verify-capture.ts` (115 checks), both Helix-free and wired into CI
  (engineering, P0/P1/P2 gate)

### Changed

- `docs/CONTRACT.md` **v1 → v1.1**: §0 probe3 facts (unique index not
  enforced, `ltParam` on `dateTime`, missing-property writes), §1
  `dedupKey` property, §2 +3 exports + index #8 + `saveMemory` param, §3
  remember/dedup/decay/TTL/purge/7-event hooks/plugin `execute.before`
  semantics, §4 drops "Decay" from do-not-build, §5 verification bar
  (engineering, P1+P2.1)
- `scripts/verify.ts` bar grows 102 → 131 → **152 passed** across lane +
  gate remediation (derived-concepts, graph-branch, dedup/race, dedup×hook
  (F4) sections); README route prefix corrected to
  `/memory`, hooks/config/verification docs refreshed (engineering, P1+P2.1)
- Version 0.3.0 → 0.4.0 across `package.json`, lockfile, plugin `VERSION`,
  MCP server identifier, and README badge (engineering, P1+P2.1)

### Fixed

- Purge governance/audit lines: CWE-117 newline forgery — print-side
  `oneLine()` normalizer extracted to `src/logline.ts` + 5 CI assertions in
  `verify-lifecycle` section E (security, P1+P2.1 gate COND-004 / COND-007)
- Dedup store pre-check fails closed on shape drift — transport error or a
  response missing the frozen `memory` return throws instead of reading as a
  miss (engineering, P1+P2.1 gate resilience F1)
- Purge failure paths write an allowlisted single-line `status=partial` audit
  record before exit 1 when deletions happened, plus per-batch
  `purge-progress` (automation/ops, P1+P2.1 gate COND-006)
- Doc-truth corrections: falsified `contentHash` docstring, nonexistent-test
  citations, plan/README false-pointer cells, `dedayImportance` →
  `decayedImportance` typo — swept to 0 instances across all six docs
  (engineering, P1+P2.1 gate COND-005 / COND-008 / COND-010)

## [v0.3.0] — 2026-09-22

### Added

- `LICENSE` (Apache-2.0) + `package.json` `"license": "Apache-2.0"` as the
  license of record (legal, P0 / REQ-P0-1)
- `.github/workflows/ci.yml`: typecheck + verify-injection + pinned gitleaks
  v8.30.1 secret scan on every push/PR (automation/ops, P0 / REQ-P0-2)
- `SECURITY.md` and `CONTRIBUTING.md`, linked from README alongside
  `CHANGELOG.md` (security, P0 / REQ-P0-3)
- Legacy `AGENTMEMORY_*` env acceptance: name-only warning + armed bearer
  guard on server/MCP/bootstrap, silent hooks, `scripts/verify-env.ts` proof
  harness (engineering, P0 / REQ-P0-5)
- `EADDRINUSE` reroute hint (`AGENT_MEMORY_PORT=3151`, never kill the
  upstream) + README port-ownership statement (engineering, P0 / REQ-P0-6)
- Quality-gate record `docs/specs/50_archive/P0/GATE_REPORT.md` — 9
  reviewers, verdict **OPEN** (CLOSED → CONDITIONAL → OPEN) — plus waivers
  `docs/specs/50_archive/P0/WAIVERS-P0.md` W1..W6 with owners/expiries
  (engineering, security, legal, automation/ops, P0)

### Changed

- Persistence default: `storage = "disk"` in `helix.toml` so
  `helix start dev` survives restarts + bootstrap advisory warning when the
  key is missing (engineering, P0 / REQ-P0-4)
- Version 0.2.0 → 0.3.0 across `package.json`, lockfile, plugin `VERSION`,
  MCP server identifier, and README badge (engineering, P0)

## [v0.2.0] — 2026-09-22

### Added

- REST routes `/agentmemory/recap`, `/agentmemory/handoff`,
  `/agentmemory/lesson`, `/agentmemory/delete` (engineering, P3.1)
- MCP tools `memory_recap`, `memory_handoff`, `memory_lesson`,
  `memory_delete` — tool surface 7 → 11 (engineering, P3.1)
- Shared digest module `src/digest.ts` with 20s fan-out budget and
  `digest: budget exceeded` signal (engineering, P3.1 gate COND-005)
- Upstream identity guard in `scripts/verify.ts` — read-only probe aborts
  before any write against a non-agent-memory target (engineering, P3.1
  gate COND-002)
- `CHANGELOG.md` (ship-release step 3)

### Changed

- `docs/CONTRACT.md` §3 amended (+4 routes, +4 tools), §4 out-of-scope list
  trimmed, §5 verification bar extended (engineering, P3.1)
- Governance log line declares purpose, retention/deletion, field allowlist,
  and masking/no-PII rule (data/security, P3.1 gates COND-003 + C3-R13)
- Version 0.1.0 → 0.2.0 across `package.json`, plugin `VERSION`, and the
  MCP server identifier

### Fixed

- Governance log forgery via embedded newlines in `reason`/`memoryId` —
  normalized to a single line before logging, both lanes (security, P3.1
  gate COND-001)
- MCP delete input schemas advertise `minLength`/`maxLength` again — bounds
  applied on both sides of normalize (engineering, P3.1 gate C3-R17)

## [v0.1.0] — pre-changelog (commit `44914e0`)

### Added

- Initial public release: 8 REST routes, 7 MCP tools, zero-dependency
  capture hook, HelixDB store (graph + vector + BM25), contract
  `docs/CONTRACT.md`, end-to-end `scripts/verify.ts`.
