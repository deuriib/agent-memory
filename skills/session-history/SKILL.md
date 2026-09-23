---
name: session-history
description: Walk past agent sessions with memory_sessions / GET /memory/sessions and memory_session_memories / GET /memory/sessions/:sessionId/memories — list a project's sessions, pick one, replay its memories, optionally recap it. Use when the user asks "what did we work on yesterday", "show sessions for this project", "replay session X", or when tracing what happened in a specific prior session before summarizing with recap.
---

# session-history

## When to use

- "What did we work on earlier / yesterday / last week" → list sessions.
- "Replay session X" / "what did that session actually store" → its
  memories.
- Tracing the history behind a memory (find the session, replay it, then
  optionally `recap` it as text).
- Auditing how much context a project has accumulated per session.

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_sessions` | `GET /memory/sessions` | `?project=&limit=` | 200 `{sessions:[{sessionId, project, startedAt, updatedAt}]}` |
| `memory_session_memories` | `GET /memory/sessions/:sessionId/memories` | `?project=&limit=` | 200 `{memories:[{id, memoryId, content, sessionId, origin, importance, createdAt}]}` |

Defaults: `project="default"`, `limit=10` (max 100). Ordering: newest `$id`
first. Follow-up rendering: `memory_recap` / `POST /memory/recap`
`{sessionId, project}` → 200 `{recap, sessionId, count, signals}`.

## Example

Base URL: `http://127.0.0.1:3111` (the default). When the upstream
`agentmemory` (iii) holds 3111, ours runs on 3151 — export
`AGENT_MEMORY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `AGENT_MEMORY_SECRET` is set, add
`-H "authorization: Bearer $AGENT_MEMORY_SECRET"`.

Step 1 — list sessions:

```bash
curl -sS 'http://127.0.0.1:3111/memory/sessions?project=agent-memory&limit=10'
```

→ `200 {"sessions":[{"sessionId":"c41a…","project":"agent-memory","startedAt":"…","updatedAt":"…"}]}`.

Step 2 — pick a `sessionId`, replay its memories:

```bash
curl -sS 'http://127.0.0.1:3111/memory/sessions/c41a…/memories?project=agent-memory&limit=20'
```

→ `200 {"memories":[{"memoryId":"…","content":"…","sessionId":"c41a…","origin":"rest","importance":0.55,"createdAt":"…"}]}`.

Step 3 (optional) — render it as text:

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/recap \
  -H 'content-type: application/json' \
  -d '{"sessionId":"c41a…","project":"agent-memory"}'
```

## Rules

1. **Flow is sessions → pick → memories → (optional) recap.** List first,
   never guess a `sessionId` — ids are opaque.
2. **Sessions materialize only on novel writes**: a dedup hit or a
   consolidation merge creates NO session and bumps none, so the echoed
   `sessionId` of a save may not list that row — membership lives under the
   session of the FIRST write.
3. **`limit` bounds each list** (default 10, max 100); paging beyond that
   is not exposed — raise `limit` instead.
4. **Both routes are `GET` with query params**, tenant-scoped by
   `project` — pass it explicitly when crossing workspaces.
5. **Never store secrets or PII (Ley 172-13)** — don't copy listed
   contents into new memories or logs if they could contain them.

## Failure behavior

An empty `sessions`/`memories` list means either no data for that
`project`/`sessionId` or degraded reads — check `signals`-producing routes
(`recap`) for the failure text, and run `memory_health` (`GET /memory/health?project=…`)
to confirm the service is up and how many rows it counts. If every call
fails, the memory service is likely not running (check `AGENT_MEMORY_URL`;
default port 3111, ours runs on 3151 when upstream occupies it). A bad
`limit`/`project` query is a 400; an unknown `sessionId` returns an empty
list, not a 404.
