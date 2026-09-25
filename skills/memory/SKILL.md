---
name: memory
description: Save durable facts to agent-memory and recall them with hybrid search (vector + BM25 + concept graph on HelixDB). Use when prior-session context, project decisions, architectural notes, or other persistent knowledge may exist — or should be recorded for the next session. This is the index of the skill set: it maps the full tool surface and routes to the dedicated skills (recall, remember, recap, handoff, forget, lesson, commit-context, session-history).
---

# agent-memory skill (index)

agent-memory is persistent storage for this agent: one HelixDB engine provides
graph + vector + full-text (BM25) retrieval, fused with Reciprocal Rank Fusion.
Tools are exposed by the `agent-memory` MCP server (**11 tools**); REST
(routes all under `/memory`) and hooks use the same store.

## Full skill set

| Skill | Purpose |
|---|---|
| [skills/recall/SKILL.md](skills/recall/SKILL.md) | Hybrid/keyword retrieval — find what the project already knows |
| [skills/remember/SKILL.md](skills/remember/SKILL.md) | Persist one durable fact (dedup-safe, concepts, importance) |
| [skills/recap/SKILL.md](skills/recap/SKILL.md) | Render a session or project as readable text bullets |
| [skills/handoff/SKILL.md](skills/handoff/SKILL.md) | Counts header + bullets to hand context to the next session |
| [skills/forget/SKILL.md](skills/forget/SKILL.md) | Hard-delete one memory by id (+ audited `delete` variant) |
| [skills/lesson/SKILL.md](skills/lesson/SKILL.md) | Record a lesson with forced `origin="lesson"` and high importance |
| [skills/commit-context/SKILL.md](skills/commit-context/SKILL.md) | Pre-commit checkpoint convention: decision/state/next/gotchas |
| [skills/session-history/SKILL.md](skills/session-history/SKILL.md) | List sessions → replay a session's memories → optional recap |

Start here for orientation; load the specific skill when the task matches it.

## Tools (11)

| Tool | Use it for |
|---|---|
| `memory_save` | Persist one durable fact: what was decided, built, fixed, learned |
| `memory_smart_search` | Default recall — hybrid: vector + BM25 + concept graph, RRF-fused |
| `memory_search` | Keyword (BM25) only — cheaper, exact-term lookups |
| `memory_sessions` | List sessions of a project |
| `memory_session_memories` | Replay one session's memories |
| `memory_forget` | Hard-delete one memory by `memoryId` |
| `memory_health` | Liveness + counts — diagnose any failed save/search |
| `memory_recap` | Text bullets for one session or a whole project |
| `memory_handoff` | Counts header + recap bullets, for the next session |
| `memory_lesson` | Save with `origin` forced to `lesson` (derived base 0.75) |
| `memory_delete` | Governed delete: hard-delete with a required audit `reason` |

REST mirrors these 12 routes (contract §3): `GET /memory/livez`,
`GET /memory/health`, `POST /memory/remember`, `POST /memory/search`,
`POST /memory/smart-search`, `GET /memory/sessions`,
`GET /memory/sessions/:sessionId/memories`, `POST /memory/forget`,
`POST /memory/recap`, `POST /memory/handoff`, `POST /memory/lesson`,
`POST /memory/delete`.

## Rules

1. **Recall before answering.** When a question may depend on earlier work
   (decisions, conventions, prior fixes), run `memory_smart_search` first.
2. **Save what outlives the session.** Architectural decisions, verified
   commands, environment quirks, user-stated preferences. Not scratch state,
   not full file contents, not tool output dumps.
3. **Never store secrets or PII.** No tokens, keys, credentials, or personal
   data — not in `content`, not in `concepts`.
4. **Tag with concepts.** `concepts` (e.g. `["auth", "helixdb"]`) become graph
   nodes and add the graph branch to hybrid search — use them on save.
5. **Tenant key is `project`.** Defaults to the workspace directory name; pass
   it explicitly when crossing workspaces.
6. **Forget is permanent.** Use `memory_forget` only with a concrete
   `memoryId` from `memory_save` or a search result; prefer `memory_delete`
   when a governance reason exists.

## Failure behavior

Searches degrade instead of throwing: a dead index returns empty `results`
plus a `signals` list, never a hard error. Recap/handoff degrade the same
way (partial text, `signals` populated, never a 500). If every call fails,
run `memory_health` — the memory service is likely not running
(`npx tsx src/server.ts` in the Brainy repo, or check
`BRAINY_URL`; default port 3111, ours runs on 3151 when an upstream
service holds it — never kill the upstream instance).
