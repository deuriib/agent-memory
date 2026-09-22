/**
 * End-to-end verification (contract §5) + embedder determinism proof.
 *
 *   §5 bar: health → remember (with concepts) → bm25 hits → smart-search hits
 *           → sessions list → session memories → forget → gone → healthCount
 *           reflects it. Plus: embed determinism (same input → identical
 *           vector, L2 ≈ 1), default-value proof, and boundary validation.
 *
 * Talks to a RUNNING agent-memory REST server (default
 * http://127.0.0.1:3111, override with AGENT_MEMORY_URL). Uses a unique
 * project per run so counts are isolated from demo data and re-runs stay
 * clean. Attaches Authorization automatically when AGENT_MEMORY_SECRET is
 * set in this shell (same env as the server).
 *
 * Exit 0 only when every assertion passes.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { embed } from "../src/embed.js";
import { logSafeNote } from "../src/errors.js";

const BASE_RAW = process.env.AGENT_MEMORY_URL ?? "http://127.0.0.1:3111";
const BASE = new URL(BASE_RAW.endsWith("/") ? BASE_RAW : `${BASE_RAW}/`);
const SECRET = process.env["AGENT_MEMORY_SECRET"];

/**
 * Golden snapshot: the first 6 non-zero (index, value) pairs of
 * embed("jwt token expiry") — here: 3 distinct tokens, each landing in its
 * own bucket at ±1/sqrt(3) after the tf=1 weighting and L2 normalization.
 * A plain `slice(0, 8)` would be all zeros for every sparse 3-token input
 * and could never catch drift; this form detects bucket (hash), sign
 * (second hash), weighting, and normalization changes at once.
 * Refresh ONLY alongside a deliberate, documented change to the embedder.
 */
const GOLDEN = "[[62,0.5773502691896258],[178,-0.5773502691896258],[382,-0.5773502691896258]]";

function goldenSnapshot(vector: readonly number[]): string {
  const nonZero: [number, number][] = [];
  for (let i = 0; i < vector.length && nonZero.length < 6; i++) {
    const value = vector[i];
    if (value !== undefined && value !== 0) nonZero.push([i, value]);
  }
  return JSON.stringify(nonZero);
}

/* ------------------------------------------------------------------ */
/* Assertion plumbing                                                  */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

function shape<T>(name: string, body: unknown, schema: z.ZodType<T>): T | undefined {
  const result = schema.safeParse(body);
  if (result.success) {
    passed += 1;
    console.log(`PASS  ${name}`);
    return result.data;
  }
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  failures.push(name);
  console.log(`FAIL  ${name} — ${detail} — body=${brief(body)}`);
  return undefined;
}

function brief(body: unknown): string {
  try {
    return (JSON.stringify(body) ?? "undefined").slice(0, 300);
  } catch {
    return String(body).slice(0, 300);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP client (no string-built URLs: URL + searchParams everywhere)   */
/* ------------------------------------------------------------------ */

interface HttpResult {
  status: number;
  body: unknown;
}

function endpoint(path: string, query?: Record<string, string>): URL {
  const url = new URL(path.replace(/^\//, ""), BASE);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url;
}

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
      signal: AbortSignal.timeout(10_000),
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
/* Expected shapes (contract §3)                                       */
/* ------------------------------------------------------------------ */

const memoryRowShape = {
  id: z.string(),
  memoryId: z.string(),
  content: z.string(),
  sessionId: z.string(),
  origin: z.string(),
  importance: z.number(),
  createdAt: z.string(),
};

const searchRowShape = { ...memoryRowShape, score: z.number() };

const rememberResultSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  project: z.string(),
  concepts: z.array(z.string()),
});

const healthEnvelopeSchema = z.object({
  status: z.literal("ok"),
  counts: z.object({ memories: z.number(), sessions: z.number() }),
});

const bm25EnvelopeSchema = z.object({
  mode: z.literal("bm25"),
  results: z.array(z.object({ ...searchRowShape, source: z.literal("text") })),
  signals: z.array(z.string()),
});

const hybridEnvelopeSchema = z.object({
  mode: z.literal("hybrid"),
  results: z.array(
    z.object({
      ...searchRowShape,
      source: z.enum(["vector", "text", "graph"]),
      signals: z.array(z.string()),
    }),
  ),
  signals: z.array(z.string()),
});

const sessionsEnvelopeSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      project: z.string(),
      startedAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

const memoriesEnvelopeSchema = z.object({ memories: z.array(z.object(memoryRowShape)) });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ------------------------------------------------------------------ */
/* Steps                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  /* A. Embedder determinism — pure, needs no server. */
  const text = "agent memory hybrid retrieval with deterministic embeddings";
  const e1 = embed(text);
  const e2 = embed(text);
  const e3 = embed("a completely different sentence entirely");
  check("embed: length is 384", e1.length === 384, `got ${e1.length}`);
  check("embed: same input -> identical vector", JSON.stringify(e1) === JSON.stringify(e2));
  check("embed: different input -> different vector", JSON.stringify(e1) !== JSON.stringify(e3));
  const norm = Math.sqrt(e1.reduce((sum, value) => sum + value * value, 0));
  check("embed: L2 norm ~= 1", Math.abs(norm - 1) < 1e-9, `norm=${norm}`);
  const empty = embed("");
  check(
    "embed: empty input -> zero vector of length 384",
    empty.length === 384 && empty.every((value) => value === 0),
  );
  const goldenActual = goldenSnapshot(embed("jwt token expiry"));
  check(
    "embed: golden snapshot (drift guard)",
    goldenActual === GOLDEN,
    `got ${goldenActual}, want ${GOLDEN}`,
  );

  /* B. Server reachable? */
  const livez = await call("GET", "/agentmemory/livez");
  if (livez.status === -1) {
    console.error(`\nserver not reachable at ${BASE.href} — start it first: npx tsx src/server.ts`);
    process.exit(1);
  }
  check("livez: status 200", livez.status === 200, `got ${livez.status}`);
  shape("livez: {status:'ok'}", livez.body, z.object({ status: z.literal("ok") }));

  /* C. Health baseline on a fresh, unique project. */
  const project = `verify-${randomUUID().slice(0, 8)}`;
  const h0res = await call("GET", "/agentmemory/health", { project });
  check("health: status 200", h0res.status === 200, `got ${h0res.status}; body=${brief(h0res.body)}`);
  const h0 = shape("health: {status, counts:{memories,sessions}}", h0res.body, healthEnvelopeSchema);
  check("health: fresh project -> 0 memories", h0?.counts.memories === 0, `got ${h0?.counts.memories}`);
  check("health: fresh project -> 0 sessions", h0?.counts.sessions === 0, `got ${h0?.counts.sessions}`);

  /* D. remember ×4 (contract §5 needs concepts; D probes the defaults). */
  const nonce = randomUUID().replace(/-/g, ""); // one unique searchable token
  const sidA = `verify-a-${randomUUID().slice(0, 8)}`;
  const sidB = `verify-b-${randomUUID().slice(0, 8)}`;
  const sidC = `verify-c-${randomUUID().slice(0, 8)}`;

  const remA = await call("POST", "/agentmemory/remember", undefined, {
    content: `JWT auth middleware signs tokens with HS256 and a 15 minute expiry ${nonce}`,
    concepts: ["auth", "jwt"],
    project,
    sessionId: sidA,
  });
  check("remember A: status 201", remA.status === 201, `got ${remA.status}; body=${brief(remA.body)}`);
  const rA = shape("remember A: {id, sessionId, project, concepts}", remA.body, rememberResultSchema);
  if (rA !== undefined) {
    check("remember A: echoes sessionId", rA.sessionId === sidA, rA.sessionId);
    check("remember A: echoes project", rA.project === project, rA.project);
    check(
      "remember A: echoes concepts",
      JSON.stringify(rA.concepts) === JSON.stringify(["auth", "jwt"]),
      JSON.stringify(rA.concepts),
    );
    check("remember A: id is a uuid", UUID_RE.test(rA.id), rA.id);
  }

  const remB = await call("POST", "/agentmemory/remember", undefined, {
    content: `N+1 query fix: batched user lookups cut dashboard p95 latency from 820ms to 45ms ${nonce}`,
    concepts: ["performance", "sql"],
    project,
    sessionId: sidB,
  });
  check("remember B: status 201", remB.status === 201, `got ${remB.status}`);
  const rB = shape("remember B: body shape", remB.body, rememberResultSchema);

  const remC = await call("POST", "/agentmemory/remember", undefined, {
    content: `Rate limiting with a token bucket: 60 requests per minute, burst 10, respond 429 ${nonce}`,
    concepts: ["reliability"],
    project,
    sessionId: sidC,
  });
  check("remember C: status 201", remC.status === 201, `got ${remC.status}`);
  const rC = shape("remember C: body shape", remC.body, rememberResultSchema);

  // D: no sessionId / origin / importance / concepts -> contract defaults.
  const remD = await call("POST", "/agentmemory/remember", undefined, {
    content: `defaults probe memory ${nonce}`,
    project,
  });
  check("remember D (defaults): status 201", remD.status === 201, `got ${remD.status}; body=${brief(remD.body)}`);
  const rD = shape("remember D: body shape", remD.body, rememberResultSchema);
  if (rD !== undefined) {
    check("remember D: auto-generated sessionId", UUID_RE.test(rD.sessionId), rD.sessionId);
    check("remember D: default concepts []", rD.concepts.length === 0, JSON.stringify(rD.concepts));
  }

  if (rA === undefined || rB === undefined || rC === undefined || rD === undefined) {
    throw new Error("aborting: a remember step failed (see FAIL lines above)");
  }

  /* E. bm25 search hits. */
  const s1 = await call("POST", "/agentmemory/search", undefined, { query: nonce, project, limit: 10 });
  check("bm25: status 200", s1.status === 200, `got ${s1.status}; body=${brief(s1.body)}`);
  const bm = shape("bm25: {mode:'bm25', results, signals}", s1.body, bm25EnvelopeSchema);
  if (bm !== undefined) {
    check(
      "bm25: finds all 4 seeded memories",
      bm.results.length === 4,
      `got ${bm.results.length}; signals=${JSON.stringify(bm.signals)}`,
    );
    if (bm.results.length === 0 && bm.signals.length > 0) {
      console.log(`      hint: signals=${JSON.stringify(bm.signals)} — run npm run bootstrap if this mentions index_not_found`);
    }
    check("bm25: includes remembered A", bm.results.some((row) => row.memoryId === rA.id));
    const rowD = bm.results.find((row) => row.memoryId === rD.id);
    check("bm25: D row shows origin default 'rest'", rowD?.origin === "rest", rowD?.origin);
    check("bm25: D row shows importance default 0.5", rowD?.importance === 0.5, String(rowD?.importance));
    check("bm25: D row shows auto sessionId", rowD?.sessionId === rD.sessionId, rowD?.sessionId);
  }

  /* F. smart-search (hybrid RRF) hits. */
  const s2 = await call("POST", "/agentmemory/smart-search", undefined, {
    query: "dashboard query latency",
    concepts: ["performance"],
    project,
    limit: 10,
  });
  check("smart-search: status 200", s2.status === 200, `got ${s2.status}; body=${brief(s2.body)}`);
  const hy = shape("smart-search: {mode:'hybrid', results, signals}", s2.body, hybridEnvelopeSchema);
  if (hy !== undefined) {
    check(
      "smart-search: at least 1 hit",
      hy.results.length >= 1,
      `got ${hy.results.length}; signals=${JSON.stringify(hy.signals)}`,
    );
    const ours = new Set([rA.id, rB.id, rC.id, rD.id]);
    check("smart-search: hits are our memories", hy.results.some((row) => ours.has(row.memoryId)));
  }

  /* G. sessions list. */
  const ses = await call("GET", "/agentmemory/sessions", { project, limit: "50" });
  check("sessions: status 200", ses.status === 200, `got ${ses.status}; body=${brief(ses.body)}`);
  const sesBody = shape("sessions: {sessions:[...]}", ses.body, sessionsEnvelopeSchema);
  if (sesBody !== undefined) {
    const sessionIds = new Set(sesBody.sessions.map((row) => row.sessionId));
    check(
      "sessions: contains sessions A/B/C",
      sessionIds.has(sidA) && sessionIds.has(sidB) && sessionIds.has(sidC),
      `got ${[...sessionIds].join(", ") || "(none)"}`,
    );
    check("sessions: contains auto-generated session D", sessionIds.has(rD.sessionId), rD.sessionId);
  }

  /* H. session memories. */
  const mem = await call("GET", `/agentmemory/sessions/${encodeURIComponent(sidA)}/memories`, {
    project,
    limit: "50",
  });
  check("session memories: status 200", mem.status === 200, `got ${mem.status}; body=${brief(mem.body)}`);
  const memBody = shape("session memories: {memories:[...]}", mem.body, memoriesEnvelopeSchema);
  if (memBody !== undefined) {
    check("session memories: finds A", memBody.memories.some((row) => row.memoryId === rA.id));
    check(
      "session memories: all rows belong to session A",
      memBody.memories.every((row) => row.sessionId === sidA),
      memBody.memories.map((row) => row.sessionId).join(", "),
    );
  }

  /* I. forget. */
  const fg = await call("POST", "/agentmemory/forget", undefined, { memoryId: rA.id });
  check("forget A: status 200", fg.status === 200, `got ${fg.status}; body=${brief(fg.body)}`);
  shape("forget A: {forgotten:true}", fg.body, z.object({ forgotten: z.literal(true) }));

  /* J. gone — three independent proofs. */
  const mem2 = await call("GET", `/agentmemory/sessions/${encodeURIComponent(sidA)}/memories`, {
    project,
    limit: "50",
  });
  const memBody2 = shape("gone: session A listing still valid", mem2.body, memoriesEnvelopeSchema);
  check(
    "gone: session A no longer lists A",
    memBody2 !== undefined && !memBody2.memories.some((row) => row.memoryId === rA.id),
  );

  const s3 = await call("POST", "/agentmemory/search", undefined, { query: nonce, project, limit: 10 });
  const bm2 = shape("gone: bm25 envelope after forget", s3.body, bm25EnvelopeSchema);
  check(
    "gone: bm25 returns exactly the 3 remaining memories",
    bm2 !== undefined && bm2.results.length === 3 && !bm2.results.some((row) => row.memoryId === rA.id),
    bm2 === undefined ? "no envelope" : `got ${bm2.results.length} rows`,
  );

  const fg2 = await call("POST", "/agentmemory/forget", undefined, { memoryId: rA.id });
  check("gone: forgetting A again -> 404", fg2.status === 404, `got ${fg2.status}; body=${brief(fg2.body)}`);

  const fg3 = await call("POST", "/agentmemory/forget", undefined, { memoryId: randomUUID() });
  check("gone: forgetting unknown id -> 404", fg3.status === 404, `got ${fg3.status}; body=${brief(fg3.body)}`);

  /* K. healthCount() reflects the forget (4 seeded − 1 forgotten = 3). */
  const h1res = await call("GET", "/agentmemory/health", { project });
  const h1 = shape("health after forget: envelope", h1res.body, healthEnvelopeSchema);
  check(
    "healthCount: memories = 3 after forget (4 − 1)",
    h1 !== undefined && h1.counts.memories === 3,
    `got ${h1?.counts.memories}`,
  );
  check(
    "healthCount: sessions = 4 (forget drops the memory, not the session)",
    h1 !== undefined && h1.counts.sessions === 4,
    `got ${h1?.counts.sessions}`,
  );

  /* L. Boundary validation: every inbound payload is rejected when invalid. */
  const bad1 = await call("POST", "/agentmemory/remember", undefined, {});
  check("boundary: empty remember body -> 400", bad1.status === 400, `got ${bad1.status}`);
  const bad2 = await call("POST", "/agentmemory/search", undefined, [1, 2, 3]);
  check("boundary: array body on search -> 400", bad2.status === 400, `got ${bad2.status}`);
  const bad3 = await call("GET", "/agentmemory/nope");
  check("boundary: unknown route -> 404", bad3.status === 404, `got ${bad3.status}`);
  const bad4 = await call("POST", "/agentmemory/livez");
  check("boundary: wrong method on livez -> 405", bad4.status === 405, `got ${bad4.status}`);
  let bad5Status = -2;
  try {
    const response = await fetch(endpoint("/agentmemory/remember"), {
      method: "POST",
      headers: authHeaders({ "content-type": "text/plain" }),
      body: "content=not-json-object",
      signal: AbortSignal.timeout(10_000),
    });
    bad5Status = response.status;
  } catch (err) {
    console.log(`      (415 probe error: ${logSafeNote(err)})`);
  }
  check("boundary: non-JSON content-type -> 415", bad5Status === 415, `got ${bad5Status}`);

  /* M. Summary. */
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY PASS");
}

main().catch((err: unknown) => {
  console.error(`verify crashed: ${logSafeNote(err)}`);
  process.exit(1);
});
