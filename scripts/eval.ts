/**
 * scripts/eval.ts — adapter-pluggable retrieval eval harness (REQ-P1-5).
 *
 * Seeds the in-repo corpus (eval/corpus.ts) into a DEDICATED tenant project
 * and scores both retrieval modes, then writes docs/benchmarks/SCORECARD.md.
 *
 *   Adapter pluggability: `EvalClient` is the only surface the scoring loop
 *   touches. `EVAL_MODE` (default `rest`) selects the implementation in
 *   `createClient()`; adding another mode needs one new class implementing
 *   `EvalClient` plus one factory branch — seed, metrics, and scorecard code
 *   stay untouched. The shipped implementation is `RestClient` (global fetch,
 *   base URL from AGENT_MEMORY_URL, contract default http://127.0.0.1:3111).
 *   `search`/`smartSearch` return store memoryIds; the harness maps them to
 *   corpus doc ids through the seed map it builds.
 *
 *   Project isolation: EVERY remember/search uses project `agent-memory-eval`
 *   — never "default" — so this run never collides with Lane A's verify suite
 *   on the shared Helix dev instance.
 *
 *   Safety: a read-only identity guard (the scripts/verify.ts pattern: POST
 *   /memory/recap must 200 = OUR P3.1 server) runs BEFORE the health gate and
 *   before any write, so pointing AGENT_MEMORY_URL at the upstream
 *   agentmemory (its default port 3111 — never killed, never written to)
 *   aborts with no data written. The health gate must return counts or the
 *   harness exits 1 with the runbook below.
 *
 *   Idempotency: seeding twice per run relies on P1.6 content dedup — pass 2
 *   must return the SAME id with `deduped:true` for every doc, and the
 *   project-scoped health count must equal the corpus size afterwards (an
 *   edited doc dedups to a NEW id and leaves its old row behind, so drift
 *   fails loudly as a corpus-content bug).
 *
 *   Metrics over all queries, cutoffs 5/10: Recall@5, Recall@10, MRR@10
 *   (first relevant rank), nDCG@10 (binary relevance). No randomness
 *   anywhere — identical inputs produce identical numbers.
 *
 *   Security: AGENT_MEMORY_SECRET, when non-empty, is added as a bearer
 *   header and never logged; the scorecard and stdout carry no secrets or
 *   PII (the corpus is invented dev/ops facts).
 *
 * Exit codes: 0 success (scorecard written), 1 any failure (clear message).
 *
 * Reproduce (also written into the scorecard):
 *   terminal 1:  AGENT_MEMORY_PORT=3152 npx tsx src/server.ts
 *   terminal 2:  AGENT_MEMORY_URL=http://127.0.0.1:3152 npx tsx scripts/eval.ts
 * Helix dev (localhost:6969) must already be up — never restart/stop it.
 * If searches report index_not_found, run `npx tsx scripts/bootstrap.ts`
 * (idempotent) first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { logSafeNote } from "../src/errors.js";
import { EVAL_DOCS, EVAL_QUERIES, type EvalDoc, type EvalQuery } from "../eval/corpus.js";

/* ------------------------------------------------------------------ */
/* Configuration (env-driven, contract naming)                          */
/* ------------------------------------------------------------------ */

/** Dedicated tenant — isolation from every other suite on this Helix instance. */
const EVAL_PROJECT = "agent-memory-eval";
const SEED_SESSION_ID = "eval-seed";
const SEED_ORIGIN = "eval";
/** Contract default (docs/CONTRACT.md §3) — the runbook exports our port. */
const BASE = new URL(process.env["AGENT_MEMORY_URL"] ?? "http://127.0.0.1:3111");
const NORMALIZED_BASE = new URL(BASE.href.endsWith("/") ? BASE.href : `${BASE.href}/`);
const SECRET = process.env["AGENT_MEMORY_SECRET"];
/** Top-k for every search: Recall@5/@10, MRR@10, nDCG@10 all fit in 10. */
const EVAL_LIMIT = 10;
const SMOKE_ATTEMPTS = 5;
const SMOKE_RETRY_MS = 2_000;
const HTTP_TIMEOUT_MS = 10_000;
const SCORECARD_PATH = new URL("../docs/benchmarks/SCORECARD.md", import.meta.url);
const SCORECARD_DISPLAY = "docs/benchmarks/SCORECARD.md";

/* ------------------------------------------------------------------ */
/* Failure plumbing                                                    */
/* ------------------------------------------------------------------ */

function fail(message: string): never {
  console.error(`eval: FAIL — ${message}`);
  process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function brief(body: unknown): string {
  try {
    return (JSON.stringify(body) ?? "undefined").slice(0, 300);
  } catch {
    return String(body).slice(0, 300);
  }
}

/* ------------------------------------------------------------------ */
/* Shared HTTP (one auth implementation for adapter AND harness checks) */
/* ------------------------------------------------------------------ */

interface HttpResult {
  status: number;
  body: unknown;
}

function endpoint(path: string, query?: Record<string, string>): URL {
  const url = new URL(path.replace(/^\//, ""), NORMALIZED_BASE);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url;
}

/** Bearer header only when AGENT_MEMORY_SECRET is non-empty; never logged. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (typeof SECRET === "string" && SECRET.length > 0) {
    headers["authorization"] = `Bearer ${SECRET}`;
  }
  return headers;
}

async function call(
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<HttpResult> {
  const headers = authHeaders(body !== undefined ? { "content-type": "application/json" } : {});
  try {
    const response = await fetch(endpoint(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  } catch (err) {
    return { status: -1, body: logSafeNote(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Contract §3 response shapes (narrowed, never trusted)                */
/* ------------------------------------------------------------------ */

const healthEnvelopeSchema = z.object({
  status: z.literal("ok"),
  counts: z.object({ memories: z.number(), sessions: z.number() }),
});

const rememberResultSchema = z.object({ id: z.string().min(1), deduped: z.boolean() });

const searchEnvelopeSchema = z.object({
  mode: z.enum(["bm25", "hybrid"]),
  results: z.array(z.object({ memoryId: z.string().min(1) })),
});

type RememberResult = z.infer<typeof rememberResultSchema>;
type SearchEnvelope = z.infer<typeof searchEnvelopeSchema>;

function parseOrFail<T>(what: string, body: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return fail(`${what} shape drift — ${detail} — body=${brief(body)}`);
}

/** Project-scoped health counts (contract §3 GET /memory/health?project=). */
async function fetchHealthCounts(): Promise<{ memories: number; sessions: number }> {
  const response = await call("GET", "memory/health", { project: EVAL_PROJECT });
  if (response.status !== 200) {
    throw new Error(`GET memory/health?project=${EVAL_PROJECT} -> ${response.status}`);
  }
  const envelope = parseOrFail("health envelope", response.body, healthEnvelopeSchema);
  return envelope.counts;
}

/* ------------------------------------------------------------------ */
/* Adapter surface (pluggability — new EVAL_MODE = new impl + branch)   */
/* ------------------------------------------------------------------ */

export interface EvalClient {
  /** Gate: resolves when the target answers with counts, throws otherwise. */
  health(): Promise<void>;
  remember(doc: EvalDoc): Promise<{ id: string; deduped: boolean }>;
  search(query: string, limit: number): Promise<string[]>;
  smartSearch(query: string, concepts: string[], limit: number): Promise<string[]>;
}

/** REST implementation over the frozen contract §3 routes. */
class RestClient implements EvalClient {
  async health(): Promise<void> {
    await fetchHealthCounts();
  }

  async remember(doc: EvalDoc): Promise<RememberResult> {
    const response = await call("POST", "memory/remember", undefined, {
      content: doc.content,
      concepts: doc.concepts,
      project: EVAL_PROJECT,
      sessionId: SEED_SESSION_ID,
      origin: SEED_ORIGIN,
    });
    if (response.status !== 201) {
      return fail(
        `remember(${doc.id}) -> ${response.status} (expected 201) — body=${brief(response.body)}`,
      );
    }
    return parseOrFail(`remember(${doc.id})`, response.body, rememberResultSchema);
  }

  async search(query: string, limit: number): Promise<string[]> {
    const response = await call("POST", "memory/search", undefined, {
      query,
      project: EVAL_PROJECT,
      limit,
    });
    if (response.status !== 200) {
      return fail(`search -> ${response.status} (expected 200) — body=${brief(response.body)}`);
    }
    const envelope = parseOrFail("search envelope", response.body, searchEnvelopeSchema);
    if (envelope.mode !== "bm25") {
      return fail(`search envelope mode drift — expected "bm25", got "${envelope.mode}"`);
    }
    return envelope.results.map((row) => row.memoryId);
  }

  async smartSearch(query: string, concepts: string[], limit: number): Promise<string[]> {
    const response = await call("POST", "memory/smart-search", undefined, {
      query,
      concepts,
      project: EVAL_PROJECT,
      limit,
    });
    if (response.status !== 200) {
      return fail(`smart-search -> ${response.status} (expected 200) — body=${brief(response.body)}`);
    }
    const envelope = parseOrFail("smart-search envelope", response.body, searchEnvelopeSchema);
    if (envelope.mode !== "hybrid") {
      return fail(`smart-search envelope mode drift — expected "hybrid", got "${envelope.mode}"`);
    }
    return envelope.results.map((row) => row.memoryId);
  }
}

/**
 * Selects the adapter. Pluggability contract: a new EVAL_MODE value only
 * needs another `EvalClient` implementation registered below — nothing else
 * in this harness changes. Unknown modes fail closed.
 */
function createClient(): EvalClient {
  const mode = process.env["EVAL_MODE"] ?? "rest";
  switch (mode) {
    case "rest":
      return new RestClient();
    default:
      return fail(
        `EVAL_MODE="${mode}" is not implemented — add an EvalClient implementation and a branch in createClient()`,
      );
  }
}

/* ------------------------------------------------------------------ */
/* Corpus validation (fail loudly before touching the server)           */
/* ------------------------------------------------------------------ */

function validateCorpus(): void {
  const ids = new Set<string>();
  for (const doc of EVAL_DOCS) {
    if (doc.id.trim().length === 0) fail("corpus: empty doc id");
    if (ids.has(doc.id)) fail(`corpus: duplicate doc id "${doc.id}"`);
    ids.add(doc.id);
    if (doc.content.trim().length === 0) fail(`corpus: empty content for ${doc.id}`);
    if (doc.concepts.length < 1 || doc.concepts.length > 4) {
      fail(`corpus: ${doc.id} must carry 1-4 concepts, got ${doc.concepts.length}`);
    }
  }
  if (EVAL_QUERIES.length === 0) fail("corpus: no queries");
  for (const entry of EVAL_QUERIES) {
    if (entry.query.trim().length === 0) fail("corpus: empty query text");
    if (entry.relevant.length < 1 || entry.relevant.length > 3) {
      fail(`corpus: query "${entry.query}" must have 1-3 relevant docs, got ${entry.relevant.length}`);
    }
    for (const docId of entry.relevant) {
      if (!ids.has(docId)) {
        fail(`corpus: query "${entry.query}" references unknown doc "${docId}"`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Metrics (deterministic, binary relevance)                           */
/* ------------------------------------------------------------------ */

interface QueryScore {
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

interface ModeAggregate {
  mode: "bm25" | "hybrid";
  recall5: number;
  recall10: number;
  mrr10: number;
  ndcg10: number;
  perQuery: QueryScore[];
}

function recallAt(ranked: string[], relevant: string[], k: number): number {
  const top = new Set(ranked.slice(0, k));
  let found = 0;
  for (const id of relevant) if (top.has(id)) found += 1;
  return found / relevant.length;
}

function ndcgAt10(ranked: string[], relevant: string[]): number {
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

function scoreQuery(query: string, ranked: string[], relevant: string[]): QueryScore {
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

function aggregate(mode: "bm25" | "hybrid", perQuery: QueryScore[]): ModeAggregate {
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

/* ------------------------------------------------------------------ */
/* Scorecard rendering                                                 */
/* ------------------------------------------------------------------ */

const fmt = (value: number): string => value.toFixed(4);

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function renderScorecard(
  dateIso: string,
  mode: string,
  counts: { memories: number; sessions: number },
  dedupedPass2: number,
  smokeAttempts: number,
  bm25: ModeAggregate,
  hybrid: ModeAggregate,
): string {
  const lines: string[] = [];
  lines.push("# agent-memory retrieval scorecard");
  lines.push("");
  lines.push("All numbers below were generated by this run against OUR server");
  lines.push("(`scripts/eval.ts`) — our measurements, nothing borrowed from any upstream.");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Date (ISO) | ${dateIso} |`);
  lines.push(`| Harness | scripts/eval.ts (REQ-P1-5), EVAL_MODE=${mode} |`);
  lines.push(
    `| Corpus | eval/corpus.ts — ${EVAL_DOCS.length} documents, ${EVAL_QUERIES.length} queries ` +
      `(qrels 1-3 per query; in-repo, deterministic, zero network) |`,
  );
  lines.push(`| Project (tenant) | ${EVAL_PROJECT} |`);
  lines.push(`| Server | ${NORMALIZED_BASE.href.replace(/\/$/, "")} |`);
  lines.push(
    `| Rows after seed | ${counts.memories} (health counts: memories=${counts.memories}, ` +
      `sessions=${counts.sessions}) |`,
  );
  lines.push(
    `| Seed | sessionId=${SEED_SESSION_ID}, origin=${SEED_ORIGIN}, explicit concepts; ` +
      `re-runs collapse via content dedup (pass 2: ${dedupedPass2}/${EVAL_DOCS.length} deduped, stable ids) |`,
  );
  lines.push(`| Smoke query | first query retrievable on attempt ${smokeAttempts}/${SMOKE_ATTEMPTS} |`);
  lines.push(
    "| Hybrid note | `smart-search` called with `concepts: []` — the graph branch is INACTIVE; " +
      "hybrid = vector + text RRF fusion only |",
  );
  lines.push("");
  lines.push(`## Aggregate (mean over ${EVAL_QUERIES.length} queries)`);
  lines.push("");
  lines.push("| mode | Recall@5 | Recall@10 | MRR@10 | nDCG@10 |");
  lines.push("|---|---|---|---|---|");
  for (const agg of [bm25, hybrid]) {
    lines.push(
      `| ${agg.mode} | ${fmt(agg.recall5)} | ${fmt(agg.recall10)} | ${fmt(agg.mrr10)} | ${fmt(agg.ndcg10)} |`,
    );
  }
  lines.push("");
  lines.push("Metrics: Recall@k = mean |relevant ∩ top-k| / |relevant|; MRR@10 = mean 1/rank of the");
  lines.push("first relevant doc (0 when none in top-10); nDCG@10 = binary-relevance DCG / IDCG.");
  lines.push("");
  lines.push("## Per-query appendix");
  lines.push("");
  lines.push("| # | query | relevant | bm25 first rank | hybrid first rank |");
  lines.push("|---|---|---|---|---|");
  for (let i = 0; i < bm25.perQuery.length; i++) {
    const b = bm25.perQuery[i];
    const h = hybrid.perQuery[i];
    if (b === undefined || h === undefined) continue;
    lines.push(
      `| ${i + 1} | ${mdCell(b.query)} | ${b.relevant.join(", ")} | ` +
        `${b.firstRank > 0 ? String(b.firstRank) : "—"} | ${h.firstRank > 0 ? String(h.firstRank) : "—"} |`,
    );
  }
  lines.push("");
  lines.push("`first rank` = 1-based rank of the first relevant document within the top-10");
  lines.push("(`—` = not retrieved in the top-10). Ranks plus qrels reproduce every aggregate cell.");
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("# terminal 1 — OUR REST server on port 3152");
  lines.push("# (Helix dev at localhost:6969 must already be up — NEVER restart or stop it;");
  lines.push("#  3111 may be held by the upstream agentmemory — never kill it, never write to it)");
  lines.push("AGENT_MEMORY_PORT=3152 npx tsx src/server.ts");
  lines.push("");
  lines.push("# terminal 2 — run the harness (AGENT_MEMORY_URL defaults to the contract");
  lines.push("# default http://127.0.0.1:3111; point it at OUR server's port)");
  lines.push("AGENT_MEMORY_URL=http://127.0.0.1:3152 npx tsx scripts/eval.ts");
  lines.push("```");
  lines.push("");
  lines.push("Notes:");
  lines.push("");
  lines.push(`- The harness identity-guards first (POST /memory/recap must 200) and refuses to`);
  lines.push(`  write anywhere that is not our server; it exits 1 with the runbook when the health`);
  lines.push(`  gate fails. All calls use the dedicated project \`${EVAL_PROJECT}\`.`);
  lines.push(`- \`EVAL_MODE\` defaults to \`rest\`; a new mode only needs another \`EvalClient\``);
  lines.push(`  implementation in \`scripts/eval.ts\`.`);
  lines.push(`- \`AGENT_MEMORY_SECRET\` is forwarded as a bearer header when set (never logged).`);
  lines.push(`- If searches report \`index_not_found\`, run \`npx tsx scripts/bootstrap.ts\` first`);
  lines.push(`  (idempotent), then re-run.`);
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  validateCorpus();
  const client = createClient();
  const mode = process.env["EVAL_MODE"] ?? "rest";
  console.log(`eval: target=${NORMALIZED_BASE.href} mode=${mode} project=${EVAL_PROJECT} ` +
    `docs=${EVAL_DOCS.length} queries=${EVAL_QUERIES.length}`);

  /* Identity guard (scripts/verify.ts pattern) — read-only, BEFORE any write. */
  const identity = await call("POST", "memory/recap", undefined, {});
  if (identity.status === -1) {
    fail(
      `cannot reach ${NORMALIZED_BASE.href} (GET/recap unreachable: ${String(identity.body)}) — ` +
        `start OUR server first:\n\n  AGENT_MEMORY_PORT=3152 npx tsx src/server.ts\n\n` +
        `then re-run:\n\n  AGENT_MEMORY_URL=http://127.0.0.1:3152 npx tsx scripts/eval.ts\n\n` +
        `No data was written.`,
    );
  }
  if (identity.status === 401) {
    fail(
      `target ${NORMALIZED_BASE.href} requires bearer auth — export AGENT_MEMORY_SECRET in this ` +
        `shell (same value as the server) and re-run. No data was written.`,
    );
  }
  if (identity.status !== 200) {
    fail(
      `identity guard: POST memory/recap -> ${identity.status} (body=${brief(identity.body)}) — ` +
        `expected 200 from OUR P3.1 server. The upstream agentmemory most likely holds this ` +
        `port (3111 is its default) — NEVER kill it; point AGENT_MEMORY_URL at OUR server's ` +
        `port (see the runbook) and re-run. No data was written.`,
    );
  }
  console.log("identity: POST memory/recap -> 200 (our server), proceeding");

  /* Health gate — must return counts, else exit 1 with the runbook. */
  try {
    await client.health();
  } catch (err) {
    fail(
      `health gate failed at ${NORMALIZED_BASE.href} (${logSafeNote(err)}) — start OUR server ` +
        `(AGENT_MEMORY_PORT=3152 npx tsx src/server.ts), then re-run with ` +
        `AGENT_MEMORY_URL=http://127.0.0.1:3152 npx tsx scripts/eval.ts`,
    );
  }
  console.log("health: gate passed (counts present)");

  /* Seed pass 1 — content dedup makes this idempotent across runs (P1.6). */
  const idByDoc = new Map<string, string>();
  for (const doc of EVAL_DOCS) {
    const result = await client.remember(doc);
    idByDoc.set(doc.id, result.id);
  }
  const rememberedIds = new Set<string>();
  for (const [docId, memoryId] of idByDoc) {
    if (rememberedIds.has(memoryId)) {
      fail(
        `corpus-content bug: docs resolved to the same remembered id ${memoryId} — ` +
          `duplicate (normalized) content in eval/corpus.ts (doc "${docId}")`,
      );
    }
    rememberedIds.add(memoryId);
  }
  console.log(`seed pass 1: ${EVAL_DOCS.length} docs remembered (${rememberedIds.size} unique ids)`);

  /* Seed pass 2 — same doc must map to the SAME id with deduped=true, or the
   * corpus content changed mid-run / dedup is broken: fail loudly. */
  let dedupedPass2 = 0;
  for (const doc of EVAL_DOCS) {
    const result = await client.remember(doc);
    const first = idByDoc.get(doc.id);
    if (first === undefined) fail(`seed pass 1 lost doc "${doc.id}"`);
    if (result.id !== first) {
      fail(
        `corpus-content bug: doc "${doc.id}" mapped to id ${first} on seed but ${result.id} ` +
          `on re-seed — remembered ids are content-derived (dedupKey), so eval/corpus.ts ` +
          `content must never change between writes of one run`,
      );
    }
    if (result.deduped !== true) {
      fail(`re-seed of "${doc.id}" returned deduped=${String(result.deduped)} — expected true`);
    }
    dedupedPass2 += 1;
  }
  console.log(`seed pass 2: ${dedupedPass2}/${EVAL_DOCS.length} deduped with stable ids`);

  /* Project-scoped row count: exactly one row per doc, nothing else. An edited
   * doc dedups to a NEW id and leaves its old row behind -> count drift -> fail. */
  let counts: { memories: number; sessions: number };
  try {
    counts = await fetchHealthCounts();
  } catch (err) {
    fail(`post-seed health counts failed (${logSafeNote(err)})`);
  }
  if (counts.memories !== EVAL_DOCS.length) {
    fail(
      `project ${EVAL_PROJECT} holds ${counts.memories} rows but the corpus has ` +
        `${EVAL_DOCS.length} docs — stale rows from an earlier corpus version (edited content ` +
        `dedups to a NEW id, leaving the old row) or foreign data. This is a corpus-content ` +
        `bug: restore eval/corpus.ts or clear the stale rows (POST /memory/forget per id) ` +
        `before re-running.`,
    );
  }
  console.log(
    `counts: memories=${counts.memories} sessions=${counts.sessions} (project ${EVAL_PROJECT})`,
  );

  /* Smoke query — index freshness after the first seed. */
  const firstQuery: EvalQuery | undefined = EVAL_QUERIES[0];
  if (firstQuery === undefined) fail("corpus has no queries");
  let smokeHits: string[] = [];
  let smokeAttempt = 0;
  for (let attempt = 1; attempt <= SMOKE_ATTEMPTS; attempt++) {
    smokeAttempt = attempt;
    smokeHits = await client.search(firstQuery.query, EVAL_LIMIT);
    if (smokeHits.length > 0) break;
    if (attempt < SMOKE_ATTEMPTS) await sleep(SMOKE_RETRY_MS);
  }
  if (smokeHits.length === 0) {
    fail(
      `smoke query returned 0 rows after ${SMOKE_ATTEMPTS} attempts — if the server log shows ` +
        `index_not_found, run "npx tsx scripts/bootstrap.ts" (idempotent) and re-run the harness`,
    );
  }
  console.log(`smoke: ${smokeHits.length} rows on attempt ${smokeAttempt}/${SMOKE_ATTEMPTS}`);

  /* Score both modes over every query; map store memoryIds -> corpus doc ids. */
  const docByMemory = new Map<string, string>();
  for (const [docId, memoryId] of idByDoc) docByMemory.set(memoryId, docId);

  const mapToDocIds = (memoryIds: string[], context: string): string[] => {
    const mapped: string[] = [];
    for (const memoryId of memoryIds) {
      const docId = docByMemory.get(memoryId);
      if (docId === undefined) {
        fail(
          `${context} returned memoryId ${memoryId} outside the seeded corpus — project ` +
            `${EVAL_PROJECT} contains foreign rows`,
        );
      }
      mapped.push(docId);
    }
    return mapped;
  };

  const bm25Scores: QueryScore[] = [];
  const hybridScores: QueryScore[] = [];
  for (const entry of EVAL_QUERIES) {
    const bm25Ranked = mapToDocIds(await client.search(entry.query, EVAL_LIMIT), "search");
    const hybridRanked = mapToDocIds(
      await client.smartSearch(entry.query, [], EVAL_LIMIT),
      "smart-search",
    );
    bm25Scores.push(scoreQuery(entry.query, bm25Ranked, entry.relevant));
    hybridScores.push(scoreQuery(entry.query, hybridRanked, entry.relevant));
  }
  const bm25 = aggregate("bm25", bm25Scores);
  const hybrid = aggregate("hybrid", hybridScores);
  console.log(`scored: ${EVAL_QUERIES.length} queries x 2 modes`);

  /* Sanity gate — a 0 here means the corpus wording overlap is broken. */
  if (bm25.recall5 <= 0 || hybrid.recall5 <= 0) {
    fail(
      `Recall@5 must be > 0 for both modes (bm25=${fmt(bm25.recall5)}, ` +
        `hybrid=${fmt(hybrid.recall5)}) — the query/doc token overlap in eval/corpus.ts is ` +
        `broken; fix the corpus wording, not the metric`,
    );
  }

  /* Write the scorecard (overwrite) + compact stdout summary. */
  const dateIso = new Date().toISOString();
  const markdown = renderScorecard(dateIso, mode, counts, dedupedPass2, smokeAttempt, bm25, hybrid);
  mkdirSync(new URL("../docs/benchmarks/", import.meta.url), { recursive: true });
  writeFileSync(SCORECARD_PATH, markdown, "utf8");

  console.log("");
  console.log(`eval summary — ${EVAL_QUERIES.length} queries, project=${EVAL_PROJECT}, EVAL_MODE=${mode}`);
  console.log("mode    R@5     R@10    MRR@10  nDCG@10");
  for (const agg of [bm25, hybrid]) {
    console.log(
      `${agg.mode.padEnd(7)} ${fmt(agg.recall5)}  ${fmt(agg.recall10)}  ${fmt(agg.mrr10)}  ${fmt(agg.ndcg10)}`,
    );
  }
  console.log(`scorecard: ${SCORECARD_DISPLAY}`);
  console.log("EVAL PASS");
}

main().catch((err: unknown) => {
  console.error(`eval crashed: ${logSafeNote(err)}`);
  process.exit(1);
});
