---
name: recall
description: Retrieve durable facts from agent-memory with hybrid retrieval — memory_smart_search (vector + BM25 + concept graph, RRF-fused) by default, memory_search (keyword/BM25) for exact terms. Use when the user asks "what do we know about X", "did we already solve this", "what did we decide earlier", when prior-session context, project decisions, conventions, or fixes may exist, or before answering any question that could depend on earlier work.
---

# recall

## When to use

- Before answering a question that may depend on earlier work: decisions,
  conventions, prior fixes, environment quirks, user-stated preferences.
- "What do we know about X" / "did we already look at this" / "how did we
  fix this last time" style questions.
- Resuming a session — recall first, then decide what still needs doing.
- Any "find it in memory" moment where you know the exact identifier
  (route name, error string, ticket id) — that is the BM25 case.

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_smart_search` (default) | `POST /memory/smart-search` | `{query, concepts?, project?, limit?}` | 200 `{mode:"hybrid", results:[{id, memoryId, content, score, sessionId, origin, importance, createdAt, source, signals}], signals}` |
| `memory_search` (keyword) | `POST /memory/search` | `{query, project?, limit?}` | 200 `{mode:"bm25", results:[{id, memoryId, content, score, sessionId, origin, importance, createdAt, source:"text"}], signals}` |

`source` on hybrid rows is `"vector" | "text" | "graph"`; vector-sourced rows
add `distance` (cosine, lower = closer) and their raw `score` stays 0 until
RRF assigns one. Defaults: `project="default"`, `limit=10`.

## Example

Base URL: `http://127.0.0.1:3111` (the default). When an upstream
service holds 3111, ours runs on 3151 — export
`BRAINY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `BRAINY_SECRET` is set, add
`-H "authorization: Bearer $BRAINY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/smart-search \
  -H 'content-type: application/json' \
  -d '{"query":"jwt token expiry middleware","concepts":["auth"],"project":"agent-memory","limit":5}'
```

A good response:

```json
{
  "mode": "hybrid",
  "results": [
    {"memoryId":"…","content":"JWT auth middleware signs tokens with HS256 and a 15 minute expiry","score":0.0327,"sessionId":"…","origin":"rest","importance":0.55,"createdAt":"2026-09-23T14:02:11.000Z","source":"vector","signals":[]}
  ],
  "signals": []
}
```

Exact-term variant (cheaper, keyword only):

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/search \
  -H 'content-type: application/json' \
  -d '{"query":"EADDRINUSE","project":"agent-memory","limit":10}'
```

→ 200 `{"mode":"bm25","results":[…],"signals":[]}`.

## Rules

1. **`memory_smart_search` is the default recall.** It fuses vector + BM25
   (+ concept graph) with Reciprocal Rank Fusion — best coverage for
   natural-language questions.
2. **`memory_search` (BM25) for exact terms**: identifiers, error codes,
   route paths, ticket ids. Skip it when the query is conversational.
3. **`concepts` enable the graph branch.** Passing e.g.
   `concepts:["auth"]` adds the third retrieval source; omit it and you
   only get vector + text. Use concepts you saw in a prior save.
4. **Tenant key is `project`.** It scopes every index — pass it explicitly
   when crossing workspaces (defaults to the workspace name / `"default"`).
5. **Read `signals[]`.** A non-empty list means a source degraded and the
   result is partial — not an error, never a 500. Empty = all sources healthy.
6. **Never store secrets or PII (Ley 172-13)** — recall output must never be
   copied into a new memory, concept, or log if it contains them.

## Failure behavior

Searches degrade instead of throwing: a dead index returns empty `results`
plus a `signals` list, never a hard error. If every call fails, run
`memory_health` (`GET /memory/health`) — the memory service is likely not
running or the URL is wrong (check `AGENT_MEMORY_URL`; default port 3111,
ours runs on 3151 when upstream occupies it). A `signals` entry naming
`index_not_found` means run `scripts/bootstrap.ts` once.
