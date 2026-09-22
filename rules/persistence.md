# Persistence rule

Durable knowledge belongs in agent-memory, not only in the current context.

- Before answering questions that may depend on earlier sessions, recall with
  `memory_smart_search` (hybrid search). Fall back to `memory_search` for exact
  keyword lookups.
- After a decision is made, an issue is fixed, or a durable fact is learned,
  persist it with `memory_save` and relevant `concepts`.
- Never store secrets, credentials, tokens, or personal data in memory.
- A failing memory service must not block work: degrade, note it, continue.
