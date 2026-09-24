# agent-memory

[![Version](https://img.shields.io/badge/version-v0.7.1-blue.svg)](CHANGELOG.md)

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
         importance (0..1), createdAt, embedding (f32[384]),
         dedupKey (unique, sha256 of project + normalized content)
Concept  name (unique), project

BELONGS_TO   Memory ──▶ Session
HAS_CONCEPT  Memory ──▶ Concept
```

- **`Memory.embedding`** — 384-dim vector, cosine distance, indexed with
  `project` as the tenant key.
- **`Memory.content`** — BM25 full-text index, also scoped by `project`.
- **`Memory.dedupKey`** — write-time dedup key (v1.1): saving the same fact
  twice returns the existing id (`deduped: true`) instead of a second row;
  the hash never leaves the store as raw content. A dedup hit creates no
  `Session` node — sessions materialize only on novel writes (contract §3).
- **`project`** is the tenant/scope for every vector and text index; search
  routes always pass it.

`bootstrapIndexes()` ensures all 8 indexes: 4 unique (`Memory.memoryId`,
`Session.sessionId`, `Concept.name`, `Memory.dedupKey`), 2 equality
(`Memory.sessionId`, `Memory.project`), 1 vector (`Memory.embedding`, 384-dim
cosine, tenant `project`), 1 text (`Memory.content`, tenant `project`).

Writes anchor narrow: `saveMemory()` is a single `writeBatch` that upserts the
Session (create or bump `updatedAt`), creates the Memory, links `BELONGS_TO`,
then upserts each Concept and links `HAS_CONCEPT` — an empty `concepts` array is
safe.

### Retrieval

`POST /memory/smart-search` runs up to three independent sources:

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

Ranks are 1-based. Ties break by **decayed-then-recall-boosted** `importance`
(desc): first `importance · e^(−λ·ageDays)` when `AGENT_MEMORY_DECAY_LAMBDA`
is set (older, never-recalled rows sink; λ unset/invalid/≤0 → plain
importance), then a recall boost `+ 0.2·n/(n+1)` where `n` is how many times
this process returned the row (in-process recall ledger, cap 10k, resets on
restart) — then `createdAt` (desc, newest first), then `memoryId` (asc) so
output is fully deterministic. The returned `importance` field is always the
stored value; decay and the recall boost are ranking-only.

Both search paths also honor `AGENT_MEMORY_TTL_DAYS` (v1.1): rows older than the
TTL are hidden and reported as `signals: ["ttl: hidden N expired rows"]` — explicit
degradation, never silent thinning. Both knobs are **off by default**.

Failures degrade instead of exploding: each source runs independently, a source
error is caught and recorded in a `signals` list, and the remaining sources
still contribute rows. Even an all-sources-down search returns **200** with
empty `results` + `signals` — never a 500. `POST /memory/search` is the
BM25-only path with the same degradation rule.

## Quick start

Requires **Node 20+** and a running Helix dev instance (Docker/Podman):

```bash
helix start dev --disk --persist   # durable default: persists storage mode into helix.toml

npm install
npm run bootstrap               # create the 8 indexes, poll until ready
npm run demo                    # seed 3 sessions, run keyword/semantic/hybrid searches
npm run dev                     # REST server on http://127.0.0.1:3111
npm run verify                  # end-to-end verification against the running server
npm run verify-lifecycle        # pure dedupKey/decay/TTL/concepts/confidence/merge checks (no server)
npm run verify-capture          # 7-event hook E2E vs a local counting server (no Helix)
npm run verify-skills           # structural + live round-trip of the 8 skills (running server)
npm run eval                    # retrieval scorecard -> docs/benchmarks/SCORECARD.md (running server)
```

Run `bootstrap` **before the first write**: the dedup lookup, the
consolidation probe, and both searches all depend on the 8 indexes — writes
fail closed (500) while an index is missing.

`--disk --persist` writes `storage = "disk"` into `helix.toml`, and that key —
not the flag — is what decides persistence. This repo's `helix.toml` already
sets it, so a plain `helix start dev` keeps data across restarts. A project
whose `helix.toml` has no `storage = "disk"` key runs memory storage, and
every restart wipes it.

Scripts (from `package.json`): `bootstrap`, `dev`, `demo`, `verify`,
`verify-env`, `verify-lifecycle`, `verify-capture`, `verify-skills`, `eval`,
`purge`, `typecheck`.

## REST API

All routes live under `/memory`, JSON in/out. If `AGENT_MEMORY_SECRET` is
set, add `-H "Authorization: Bearer $AGENT_MEMORY_SECRET"` to every call except
`livez` (see [Authentication](#authentication)).

| Method | Route | Body / query | Success |
|---|---|---|---|
| GET | `/memory/livez` | — | 200 `{"status":"ok"}` |
| GET | `/memory/health` | `?project=` | 200 `{"status":"ok","counts":{…}}` |
| POST | `/memory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |
| POST | `/memory/search` | `{query, project?, limit?}` | 200 `{mode:"bm25", results:[…], signals:[…]}` |
| POST | `/memory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[…], signals:[…]}` |
| GET | `/memory/sessions` | `?project=&limit=` | 200 `{sessions:[…]}` |
| GET | `/memory/sessions/:sessionId/memories` | `?project=&limit=` | 200 `{memories:[…]}` |
| POST | `/memory/forget` | `{memoryId}` | 200 `{forgotten:true}` / 404 |
| POST | `/memory/recap` | `{project?, sessionId?, limit?}` | 200 `{recap, sessionId, count, signals}` |
| POST | `/memory/handoff` | `{project?, sessionId?, limit?}` | 200 `{handoff, sessionId, counts, signals}` |
| POST | `/memory/lesson` | `{content, concepts?, project?, sessionId?, importance?}` (no `origin`) | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |
| POST | `/memory/delete` | `{memoryId, reason}` (`reason` required) | 200 `{deleted:true, receipt:{memoryId, deletedAt}}` / 404 |

Defaults: `project="default"`, `limit=10`, `origin="rest"`, `sessionId`
auto-generated (`crypto.randomUUID()`) when absent. `importance` (v1.2): an
explicit 0..1 value is stored as-is; when omitted the store **derives** it
from provenance + structure — base lesson 0.75 / `hook:*` 0.55 / else 0.5,
+ 0.025·min(concepts,8), clamp01 (the old `0.5` default is retired; see
[`docs/CONTRACT.md`](docs/CONTRACT.md) §3). Every REST
body is a strict zod object: **unknown keys are rejected with 400** — so
`lesson` never accepts `origin` (sending it → 400; the row is always stored
with `origin="lesson"`) and `delete` requires `reason`. MCP input schemas are
SDK-mediated instead: unknown keys are **stripped, not rejected**, and `origin`
is server-forced either way (`memory_lesson` stores `origin="lesson"` no
matter what the caller sends).

### Examples

```bash
# liveness
curl -s http://127.0.0.1:3111/memory/livez
# {"status":"ok"}

# health with counts
curl -s 'http://127.0.0.1:3111/memory/health?project=readme'
# {"status":"ok","counts":{"memories":2,"sessions":1}}
```

**remember** — real captured request/response:

```bash
curl -s -X POST http://127.0.0.1:3111/memory/remember \
  -H 'content-type: application/json' \
  -d '{
    "content": "Implemented JWT auth in src/middleware/auth.ts: HS256 signing, 15-minute expiry, httpOnly cookie on login.",
    "concepts": ["auth", "jwt"],
    "project": "readme",
    "sessionId": "readme-example"
  }'
# 201
# {"id":"0d850e3b-6ec5-49bb-bd94-42a1973912fa","sessionId":"readme-example","project":"readme","concepts":["auth","jwt"],"deduped":false}
```

Send the same `content` again (same project, any casing/whitespace) and the
server returns the SAME `id` with `"deduped":true` — no second row. Omit
`concepts` entirely and they're derived for you (top-8 terms of the content),
so plain saves still feed the concept-graph branch of hybrid search.

**search** (BM25 only):

```bash
curl -s -X POST http://127.0.0.1:3111/memory/search \
  -H 'content-type: application/json' \
  -d '{"query": "jwt token expiry", "project": "readme", "limit": 5}'
# {"mode":"bm25","results":[{"id":"…","memoryId":"…","content":"…","score":2.54,…,"source":"text","signals":[]}],"signals":[]}
```

**smart-search** (hybrid RRF) — real captured request/response:

```bash
curl -s -X POST http://127.0.0.1:3111/memory/smart-search \
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
curl -s 'http://127.0.0.1:3111/memory/sessions?project=readme&limit=5'
# {"sessions":[{"sessionId":"readme-example","project":"readme","startedAt":"2026-09-22T13:30:38.921Z","updatedAt":"2026-09-22T13:30:39.066Z"}]}

# one session's memories (ordered by node insertion, newest first — see Known limitations)
curl -s 'http://127.0.0.1:3111/memory/sessions/readme-example/memories?project=readme&limit=5'
# {"memories":[{"id":"109","memoryId":"0a6b1c4f-…","content":"Fixed the dashboard N+1 query…","sessionId":"readme-example","origin":"rest","importance":0.5,"createdAt":"2026-09-22T13:30:39.062Z"}, …]}

# hard-delete one memory (incident edges go with it)
curl -s -X POST http://127.0.0.1:3111/memory/forget \
  -H 'content-type: application/json' \
  -d '{"memoryId":"0d850e3b-6ec5-49bb-bd94-42a1973912fa"}'
# {"forgotten":true}   (404 {"error":"not_found"} when the id does not exist)
```

**lesson → governed delete** (P3.1 — reason is required, receipt is auditable):

```bash
# store a lesson (strict body: origin is rejected; row gets origin="lesson")
curl -s -X POST http://127.0.0.1:3111/memory/lesson \
  -H 'content-type: application/json' \
  -d '{"content":"Always pass an explicit reason on deletes: audit trails depend on it.","concepts":["governance"],"project":"readme","sessionId":"readme-example"}'
# 201
# {"id":"…","sessionId":"readme-example","project":"readme","concepts":["governance"]}

# governed delete with the required reason
curl -s -X POST http://127.0.0.1:3111/memory/delete \
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
| `memory_save` | Persist one memory (content + optional concepts — derived when omitted; duplicate content returns the existing id with `deduped:true`) |
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
`SessionStart`, `PostToolUse`, `Stop`, `PostToolUseFailure`, `PreCompact`,
`SessionEnd`, `UserPromptSubmit` — 7 events), and POSTs one small observation to
`/memory/remember` with `origin="hook:<event>"`.

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
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs PostToolUseFailure" }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs PreCompact" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs SessionEnd" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node /path/to/agent-memory/hooks/capture.mjs UserPromptSubmit" }] }
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
- Stores a valid observation when the server is up; all 7 events work
  (`SessionStart` / `PostToolUse` / `Stop` / `PostToolUseFailure` /
  `PreCompact` / `SessionEnd` / `UserPromptSubmit`).
- **Only an allowlisted, host-agnostic summary is stored**: `agent session
  started`, `tool used: <tool-name>` (or `file edited via <tool-name>` for
  edit-like tools — name only, never paths or content), `tool failed:
  <tool-name>`, `agent session stopped`, `context compaction requested`,
  `agent session ended`, or `user prompt submitted`. Hook payloads, full file
  paths, command output, and the user's prompt text are deliberately NOT
  captured — a planted file path
  (`/tmp/secret-should-not-be-captured.txt`) and a prompt canary were both
  confirmed **not** stored (privacy, Ley 172-13). Tool names carrying path
  separators are rejected fail-closed (stored as nothing). Opt-in widening
  only: `AGENT_MEMORY_CAPTURE_PATHS=basename` appends the sanitized file
  **basename** to edit observations — never a full path; keep it OFF when
  basenames themselves may be sensitive (they can contain usernames).
- Never prints memory content, the hook payload, or the secret.
- `AGENT_MEMORY_URL` defaults to `http://127.0.0.1:3111` (the REST service, not
  the raw Helix port); `project` derives from the workspace directory name,
  overridable via `AGENT_MEMORY_PROJECT`.
- A 2s fetch timeout keeps a hung server from hanging the agent.

The OpenCode plugin mirrors this with a 5th hook, `tool.execute.before` — a
fire-and-forget `tool started: <tool-name>` observation (own `memory*` tools
skipped; never awaited, so the tool hot path pays nothing) — plus a
`tool.execute.after` failure observation (`tool failed: <tool-name>`) on
non-completed runs.

### Transcript import and session summarization (P2)

Two opt-in CLIs, no new routes — both go through the existing
`POST /memory/remember` / `/memory/lesson` surface:

```bash
npx tsx scripts/import-transcript.ts --file session.jsonl --project myproj --dry-run
npx tsx scripts/import-transcript.ts --file session.jsonl --project myproj --session-id sess-1
npx tsx scripts/summarize-session.ts --session-id sess-1 --project myproj --dry-run
npx tsx scripts/summarize-session.ts --session-id sess-1 --project myproj
```

- **Import** accepts Claude Code JSONL or generic `{content}` lines under one
  sessionId. User prompt text is **skipped by default** (counted as
  `skipped_prompts`, never stored, never printed) — pass `--include-prompts`
  only for transcripts you own and may persist (importing third-party
  transcripts is the operator's responsibility under Ley 172-13). A
  caller-supplied `origin` is coerced into the `import:*` namespace so a
  crafted file cannot mint `lesson`/`hook:*` provenance.
- **Summarize** builds a deterministic summary + up to 3 lessons (no LLM) and
  saves them as `/memory/lesson` rows under the same sessionId, so a closed
  session stays retrievable by session. Re-running appends again (each run
  sees more memories) — use `--dry-run` first, or clean with
  `POST /memory/forget`. Chain after a `SessionEnd` hook with
  `AGENT_MEMORY_SUMMARIZE=1` for opt-in auto-wire.

## Authentication

- Set `AGENT_MEMORY_SECRET` to a non-empty value to arm the guard: every
  `/memory/*` route **except `livez`** then requires
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
| `HELIX_URL` | `http://localhost:6969` | store, bootstrap, purge | HelixDB instance endpoint |
| `AGENT_MEMORY_PROJECT` | *(workspace dir name)* | hooks, plugin | Tenant/scope value for captured observations |
| `AGENT_MEMORY_HOST` | `127.0.0.1` | REST server | Bind address |
| `AGENT_MEMORY_INJECT` | `true` | OpenCode plugin | Auto-inject recalled memories into the system prompt; `false` skips the search and the context block (the static compaction reminder still lands) |
| `AGENT_MEMORY_INJECT_LIMIT` | `8` | OpenCode plugin | Max rows injected per block and per auto-recall query (`1`–`20`) |
| `AGENT_MEMORY_INJECT_TTL_MS` | `45000` | OpenCode plugin | Auto-recall cache TTL in ms, bounding network cost inside the request hot path (`1000`–`600000`) |
| `AGENT_MEMORY_TTL_DAYS` | *(unset = off)* | REST + MCP searches, store | Hide memories older than N days from search results (reported as a `ttl:` signal); must parse to a finite number > 0, else OFF |
| `AGENT_MEMORY_DECAY_LAMBDA` | *(unset = off)* | REST + MCP searches, store | Per-day decay rate λ for the fused-row tie-break: weight = `importance · e^(−λ·ageDays)`; invalid/≤ 0 → decay OFF; stored `importance` is never modified |
| `AGENT_MEMORY_MERGE_JACCARD` | `0.9` | REST + MCP `remember`, store | Tier-1 consolidation: near-duplicates with `Jaccard(tokens) ≥ threshold` merge into one survivor (content concatenated, never discarded); parseable in (0,1) selects the threshold, anything else (≤0, ≥1, garbage) → consolidation OFF (fail-closed) |
| `EVAL_MODE` | `rest` | eval harness only (`scripts/eval.ts`) | Adapter selector for the pluggable `EvalClient`; unknown mode fails closed (exit 1). Never read by the server |

The three plugin rows are read with `options` > env > default, so a matching
`inject` / `injectLimit` / `injectTtlMs` key on the plugin itself wins over the
environment variable.

## Known limitations

Stated plainly — these are real, not hypothetical:

1. **Port conflict with upstream agentmemory.** Port `3111` is **our default**,
   chosen deliberately for drop-in parity with upstream. Ports
   `3111/3112/3113` may be held by the real upstream `agentmemory`
   (`npx` → `node …/bin/agentmemory` → `iii`; verified live on this machine).
   When `3111` is occupied, start ours on `3151` and point **every HTTP
   client — hooks, plugin, and `verify`** — at it via
   `AGENT_MEMORY_URL=http://127.0.0.1:3151` (the MCP server needs no reroute:
   it is stdio and talks to HelixDB directly via `HELIX_URL`):

   ```bash
   AGENT_MEMORY_PORT=3151 npm run dev
   AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify
   ```

   Starting ours on `3151` does **not** move the clients: hooks, the plugin,
   and `verify` still default to `http://127.0.0.1:3111` — which upstream may
   hold — so **every client process must set
   `AGENT_MEMORY_URL=http://127.0.0.1:3151` explicitly**. Skip it and captures
   and recalls are silently aimed at whatever occupies `3111`.

   The server prints this exact reroute hint on `EADDRINUSE`.
   **Never kill or displace the upstream instance.**

2. **Persistence is the default; in-memory is opt-in.** Persistence is decided
   by the `storage = "disk"` key in `helix.toml`, not by any start flag: the
   Quick start's `--disk --persist` is what writes that key, and this repo's
   `helix.toml` already carries it — so a plain `helix start dev` keeps data
   across restarts. A project whose `helix.toml` lacks the key runs memory
   storage and loses everything on restart.

   **Durability & recovery.** Data survives `helix restart dev` on the Docker
   volume while `storage = "disk"` is set. After a **host reboot** the
   container does **not** auto-start (no restart policy is configured) — run
   `helix start dev` to bring it back. The failure mode is symptom-free:
   captures keep exiting `0` silently and auto-recall is simply skipped, so
   the memory stack goes dark with no error anywhere. If recall suddenly
   returns nothing, check `helix status` first.

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

5. **Out of v1** per [`docs/CONTRACT.md` §4](docs/CONTRACT.md): consolidation
   tiers 2–4 (upstream's full 4-tier model), LLM auto-compress, viewer UI,
   session replay, multi-agent adapters (20 upstream), and the
   full 54-tool MCP surface.
   (Read-time decay + TTL + `purge.ts` shipped in v0.4.0 — "corte A";
   tier-1 near-duplicate consolidation, derived confidence and the eval
   harness shipped in v0.5.0; P2 capture breadth, script-only transcript
   import (`npm run import-transcript`) and deterministic session
   summarization (`npm run summarize-session`) shipped in v0.6.0
   (the remaining tiers stay out of scope.)

6. **`demo` appends on every run — it is not idempotent.** Each invocation
   seeds 3 more sessions into project `demo`, so re-running it produces
   duplicate rows in later results. Storage is durable by default
   (`storage = "disk"`), so a restart no longer clears them — seed into a
   fresh `project` for a clean demonstration. Data persists now; what is still
   pending is the P4 hardening story (backup/DR, data-dir control), not an
   in-memory reset.

7. **Vector hits carry `distance`, BM25 hits carry `score`.** Vector rows are
   projected as `$distance` (cosine, lower = closer), so a raw vector hit's
   `score` is `0` until RRF fusion assigns one — read `distance` when ranking
   or displaying vector results, `score` for BM25/RRF. Both are surfaced on
   the REST row.

8. **Concurrent distinct-variant merges lost one append — REMEDIATED
   2026-09-24 (in-process survivor serialization); cross-process writers
   remain out of contract (owner: engineering).** The dedup FIFO lock is
   still keyed by content hash (identical content only), and consolidation
   NOW serializes per *survivor* too: `survivorTails` + shared
   `withFifoLock` (lock order — incoming dedupKey lock OUTER → survivor
   lock INNER, one survivor per merge, no cycle), with a FRESH
   `getMemoryById` re-read under that lock (expired-while-waiting → plain
   insert, never absorbs). Concurrent saves of *different* near-dup
   variants that pick the same survivor now queue behind it: every append
   lands, and all callers still get `consolidated:true` with the SAME
   survivor id. Closed as
   [`docs/CONTRACT.md`](docs/CONTRACT.md) §3 tier-1 (a) (v1.5); code
   `01224cc`, evidence `TEST_MATRIX.md` (§P `rl-001:` — 3 concurrent
   distinct variants → one survivor, all three wordings present).
   Remaining boundary: the survivor lock serializes SAME-PROCESS writers
   only — cross-process writers to one Helix instance stay unsupported
   (single-writer contract, P4.3). Gate P1R-P32 / RL-001.

9. **With tier-1 ON, an unhealthy text index fails WRITES too.** Every novel
   `remember` runs the near-dupe probe (`textSearchWith`), so
   `index_not_found` surfaces as **500s on writes**, not just degraded
   search — `npx tsx scripts/bootstrap.ts` restores writes (idempotent;
   run it *before* the first write). The probe sends the full incoming
   content (≤200 kB) as the BM25 query, bounded by the 15 s per-operation
   timeout. Fail-closed is the documented posture (gate P1R-P32 / RL-003).

10. **Concept nodes outlive `forget` — retention is declared, not dropped.**
   Derived concept names are shared, globally-unique vocabulary with **no
   TTL by design** (tokens only, no PII). Retention purpose, PII posture
   (non-PII tokens; PII scan 0/0) and the operator-run orphan-cleanup
   procedure (audit → zero-in-edge gate → drop → re-audit) are declared in
   [`docs/CONTRACT.md`](docs/CONTRACT.md) v1.4 §3, verified live 2026-09-23
   (189→188, linked 128 unchanged); gate P1R-P32 → closed at v0.6.0.

11. **Tier-1 merge commit atomicity — REMEDIATED 2026-09-24 (post-write
    verify + one heal); the commit is detected-and-healed app-side, not
    engine-guaranteed (owner: engineering).** The merge write remains ONE
    Helix `writeBatch`, but its mid-batch commit is no longer blindly
    trusted: after every merge — still under the survivor lock — the store
    re-reads and asserts `content` === merged content, `dedupKey` === its
    hash, and every effective concept linked (`missingConcepts`, exact-name
    set difference); a violation gets exactly ONE heal (full
    `updateMemoryContent` retry for content/dedupKey drift, link-only
    `linkMemoryConcepts` for links) and a fail-closed throw naming any
    invariant still violated. The substring-guard path runs the same
    concept-link verify + heal while keeping content byte-identical. The
    engine's mid-batch atomicity remains an assumption — it is now
    DETECTED and healed app-side instead of trusted. Closed as
    [`docs/CONTRACT.md`](docs/CONTRACT.md) §3 tier-1 (b) (v1.5); code
    `a0257d6`, evidence `TEST_MATRIX.md` (§P `f-01:` — graph-branch fused
    score = control + 1/61 proves the healed link, survivor content
    byte-identical; §G goldens; §I 5-send NO-insert seam). REQ-F-01.

## Verification

All run clean:

- `npm run typecheck` (`tsc --noEmit`) — zero errors; no `any`, no
  `@ts-ignore`, no TODO anywhere in the source.
- `npm run verify` (`scripts/verify.ts`) — **`243 passed, 0 failed` →
  `VERIFY PASS`** (identity guard → health → remember with concepts → BM25 hits
  → smart-search hits → sessions list → session memories → forget → gone →
  counts reflect it, plus embedder determinism, defaults, boundary validation,
  the P3.1 round-trip: lesson → search hits with `origin:"lesson"` →
  recap (every bullet session-scoped) → handoff → governed delete with receipt
  → gone → second delete 404 → counts, the v1.1 P1.3/P1.6 sections:
  derived default concepts ≤8 → graph-branch proof (fused score == 3/61) →
  content-hash dedup round-trip: same id + `deduped:true` + counts stable,
  cross-project distinct, concurrent race → same id → dedup × hook first-wins:
  same fixed hook content in a NEW session → same id, no new row, no Session
  node for that session, and the v1.2 sections: derived importance
  (no-caller-value == `deriveWriteImportance(origin, concepts.length)`, explicit
  wins, recall-lift ordering) + tier-1 consolidation (3 near-dup variants →
  1 row with `consolidated:true`, each variant's wording recalls it,
  healthCount +1, merged-text re-save → exact-dedup loop guard) + the MCP
  adapter pass-through (`InMemoryTransport`: save without `importance` → the
  store sees `undefined`, explicit value wins) + the v1.5 §P `rl-001:`
  block (3 CONCURRENT distinct near-dup variants → SAME survivor, all three
  wordings verbatim, no lost append — 13 checks) and the §P `f-01:` heal
  block (heal E2E: graph-branch fused score = control + 1/61 proves the
  healed link; survivor content byte-identical after the guard-path heal —
  16 checks). Before the
  first write it probes
  `POST /memory/recap` and aborts (exit 1, no writes) unless the target
  answers 200 — so when `3111` is occupied by the upstream `agentmemory`, run
  it against ours: `AGENT_MEMORY_PORT=3151 npm run dev` then
  `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` (README conflict
  procedure).
- `npm run verify-lifecycle` (`scripts/verify-lifecycle.ts`) — **`123 passed` →
  `VERIFY PASS`**: pure dedupKey/hash golden vectors, decay math (λ=0 → 1,
  half-life exact, monotonic, clamp), TTL filter (OFF/boundary/purity),
  concept extraction determinism + bounds, `oneLine` CWE-117 render guard
  (collapses `\n`/`\r`/tabs to single spaces, idempotent, non-corrupting
  for names/digits/ISO/booleans), plus §F derived confidence
  (deriveWriteImportance goldens, confidenceBoost monotonic/clamp, recall
  ledger), §F-bis the decay-THEN-boost order golden (λ on, discriminating),
  §G consolidation (jaccard, threshold fail-closed OFF, substring
  guard + `missingConcepts` goldens — order-independence over shuffled
  input, dedup, exact-name/case-sensitive, no substring, empty-set),
  §H hand-computed eval-metric goldens (R@5/R@10/MRR/nDCG/aggregate),
  and §I fail-closed near-dupe probe + TTL×expired-survivor guard +
  guard-path heal seam (5 sends, NO insert) + §I-c heal-seam trio
  (expired-while-waiting → plain insert, fresh-read miss → stale links →
  merge-path retryWrite, post-heal still-violated → named throw) + §I-d
  F-01-EMB embedding seams (stale embedding heals in 8 sends with the
  `invariants=embedding` stderr token, still-stale → named throw, f32
  round-trip green with NO heal) + plugin
  no-default source checks. No Helix, no server — CI-runnable.
- `npm run verify-capture` (`scripts/verify-capture.ts`) — **`137 checks` →
  `ALL PASS`**: all 7 hook events × exact payload/origin/exit-0/stdout+stderr
  silence, prompt-text privacy canary, negatives (unsupported event, malformed
  /empty stdin, dead server), Authorization header, the plugin
  `captureToolStart`/`captureToolFailure` helpers (incl. `memory*` skip +
  dead-backend fail-soft), and §F gate regressions (file-edit marker, basename
  opt-in OFF by default, path-bearing tool-name fail-closed, non-string tool
  never throws).
  Spawns `capture.mjs` against a local counting server — no Helix, CI-runnable.
- `npm run bootstrap` — `bootstrapIndexes: OK (8 indexes ensured)` then
  `READY — searchByText responding`.
- `npm run verify-env` (`scripts/verify-env.ts`) — **`21 passed`**: legacy
  `AGENTMEMORY_*` migration guards + hook silence.
- `npx tsx scripts/verify-injection.ts` — **`ALL PASS` (73)**: marker
  idempotency, block size budget, cache TTL/LRU, fail-soft recall.
- `npx tsx scripts/probe3.ts` — **`OVERALL: GREEN`**: live-instance proof for
  dedup lookup round-trip, application-side (non-)uniqueness, and `ltParam`
  strict older-than on `dateTime` (feeds `purge.ts`).
- `npx tsx scripts/probe4.ts` — **`13 passed`**: live proof that
  `updateMemoryContent`'s `setProperty` refreshes BOTH the text and vector
  indexes (verdict A — the tier-1 merge ships in-place, survivor id stable),
  plus the f32 round-trip of the committed embedding (`getMemoryById` re-read,
  max diff ≤ 1e-6).
- `npm run verify-skills` (`scripts/verify-skills.ts`) — **`119 checks` →
  `VERIFY SKILLS PASS`**: 73 structural checks across the 8
  `skills/*/SKILL.md` (frontmatter, name == dir, contract route + MCP tool
  per skill, index links, secret patterns) + 46 live round-trips exercising
  every skill's frozen route under project `verify-skills`, behind the same
  identity guard as `verify`. `--structural` runs only the 73 checks with
  **no server** — that mode is what CI executes.
- `npm run eval` (`scripts/eval.ts`) — **`EVAL PASS`**: seeds the in-repo
  corpus (`eval/corpus.ts`, 40 docs / 15 queries, project
  `agent-memory-eval`, idempotent via dedup) and writes our own R@5 / R@10 /
  MRR@10 / nDCG@10 for bm25 + hybrid to
  [`docs/benchmarks/SCORECARD.md`](docs/benchmarks/SCORECARD.md) — upstream's
  published numbers are never claimed as ours.
- `npx tsx scripts/purge.ts --dry-run` — prints would-delete count + ids and
  deletes nothing; missing `--days` → usage + exit 2 (fail closed).
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
  up; all 7 events work; only the allowlisted summary is stored (planted path
  `/tmp/secret-should-not-be-captured.txt` and a prompt canary both confirmed
  NOT stored).

## Skills

Invocable agent skills live under [`skills/`](skills/), each mapping one job to
the frozen REST + MCP surface (the frontmatter `description` is what an agent
matches on — see [`skills/memory/SKILL.md`](skills/memory/SKILL.md) for the
index): `recall` (hybrid/BM25 recall), `remember` (save + dedup/consolidation
semantics), `recap`, `handoff`, `forget` (permanent delete) / governance
delete, `lesson` (origin-forced), `commit-context` (capture durable state
before a commit), and `session-history` (sessions → memories → recap).
`npm run verify-skills` structurally validates all 8 and live round-trips
every route against a running server.

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
