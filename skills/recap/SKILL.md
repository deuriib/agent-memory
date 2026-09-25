---
name: recap
description: Render recent agent-memory entries as readable text bullets for one session or a whole project — memory_recap / POST /memory/recap returns a recap string with count and signals. Use when the user asks "what happened", "catch me up", "summarize this session", "what did we do earlier", or when an agent needs a quick narrative of stored context before continuing work.
---

# recap

## When to use

- "Catch me up", "what happened so far", "summarize this session/project".
- Mid-session orientation: you joined late or the context was compacted and
  you need the narrative, not a keyword search.
- Before proposing a plan — recap what the project already recorded.
- After `session-history` picks a session, to render it as text.

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_recap` | `POST /memory/recap` | `{project?, sessionId?, limit?}` | 200 `{recap, sessionId, count, signals}` |

With `sessionId`: bullets for that session only. Without it: bullets for
every session of `project`. Defaults: `project="default"`, `limit=10`.
Bullet format: `- [sessionId] createdAt (origin): content`.
`sessionId` in the response echoes the REQUEST (`null` when omitted).

## Example

Base URL: `http://127.0.0.1:3111` (the default). When an upstream
service holds 3111, ours runs on 3151 — export
`BRAINY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `BRAINY_SECRET` is set, add
`-H "authorization: Bearer $BRAINY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/recap \
  -H 'content-type: application/json' \
  -d '{"project":"agent-memory","limit":10}'
```

A good response:

```json
{
  "recap": "- [c41a…] 2026-09-23T14:02:11.000Z (rest): Rate limiting with a token bucket: 60 requests per minute, burst 10, respond 429",
  "sessionId": null,
  "count": 1,
  "signals": []
}
```

Session-scoped variant: `{"sessionId":"c41a…","project":"agent-memory"}` →
`sessionId` echoes the id, `count` = memories of that session.

## Rules

1. **`sessionId` recaps one session; omit it to recap the whole project.**
   Both are one call — pick the narrower scope when you know the session.
2. **`count` is the number of memories rendered** — use it to detect thin
   context (0 with a non-empty `signals` = degradation, not "nothing ever
   happened").
3. **`limit` bounds memories per session** (default 10, max 100) — raise it
   for long sessions, keep it small for quick orientation.
4. **Recap is read-only narrative.** To search by meaning, use `recall`
   (`memory_smart_search`) instead — recap never ranks or filters by query.
5. **Never store secrets or PII (Ley 172-13)** — don't copy recap text into
   a new memory or a log if it could contain them.

## Failure behavior

Recap degrades via `signals`, never a 500: every store call is wrapped
individually, a failed call lands in `signals` (`memories(…): …`,
`sessions: …`, `digest: budget exceeded`) and the partial text still
returns 200. If every call fails, run `memory_health` (`GET /memory/health`)
— the memory service is likely not running (check `AGENT_MEMORY_URL`;
default port 3111, ours runs on 3151 when upstream occupies it).
