/**
 * App-layer hybrid retrieval (contract §3).
 *
 * - `bm25Search`  -> the `/search` route (text only, degrades to `results: []`
 *   + `signals` on upstream failure — never a 500).
 * - `hybridSearch` -> the `/smart-search` route: vector + text (+ graph when
 *   concepts are present), fused with Reciprocal Rank Fusion:
 *
 *       score(doc) = Σ 1 / (60 + rank_i)     over every source that returned it
 *
 *   ranks are 1-based (standard RRF, Cormack et al.). Ties break by
 *   `importance` (desc), then `createdAt` (desc — newest first), then
 *   `memoryId` (asc) so output is fully deterministic.
 *
 * Each upstream source runs independently; a source failure is caught and
 * recorded in `signals` while the remaining sources still contribute rows.
 * Even an all-sources-down search returns 200 with empty results + signals.
 */
import { embed } from "./embed.js";
import { failureSignal } from "./errors.js";
import type { MemoryStore, SearchHit } from "./store.js";

/** RRF constant (frozen by contract §3). */
export const RRF_K = 60;

export type SearchSource = "vector" | "text" | "graph";

const SOURCE_PRIORITY: Record<SearchSource, number> = { vector: 0, text: 1, graph: 2 };

/** Contract §3 result row: base fields + `source`. */
export interface SearchResultRow extends SearchHit {
  source: SearchSource;
}

/** Fused rows additionally carry `signals` (contract §3). */
export interface FusedResultRow extends SearchResultRow {
  signals: string[];
}

export interface SearchEnvelope<T> {
  mode: "bm25" | "hybrid";
  results: T[];
  /** Per-source failures (empty when every attempted source succeeded). */
  signals: string[];
}

export interface Bm25SearchInput {
  query: string;
  project: string;
  limit: number;
}

export interface HybridSearchInput {
  query: string;
  concepts: string[];
  project: string;
  limit: number;
}

type SourceOutcome =
  | { source: SearchSource; hits: SearchHit[]; failure?: undefined }
  | { source: SearchSource; hits?: undefined; failure: string };

async function runSource(
  source: SearchSource,
  run: () => Promise<SearchHit[]>,
): Promise<SourceOutcome> {
  try {
    return { source, hits: await run() };
  } catch (err) {
    return { source, failure: failureSignal(err) };
  }
}

/** Keyword (BM25) search. Degrades instead of throwing. */
export async function bm25Search(
  store: MemoryStore,
  input: Bm25SearchInput,
): Promise<SearchEnvelope<SearchResultRow>> {
  const outcome = await runSource("text", () =>
    store.searchByText({ q: input.query, project: input.project, k: input.limit }),
  );
  if (outcome.failure !== undefined) {
    return { mode: "bm25", results: [], signals: [`text: ${outcome.failure}`] };
  }
  return {
    mode: "bm25",
    results: outcome.hits.map((hit) => ({ ...hit, source: "text" })),
    signals: [],
  };
}

interface FusedEntry {
  score: number;
  hit: SearchHit;
  source: SearchSource;
  bestRank: number;
}

/** Newest first (ISO-8601 strings compare lexicographically). */
function compareCreatedAtDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function compareMemoryIdAsc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareFused(a: FusedResultRow, b: FusedResultRow): number {
  if (b.score !== a.score) return b.score - a.score; // RRF score desc
  if (b.importance !== a.importance) return b.importance - a.importance; // importance desc
  const byDate = compareCreatedAtDesc(a.createdAt, b.createdAt); // newer first
  if (byDate !== 0) return byDate;
  return compareMemoryIdAsc(a.memoryId, b.memoryId); // fully deterministic
}

/**
 * Hybrid search: run vector + text (+ graph when concepts are present),
 * fuse with RRF, tie-break, cut to `limit`. Never throws for upstream
 * failures — every failure lands in `signals`.
 */
export async function hybridSearch(
  store: MemoryStore,
  input: HybridSearchInput,
): Promise<SearchEnvelope<FusedResultRow>> {
  const tasks: Promise<SourceOutcome>[] = [
    runSource("vector", () =>
      store.searchByVector({
        queryVector: embed(input.query),
        project: input.project,
        k: input.limit,
      }),
    ),
    runSource("text", () =>
      store.searchByText({ q: input.query, project: input.project, k: input.limit }),
    ),
  ];
  if (input.concepts.length > 0) {
    tasks.push(
      runSource("graph", () =>
        store.graphSearch({ concepts: input.concepts, project: input.project, k: input.limit }),
      ),
    );
  }

  const outcomes = await Promise.all(tasks);

  const signals: string[] = [];
  const fused = new Map<string, FusedEntry>();

  for (const outcome of outcomes) {
    if (outcome.failure !== undefined) {
      signals.push(`${outcome.source}: ${outcome.failure}`);
      continue;
    }
    outcome.hits.forEach((hit, index) => {
      const rank = index + 1; // 1-based rank within this source
      const key = hit.memoryId !== "" ? hit.memoryId : hit.id;
      const existing = fused.get(key);
      if (existing === undefined) {
        fused.set(key, { score: 1 / (RRF_K + rank), hit, source: outcome.source, bestRank: rank });
        return;
      }
      existing.score += 1 / (RRF_K + rank);
      const betterRank = rank < existing.bestRank;
      const equalRankBetterSource =
        rank === existing.bestRank &&
        SOURCE_PRIORITY[outcome.source] < SOURCE_PRIORITY[existing.source];
      if (betterRank || equalRankBetterSource) {
        existing.bestRank = rank;
        existing.source = outcome.source;
        existing.hit = hit;
      }
    });
  }

  const results: FusedResultRow[] = [];
  for (const entry of fused.values()) {
    results.push({
      ...entry.hit,
      score: entry.score,
      source: entry.source,
      signals: [...signals],
    });
  }
  results.sort(compareFused);

  return { mode: "hybrid", results: results.slice(0, input.limit), signals };
}
