# Data Review: P1-P21

**Reviewer:** review-data (data cross-cutting lens — lineage/minimization)
**Date:** 2026-09-23
**Verdict:** PASS

Scope: `1c410ee..HEAD` (6 commits) + current files. Data lens only — schema
changes, derived stores (dedup hash, derived concepts), new query surfaces
(`findMemoryByDedupKey`, `listExpired`, `listProjects`), purge output, hook
observation allowlist. Engineering/security criteria are covered by their own
reviewers; cross-domain items appear as referrals, not verdicts.

## Checklist

- [x] Schema changes versioned — `Memory.dedupKey` + index #8 declared in
  CONTRACT v1.1 §1/§2 (2026-09-23 amendment); legacy rows documented as
  legitimately lacking the property (CONTRACT §0, probe3 a3-2 — no backfill
  blocker). `deduped` response field is additive/optional-typed in `verify.ts`.
- [x] Data lineage documented — full table below, every new field traced
  compute → store → read → consumer → deletion.
- [x] Quality checks (nulls, types, ranges) — `dedupKey` is a 64-hex sha256;
  `contentHash` output shape asserted by `verify-lifecycle` golden; `--days`
  validated `^[1-9][0-9]{0,5}$` (purge.ts:84); `listExpired` rows fail closed
  on missing/empty `memoryId` (purge.ts:177); `clamp01` bounds decayed
  importance (lifecycle.ts:39-44).
- [x] PII handling compliant — hook `UserPromptSubmit` stores a fixed string
  only, canary asserted (verify-capture.ts:336-344); `PreCompact` trigger
  canary asserted (:349); no PII added beyond content already stored by design.
  Privacy-engineer criteria for hooks are owned by the security lens —
  referral, not re-audited here.
- [x] Migration path defined — legacy `dedupKey`-less nodes are harmless
  (probe3 a3-2), never retroactively merged (documented backfill gap,
  CONTRACT §3); one-shot backfill contingency named in the plan, not needed.
- [x] Backfill strategy (if applicable) — N/A, probe-gated and documented.
- [x] Analytics impact assessed — none: no analytics sink exists; `signals`
  are runtime-only (not persisted); purge emits counts, never rows.

## Lineage table (store/field → purpose → TTL/retention → deletion → evidence)

| Store / field | Purpose | TTL / retention | Deletion procedure | Evidence |
|---|---|---|---|---|
| `Memory.dedupKey` (NEW property) | Write-dedup lookup key only: `remember()` pre-check under per-key FIFO lock; index #8 accelerates the read | Lifetime of its Memory row — no independent TTL; inherits `AGENT_MEMORY_TTL_DAYS` hiding + `purge.ts --days` | Row hard-delete removes it: `/memory/forget`, `/memory/delete`, and purge all drop the node (incident edges go with it) — no orphan possible | computed `src/lifecycle.ts:68-70` (`sha256(project + "\n" + normalize(content))`); called `src/store.ts:430`; stored `db/queries.ts:255`; read `db/queries.ts:432-447` (projects id/memoryId/sessionId/project — **not** the key, **not** content); consumed `src/store.ts:438-465`; delete `db/queries.ts:388-402`, `scripts/purge.ts:275-283` |
| `Concept` nodes + `HAS_CONCEPT` edges (NEW: auto-derivation feeds them) | Graph-search labels: top-8 tf-ranked content tokens when caller passes no concepts (explicit concepts win verbatim) | **Undeclared** — no TTL, never expired, never enumerated by purge (see DAT-001) | **None exists** — `forgetMemory` drops only the Memory node; Concept nodes persist as orphans (reused if same token saved again) | derivation `src/concepts.ts:58-72`; store path `src/store.ts:477-479` → `db/queries.ts:189-217,275`; no Concept drop anywhere (`grep Concept ∩ drop/delete/forget/cleanup` → 0 matches); purpose documented CONTRACT §3 v1.1 |
| Hook observation rows (NEW events) | Session/tool telemetry: fixed strings + tool NAME only (≤80 chars), `origin="hook:<event>"` | Same as Memory rows: opt-in TTL + purge; default indefinite | forget / purge (as above) | allowlist `hooks/capture.mjs:56-72`; plugin tool-start `plugins/opencode/plugins/agent-memory.ts:594-613` |
| `listExpired` query result (NEW read surface) | Purge id enumeration — nothing else | Transient query result; page ≤500 (dry-run ≤100k) | N/A (never stored) | projects **ONLY** `memoryId`: `db/queries.ts:484` — content/origin/importance never leave the query |
| Purge stdout (plan line, dry-run ids, health counts, governance line) | Audit of bulk destructive delete | Host log retention/rotation | Log rotation or process exit | allowlist `scripts/purge.ts:301-342` — plan `project/days/cutoff/dry_run`, ids only on dry-run (:253), governance `project/days/deleted/at` (:340-342), health counts only (:328-337); **no content on any path**; `describeError` prints error message only, never query values (:103-110) |
| Decay/TTL read of `createdAt` | Ranking tie-break + expiry filter | Read-only derivation; **no new store** | N/A | `src/lifecycle.ts:83-119`; `src/search.ts:133-143,95,215` |
| Governance delete log line + access log (EXISTING PII stores) | Destructive-delete audit / request telemetry | Unchanged: host log retention | Unchanged: rotation/exit | **No new field reaches them** — `src/server.ts` has a 0-line diff in `1c410ee..HEAD`; `src/mcp.ts` diff is a version bump only; governance line still `memoryId/reason/at` (server.ts:414) |
| Plugin `lastPrompt`/`recallCache` (EXISTING, pre-lane) | In-process recall query + cache | Process memory only; LRU 64/64; cleared on dispose | Process exit / dispose | `plugins/.../agent-memory.ts:415-418,946-957`; unchanged by this lane |

## Minimization findings (verified surfaces)

- **`listExpired` projection is memoryId-only** — PASS. `db/queries.ts:484`:
  `.project([PropertyProjection.new("memoryId")])`. Content, origin,
  importance, embedding never leave the query; purge only ever acts on ids.
- **Purge stdout allowlist** — PASS. Plan/dry-run/health/governance lines
  carry `project`, `days`, `cutoff`, `dry_run`, ids, counts, ISO time. No
  content on any branch (purge.ts:301-342).
- **`UserPromptSubmit` stores no prompt text** — PASS. `capture.mjs:65`
  returns the fixed string; the code never reads `hook.prompt` (grep: only a
  comment says so). Canary `USER_PROMPT_CANARY_xyz secret` asserted absent
  from POSTed body, stdout AND stderr (verify-capture.ts:336-344); the
  PreCompact trigger canary likewise (:349).
- **Plugin `tool.execute.before` stores tool NAME only** — PASS.
  `captureToolStart(cfg, event.tool, …)` (agent-memory.ts:941-943);
  `event.input` is never read anywhere in the plugin (grep: 0 matches);
  `memory*` self-skip prevents an unbounded observation loop (:595).
- **Decay/TTL read `createdAt` only** — PASS. No new persistence anywhere in
  `src/lifecycle.ts` or `src/search.ts`.
- **Existing PII stores unchanged** — PASS. `src/server.ts`/`src/auth.ts`/
  `src/env.ts` untouched by the lane (0-line diff); governance line fields and
  access-log fields identical to pre-lane.
- **Test data synthetic** — PASS. probe3 fixtures are literal
  `"probe p1 dedup content"` / `"probe p1 ttl content"`; verify.ts uses
  quantum/tomato/nonce strings; capture canaries are labeled synthetic
  (`synthetic-capture-secret-canary-17213`). Pattern grep (emails, phones,
  keys, `BEGIN * PRIVATE KEY`, AWS/Slack tokens) across all new fixtures: 0
  matches.
- **No secrets in code/logs/examples** — PASS on the diff. Hits are env-var
  *names* (`AGENT_MEMORY_SECRET`), doc references, and synthetic canaries;
  no credential material in any added line.

## Findings

| ID | Severity | Finding | Owner / evidence |
|----|----------|---------|------------|
| DAT-001 | Medium | **Derived `Concept` store has no deletion procedure and no declared TTL.** `forgetMemory`/`delete`/purge drop the Memory node but never the Concept node: content-derived tokens (≤8 per memory, up to 8 × every plain save since this lane auto-derives) persist indefinitely after an erasure request — right-to-erasure does not propagate to the derived store. The lane amplifies a pre-existing gap (Concept/HAS_CONCEPT existed since P0) into the default write path; Ley 172-13 requires purpose + TTL + deletion for every store, and only purpose is declared. Concept nodes are shared by `name` (global unique index), so naive per-memory deletion would break other rows — the declaration must state retention + an orphan-cleanup procedure. | Location: `db/queries.ts:388-402` (drop target only), `src/store.ts:477-479`, `src/concepts.ts`; grep confirms no Concept drop/delete/expire exists anywhere. Owner: engineering/orchestrator. Fix within sprint (declaration + cleanup decision). |
| DAT-002 | Low | **`dedupKey` is an unsalted deterministic sha256 over guessable content** — anyone holding DB read access can confirm a guessed fact's presence in a project by recomputing `sha256(project + "\n" + normalize(content))` (equality-confirmation, no salt). **Verdict: accepted, no marginal disclosure.** The pre-image's plaintext (`content`) is stored in the same node in cleartext and text-indexed, so the hash reveals nothing an attacker with the same access couldn't read directly; the project prefix scopes keys (same fact in two projects = unlinkable keys, and `remember` re-verifies `hitProject === input.project` fail-closed, store.ts:447-453); the key itself never leaves the DB — not in `findMemoryByDedupKey`'s projection, not in `memoryRowProjection`, not in any API response (`remember` returns `{id, sessionId, project, concepts, deduped}`), not in any log or error string. | Location: `src/lifecycle.ts:68-70`, `db/queries.ts:432-447`. Accepted with this rationale documented; re-evaluate only if `dedupKey` ever gains an external consumer or `content` becomes encrypted. |

**Referrals (not this lens's verdicts):**

- **Secret scan → security lens / CI.** Local gitleaks unavailable (2 download
  timeouts, escalated); CI P0.2 `secret-scan` job is the enforcing gate on
  push. My line-by-line diff scan found no secret material (see checklist), so
  the data findings do **not** additionally require gitleaks before ship — the
  standard rule stands: no ship with a red/green-unknown CI secret scan, owned
  by the security reviewer.
- **Plugin `prompt` hook holds the newest user text in-process** as the recall
  query (pre-existing, unchanged by this lane; never persisted — search bodies
  are not logged). Engineering lens if any criterion covers it.
- **`Concept.name` unique index is global (not project-scoped)** — pre-existing
  schema property; no cross-project content leaks in results because
  `graphSearch` filters Memory by project (`db/queries.ts:380`). Engineering
  lens.

## Verdict Rationale

**PASS.** All eight lineage surfaces in the packet trace end-to-end with a
declared purpose and a deletion path — with one documented exception:
DAT-001 (Medium): the derived Concept store inherits no TTL and no deletion
procedure, so erasure leaves content-derived tokens behind. It is
substantially pre-existing (the schema predates the lane), its impact is
conditional (manifests only on erasure/retention review), and per the severity
policy Medium is fix-in-sprint — it does not block release, so it is recorded
as explicit residual risk with an owner rather than a ship condition. DAT-002
(Low) is an accepted-by-design property of content-hash dedup: the hash adds
zero marginal disclosure because the plaintext pre-image sits beside it and
the key never leaves query projections, APIs, or logs. Every other
minimization surface the packet asked about — `listExpired`'s memoryId-only
projection, purge's stdout allowlist, the prompt/trigger canaries, the
tool-name-only plugin observation, `createdAt`-only decay/TTL, untouched
governance/access logs, synthetic fixtures, secret-free diff — verified PASS
with cited evidence. No Critical or High findings; no silent pass: DAT-001 is
tracked with severity, location, and owner above.
