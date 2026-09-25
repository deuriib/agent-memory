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
 *   (first relevant rank), nDCG@10 (binary relevance). Determinism
 *   (qualified per RL-004): the metrics in eval/metrics.ts are PURE — same
 *   corpus + same ranked id lists produce byte-identical numbers. The recall
 *   LEDGER that shapes search ORDERING is process-local, warm, best-effort
 *   state (never persisted): it can reorder fused ties in a warm process,
 *   i.e. it affects which ids ARRIVE here, never how they are scored.
 *
 *   Security: AGENT_MEMORY_SECRET, when non-empty, is added as a bearer
 *   header and never logged; the scorecard and stdout carry no secrets or
 *   PII (the corpus is invented dev/ops facts).
 *
 * Exit codes: 0 success (scorecard written), 1 any failure (clear message).
 *
 * Reproduce (also written into the scorecard with the ACTUAL base URL this
 * run resolved — static example matches README's port):
 *   terminal 1:  AGENT_MEMORY_PORT=3151 npx tsx src/server.ts
 *   terminal 2:  AGENT_MEMORY_URL=http://127.0.0.1:3151 npx tsx scripts/eval.ts
 * Helix dev (localhost:6969) must already be up — never restart/stop it.
 * If searches report index_not_found, run `npx tsx scripts/bootstrap.ts`
 * (idempotent) first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { logSafeNote } from "../src/errors.js";
import { EVAL_DOCS, EVAL_QUERIES, type EvalDoc, type EvalQuery } from "../eval/corpus.js";
/* COND-QA-01: metrics extracted VERBATIM into eval/metrics.ts (pure, no
 * scripts/ imports) so the harness and the §H goldens score with ONE code
 * path — zero scoring behavior change. */
import { aggregate, scoreQuery, type ModeAggregate, type QueryScore } from "../eval/metrics.js";

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
/** ACTUAL port/origin of THIS run's target — the Reproduce block and the
 * fail runbooks print these instead of a hardcoded example port, so the
 * scorecard always tells the truth about where its numbers came from. */
const RUN_PORT =
  NORMALIZED_BASE.port !== ""
    ? NORMALIZED_BASE.port
    : NORMALIZED_BASE.protocol === "https:"
      ? "443"
      : "80";
const RUN_ORIGIN = NORMALIZED_BASE.origin; // scheme://host[:port], no trailing slash
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

/** Lenient shape for the graph path: graph-source hits may carry an empty
 * memoryId (product bug — filed cross-domain to R1). The harness maps those
 * to unique unusable sentinels (rank-occupying misses), never to qrels. */
const scaleRawEnvelopeSchema = z.object({
  mode: z.string(),
  results: z.array(z.object({ memoryId: z.string() })),
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
/* Metrics — extracted VERBATIM into eval/metrics.ts (COND-QA-01):      */
/* recallAt / ndcgAt10 / scoreQuery / aggregate + QueryScore /          */
/* ModeAggregate now live in the pure module imported above. Zero       */
/* scoring behavior change — one implementation, shared with the        */
/* verify-lifecycle §H goldens.                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Scorecard rendering                                                 */
/* ------------------------------------------------------------------ */

const fmt = (value: number): string => value.toFixed(4);

/** True when BOTH modes put every query's first relevant doc at rank 1. */
function allFirstRankOne(bm25: ModeAggregate, hybrid: ModeAggregate): boolean {
  return (
    bm25.perQuery.every((score) => score.firstRank === 1) &&
    hybrid.perQuery.every((score) => score.firstRank === 1)
  );
}

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
  lines.push(`Scope: CORPUS-SPECIFIC — ${EVAL_DOCS.length} documents / ${EVAL_QUERIES.length} queries from`);
  lines.push(
    allFirstRankOne(bm25, hybrid)
      ? "eval/corpus.ts only; in this run every query put its first relevant doc at rank 1 in"
      : "eval/corpus.ts only; see the per-query appendix for first ranks.",
  );
  if (allFirstRankOne(bm25, hybrid)) {
    lines.push(
      "both modes. That is a property of THIS small in-repo corpus — NOT a general retrieval-",
    );
    lines.push(
      "quality claim, and never a comparison against upstream: upstream agentmemory numbers are",
    );
    lines.push("never ours and are never mixed into this card.");
  } else {
    lines.push(
      "Scores are a property of THIS small in-repo corpus — NOT a general retrieval-quality claim,",
    );
    lines.push(
      "and never a comparison against upstream: upstream agentmemory numbers are never ours.",
    );
  }
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
  lines.push(`# terminal 1 — OUR REST server on port ${RUN_PORT} (the port THIS run actually used)`);
  lines.push("# (Helix dev at localhost:6969 must already be up — NEVER restart or stop it;");
  lines.push("#  3111 may be held by the upstream agentmemory — never kill it, never write to it)");
  lines.push(`AGENT_MEMORY_PORT=${RUN_PORT} npx tsx src/server.ts`);
  lines.push("");
  lines.push(`# terminal 2 — run the harness against the exact base URL of this run`);
  lines.push(`# (AGENT_MEMORY_URL defaults to the contract default http://127.0.0.1:3111)`);
  lines.push(`AGENT_MEMORY_URL=${RUN_ORIGIN} npx tsx scripts/eval.ts`);
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
  lines.push(`- Determinism (RL-004): the metrics are pure — same corpus + same ranked ids ->`);
  lines.push(`  identical numbers. Search ORDERING can differ in a warm process because the`);
  lines.push(`  in-process recall ledger (never persisted) tilts fused ties; the ranks in this`);
  lines.push(`  appendix are what THIS run observed.`);
  lines.push(`- If searches report \`index_not_found\`, run \`npx tsx scripts/bootstrap.ts\` first`);
  lines.push(`  (idempotent), then re-run.`);
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Scale mode (--scale N): NFR-01 latency proof at gate scale          */
/*                                                                     */
/* Default behavior (no flag) is UNCHANGED: main() below runs the      */
/* 40-doc corpus, writes the scorecard, prints EVAL PASS. Scale mode   */
/* uses a SEPARATE tenant project, never touches the scorecard file,   */
/* and prints a paste-ready markdown block to stdout.                  */
/*                                                                     */
/* Corpus: deterministic mulberry32(SEED) generation. 25 probe topics  */
/* x 8 docs carry a planted distinctive token pair (qrels); the rest   */
/* are distractors from a generic pool that never contains probe       */
/* tokens (asserted at build time). Every doc carries an 8-word nonce  */
/* tail (asserted pairwise Jaccard < 0.85 at build) so the product's   */
/* near-dup consolidation (default Jaccard >= 0.9) never merges two    */
/* scale docs — the run measures retrieval, not consolidation. The     */
/* graph leg is exercised through the concepts branch of               */
/* POST /memory/smart-search (topic-tag concepts per probe query);     */
/* POST /v1/link is NOT used — it operates on PARA Note nodes, not     */
/* memory rows, so it cannot link scale memories. Quality metrics are  */
/* therefore meaningful (planted qrels), not vacuous — and latency is  */
/* client-measured round-trip per search.                              */
/* ------------------------------------------------------------------ */

const SCALE_PROJECT = "agent-memory-eval-scale";
const SCALE_SESSION_ID = "eval-scale-seed";
const SCALE_ORIGIN = "eval-scale";
const SCALE_SEED = 20260925;
const SCALE_DEFAULT_N = 10_000;
const SCALE_MIN_N = 250;
const SCALE_PROBE_TOPIC_COUNT = 25;
const SCALE_PROBE_DOCS_PER_TOPIC = 8;
const SCALE_WARMUP = 5;
const SCALE_MEASURED = 60;
const SCALE_INGEST_LOG_EVERY = 1_000;
/* Write/read resilience: Helix can answer a lone write with a transient
 * `transaction_conflict` 500 under sequential load (observed 1 in ~55 during
 * the first 10k attempt; immediate manual retry 201). The harness retries
 * retryable statuses, never 4xx/shape drift (fail fast). This changes no
 * product code and no measurement methodology — only run survival. */
const SCALE_ATTEMPTS = 5;
const SCALE_RETRY_BASE_MS = 250;

function isRetryableScaleStatus(status: number): boolean {
  return status === -1 || status === 429 || (status >= 500 && status < 600);
}

async function callScaleWrite(
  label: string,
  method: string,
  path: string,
  body: unknown,
): Promise<HttpResult> {
  let last: HttpResult = { status: -1, body: "no attempts made" };
  for (let attempt = 1; attempt <= SCALE_ATTEMPTS; attempt++) {
    last = await call(method, path, undefined, body);
    if (last.status >= 200 && last.status < 300) return last;
    if (!isRetryableScaleStatus(last.status) || attempt === SCALE_ATTEMPTS) return last;
    console.log(`${label}: attempt ${attempt}/${SCALE_ATTEMPTS} -> ${last.status}, backing off`);
    await sleep(SCALE_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return last;
}

/** CLI: no args -> null (default 40-doc mode). `--scale [N]` / `--scale=N`. */
function parseScaleArg(argv: string[]): number | null {
  let scale: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg: string | undefined = argv[i];
    if (arg === "--scale") {
      const next: string | undefined = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        scale = SCALE_DEFAULT_N;
      } else {
        const parsed = Number.parseInt(next, 10);
        if (!Number.isSafeInteger(parsed) || parsed < SCALE_MIN_N) {
          return fail(`--scale expects an integer >= ${SCALE_MIN_N}, got "${next}"`);
        }
        scale = parsed;
        i += 1;
      }
    } else if (arg !== undefined && arg.startsWith("--scale=")) {
      const raw = arg.slice("--scale=".length);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(parsed) || parsed < SCALE_MIN_N) {
        return fail(`--scale expects an integer >= ${SCALE_MIN_N}, got "${raw}"`);
      }
      scale = parsed;
    } else {
      return fail(`unknown argument "${arg}" — usage: npx tsx scripts/eval.ts [--scale N | --scale=N]`);
    }
  }
  return scale;
}

/** Deterministic PRNG (mulberry32) — same seed -> same corpus, every run. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item: T | undefined = items[Math.floor(rng() * items.length)];
  if (item === undefined) fail("scale corpus: empty pick pool (internal bug)");
  return item;
}

/** Distinctive token pairs — invented stems, never present in generic pool. */
const SCALE_PROBE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["veltrox", "quandar"],
  ["zephra", "moltvik"],
  ["kludgex", "prillox"],
  ["snarvek", "tundrax"],
  ["mortvane", "wexley"],
  ["jorvik", "plendel"],
  ["traxel", "quimbor"],
  ["vexley", "drantor"],
  ["zindle", "fraxmoor"],
  ["grembal", "oshvane"],
  ["quistral", "vendrox"],
  ["threxmoor", "yavendel"],
  ["blorvik", "quandel"],
  ["crimvelox", "jastriel"],
  ["drovnyk", "kestrev"],
  ["esplivor", "fentrax"],
  ["glimvord", "hestria"],
  ["jexmora", "klintra"],
  ["limvostre", "mendrex"],
  ["norvixel", "pardune"],
  ["osklep", "vortune"],
  ["pivendrax", "quelmor"],
  ["ristral", "sodvex"],
  ["trovnyk", "uldrex"],
  ["wexmar", "yoltren"],
];

const SCALE_VERBS: readonly string[] = [
  "compacts",
  "replicates",
  "drains",
  "rebalances",
  "snapshots",
  "replays",
  "shards",
  "evicts",
];

const SCALE_OBJECTS: readonly string[] = [
  "the quorum ledger",
  "the write-ahead log",
  "the segment files",
  "the replica queue",
  "the checkpoint markers",
  "the partition map",
  "the backlog pages",
  "the cache slabs",
];

const SCALE_DETAILS: readonly string[] = [
  "in bounded batches",
  "under backpressure",
  "without blocking readers",
  "with checksum verification",
  "across restart boundaries",
  "before acknowledging writes",
  "during rolling upgrades",
  "after leader election",
];

const SCALE_GENERIC_SENTENCES: readonly string[] = [
  "Connection pools leak when transactions stay open; always commit or rollback in a finally block.",
  "Cache eviction under memory pressure drops hot keys first; raise the limit before thrash.",
  "Add nullable columns first, backfill rows, then add the constraint to avoid long migration locks.",
  "Batch scattered lookups into one query to cut tail latency on dashboards.",
  "Never read your own writes from a lagging replica inside the same request.",
  "Quarantine flaky pipeline tests within a day so the main branch stays green.",
  "Short-lived tokens with rotation beat long-lived secrets for service authentication.",
  "Keep-alive reuse across requests removes handshake overhead on busy gateways.",
  "Virtualize long lists so scrolling never blocks the render loop.",
  "Preload critical assets and lazy-load everything below the fold.",
  "Liveness probes must fail fast so unhealthy containers restart before traffic piles up.",
  "Scrape metrics on a fixed interval and alert on burn rate, not on single spikes.",
  "Pin dependency versions and scan the lockfile on every pipeline run.",
  "Trace identifiers must propagate across service boundaries for end-to-end debugging.",
  "Bounded retries with jitter protect downstream services during partial outages.",
  "Expire sessions server-side and rotate identifiers after privilege changes.",
];

const SCALE_GENERIC_TAGS: readonly string[] = [
  "databases",
  "cache",
  "migrations",
  "performance",
  "ci",
  "testing",
  "auth",
  "networking",
  "frontend",
  "deploy",
  "observability",
  "security",
  "queues",
  "containers",
];

export interface ScaleQuery {
  query: string;
  relevant: string[];
  concepts: string[];
}

interface ScaleCorpus {
  docs: EvalDoc[];
  queries: ScaleQuery[];
}

/** Nonce tail pool: invented stems, disjoint from probe + generic tokens
 * (asserted at build). 8 distinct tail words per doc keep every pair's
 * token-set Jaccard far below the product's 0.9 merge threshold, so the
 * scale run measures retrieval — never near-dup consolidation. */
const SCALE_TAIL_WORDS: readonly string[] = [
  "wumblor",
  "yexford",
  "zabrin",
  "quindle",
  "voxtrin",
  "praxley",
  "nimbor",
  "thwick",
  "ulbren",
  "fendral",
  "gribnox",
  "hoskell",
  "ibrex",
  "janvor",
  "kestrol",
  "lumbrix",
  "mivarn",
  "nexdor",
  "obtrindle",
  "pexmor",
  "quilvex",
  "rondar",
  "sibrel",
  "tavrox",
  "undrell",
  "vexmar",
  "wexlin",
  "xylnor",
  "yavrok",
  "zendrex",
  "blixmor",
  "cendral",
  "doxley",
  "exvorn",
  "flixnor",
  "grendax",
  "hixmor",
  "ilvex",
  "jundrex",
  "kivorn",
  "lixdra",
  "movrex",
  "nuvlex",
  "oxdren",
  "paxnor",
  "quivrel",
  "rixdor",
  "sovrex",
  "tuvlex",
  "uxbren",
  "vixdor",
  "wovtrex",
  "xavdren",
  "yuvnor",
  "zivrel",
  "blendrex",
  "crivox",
  "drunvex",
  "estribor",
  "frondax",
  "grivlex",
  "hondrex",
  "istrivor",
  "jundex",
  "kendrex",
  "lostrine",
  "mostrex",
  "nondrix",
  "ostrivex",
  "prundax",
  "restrivor",
  "sondrex",
  "tondrix",
  "unstrivox",
  "vendrix",
  "wondrex",
  "xondrix",
  "yendrex",
  "zondrix",
];
const SCALE_TAIL_WORDS_PER_DOC = 8;
/** Build-time dissimilarity bar: product merges at Jaccard >= 0.9, so every
 * checked pair must stay under 0.85 (0.05 headroom). */
const SCALE_MAX_PAIR_JACCARD = 0.85;
const SCALE_SAMPLE_PAIRS = 5_000;

function drawTail(rng: () => number): string {
  const pool = [...SCALE_TAIL_WORDS];
  const tail: string[] = [];
  for (let k = 0; k < SCALE_TAIL_WORDS_PER_DOC; k++) {
    const idx = Math.floor(rng() * pool.length);
    const word: string | undefined = pool.splice(idx, 1)[0];
    if (word === undefined) fail("scale corpus: tail pool exhausted (internal bug)");
    tail.push(word);
  }
  return tail.join(" ");
}

function tokenizeLower(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/** Fail loudly when any checked pair could merge under the product default. */
function assertScaleDissimilar(docs: EvalDoc[], rng: () => number): void {
  const sets = docs.map((doc) => new Set(tokenizeLower(doc.content)));
  const check = (i: number, j: number, context: string): void => {
    const a: Set<string> | undefined = sets[i];
    const b: Set<string> | undefined = sets[j];
    if (a === undefined || b === undefined) fail("scale corpus: pair index missing");
    const sim = jaccardSets(a, b);
    if (sim >= SCALE_MAX_PAIR_JACCARD) {
      fail(
        `scale corpus: ${context} pair (${docs[i]?.id}, ${docs[j]?.id}) Jaccard ` +
          `${sim.toFixed(3)} >= ${SCALE_MAX_PAIR_JACCARD} — would merge at runtime`,
      );
    }
  };
  const probeCount = SCALE_PROBE_TOPIC_COUNT * SCALE_PROBE_DOCS_PER_TOPIC;
  for (let topic = 0; topic < SCALE_PROBE_TOPIC_COUNT; topic++) {
    const base = topic * SCALE_PROBE_DOCS_PER_TOPIC;
    for (let x = 0; x < SCALE_PROBE_DOCS_PER_TOPIC; x++) {
      for (let y = x + 1; y < SCALE_PROBE_DOCS_PER_TOPIC; y++) {
        check(base + x, base + y, "intra-topic");
      }
    }
  }
  for (let s = 0; s < SCALE_SAMPLE_PAIRS; s++) {
    const i = Math.floor(rng() * docs.length);
    let j = Math.floor(rng() * docs.length);
    if (j === i) j = (j + 1) % docs.length;
    check(i, j, "sample");
  }
}

export function buildScaleCorpus(total: number, rng: () => number): ScaleCorpus {
  if (SCALE_PROBE_PAIRS.length !== SCALE_PROBE_TOPIC_COUNT) {
    fail(
      `scale corpus: probe pair table has ${SCALE_PROBE_PAIRS.length} rows, ` +
        `expected ${SCALE_PROBE_TOPIC_COUNT} (internal bug)`,
    );
  }
  const probeDocCount = SCALE_PROBE_TOPIC_COUNT * SCALE_PROBE_DOCS_PER_TOPIC;
  if (total < probeDocCount + 50) {
    fail(`scale corpus: N=${total} too small for ${probeDocCount} probe docs + distractors`);
  }
  const probeTokens = new Set<string>();
  for (const [a, b] of SCALE_PROBE_PAIRS) {
    probeTokens.add(a);
    probeTokens.add(b);
  }
  for (const sentence of SCALE_GENERIC_SENTENCES) {
    for (const token of tokenizeLower(sentence)) {
      if (probeTokens.has(token)) {
        fail(`scale corpus: generic pool leaks probe token "${token}" (internal bug)`);
      }
    }
  }

  const docs: EvalDoc[] = [];
  const queries: ScaleQuery[] = [];
  let serial = 0;
  const nextId = (): string => {
    serial += 1;
    return `s${String(serial).padStart(5, "0")}`;
  };

  for (let topic = 0; topic < SCALE_PROBE_PAIRS.length; topic++) {
    const pair = SCALE_PROBE_PAIRS[topic];
    if (pair === undefined) fail("scale corpus: probe pair missing (internal bug)");
    const [a, b] = pair;
    const tag = `probe-t${String(topic + 1).padStart(2, "0")}`;
    const topicIds: string[] = [];
    for (let k = 0; k < SCALE_PROBE_DOCS_PER_TOPIC; k++) {
      const id = nextId();
      const verb = pick(rng, SCALE_VERBS);
      const object = pick(rng, SCALE_OBJECTS);
      const detail = pick(rng, SCALE_DETAILS);
      const generic = pick(rng, SCALE_GENERIC_SENTENCES);
      const tail = drawTail(rng);
      const capA = a.slice(0, 1).toUpperCase() + a.slice(1);
      const content =
        `${capA} ${b} ${verb} ${object} ${detail}. ${generic} [scale-note ${id} ${tail}]`;
      docs.push({ id, content, concepts: ["scaleprobe", tag, pick(rng, SCALE_GENERIC_TAGS)] });
      topicIds.push(id);
    }
    const qVerb = pick(rng, SCALE_VERBS);
    const qObject = pick(rng, SCALE_OBJECTS);
    queries.push({ query: `${a} ${b} ${qVerb} ${qObject}`, relevant: topicIds, concepts: [tag] });
  }

  while (docs.length < total) {
    const id = nextId();
    const first = pick(rng, SCALE_GENERIC_SENTENCES);
    let second = pick(rng, SCALE_GENERIC_SENTENCES);
    if (second === first) second = pick(rng, SCALE_GENERIC_SENTENCES);
    const tail = drawTail(rng);
    docs.push({
      id,
      content: `${first} ${second} [scale-note ${id} ${tail}]`,
      concepts: [pick(rng, SCALE_GENERIC_TAGS), pick(rng, SCALE_GENERIC_TAGS)],
    });
  }
  for (const word of SCALE_TAIL_WORDS) {
    if (probeTokens.has(word)) fail(`scale corpus: tail pool leaks probe token "${word}"`);
  }
  assertScaleDissimilar(docs, rng);
  return { docs, queries };
}

/** REST client bound to the SCALE tenant (default-path RestClient untouched). */
class ScaleRestClient implements EvalClient {
  async health(): Promise<void> {
    const response = await call("GET", "memory/health", { project: SCALE_PROJECT });
    if (response.status !== 200) {
      throw new Error(`GET memory/health?project=${SCALE_PROJECT} -> ${response.status}`);
    }
    parseOrFail("scale health envelope", response.body, healthEnvelopeSchema);
  }

  async remember(doc: EvalDoc): Promise<RememberResult> {
    const response = await callScaleWrite(`scale remember(${doc.id})`, "POST", "memory/remember", {
      content: doc.content,
      concepts: doc.concepts,
      project: SCALE_PROJECT,
      sessionId: SCALE_SESSION_ID,
      origin: SCALE_ORIGIN,
    });
    if (response.status !== 201) {
      return fail(
        `scale remember(${doc.id}) -> ${response.status} (expected 201) — body=${brief(response.body)}`,
      );
    }
    return parseOrFail(`scale remember(${doc.id})`, response.body, rememberResultSchema);
  }

  async search(query: string, limit: number): Promise<string[]> {
    const response = await callScaleWrite("scale search", "POST", "memory/search", {
      query,
      project: SCALE_PROJECT,
      limit,
    });
    if (response.status !== 200) {
      return fail(`scale search -> ${response.status} (expected 200) — body=${brief(response.body)}`);
    }
    const envelope = parseOrFail("scale search envelope", response.body, searchEnvelopeSchema);
    return envelope.results.map((row) => row.memoryId);
  }

  async smartSearch(query: string, concepts: string[], limit: number): Promise<string[]> {
    const response = await callScaleWrite("scale smart-search", "POST", "memory/smart-search", {
      query,
      concepts,
      project: SCALE_PROJECT,
      limit,
    });
    if (response.status !== 200) {
      return fail(
        `scale smart-search -> ${response.status} (expected 200) — body=${brief(response.body)}`,
      );
    }
    const envelope = parseOrFail("scale smart-search envelope", response.body, searchEnvelopeSchema);
    return envelope.results.map((row) => row.memoryId);
  }

  /** Raw ids for the graph path — may contain "" (unusable hits, see above). */
  async smartSearchRawIds(query: string, concepts: string[], limit: number): Promise<string[]> {
    const response = await callScaleWrite("scale smart-search+concepts", "POST", "memory/smart-search", {
      query,
      concepts,
      project: SCALE_PROJECT,
      limit,
    });
    if (response.status !== 200) {
      return fail(
        `scale smart-search+concepts -> ${response.status} (expected 200) — body=${brief(response.body)}`,
      );
    }
    const envelope = parseOrFail("scale smart-search+concepts envelope", response.body, scaleRawEnvelopeSchema);
    return envelope.results.map((row) => row.memoryId);
  }

  async projectCounts(): Promise<{ memories: number; sessions: number }> {    const response = await call("GET", "memory/health", { project: SCALE_PROJECT });
    if (response.status !== 200) {
      return fail(`scale post-seed health -> ${response.status} (expected 200)`);
    }
    const envelope = parseOrFail("scale health envelope", response.body, healthEnvelopeSchema);
    return envelope.counts;
  }
}

interface LatencyStats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) fail("scale latency: no samples (internal bug)");
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1));
  const value: number | undefined = sorted[idx];
  if (value === undefined) fail("scale latency: quantile index missing (internal bug)");
  return value;
}

async function probeLatency(
  run: (query: string) => Promise<unknown>,
  queries: string[],
): Promise<LatencyStats> {
  for (let w = 0; w < SCALE_WARMUP; w++) {
    const warm: string | undefined = queries[w % queries.length];
    if (warm === undefined) fail("scale latency: warmup query missing");
    await run(warm);
  }
  const samples: number[] = [];
  for (let i = 0; i < SCALE_MEASURED; i++) {
    const query: string | undefined = queries[i % queries.length];
    if (query === undefined) fail("scale latency: probe query missing");
    const start = performance.now();
    await run(query);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const first: number | undefined = samples[0];
  const last: number | undefined = samples[samples.length - 1];
  if (first === undefined || last === undefined) fail("scale latency: empty sample set");
  return {
    n: samples.length,
    min: first,
    p50: quantileSorted(samples, 50),
    p95: quantileSorted(samples, 95),
    max: last,
  };
}

const fmtMs = (value: number): string => `${value.toFixed(2)}ms`;

async function mainScale(total: number): Promise<void> {
  const client = new ScaleRestClient();
  console.log(`eval-scale: target=${NORMALIZED_BASE.href} project=${SCALE_PROJECT} docs=${total} seed=${SCALE_SEED}`);

  /* Identity guard — read-only, BEFORE any write (same pattern as main). */
  const identity = await call("POST", "memory/recap", undefined, {});
  if (identity.status === -1) {
    fail(
      `cannot reach ${NORMALIZED_BASE.href} (recap unreachable: ${String(identity.body)}) — ` +
        `start OUR server first. No data was written.`,
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
        `expected 200 from OUR server. No data was written.`,
    );
  }
  console.log("identity: POST memory/recap -> 200 (our server), proceeding");

  try {
    await client.health();
  } catch (err) {
    fail(`scale health gate failed at ${NORMALIZED_BASE.href} (${logSafeNote(err)})`);
  }
  console.log("health: gate passed (counts present)");

  const rng = mulberry32(SCALE_SEED);
  const corpus = buildScaleCorpus(total, rng);
  console.log(
    `corpus: ${corpus.docs.length} docs (${corpus.queries.length} probe queries), ` +
      `deterministic seed ${SCALE_SEED}`,
  );

  /* Ingest — content dedup makes re-runs converge to the same ids. */
  const ingestStart = performance.now();
  const idByDoc = new Map<string, string>();
  const seenMemoryIds = new Set<string>();
  let done = 0;
  for (const doc of corpus.docs) {
    const result = await client.remember(doc);
    if (seenMemoryIds.has(result.id)) {
      fail(`scale corpus-content bug: duplicate remembered id ${result.id} (doc "${doc.id}")`);
    }
    seenMemoryIds.add(result.id);
    idByDoc.set(doc.id, result.id);
    done += 1;
    if (done % SCALE_INGEST_LOG_EVERY === 0) console.log(`ingest: ${done}/${corpus.docs.length}`);
  }
  const ingestMs = performance.now() - ingestStart;
  const ingestPerSec = (corpus.docs.length / ingestMs) * 1000;
  console.log(
    `ingest: ${corpus.docs.length} docs in ${(ingestMs / 1000).toFixed(1)}s ` +
      `(${ingestPerSec.toFixed(1)} notes/sec)`,
  );

  /* Graph leg note: POST /v1/link operates on PARA Note nodes, not memory
   * rows, so it cannot link scale memories. The graph branch IS exercised
   * through the concepts path of POST /memory/smart-search (topic-tag
   * concepts per probe query — scored and probed as hybrid+concepts below;
   * the 40-doc scorecard documents concepts:[] as graph-INACTIVE). */

  /* Row count — exactly one row per doc (re-runs dedup to the same ids). */
  const counts = await client.projectCounts();
  console.log(`counts: memories=${counts.memories} sessions=${counts.sessions} (project ${SCALE_PROJECT})`);
  if (counts.memories !== corpus.docs.length) {
    fail(
      `project ${SCALE_PROJECT} holds ${counts.memories} rows but the scale corpus has ` +
        `${corpus.docs.length} docs — foreign or stale rows; clear the project before re-running.`,
    );
  }

  /* Smoke — first probe query retrievable. */
  const firstQuery: ScaleQuery | undefined = corpus.queries[0];
  if (firstQuery === undefined) fail("scale corpus has no queries");
  let smokeHits: string[] = [];
  let smokeAttempt = 0;
  for (let attempt = 1; attempt <= SMOKE_ATTEMPTS; attempt++) {
    smokeAttempt = attempt;
    smokeHits = await client.search(firstQuery.query, EVAL_LIMIT);
    if (smokeHits.length > 0) break;
    if (attempt < SMOKE_ATTEMPTS) await sleep(SMOKE_RETRY_MS);
  }
  if (smokeHits.length === 0) fail(`scale smoke query returned 0 rows after ${SMOKE_ATTEMPTS} attempts`);
  console.log(`smoke: ${smokeHits.length} rows on attempt ${smokeAttempt}/${SMOKE_ATTEMPTS}`);

  /* Quality — planted qrels, three retrieval paths (graph branch via concepts). */
  const docByMemory = new Map<string, string>();
  for (const [docId, memoryId] of idByDoc) docByMemory.set(memoryId, docId);
  const mapToDocIds = (memoryIds: string[], context: string): string[] => {
    const mapped: string[] = [];
    for (const memoryId of memoryIds) {
      const docId = docByMemory.get(memoryId);
      if (docId === undefined) {
        fail(`${context} returned memoryId ${memoryId} outside the scale corpus — foreign rows`);
      }
      mapped.push(docId);
    }
    return mapped;
  };
  const bm25Scores: QueryScore[] = [];
  const hybridScores: QueryScore[] = [];
  const graphScores: QueryScore[] = [];
  let graphUnusable = 0;
  for (let qi = 0; qi < corpus.queries.length; qi++) {
    const entry = corpus.queries[qi];
    if (entry === undefined) fail("scale corpus: query missing (internal bug)");
    const bm25Ranked = mapToDocIds(await client.search(entry.query, EVAL_LIMIT), "scale search");
    const hybridRanked = mapToDocIds(
      await client.smartSearch(entry.query, [], EVAL_LIMIT),
      "scale smart-search",
    );
    const graphRanked = (await client.smartSearchRawIds(entry.query, entry.concepts, EVAL_LIMIT)).map(
      (memoryId, rank) => {
        if (memoryId !== "") {
          const docId = docByMemory.get(memoryId);
          if (docId !== undefined) return docId;
          fail(
            `scale smart-search+concepts returned memoryId ${memoryId} outside the scale corpus — foreign rows`,
          );
        }
        graphUnusable += 1;
        return `__unusable:q${qi}r${rank}`;
      },
    );
    bm25Scores.push(scoreQuery(entry.query, bm25Ranked, entry.relevant));
    hybridScores.push(scoreQuery(entry.query, hybridRanked, entry.relevant));
    graphScores.push(scoreQuery(entry.query, graphRanked, entry.relevant));
  }
  const bm25 = aggregate("bm25", bm25Scores);
  const hybrid = aggregate("hybrid", hybridScores);
  const graph = aggregate("hybrid", graphScores);
  console.log(`scored: ${corpus.queries.length} queries x 3 paths (graph unusable hits: ${graphUnusable})`);

  /* Latency — client-measured round-trip, warmup excluded. */
  const queryTexts = corpus.queries.map((entry) => entry.query);
  const conceptOf = (query: string): string[] => {
    const found = corpus.queries.find((entry) => entry.query === query);
    return found === undefined ? [] : found.concepts;
  };
  const bm25Lat = await probeLatency((q) => client.search(q, EVAL_LIMIT), queryTexts);
  /* Latency probes use the raw smart-search variant: the graph path returns
   * rank-0 hits with empty memoryId (product bug, scored as misses above) —
   * timing the round-trip must not fail on response content. */
  const hybridLat = await probeLatency((q) => client.smartSearchRawIds(q, [], EVAL_LIMIT), queryTexts);
  const graphLat = await probeLatency(
    (q) => client.smartSearchRawIds(q, conceptOf(q), EVAL_LIMIT),
    queryTexts,
  );

  const latRow = (label: string, s: LatencyStats): string =>
    `| ${label} | ${s.n} | ${fmtMs(s.min)} | ${fmtMs(s.p50)} | **${fmtMs(s.p95)}** | ${fmtMs(s.max)} |`;

  console.log("");
  console.log(`eval-scale summary — ${corpus.docs.length} docs, ${corpus.queries.length} queries, project=${SCALE_PROJECT}`);
  console.log("mode              R@5     R@10    MRR@10  nDCG@10");
  console.log(
    `bm25            ${fmt(bm25.recall5)}  ${fmt(bm25.recall10)}  ${fmt(bm25.mrr10)}  ${fmt(bm25.ndcg10)}`,
  );
  console.log(
    `hybrid          ${fmt(hybrid.recall5)}  ${fmt(hybrid.recall10)}  ${fmt(hybrid.mrr10)}  ${fmt(hybrid.ndcg10)}`,
  );
  console.log(
    `hybrid+concepts ${fmt(graph.recall5)}  ${fmt(graph.recall10)}  ${fmt(graph.mrr10)}  ${fmt(graph.ndcg10)}`,
  );
  console.log("");
  console.log("| path | n | min | p50 | p95 | max |");
  console.log("|---|---|---|---|---|---|");
  console.log(latRow("bm25 `POST /memory/search`", bm25Lat));
  console.log(latRow("hybrid `POST /memory/smart-search` concepts=[]", hybridLat));
  console.log(latRow("hybrid+concepts `POST /memory/smart-search` topic tag", graphLat));
  console.log("");
  console.log("paste-ready scorecard block (method: nearest-rank percentiles on client round-trip, " +
    `${SCALE_WARMUP} warmup + ${SCALE_MEASURED} measured sequential searches per path, limit=10):`);
  console.log(`SCALE-N=${corpus.docs.length} INGEST=${ingestPerSec.toFixed(1)}notes/sec GRAPH=concepts-branch(smart-search+topic-tag)`);
  console.log(`SCALE-BM25 R@5=${fmt(bm25.recall5)} MRR=${fmt(bm25.mrr10)} nDCG=${fmt(bm25.ndcg10)}`);
  console.log(`SCALE-HYBRID R@5=${fmt(hybrid.recall5)} MRR=${fmt(hybrid.mrr10)} nDCG=${fmt(hybrid.ndcg10)}`);
  console.log(`SCALE-GRAPH R@5=${fmt(graph.recall5)} MRR=${fmt(graph.mrr10)} nDCG=${fmt(graph.ndcg10)} UNUSABLE=${graphUnusable}`);
  console.log(`SCALE-LAT-BM25 min=${fmtMs(bm25Lat.min)} p50=${fmtMs(bm25Lat.p50)} p95=${fmtMs(bm25Lat.p95)} max=${fmtMs(bm25Lat.max)}`);
  console.log(`SCALE-LAT-HYBRID min=${fmtMs(hybridLat.min)} p50=${fmtMs(hybridLat.p50)} p95=${fmtMs(hybridLat.p95)} max=${fmtMs(hybridLat.max)}`);
  console.log(`SCALE-LAT-GRAPH min=${fmtMs(graphLat.min)} p50=${fmtMs(graphLat.p50)} p95=${fmtMs(graphLat.p95)} max=${fmtMs(graphLat.max)}`);
  console.log("EVAL SCALE PASS");
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
        `start OUR server first:\n\n  AGENT_MEMORY_PORT=${RUN_PORT} npx tsx src/server.ts\n\n` +
        `then re-run:\n\n  AGENT_MEMORY_URL=${RUN_ORIGIN} npx tsx scripts/eval.ts\n\n` +
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
        `(AGENT_MEMORY_PORT=${RUN_PORT} npx tsx src/server.ts), then re-run with ` +
        `AGENT_MEMORY_URL=${RUN_ORIGIN} npx tsx scripts/eval.ts`,
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

async function run(): Promise<void> {
  const scaleN = parseScaleArg(process.argv.slice(2));
  if (scaleN !== null) {
    await mainScale(scaleN);
    return;
  }
  await main();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  run().catch((err: unknown) => {
    console.error(`eval crashed: ${logSafeNote(err)}`);
    process.exit(1);
  });
}
