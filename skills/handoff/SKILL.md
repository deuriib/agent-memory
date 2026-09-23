---
name: handoff
description: Produce end-of-session handoff text — a project/memory/session counts header plus recap bullets — with memory_handoff / POST /memory/handoff, so the NEXT session inherits context. Use when a session is ending, the user says "hand off", "wrap up", "leave notes for the next session", before context compaction, or when one agent must pass state to another without re-reading everything.
---

# handoff

## When to use

- Session end: "hand off", "wrap up", "leave notes for the next session".
- Before compaction — capture the narrative while context is still rich.
- Passing work from one agent/session to another: the receiving side reads
  the `handoff` string instead of re-discovering state.
- Auditing what a project holds at a milestone (the header gives counts).

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_handoff` | `POST /memory/handoff` | `{project?, sessionId?, limit?}` | 200 `{handoff, sessionId, counts, signals}` |

Body identical to `recap`. The `handoff` string = first line
`project=… memories=… sessions=… recent:` (from health counts) followed by
the recap bullets (`- [sessionId] createdAt (origin): content`).
`counts` = `{memories, sessions}`; defaults `project="default"`, `limit=10`.

## Example

Base URL: `http://127.0.0.1:3111` (the default). When the upstream
`agentmemory` (iii) holds 3111, ours runs on 3151 — export
`AGENT_MEMORY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `AGENT_MEMORY_SECRET` is set, add
`-H "authorization: Bearer $AGENT_MEMORY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/handoff \
  -H 'content-type: application/json' \
  -d '{"project":"agent-memory","limit":20}'
```

A good response:

```json
{
  "handoff": "project=agent-memory memories=12 sessions=3 recent:\n- [c41a…] 2026-09-23T14:02:11.000Z (rest): Rate limiting with a token bucket: 60 requests per minute, burst 10, respond 429",
  "sessionId": null,
  "counts": {"memories": 12, "sessions": 3},
  "signals": []
}
```

## Rules

1. **Use at session end** (or pre-compaction) to hand context to the next
   session — the header tells it how much it is looking at, the bullets
   tell it what happened.
2. **`sessionId` scopes the bullets to one session; omit it for the whole
   project.** The `counts` header is always project-wide.
3. **Save durable decisions BEFORE handing off** — handoff only renders
   what `remember`/`lesson` already stored; nothing new is written.
4. **Read `signals`**: a non-empty list means part of the digest degraded
   (counts or some session's memories failed) — the text is partial, not
   the whole project.
5. **Never store secrets or PII (Ley 172-13)** — handoff text is designed
   to cross sessions; keep what feeds it clean.

## Failure behavior

Handoff degrades via `signals`, never a 500: every store call is wrapped
individually; a failed counts fetch lands as `counts: …` while the bullets
still render, and the response stays 200 with partial text. If every call
fails, run `memory_health` (`GET /memory/health`) — the memory service is
likely not running (check `AGENT_MEMORY_URL`; default port 3111, ours runs
on 3151 when upstream occupies it).
