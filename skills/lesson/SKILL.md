---
name: lesson
description: Record a durable lesson in agent-memory with memory_lesson / POST /memory/lesson — a remember whose origin is forced server-side to "lesson", giving it the highest derived importance base. Use when something is learned the hard way: a gotcha, a pitfall, a verified workaround, "note this as a lesson", "remember this for next time", or any repeat-offender mistake worth surfacing in future recalls.
---

# lesson

## When to use

- A gotcha or pitfall was just learned the hard way: "note this as a
  lesson", "remember this for next time", "don't do X again".
- Verified workarounds and repeat-offender mistakes worth surfacing in
  every future recall of the topic.
- Practices/conventions the user states with intent to enforce them
  ("from now on, always …").
- Any fact that should outrank a plain note when importance ties break.

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_lesson` | `POST /memory/lesson` | `{content, concepts?, project?, sessionId?, importance?}` — **no `origin` field** | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |

The body is strict: supplying `origin` is a 400. The server forces
`origin:"lesson"`, so absent `importance` derives from the **lesson base
0.75** (+0.025 per concept, capped at 8) — lessons naturally outrank plain
`origin="rest"` notes (base 0.5).

## Example

Base URL: `http://127.0.0.1:3111` (the default). When an upstream
service holds 3111, ours runs on 3151 — export
`BRAINY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `BRAINY_SECRET` is set, add
`-H "authorization: Bearer $BRAINY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/lesson \
  -H 'content-type: application/json' \
  -d '{"content":"Helix text index is not refreshed by setProperty in older builds — re-run bootstrap after schema edits","concepts":["helixdb","indexes"],"project":"agent-memory"}'
```

A good response:

```json
{"id":"9b21…","sessionId":"7d0e…","project":"agent-memory","concepts":["helixdb","indexes"],"deduped":false,"consolidated":false}
```

The stored row reports `origin:"lesson"` on any search result.

## Rules

1. **`origin` is forced server-side** — never send it (strict schema →
   400). Use `memory_save` when you need a custom origin such as
   `hook:*`.
2. **Lessons rank higher by default**: omitted `importance` derives from
   the lesson base 0.75, so lessons surface above equal-age plain notes.
   Pass `importance` explicitly only to deliberately override.
3. **Dedup is first-wins**: re-saving an identical lesson (or a plain
   remember of the same text) returns the ORIGINAL row with
   `deduped:true` — its stored origin/importance stay as first written, and
   no new session is materialized.
4. **Tag with `concepts`** so the lesson feeds the graph branch of
   `memory_smart_search` — omitted concepts are derived (top 8) instead.
5. **Never store secrets or PII (Ley 172-13)** — not in `content`, not in
   `concepts`.

## Failure behavior

A failed save surfaces as a transport error or 400 (schema rejects invalid
bodies: `content` 1..200000 chars, strict keys, `origin` forbidden). If
every call fails, run `memory_health` (`GET /memory/health`) — the memory
service is likely not running or the URL is wrong (check
`AGENT_MEMORY_URL`; default port 3111, ours runs on 3151 when upstream
occupies it).
