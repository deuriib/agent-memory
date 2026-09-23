/**
 * db/index.ts — public surface of the query layer (CONTRACT §2).
 * Callers should import from `db` (this file) rather than reaching into
 * `db/queries.ts` internals.
 */
export {
  LABELS,
  EDGES,
  EMBED_DIM,
  bootstrapIndexes,
  saveMemory,
  listSessions,
  sessionMemories,
  searchByVector,
  searchByText,
  graphSearch,
  forgetMemory,
  healthCount,
  findMemoryByDedupKey,
  saveMemoryParams,
  listSessionsParams,
  sessionMemoriesParams,
  searchByVectorParams,
  searchByTextParams,
  graphSearchParams,
  forgetMemoryParams,
  healthCountParams,
  findMemoryByDedupKeyParams,
} from "./queries";
