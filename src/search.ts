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
 *   boosted-DECAYED `importance` (desc — decay first, then the REQ-P1-4
 *   recall boost, see compareFusedAt), then `createdAt` (desc — newest
 *   first), then `memoryId` (asc) so output is fully deterministic. RRF
 *   score wins first — the boost only ever reorders exact score ties.
 *
 * Each upstream source runs independently; a source failure is caught and
 * recorded in `signals` while the remaining sources still contribute rows.
 * Even an all-sources-down search returns 200 with empty results + signals.
 *
 * REQ-P1-4: every row actually RETURNED (post-TTL) is noted in the in-process
 * recall ledger (src/confidence.ts) — hidden/expired rows are never recalled.
 */
import { embed } from "./embed.js";
import { confidenceBoost, noteRecall, recallCount } from "./confidence.js";
import { failureSignal } from "./errors.js";
import { decayedImportance, filterExpired } from "./lifecycle.js";
import type { MemoryStore, SearchHit } from "./store.js";

/** RRF constant (frozen by contract §3). */
export const RRF_K = 60;

/** Signal appended when TTL filtering hid rows (REQ-P1-1). */
function ttlSignal(hidden: number): string {
  return `ttl: hidden ${hidden} expired rows`;
}

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
  // REQ-P1-1: TTL filter right before return (no over-fetch — the store
  // already returned at most `limit` rows; filtering may yield fewer).
  const rows = outcome.hits.map((hit) => ({ ...hit, source: "text" as const }));
  const kept = filterExpired(rows, Date.now());
  const hidden = rows.length - kept.length;
  // REQ-P1-4: record recalls for the rows actually RETURNED. Expired (TTL-
  // hidden) rows were never recalled; noteRecall ignores empty memoryId.
  for (const row of kept) noteRecall(row.memoryId);
  return {
    mode: "bm25",
    results: kept,
    signals: hidden > 0 ? [ttlSignal(hidden)] : [],
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

/**
 * Fused comparator with a FIXED clock (REQ-P1-1): `nowMs` is captured once
 * per search so every row in one result set is compared against the same
 * instant — a tie-break can never flip mid-sort.
 *
 * Tie order (frozen, contract §3 as amended by REQ-P1-4):
 *   1. RRF score DESC — wins FIRST. Everything below only reorders exact
 *      score TIES; a recall can never promote a row over a higher score.
 *   2. confidenceBoost(decayedImportance(...), recallCount(memoryId)):
 *      DECAY FIRST (λ from AGENT_MEMORY_DECAY_LAMBDA, factor 1 when off,
 *      so this is byte-identical to the old stored-importance comparison
 *      when decay is OFF and the row was never recalled), THEN the recall
 *      boost (+0.2·n/(n+1), in-process ledger — src/confidence.ts).
 *      Neither rewrites the row's stored `importance` — both influence
 *      ORDER only. Counts come from PRIOR searches: noteRecall runs after
 *      this sort, so a search never reorders itself.
 *   3. createdAt DESC (newest first).
 *   4. memoryId ASC — fully deterministic.
 */
/**
 * Tie-break score for one fused row (COND-QA-02 / CE-002), extracted
 * VERBATIM from compareFusedAt so the ORDER of the two operations is
 * unit-testable: DECAY FIRST (`stored · e^(−λ·ageDays)`, λ off → factor 1),
 * THEN the recall boost `+0.2·n/(n+1)` (src/confidence.ts) — the reverse
 * order would boost a stale value before decaying it. Pure: `nowMs` and
 * `recallCount` arrive from the caller (the ledger is read OUTSIDE, by
 * compareFusedAt), so same inputs → byte-identical output, no clock, no env
 * read here (env is read inside decayedImportance per its own contract).
 */
export function tieBreakImportance(
  storedImportance: number,
  createdAt: string,
  nowMs: number,
  recallCount: number,
): number {
  return confidenceBoost(decayedImportance(storedImportance, createdAt, nowMs), recallCount);
}

function compareFusedAt(nowMs: number): (a: FusedResultRow, b: FusedResultRow) => number {
  return (a, b) => {
    if (b.score !== a.score) return b.score - a.score; // RRF score desc (ties only below)
    const boostedB = tieBreakImportance(b.importance, b.createdAt, nowMs, recallCount(b.memoryId));
    const boostedA = tieBreakImportance(a.importance, a.createdAt, nowMs, recallCount(a.memoryId));
    if (boostedB !== boostedA) return boostedB - boostedA; // boosted decayed importance desc
    const byDate = compareCreatedAtDesc(a.createdAt, b.createdAt); // newer first
    if (byDate !== 0) return byDate;
    return compareMemoryIdAsc(a.memoryId, b.memoryId); // fully deterministic
  };
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
  const nowMs = Date.now(); // one clock per search (REQ-P1-1 decay tie-break)

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

  const fusedRows: FusedResultRow[] = [];
  for (const entry of fused.values()) {
    fusedRows.push({ ...entry.hit, score: entry.score, source: entry.source, signals: [] });
  }
  fusedRows.sort(compareFusedAt(nowMs));

  // REQ-P1-1: TTL filter right before return (no over-fetch — upstream rows
  // were already capped at `limit`; filtering may yield fewer than limit).
  const sliced = fusedRows.slice(0, input.limit);
  const kept = filterExpired(sliced, nowMs);
  const hidden = sliced.length - kept.length;
  if (hidden > 0) signals.push(ttlSignal(hidden));
  // REQ-P1-4: record recalls for the rows actually RETURNED. Deliberately
  // AFTER the sort above — this search's notes never reorder this result
  // set (they apply to the NEXT search that returns the same rows).
  for (const row of kept) noteRecall(row.memoryId);

  // Envelope signals (source failures + ttl) are attached per row AFTER the
  // filter decision, so rows and envelope always agree.
  const results = kept.map((row) => ({ ...row, signals: [...signals] }));

  return { mode: "hybrid", results, signals };
}
