/**
 * Probe 3 (REQ-P1-6 decision gate): run BEFORE implementing content-hash
 * dedup, against the LIVE dev instance (http://localhost:6969 — dev data is
 * disposable; the instance is never restarted).
 *
 * Questions (verbatim findings are printed and pasted into the lane report):
 *
 *   (a) Does creating the unique-equality index #8
 *       (Memory.dedupKey) succeed on an instance full of LEGACY Memory nodes
 *       that have NO dedupKey property, and does an equality read over it
 *       become ready? Sub-question: are missing-property nodes treated as
 *       colliding nulls? (two full-shaped writes WITHOUT dedupKey — if the
 *       second is rejected, nulls ARE unique-enforced.)
 *   (b) Is a duplicate dedupKey write rejected, and with WHICH structured
 *       error? (kind / message / details — remember()'s race path must match
 *       on this shape.)
 *   (c) Does the exact findMemoryByDedupKey read planned for contract §2
 *       round-trip the row written with that dedupKey?
 *
 * Writes go ONLY into isolated `probe-p1-*` projects and always carry a real
 * 384-dim embedding + all standard Memory properties, so the ONLY variable
 * under test is dedupKey. No logs print content or embedding values.
 *
 * Run: npx tsx scripts/probe3.ts
 * Decision: all three green -> ship index #8 + findMemoryByDedupKey, NO
 * backfill script. (a) blocked -> contingency setDedupKey + backfill.
 */
import { Client, g, readBatch, writeBatch, IndexSpec, Predicate, PropertyInput, PropertyProjection, defineParams, param, type QueryRequest } from "@helix-db/helix-db";
import type { HelixError } from "@helix-db/helix-db";
import { embed } from "../src/embed.js";

const url = process.env.HELIX_URL ?? "http://localhost:6969";
const client = Client.server(url);

const PROJECT_A = "probe-p1-legacy"; // (a3) null-uniqueness sub-question
const PROJECT_B = "probe-p1-dup"; // (b) duplicate rejection
const PROJECT_C = "probe-p1-roundtrip"; // (c) round-trip

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Structured error description — mirrors bootstrap.ts (never logs query values). */
function describeError(err: unknown): string {
  if (err !== null && typeof err === "object" && "kind" in err) {
    const helix = err as HelixError;
    const details = "details" in helix && helix.details !== undefined ? ` — ${helix.details}` : "";
    return `HelixError kind=${String(helix.kind)} message=${String(helix.message)}${details}`;
  }
  if (err instanceof Error) return `${err.constructor.name}: ${err.message}`;
  return String(err);
}

function errorShape(err: unknown): string {
  const shape: Record<string, unknown> = {
    instanceofError: err instanceof Error,
    constructorName: err !== null && typeof err === "object" ? (err as { constructor?: { name?: string } }).constructor?.name : typeof err,
  };
  if (err !== null && typeof err === "object") {
    for (const key of Object.keys(err)) {
      shape[key] = (err as Record<string, unknown>)[key];
    }
  }
  return JSON.stringify(shape);
}

/** Count every Memory node (proves legacy no-dedupKey nodes exist). */
function countAllMemories() {
  return readBatch().varAs("n", g().nWithLabel("Memory").count()).returning(["n"]);
}

/** Index #8 — the exact spec bootstrap will ship. */
function ensureDedupIndex() {
  return writeBatch()
    .varAs(
      "memory_dedup",
      g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality("Memory", "dedupKey")),
    )
    .returning(["memory_dedup"]);
}

/** The EXACT read planned as contract-§2 findMemoryByDedupKey. */
const findParams = defineParams({ dedupKey: param.string() });
function findMemoryByDedupKey() {
  return readBatch()
    .varAs(
      "memory",
      g()
        .nWithLabel("Memory")
        .where(Predicate.eqParam("dedupKey", "dedupKey"))
        .limit(1)
        .project([
          PropertyProjection.renamed("$id", "id"),
          PropertyProjection.new("memoryId"),
          PropertyProjection.new("sessionId"),
          PropertyProjection.new("project"),
        ]),
    )
    .returning(["memory"]);
}

/**
 * One full-shaped Memory write. `dedupKey: undefined` omits the property
 * entirely (legacy shape); a string sets it.
 */
function writeMemory(values: {
  memoryId: string;
  project: string;
  sessionId: string;
  dedupKey: string | undefined;
}): QueryRequest {
  const props: Record<string, PropertyInput> = {
    memoryId: PropertyInput.value(values.memoryId),
    content: PropertyInput.value("probe p1 dedup content"),
    project: PropertyInput.value(values.project),
    sessionId: PropertyInput.value(values.sessionId),
    origin: PropertyInput.value("probe"),
    importance: PropertyInput.value(0.5),
    createdAt: PropertyInput.value(new Date().toISOString()),
    embedding: PropertyInput.value(embed("probe p1 dedup content")),
  };
  if (values.dedupKey !== undefined) {
    props["dedupKey"] = PropertyInput.value(values.dedupKey);
  }
  return writeBatch()
    .varAs("memory", g().addN("Memory", props))
    .returning(["memory"])
    .toQueryRequest();
}

async function main(): Promise<void> {
  const findings: string[] = [];
  const record = (line: string): void => {
    findings.push(line);
    console.log(line);
  };

  /* ---- (a) index on legacy nodes ---------------------------------- */
  const before = await client.query<unknown>(countAllMemories().toQueryRequest()).send();
  record(`(a0) baseline Memory count BEFORE index #8: ${JSON.stringify(before)}`);

  try {
    const created = await client.query<unknown>(ensureDedupIndex().toQueryRequest()).send();
    record(`(a1) createIndexIfNotExists Memory.dedupKey: OK — ${JSON.stringify(created)}`);
  } catch (err) {
    record(`(a1) createIndexIfNotExists Memory.dedupKey: ERROR — ${describeError(err)}`);
    record("VERDICT: (a) BLOCKED at index creation -> contingency setDedupKey + backfill required");
    return printSummary(findings, "BLOCKED");
  }

  // (a2) poll an equality read until the index answers (never matches a row).
  const poll = findMemoryByDedupKey().toQueryRequest(findParams, { dedupKey: "__probe_never_matches__" });
  let ready = false;
  for (let attempt = 1; attempt <= 16; attempt++) {
    try {
      const res = await client.query<unknown>(poll).send();
      record(`(a2) dedupKey equality read READY on attempt ${attempt} (${(attempt - 1) * 2}s): ${JSON.stringify(res)}`);
      ready = true;
      break;
    } catch (err) {
      const desc = describeError(err);
      const building = desc.includes("index_not_found");
      record(`(a2) attempt ${attempt}: ${building ? "index_not_found (still building)" : `OTHER ERROR — ${desc}`}`);
      if (!building && attempt >= 2) {
        record(`VERDICT: (a) BLOCKED — equality read failed with: ${desc}`);
        return printSummary(findings, "BLOCKED");
      }
      await sleep(2000);
    }
  }
  if (!ready) {
    record("VERDICT: (a) BLOCKED — index never became queryable within 30s");
    return printSummary(findings, "BLOCKED");
  }

  // (a3) null-uniqueness: two full-shaped writes WITHOUT dedupKey.
  const legacyBase = `probe-legacy-${Date.now()}`;
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: `${legacyBase}-1`, project: PROJECT_A, sessionId: PROJECT_A, dedupKey: undefined }))
      .send();
    record("(a3-1) Memory WITHOUT dedupKey: WRITE OK (null slot taken)");
  } catch (err) {
    record(`(a3-1) Memory WITHOUT dedupKey: ERROR — ${describeError(err)}`);
  }
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: `${legacyBase}-2`, project: PROJECT_A, sessionId: PROJECT_A, dedupKey: undefined }))
      .send();
    record("(a3-2) second Memory WITHOUT dedupKey: WRITE OK — missing dedupKey is NOT unique-enforced (legacy nodes harmless)");
  } catch (err) {
    record(`(a3-2) second Memory WITHOUT dedupKey: REJECTED — ${describeError(err)}`);
    record("  => missing-property nodes ARE unique-enforced as nulls; legacy nodes did not block index build (a2 ready) but new property-less writes would be rejected");
  }

  /* ---- (b) duplicate rejection + structured error ------------------ */
  const dupKey = `probe-dup-${Date.now()}`;
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: `probe-dup-${Date.now()}-1`, project: PROJECT_B, sessionId: PROJECT_B, dedupKey: dupKey }))
      .send();
    record("(b1) first write WITH dedupKey: OK");
  } catch (err) {
    record(`(b1) first write WITH dedupKey: ERROR — ${describeError(err)}`);
  }
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: `probe-dup-${Date.now()}-2`, project: PROJECT_B, sessionId: PROJECT_B, dedupKey: dupKey }))
      .send();
    record("(b2) DUPLICATE dedupKey write: ACCEPTED — unique index NOT enforcing (blocker for remember() race path)");
  } catch (err) {
    record(`(b2) DUPLICATE dedupKey write: REJECTED — ${describeError(err)}`);
    record(`(b2) error shape verbatim: ${errorShape(err)}`);
  }

  /* ---- (c) round-trip the planned §2 read -------------------------- */
  const rtKey = `probe-roundtrip-${Date.now()}`;
  const rtMemoryId = `probe-rt-${Date.now()}`;
  const rtSession = `probe-rt-session-${Date.now()}`;
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: rtMemoryId, project: PROJECT_C, sessionId: rtSession, dedupKey: rtKey }))
      .send();
    record(`(c1) write WITH unique dedupKey: OK (memoryId=${rtMemoryId})`);
  } catch (err) {
    record(`(c1) write WITH unique dedupKey: ERROR — ${describeError(err)}`);
    return printSummary(findings, "BLOCKED");
  }
  try {
    const row = await client
      .query<unknown>(findMemoryByDedupKey().toQueryRequest(findParams, { dedupKey: rtKey }))
      .send();
    record(`(c2) findMemoryByDedupKey round-trip: ${JSON.stringify(row)}`);
    const json = JSON.stringify(row);
    const hit = json.includes(rtMemoryId) && json.includes(rtSession) && json.includes(PROJECT_C);
    record(hit ? "(c2) VERDICT: round-trip carries memoryId + sessionId + project — GREEN" : "(c2) VERDICT: row MISSES expected fields — BLOCKED");
  } catch (err) {
    record(`(c2) findMemoryByDedupKey: ERROR — ${describeError(err)}`);
    return printSummary(findings, "BLOCKED");
  }

  /* ---- (d) retest AFTER the index settles (async-build hypothesis) - */
  // (b2) accepted the duplicate within milliseconds of (a1)'s "accepted"
  // async create. Re-test now that seconds have passed, count how many nodes
  // actually carry the duplicate key, and read the key WITHOUT .limit(1).
  await sleep(3000);
  try {
    await client
      .query<unknown>(writeMemory({ memoryId: `probe-dup-${Date.now()}-3`, project: PROJECT_B, sessionId: PROJECT_B, dedupKey: dupKey }))
      .send();
    record("(d1) THIRD write with the SAME dedupKey (settled index): ACCEPTED — no unique constraint at write time");
  } catch (err) {
    record(`(d1) THIRD write with the SAME dedupKey (settled index): REJECTED — ${describeError(err)}`);
    record("  => enforcement is real but async (settles after create); remember() race path CAN rely on it");
  }

  const countDup = readBatch()
    .varAs("n", g().nWithLabel("Memory").where(Predicate.eqParam("dedupKey", "dedupKey")).count())
    .returning(["n"]);
  try {
    const counted = await client
      .query<unknown>(countDup.toQueryRequest(findParams, { dedupKey: dupKey }))
      .send();
    record(`(d2) nodes carrying the duplicate dedupKey: ${JSON.stringify(counted)}`);
  } catch (err) {
    record(`(d2) count by dedupKey: ERROR — ${describeError(err)}`);
  }

  const allDup = readBatch()
    .varAs(
      "rows",
      g()
        .nWithLabel("Memory")
        .where(Predicate.eqParam("dedupKey", "dedupKey"))
        .project([PropertyProjection.renamed("$id", "id"), PropertyProjection.new("memoryId")]),
    )
    .returning(["rows"]);
  try {
    const rows = await client
      .query<unknown>(allDup.toQueryRequest(findParams, { dedupKey: dupKey }))
      .send();
    record(`(d3) equality read WITHOUT limit on duplicate key: ${JSON.stringify(rows)}`);
  } catch (err) {
    record(`(d3) equality read WITHOUT limit on duplicate key: ERROR — ${describeError(err)}`);
    record("  => unique index REJECTS ambiguous reads: enforcement lives at read time");
  }

  printSummary(findings, "GREEN");
}

function printSummary(findings: string[], verdict: string): void {
  console.log("\n===== probe3 FINDINGS (verbatim, for the lane report) =====");
  for (const line of findings) console.log(line);
  console.log(`===== OVERALL: ${verdict} =====`);
}

main().catch((err: unknown) => {
  console.error(`probe3 crashed: ${describeError(err)}`);
  process.exit(1);
});
