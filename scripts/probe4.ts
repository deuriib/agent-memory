/**
 * Probe 4 (REQ-P1-2 decision gate): run BEFORE wiring updateMemoryContent
 * into HelixStore.remember, against the LIVE dev instance
 * (http://localhost:6969 — dev data is disposable; the instance is never
 * restarted).
 *
 * Question: does the exact WriteBatch planned as contract-§2
 * updateMemoryContent (anchor by memoryId -> setProperty content/embedding/
 * dedupKey -> concept re-link via conceptBody) REFRESH the text + vector
 * indexes on this instance, unthrone the old content, and re-link the
 * incoming concept?
 *
 * Gate — verdict A/B rests on assertions 1-3:
 *   1. text index refresh   — a query with the NEW content's distinctive
 *      tokens still matches the survivor with a positive BM25 score AND the
 *      live row now carries the new content.
 *   2. vector index refresh — a query with embed(NEW) reads the survivor at
 *      distance ~0 (stored embedding replaced). A stale embedding would sit
 *      at the in-process-computed stale distance, asserted > 0.05 up front
 *      so the threshold below can never be satisfied by an unchanged row.
 *   3. old content unthroned — a query with the OLD content's distinctive
 *      tokens no longer scores the survivor positive (fresh index -> no
 *      match / absent; stale index -> old tokens still match).
 *
 * Every check targets the survivor BY memoryId (rank is not asserted): a
 * crashed earlier run can leave rows behind in the shared probe project and
 * rank would confound the evidence — id-targeted score/distance evidence is
 * strictly stronger and rerun-safe.
 *
 * Independent sub-checks (reported, NOT part of the A/B gate):
 *   - concept re-link via graphSearch: its own PASS/FAIL line with the
 *     AUTHORIZED FALLBACK recorded — if it fails while 1-3 pass, verdict A
 *     stands and the fallback is "drop the concept re-link, keep the
 *     setProperty path".
 *   - dedupKey round-trip via findMemoryByDedupKey: informational here
 *     (E2E-covered by verify.ts section P's re-save assertion).
 *
 * If the FULL batch errors, it is retried CONTENT-ONLY (same setProperty
 * path, no conceptBody forEach) — isolating the concept re-link as the
 * failing piece instead of the index refresh itself.
 *
 * The update response's keys and array lengths are printed (never content
 * or embedding VALUES) to calibrate HelixStore's presence assert.
 *
 * Run: npx tsx scripts/probe4.ts
 * Decision: VERDICT A -> wire src/store.ts; VERDICT B -> STOP the store
 * integration (keep the pure module + section G + this probe), brief back —
 * do not invent a strategy B.
 * Cleanup: the probe memory is forgotten in `finally`. Exit 0 = A, 1 = B.
 */
import {
  BatchCondition,
  Client,
  NodeRef,
  Predicate,
  PropertyInput,
  defineParams,
  g,
  param,
  writeBatch,
  type QueryRequest,
} from "@helix-db/helix-db";
import type { HelixError } from "@helix-db/helix-db";
import {
  findMemoryByDedupKey,
  findMemoryByDedupKeyParams,
  forgetMemory,
  forgetMemoryParams,
  graphSearch,
  graphSearchParams,
  saveMemory,
  saveMemoryParams,
  searchByText,
  searchByTextParams,
  searchByVector,
  searchByVectorParams,
  updateMemoryContent,
  updateMemoryContentParams,
} from "../db/queries.js";
import { embed } from "../src/embed.js";
import { contentHash, normalizeContent } from "../src/lifecycle.js";

const url = process.env.HELIX_URL ?? "http://localhost:6969";
const client = Client.server(url);

/** Shared probe project (checkpoint: isolated from every verify project). */
const PROJECT = "probe-p1-consol";

/** Per-run nonce keeps rerun leftovers from matching THIS run's queries. */
const NONCE = Date.now().toString(36);
const MEMORY_ID = `probe4-${NONCE}`;
const SESSION_ID = `probe4-session-${NONCE}`;
/** Unique per run -> a leftover row can never satisfy the graph sub-check. */
const CONCEPT = `probe4concept${NONCE}`;

/**
 * Old/new contents: disjoint vocabularies PLUS one shared per-run nonce
 * token (isolation). The shared token keeps the stale-embedding distance
 * well above the gate threshold (one of ~9 tokens in common) — the
 * precondition below proves it numerically before anything is asserted.
 * Old/new DISTINCTIVE queries carry NO nonce: assertion 3 must not match
 * the survivor through the shared token after the update.
 */
const C1 = `zebra quantum flotilla oldanchor pelican migrations cross atlantic coastline run${NONCE}`;
const C2 = `cobalt volcano harvest newlantern geyser eruptions reshape basalt canyon run${NONCE}`;
/** C1-distinctive tokens (absent from C2). */
const OLDQ = "zebra quantum flotilla oldanchor pelican";
/** C2-distinctive tokens (absent from C1). */
const NEWQ = "cobalt volcano newlantern geyser basalt";

const E1 = embed(C1);
const E2 = embed(C2);

/**
 * Distance the vector index WOULD report if the embedding update were a
 * no-op: 1 - cos(embed(C1), embed(C2)). Both are L2-normalized, so the dot
 * product IS the cosine.
 */
const STALE_DISTANCE = 1 - E1.reduce((sum, value, index) => sum + value * (E2[index] ?? 0), 0);

/** Identical stored/query vectors must read ~0 through f32 storage. */
const FRESH_DISTANCE_MAX = 1e-4;

/* ------------------------------------------------------------------ */
/* Assertion plumbing (verify.ts shape)                                */
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

function describeError(err: unknown): string {
  if (err !== null && typeof err === "object" && "kind" in err) {
    const helix = err as HelixError;
    const details = "details" in helix && helix.details !== undefined ? ` — ${helix.details}` : "";
    return `HelixError kind=${String(helix.kind)} message=${String(helix.message)}${details}`;
  }
  if (err instanceof Error) return `${err.constructor.name}: ${err.message}`;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Response reading (cast-free, probe-local mirror of src/store.ts)    */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(response: unknown): unknown[] | undefined {
  if (!isRecord(response)) return undefined;
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function toRecords(rows: unknown[] | undefined): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of rows ?? []) {
    if (isRecord(row)) out.push(row);
  }
  return out;
}

function readString(row: Record<string, unknown>, key: string, fallback: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return fallback;
}

function readNumber(row: Record<string, unknown>, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") return Number(value);
  }
  return fallback;
}

function findRow(response: unknown, memoryId: string): Record<string, unknown> | undefined {
  return toRecords(rowsOf(response)).find((row) => readString(row, "memoryId", "") === memoryId);
}

/**
 * Keys + array lengths of a response — NOTHING content- or embedding-shaped
 * ever reaches stdout (probe3 logging discipline). Used to calibrate
 * HelixStore's presence assert on updateMemoryContent.
 */
function summarizeResponse(response: unknown): string {
  if (!isRecord(response)) return `non-object (${typeof response})`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(response)) {
    if (Array.isArray(value)) parts.push(`${key}:array(${value.length})`);
    else if (value === null) parts.push(`${key}:null`);
    else if (isRecord(value)) parts.push(`${key}:object(${Object.keys(value).length})`);
    else parts.push(`${key}:${typeof value}`);
  }
  return parts.length > 0 ? parts.join(", ") : "(no keys)";
}

function indicatesPresence(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "bigint") return value > 0n;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      if (indicatesPresence(entry, depth + 1)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const textQuery = (q: string): QueryRequest =>
  searchByText().toQueryRequest(searchByTextParams, { q, project: PROJECT, k: 10 });

const vectorQuery = (queryVector: number[]): QueryRequest =>
  searchByVector().toQueryRequest(searchByVectorParams, { queryVector, project: PROJECT, k: 10 });

/**
 * Content-only variant of updateMemoryContent (no conceptBody forEach):
 * run ONLY when the full batch errors, to isolate the concept re-link as
 * the failing piece instead of the setProperty path itself.
 */
const contentOnlyParams = defineParams({
  memoryId: param.string(),
  content: param.string(),
  embedding: param.array(param.f32()),
  dedupKey: param.string(),
});

function updateContentOnly(): ReturnType<typeof writeBatch> {
  return writeBatch()
    .varAs(
      "memory",
      g().nWithLabel("Memory").where(Predicate.eqParam("memoryId", "memoryId")),
    )
    .varAsIf(
      "updated",
      BatchCondition.varNotEmpty("memory"),
      g()
        .n(NodeRef.var("memory"))
        .setProperty("content", PropertyInput.param("content"))
        .setProperty("embedding", PropertyInput.param("embedding"))
        .setProperty("dedupKey", PropertyInput.param("dedupKey")),
    )
    .returning(["updated", "memory"]);
}

/* ------------------------------------------------------------------ */
/* Probe                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  let updateRanFull = true;
  let setupOk = true;
  /** Verdict A/B rests ONLY on gates 1-3 (+ a valid setup). Sub-check
   *  failures (concept re-link, dedupKey round-trip) are reported with
   *  their own verdicts and never flip the gate — the concept sub-check
   *  has an AUTHORIZED FALLBACK (drop re-link, keep setProperty). */
  let gateText = false;
  let gateVector = false;
  let gateUnthrone = false;

  try {
    /* ---- Precondition: stale distance must beat the gate threshold --- */
    check(
      `probe precondition: stale embedding distance ${STALE_DISTANCE.toFixed(4)} > 0.05 (old/new vectors separable)`,
      STALE_DISTANCE > 0.05,
      String(STALE_DISTANCE),
    );
    if (!(STALE_DISTANCE > 0.05)) setupOk = false;

    /* ---- (1) Save X with C1 — the EXACT production saveMemory batch -- */
    const dedupKey1 = contentHash(PROJECT, normalizeContent(C1));
    const saveRes = await client
      .query<unknown>(
        saveMemory().toQueryRequest(saveMemoryParams, {
          memoryId: MEMORY_ID,
          content: C1,
          project: PROJECT,
          sessionId: SESSION_ID,
          embedding: E1,
          origin: "probe",
          importance: 0.5,
          createdAt: new Date().toISOString(),
          concepts: [], // empty baseline -> the graph sub-check proves the NEW link alone
          dedupKey: dedupKey1,
        }),
      )
      .send();
    console.log(`setup: saveMemory X (${MEMORY_ID}): ${summarizeResponse(saveRes)}`);

    /* ---- (a) baseline text: OLDQ matches X, live content is C1 ------- */
    const baseText = await client.query<unknown>(textQuery(OLDQ)).send();
    const baseRow = findRow(baseText, MEMORY_ID);
    check(
      "setup: baseline text(OLD) matches X with positive score",
      baseRow !== undefined && readNumber(baseRow, ["score", "$score"], 0) > 0,
      `present=${baseRow !== undefined} score=${baseRow === undefined ? "-" : readNumber(baseRow, ["score", "$score"], 0)}`,
    );
    check(
      "setup: baseline row carries C1",
      baseRow !== undefined && readString(baseRow, "content", "") === C1,
      `contentLen=${baseRow === undefined ? "-" : readString(baseRow, "content", "").length} want=${C1.length}`,
    );
    if (baseRow === undefined) setupOk = false;

    /* ---- (b) baseline vector: embed(C1) reads X at distance ~0 ------- */
    const baseVec = await client.query<unknown>(vectorQuery(E1)).send();
    const baseVecRow = findRow(baseVec, MEMORY_ID);
    const baseDistance = baseVecRow === undefined ? Number.NaN : readNumber(baseVecRow, ["distance", "$distance"], Number.NaN);
    check(
      `setup: baseline vector(embed(OLD)) reads X at distance <= ${FRESH_DISTANCE_MAX}`,
      baseVecRow !== undefined && Number.isFinite(baseDistance) && baseDistance <= FRESH_DISTANCE_MAX,
      `present=${baseVecRow !== undefined} distance=${baseDistance}`,
    );
    if (baseVecRow === undefined) setupOk = false;

    if (!setupOk) {
      console.log("SETUP FAILED — the gate cannot be evaluated (see FAIL lines above)");
    } else {
      /* ---- (c) updateMemoryContent X -> C2 (full batch, retry content-only) */
      const dedupKey2 = contentHash(PROJECT, normalizeContent(C2));
      const fullValues = {
        memoryId: MEMORY_ID,
        content: C2,
        embedding: E2,
        dedupKey: dedupKey2,
        concepts: [{ name: CONCEPT }],
        project: PROJECT,
      };
      let updateRes: unknown;
      try {
        updateRes = await client
          .query<unknown>(updateMemoryContent().toQueryRequest(updateMemoryContentParams, fullValues))
          .send();
        console.log(`update(full): ${summarizeResponse(updateRes)}`);
      } catch (err) {
        updateRanFull = false;
        console.log(`update(full): ERROR — ${describeError(err)}`);
        updateRes = await client
          .query<unknown>(
            updateContentOnly().toQueryRequest(contentOnlyParams, {
              memoryId: MEMORY_ID,
              content: C2,
              embedding: E2,
              dedupKey: dedupKey2,
            }),
          )
          .send();
        console.log(`update(content-only retry): ${summarizeResponse(updateRes)}`);
      }

      /* Presence calibration: what HelixStore's fail-closed assert can rely on. */
      if (isRecord(updateRes)) {
        check(
          "update: response is an object with a 'memory' return",
          Object.hasOwn(updateRes, "memory"),
          `keys=${Object.keys(updateRes).join(",")}`,
        );
        const memoryReturn = updateRes["memory"];
        const memoryRows = Array.isArray(memoryReturn) ? memoryReturn.length : -1;
        check(
          "update: 'memory' return non-empty (anchor found X)",
          memoryRows > 0,
          `memory rows=${memoryRows}`,
        );
        check(
          "update: 'updated' branch indicates presence (setProperty ran)",
          Object.hasOwn(updateRes, "updated") && indicatesPresence(updateRes["updated"]),
          `updated=${summarizeResponse({ updated: updateRes["updated"] ?? null })}`,
        );
      } else {
        check(
          "update: response is an object with a 'memory' return",
          false,
          `got ${typeof updateRes}`,
        );
      }

      /* ---- Gate 1: text index refresh (NEW query, NEW content) -------- */
      const afterNew = await client.query<unknown>(textQuery(NEWQ)).send();
      const newRow = findRow(afterNew, MEMORY_ID);
      const newScore = newRow === undefined ? Number.NaN : readNumber(newRow, ["score", "$score"], 0);
      gateText = newRow !== undefined && newScore > 0 && readString(newRow, "content", "") === C2;
      check(
        "GATE 1: text(NEW) matches X, positive score, live content == C2 (text index refreshed)",
        gateText,
        `present=${newRow !== undefined} score=${newScore} contentLen=${
          newRow === undefined ? "-" : readString(newRow, "content", "").length
        } want=${C2.length}`,
      );

      /* ---- Gate 2: vector index refresh (embed(NEW) reads X ~0) -------- */
      const afterVec = await client.query<unknown>(vectorQuery(E2)).send();
      const vecRow = findRow(afterVec, MEMORY_ID);
      const vecDistance = vecRow === undefined ? Number.NaN : readNumber(vecRow, ["distance", "$distance"], Number.NaN);
      gateVector = vecRow !== undefined && Number.isFinite(vecDistance) && vecDistance <= FRESH_DISTANCE_MAX;
      check(
        `GATE 2: vector(embed(NEW)) reads X at distance <= ${FRESH_DISTANCE_MAX} (vector index refreshed)`,
        gateVector,
        `present=${vecRow !== undefined} distance=${vecDistance} (stale would be ~${STALE_DISTANCE.toFixed(4)})`,
      );

      /* ---- Gate 3: old content unthroned (OLD query no longer scores) -- */
      const afterOld = await client.query<unknown>(textQuery(OLDQ)).send();
      const oldRow = findRow(afterOld, MEMORY_ID);
      const oldScore = oldRow === undefined ? 0 : readNumber(oldRow, ["score", "$score"], 0);
      gateUnthrone = !(oldRow !== undefined && oldScore > 0);
      check(
        "GATE 3: text(OLD) no longer scores X positive (old content unthroned)",
        gateUnthrone,
        `present=${oldRow !== undefined} score=${oldScore}`,
      );

      /* ---- Sub-check: dedupKey round-trip (informational) -------------- */
      try {
        const dup = await client
          .query<unknown>(findMemoryByDedupKey().toQueryRequest(findMemoryByDedupKeyParams, { dedupKey: dedupKey2 }))
          .send();
        const dupRow = findRow(dup, MEMORY_ID);
        check(
          "sub: dedupKey(NEW) round-trips to X (informational)",
          dupRow !== undefined,
          `rows=${(rowsOf(dup) ?? []).length}`,
        );
      } catch (err) {
        check("sub: dedupKey(NEW) round-trips to X (informational)", false, describeError(err));
      }

      /* ---- Sub-check: concept re-link (own verdict, authorized fallback) */
      let conceptOk = false;
      try {
        const graph = await client
          .query<unknown>(
            graphSearch().toQueryRequest(graphSearchParams, {
              concepts: [CONCEPT],
              project: PROJECT,
              k: 10,
            }),
          )
          .send();
        conceptOk = findRow(graph, MEMORY_ID) !== undefined;
        check("sub: graph concept re-link reaches X", conceptOk, `rows=${(rowsOf(graph) ?? []).length}`);
      } catch (err) {
        check("sub: graph concept re-link reaches X", false, describeError(err));
      }
      console.log(
        conceptOk
          ? "sub verdict: concept re-link OK (full batch shape shippable)"
          : "sub verdict: concept re-link FAILED — AUTHORIZED FALLBACK: drop the concept re-link, keep the setProperty path",
      );
      if (!updateRanFull) {
        console.log("note: full batch errored — content-only retry ran; see ERROR line above");
      }

      /* ---- Verdict A/B (gates 1-3 only) -------------------------------- */
      const verdictA = gateText && gateVector && gateUnthrone;
      console.log(
        verdictA
          ? "VERDICT: A — setProperty refreshes text + vector indexes and unthrones old content; wire src/store.ts"
          : "VERDICT: B — index refresh NOT proven (gates above); STOP step-2 store integration and brief back",
      );
    }
  } finally {
    /* Cleanup: forget X (best-effort; leftovers from CRASHED runs stay). */
    try {
      const res = await client
        .query<unknown>(forgetMemory().toQueryRequest(forgetMemoryParams, { memoryId: MEMORY_ID }))
        .send();
      console.log(`cleanup: forget X -> ${summarizeResponse(res)}`);
    } catch (err) {
      console.log(`cleanup: forget X ERROR — ${describeError(err)}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  const verdictA = setupOk && gateText && gateVector && gateUnthrone;
  if (verdictA) {
    console.log("PROBE4 PASS (VERDICT A)");
    process.exit(0);
  }
  console.log(
    `PROBE4 FAIL (VERDICT B)${failures.length > 0 ? `\n  - ${failures.join("\n  - ")}` : " — setup incomplete"}`,
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`probe4 crashed: ${describeError(err)}`);
  process.exit(1);
});
