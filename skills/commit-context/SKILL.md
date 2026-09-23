---
name: commit-context
description: Pre-commit/session-end convention for capturing durable state — record decision, current state, next step, and gotchas via memory_save / POST /memory/remember, then resume later via recall (memory_smart_search / POST /memory/smart-search). Use when about to commit or end a session and context must survive ("save where we are", "checkpoint before committing", "leave state for next time") — a workflow over existing tools, not a dedicated route.
---

# commit-context

## When to use

- Right **before a commit** or a risky change: capture where the work
  stands so a future session can resume without re-deriving it.
- **Session end / pre-compaction**: checkpoint durable state alongside the
  `handoff` digest.
- "Save where we are", "leave state for next time", "checkpoint before we
  break something".
- Any moment where the *next* step is obvious now but won't be tomorrow.

## Tools / routes

**There is no dedicated route for this — it is a convention over existing
tools:**

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_save` (write phase) | `POST /memory/remember` | `{content, concepts?, project?, sessionId?, origin?, importance?}` | 201 `{id, sessionId, project, concepts, deduped, consolidated}` |
| `memory_smart_search` (resume phase) | `POST /memory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[…], signals}` |

## What to record (and what not to)

**Record — one memory per checkpoint, structured inline:**

- **Decision**: what was chosen and why (the thing a future session would
  otherwise re-litigate).
- **Current state**: where the work stands — which step is done, what
  passes, what is mid-flight.
- **Next step**: the concrete action to resume with.
- **Gotchas**: anything that will bite the resumer (env quirks, ports,
  frozen contracts).

**Do NOT record:** diffs or file contents (the repo already holds them),
secrets/credentials, scratch state, raw tool output, or anything personal.

## Example

Base URL: `http://127.0.0.1:3111` (the default). When the upstream
`agentmemory` (iii) holds 3111, ours runs on 3151 — export
`AGENT_MEMORY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `AGENT_MEMORY_SECRET` is set, add
`-H "authorization: Bearer $AGENT_MEMORY_SECRET"`.

Write phase — before the commit:

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/remember \
  -H 'content-type: application/json' \
  -d '{"content":"P3-2 checkpoint — decision: skills indexed by skills/memory; state: 8 skills written, verify-skills green; next: run typecheck then commit; gotcha: upstream holds 3111, ours on 3151","concepts":["p3-2","checkpoint"],"project":"agent-memory","origin":"rest"}'
```

→ `201 {"id":"…","sessionId":"…","project":"agent-memory","concepts":["p3-2","checkpoint"],"deduped":false,"consolidated":false}`.

Resume phase — in the next session, recall before asking:

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/smart-search \
  -H 'content-type: application/json' \
  -d '{"query":"P3-2 checkpoint next step","concepts":["checkpoint"],"project":"agent-memory","limit":5}'
```

→ `200 {"mode":"hybrid","results":[…],"signals":[]}` — the checkpoint row
leads (its concept is in the graph branch).

## Rules

1. **One structured memory per checkpoint**: decision → current state →
   next step → gotchas, in that order, in `content`.
2. **Save BEFORE the commit/session ends**, never after — a crash loses
   everything captured later.
3. **Write phase uses `memory_save` / `POST /memory/remember`; resume uses
   recall (`memory_smart_search` / `POST /memory/smart-search`).** No
   dedicated commit-context route exists — do not invent one.
4. **Tag `concepts:["checkpoint"]`** (plus topic concepts) so future
   resumes find it through the graph branch, and keep `project` the same
   across write and resume.
5. **Never store secrets or PII (Ley 172-13)** — checkpoints cross
   sessions and are built to be read later; diffs and credentials stay out.

## Failure behavior

The write phase degrades exactly like `remember` (transport error / 400 on
bad body); the resume phase degrades exactly like `recall`: a dead index
returns empty `results` plus a `signals` list, never a hard error. If
every call fails, run `memory_health` (`GET /memory/health`) — the memory
service is likely not running or the URL is wrong (check
`AGENT_MEMORY_URL`; default port 3111, ours runs on 3151 when upstream
occupies it).
