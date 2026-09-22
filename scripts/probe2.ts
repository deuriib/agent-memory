/**
 * Probe 2: confirm (1) index readiness timing after `createIndexIfNotExists`,
 * (2) that the forEachParam body actually committed Concept nodes + edges.
 *
 * Run: npx tsx scripts/probe.ts && npx tsx scripts/probe2.ts
 */
import { Client, g, readBatch } from "@helix-db/helix-db";

const url = process.env.HELIX_URL ?? "http://localhost:6969";
const client = Client.server(url);

function countConcepts() {
  return readBatch().varAs("n", g().nWithLabel("ProbeConcept").count()).returning(["n"]);
}

function allConcepts() {
  return readBatch()
    .varAs("n", g().nWithLabel("ProbeConcept").valueMap(["$id", "name"]))
    .returning(["n"]);
}

/** Walk every ProbeMemory out-edges to prove cross-entry links committed. */
function conceptEdges() {
  return readBatch()
    .varAs(
      "n",
      g().nWithLabel("ProbeMemory").out("HAS_CONCEPT").valueMap(["$id", "name"]),
    )
    .returning(["n"]);
}

const textParams = undefined;
async function textSearch(): Promise<unknown> {
  const { defineParams, param, Predicate, PropertyInput, PropertyProjection } = await import(
    "@helix-db/helix-db"
  );
  const p = defineParams({ q: param.string(), project: param.string() });
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel("ProbeMemory")
        .where(Predicate.eqParam("project", "project"))
        .textSearchWith(
          "ProbeMemory",
          "content",
          PropertyInput.param("q"),
          5n,
          PropertyInput.param("project"),
        )
        .project([
          PropertyProjection.renamed("$id", "id"),
          PropertyProjection.new("content"),
          PropertyProjection.renamed("$score", "score"),
        ]),
    )
    .returning(["hits"])
    .toQueryRequest(p, { q: "probe", project: "probe" });
}

async function main(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const res = await client.query((await textSearch()) as never).send();
      console.log(`textSearch READY on attempt ${attempt} (${(attempt - 1) * 2}s after index create)`);
      console.log(`  ${JSON.stringify(res).slice(0, 400)}`);
      break;
    } catch (err) {
      const msg = String(err);
      const missing = msg.includes("index_not_found");
      console.log(
        `attempt ${attempt}: ${missing ? "index_not_found (still building)" : `OTHER ERROR: ${msg.slice(0, 300)}`}`,
      );
      if (!missing) break;
      await sleep(2000);
    }
  }

  console.log(`\nProbeConcept count: ${JSON.stringify(await client.query(countConcepts().toQueryRequest() as never).send())}`);
  console.log(`ProbeConcept nodes: ${JSON.stringify(await client.query(allConcepts().toQueryRequest() as never).send())}`);
  console.log(`HAS_CONCEPT targets: ${JSON.stringify(await client.query(conceptEdges().toQueryRequest() as never).send())}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
