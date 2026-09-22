---
name: memory
description: Save durable facts to agent-memory and recall them with hybrid search (vector + BM25 + concept graph on HelixDB). Use when prior-session context, project decisions, architectural notes, or other persistent knowledge may exist — or should be recorded for the next session.
---

# agent-memory skill

agent-memory is persistent storage for this agent: one HelixDB engine provides
graph + vector + full-text (BM25) retrieval, fused with Reciprocal Rank Fusion.
Tools are exposed by the `agent-memory` MCP server (7 tools); REST and hooks
use the same store.

## Tools

| Tool | Use it for |
|---|---|
| `memory_save` | Persist one durable fact: what was decided, built, fixed, learned |
| `memory_smart_search` | Default recall — hybrid: vector + BM25 + concept graph, RRF-fused |
| `memory_search` | Keyword (BM25) only — cheaper, exact-term lookups |
| `memory_sessions` | List sessions of a project |
| `memory_session_memories` | Replay one session's memories |
| `memory_forget` | Hard-delete one memory by `memoryId` |
| `memory_health` | Liveness + counts — diagnose any failed save/search |

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
   `memoryId` from `memory_save` or a search result.

## Failure behavior

Searches degrade instead of throwing: a dead index returns empty `results`
plus a `signals` list, never a hard error. If every call fails, run
`memory_health` — the memory service is likely not running
(`npm run dev` in the agent-memory repo, or check `AGENT_MEMORY_URL`).
