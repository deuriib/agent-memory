---
name: forget
description: Permanently hard-delete one agent-memory row by its memoryId — memory_forget / POST /memory/forget, with memory_delete / POST /memory/delete as the audited variant when a governance reason exists. Use when a stored fact is wrong, stale, or must be removed on request ("forget this", "delete that memory", "remove the note about X") and you hold a concrete memoryId from a save or search result.
---

# forget

## When to use

- A stored fact is wrong, outdated, or was saved by mistake and must be
  removed permanently — "forget this", "delete that memory".
- User-requested removal of a specific note (right-to-erasure style
  cleanup of one row).
- Pruning test/probe rows you created yourself.
- Compliance/governance deletion where an audit reason exists → prefer the
  `memory_delete` variant below.

## Tools / routes

| MCP tool | REST route | Body / query | Success |
|---|---|---|---|
| `memory_forget` | `POST /memory/forget` | `{memoryId}` | 200 `{forgotten:true}` / 404 `{error:"not_found"}` |
| `memory_delete` (audited variant) | `POST /memory/delete` | `{memoryId, reason}` — `reason` required, 1..1000 chars | 200 `{deleted:true, receipt:{memoryId, deletedAt}}` / 404 |

Both are **hard deletes**: the `Memory` node and its incident edges go away.
The owning `Session` node stays (forget drops the memory, not the session).

## Example

Base URL: `http://127.0.0.1:3111` (the default). When the upstream
`agentmemory` (iii) holds 3111, ours runs on 3151 — export
`AGENT_MEMORY_URL=http://127.0.0.1:3151` and use that base below. Never kill
the upstream instance. If `AGENT_MEMORY_SECRET` is set, add
`-H "authorization: Bearer $AGENT_MEMORY_SECRET"`.

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/forget \
  -H 'content-type: application/json' \
  -d '{"memoryId":"5f9c2a1e-8f6d-4b3a-9c11-0d2e4f5a6b7c"}'
```

Good response: `200 {"forgotten":true}`. Forgetting the same id again →
`404 {"error":"not_found"}`.

Audited variant (emits one governance log line with `memoryId`, `reason`,
`at` — the receipt itself omits the reason by design):

```bash
curl -sS -X POST http://127.0.0.1:3111/memory/delete \
  -H 'content-type: application/json' \
  -d '{"memoryId":"5f9c2a1e-8f6d-4b3a-9c11-0d2e4f5a6b7c","reason":"stale decision superseded by v2 design"}'
```

→ `200 {"deleted":true,"receipt":{"memoryId":"…","deletedAt":"2026-09-23T14:05:00.000Z"}}`.

## Rules

1. **Forget is permanent.** The node and its edges are gone — there is no
   undo, no tombstone, no soft-delete.
2. **Needs a concrete `memoryId`** from `memory_save` or a search/recap
   result — never guess or construct an id (wrong id = 404, never a delete).
3. **Prefer `memory_delete` when a reason exists**: same hard delete plus
   an auditable governance line — required for compliance-driven removals.
   Keep the reason free of secrets and PII (it lands in the log line).
4. **Sessions outlive memories**: after forgetting, the session still lists
   in `memory_sessions`; its memories listing simply no longer contains the
   row. `memory_health` counts reflect the deletion.
5. **Never store secrets or PII (Ley 172-13)** — and never place them in
   the delete `reason` either.

## Failure behavior

An unknown id returns `404 {"error":"not_found"}` — not an error to retry.
A failed store call surfaces as a transport error: run `memory_health`
(`GET /memory/health`) — the memory service is likely not running (check
`AGENT_MEMORY_URL`; default port 3111, ours runs on 3151 when upstream
occupies it). Deleting with a missing/over-long `reason` is a 400.
