/**
 * End-to-end verification (contract §5) + embedder determinism proof.
 *
 *   §5 bar: health → remember (with concepts) → bm25 hits → smart-search hits
 *           → sessions list → session memories → forget → gone → healthCount
 *           reflects it. Plus: embed determinism (same input → identical
 *           vector, L2 ≈ 1), default-value proof, and boundary validation.
 *
 * Talks to a RUNNING agent-memory REST server (default
 * http://127.0.0.1:3111, override with AGENT_MEMORY_URL). A read-only
 * identity probe runs first and aborts (exit 1, nothing written) when the
 * target does not answer as our P3.1 server. Uses a unique
 * project per run so counts are isolated from demo data and re-runs stay
 * clean. Attaches Authorization automatically when AGENT_MEMORY_SECRET is
 * set in this shell (same env as the server).
 *
 * Exit 0 only when every assertion passes.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { confidenceBoost, deriveWriteImportance, recallCount, resetRecalls } from "../src/confidence.js";
import { embed } from "../src/embed.js";
import { logSafeNote } from "../src/errors.js";
import { bm25Search, hybridSearch } from "../src/search.js";
import type { MemoryStore, SearchHit } from "../src/store.js";

const BASE_RAW = process.env["AGENT_MEMORY_URL"] ?? "http://127.0.0.1:3111";
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
  // REQ-P1-6: additive; optional so pre-dedup lanes still shape-parse.
  deduped: z.boolean().optional(),
  // REQ-P1-2: additive; optional so pre-consolidation lanes still shape-parse.
  consolidated: z.boolean().optional(),
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

/* P3.1 frozen shapes (contract §3): recap, handoff, lesson 201 reuses
 * rememberResultSchema ({id, sessionId, project, concepts}), delete receipt. */
const recapEnvelopeSchema = z.object({
  recap: z.string(),
  sessionId: z.string().nullable(),
  count: z.number(),
  signals: z.array(z.string()),
});

const handoffEnvelopeSchema = z.object({
  handoff: z.string(),
  sessionId: z.string().nullable(),
  counts: z.object({ memories: z.number(), sessions: z.number() }),
  signals: z.array(z.string()),
});

const deleteResultSchema = z.object({
  deleted: z.literal(true),
  receipt: z.object({ memoryId: z.string(), deletedAt: z.string().min(1) }),
});

const notFoundSchema = z.object({ error: z.literal("not_found") });

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

  /* Identity guard (read-only) — BEFORE the first write. The default target
   * 127.0.0.1:3111 is where the upstream `agentmemory` normally lives, and a
   * plain run would otherwise write test rows into it. POST
   * /memory/recap with `{}` is our P3.1 surface (every recap field is
   * optional) and reads nothing: 200 => the target is OUR server, anything
   * else (404 from upstream, connection failure, 401) => abort with no writes. */
  const identity = await call("POST", "/memory/recap", undefined, {});
  if (identity.status !== 200) {
    console.error(
      [
        "",
        `identity guard: POST ${endpoint("memory/recap").href} -> ${identity.status}` +
          (identity.status === -1
            ? ` (unreachable: ${String(identity.body)})`
            : ` (body=${brief(identity.body)})`),
        "expected 200 from OUR P3.1 server — the upstream `agentmemory` most likely holds this",
        `port (3111 is its default; see README "Known limitations" → port conflict). Point verify`,
        "at OUR server instead, per the README conflict procedure, then re-run:",
        "",
        "  AGENT_MEMORY_URL=http://127.0.0.1:<your-port> npm run verify",
        "",
        "No data was written.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log("identity: POST /memory/recap -> 200 (our P3.1 server), proceeding");

  /* B. Server reachable? */
  const livez = await call("GET", "/memory/livez");
  if (livez.status === -1) {
    console.error(`\nserver not reachable at ${BASE.href} — start it first: npx tsx src/server.ts`);
    process.exit(1);
  }
  check("livez: status 200", livez.status === 200, `got ${livez.status}`);
  shape("livez: {status:'ok'}", livez.body, z.object({ status: z.literal("ok") }));

  /* C. Health baseline on a fresh, unique project. */
  const project = `verify-${randomUUID().slice(0, 8)}`;
  const h0res = await call("GET", "/memory/health", { project });
  check("health: status 200", h0res.status === 200, `got ${h0res.status}; body=${brief(h0res.body)}`);
  const h0 = shape("health: {status, counts:{memories,sessions}}", h0res.body, healthEnvelopeSchema);
  check("health: fresh project -> 0 memories", h0?.counts.memories === 0, `got ${h0?.counts.memories}`);
  check("health: fresh project -> 0 sessions", h0?.counts.sessions === 0, `got ${h0?.counts.sessions}`);

  /* D. remember ×4 (contract §5 needs concepts; D probes the defaults). */
  const nonce = randomUUID().replace(/-/g, ""); // one unique searchable token
  const sidA = `verify-a-${randomUUID().slice(0, 8)}`;
  const sidB = `verify-b-${randomUUID().slice(0, 8)}`;
  const sidC = `verify-c-${randomUUID().slice(0, 8)}`;

  const remA = await call("POST", "/memory/remember", undefined, {
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
    check("remember A: deduped false on first insert", rA.deduped === false, String(rA.deduped));
  }

  const remB = await call("POST", "/memory/remember", undefined, {
    content: `N+1 query fix: batched user lookups cut dashboard p95 latency from 820ms to 45ms ${nonce}`,
    concepts: ["performance", "sql"],
    project,
    sessionId: sidB,
  });
  check("remember B: status 201", remB.status === 201, `got ${remB.status}`);
  const rB = shape("remember B: body shape", remB.body, rememberResultSchema);

  const remC = await call("POST", "/memory/remember", undefined, {
    content: `Rate limiting with a token bucket: 60 requests per minute, burst 10, respond 429 ${nonce}`,
    concepts: ["reliability"],
    project,
    sessionId: sidC,
  });
  check("remember C: status 201", remC.status === 201, `got ${remC.status}`);
  const rC = shape("remember C: body shape", remC.body, rememberResultSchema);

  // D: no sessionId / origin / concepts -> contract defaults; no importance
  // -> DERIVED at write time (REQ-P1-4, no flat 0.5 anywhere).
  const remD = await call("POST", "/memory/remember", undefined, {
    content: `defaults probe memory ${nonce}`,
    project,
  });
  check("remember D (defaults): status 201", remD.status === 201, `got ${remD.status}; body=${brief(remD.body)}`);
  const rD = shape("remember D: body shape", remD.body, rememberResultSchema);
  if (rD !== undefined) {
    check("remember D: auto-generated sessionId", UUID_RE.test(rD.sessionId), rD.sessionId);
    // REQ-P1-3 / T-101: no caller concepts -> a deterministic derived list
    // (non-empty, ≤8, every entry within the 1..200 concept bound).
    check(
      "remember D: derived default concepts non-empty ≤8",
      rD.concepts.length > 0 &&
        rD.concepts.length <= 8 &&
        rD.concepts.every((c) => c.length >= 1 && c.length <= 200),
      JSON.stringify(rD.concepts),
    );
  }

  if (rA === undefined || rB === undefined || rC === undefined || rD === undefined) {
    throw new Error("aborting: a remember step failed (see FAIL lines above)");
  }

  /* E. bm25 search hits. */
  const s1 = await call("POST", "/memory/search", undefined, { query: nonce, project, limit: 10 });
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
    // REQ-P1-4: absent importance is DERIVED (origin base + concept bonus),
    // not the retired flat 0.5 — expected value computed from the concepts
    // the 201 actually echoed, so derivation drift cannot self-pass.
    const expectedImportanceD = deriveWriteImportance("rest", rD.concepts.length);
    check(
      "bm25: D row shows DERIVED importance (REQ-P1-4: rest base + concept bonus)",
      rowD?.importance === expectedImportanceD && expectedImportanceD !== 0.5,
      `got ${rowD?.importance}, expected ${expectedImportanceD}`,
    );
    check("bm25: D row shows auto sessionId", rowD?.sessionId === rD.sessionId, rowD?.sessionId);
  }

  /* F. smart-search (hybrid RRF) hits. */
  const s2 = await call("POST", "/memory/smart-search", undefined, {
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

  /* F2. graph-branch proof (REQ-P1-3): derived concepts reach the graph
   * source. Isolated project: M1 with NO caller concepts (derivation) and an
   * unrelated M2 (zero shared tokens). smart-search with M1's derived top
   * concept must (a) run the graph source with NO `graph:` failure signal
   * and (b) fuse M1 at rank 1 in all three sources -> score exactly 3/61
   * (1/(60+1) × 3, ranks 1-based). On mismatch the FAIL line records the
   * actual score + fused order — the assertion is never loosened. */
  const gProject = `verify-g-${randomUUID().slice(0, 8)}`;
  const remM1 = await call("POST", "/memory/remember", undefined, {
    content: "quantum quantum entanglement experiment entangles photon pairs inside the clean lab room",
    project: gProject,
  });
  check("graph-branch: M1 status 201", remM1.status === 201, `got ${remM1.status}; body=${brief(remM1.body)}`);
  const rM1 = shape("graph-branch: M1 body shape", remM1.body, rememberResultSchema);

  const remM2 = await call("POST", "/memory/remember", undefined, {
    content: "tomato seedlings need south facing windowsill light and weekly watering",
    project: gProject,
  });
  check("graph-branch: M2 status 201", remM2.status === 201, `got ${remM2.status}; body=${brief(remM2.body)}`);
  shape("graph-branch: M2 body shape", remM2.body, rememberResultSchema);

  if (rM1 === undefined) {
    throw new Error("aborting: graph-branch M1 remember failed (see FAIL lines above)");
  }
  check(
    "graph-branch: M1 derived concepts lead with 'quantum' (tf=2)",
    rM1.concepts[0] === "quantum" && rM1.concepts.includes("quantum"),
    JSON.stringify(rM1.concepts),
  );

  const gs = await call("POST", "/memory/smart-search", undefined, {
    query: "quantum entanglement lab bench",
    concepts: [rM1.concepts[0] ?? "quantum"],
    project: gProject,
    limit: 10,
  });
  check("graph-branch: smart-search status 200", gs.status === 200, `got ${gs.status}; body=${brief(gs.body)}`);
  const gh = shape("graph-branch: hybrid envelope", gs.body, hybridEnvelopeSchema);
  if (gh !== undefined) {
    check(
      "graph-branch: no `graph:` failure signal (graph source ran)",
      !gh.signals.some((s) => s.startsWith("graph:")),
      JSON.stringify(gh.signals),
    );
    const m1Row = gh.results.find((row) => row.memoryId === rM1.id);
    const record = JSON.stringify({
      expected: 3 / 61,
      actual: m1Row?.score,
      order: gh.results.map((row) => ({ memoryId: row.memoryId, score: row.score, source: row.source })),
      signals: gh.signals,
    });
    check("graph-branch: M1 ranks first in fused results", gh.results[0]?.memoryId === rM1.id, record);
    check(
      "graph-branch: M1 fused score == 3/61 (rank 1 in vector+text+graph)",
      m1Row !== undefined && Math.abs(m1Row.score - 3 / 61) <= 1e-9,
      record,
    );
  }

  /* F3. content-hash dedup (REQ-P1-6 / T-102) — isolated projects so the
   * §5 counts in the main project stay untouched. */
  const dProject = `verify-dedup-${randomUUID().slice(0, 8)}`;
  const dProjectB = `verify-dedup-b-${randomUUID().slice(0, 8)}`;
  const dContent = `dedup e2e content ${nonce}`;

  const d1 = await call("POST", "/memory/remember", undefined, { content: dContent, project: dProject });
  check("dedup: first insert status 201", d1.status === 201, `got ${d1.status}; body=${brief(d1.body)}`);
  const rd1 = shape("dedup: first insert body", d1.body, rememberResultSchema);
  check("dedup: first insert deduped=false", rd1?.deduped === false, String(rd1?.deduped));

  const d2 = await call("POST", "/memory/remember", undefined, { content: dContent, project: dProject });
  const rd2 = shape("dedup: duplicate body", d2.body, rememberResultSchema);
  check(
    "dedup: identical content -> SAME id + deduped=true",
    rd2 !== undefined && rd1 !== undefined && rd2.id === rd1.id && rd2.deduped === true,
    `ids ${rd1?.id} vs ${rd2?.id}, deduped=${String(rd2?.deduped)}`,
  );

  // Case/whitespace variant must normalize to the SAME key end-to-end.
  const d3 = await call("POST", "/memory/remember", undefined, {
    content: `  DEDUP   e2e   content ${nonce}  `,
    project: dProject,
  });
  const rd3 = shape("dedup: normalized variant body", d3.body, rememberResultSchema);
  check(
    "dedup: case/whitespace variant -> SAME id + deduped=true",
    rd3 !== undefined && rd1 !== undefined && rd3.id === rd1.id && rd3.deduped === true,
    `ids ${rd1?.id} vs ${rd3?.id}, deduped=${String(rd3?.deduped)}`,
  );

  const hDedup = shape(
    "dedup: project health envelope",
    (await call("GET", "/memory/health", { project: dProject })).body,
    healthEnvelopeSchema,
  );
  check("dedup: duplicates collapse to exactly 1 memory", hDedup?.counts.memories === 1, `got ${hDedup?.counts.memories}`);

  // Same content in a DIFFERENT project is a different memory (project in hash).
  const d4 = await call("POST", "/memory/remember", undefined, { content: dContent, project: dProjectB });
  const rd4 = shape("dedup: cross-project body", d4.body, rememberResultSchema);
  check(
    "dedup: same content DIFFERENT project -> different id, deduped=false",
    rd4 !== undefined && rd1 !== undefined && rd4.id !== rd1.id && rd4.deduped === false,
    `ids ${rd1?.id} vs ${rd4?.id}, deduped=${String(rd4?.deduped)}`,
  );

  // Race: two concurrent remembers of the same content — per-key lock means
  // one insert + one dedup hit: same id, healthCount +1 only.
  const raceProject = `verify-race-${randomUUID().slice(0, 8)}`;
  const raceContent = `race e2e content ${nonce}`;
  const [race1, race2] = await Promise.all([
    call("POST", "/memory/remember", undefined, {
      content: raceContent,
      project: raceProject,
      sessionId: "race-s1",
    }),
    call("POST", "/memory/remember", undefined, {
      content: raceContent,
      project: raceProject,
      sessionId: "race-s2",
    }),
  ]);
  const rr1 = shape("dedup race: first body", race1.body, rememberResultSchema);
  const rr2 = shape("dedup race: second body", race2.body, rememberResultSchema);
  check(
    "dedup race: both 201",
    race1.status === 201 && race2.status === 201,
    `got ${race1.status}/${race2.status}`,
  );
  check(
    "dedup race: SAME id, deduped flags {false,true}",
    rr1 !== undefined &&
      rr2 !== undefined &&
      rr1.id === rr2.id &&
      [rr1.deduped, rr2.deduped].sort().join(",") === "false,true",
    `ids ${rr1?.id} vs ${rr2?.id}, flags ${String(rr1?.deduped)}/${String(rr2?.deduped)}`,
  );
  check(
    "dedup race: sessionId echoes each REQUEST",
    rr1?.sessionId === "race-s1" && rr2?.sessionId === "race-s2",
    `${rr1?.sessionId} / ${rr2?.sessionId}`,
  );
  const hRace = shape(
    "dedup race: project health envelope",
    (await call("GET", "/memory/health", { project: raceProject })).body,
    healthEnvelopeSchema,
  );
  check(
    "dedup race: healthCount +1 only (pair collapsed to 1 memory)",
    hRace?.counts.memories === 1,
    `got ${hRace?.counts.memories}`,
  );

  /* F4. dedup × hook interaction (QA-05 / CE-001) — PINS the contract §3
   * first-wins + session-materialization semantics. Hook-style fixed content
   * ("agent session stopped", origin "hook:Stop", NO nonce — exactly what
   * hooks/capture.mjs stores for Stop) on an isolated random project, so the
   * dedup key is fresh per run even though the content is a constant:
   *   (a) novel save in session S1        -> 201, deduped:false;
   *   (b) SAME content in NEW session S2  -> 201, deduped:true, SAME id,
   *       memory count unchanged, and NO Session node for S2 (sessions
   *       materialize only on novel writes) — the response still echoes the
   *       REQUEST's S2 per §3 while the row stays under S1 (sessionMemories
   *       of S2 does not list it until S2 writes something novel);
   *   (c) same content in ANOTHER project -> new row (dedup is
   *       project-scoped FIRST-WINS). Documented in contract §3. */
  const hookProject = `verify-hook-${randomUUID().slice(0, 8)}`;
  const hookProjectB = `verify-hook-b-${randomUUID().slice(0, 8)}`;
  const hookContent = "agent session stopped"; // exact Stop-hook allowlisted string
  const hookS1 = `verify-hook-s1-${randomUUID().slice(0, 8)}`;
  const hookS2 = `verify-hook-s2-${randomUUID().slice(0, 8)}`;

  const hd1a = await call("POST", "/memory/remember", undefined, {
    content: hookContent,
    origin: "hook:Stop",
    project: hookProject,
    sessionId: hookS1,
  });
  check(
    "hook-dedup: S1 novel save status 201",
    hd1a.status === 201,
    `got ${hd1a.status}; body=${brief(hd1a.body)}`,
  );
  const rhd1 = shape("hook-dedup: S1 body shape", hd1a.body, rememberResultSchema);
  check("hook-dedup: S1 deduped=false", rhd1?.deduped === false, String(rhd1?.deduped));
  check("hook-dedup: S1 echoes sessionId S1", rhd1?.sessionId === hookS1, rhd1?.sessionId);

  const hd2 = await call("POST", "/memory/remember", undefined, {
    content: hookContent,
    origin: "hook:Stop",
    project: hookProject,
    sessionId: hookS2,
  });
  check("hook-dedup: S2 repeat save status 201", hd2.status === 201, `got ${hd2.status}; body=${brief(hd2.body)}`);
  const rhd2 = shape("hook-dedup: S2 body shape", hd2.body, rememberResultSchema);
  check(
    "hook-dedup: S2 deduped=true + SAME id (first-wins, no new row)",
    rhd1 !== undefined && rhd2 !== undefined && rhd2.deduped === true && rhd2.id === rhd1.id,
    `ids ${rhd1?.id} vs ${rhd2?.id}, deduped=${String(rhd2?.deduped)}`,
  );
  check(
    "hook-dedup: S2 response echoes REQUEST sessionId (§3) while row stays under S1",
    rhd2?.sessionId === hookS2,
    rhd2?.sessionId,
  );

  const hHook = shape(
    "hook-dedup: project health envelope",
    (await call("GET", "/memory/health", { project: hookProject })).body,
    healthEnvelopeSchema,
  );
  check(
    "hook-dedup: memory count stays 1 after the S2 dedup hit (NO new memory)",
    hHook?.counts.memories === 1,
    `got ${hHook?.counts.memories}`,
  );

  const sesHook = shape(
    "hook-dedup: sessions envelope",
    (await call("GET", "/memory/sessions", { project: hookProject, limit: "50" })).body,
    sessionsEnvelopeSchema,
  );
  const hookSessionIds = new Set(sesHook?.sessions.map((row) => row.sessionId) ?? []);
  check(
    "hook-dedup: listSessions has S1 only — S2 never materialized (dedup hit writes no Session node)",
    hookSessionIds.size === 1 && hookSessionIds.has(hookS1) && !hookSessionIds.has(hookS2),
    JSON.stringify([...hookSessionIds]),
  );

  const smH1 = shape(
    "hook-dedup: S1 sessionMemories envelope",
    (
      await call("GET", `/memory/sessions/${encodeURIComponent(hookS1)}/memories`, {
        project: hookProject,
        limit: "50",
      })
    ).body,
    memoriesEnvelopeSchema,
  );
  check(
    "hook-dedup: sessionMemories(S1) contains the row (original session keeps it)",
    rhd1 !== undefined && smH1 !== undefined && smH1.memories.some((row) => row.memoryId === rhd1.id),
  );
  const smH2 = shape(
    "hook-dedup: S2 sessionMemories envelope",
    (
      await call("GET", `/memory/sessions/${encodeURIComponent(hookS2)}/memories`, {
        project: hookProject,
        limit: "50",
      })
    ).body,
    memoriesEnvelopeSchema,
  );
  check(
    "hook-dedup: sessionMemories(S2) does NOT list it (echoed session ≠ membership)",
    rhd1 !== undefined && smH2 !== undefined && !smH2.memories.some((row) => row.memoryId === rhd1.id),
  );

  const hd3 = await call("POST", "/memory/remember", undefined, {
    content: hookContent,
    origin: "hook:Stop",
    project: hookProjectB,
    sessionId: hookS1,
  });
  check(
    "hook-dedup: cross-project save status 201",
    hd3.status === 201,
    `got ${hd3.status}; body=${brief(hd3.body)}`,
  );
  const rhd3 = shape("hook-dedup: cross-project body shape", hd3.body, rememberResultSchema);
  check(
    "hook-dedup: same content DIFFERENT project -> NEW row (deduped=false, other id)",
    rhd1 !== undefined && rhd3 !== undefined && rhd3.deduped === false && rhd3.id !== rhd1.id,
    `ids ${rhd1?.id} vs ${rhd3?.id}, deduped=${String(rhd3?.deduped)}`,
  );
  const hHookB = shape(
    "hook-dedup: cross-project health envelope",
    (await call("GET", "/memory/health", { project: hookProjectB })).body,
    healthEnvelopeSchema,
  );
  check(
    "hook-dedup: other project holds its own 1 memory (dedup is project-scoped)",
    hHookB?.counts.memories === 1,
    `got ${hHookB?.counts.memories}`,
  );

  /* G. sessions list. */
  const ses = await call("GET", "/memory/sessions", { project, limit: "50" });
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
  const mem = await call("GET", `/memory/sessions/${encodeURIComponent(sidA)}/memories`, {
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
  const fg = await call("POST", "/memory/forget", undefined, { memoryId: rA.id });
  check("forget A: status 200", fg.status === 200, `got ${fg.status}; body=${brief(fg.body)}`);
  shape("forget A: {forgotten:true}", fg.body, z.object({ forgotten: z.literal(true) }));

  /* J. gone — three independent proofs. */
  const mem2 = await call("GET", `/memory/sessions/${encodeURIComponent(sidA)}/memories`, {
    project,
    limit: "50",
  });
  const memBody2 = shape("gone: session A listing still valid", mem2.body, memoriesEnvelopeSchema);
  check(
    "gone: session A no longer lists A",
    memBody2 !== undefined && !memBody2.memories.some((row) => row.memoryId === rA.id),
  );

  const s3 = await call("POST", "/memory/search", undefined, { query: nonce, project, limit: 10 });
  const bm2 = shape("gone: bm25 envelope after forget", s3.body, bm25EnvelopeSchema);
  check(
    "gone: bm25 returns exactly the 3 remaining memories",
    bm2 !== undefined && bm2.results.length === 3 && !bm2.results.some((row) => row.memoryId === rA.id),
    bm2 === undefined ? "no envelope" : `got ${bm2.results.length} rows`,
  );

  const fg2 = await call("POST", "/memory/forget", undefined, { memoryId: rA.id });
  check("gone: forgetting A again -> 404", fg2.status === 404, `got ${fg2.status}; body=${brief(fg2.body)}`);

  const fg3 = await call("POST", "/memory/forget", undefined, { memoryId: randomUUID() });
  check("gone: forgetting unknown id -> 404", fg3.status === 404, `got ${fg3.status}; body=${brief(fg3.body)}`);

  /* K. healthCount() reflects the forget (4 seeded − 1 forgotten = 3). */
  const h1res = await call("GET", "/memory/health", { project });
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
  const bad1 = await call("POST", "/memory/remember", undefined, {});
  check("boundary: empty remember body -> 400", bad1.status === 400, `got ${bad1.status}`);
  const bad2 = await call("POST", "/memory/search", undefined, [1, 2, 3]);
  check("boundary: array body on search -> 400", bad2.status === 400, `got ${bad2.status}`);
  const bad3 = await call("GET", "/memory/nope");
  check("boundary: unknown route -> 404", bad3.status === 404, `got ${bad3.status}`);
  const bad4 = await call("POST", "/memory/livez");
  check("boundary: wrong method on livez -> 405", bad4.status === 405, `got ${bad4.status}`);
  let bad5Status = -2;
  try {
    const response = await fetch(endpoint("/memory/remember"), {
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

  /* N. P3.1 parity — lesson → search → recap → handoff → governed delete →
   * gone, each round-tripped against the REST contract (REQ-P31-4).
   *
   * Runs on a SECOND fresh, unique project so the count math already asserted
   * in K (3 memories / 4 sessions on `project`) is never disturbed; the
   * run-unique `nonce` is reused, and the separate tenant scope keeps this
   * section isolated from the earlier one. MCP mirrors (memory_recap,
   * memory_handoff, memory_lesson, memory_delete) are NOT asserted here —
   * they are REQ-P31-2 (T-002) evidence in TEST_MATRIX.md; this script stays
   * REST-only and dependency-free. */
  const p31project = `verify-p31-${randomUUID().slice(0, 8)}`;
  const p31sid = `verify-p31-${randomUUID().slice(0, 8)}`;
  const p31content = `P3.1 governed lesson round-trip: strict lesson payloads and audited deletes ${nonce}`;

  /* N1. lesson → 201 with echoed sessionId / project / concepts, uuid id. */
  const les = await call("POST", "/memory/lesson", undefined, {
    content: p31content,
    concepts: ["governance", "p31"],
    project: p31project,
    sessionId: p31sid,
    importance: 0.9,
  });
  check("P3.1 lesson: status 201", les.status === 201, `got ${les.status}; body=${brief(les.body)}`);
  const rL = shape("P3.1 lesson: {id, sessionId, project, concepts}", les.body, rememberResultSchema);
  if (rL !== undefined) {
    check("P3.1 lesson: echoes sessionId", rL.sessionId === p31sid, rL.sessionId);
    check("P3.1 lesson: echoes project", rL.project === p31project, rL.project);
    check(
      "P3.1 lesson: echoes concepts",
      JSON.stringify(rL.concepts) === JSON.stringify(["governance", "p31"]),
      JSON.stringify(rL.concepts),
    );
    check("P3.1 lesson: id is a uuid", UUID_RE.test(rL.id), rL.id);
  }

  /* N2. lesson body is STRICT — `origin` is server-owned and must be
   * rejected outright (400), not silently accepted. */
  const lesOrigin = await call("POST", "/memory/lesson", undefined, {
    content: p31content,
    project: p31project,
    origin: "hook:Stop",
  });
  check(
    "P3.1 lesson: extra origin key -> 400",
    lesOrigin.status === 400,
    `got ${lesOrigin.status}; body=${brief(lesOrigin.body)}`,
  );

  if (rL === undefined) {
    throw new Error("aborting: P3.1 lesson step failed (see FAIL lines above)");
  }

  /* N3. bm25 search for the nonce finds the lesson row with origin "lesson". */
  const ps1 = await call("POST", "/memory/search", undefined, { query: nonce, project: p31project, limit: 10 });
  check("P3.1 search: status 200", ps1.status === 200, `got ${ps1.status}; body=${brief(ps1.body)}`);
  const pbm = shape("P3.1 search: {mode:'bm25', results, signals}", ps1.body, bm25EnvelopeSchema);
  if (pbm !== undefined) {
    const lessonRow = pbm.results.find((row) => row.memoryId === rL.id);
    check("P3.1 search: finds the lesson row", lessonRow !== undefined, `hits=${pbm.results.length}`);
    check("P3.1 search: lesson row origin === 'lesson'", lessonRow?.origin === "lesson", lessonRow?.origin);
  }

  /* N4. recap of the lesson's session echoes the sessionId, count >= 1, and
   * the recap string contains the exact lesson content. */
  const rc1 = await call("POST", "/memory/recap", undefined, { sessionId: p31sid, project: p31project });
  check("P3.1 recap: status 200", rc1.status === 200, `got ${rc1.status}; body=${brief(rc1.body)}`);
  const rcp1 = shape("P3.1 recap: {recap, sessionId, count, signals}", rc1.body, recapEnvelopeSchema);
  if (rcp1 !== undefined) {
    check("P3.1 recap: echoes sessionId", rcp1.sessionId === p31sid, String(rcp1.sessionId));
    check("P3.1 recap: count >= 1", rcp1.count >= 1, String(rcp1.count));
    check("P3.1 recap: contains the lesson content", rcp1.recap.includes(p31content));
    /* CE-003: the sessionId echo is `body.sessionId ?? null` — a request echo,
     * not store evidence. Assert session MEMBERSHIP instead: every bullet line
     * must match `^- [<requested sessionId>] `, so a store that returned other
     * sessions' bullets (while still echoing the request) cannot pass. */
    const bullets = rcp1.recap.split("\n").filter((line) => line.length > 0);
    const foreign = bullets.filter((line) => !line.startsWith(`- [${p31sid}] `));
    check(
      "P3.1 recap: every bullet line belongs to the requested session",
      bullets.length > 0 && foreign.length === 0,
      bullets.length === 0 ? "(no bullet lines)" : foreign.join(" | ").slice(0, 200),
    );
  }

  /* N5. project-wide handoff: typed counts, frozen first line, and the
   * lesson content (or its session line) present in the digest. */
  const hd1 = await call("POST", "/memory/handoff", undefined, { project: p31project });
  check("P3.1 handoff: status 200", hd1.status === 200, `got ${hd1.status}; body=${brief(hd1.body)}`);
  const hnd1 = shape("P3.1 handoff: {handoff, sessionId, counts, signals}", hd1.body, handoffEnvelopeSchema);
  if (hnd1 !== undefined) {
    check(
      "P3.1 handoff: first line project=<project> memories=<N> sessions=<M> recent:",
      hnd1.handoff.startsWith(`project=${p31project} memories=`),
      hnd1.handoff.slice(0, 80),
    );
    check("P3.1 handoff: counts.memories >= 1", hnd1.counts.memories >= 1, String(hnd1.counts.memories));
    check(
      "P3.1 handoff: contains lesson content or its sessionId line",
      hnd1.handoff.includes(p31content) || hnd1.handoff.includes(p31sid),
    );
  }

  /* N6. health baseline before the delete — exactly 1 memory / 1 session,
   * which also proves the rejected origin-key lesson (N2) stored nothing. */
  const hBres = await call("GET", "/memory/health", { project: p31project });
  const hB = shape("P3.1 health before delete: envelope", hBres.body, healthEnvelopeSchema);
  check("P3.1 health: 1 memory before delete", hB?.counts.memories === 1, `got ${hB?.counts.memories}`);
  check("P3.1 health: 1 session before delete", hB?.counts.sessions === 1, `got ${hB?.counts.sessions}`);

  /* N7. governed delete with the required reason → auditable receipt. */
  const del1 = await call("POST", "/memory/delete", undefined, {
    memoryId: rL.id,
    reason: "p3.1 round-trip test",
  });
  check("P3.1 delete: status 200", del1.status === 200, `got ${del1.status}; body=${brief(del1.body)}`);
  const delBody = shape(
    "P3.1 delete: {deleted:true, receipt:{memoryId, deletedAt}}",
    del1.body,
    deleteResultSchema,
  );
  if (delBody !== undefined) {
    check("P3.1 delete: receipt.memoryId matches", delBody.receipt.memoryId === rL.id, delBody.receipt.memoryId);
    check(
      "P3.1 delete: receipt.deletedAt is a non-empty string",
      delBody.receipt.deletedAt.length > 0,
      delBody.receipt.deletedAt,
    );
  }

  /* N8. gone — five independent proofs the row is really gone. */
  const ps2 = await call("POST", "/memory/search", undefined, { query: nonce, project: p31project, limit: 10 });
  const pbm2 = shape("P3.1 gone: bm25 envelope after delete", ps2.body, bm25EnvelopeSchema);
  check(
    "P3.1 gone: bm25 no longer returns the lesson row",
    pbm2 !== undefined && !pbm2.results.some((row) => row.memoryId === rL.id),
    pbm2 === undefined ? "no envelope" : `got ${pbm2.results.length} rows`,
  );

  const hAres = await call("GET", "/memory/health", { project: p31project });
  const hA = shape("P3.1 health after delete: envelope", hAres.body, healthEnvelopeSchema);
  check(
    "P3.1 health: memories dropped to 0 after delete",
    hA?.counts.memories === 0,
    `got ${hA?.counts.memories}`,
  );

  const del2 = await call("POST", "/memory/delete", undefined, { memoryId: rL.id, reason: "repeat delete" });
  check(
    "P3.1 delete: second delete of same id -> 404",
    del2.status === 404,
    `got ${del2.status}; body=${brief(del2.body)}`,
  );
  shape("P3.1 delete: 404 body is {error:'not_found'}", del2.body, notFoundSchema);

  const del3 = await call("POST", "/memory/delete", undefined, { memoryId: rL.id });
  check("P3.1 delete: missing reason -> 400", del3.status === 400, `got ${del3.status}; body=${brief(del3.body)}`);

  const del4 = await call("POST", "/memory/delete", undefined, {
    memoryId: randomUUID(),
    reason: "unknown id probe",
  });
  check("P3.1 delete: unknown memoryId -> 404", del4.status === 404, `got ${del4.status}; body=${brief(del4.body)}`);
  shape("P3.1 delete: unknown-id 404 body is {error:'not_found'}", del4.body, notFoundSchema);

  const rc2 = await call("POST", "/memory/recap", undefined, { sessionId: p31sid, project: p31project });
  check("P3.1 recap after delete: status 200", rc2.status === 200, `got ${rc2.status}; body=${brief(rc2.body)}`);
  const rcp2 = shape("P3.1 recap after delete: envelope", rc2.body, recapEnvelopeSchema);
  check(
    "P3.1 recap after delete: count 0 and lesson content gone",
    rcp2 !== undefined && rcp2.count === 0 && !rcp2.recap.includes(p31content),
    rcp2 === undefined ? "no envelope" : `count=${rcp2.count}`,
  );

  /* O. REQ-P1-4 derived confidence E2E — write-time derivation, caller-wins,
   * and the recall-ledger/tie-break wiring of src/search.ts.
   *
   * Isolated project so the §5 count math asserted in K stays untouched.
   * The recall LEDGER lives in the SERVER process — REST only exposes the
   * stored importance, and an exact RRF-tie over REST would need float-equal
   * scores out of two live indexes (brittle). So: stored-importance
   * assertions go through REST (real server), while the LEDGER WIRING and
   * the recall-lift ORDERING run the REAL bm25Search/hybridSearch
   * in-process against a stub store (the exact functions the server calls).
   * Unit math goldens live in verify-lifecycle section F. The exact-RRF-tie
   * REST construction is documented as skipped in the lane report. */
  const confProject = `verify-conf-${randomUUID().slice(0, 8)}`;
  const confContent = (tag: string): string => `confidence ${tag} probe ${nonce} derived importance routing`;

  // O1. lesson WITHOUT importance -> derived (lesson base 0.75 + bonus).
  const oLes = await call("POST", "/memory/lesson", undefined, {
    content: confContent("lesson"),
    project: confProject,
  });
  check("confidence: lesson without importance -> 201", oLes.status === 201, `got ${oLes.status}; body=${brief(oLes.body)}`);
  const rOLes = shape("confidence: lesson body", oLes.body, rememberResultSchema);

  // O2. remember WITHOUT importance (origin rest default) -> derived.
  const oRest = await call("POST", "/memory/remember", undefined, {
    content: confContent("rest"),
    project: confProject,
  });
  check("confidence: rest without importance -> 201", oRest.status === 201, `got ${oRest.status}; body=${brief(oRest.body)}`);
  const rORest = shape("confidence: rest body", oRest.body, rememberResultSchema);

  // O3. remember with hook origin WITHOUT importance -> hook base 0.55 + bonus.
  const oHook = await call("POST", "/memory/remember", undefined, {
    content: confContent("hook"),
    origin: "hook:Stop",
    project: confProject,
  });
  check("confidence: hook:Stop without importance -> 201", oHook.status === 201, `got ${oHook.status}; body=${brief(oHook.body)}`);
  const rOHook = shape("confidence: hook body", oHook.body, rememberResultSchema);

  // O4. explicit importance -> caller WINS, stored verbatim.
  const oExp = await call("POST", "/memory/remember", undefined, {
    content: confContent("explicit"),
    project: confProject,
    importance: 0.42,
  });
  check("confidence: explicit importance -> 201", oExp.status === 201, `got ${oExp.status}; body=${brief(oExp.body)}`);
  const rOExp = shape("confidence: explicit body", oExp.body, rememberResultSchema);

  if (rOLes === undefined || rORest === undefined || rOHook === undefined || rOExp === undefined) {
    throw new Error("aborting: a confidence write step failed (see FAIL lines above)");
  }

  // ONE bm25 search over the isolated project (all four rows share the nonce).
  const oSearch = await call("POST", "/memory/search", undefined, {
    query: nonce,
    project: confProject,
    limit: 10,
  });
  check("confidence: bm25 status 200", oSearch.status === 200, `got ${oSearch.status}; body=${brief(oSearch.body)}`);
  const obm = shape("confidence: bm25 envelope", oSearch.body, bm25EnvelopeSchema);
  if (obm !== undefined) {
    const lessonRow = obm.results.find((row) => row.memoryId === rOLes.id);
    const expectedLesson = deriveWriteImportance("lesson", rOLes.concepts.length);
    check(
      "confidence: lesson row stores DERIVED importance (== derive(lesson, echoed len), >= 0.75)",
      lessonRow !== undefined && lessonRow.importance === expectedLesson && lessonRow.importance >= 0.75,
      `row=${String(lessonRow?.importance)} expected=${expectedLesson}`,
    );
    const restRow = obm.results.find((row) => row.memoryId === rORest.id);
    const expectedRest = deriveWriteImportance("rest", rORest.concepts.length);
    check(
      "confidence: rest row stores DERIVED importance (== derive(rest, echoed len), != 0.5)",
      restRow !== undefined && restRow.importance === expectedRest && expectedRest !== 0.5,
      `row=${String(restRow?.importance)} expected=${expectedRest}`,
    );
    const hookRow = obm.results.find((row) => row.memoryId === rOHook.id);
    const expectedHook = deriveWriteImportance("hook:Stop", rOHook.concepts.length);
    check(
      "confidence: hook row stores DERIVED importance (== derive(hook:Stop, echoed len), >= 0.55)",
      hookRow !== undefined && hookRow.importance === expectedHook && hookRow.importance >= 0.55,
      `row=${String(hookRow?.importance)} expected=${expectedHook}`,
    );
    const expRow = obm.results.find((row) => row.memoryId === rOExp.id);
    check(
      "confidence: explicit importance WINS (caller 0.42 stored verbatim)",
      expRow !== undefined && expRow.importance === 0.42,
      `row=${String(expRow?.importance)}`,
    );
  }

  /* O5. Recall-ledger WIRING — the real bm25Search against a stub store:
   * returned (kept) rows increment the ledger, never-returned rows do not. */
  resetRecalls();
  const confX: SearchHit = {
    id: "10",
    memoryId: "conf-x",
    content: "confidence tie row x",
    sessionId: "conf-sid-x",
    origin: "rest",
    importance: 0.6,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(), // X strictly OLDER than Y
    score: 0,
  };
  const confY: SearchHit = {
    id: "11",
    memoryId: "conf-y",
    content: "confidence tie row y",
    sessionId: "conf-sid-y",
    origin: "rest",
    importance: 0.6,
    createdAt: new Date().toISOString(), // Y newer — baseline tie falls here
    score: 0,
  };
  const stubStore = (textRows: SearchHit[], vectorRows: SearchHit[] = []): MemoryStore => ({
    remember: () => Promise.reject(new Error("stub: remember not exercised")),
    searchByText: () => Promise.resolve(textRows),
    searchByVector: () => Promise.resolve(vectorRows),
    graphSearch: () => Promise.reject(new Error("stub: graphSearch not exercised")),
    listSessions: () => Promise.reject(new Error("stub: listSessions not exercised")),
    sessionMemories: () => Promise.reject(new Error("stub: sessionMemories not exercised")),
    forget: () => Promise.reject(new Error("stub: forget not exercised")),
    healthCounts: () => Promise.reject(new Error("stub: healthCounts not exercised")),
  });
  const stubBm25 = (q: string): { query: string; project: string; limit: number } => ({
    query: q,
    project: confProject,
    limit: 10,
  });
  const stubHybrid = { query: "confidence tie", concepts: [] as string[], project: confProject, limit: 10 };
  for (let i = 0; i < 3; i++) {
    await bm25Search(stubStore([confX]), stubBm25(`recall pass ${i}`));
  }
  check(
    "recall wiring: 3 searches RETURNING x -> recallCount(x) === 3",
    recallCount("conf-x") === 3,
    String(recallCount("conf-x")),
  );
  check(
    "recall wiring: never-returned row stays at 0",
    recallCount("conf-y") === 0,
    String(recallCount("conf-y")),
  );
  check(
    "recall lift: confidenceBoost(stored, N) > confidenceBoost(stored, 0)",
    confidenceBoost(0.6, recallCount("conf-x")) > confidenceBoost(0.6, 0),
    `${confidenceBoost(0.6, recallCount("conf-x"))} vs ${confidenceBoost(0.6, 0)}`,
  );

  /* O6. Recall-lift ORDERING through the real fused tie-break: X (text
   * source, rank 1) and Y (vector source, rank 1) score EXACTLY 1/61 each
   * -> an exact RRF tie; equal stored importance (0.6) with decay OFF ->
   * baseline order falls through to createdAt (newer Y first). After X is
   * recalled more than Y, the REQ-P1-4 boost flips the tie to X — without
   * changing either row's stored importance. */
  resetRecalls();
  const hyBefore = await hybridSearch(stubStore([confX], [confY]), stubHybrid);
  check(
    "recall tie: constructed exact RRF tie (both scores 1/61)",
    hyBefore.results.length === 2 &&
      hyBefore.results[0] !== undefined &&
      hyBefore.results[1] !== undefined &&
      hyBefore.results[0].score === hyBefore.results[1].score,
    JSON.stringify(hyBefore.results.map((row) => ({ id: row.memoryId, score: row.score }))),
  );
  check(
    "recall tie: baseline (differentially unrecalled) -> NEWER y ranks first via createdAt",
    hyBefore.results[0]?.memoryId === "conf-y",
    hyBefore.results.map((row) => row.memoryId).join(","),
  );
  await bm25Search(stubStore([confX]), stubBm25("one more recall for x"));
  const hyAfter = await hybridSearch(stubStore([confX], [confY]), stubHybrid);
  check(
    "recall tie: after recalling x more than y, BOOSTED x outranks newer y",
    hyAfter.results[0]?.memoryId === "conf-x",
    hyAfter.results.map((row) => row.memoryId).join(","),
  );
  check(
    "recall tie: ledger asymmetry observed (x > y)",
    recallCount("conf-x") > recallCount("conf-y"),
    JSON.stringify({ x: recallCount("conf-x"), y: recallCount("conf-y") }),
  );
  check(
    "recall tie: stored importances never rewritten by recall (both still 0.6)",
    hyAfter.results.every((row) => row.importance === 0.6),
    JSON.stringify(hyAfter.results.map((row) => ({ id: row.memoryId, importance: row.importance }))),
  );
  resetRecalls();

  // O7. Best-effort cleanup of this section's rows (isolated project).
  for (const row of [rOLes, rORest, rOHook, rOExp]) {
    await call("POST", "/memory/forget", undefined, { memoryId: row.id });
  }

  /* P. REQ-P1-2 consolidation tier-1 E2E — three near-duplicate variants
   * collapse into ONE survivor row (probe4 verdict A: setProperty refreshes
   * text + vector indexes live). Isolated project; a DISTINCT sessionId per
   * variant proves "no Session node / no BELONGS_TO on consolidation".
   *
   * Samples (golden construction, verify-lifecycle G pins the math):
   *   v1 = 10-token base; v2 = v1 + " today" (j = 10/11 >= 0.9);
   *   v3 = comma variant of v1 — same token SET (near-dup, j vs the
   *   concatenated survivor = 10/11) but punctuation survives
   *   normalization, so v3 is neither an exact dedup hit NOR a substring
   *   of the survivor -> it exercises the CONCATENATION write itself. */
  const pProject = `verify-consol-${randomUUID().slice(0, 8)}`;
  const pv1 = "deploy staging checklist runs database migration then restarts api workers";
  const pv2 = `${pv1} today`;
  const pv3 = "deploy staging checklist runs database migration, then restarts api workers";
  const pSid1 = `verify-consol-s1-${randomUUID().slice(0, 8)}`;
  const pSid2 = `verify-consol-s2-${randomUUID().slice(0, 8)}`;
  const pSid3 = `verify-consol-s3-${randomUUID().slice(0, 8)}`;
  const pExpectedContent = `${pv1}\n${pv2}\n${pv3}`;

  const pHealth0 = shape(
    "consolidation: fresh project health envelope",
    (await call("GET", "/memory/health", { project: pProject })).body,
    healthEnvelopeSchema,
  );
  check(
    "consolidation: fresh project starts at 0 memories / 0 sessions",
    pHealth0?.counts.memories === 0 && pHealth0?.counts.sessions === 0,
    JSON.stringify(pHealth0?.counts),
  );

  // P1. v1 -> plain insert (nothing near it yet).
  const pc1 = await call("POST", "/memory/remember", undefined, {
    content: pv1,
    project: pProject,
    sessionId: pSid1,
  });
  check("consolidation: v1 status 201", pc1.status === 201, `got ${pc1.status}; body=${brief(pc1.body)}`);
  const rp1 = shape("consolidation: v1 body", pc1.body, rememberResultSchema);
  check(
    "consolidation: v1 is a plain insert (deduped=false, consolidated=false)",
    rp1 !== undefined && rp1.deduped === false && rp1.consolidated === false,
    `deduped=${String(rp1?.deduped)} consolidated=${String(rp1?.consolidated)}`,
  );

  // P2. v2 (near-dup, j = 10/11) -> merged into v1's row.
  const pc2 = await call("POST", "/memory/remember", undefined, {
    content: pv2,
    project: pProject,
    sessionId: pSid2,
  });
  check("consolidation: v2 status 201", pc2.status === 201, `got ${pc2.status}; body=${brief(pc2.body)}`);
  const rp2 = shape("consolidation: v2 body", pc2.body, rememberResultSchema);
  check(
    "consolidation: v2 -> consolidated=true, deduped=false, SAME id as v1",
    rp1 !== undefined &&
      rp2 !== undefined &&
      rp2.consolidated === true &&
      rp2.deduped === false &&
      rp2.id === rp1.id,
    `ids ${rp1?.id} vs ${rp2?.id}, consolidated=${String(rp2?.consolidated)}`,
  );
  check(
    "consolidation: v2 response echoes REQUEST sessionId (first-wins family)",
    rp2?.sessionId === pSid2,
    rp2?.sessionId,
  );

  // P3. v3 (comma variant: near-dup of the survivor, NOT a substring) ->
  // a second CONCATENATION write on the same survivor.
  const pc3 = await call("POST", "/memory/remember", undefined, {
    content: pv3,
    project: pProject,
    sessionId: pSid3,
  });
  check("consolidation: v3 status 201", pc3.status === 201, `got ${pc3.status}; body=${brief(pc3.body)}`);
  const rp3 = shape("consolidation: v3 body", pc3.body, rememberResultSchema);
  check(
    "consolidation: v3 -> consolidated=true, SAME survivor id",
    rp1 !== undefined && rp3 !== undefined && rp3.consolidated === true && rp3.id === rp1.id,
    `ids ${rp1?.id} vs ${rp3?.id}, consolidated=${String(rp3?.consolidated)}`,
  );

  if (rp1 === undefined || rp2 === undefined || rp3 === undefined) {
    throw new Error("aborting: a consolidation write step failed (see FAIL lines above)");
  }

  // P4. THREE saves -> exactly ONE row (+1 from baseline), ONE session
  // (consolidation materializes NO Session node for pSid2/pSid3).
  const pHealth1 = shape(
    "consolidation: health envelope after 3 saves",
    (await call("GET", "/memory/health", { project: pProject })).body,
    healthEnvelopeSchema,
  );
  check(
    "consolidation: 3 saves -> healthCount memories = 1 (net +1)",
    pHealth1?.counts.memories === 1,
    `got ${pHealth1?.counts.memories}`,
  );
  check(
    "consolidation: sessions stay 1 (no Session node on merge)",
    pHealth1?.counts.sessions === 1,
    `got ${pHealth1?.counts.sessions}`,
  );

  const pSessions = shape(
    "consolidation: sessions envelope",
    (await call("GET", "/memory/sessions", { project: pProject, limit: "50" })).body,
    sessionsEnvelopeSchema,
  );
  const pSessionIds = new Set(pSessions?.sessions.map((row) => row.sessionId) ?? []);
  check(
    "consolidation: listSessions has pSid1 ONLY (pSid2/pSid3 never materialized)",
    pSessionIds.size === 1 && pSessionIds.has(pSid1) && !pSessionIds.has(pSid2) && !pSessionIds.has(pSid3),
    JSON.stringify([...pSessionIds]),
  );

  // P5. Survivor content is the full concatenation, and it stays listed
  // under the ORIGINAL session (echoed session != membership on merge).
  const pMem1 = shape(
    "consolidation: sessionMemories(pSid1) envelope",
    (
      await call("GET", `/memory/sessions/${encodeURIComponent(pSid1)}/memories`, {
        project: pProject,
        limit: "50",
      })
    ).body,
    memoriesEnvelopeSchema,
  );
  const pSurvivorRow = pMem1?.memories.find((row) => row.memoryId === rp1.id);
  check(
    "consolidation: survivor content === v1\\nv2\\nv3 (concatenation, no text dropped)",
    pSurvivorRow !== undefined && pSurvivorRow.content === pExpectedContent,
    `contentLen=${pSurvivorRow?.content.length} want=${pExpectedContent.length}`,
  );
  const pMem2 = shape(
    "consolidation: sessionMemories(pSid2) envelope",
    (
      await call("GET", `/memory/sessions/${encodeURIComponent(pSid2)}/memories`, {
        project: pProject,
        limit: "50",
      })
    ).body,
    memoriesEnvelopeSchema,
  );
  check(
    "consolidation: sessionMemories(pSid2) EMPTY (echoed session ≠ membership, no BELONGS_TO on merge)",
    pMem2 !== undefined && pMem2.memories.length === 0,
    `got ${pMem2?.memories.length}`,
  );

  // P6. ALL six searches (3 variant texts x bm25 + hybrid) recall the
  // survivor — the merged row is served by every variant's own words
  // through BOTH indexes (text refreshed) and RRF fusion.
  for (const [index, variant] of [pv1, pv2, pv3].entries()) {
    const label = `P${index + 1}`;
    const ps = await call("POST", "/memory/search", undefined, { query: variant, project: pProject, limit: 10 });
    const pbm = shape(`consolidation: bm25(${label}) envelope`, ps.body, bm25EnvelopeSchema);
    check(
      `consolidation: bm25 search with ${label} text hits the survivor`,
      pbm !== undefined && pbm.results.some((row) => row.memoryId === rp1.id),
      pbm === undefined ? "no envelope" : `hits=${pbm.results.length}`,
    );
    const ph = await call("POST", "/memory/smart-search", undefined, {
      query: variant,
      project: pProject,
      limit: 10,
    });
    const phy = shape(`consolidation: hybrid(${label}) envelope`, ph.body, hybridEnvelopeSchema);
    check(
      `consolidation: smart-search with ${label} text hits the survivor`,
      phy !== undefined && phy.results.some((row) => row.memoryId === rp1.id),
      phy === undefined ? "no envelope" : `hits=${phy.results.length}`,
    );
  }

  // P7. Re-saving the EXACT concatenated text -> exact dedup wins (the
  // survivor's rewritten dedupKey = hash of the merged content): same id,
  // deduped=true, consolidated=false, still exactly 1 row.
  const pc4 = await call("POST", "/memory/remember", undefined, {
    content: pExpectedContent,
    project: pProject,
    sessionId: pSid1,
  });
  const rp4 = shape("consolidation: re-save body", pc4.body, rememberResultSchema);
  check(
    "consolidation: re-save of the merged text -> deduped=true, consolidated=false, SAME id",
    pc4.status === 201 &&
      rp4 !== undefined &&
      rp4.deduped === true &&
      rp4.consolidated === false &&
      rp4.id === rp1.id,
    `status=${pc4.status} deduped=${String(rp4?.deduped)} consolidated=${String(rp4?.consolidated)}`,
  );
  const pHealth2 = shape(
    "consolidation: health envelope after re-save",
    (await call("GET", "/memory/health", { project: pProject })).body,
    healthEnvelopeSchema,
  );
  check(
    "consolidation: re-save adds no row (still exactly 1)",
    pHealth2?.counts.memories === 1,
    `got ${pHealth2?.counts.memories}`,
  );

  // P8. Best-effort cleanup: forget the survivor.
  const pfg = await call("POST", "/memory/forget", undefined, { memoryId: rp1.id });
  check("consolidation: cleanup forget survivor -> 200", pfg.status === 200, `got ${pfg.status}`);

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
