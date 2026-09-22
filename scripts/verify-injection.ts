/**
 * Verification for the automatic-context half of the agent-memory plugin.
 *
 *   npx tsx scripts/verify-injection.ts
 *
 * Uses a local HTTP server that COUNTS requests, so cache behaviour, relative
 * URL joining, the bearer header and every fail-soft path are observed rather
 * than assumed. No real secret and no real backend are involved; the only
 * "secret" values here are synthetic strings used to prove they never leak.
 *
 * Typechecked by `npm run typecheck` (the scripts dir is in the tsconfig
 * include list).
 */
import http from "node:http";
import {
  MARKER,
  call,
  config,
  hasMarker,
  parseRecall,
  formatRecall,
  autoRecall,
} from "../.opencode/plugins/agent-memory";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* Real captured response body (README.md, /agentmemory/smart-search)  */
/* ------------------------------------------------------------------ */
const REAL_BODY = JSON.stringify({
  mode: "hybrid",
  results: [
    {
      id: "109",
      memoryId: "0a6b1c4f-bf37-4586-9477-cacb3e7b3ad5",
      content:
        "Fixed the dashboard N+1 query by batching user lookups into one IN query; p95 latency dropped from 820ms to 45ms.",
      sessionId: "readme-example",
      origin: "rest",
      importance: 0.5,
      createdAt: "2026-09-22T13:30:39.062Z",
      score: 0.04918032786885246,
      source: "vector",
      signals: [],
    },
    {
      id: "108",
      memoryId: "0d850e3b-6ec5-49bb-bd94-42a1973912fa",
      content:
        "Implemented JWT auth in src/middleware/auth.ts: HS256 signing, 15-minute expiry, httpOnly cookie on login.",
      sessionId: "readme-example",
      origin: "rest",
      importance: 0.5,
      createdAt: "2026-09-22T13:30:38.921Z",
      score: 0.016129032258064516,
      source: "vector",
      signals: [],
    },
  ],
  signals: [],
});

const LOCATION = {
  directory: "/mnt/DATA/GitHub/agent-memory",
  project: { canonical: "/mnt/DATA/GitHub/agent-memory" },
};

/* ------------------------------------------------------------------ */
section("A. Marker idempotency");
/* ------------------------------------------------------------------ */
check(
  "detects marker in a V2 {type,text} part",
  hasMarker([{ type: "text", text: `${MARKER} some body` }]) === true,
);
check("detects marker in a raw string part", hasMarker([`prefix ${MARKER} suffix`]) === true);
check("empty system array -> false (inject)", hasMarker([]) === false);
check(
  "unmarked text -> false",
  hasMarker([{ type: "text", text: "totally ordinary system prompt" }]) === false,
);
check("non-array input -> false", hasMarker("not an array") === false);

// The globally-installed upstream plugin injects this. Neither may match the
// other, or one plugin's block would suppress the other's.
const UPSTREAM = "[agentmemory-compaction-reminder]";
check(
  "upstream marker does NOT satisfy our guard (no cross-plugin suppression)",
  hasMarker([{ type: "text", text: UPSTREAM }]) === false,
);
check(
  "our marker is not a substring of upstream's (no false coupling)",
  !UPSTREAM.includes(MARKER) && !MARKER.includes(UPSTREAM),
  { MARKER, UPSTREAM },
);
check(
  "mixed array: ours present -> true even alongside upstream",
  hasMarker([
    { type: "text", text: UPSTREAM },
    { type: "text", text: `${MARKER} body` },
  ]) === true,
);
check(
  "array with ONLY upstream -> false (we still inject our own)",
  hasMarker([
    { type: "text", text: UPSTREAM },
    { type: "text", text: "other plugin text" },
  ]) === false,
);

/* ------------------------------------------------------------------ */
section("B. parseRecall against the real response contract");
/* ------------------------------------------------------------------ */
const hit = parseRecall(REAL_BODY);
check("parses the real body", hit !== undefined);
if (hit !== undefined) {
  check("row count", hit.rows.length === 2, hit.rows.length);
  check("source preserved", hit.rows[0]?.source === "vector", hit.rows[0]?.source);
  check(
    "score preserved as finite number",
    typeof hit.rows[0]?.score === "number" && Number.isFinite(hit.rows[0].score),
    hit.rows[0]?.score,
  );
  check("importance preserved", hit.rows[0]?.importance === 0.5, hit.rows[0]?.importance);
  check(
    "memoryId preserved",
    (hit.rows[0]?.memoryId ?? "").startsWith("0a6b1c4f"),
    hit.rows[0]?.memoryId,
  );
  check("createdAt preserved", hit.rows[0]?.createdAt === "2026-09-22T13:30:39.062Z");
  check("no signals on healthy envelope", hit.signals.length === 0, hit.signals);
}
check("non-JSON body -> undefined (no throw)", parseRecall("<<<not json>>>") === undefined);
check("JSON without results -> undefined", parseRecall('{"mode":"hybrid"}') === undefined);
check("JSON array (wrong shape) -> undefined", parseRecall("[1,2,3]") === undefined);
check("null JSON -> undefined", parseRecall("null") === undefined);

const junkRows = parseRecall(
  JSON.stringify({
    mode: "hybrid",
    results: [{ content: "   " }, "not-an-object", { content: "real row", score: 1, source: "text" }],
    signals: [
      "vector: timeout",
      "text: ok",
      "graph: index_not_found",
      "extra: ignored",
      "more: ignored",
    ],
  }),
);
check(
  "drops empty-content and non-object rows",
  junkRows?.rows.length === 1,
  junkRows?.rows.length,
);
check(
  "signals sliced to display cap (lenient, not all-or-nothing)",
  junkRows?.signals.length === 3 && junkRows?.signals[0] === "vector: timeout",
  junkRows?.signals,
);

/* ------------------------------------------------------------------ */
section("C. formatRecall: bounds, enrichment, markerless body");
/* ------------------------------------------------------------------ */
const cfg = config({ options: {}, location: LOCATION });
check("project derived from workspace dir name", cfg.project === "agent-memory", cfg.project);
check("injection enabled by default", cfg.inject === true);
check("default limit", cfg.injectLimit === 8, cfg.injectLimit);

const noRows = formatRecall(cfg, "q", { rows: [], signals: [] });
check("zero rows -> null (nothing injected, no tokens spent)", noRows === null);

const body = hit ? formatRecall(cfg, "dashboard query latency", hit) : null;
check("real body renders a block", typeof body === "string" && body.length > 0);
if (typeof body === "string") {
  check("body is markerless (hooks prepend MARKER exactly once)", !body.includes(MARKER));
  check("names the project", body.includes('"agent-memory"'));
  check("states the fusion mode", body.includes("hybrid RRF"));
  check("echoes the query", body.includes("dashboard query latency"));
  check("carries score enrichment", body.includes("score 0.0492"), body.split("\n")[1]);
  check("carries importance enrichment", body.includes("imp 0.50"));
  check("carries source enrichment", body.includes("[vector"));
  check("short memory id present", body.includes("id=0a6b1c4f"));
  check("includes the recall hint", body.includes("memory_smart_search"));
  check("stays inside the 4000-char budget", body.length <= 4000, body.length);
}

// Row cap: 20 rows must be cut to cfg.injectLimit.
const manyRows = {
  rows: Array.from({ length: 20 }, (_, i) => ({
    memoryId: `id-${i}`,
    content: `row ${i}`,
    score: 0.5,
    source: "text",
    createdAt: "",
    importance: undefined,
  })),
  signals: ["vector: timeout"],
};
const capped = formatRecall(cfg, "q", manyRows);
const numbered = (capped ?? "").split("\n").filter((line) => /^\d+\./.test(line)).length;
check("row count capped at injectLimit (8)", numbered === 8, numbered);
check(
  "degradation surfaced to the model",
  typeof capped === "string" && capped.includes("recall is partial") && capped.includes("vector: timeout"),
);

// Content clipping: a 200k-char memory must not blow up the block.
const huge = formatRecall(cfg, "q", {
  rows: [
    { memoryId: "x", content: "A".repeat(200_000), score: 1, source: "text", createdAt: "", importance: undefined },
  ],
  signals: [],
});
check(
  "huge content clipped",
  typeof huge === "string" && huge.length <= 4000 && huge.includes("..."),
  huge?.length,
);

// Config precedence: option > env > default.
process.env.AGENT_MEMORY_PROJECT = "from-env";
check(
  "env project honoured",
  config({ options: {}, location: LOCATION }).project === "from-env",
  config({ options: {}, location: LOCATION }).project,
);
check(
  "option beats env",
  config({ options: { project: "from-option" }, location: LOCATION }).project === "from-option",
);
delete process.env.AGENT_MEMORY_PROJECT;

// JSON booleans/numbers in opencode.json must be honoured.
const cfgBool = config({
  options: { inject: false, injectLimit: "5", injectTtlMs: 30_000 },
  location: LOCATION,
});
check("JSON boolean inject:false honoured", cfgBool.inject === false, cfgBool.inject);
check("numeric string injectLimit honoured", cfgBool.injectLimit === 5, cfgBool.injectLimit);
check("numeric string injectTtlMs honoured", cfgBool.injectTtlMs === 30_000, cfgBool.injectTtlMs);
check(
  "out-of-range injectLimit falls back to default",
  config({ options: { injectLimit: 999 }, location: LOCATION }).injectLimit === 8,
  config({ options: { injectLimit: 999 }, location: LOCATION }).injectLimit,
);
process.env.AGENT_MEMORY_INJECT = "off";
check(
  "env AGENT_MEMORY_INJECT=off honoured",
  config({ options: {}, location: LOCATION }).inject === false,
);
delete process.env.AGENT_MEMORY_INJECT;

/* ------------------------------------------------------------------ */
section("D. autoRecall against a counting local server");
/* ------------------------------------------------------------------ */
type Mode = "ok" | "500" | "garbage" | "empty";
let mode: Mode = "ok";
let hits = 0;
let lastPath: string | undefined;
let lastAuth: string | undefined;
let lastBody: string | undefined;

const server = http.createServer((req, res) => {
  hits++;
  lastPath = req.url;
  lastAuth = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined;
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    lastBody = Buffer.concat(chunks).toString("utf8");
    if (mode === "500") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"boom"}');
      return;
    }
    if (mode === "garbage") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>definitely not the contract</html>");
      return;
    }
    if (mode === "empty") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ mode: "hybrid", results: [], signals: ["vector: index_not_found"] }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(REAL_BODY);
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("test server has no TCP address");
}
const port = address.port;

// NOTE the trailing "/prefix/": exercises the relative-join rule.
const liveCfg = {
  base: `http://127.0.0.1:${port}/prefix/`,
  secret: "unit-test-secret",
  project: "agent-memory",
  inject: true,
  injectLimit: 8,
  injectTtlMs: 60_000,
};

const b1 = await autoRecall(liveCfg, "sess-1", "dashboard query latency");
check(
  "renders a block from a live 200",
  typeof b1 === "string" && b1.includes("memory_smart_search"),
);
check("one request issued", hits === 1, hits);
check(
  "relative join preserved the /prefix/ path",
  lastPath === "/prefix/agentmemory/smart-search",
  lastPath,
);
check("bearer header sent", lastAuth === "Bearer unit-test-secret", lastAuth);
check(
  "strict body: field-by-field, no spread",
  lastBody === JSON.stringify({
    query: "dashboard query latency",
    concepts: [],
    project: "agent-memory",
    limit: 8,
  }),
  lastBody,
);
check("body is markerless", typeof b1 === "string" && !b1.includes(MARKER));

const b1again = await autoRecall(liveCfg, "sess-1", "dashboard query latency");
check("identical block returned from cache", b1again === b1);
check("CACHE HIT — no second request", hits === 1, hits);

const b2 = await autoRecall(liveCfg, "sess-1", "jwt auth middleware");
check("different query -> new request", hits === 2, hits);
check("different query produced a different block", b2 !== b1);

/* ------------------------------------------------------------------ */
section("E. Fail-soft: HTTP 500, non-contract body, empty result");
/* ------------------------------------------------------------------ */
mode = "500";
const b3 = await autoRecall(liveCfg, "sess-2", "query a");
check("HTTP 500 -> null, no throw (fail-soft)", b3 === null, b3);
check("failure was requested", hits === 3, hits);
const b3again = await autoRecall(liveCfg, "sess-2", "query a");
check("failure negative-cached (no hammering per turn)", hits === 3 && b3again === null, hits);

mode = "garbage";
const b4 = await autoRecall(liveCfg, "sess-2", "query b");
check("non-contract 200 body -> null, no throw", b4 === null, b4);

mode = "empty";
const b5 = await autoRecall(liveCfg, "sess-3", "query c");
check("zero rows -> null (nothing injected)", b5 === null, b5);

/* ------------------------------------------------------------------ */
section("F. The synthetic secret never appears in any observable string");
/* ------------------------------------------------------------------ */
const BOOM_SECRET = "SUPER-SECRET-XYZ-123";
mode = "500";
const errOutcome = await call(
  { ...liveCfg, secret: BOOM_SECRET },
  "POST",
  "agentmemory/smart-search",
  {},
  2_000,
);
check("HTTP error surfaced as ok:false", errOutcome.ok === false, errOutcome);
check(
  "500 note does not leak the secret",
  !JSON.stringify(errOutcome).includes(BOOM_SECRET),
  errOutcome,
);
check("500 note does not leak the URL", !JSON.stringify(errOutcome).includes(String(port)), errOutcome);

const deadSecretCfg = { ...liveCfg, base: "http://127.0.0.1:1", secret: BOOM_SECRET };
const deadOutcome = await call(deadSecretCfg, "POST", "agentmemory/smart-search", {}, 2_000);
check("connection failure surfaced as ok:false", deadOutcome.ok === false, deadOutcome);
check(
  "connection-failure note does not leak the secret",
  !JSON.stringify(deadOutcome).includes(BOOM_SECRET),
  deadOutcome,
);
check(
  "connection-failure note does not leak the URL/host",
  !JSON.stringify(deadOutcome).includes("127.0.0.1"),
  deadOutcome,
);
check(
  "connection-failure note is actionable",
  deadOutcome.ok === false && deadOutcome.note.includes("AGENT_MEMORY_URL"),
  deadOutcome,
);

mode = "ok";
await new Promise<void>((resolve) => server.close(() => resolve()));

/* ------------------------------------------------------------------ */
section("G. Backend completely down");
/* ------------------------------------------------------------------ */
const deadCfg = {
  base: "http://127.0.0.1:1", // nothing listens on tcpmux
  secret: undefined,
  project: "agent-memory",
  inject: true,
  injectLimit: 8,
  injectTtlMs: 60_000,
};
let threw: unknown = null;
let dead: string | null = "sentinel";
try {
  dead = await autoRecall(deadCfg, "sess-dead", "anything at all");
} catch (error) {
  threw = error;
}
check("connection refused -> null, never throws", threw === null && dead === null, { threw, dead });

const started = Date.now();
try {
  await autoRecall(deadCfg, "sess-dead", "anything at all");
} catch (error) {
  threw = error;
}
check("second call also never throws", threw === null, threw);
check("dead-backend path is fast (negative cached)", Date.now() - started < 50, Date.now() - started);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
