/**
 * Demo (contract §3): seeds three realistic sessions, then runs a keyword
 * and a semantic search and prints the hits.
 *
 * Sessions (frozen by contract):
 *   - JWT auth in src/middleware/auth.ts
 *   - N+1 query fix
 *   - rate limiting
 *
 * Requires the dev instance + indexes (run `npm run bootstrap` first).
 * Talks to Helix through the same MemoryStore the services use, so it works
 * without the REST server running. Exit 0 on success, 1 on any failure.
 */
import { embed } from "./embed.js";
import { logSafeNote } from "./errors.js";
import { bm25Search, hybridSearch } from "./search.js";
import { createDefaultStore, type MemoryStore, type SearchHit } from "./store.js";

const PROJECT = "demo";

const SESSION_JWT = "demo-jwt-auth";
const SESSION_N1 = "demo-n1-fix";
const SESSION_RATE = "demo-rate-limit";

interface Seed {
  sessionId: string;
  content: string;
  concepts: string[];
  importance: number;
}

const SEEDS: readonly Seed[] = [
  {
    sessionId: SESSION_JWT,
    content:
      "Implemented JWT auth in src/middleware/auth.ts: HS256 signing, 15-minute expiry, httpOnly cookie on login.",
    concepts: ["auth", "jwt", "middleware"],
    importance: 0.9,
  },
  {
    sessionId: SESSION_JWT,
    content:
      "The auth middleware rejects expired or tampered JWT tokens with 401 before any handler runs.",
    concepts: ["auth", "jwt"],
    importance: 0.7,
  },
  {
    sessionId: SESSION_JWT,
    content:
      "Lesson: the JWT secret lives in the environment, never in code — rotation means a restart.",
    concepts: ["auth", "security"],
    importance: 0.6,
  },
  {
    sessionId: SESSION_N1,
    content:
      "Fixed the dashboard N+1 query by batching user lookups into one IN query; p95 latency dropped from 820ms to 45ms.",
    concepts: ["performance", "sql"],
    importance: 0.9,
  },
  {
    sessionId: SESSION_N1,
    content:
      "The repository layer preloads authors per page instead of querying per row — the N+1 pattern is gone.",
    concepts: ["performance"],
    importance: 0.7,
  },
  {
    sessionId: SESSION_RATE,
    content:
      "Added per-user rate limiting with a token bucket: 60 requests/minute, burst 10, responses carry 429 and Retry-After.",
    concepts: ["reliability", "rate-limit"],
    importance: 0.9,
  },
  {
    sessionId: SESSION_RATE,
    content:
      "Rate-limit keys come from the authenticated user id, falling back to the client IP for anonymous traffic.",
    concepts: ["reliability"],
    importance: 0.6,
  },
];

function clip(text: string, max = 92): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}

function printHit(rank: number, hit: { score: number; sessionId: string; content: string }, extra = ""): void {
  const score = hit.score.toFixed(4);
  const suffix = extra.length > 0 ? `  ${extra}` : "";
  console.log(`  ${rank}. [${score}] @${hit.sessionId} ${clip(hit.content)}${suffix}`);
}

function printVectorHits(hits: readonly SearchHit[]): void {
  hits.forEach((hit, index) => {
    // Vector rows carry `distance` (cosine, lower = closer), not BM25 `score`.
    const metric = hit.distance !== undefined ? `d=${hit.distance.toFixed(4)}` : `score=${hit.score.toFixed(4)}`;
    const suffix = `  (origin: ${hit.origin}, id: ${hit.memoryId})`;
    console.log(`  ${index + 1}. [${metric}] @${hit.sessionId} ${clip(hit.content)}${suffix}`);
  });
}

async function main(): Promise<void> {
  const store = createDefaultStore();

  console.log(`seeding ${SEEDS.length} memories across 3 sessions (project: ${PROJECT})…`);
  const ids: string[] = [];
  for (const seed of SEEDS) {
    const result = await store.remember({
      content: seed.content,
      concepts: seed.concepts,
      project: PROJECT,
      sessionId: seed.sessionId,
      origin: "demo",
      importance: seed.importance,
    });
    ids.push(result.id);
  }
  console.log(`  ok — first memory id: ${ids[0] ?? "(none)"}\n`);

  let healthy = true;

  // Keyword (BM25) search.
  const keyword = await bm25Search(store, {
    query: "jwt token expiry",
    project: PROJECT,
    limit: 5,
  });
  console.log('keyword search (BM25): "jwt token expiry"');
  if (keyword.signals.length > 0) console.log(`  signals: ${keyword.signals.join(" | ")}`);
  keyword.results.forEach((hit, index) =>
    printHit(index + 1, hit, `(source: ${hit.source}, id: ${hit.memoryId})`),
  );
  if (keyword.results.length === 0) {
    console.error("  FAIL: keyword search returned no hits");
    healthy = false;
  }

  // Semantic (vector) search.
  const semanticQuery = "how does rate limiting work per user requests";
  const vectorHits = await store.searchByVector({
    queryVector: embed(semanticQuery),
    project: PROJECT,
    k: 5,
  });
  console.log(`\nsemantic search (vector): "${semanticQuery}"`);
  printVectorHits(vectorHits);
  if (vectorHits.length === 0) {
    console.error("  FAIL: semantic search returned no hits");
    healthy = false;
  }

  // Hybrid (RRF) search for contrast: source per row, signals on degradation.
  const hybrid = await hybridSearch(store, {
    query: "dashboard query latency",
    concepts: ["performance"],
    project: PROJECT,
    limit: 5,
  });
  console.log('\nhybrid search (RRF): "dashboard query latency" + concepts [performance]');
  if (hybrid.signals.length > 0) console.log(`  signals: ${hybrid.signals.join(" | ")}`);
  hybrid.results.forEach((hit, index) =>
    printHit(index + 1, hit, `(source: ${hit.source}, signals: ${hit.signals.length})`),
  );
  if (hybrid.results.length === 0) {
    console.error("  FAIL: hybrid search returned no hits");
    healthy = false;
  }

  if (!healthy) {
    console.error("\ndemo FAILED — if signals mention index_not_found, run: npm run bootstrap");
    process.exit(1);
  }
  console.log("\ndemo OK");
}

main().catch((err: unknown) => {
  console.error(`demo failed: ${logSafeNote(err)}`);
  console.error("if the error is index_not_found, run: npm run bootstrap");
  process.exit(1);
});
