# agent-memory — v1.5 Frozen Contract

Source of truth for both build lanes. Reference-only packet: implement against this,
report deviations, do not rename exports or routes.

Status: every construct in §1 and §3 was empirically verified against the running
instance at `http://localhost:6969` (see `scripts/probe.ts`, `scripts/probe2.ts`,
`scripts/probe3.ts`).

**v1.1 amendment (2026-09-23, P1+P2.1 lane):** `Memory.dedupKey` + index #8,
`findMemoryByDedupKey`/`listExpired`/`listProjects` queries, `remember` auto
concept derivation + `deduped` response field, decayed-importance tie-break +
TTL filter + `purge.ts`, 7 supported hook events with per-event content
allowlist, plugin `tool.execute.before`. §4 drops "Decay" from the
out-of-scope list; §5 grows two local suites. Everything below reflects the
shipped code.

**v1.2 amendment (2026-09-23, P1-remainder + P3.2 lane):** `importance` is now
DERIVED when the caller omits it (P1.4 — replaces the `0.5` default), the fused
tie-break gains a recall boost AFTER decay (in-process recall ledger, P1.4),
`RememberResult` gains `consolidated` with tier-1 near-duplicate consolidation
under `AGENT_MEMORY_MERGE_JACCARD` (P1.2), `updateMemoryContent()` joins §2,
and §5 grows `probe4` + `verify-skills` + the eval harness scorecard.

**v1.3 amendment (2026-09-23, P2-completion lane):** P2.2 file-edit marker —
`PostToolUse` with an edit-like tool name stores `file edited via <tool>`
instead of `tool used` (both capture hooks; `AGENT_MEMORY_CAPTURE_PATHS=
basename` opt-in appends the sanitized basename only, default OFF, full paths
never stored) + plugin `tool.execute.after` failure observation
(`tool failed: <tool>`, `hook:tool.execute.after`, memory* skipped, §3
`captureToolFailure`); P2.3 `scripts/import-transcript.ts` (script-only
transcript import through the existing remember surface, prompts skipped by
default, `--include-prompts` opt-in); P2.4 `src/summarize.ts` (deterministic,
no-LLM session summary + lessons) + `scripts/summarize-session.ts` (saves
summary + lessons as `/memory/lesson` rows under the same sessionId). No
frozen route or MCP tool changes. §5 `verify-capture` grows §F (**137
checks** after gate remediation).

**v1.4 amendment (2026-09-23, v0.6.0 ship / DAT-001 closure):** §3 grows the
Concept-retention declaration (Ley 172-13 shape: purpose + TTL + deletion
procedure) — Concept as shared search vocabulary for the graph branch, PII posture
(derived tokens filtered at gate P1R-P32 acceptance W-3; caller-supplied labels
verbatim = caller's responsibility), TTL none DECLARED INTENTIONAL (global name
uniqueness, §1 index #3; no per-memory drop because other memories/projects may
reference the name), the two-half deletion procedure (per-memory
`forget`/`delete`/`purge` + operator-run manual orphan cleanup — no scheduler in
v0.6.0 — with audit / zero-edge-gate / drop queries verified live 2026-09-23), and
the honest right-to-erasure boundary. Docs-only declaration: no route, MCP tool, or
code change; §5 verification bar unchanged. Closes ROADMAP §1.3 DAT-001 at its
`2026-12-31 or v0.6.0` trigger. Owner: engineering (procedure re-run on demand).

**v1.5 amendment (2026-09-24, RL-001 + F-01 residual closure lane):** §2 grows
three ADDITIVE queries — `getMemoryById` (fresh survivor re-read under the merge
lock; existing index #1 only, bootstrap STAYS 8), `memoryConcepts`, and
`linkMemoryConcepts` (link-only heal — never touches content/embedding/dedupKey).
§3 tier-1 (a) CONCURRENCY closes: a per-survivor FIFO lock (`survivorTails` +
shared `withFifoLock`; lock order dedupKey OUTER → survivor INNER, one survivor
per merge — no cycle) plus a fresh `getMemoryById` re-read under that lock
(expired-while-waiting → plain insert, never absorbs) ends the in-process
lost-append on concurrent distinct near-dup variants — SAME-PROCESS scope only;
cross-process writers to one Helix instance remain out of contract until P4.3.
§3 tier-1 (b) ATOMICITY closes: a post-write verify under the survivor lock
(content, dedupKey, every effective concept linked) with ONE heal and a
fail-closed throw naming any still-violated invariant replaces the blind
mid-batch assumption — the substring-guard path now runs the same concept-link
verify + heal while keeping content byte-identical; `RememberResult` echo
semantics unchanged; the merge write remains ONE Helix `writeBatch` whose commit
is DETECTED-and-healed app-side, not engine-guaranteed. §5 grows the §P
`rl-001:` (13 checks) + `f-01:` heal blocks, the §I guard-path heal seam (5
sends, NO insert), and the §G `missingConcepts` goldens — verify **243 passed**,
verify-lifecycle **117 passed** (113 at the original v1.5 landing; +4 from the
gate RL001-F01 remediation pass: the §I-c heal-seam trio + the RK-02
heal-response envelope assert). Code evidence: `01224cc` (REQ-RL-001) +
`a0257d6` (REQ-F-01); gate RL001-F01 condition clearance in this lane's git
log (this amendment's docs half carries the RF-01 re-scope, RS-02 envelope,
RK-01/RK-02 declarations and the §5 count updates).

## 0. Verified facts (do not re-litigate)

| Fact | Evidence |
|---|---|
| `writeBatch().forEachParam()` over an **empty** array commits fine | probe A1 PASS |
| `forEachParam` body runs per element, creates nodes | probe A2 + probe2 (3 Concepts) |
| Cross-entry `NodeRef.var("outer")` usable **inside** a forEach body | probe B PASS + `HAS_CONCEPT` edge present |
| `varAsIf` create/update branch works both directions | probes C/C2 PASS |
| `createIndexIfNotExists` is **async** (`kind:"accepted"`); `textSearch`/`vectorSearch` throw `index_not_found` until it lands | probe F/G FAIL → probe2 attempt 1 PASS |
| Scoped `textSearchWith` + `$score` projection works | probe2 PASS |
| Scoped `vectorSearchWith` (384-dim, cosine, tenant=`project`) works | vecprobe PASS, `distance:0` |
| `toQueryJson()` returns a **string**; use `toQueryRequest(params, values, options)` → `client.query(req).send()` | SDK `dsl.d.ts:694-699` |
| `PropertyInput.value(x)` — there is **no** `PropertyInput.val` | SDK `dsl.d.ts:96` |
| `IndexSpec.nodeVector(label, prop, dim, metric, tenant?)`, `nodeText(label, prop, tenant?)` | SDK `dsl.d.ts:325-326` |
| A unique-equality index does **not** reject duplicate writes in Helix v0.0.6 — `dedupKey` uniqueness is enforced **application-side** by `remember()`'s pre-check under a per-key FIFO lock; index #8 only accelerates that lookup | probe3 b2/d1/d2/d3 |
| A node **missing** the indexed property is accepted (legacy `dedupKey`-less rows are harmless; no backfill blocker) | probe3 a3-2 |
| `Predicate.ltParam` on a `dateTime` property: strict older-than, project-scoped, `$id Asc` deterministic (server does not sort DateTime keys) | probe3 (e) |
| `Predicate.ltParam`/range filters do **not** require a range index — they run as residual predicates after the equality anchor on `project` | probe3 (e) |
| `setProperty` on indexed properties (`content`/`embedding`/`dedupKey`) refreshes BOTH the text and vector indexes in place — a tier-1 merge is immediately retrievable as merged content | probe4 VERDICT A (12 passed, live dev instance) |

Never restart or stop the dev instance. It runs with `storage = "disk"` (key in
`helix.toml`, set by P0.4).

## 1. Labels, edges, dimensions

```ts
LABELS.Session = "Session"   LABELS.Memory = "Memory"   LABELS.Concept = "Concept"
EDGES.BELONGS_TO = "BELONGS_TO"   // Memory -> Session
EDGES.HAS_CONCEPT = "HAS_CONCEPT" // Memory -> Concept
EMBED_DIM = 384
```

Node properties (top-level — indexed/searchable fields must not be nested):

- `Session`: `sessionId` (string, unique), `project` (string), `startedAt` (dateTime), `updatedAt` (dateTime)
- `Memory`: `memoryId` (string, unique), `content` (string), `project` (string), `sessionId` (string),
  `origin` (string), `importance` (f64, 0..1), `createdAt` (dateTime), `embedding` (f32[384]),
  `dedupKey` (string, unique index #8; `sha256(project + "\n" + normalize(content))`
  where normalize = lowercase + collapse whitespace runs + trim — added in v1.1,
  legacy rows may lack it; v1.2 tier-1 consolidation REWRITES it on the survivor
  to the hash of the merged content)
- `Concept`: `name` (string, unique), `project` (string)

`project` is the tenant/scope value for every vector and text index. Search routes
always pass it.

## 2. `db/queries.ts` exports (frozen names)

```ts
export const LABELS, EDGES, EMBED_DIM

bootstrapIndexes(): WriteBatch        // no params, all 8 indexes below
saveMemory():      WriteBatch         // §3 (incl. dedupKey param)
listSessions():    ReadBatch          // params: project (string), limit (i64)
sessionMemories(): ReadBatch          // params: sessionId (string), project (string), limit (i64)
searchByVector():  ReadBatch          // params: queryVector (array f32), project (string), k (i64)
searchByText():    ReadBatch          // params: q (string), project (string), k (i64)
graphSearch():     ReadBatch          // params: concepts (array string), project (string), k (i64)
forgetMemory():    WriteBatch         // params: memoryId (string)
healthCount():     ReadBatch          // params: project (string)  -> memory/session counts
findMemoryByDedupKey(): ReadBatch     // v1.1, §3: params: dedupKey (string) -> memory row
listExpired():     ReadBatch          // v1.1, §3: params: project (string), cutoff (dateTime), limit (i64)
listProjects():    ReadBatch          // v1.1, §3: params: limit (i64) -> RAW Session rows {project} (dedup is the CALLER's job — purge.ts Set)
updateMemoryContent(): WriteBatch     // v1.2, §3: params: memoryId (string), content (string), embedding (array f32), dedupKey (string), concepts (array object), project (string) — anchors by memoryId, setProperty content/embedding/dedupKey under varNotEmpty, re-links `concepts` from the "memory" var via conceptBody(), returns ["updated","memory"]
getMemoryById(): ReadBatch            // v1.5, §3: params: memoryId (string), project (string) — unique-equality anchor on memoryId + project where-filter (fail-closed double check), projects memoryRowProjection + dedupKey, returns ["memory"]
memoryConcepts(): ReadBatch           // v1.5, §3: params: memoryId (string), project (string) — anchor Memory by memoryId+project, out("HAS_CONCEPT") → dedup → project Concept name, returns ["names"]
linkMemoryConcepts(): WriteBatch      // v1.5, §3: params: memoryId (string), project (string), concepts (array object) — link-only heal: anchor + conceptBody() per element (Concept upsert + HAS_CONCEPT); NEVER writes content/embedding/dedupKey; returns ["memory"]; the real gate is the caller's re-read via memoryConcepts
```

Indexes from `bootstrapIndexes()` (all `createIndexIfNotExists`):

1. `nodeUniqueEquality("Memory", "memoryId")`
2. `nodeUniqueEquality("Session", "sessionId")`
3. `nodeUniqueEquality("Concept", "name")`
4. `nodeEquality("Memory", "sessionId")`
5. `nodeEquality("Memory", "project")`
6. `nodeVector("Memory", "embedding", 384, VectorDistanceMetric.Cosine, "project")`
7. `nodeText("Memory", "content", "project")`
8. `nodeUniqueEquality("Memory", "dedupKey")` — v1.1; see §0: the server does not
   enforce it, it is a lookup accelerator for the application-side pre-check

`saveMemory()` param schema:

```ts
{
  memoryId:   param.string(),
  content:    param.string(),
  project:    param.string(),
  sessionId:  param.string(),
  embedding:  param.array(param.f32()),   // exactly 384 values
  origin:     param.string(),
  importance: param.f64(),
  createdAt:  param.dateTime(),
  concepts:   param.array(param.object()), // [{ name: "..." }, ...] — may be EMPTY
  dedupKey:   param.string(),             // v1.1: sha256 hex, see §1
}
```

`saveMemory()` **single writeBatch**, four entries:

1. `session_existing` — `varAsIf` anchor `Session` by `sessionId` equality, `varNotEmpty` branch updates `updatedAt`
2. `session_created`  — `varAsIf` `varEmpty` branch `addN("Session", …)`
3. `memory`  — `addN("Memory", …)` with `PropertyInput.param(…)` for every property above
4. `link`    — `g().n(NodeRef.var("memory")).addE("BELONGS_TO", NodeRef.var(<session>), {})`
   then conditional link entries so the session side resolves whether it was created or updated
5. `concepts` — `forEachParam("concepts", body)` where body upserts `Concept` by `name`
   (unique equality + `varAsIf`) and adds `HAS_CONCEPT` from `NodeRef.var("memory")` to it

Returns must include `["memory", …]` so the caller gets the new `$id`.
Empty `concepts` array must not fail the batch (proven safe — keep it that way).

Reads anchor narrow: unique-equality on `memoryId`/`sessionId`, equality-indexed
`project`/`sessionId`, then scope, **then** `textSearchWith` / `vectorSearchWith`.
Never source-search followed by `where`. Always project `$score` / `$distance`
before navigating off the hit stream. Never return `embedding` in search results.

`graphSearch()` route: `Concept` where `name` in `concepts` → `.in("HAS_CONCEPT")`
→ `Memory`, filtered by `project`, limited to `k`.

`forgetMemory()`: hard-delete the `Memory` node (incident edges go with it).

## 3. `src/` service contract (frozen routes)

Embedder `src/embed.ts`: `embed(text: string): number[]` — deterministic, length 384,
keyless. Lowercase, split `/[^a-z0-9]+/`, drop tokens shorter than 2. FNV-1a 32-bit
per token → bucket `h % 384`, sign from a second hash bit, accumulate term frequency
with `1/(1+ln(tf))` weighting, then **L2-normalize**. No network, no model download.

`src/store.ts` — `MemoryStore` interface; `HelixStore` implements it over `db/queries.ts`.

REST (`src/server.ts`), all under `/memory`, JSON in/out:

| Method | Route | Body / query | Success |
|---|---|---|---|
| GET | `/memory/livez` | — | 200 `{"status":"ok"}` |
| GET | `/memory/health` | — | 200 `{"status":"ok","counts":{…}}` |
| POST | `/memory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |
| POST | `/memory/search` | `{query, project?, limit?}` | 200 `{mode:"bm25", results:[…]}` |
| POST | `/memory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[…]}` |
| GET | `/memory/sessions` | `?project=&limit=` | 200 `{sessions:[…]}` |
| GET | `/memory/sessions/:sessionId/memories` | `?project=&limit=` | 200 `{memories:[…]}` |
| POST | `/memory/forget` | `{memoryId}` | 200 `{forgotten:true}` / 404 |
| POST | `/memory/recap` | `{project?, sessionId?, limit?}` | 200 `{recap, sessionId, count, signals}` |
| POST | `/memory/handoff` | `{project?, sessionId?, limit?}` | 200 `{handoff, sessionId, counts, signals}` |
| POST | `/memory/lesson` | `{content, concepts?, project?, sessionId?, importance?}` (no `origin`) | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |
| POST | `/memory/delete` | `{memoryId, reason}` (`reason` required, 1..1000) | 200 `{deleted:true, receipt:{memoryId, deletedAt}}` / 404 |

Defaults: `project="default"`, `sessionId` auto-generated (`crypto.randomUUID()`) when
absent, `limit=10`, `origin="rest"`.

**v1.2 derived importance (P1.4):** when the caller OMITS `importance`, the
store derives it at write time — `deriveWriteImportance(origin,
concepts.length)` = base (origin `lesson` → 0.75, `hook:*` → 0.55, else → 0.5)
+ `0.025 · min(concepts.length, 8)`, clamped 0..1 (pure, deterministic,
`src/confidence.ts`). An explicit caller value ALWAYS wins and is stored
verbatim. The old `importance=0.5` default is retired: 0.5 remains only the
`rest`-origin BASE before the concept bonus.

**v1.1 remember semantics** (`src/store.ts` + `src/concepts.ts` + `src/lifecycle.ts`):

- **Auto concept derivation (P1.3):** when `concepts` is absent/empty, the store
  derives them: shared tokenizer → built-in English stopword list → drop tokens
  <3 chars or >200 chars → rank by term frequency DESC, then lexicographic ASC →
  top **8** (`extractConcepts`, pure/deterministic). Caller-supplied concepts
  always win **verbatim** — no union, no re-derivation — so the §3 echo contract
  holds. The 201 echoes what was actually stored (derived or caller's).
- **Dedup on write (P1.6):** `remember` computes
  `dedupKey = sha256(project + "\n" + normalize(content))` (normalize = lowercase,
  collapse whitespace runs, trim), then `findMemoryByDedupKey` **pre-checks under a
  per-key in-process FIFO lock**. On a hit it returns the EXISTING id with
  `deduped: true`, echoing the REQUEST's `sessionId`/`concepts` (never re-derived,
  `[]` stays `[]`) — and creates no new row. On a miss it embeds and writes with
  the `dedupKey` property. Uniqueness is application-side (§0: the server does not
  enforce the index). Errors propagate, and a response that lacks the frozen
  `memory` return (or types it wrongly) throws — shape drift is never read as a
  miss (fail closed: neither a transport error nor shape drift may let a possible
  duplicate through). Same content in two projects = two rows (project is
  inside the hash); legacy rows without `dedupKey` are not retroactively merged
  (documented backfill gap).
- **Dedup first-wins semantics (P1.6 × P2.1 interaction, pinned by
  `verify.ts` F4):** dedup is project-scoped **FIRST-WINS** — the stored row
  keeps its ORIGINAL `origin`/`importance`/`sessionId`/belongs-to-session.
  On a dedup hit NO `Session` node is created or bumped (sessions materialize
  on novel writes), so repeat `lesson`/hook observations of identical content
  return the first row — its stored `origin` may differ from the incoming
  forced `origin="lesson"` (first-wins, declared). The response echoes the
  REQUEST `sessionId` per §3 while the row stays under its first session:
  `sessionMemories` of the echoed session will not contain it until that
  session writes novel content.
- **Single-writer assumption (RL-001):** Dedup is application-side and sound
  within ONE writer process (REST or MCP in a single server instance — our
  documented deployment — multi-instance is a planned roadmap item (ROADMAP
  P4.3), not a contract guarantee today); cross-process writers to one Helix
  instance are out of contract (residual risk, owner: engineering).
- **`RememberResult` gains `deduped: boolean`** (additive): `{id, sessionId,
  project, concepts, deduped}`. First write → `deduped:false`; duplicate hit →
  `deduped:true` + existing id. Both REST (201) and MCP (`memory_save`) echo it.
- **`RememberResult` gains `consolidated: boolean`** (v1.2, additive): the 201
  body is `{id, sessionId, project, concepts, deduped, consolidated}` —
  `consolidated:true` means this save merged into an existing near-duplicate
  survivor (see tier-1 below) and NO new row was created; `id` is the
  SURVIVOR's id, echoing the REQUEST's sessionId/concepts (dedup first-wins
  echo rule).
- **Tier-1 consolidation (v1.2, P1.2):** after the exact-dedup pre-check
  misses, `remember` probes `searchByText(content, k=20)` (project-scoped;
  probe ERRORS PROPAGATE — fail-closed, same posture as the dedup pre-check:
  a broken probe never lets a possible near-duplicate through) and merges:
  candidates with `Jaccard(tokenize(a), tokenize(b)) ≥
  AGENT_MEMORY_MERGE_JACCARD` qualify; the survivor is chosen deterministically
  (jaccard DESC → importance DESC → memoryId ASC, locale-free). The merge runs
  under the same per-key FIFO lock: content is CONCATENATED (never discarded —
  substring guard: if the incoming is already contained in the survivor the
  update is skipped entirely, which also closes the re-merge loop when someone
  later saves the concatenated text), `embedding` + `dedupKey` are rewritten to
  the merged content, the incoming's effective concepts (explicit wins, else
  derived) are re-linked FROM the survivor via `updateMemoryContent`, and NO
  Session node is created (dedup first-wins family — sessions materialize on
  novel writes only). Env `AGENT_MEMORY_MERGE_JACCARD`: ABSENT → 0.9 (ON),
  parseable in (0,1) → that threshold, everything else (≤0, ≥1, non-finite) →
  OFF fail-closed (no probe, straight to insert). probe4 proved on the live
  instance that `setProperty` refreshes BOTH the text and vector indexes
  (§0 fact).
  **Gate P1R-P32 declarations (v1.2; (a)+(b) rewritten to CLOSED by the
  v1.5 amendment):** (a) **CONCURRENCY — CLOSED 2026-09-24 (v1.5):** the
  dedup FIFO lock remains keyed by content hash (it serializes IDENTICAL
  content only), and consolidation NOW additionally serializes per
  SURVIVOR via `survivorTails` + the shared `withFifoLock`
  (`withSurvivorLock` front). LOCK ORDER — incoming dedupKey lock OUTER →
  survivor lock INNER; one survivor per merge (a call never holds two
  survivor locks) and no path acquires a dedupKey lock while holding a
  survivor lock → fixed acyclic order, no cycle. Under the survivor lock
  the merge re-reads the row FRESH via `getMemoryById` — it works against
  the row as it is NOW (a waiter's probe snapshot may be stale), the fresh
  read re-runs `filterExpired` (expired-while-waiting → returns undefined
  → plain insert, never absorbs), and it fails closed on vanished /
  wrong-id / non-string-content reads. Scope: SAME-PROCESS writers (the
  single-writer contract) — this closes the in-process lost-append only;
  cross-process writers to one Helix instance REMAIN out of contract until
  P4.3. (b) **ATOMICITY — CLOSED 2026-09-24 (v1.5):** the merge is still
  ONE `writeBatch`, but its commit is no longer blindly trusted — a
  post-write verify runs UNDER the survivor lock (no same-process writer
  can interleave between write and verify): the re-read asserts `content`
  === the merged content, `dedupKey` === `contentHash(project,
  normalize(content))`, and every effective concept linked
  (`missingConcepts`, exact-name set difference). A violation → ONE heal
  (content/dedupKey drift → full `updateMemoryContent` retry; links-only
  → `linkMemoryConcepts` link-only), then re-verify; still wrong → throw
  NAMING the violated invariant (fail closed). The substring-guard path
  no longer returns blind: it runs the same concept-link verify + heal
  while keeping content byte-identical (a re-save carrying NEW explicit
  concepts links them without re-appending). `RememberResult` echo
  semantics unchanged. The write remains ONE Helix `writeBatch` whose
  commit is DETECTED-and-healed app-side, not engine-guaranteed
  (re-verify on Helix upgrade). **CLOSED scope (gate RL001-F01 /
  COND-RF-01):** CLOSED covers exactly `content` + `dedupKey` + concept
  links — the batch's `embedding` write is NOT part of the verify, so a
  mid-batch partial commit that lands those three but drops the embedding
  refresh passes every invariant while the vector index keeps serving the
  pre-merge embedding. **Named residual** (owner: engineering; expiry
  **≤ 2026-12-31 or next Helix engine upgrade**, whichever first; ledger
  row `F-01-EMB` in `ROADMAP.md` §1.3); (c) **TTL×MERGE** — probe candidates run
  through `filterExpired` first, so a TTL-expired survivor can never absorb
  a fresh write (TTL unset → no-op); (d) **PROVENANCE** — WHICH rows merged
  is not durably recorded (first-wins family; every variant's text survives
  inside the survivor's concatenated content); (e) **INDEX DEPENDENCY** — the
  probe needs the text index: run `bootstrap` first; writes fail closed while
  an index is missing.
- **Crash-window carve-out (gate RL001-F01 / COND-RK-01, declared
  2026-09-24):** a process crash between the merge write and the post-write
  verify leaves a links-partial commit that heals only LAZILY — the next
  guard-path save of that survivor re-runs `ensureConceptLinks`; there is no
  journal and no scheduled repair. Owner: engineering; trigger/expiry =
  **next Helix engine upgrade or P4.3**, whichever first.
- **Lock-queue wait envelope (gate RL001-F01 / COND-RS-02, dated
  declaration 2026-09-24):** the nested FIFO locks (incoming dedupKey OUTER →
  survivor INNER) have **no queue cap and no server-side request deadline**;
  each individual send is bounded by a 15 s `withTimeout`, so the round-trip
  envelope is **6 sends happy / ≤11 sequential sends worst-heal / ≤165 s at
  the per-send cap**, held under the locks (happy-path in-lock hold grew ~2×,
  worst-path ~3–4× vs pre-RL-001). Hooks/plugin stay insulated (1.5 s
  detached / exit 0 — the agent never blocks); blast radius = REST/MCP
  callers only. Owner: engineering; trigger = **P4.3 multi-instance OR first
  observed retry storm**. A code fix (queue cap / request deadline) is a
  SEPARATE proposal lane, not implicit in this declaration (source: gate
  automation AU-002 round-trip table; security SEC-F01 deferred to the same
  trigger). Ledger row `RL-001-QUEUE` in `ROADMAP.md` §1.3.
- **Heal observability + operator runbook (gate RL001-F01 / COND-RK-02,
  2026-09-24):** every CONFIRMED heal emits ONE allowlisted single-line log
  entry on **stderr** — `heal survivor=<memoryId> links=<n>` (link-only heal,
  emitted after the confirming re-read) or `heal survivor=<memoryId>
  invariants=content,dedupKey|links` (full-write heal, emitted after the
  confirming re-verify) — memoryId + count/family tokens ONLY: never content,
  never embedding, never concept names (SEC-F02), collapsed to one line
  (`oneLine`, CWE-117); **stderr because stdout is the MCP protocol channel**
  (`src/mcp.ts`), and both streams are covered by the §3 governance-log
  declaration above. **Operator runbook:** on `-> 500: Error: REQ-F-01:` /
  `REQ-RL-001:` in the log — it means FAIL-CLOSED (the merge/write was NOT
  reported as success; nothing silently succeeded); what to do: a RETRY is
  safe and converges (substring guard → `ensureConceptLinks` on the guard
  path; the full-write path re-verifies and heals once), escalate if it
  repeats; how to find: `grep "REQ-F-01:\|REQ-RL-001:"` (failures) and
  `grep "heal survivor="` (successful heals) on the server's stderr.
- **Derived recall confidence (v1.2, P1.4, ranking-time):** both search paths
  call `noteRecall(memoryId)` for every RETURNED row; the fused tie-break (see
  fusion paragraph below) uses `confidenceBoost(decayedImportance(…),
  recallCount)` — decay FIRST, then `boost = clamp01(i + 0.2·n/(n+1))` over an
  in-process recall ledger (Map, cap 10 000 entries — cleared on overflow,
  best-effort, PER-PROCESS: counts reset on restart and are not shared across
  writers). Stored/`importance` shown to callers is never rewritten — ranking
  inputs (decay + boost) influence ORDER only.
- **Decay (P1.1 corte A):** the fused-row tie-break uses the DECAYED importance
  `importance · e^(−λ · ageDays)` (`decayedImportance`, λ from
  `AGENT_MEMORY_DECAY_LAMBDA`, per-day rate; absent/invalid/≤0 → factor 1 = OFF).
  The row's `importance` field stays the STORED value — decay is ranking-only.
  The stored `createdAt` drives `ageDays`; unparseable → factor 1.
- **TTL filter (P1.1 corte A):** both searches drop rows older than
  `AGENT_MEMORY_TTL_DAYS` (absent/invalid/≤0 → OFF; expire strictly when
  `ageDays > ttlDays`; unparseable `createdAt` → kept) and append
  `signals: ["ttl: hidden N expired rows"]` when N>0 — explicit degradation, not
  silent thinning. No over-fetch buffer (opt-in feature; results may thin below limit).
- **Purge (P1.1 corte A):** `scripts/purge.ts`, Helix-direct (`HELIX_URL`), fail-closed:
  requires `--days N` (integer ≥1) AND (`--project P` OR `--all`), optional `--dry-run`.
  It pages `listExpired` (batches of 500, `$id Asc`) and calls `forgetMemory` per id —
  never a multi-drop (unverified). `--all` discovers projects via `listProjects`
  (Session walk) and still runs the project-scoped `listExpired` per project. Output
  is a strict allowlist — plan line, dry-run count+ids, per-batch progress
  (`purge-progress project=<p> batch=<n> deleted=<m>`), one governance line
  `purge project=<p|all> days=<n> deleted=<m> at=<iso>`, healthCount before/after —
  plus, on a FAILED run that already confirmed deletions, that same governance
  line emitted BEFORE exit 1 with a fixed `status=partial` discriminator (project,
  days, deleted-so-far, at; completed work never escapes the audit trail). Every
  interpolated value is collapsed to a single line first (CWE-117 guard, same
  transform as the `reason` collapse below — print-site only; query values stay
  verbatim), and content is never printed. Exit codes: 0 success, 1 operational
  failure, 2 usage error (usage errors exit before any deletion can exist).
  Accepted risk, no timeout (RL-002): the Helix SDK documents no Client/transport
  timeout and no AbortSignal option, so a hung Helix stalls the run —
  compensating controls = bounded batches (MAX_BATCHES + no-progress guard) +
  per-batch progress output + operator Ctrl-C; residual risk accepted, owner:
  engineering.
- **Concept-retention declaration (v1.4, DAT-001 — Ley 172-13 shape: purpose + TTL +
  deletion procedure):**
  1. **Purpose:** `Concept {name, project}` is shared search vocabulary for the
     graph branch of hybrid fusion — top-8 tf-ranked derived terms
     (stopword/length-filtered, `extractConcepts`) or caller-supplied labels. The
     node carries ONLY name+project — no content, no sessionId.
  2. **PII posture:** derived terms are filtered tokens; PII scan 0/0 at gate
     P1R-P32 (cited acceptance W-3). Caller-supplied concept labels are stored
     verbatim and are the CALLER's responsibility — same rule as content.
  3. **TTL: none — declared intentional, not an oversight.** Names are globally
     unique shared vocabulary (§1 index #3 `nodeUniqueEquality("Concept","name")`);
     retention is bounded by distinct-term cardinality (dedup on write), not row
     growth. A per-memory drop is NOT implemented because the name may be
     referenced by other memories/projects.
  4. **Deletion procedure (the two halves):**
     a. Per-memory: `forget`/`delete`/`purge` remove the Memory + its
        `HAS_CONCEPT` edges + content; shared names REMAIN by design while any
        other memory references them.
     b. **Orphan cleanup (operator-run, manual — no scheduler in v0.6.0, declared
        as such):** orphan = Concept with ZERO incoming `HAS_CONCEPT` edges,
        evaluated GLOBALLY (name uniqueness is global, so any project's memory
        keeps it live). Three steps, all VERBATIM from the verified run (Helix
        `dev` @ http://localhost:6969, storage=disk; baseline 189/128/61 → dropped
        EXACTLY ONE gated orphan `{"$id": 40014, "name": "2026", "project":
        "verify-p2-live"}` → re-audit 188/128/60 — one removed, every other name
        unchanged, linked count unmoved; 1 write of a ≤2 budget; no instance
        lifecycle action; upstream port 3111 never touched — all verified live
        2026-09-23):
        - Audit (read-only): `helix query dev -e 'readBatch().varAs("all", g().nWithLabel("Concept").valueMap(["$id","name","project"])).varAs("linked", g().nWithLabel("Memory").out("HAS_CONCEPT").dedup().valueMap(["name"])).returning(["all","linked"])'` → orphans = all names minus linked names, computed CLIENT-side (varAs accepts traversals only).
        - Per-target zero-edge gate (read-only): `helix query dev -e 'readBatch().varAs("target", g().nWithLabel("Concept").has("name", "<name>").valueMap(["$id","name","project"])).varAs("in_edges", g().nWithLabel("Concept").has("name", "<name>").inE().count()).varAs("in_edges_labeled", g().nWithLabel("Concept").has("name", "<name>").inE("HAS_CONCEPT").count()).varAs("out_edges", g().nWithLabel("Concept").has("name", "<name>").outE().count()).returning(["target","in_edges","in_edges_labeled","out_edges"])'` → proceed ONLY if exactly one node matches AND `in_edges == 0` AND `out_edges == 0` (no edge collateral).
        - Drop (write): `helix query dev -e 'writeBatch().varAs("dropped", g().nWithLabel("Concept").has("name", "<name>").drop()).returning(["dropped"])'` → response `{"dropped": []}` is EXPECTED and non-informative; success is proven by RE-AUDIT (counts move by exactly −1, linked names unchanged) — never by the write response.
        - Runtime gotchas discovered live: the `helix query -e` scope has NO
          `Predicate` global (use `.has("name", ...)` for literals); `varAs`
          accepts traversals only.
  5. **Right-to-erasure posture (honest boundary):** an erasure request → forget
     removes content + edges; names then at zero edges are removable via (b); a
     name still referenced by other memories CANNOT be dropped without breaking
     those rows — that is the declared boundary, accepted as non-PII derived
     tokens (W-3).
  6. Closes ROADMAP §1.3 DAT-001 at its `2026-12-31 or v0.6.0` trigger. Owner:
     engineering (procedure re-run on demand).

P3.1 composition rules: `recap` renders one bullet per memory
(`- [sessionId] createdAt (origin): content`) for the given session, or for every
session of the project when `sessionId` is absent; `handoff` prefixes those bullets
with a `project=… memories=… sessions=… recent:` header from `healthCounts`. Both
wrap every store call individually — a failed call lands in `signals` and the
partial text still returns 200 (never a 500, same degradation rule as §3 fusion).
`lesson` is `remember` with `origin` forced to `"lesson"`. `delete` is `forget`
plus a required caller-supplied `reason`, logged as one governance line
(`memoryId`, `reason`, `at`) — reason is metadata, never memory content and never
the secret; the access log stays method/path/status/duration only.

Governance-log data declaration: **purpose** = operational audit of destructive
deletes (the only permitted use of `reason`); **store** = process stdout/stderr
only — this repository keeps no durable store for it; **retention** = host log
retention/rotation; **deletion** = log rotation or process exit. **Masking /
minimization (SEC-002 control 1):** the governance line's fields are a strict
**ALLOWLIST** — only `memoryId`, the normalized `reason` (collapsed to a single
line, ≤1000 chars), and `at` are ever emitted; no other memory content, no
embedding, and no request header ever reaches the line (the line is rendered by
hand from those three values on both lanes, `src/server.ts`/`src/mcp.ts`, never
by stringifying a stored object). Operators must not place PII or secrets in
`reason` — that is the caller's responsibility, bounded by the required
`reason` schema and gated by bearer auth (`AGENT_MEMORY_SECRET`) on every
governance route — and hosts should apply their standard log masking/retention
to the stdout/stderr stream carrying these lines. Receipt semantics:
`deletedAt` is the server time captured immediately after the store
confirms the delete, and the receipt `{memoryId, deletedAt}` omits `reason` BY
DESIGN — the reason lives only in the governance log line above.

Result row shape (both searches): `{id, memoryId, content, score, sessionId, origin,
importance, createdAt, source}` — plus `distance` (cosine, lower = closer) on
vector-sourced rows, which are projected as `$distance` rather than `$score`, so a
raw vector hit's `score` is `0` until RRF assigns one. `source` is
`"vector" | "text" | "graph"` on `smart-search`; fused rows add `signals: string[]`.

**Hybrid fusion = Reciprocal Rank Fusion in the app layer** (`src/search.ts`):
run `searchByVector`, `searchByText`, `graphSearch` (when `concepts` present),
then `score = Σ 1/(60 + rank_i)` per document, sort desc, tie-break by DECAYED
importance (v1.1: `importance · e^(−λ·ageDays)`, see above — λ=0/off means plain
`importance`) and then RECALL-BOOSTED (v1.2: `confidenceBoost(…, recallCount)`
applied AFTER decay, see the v1.2 bullets — one fixed clock + one ledger read
per search), then `createdAt`, then `memoryId`. TTL filtering runs on both
search paths before return. Each upstream failure is caught and recorded in
`signals` — a degraded search returns results with whatever sources succeeded,
never a 500.

**Auth:** when `AGENT_MEMORY_SECRET` is set, every `/memory/*` route except
`livez` requires `Authorization: Bearer <secret>`; mismatch → 401, no secret →
localhost open (matches upstream default). No secret value ever logged.

**Bootstrap retry:** `scripts/bootstrap.ts` creates indexes then polls
`searchByText` until `index_not_found` clears (2s interval, ~30s cap) so first-run
searches do not 500.

MCP (`src/mcp.ts`) over **stdio**, official `@modelcontextprotocol/sdk`, 11 tools:
`memory_save`, `memory_search`, `memory_smart_search`, `memory_sessions`,
`memory_session_memories`, `memory_forget`, `memory_health`, `memory_recap`,
`memory_handoff`, `memory_lesson`, `memory_delete`. Same `MemoryStore`
instance as REST. Same bearer auth when `AGENT_MEMORY_SECRET` is set. The four
P3.1 tools mirror the REST bodies/response shapes above.

Hooks (`hooks/capture.mjs`) — plain Node ESM, no deps. Reads hook JSON on stdin,
event name from `argv[2]`. Supported (**7**, v1.1): `SessionStart`, `PostToolUse`,
`Stop`, `PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`.
POSTs one observation to `/memory/remember` with `origin="hook:<event>"`.
Never prints memory content or the secret. Exit 0 always (a dead memory server must
never block the coding agent). `AGENT_MEMORY_URL` defaults to `http://127.0.0.1:3111`
(the REST service, matching `src/server.ts`).

**Per-event content allowlist (v1.3, P2.1 + P2.2):** fixed strings only, except the two
tool events which carry the tool NAME (≤80 chars) and nothing else —

| Event | `content` stored |
|---|---|
| `SessionStart` | `agent session started` |
| `PostToolUse` | `tool used: <tool>` — or `file edited via <tool>` when the tool name matches edit/write/patch/apply/replace (P2.2, name only); `AGENT_MEMORY_CAPTURE_PATHS=basename` opt-in appends `: <basename>` (basename ≤80, no dirs; default OFF, full paths never stored) |
| `Stop` | `agent session stopped` |
| `PostToolUseFailure` | `tool failed: <tool>` |
| `PreCompact` | `context compaction requested` |
| `SessionEnd` | `agent session ended` |
| `UserPromptSubmit` | `user prompt submitted` |

`UserPromptSubmit` **never reads the prompt text** (user PII, Ley 172-13);
`PreCompact` never reads trigger/payload; an unlisted event or a missing
`tool_name` stores NOTHING (fail closed). Project/sessionId still derive from the
host payload as for every event.

> **Correction (Lane A found this):** an earlier draft of this contract said the
> hook should default to `:6969`. That is wrong — `6969` is the raw Helix
> instance, which serves no `/memory/*` route, so a POST there could never
> store anything. `3111` is the REST service port.

**Port conflict (environment fact, verified):** `3111/3112/3113` may already be held
by the real upstream `agentmemory` (npx → `node …/bin/agentmemory` → `iii`). This
repo keeps `3111` as its default for drop-in parity, but when upstream is running,
start ours elsewhere (`AGENT_MEMORY_PORT=3151`) and point clients at it
(`AGENT_MEMORY_URL=http://127.0.0.1:3151`). Never kill the user's upstream instance.

Hook privacy + project rules (verified): content is only ever one of the
allowlisted shapes above (`agent session started`, `tool used: <tool>`,
`file edited via <tool>[: <basename>]`, …) — hook payloads, full file paths,
command output, and the user's prompt text are never captured by default
(basename only under the explicit `AGENT_MEMORY_CAPTURE_PATHS=basename`
opt-in).
`project` derives from the workspace directory name, overridable via
`AGENT_MEMORY_PROJECT`.

**OpenCode plugin hooks (v1.3, P2.1 + P2.2):** 5 registrations — `prompt`, `context`,
`compaction`, `tool.execute.after` (cache invalidation on completed
memory_save/forget + P2.2 failure observation `tool failed: <tool>`
`origin="hook:tool.execute.after"` on non-completed runs, memory* skipped),
plus `tool.execute.before`: fire-and-forget observation `tool started: <tool>`
(`origin="hook:tool.execute.before"`, `AUTO_TIMEOUT_MS` 1.5s detached, every
rejection swallowed, sync throw caught so the hook can never abort the turn; own
`memory*` tools skipped — no self-observation loop; `event.input` never read —
tool NAME only). Exported as `captureToolStart(cfg, toolName, sessionID)` and
`captureToolFailure(cfg, toolName, sessionID)` for
`scripts/verify-capture.ts`.

`src/demo.ts` — seeds 3 realistic sessions (JWT auth in `src/middleware/auth.ts`,
N+1 query fix, rate limiting) then runs keyword + semantic searches and prints hits.

## 4. Out of scope for v1 (do not build)

~~Decay~~ (added v1.1 corte A: read-time decay + TTL + `purge.ts`),
~~tier-1 near-duplicate consolidation~~ (added v1.2: `AGENT_MEMORY_MERGE_JACCARD`
merge — tiers 2–4 of upstream's consolidation, LLM auto-compress, viewer UI,
Replay, 20 agent adapters, full 54-tool MCP surface remain out; P2.3 transcript
import and P2.4 session summarization are IN as of v1.3, script-only with no new
routes).

## 5. Verification bar

`npm run typecheck` clean. `scripts/bootstrap.ts` green (**8 indexes**).
`scripts/verify-lifecycle.ts` green (**117 passed** — pure: dedupKey/hash golden,
decay math incl. half-life, TTL filter, concept determinism, `oneLine` CWE-117
render guard, **§F derived confidence** (deriveWriteImportance goldens,
confidenceBoost monotonic/clamp, recall ledger), **§F-bis** the decay-THEN-boost
order golden (λ on: equals the hand-computed decay+boost AND differs from the
wrong order — gate CE-002), **§G consolidation**
(jaccard/threshold-fail-closed/substring guard + `missingConcepts` goldens:
order-independence over shuffled input, dedup, exact-name/case-sensitive
match, no substring match, empty-set cases), **§H** hand-computed eval
metric goldens (R@5/R@10/MRR/nDCG/aggregate — gate CE-001/COND-QA-01),
**§I** fail-closed near-dupe probe (induced probe error → `remember` rejects,
insert never runs) + TTL×expired-survivor guard + **§I guard-path heal seam**
(guard path heals missing concept links offline — `consolidated=true`, 5
sends, NO insert) + **§I-c heal-seam trio + RK-02 envelope assert** (gate
RL001-F01, +4: expired-while-waiting → plain insert, 3 sends; fresh-read miss
→ stale links → merge-path `verifyMergedState` retryWrite variant, 8 sends;
post-heal still-violated → named `REQ-F-01 … invariant(s) violated` throw,
8 sends; heal response envelope `resolved/rejected/timeout`, no raw message)
+ plugin no-default source checks — gate COND-QA-03 /
RL-002 / COND-QA-02b / RL001-F01 COND-RF-03 + COND-RK-02).
`scripts/verify-capture.ts` green (**137 checks** — 7 events × payload/exit-0/
silence, privacy canary, negatives, dead server, plugin helpers, **§F P2.2**
file-edit marker + basename opt-in (default OFF) + path-bearing tool-name
fail-closed + plugin failure/start helpers never-throw on non-string tools).
`scripts/verify.ts` end-to-end green (**243 passed**): health → remember (with
concepts) → bm25 search hits → smart-search hits → sessions list → session
memories → forget → gone → `healthCount()` reflects it → lesson (201) → bm25
search hits it → recap contains it → handoff contains it → governed delete (with
reason) → gone → second delete 404 → `healthCount()` reflects it → derived
default concepts ≤8 → graph-branch proof (fused score == 3/61) → dedup
round-trip (same id, `deduped:true`, cross-project distinct, race → same id) →
dedup × hook first-wins (F4) → **§O derived confidence** (importance without a
caller value == `deriveWriteImportance(origin, echoedConcepts.length)`, explicit
wins, recall-lift ordering via the ledger; ledger/tie ordering runs the REAL
search path in-process against a stub store — CE-003) + **MCP adapter
pass-through** (`InMemoryTransport`: save without `importance` → the store sees
`undefined`, explicit value wins — gate COND-QA-02) → **§P consolidation** (3
variants → 1 row with `consolidated:true`, each variant's wording recalls the
survivor, healthCount +1, re-save of the merged text → exact-dedup loop guard;
v1.5 additions: **§P `rl-001:` block — 13 checks** (3 CONCURRENT distinct
variants → SAME survivor, all three wordings present, no lost append) and the
**§P `f-01:` heal block** — heal E2E: graph-branch fused score = control +
1/61 proves the healed link, survivor content byte-identical after the
guard-path heal). **Session-node run budget (gate RL001-F01 / COND-RK-01,
COND-DAT-002-style, declared 2026-09-24):** each run mints fresh uuid session
ids and every novel-write session materializes a `Session` node — the memory
ROWS self-clean via `forget` at test end, but **no Session deletion path
exists** (`forgetMemory` drops Memory only), so every run leaves **+17
Session nodes** (measured 2026-09-24 across two consecutive runs: 490 → 507 →
524; consolidation/dedup sessions materialize none). Accumulation is
unbounded on the dev instance until reset. Accepted residual: owner
**engineering**; trigger/expiry = **P4.1 session-deletion work or 2026-12-31**,
whichever first — until then the operator resets the dev instance (or prunes
the `verify*` projects' sessions once a deletion path exists) when hygiene
matters. Count source: `scripts/verify.ts`. Mirrored as ledger row
`VERIFY-SESSION-NODES` in `ROADMAP.md` §1.3.
`scripts/verify-skills.ts` green (**119 checks**: 73 structural across the 8
`skills/*/SKILL.md` — also runnable server-free as `verify-skills --structural`
and CI-wired — + 46 live round-trips: every skill's frozen route exercised
under project `verify-skills` behind the `verify.ts` identity guard). Rows are
cleaned per run (4/4); the +4 `Session` nodes per run persist (3 random sids +
1 governance save — count source `scripts/verify-skills.ts`) and no Session
deletion path exists: **run budget = 25 runs** (≈100 Session nodes) before the
operator resets the `verify-skills` project or the dev instance — accepted
residual, owner engineering, re-review at P4.1 (gate P1R-P32 / COND-DAT-002).
`scripts/probe4.ts` GREEN (**12 passed** — live proof that
`updateMemoryContent`'s `setProperty` refreshes BOTH text and vector indexes:
verdict A).
`scripts/eval.ts` (**EVAL PASS**) seeds the in-repo corpus (`eval/corpus.ts`,
40 docs / 15 queries, project `agent-memory-eval`) and writes our own numbers
(R@5 / R@10 / MRR@10 / nDCG@10, bm25 + hybrid) to
`docs/benchmarks/SCORECARD.md` — upstream's published numbers are never
claimed. Metric math is regression-tested by the §H goldens; scores are
corpus-specific (the in-repo corpus yields all-rank-1 — disclaimed on the
scorecard's face), not a general retrieval claim. The `agent-memory-eval`
rows are benchmark fixtures: purpose scoring, deletion `purge.ts`/`forget`,
retention until manually purged (declared — DAT-003).
`scripts/verify-injection.ts` (**73**), `scripts/verify-env.ts` (**21**) green.
`scripts/probe3.ts` GREEN. `scripts/purge.ts --dry-run` + usage guard exit 2.
Demo green.
