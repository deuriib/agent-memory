# agent-memory

[![Version](https://img.shields.io/badge/version-v0.2.0-blue.svg)](CHANGELOG.md)

Persistent memory for AI coding agents — a v1 replica of
[rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) rebuilt on
[HelixDB](https://docs.helix-db.com) instead of iii-engine + SQLite. One engine
provides **graph + vector + full-text (BM25) + temporal** storage with
traversal-scoped prefiltering, so hybrid retrieval (vector, keyword, concept
graph) lives in a single query layer — no external search service, no API keys,
no model downloads. It ships a dependency-light REST server, a stdio MCP server
with 11 tools, and a zero-dependency capture hook, all backed by the same store.

The frozen spec this repo implements is [`docs/CONTRACT.md`](docs/CONTRACT.md).

## How it works

### Data model

Three node labels, two edge types (CONTRACT §1):

```
Session  sessionId (unique), project, startedAt, updatedAt
Memory   memoryId (unique), content, project, sessionId, origin,
         importance (0..1), createdAt, embedding (f32[384])
Concept  name (unique), project

BELONGS_TO   Memory ──▶ Session
HAS_CONCEPT  Memory ──▶ Concept
```

- **`Memory.embedding`** — 384-dim vector, cosine distance, indexed with
  `project` as the tenant key.
- **`Memory.content`** — BM25 full-text index, also scoped by `project`.
- **`project`** is the tenant/scope for every vector and text index; search
  routes always pass it.

`bootstrapIndexes()` ensures all 7 indexes: 3 unique (`Memory.memoryId`,
`Session.sessionId`, `Concept.name`), 2 equality (`Memory.sessionId`,
`Memory.project`), 1 vector (`Memory.embedding`, 384-dim cosine, tenant
`project`), 1 text (`Memory.content`, tenant `project`).

Writes anchor narrow: `saveMemory()` is a single `writeBatch` that upserts the
Session (create or bump `updatedAt`), creates the Memory, links `BELONGS_TO`,
then upserts each Concept and links `HAS_CONCEPT` — an empty `concepts` array is
safe.

### Retrieval

`POST /agentmemory/smart-search` runs up to three independent sources:

1. **vector** — query embedded to 384 dims, `vectorSearchWith` prefiltered by
   `project`,
2. **text** — BM25 `textSearchWith` on `content`, scoped by `project`,
3. **graph** — only when `concepts` are provided: `Concept` where `name` in
   `concepts` → `.in("HAS_CONCEPT")` → `Memory`, scoped by `project`.

They are fused in the app layer (`src/search.ts`) with **Reciprocal Rank
Fusion**:

```
score(doc) = Σ 1 / (60 + rank_i)      over every source that returned it
```

Ranks are 1-based. Ties break by `importance` (desc), then `createdAt` (desc,
newest first), then `memoryId` (asc) so output is fully deterministic.

Failures degrade instead of exploding: each source runs independently, a source
error is caught and recorded in a `signals` list, and the remaining sources
still contribute rows. Even an all-sources-down search returns **200** with
empty `results` + `signals` — never a 500. `POST /agentmemory/search` is the
BM25-only path with the same degradation rule.

## Quick start

Requires **Node 20+** and a running Helix dev instance (Docker/Podman):

```bash
helix start dev --disk --persist   # durable default: persists storage mode into helix.toml

npm install
npm run bootstrap               # create the 7 indexes, poll until ready
npm run demo                    # seed 3 sessions, run keyword/semantic/hybrid searches
npm run dev                     # REST server on http://127.0.0.1:3111
npm run verify                  # end-to-end verification against the running server
```

`--disk --persist` writes the storage mode into `helix.toml`, so a plain
`helix start dev` afterwards keeps data across restarts. **Without `--disk`
the instance is in-memory and every restart wipes it.**

Scripts (from `package.json`): `bootstrap`, `dev`, `demo`, `verify`,
`typecheck`.

## REST API

All routes live under `/agentmemory`, JSON in/out. If `AGENT_MEMORY_SECRET` is
set, add `-H "Authorization: Bearer $AGENT_MEMORY_SECRET"` to every call except
`livez` (see [Authentication](#authentication)).

| Method | Route | Body / query | Success |
|---|---|---|---|
| GET | `/agentmemory/livez` | — | 200 `{"status":"ok"}` |
| GET | `/agentmemory/health` | `?project=` | 200 `{"status":"ok","counts":{…}}` |
| POST | `/agentmemory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts}` |
| POST | `/agentmemory/search` | `{query, project?, limit?}` | 200 `{mode:"bm25", results:[…], signals:[…]}` |
| POST | `/agentmemory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[…], signals:[…]}` |
| GET | `/agentmemory/sessions` | `?project=&limit=` | 200 `{sessions:[…]}` |
| GET | `/agentmemory/sessions/:sessionId/memories` | `?project=&limit=` | 200 `{memories:[…]}` |
| POST | `/agentmemory/forget` | `{memoryId}` | 200 `{forgotten:true}` / 404 |
| POST | `/agentmemory/recap` | `{project?, sessionId?, limit?}` | 200 `{recap, sessionId, count, signals}` |
| POST | `/agentmemory/handoff` | `{project?, sessionId?, limit?}` | 200 `{handoff, sessionId, counts, signals}` |
| POST | `/agentmemory/lesson` | `{content, concepts?, project?, sessionId?, importance?}` (no `origin`) | 201 `{id, sessionId, project, concepts}` |
| POST | `/agentmemory/delete` | `{memoryId, reason}` (`reason` required) | 200 `{deleted:true, receipt:{memoryId, deletedAt}}` / 404 |

Defaults: `project="default"`, `limit=10`, `importance=0.5`, `origin="rest"`,
`sessionId` auto-generated (`crypto.randomUUID()`) when absent. Every REST
body is a strict zod object: **unknown keys are rejected with 400** — so
`lesson` never accepts `origin` (sending it → 400; the row is always stored
with `origin="lesson"`) and `delete` requires `reason`. MCP input schemas are
SDK-mediated instead: unknown keys are **stripped, not rejected**, and `origin`
is server-forced either way (`memory_lesson` stores `origin="lesson"` no
matter what the caller sends).

### Examples

```bash
# liveness
curl -s http://127.0.0.1:3111/agentmemory/livez
# {"status":"ok"}

# health with counts
curl -s 'http://127.0.0.1:3111/agentmemory/health?project=readme'
# {"status":"ok","counts":{"memories":2,"sessions":1}}
```

**remember** — real captured request/response:

```bash
curl -s -X POST http://127.0.0.1:3111/agentmemory/remember \
  -H 'content-type: application/json' \
  -d '{
    "content": "Implemented JWT auth in src/middleware/auth.ts: HS256 signing, 15-minute expiry, httpOnly cookie on login.",
    "concepts": ["auth", "jwt"],
    "project": "readme",
    "sessionId": "readme-example"
  }'
# 201
# {"id":"0d850e3b-6ec5-49bb-bd94-42a1973912fa","sessionId":"readme-example","project":"readme","concepts":["auth","jwt"]}
```

**search** (BM25 only):

```bash
curl -s -X POST http://127.0.0.1:3111/agentmemory/search \
  -H 'content-type: application/json' \
  -d '{"query": "jwt token expiry", "project": "readme", "limit": 5}'
# {"mode":"bm25","results":[{"id":"…","memoryId":"…","content":"…","score":2.54,…,"source":"text","signals":[]}],"signals":[]}
```

**smart-search** (hybrid RRF) — real captured request/response:

```bash
curl -s -X POST http://127.0.0.1:3111/agentmemory/smart-search \
  -H 'content-type: application/json' \
  -d '{"query":"dashboard query latency","concepts":["performance"],"project":"readme","limit":5}'
# 200
# {"mode":"hybrid","results":[
#   {"id":"109","memoryId":"0a6b1c4f-bf37-4586-9477-cacb3e7b3ad5",
#    "content":"Fixed the dashboard N+1 query by batching user lookups into one IN query; p95 latency dropped from 820ms to 45ms.",
#    "sessionId":"readme-example","origin":"rest","importance":0.5,
#    "createdAt":"2026-09-22T13:30:39.062Z","score":0.04918032786885246,
#    "source":"vector","signals":[]},
#   {"id":"108","memoryId":"0d850e3b-6ec5-49bb-bd94-42a1973912fa",
#    "content":"Implemented JWT auth in src/middleware/auth.ts: HS256 signing, 15-minute expiry, httpOnly cookie on login.",
#    "sessionId":"readme-example","origin":"rest","importance":0.5,
#    "createdAt":"2026-09-22T13:30:38.921Z","score":0.016129032258064516,
#    "source":"vector","signals":[]}],
#  "signals":[]}
```

Each result row carries `source` (`"vector" | "text" | "graph"`); fused rows
add a per-row `signals` array, and the envelope carries top-level `signals`
(empty when every attempted source succeeded).

**sessions / session memories / forget:**

```bash
# list sessions
curl -s 'http://127.0.0.1:3111/agentmemory/sessions?project=readme&limit=5'
# {"sessions":[{"sessionId":"readme-example","project":"readme","startedAt":"2026-09-22T13:30:38.921Z","updatedAt":"2026-09-22T13:30:39.066Z"}]}

# one session's memories (ordered by node insertion, newest first — see Known limitations)
curl -s 'http://127.0.0.1:3111/agentmemory/sessions/readme-example/memories?project=readme&limit=5'
# {"memories":[{"id":"109","memoryId":"0a6b1c4f-…","content":"Fixed the dashboard N+1 query…","sessionId":"readme-example","origin":"rest","importance":0.5,"createdAt":"2026-09-22T13:30:39.062Z"}, …]}

# hard-delete one memory (incident edges go with it)
curl -s -X POST http://127.0.0.1:3111/agentmemory/forget \
  -H 'content-type: application/json' \
  -d '{"memoryId":"0d850e3b-6ec5-49bb-bd94-42a1973912fa"}'
# {"forgotten":true}   (404 {"error":"not_found"} when the id does not exist)
```

**lesson → governed delete** (P3.1 — reason is required, receipt is auditable):

```bash
# store a lesson (strict body: origin is rejected; row gets origin="lesson")
curl -s -X POST http://127.0.0.1:3111/agentmemory/lesson \
  -H 'content-type: application/json' \
  -d '{"content":"Always pass an explicit reason on deletes: audit trails depend on it.","concepts":["governance"],"project":"readme","sessionId":"readme-example"}'
# 201
# {"id":"…","sessionId":"readme-example","project":"readme","concepts":["governance"]}

# governed delete with the required reason
curl -s -X POST http://127.0.0.1:3111/agentmemory/delete \
  -H 'content-type: application/json' \
  -d '{"memoryId":"0d850e3b-6ec5-49bb-bd94-42a1973912fa","reason":"superseded by docs/CONTRACT.md"}'
# {"deleted":true,"receipt":{"memoryId":"0d850e3b-6ec5-49bb-bd94-42a1973912fa","deletedAt":"2026-09-22T13:31:02.114Z"}}
# 400 when reason is missing; 404 {"error":"not_found"} for an unknown id
```

## MCP server

`src/mcp.ts` runs over **stdio** with the official `@modelcontextprotocol/sdk`,
backed by the same `MemoryStore` as the REST server. Handshake exposes exactly
**11 tools**:

| Tool | Purpose |
|---|---|
| `memory_save` | Persist one memory (content + optional concepts) |
| `memory_search` | Keyword (BM25) search within a project |
| `memory_smart_search` | Hybrid search: vector + BM25 + optional concept graph, RRF-fused |
| `memory_sessions` | List sessions of a project |
| `memory_session_memories` | List memories of one `sessionId` |
| `memory_forget` | Hard-delete one memory by id |
| `memory_health` | Liveness + memory/session counts |
| `memory_recap` | Text recap of one session's (or the project's) recent memories |
| `memory_handoff` | Project handoff digest for the next agent session |
| `memory_lesson` | Persist a lesson (stored with `origin="lesson"`; unknown input keys are stripped by the SDK, not rejected) |
| `memory_delete` | Governed delete: `memoryId` + required `reason`, returns a receipt |

### OpenCode

Top-level `mcp` key, command as an array (run from the repo root, or use the
absolute path to `src/mcp.ts`):

```json
{
  "mcp": {
    "agent-memory": {
      "type": "local",
      "command": ["npx", "tsx", "src/mcp.ts"],
      "enabled": true
    }
  }
}
```

### Claude Code

`mcpServers` shape (e.g. in `.mcp.json` or `~/.claude.json`):

```json
{
  "mcpServers": {
    "agent-memory": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "env": {
        "HELIX_URL": "http://localhost:6969"
      }
    }
  }
}
```

When `AGENT_MEMORY_SECRET` is set, every tool call must carry
`_meta.authorization = "Bearer <secret>"` (stdio has no HTTP headers, so the
bearer rides in the request's `_meta`); mismatch is an MCP `unauthorized`
error. Never commit a real secret — set it in the server's environment.

## Hooks

`hooks/capture.mjs` is plain Node ESM with **zero dependencies**. It reads the
host's hook JSON on stdin, takes the event name from `argv[2]` (supported:
`SessionStart`, `PostToolUse`, `Stop`), and POSTs one small observation to
`/agentmemory/remember` with `origin="hook:<event>"`.

Wiring example (Claude Code `settings.json` hooks shape):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs SessionStart" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs PostToolUse" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs Stop" }] }
    ]
  }
}
```

Any host that can run a command with JSON on stdin works the same way:
`node hooks/capture.mjs <EventName>`.

Guarantees (verified):

- **Always exits 0 with zero output** — even when the memory server is down,
  with malformed stdin, or with an unsupported event. A dead memory server must
  never block the coding agent.
- Stores a valid observation when the server is up; all 3 events
  (`SessionStart` / `PostToolUse` / `Stop`) work.
- **Only a tiny, host-agnostic summary is stored**: `agent session started`,
  `tool used: <tool-name>`, or `agent session stopped`. Hook payloads, file
  paths, and command output are deliberately NOT captured — a planted file path
  (`/tmp/secret-should-not-be-captured.txt`) was confirmed **not** stored.
- Never prints memory content, the hook payload, or the secret.
- `AGENT_MEMORY_URL` defaults to `http://127.0.0.1:3111` (the REST service, not
  the raw Helix port); `project` derives from the workspace directory name,
  overridable via `AGENT_MEMORY_PROJECT`.
- A 2s fetch timeout keeps a hung server from hanging the agent.

## Authentication

- Set `AGENT_MEMORY_SECRET` to a non-empty value to arm the guard: every
  `/agentmemory/*` route **except `livez`** then requires
  `Authorization: Bearer <secret>`; mismatch → `401` with body
  `{"error":"unauthorized"}`.
- **Unset `AGENT_MEMORY_SECRET` → open localhost** (matches the upstream
  default).
- The secret value is never logged, echoed, or included in error text; the
  access log records method, path, status, and duration only.
- The delete governance line (`memoryId`, `reason`, `at`) exists for
  **operational audit of destructive deletes only**: it goes to process
  stdout/stderr and nowhere else (this repo keeps no durable store for it),
  is retained per the host's log retention/rotation, and is deleted by log
  rotation or process exit — and the delete receipt's `deletedAt` is server
  time captured immediately after the store confirms the delete, with the
  receipt omitting `reason` by design (reason lives only in that log line).
  Its fields are a strict **allowlist** (`memoryId`, normalized `reason`,
  `at` — never memory content, embeddings, or headers): don't put PII or
  secrets in `reason` (caller responsibility, bearer-auth + length bound), and
  apply standard log masking/retention on the host that streams it.
- The MCP server applies the same rule over `_meta.authorization`.
- Never commit or print real secret values.

Verified auth matrix: `livez` exempt → 200; no header → 401; wrong bearer →
401; correct bearer → 200/201; secret appears 0 times in server logs; auth off
when `AGENT_MEMORY_SECRET` is unset.

## Configuration

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `AGENT_MEMORY_PORT` | `3111` | REST server | Listen port |
| `AGENT_MEMORY_URL` | `http://127.0.0.1:3111` | hooks, `verify`, plugin | Base URL of the REST service |
| `AGENT_MEMORY_SECRET` | *(unset = open)* | REST + MCP + hooks + plugin | Bearer secret; non-empty arms the guard |
| `HELIX_URL` | `http://localhost:6969` | store, bootstrap | HelixDB instance endpoint |
| `AGENT_MEMORY_PROJECT` | *(workspace dir name)* | hooks, plugin | Tenant/scope value for captured observations |
| `AGENT_MEMORY_HOST` | `127.0.0.1` | REST server | Bind address |
| `AGENT_MEMORY_INJECT` | `true` | OpenCode plugin | Auto-inject recalled memories into the system prompt; `false` skips the search and the context block (the static compaction reminder still lands) |
| `AGENT_MEMORY_INJECT_LIMIT` | `8` | OpenCode plugin | Max rows injected per block and per auto-recall query (`1`–`20`) |
| `AGENT_MEMORY_INJECT_TTL_MS` | `45000` | OpenCode plugin | Auto-recall cache TTL in ms, bounding network cost inside the request hot path (`1000`–`600000`) |

The three plugin rows are read with `options` > env > default, so a matching
`inject` / `injectLimit` / `injectTtlMs` key on the plugin itself wins over the
environment variable.

**Legacy names.** `AGENTMEMORY_SECRET`, `AGENTMEMORY_PORT`,
`AGENTMEMORY_URL`, `AGENTMEMORY_HOST`, and `AGENTMEMORY_PROJECT` are accepted
as **deprecated fallbacks** (the upstream spelling). When both spellings are
set, the `AGENT_MEMORY_*` name wins. The servers warn on stderr naming the
legacy variable — **never printing its value**; the capture hooks fall back
silently to keep their zero-output guarantee.

## Known limitations

Stated plainly — these are real, not hypothetical:

1. **Port conflict with upstream agentmemory.** Ports `3111/3112/3113` may
   already be held by the real upstream `agentmemory`
   (`npx` → `node …/bin/agentmemory` → `iii`). We keep `3111` as our default
   for drop-in parity, but when upstream is running, start ours elsewhere and
   point clients at it:

   ```bash
   AGENT_MEMORY_PORT=3151 npm run dev
   AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify
   ```

   **Never kill the user's upstream instance.**

2. **Persistence is the default; in-memory is opt-in.** The Quick start's
   `helix start dev --disk --persist` writes the storage mode into
   `helix.toml`, so a plain `helix start dev` keeps data across restarts. An
   instance started *without* `--disk` still runs `storage: memory` and loses
   everything on restart.

3. **Listings are ordered by node `$id` descending (insertion order), not by
   timestamp.** The engine cannot correctly sort `dateTime` properties —
   `orderBy` on DateTime was verified non-monotone across 8 sessions in the
   build probe — so `listSessions` and `sessionMemories` order by `$id` desc
   (deterministic newest-created-first) instead. This is an upstream engine
   limitation, **not** our choice.

4. **Embeddings are a deterministic, hash-based 384-dim embedder**
   (`src/embed.ts`: FNV-1a token hashing + TF weighting + L2 normalization — no
   model download, no API key, no LLM). It is good for structural/rank parity
   with the upstream, but it does **not** understand true semantic synonyms.
   Swap `src/embed.ts` for a real embedding model when semantics matter.

5. **Out of v1** per [`docs/CONTRACT.md` §4](docs/CONTRACT.md): decay, 4-tier
   consolidation, LLM auto-compress, viewer UI, session replay, JSONL import,
   multi-agent adapters (20 upstream), and the full 54-tool MCP surface.

6. **`demo` appends on every run — it is not idempotent.** Each invocation
   seeds 3 more sessions into project `demo`, so re-running it produces
   duplicate rows in later results. Restart Helix (data is in-memory anyway)
   or seed into a fresh `project` for a clean demonstration.

7. **Vector hits carry `distance`, BM25 hits carry `score`.** Vector rows are
   projected as `$distance` (cosine, lower = closer), so a raw vector hit's
   `score` is `0` until RRF fusion assigns one — read `distance` when ranking
   or displaying vector results, `score` for BM25/RRF. Both are surfaced on
   the REST row.

## Verification

All run clean:

- `npm run typecheck` (`tsc --noEmit`) — zero errors; no `any`, no
  `@ts-ignore`, no TODO anywhere in the source.
- `npm run verify` (`scripts/verify.ts`) — **`102 passed, 0 failed` →
  `VERIFY PASS`** (identity guard → health → remember with concepts → BM25 hits
  → smart-search hits → sessions list → session memories → forget → gone →
  counts reflect it, plus embedder determinism, defaults, boundary validation,
  and the P3.1 round-trip: lesson → search hits with `origin:"lesson"` →
  recap (every bullet session-scoped) → handoff → governed delete with receipt
  → gone → second delete 404 → counts). Before the first write it probes
  `POST /agentmemory/recap` and aborts (exit 1, no writes) unless the target
  answers 200 — so when `3111` is occupied by the upstream `agentmemory`, run
  it against ours: `AGENT_MEMORY_PORT=3151 npm run dev` then
  `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` (README conflict
  procedure).
- `npm run bootstrap` — `bootstrapIndexes: OK (7 indexes ensured)` then
  `READY — searchByText responding`.
- `npm run demo` — `demo OK`: BM25 hits at scores 2.54 / 1.59 / 0.88, vector
  hits ranked by cosine distance (e.g. `d=0.2972 < 0.3251 < 0.4151` — verified
  discriminating, not tied), and hybrid RRF hits mixing `source: vector` and
  `source: graph`.
- Auth matrix: `livez` exempt 200; no header 401; wrong bearer 401; correct
  bearer 200/201; 401 body `{"error":"unauthorized"}`; secret appears 0 times
  in server logs; auth off when `AGENT_MEMORY_SECRET` is unset.
- MCP stdio handshake → exactly the 11 tools listed above; live `tools/call`
  round-trips confirmed.
- Hook guarantees: exit code 0 and zero output with the server DOWN, with
  malformed stdin, and with an unsupported event; valid observation stored when
  up; all 3 events work; only the tool NAME is stored (planted path
  `/tmp/secret-should-not-be-captured.txt` confirmed NOT stored).

## Contributing & security

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — prerequisites, exact dev-setup
  commands, Conventional Commits, the PR/evidence bar, strict-TS rules, and
  the never-kill-upstream coexistence rule.
- [`SECURITY.md`](SECURITY.md) — supported versions, private reporting via
  GitHub Security Advisories (never a public issue), scope, the
  `AGENT_MEMORY_SECRET` policy, and response expectations.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Specification

The frozen contract this implementation follows — labels, routes, query
surface, MCP tools, scope, and §4 out-of-scope list — is
[`docs/CONTRACT.md`](docs/CONTRACT.md). Release history lives in
[`CHANGELOG.md`](CHANGELOG.md); per-release notes in
[`docs/specs/30_delivery/RELEASE_NOTES.md`](docs/specs/30_delivery/RELEASE_NOTES.md).

---

License: Apache-2.0
