/**
 * eval/metrics.ts — pure retrieval metrics (COND-QA-01).
 *
 * EXTRACTED VERBATIM from scripts/eval.ts (the scoring block that used to
 * live there): recallAt, ndcgAt10, scoreQuery, aggregate plus the QueryScore /
 * ModeAggregate shapes. Zero scoring behavior change — byte-identical bodies,
 * moved so both the harness and the unit goldens import ONE implementation.
 *
 * Properties (all enforced by scripts/verify-lifecycle.ts §H goldens):
 *  - PURE: no imports, no clock, no env reads, no randomness — same inputs
 *    -> byte-identical numbers in this process and any other.
 *  - Deterministic GIVEN (corpus, ranked ids): the metrics below only consume
 *    the ranked id list the harness received. The recall LEDGER that shapes
 *    search ORDERING is process-local warm best-effort state (RL-004) — that
 *    affects which ids arrive HERE, never how they are scored.
 *
 * Expected values in the §H goldens are hand-computed literals (never
 * computed via these functions), so a formula breakage cannot self-certify.
 */

export interface QueryScore {
  query: string;
  relevant: string[];
  /** 1-based rank of the first relevant doc in the top-10; 0 = not retrieved. */
  firstRank: number;
  recall5: number;
  recall10: number;
  /** 1/firstRank within top-10, else 0. */
  reciprocal: number;
  ndcg10: number;
}

export interface ModeAggregate {
  mode: "bm25" | "hybrid";
  recall5: number;
  recall10: number;
  mrr10: number;
  ndcg10: number;
  perQuery: QueryScore[];
}

export function recallAt(ranked: string[], relevant: string[], k: number): number {
  const top = new Set(ranked.slice(0, k));
  let found = 0;
  for (const id of relevant) if (top.has(id)) found += 1;
  return found / relevant.length;
}

export function ndcgAt10(ranked: string[], relevant: string[]): number {
  const relevantSet = new Set(relevant);
  let dcg = 0;
  const depth = Math.min(ranked.length, 10);
  for (let i = 0; i < depth; i++) {
    const id = ranked[i];
    if (id !== undefined && relevantSet.has(id)) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const ideal = Math.min(relevant.length, 10);
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

export function scoreQuery(query: string, ranked: string[], relevant: string[]): QueryScore {
  let firstRank = 0;
  for (let i = 0; i < ranked.length; i++) {
    const id = ranked[i];
    if (id !== undefined && relevant.includes(id)) {
      firstRank = i + 1;
      break;
    }
  }
  return {
    query,
    relevant,
    firstRank,
    recall5: recallAt(ranked, relevant, 5),
    recall10: recallAt(ranked, relevant, 10),
    reciprocal: firstRank > 0 ? 1 / firstRank : 0,
    ndcg10: ndcgAt10(ranked, relevant),
  };
}

export function aggregate(mode: "bm25" | "hybrid", perQuery: QueryScore[]): ModeAggregate {
  const n = perQuery.length;
  const mean = (pick: (score: QueryScore) => number): number =>
    perQuery.reduce((sum, score) => sum + pick(score), 0) / n;
  return {
    mode,
    recall5: mean((score) => score.recall5),
    recall10: mean((score) => score.recall10),
    mrr10: mean((score) => score.reciprocal),
    ndcg10: mean((score) => score.ndcg10),
    perQuery,
  };
}
