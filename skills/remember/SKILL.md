---
name: remember
description: Persist one durable fact into agent-memory with memory_save / POST /memory/remember — what was decided, built, fixed, or learned, with optional concepts, origin, and importance. Use when something worth outliving the session happens: an architectural decision, a verified command, an environment quirk, a user-stated preference, "save this", "remember that", or before context is lost — and for quick dedup-safe writes of facts that may already exist.
---

# remember

## When to use

- A decision was made, a fix verified, a command proven to work, an
  environment quirk discovered — anything that will matter next session.
- The user says "save this", "remember that", "note this down".
- Recording a convention or preference the user states explicitly.
- Right before a risky step, to checkpoint durable state (see
  `commit-context` for the full pre-commit workflow).

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_save` | `POST /memory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |

Defaults: `project="default"`, `sessionId` auto-generated (`crypto.randomUUID()`),
`origin="rest"`, `importance` **derived server-side** when omitted (origin base:
lesson 0.75 / hook 0.55 / else 0.5, plus 0.025 per concept, capped at 8 concepts).

## Example

Base URL: `http://127.0.0.1:3111` (the default). When the upstream
`agentmemory` (iii) holds 3111, ours runs on 3151 — export
`AGENT_MEMORY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `AGENT_MEMORY_SECRET` is set, add
`-H "authorization: Bearer $AGENT_MEMORY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/remember \
  -H 'content-type: application/json' \
  -d '{"content":"Rate limiting with a token bucket: 60 requests per minute, burst 10, respond 429","concepts":["reliability","ratelimit"],"project":"agent-memory","origin":"rest"}'
```

A good response:

```json
{"id":"5f9c…","sessionId":"c41a…","project":"agent-memory","concepts":["reliability","ratelimit"],"deduped":false,"consolidated":false}
```

Save the same fact twice and you get the SAME `id` back with
`"deduped":true` — no second row.

## Rules

1. **Save what outlives the session.** Decisions, verified commands,
   environment quirks, preferences. Not scratch state, not diffs, not tool
   output dumps, not full file contents.
2. **Dedup is on.** Identical (normalized) content in the same project
   returns the existing id with `deduped:true` and writes nothing — repeat
   saves are safe. Same content in a *different* project = a different row.
3. **Consolidation merges near-duplicates.** Content ≈ an existing row
   (Jaccard ≥ 0.9) is concatenated into the survivor: you get the survivor's
   id with `consolidated:true`, `deduped:false` — no text is ever dropped.
4. **Concepts are derived when omitted** — top 8 informative tokens, echoed
   in the 201. Caller-supplied `concepts` always win verbatim. Pass them
   (e.g. `["auth","helixdb"]`) to feed the graph branch of smart-search.
5. **Omit `importance` and it is derived** from origin + concept count;
   pass a 0..1 number only when you deliberately override ranking.
6. **Never store secrets or PII (Ley 172-13)** — no tokens, keys,
   credentials, or personal data, not in `content` and not in `concepts`.

## Failure behavior

A failed save surfaces as a transport error or 400 (schema rejects invalid
bodies — `content` 1..200000 chars, strict keys, no extras). If every call
fails, run `memory_health` (`GET /memory/health`) — the memory service is
likely not running or the URL is wrong (check `AGENT_MEMORY_URL`; default
port 3111, ours runs on 3151 when upstream occupies it).
