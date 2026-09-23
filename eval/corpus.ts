/**
 * eval/corpus.ts — the in-repo "public" retrieval corpus (REQ-P1-5).
 *
 * Deterministic, self-contained, ZERO network: no fetch, no external files.
 * Published with the repository, so every scorecard in docs/benchmarks/ is
 * reproducible from a clean checkout against a local server.
 *
 * Design rules (the reason the numbers are not zero):
 * - 40 documents d01..d40, 1-3 sentences each, realistic dev/ops/architecture
 *   facts spanning databases, CI, auth, networking, frontend, testing,
 *   deployment, observability, performance, and security.
 * - 15 queries with qrels (1-3 relevant doc ids). Every query shares its
 *   distinctive tokens with its relevant docs VERBATIM (same word forms —
 *   neither Helix BM25 nor the deterministic FNV-1a embedder is assumed to
 *   stem), while staying distinctive enough that distractor docs match on
 *   fewer tokens. Semantic-only overlap would score 0 and make the scorecard
 *   useless; token overlap is a property of the corpus, checked at runtime by
 *   scripts/eval.ts (Recall@5 > 0 or the harness fails loudly).
 * - Concepts are topical tags used as explicit `concepts` on seed writes; the
 *   eval queries deliberately pass `concepts: []` so the graph branch stays
 *   inactive and bm25 vs hybrid (vector+text fusion) compare fairly.
 */

/** One corpus document as seeded through POST /memory/remember. */
export interface EvalDoc {
  /** Stable id, "d01".."d40" — referenced by EvalQuery.relevant. */
  id: string;
  /** 1-3 sentences; the stored memory content (searched: text + vector). */
  content: string;
  /** 1-4 topical tags; stored as explicit concepts on the memory node. */
  concepts: string[];
}

/** One judged query: the query text plus the doc ids that answer it. */
export interface EvalQuery {
  query: string;
  /** 1-3 corpus doc ids that genuinely answer `query`. */
  relevant: string[];
}

export const EVAL_DOCS: EvalDoc[] = [
  {
    id: "d01",
    content:
      "PostgreSQL connection pools leak when transactions are left open; set statement_timeout and always commit or rollback in a finally block.",
    concepts: ["databases", "postgres", "connections"],
  },
  {
    id: "d02",
    content:
      "Redis drops cached sessions when maxmemory is reached under the LRU eviction policy; raise maxmemory or add a replica before cache thrash.",
    concepts: ["databases", "redis", "cache"],
  },
  {
    id: "d03",
    content:
      "Expanding a column with a long default blocks writers while the migration lock is held, so add the column nullable, backfill rows, then add the constraint.",
    concepts: ["databases", "migrations", "deployment"],
  },
  {
    id: "d04",
    content:
      "The N+1 query problem inflates dashboard latency: batching the user lookups into one IN clause cut p95 latency from 820ms to 45ms.",
    concepts: ["databases", "performance", "sql"],
  },
  {
    id: "d05",
    content:
      "Read replicas lag behind the primary by seconds; never read your own writes from a replica inside the same transaction.",
    concepts: ["databases", "replication", "consistency"],
  },
  {
    id: "d06",
    content:
      "Continuous integration pipelines should run typecheck, lint, and unit tests on every pull request; flaky tests get quarantined within 24 hours.",
    concepts: ["ci", "testing", "pipeline"],
  },
  {
    id: "d07",
    content:
      "Continuous integration pipeline cache keyed on the lockfile hash cut dependency install time from four minutes to forty seconds.",
    concepts: ["ci", "performance", "pipeline"],
  },
  {
    id: "d08",
    content:
      "Feature flags decouple deployment from code release; roll out a new checkout flow to one percent of users and revert the flag on failure.",
    concepts: ["deployment", "feature-flags", "ci"],
  },
  {
    id: "d09",
    content:
      "Signed commits verify authorship in review; require signed artifacts and provenance before merging to main.",
    concepts: ["security", "ci", "provenance"],
  },
  {
    id: "d10",
    content:
      "The JWT auth middleware signs tokens with HS256 and a fifteen minute expiry; refresh tokens rotate on every use.",
    concepts: ["auth", "jwt", "security"],
  },
  {
    id: "d11",
    content:
      "OAuth single sign-on redirects through the identity provider with PKCE and a short lived state parameter to block interception.",
    concepts: ["auth", "oauth", "security"],
  },
  {
    id: "d12",
    content:
      "Session cookies must be httpOnly, Secure, and SameSite strict; never store tokens in localStorage where an XSS payload can read them.",
    concepts: ["auth", "cookies", "security"],
  },
  {
    id: "d13",
    content:
      "Rate limiting with a token bucket allows sixty requests per minute and a burst of ten; excess traffic receives HTTP 429 responses.",
    concepts: ["networking", "rate-limiting", "reliability"],
  },
  {
    id: "d14",
    content:
      "A reverse proxy terminates TLS and forwards traffic over HTTP/2 with keep-alive connections to the upstream application.",
    concepts: ["networking", "tls", "proxy"],
  },
  {
    id: "d15",
    content:
      "A DNS TTL of three hundred seconds controls how fast failover resolves to the secondary region after an outage.",
    concepts: ["networking", "dns", "failover"],
  },
  {
    id: "d16",
    content:
      "A virtual private network encrypts traffic between a laptop and the corporate gateway before it crosses the public internet.",
    concepts: ["networking", "vpn", "security"],
  },
  {
    id: "d17",
    content:
      "The frontend virtualizes long lists so scrolling ten thousand rows stays under one hundred milliseconds per frame.",
    concepts: ["frontend", "performance", "rendering"],
  },
  {
    id: "d18",
    content:
      "Server-side rendering cut largest contentful paint to under 2.5 seconds on mobile networks.",
    concepts: ["frontend", "ssr", "performance"],
  },
  {
    id: "d19",
    content:
      "Hydration mismatches throw when the server markup differs from the client; keep window and document access out of render code.",
    concepts: ["frontend", "react", "ssr"],
  },
  {
    id: "d20",
    content:
      "A content security policy with nonces blocks inline script injection; pair it with strict transport security headers.",
    concepts: ["security", "frontend", "csp"],
  },
  {
    id: "d21",
    content:
      "Unit tests cover pure functions and critical paths while end to end tests drive the browser through complete user flows.",
    concepts: ["testing", "e2e", "quality"],
  },
  {
    id: "d22",
    content:
      "Property based testing generates thousands of random inputs to find edge cases that hand written examples miss.",
    concepts: ["testing", "quality"],
  },
  {
    id: "d23",
    content:
      "Mutation testing measures whether assertions actually fail when code changes; aim for eighty percent coverage on critical paths.",
    concepts: ["testing", "coverage", "quality"],
  },
  {
    id: "d24",
    content:
      "Blue green deployment swaps traffic between two identical environments so a bad release rolls back in seconds.",
    concepts: ["deployment", "ops", "rollback"],
  },
  {
    id: "d25",
    content:
      "Kubernetes liveness probes restart unhealthy containers while readiness probes keep them out of the load balancer.",
    concepts: ["deployment", "kubernetes", "ops"],
  },
  {
    id: "d26",
    content:
      "Immutable infrastructure means servers are never patched in place; replace the machine and keep the image versioned.",
    concepts: ["deployment", "ops", "infrastructure"],
  },
  {
    id: "d27",
    content:
      "Prometheus scrapes metrics every fifteen seconds and stores time series that Grafana dashboards query.",
    concepts: ["observability", "metrics", "monitoring"],
  },
  {
    id: "d28",
    content:
      "Distributed tracing with open telemetry spans correlates a request across services so slow hops stand out in the flame graph.",
    concepts: ["observability", "tracing", "telemetry"],
  },
  {
    id: "d29",
    content:
      "Structured logging with correlation identifiers lets an operator grep one request id across every service log.",
    concepts: ["observability", "logging", "ops"],
  },
  {
    id: "d30",
    content:
      "Service level objectives set an availability target of 99.9 percent; the error budget governs how fast the team may ship.",
    concepts: ["observability", "slo", "reliability"],
  },
  {
    id: "d31",
    content:
      "A circuit breaker opens after five consecutive failures and stops calling the dependency for thirty seconds.",
    concepts: ["reliability", "resilience", "networking"],
  },
  {
    id: "d32",
    content:
      "Exponential backoff with jitter spreads retry storms so a recovering service is not hammered by synchronized clients.",
    concepts: ["reliability", "retries", "networking"],
  },
  {
    id: "d33",
    content:
      "Cross site request forgery tokens are validated on every state changing endpoint; deny by default when the token is missing.",
    concepts: ["security", "csrf", "auth"],
  },
  {
    id: "d34",
    content:
      "Dependency scanning in the pipeline fails the build on any critical vulnerability; pin versions and maintain a software bill of materials.",
    concepts: ["security", "dependencies", "ci"],
  },
  {
    id: "d35",
    content:
      "Input validation runs at every boundary: parse with a schema, reject unknown fields, and never concatenate user input into SQL.",
    concepts: ["security", "validation", "sql"],
  },
  {
    id: "d36",
    content:
      "The message queue delivers events at least once, so consumers must be idempotent and deduplicate by event identifier.",
    concepts: ["architecture", "messaging", "reliability"],
  },
  {
    id: "d37",
    content:
      "Event sourcing stores every state change as an append only log; rebuilding a projection replays the stream from the beginning.",
    concepts: ["architecture", "event-sourcing", "events"],
  },
  {
    id: "d38",
    content:
      "A strangler fig migration routes ten percent of traffic to the new service until the legacy system is fully retired.",
    concepts: ["architecture", "migration", "deployment"],
  },
  {
    id: "d39",
    content:
      "TCP handshakes add latency before data flows, while HTTP multiplexing reuses connections for many requests without new handshakes.",
    concepts: ["networking", "http", "performance"],
  },
  {
    id: "d40",
    content:
      "The frontend design system exposes color, spacing, and typography tokens so themes stay consistent across every component.",
    concepts: ["frontend", "design-system", "ui"],
  },
];

export const EVAL_QUERIES: EvalQuery[] = [
  { query: "N+1 query problem inflates dashboard latency", relevant: ["d04"] },
  { query: "continuous integration pipeline cache dependency install time", relevant: ["d07"] },
  { query: "JWT auth middleware HS256 tokens expiry", relevant: ["d10"] },
  { query: "OAuth single sign-on identity provider PKCE", relevant: ["d11"] },
  { query: "session cookies httpOnly Secure SameSite localStorage", relevant: ["d12"] },
  { query: "token bucket rate limiting sixty requests per minute", relevant: ["d13"] },
  { query: "frontend virtualizes long lists per frame", relevant: ["d17"] },
  { query: "server side rendering largest contentful paint mobile", relevant: ["d18"] },
  { query: "hydration mismatches server markup client render window document", relevant: ["d19"] },
  { query: "Kubernetes liveness probes restart unhealthy containers readiness", relevant: ["d25"] },
  { query: "Prometheus scrapes metrics every fifteen seconds Grafana dashboards", relevant: ["d27"] },
  { query: "dependency scanning critical vulnerability pin versions pipeline", relevant: ["d34"] },
  { query: "trace a request id across services", relevant: ["d28", "d29"] },
  { query: "HTTP connections keep-alive multiplexing", relevant: ["d14", "d39"] },
  { query: "unit tests coverage critical paths", relevant: ["d21", "d23"] },
];
