# agent-memory — v1 Frozen Contract

Source of truth for both build lanes. Reference-only packet: implement against this,
report deviations, do not rename exports or routes.

Status: every construct in §1 and §3 was empirically verified against the running
instance at `http://localhost:6969` (see `scripts/probe.ts`, `scripts/probe2.ts`).

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

Never restart or stop the dev instance. It runs with `storage: memory`.

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
  `origin` (string), `importance` (f64, 0..1), `createdAt` (dateTime), `embedding` (f32[384])
- `Concept`: `name` (string, unique), `project` (string)

`project` is the tenant/scope value for every vector and text index. Search routes
always pass it.

## 2. `db/queries.ts` exports (frozen names)

```ts
export const LABELS, EDGES, EMBED_DIM

bootstrapIndexes(): WriteBatch        // no params, all 7 indexes below
saveMemory():      WriteBatch         // §3
listSessions():    ReadBatch          // params: project (string), limit (i64)
sessionMemories(): ReadBatch          // params: sessionId (string), project (string), limit (i64)
searchByVector():  ReadBatch          // params: queryVector (array f32), project (string), k (i64)
searchByText():    ReadBatch          // params: q (string), project (string), k (i64)
graphSearch():     ReadBatch          // params: concepts (array string), project (string), k (i64)
forgetMemory():    WriteBatch         // params: memoryId (string)
healthCount():     ReadBatch          // params: project (string)  -> memory/session counts
```

Indexes from `bootstrapIndexes()` (all `createIndexIfNotExists`):

1. `nodeUniqueEquality("Memory", "memoryId")`
2. `nodeUniqueEquality("Session", "sessionId")`
3. `nodeUniqueEquality("Concept", "name")`
4. `nodeEquality("Memory", "sessionId")`
5. `nodeEquality("Memory", "project")`
6. `nodeVector("Memory", "embedding", 384, VectorDistanceMetric.Cosine, "project")`
7. `nodeText("Memory", "content", "project")`

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

REST (`src/server.ts`), all under `/agentmemory`, JSON in/out:

| Method | Route | Body / query | Success |
|---|---|---|---|
| GET | `/agentmemory/livez` | — | 200 `{"status":"ok"}` |
| GET | `/agentmemory/health` | — | 200 `{"status":"ok","counts":{…}}` |
| POST | `/agentmemory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts}` |
| POST | `/agentmemory/search` | `{query, project?, limit?}` | 200 `{mode:"bm25", results:[…]}` |
| POST | `/agentmemory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[…]}` |
| GET | `/agentmemory/sessions` | `?project=&limit=` | 200 `{sessions:[…]}` |
| GET | `/agentmemory/sessions/:sessionId/memories` | `?project=&limit=` | 200 `{memories:[…]}` |
| POST | `/agentmemory/forget` | `{memoryId}` | 200 `{forgotten:true}` / 404 |
| POST | `/agentmemory/recap` | `{project?, sessionId?, limit?}` | 200 `{recap, sessionId, count, signals}` |
| POST | `/agentmemory/handoff` | `{project?, sessionId?, limit?}` | 200 `{handoff, sessionId, counts, signals}` |
| POST | `/agentmemory/lesson` | `{content, concepts?, project?, sessionId?, importance?}` (no `origin`) | 201 `{id, sessionId, project, concepts}` |
| POST | `/agentmemory/delete` | `{memoryId, reason}` (`reason` required, 1..1000) | 200 `{deleted:true, receipt:{memoryId, deletedAt}}` / 404 |

Defaults: `project="default"`, `sessionId` auto-generated (`crypto.randomUUID()`) when
absent, `limit=10`, `importance=0.5`, `origin="rest"`.

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

Result row shape (both searches): `{id, memoryId, content, score, sessionId, origin,
importance, createdAt, source}` — plus `distance` (cosine, lower = closer) on
vector-sourced rows, which are projected as `$distance` rather than `$score`, so a
raw vector hit's `score` is `0` until RRF assigns one. `source` is
`"vector" | "text" | "graph"` on `smart-search`; fused rows add `signals: string[]`.

**Hybrid fusion = Reciprocal Rank Fusion in the app layer** (`src/search.ts`):
run `searchByVector`, `searchByText`, `graphSearch` (when `concepts` present),
then `score = Σ 1/(60 + rank_i)` per document, sort desc, tie-break by `importance`
then `createdAt`. Each upstream failure is caught and recorded in `signals` — a
degraded search returns results with whatever sources succeeded, never a 500.

**Auth:** when `AGENT_MEMORY_SECRET` is set, every `/agentmemory/*` route except
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
event name from `argv[2]`. Supported: `SessionStart`, `PostToolUse`, `Stop`.
POSTs one observation to `/agentmemory/remember` with `origin="hook:<event>"`.
Never prints memory content or the secret. Exit 0 always (a dead memory server must
never block the coding agent). `AGENT_MEMORY_URL` defaults to `http://127.0.0.1:3111`
(the REST service, matching `src/server.ts`).

> **Correction (Lane A found this):** an earlier draft of this contract said the
> hook should default to `:6969`. That is wrong — `6969` is the raw Helix
> instance, which serves no `/agentmemory/*` route, so a POST there could never
> store anything. `3111` is the REST service port.

**Port conflict (environment fact, verified):** `3111/3112/3113` may already be held
by the real upstream `agentmemory` (npx → `node …/bin/agentmemory` → `iii`). This
repo keeps `3111` as its default for drop-in parity, but when upstream is running,
start ours elsewhere (`AGENT_MEMORY_PORT=3151`) and point clients at it
(`AGENT_MEMORY_URL=http://127.0.0.1:3151`). Never kill the user's upstream instance.

Hook privacy + project rules (verified): content is only ever `tool used: <tool>`,
`agent session started`, or `agent session stopped` — hook payloads, file paths and
command output are never captured. `project` derives from the workspace directory
name, overridable via `AGENT_MEMORY_PROJECT`.

`src/demo.ts` — seeds 3 realistic sessions (JWT auth in `src/middleware/auth.ts`,
N+1 query fix, rate limiting) then runs keyword + semantic searches and prints hits.

## 4. Out of scope for v1 (do not build)

Decay, 4-tier consolidation, LLM auto-compress, viewer UI, Replay, JSONL import,
20 agent adapters, full 54-tool MCP surface.

## 5. Verification bar

`npm run typecheck` clean. `scripts/bootstrap.ts` green. `scripts/verify.ts`
end-to-end green: health → remember (with concepts) → bm25 search hits →
smart-search hits → sessions list → session memories → forget → gone →
`healthCount()` reflects it → lesson (201) → bm25 search hits it → recap
contains it → handoff contains it → governed delete (with reason) → gone →
second delete 404 → `healthCount()` reflects it. Demo green.
