/**
 * Probe: verify the risky query constructs against the live dev instance
 * before freezing the db/ contract.
 *
 *   A1  writeBatch + forEachParam over an EMPTY array (does the batch still commit?)
 *   A2  forEachParam over a NON-empty array
 *   B   cross-entry NodeRef.var(...) referenced from inside a forEachParam body
 *   C   upsert via varAsIf
 *   D   read route sanity
 *   E   index bootstrap (equality + vector + text)
 *   F   traversal-scoped textSearch / vectorSearch
 *
 * Run: npx tsx scripts/probe.ts
 */
import {
  BatchCondition,
  Client,
  NodeRef,
  Predicate,
  PropertyInput,
  VectorDistanceMetric,
  defineParams,
  g,
  param,
  readBatch,
  writeBatch,
  IndexSpec,
  PropertyProjection,
} from "@helix-db/helix-db";

const url = process.env.HELIX_URL ?? "http://localhost:6969";
const client = Client.server(url);

async function run(label: string, req: unknown): Promise<void> {
  try {
    const res = await client.query(req as never).send();
    console.log(`PASS  ${label}`);
    console.log(`      ${JSON.stringify(res).slice(0, 500)}`);
  } catch (err) {
    console.log(`FAIL  ${label}`);
    console.log(`      ${String(err).slice(0, 700)}`);
  }
}

const forEachParams = defineParams({ concepts: param.array(param.object()) });

function conceptBody() {
  return writeBatch().varAs(
    "concept",
    g().addN("ProbeConcept", { name: PropertyInput.param("name") }),
  );
}

function xrefBody() {
  return writeBatch()
    .varAs("concept", g().addN("ProbeConcept", { name: PropertyInput.param("name") }))
    .varAs("link", g().n(NodeRef.var("mem")).addE("HAS_CONCEPT", NodeRef.var("concept"), {}));
}

function probeEmptyForEach(p = forEachParams) {
  return writeBatch()
    .varAs("mem", g().addN("ProbeMemory", { content: "probe-empty", project: "probe" }))
    .forEachParam("concepts", conceptBody())
    .returning(["mem"]);
}

function probeNonEmptyForEach(p = forEachParams) {
  return writeBatch()
    .varAs("mem", g().addN("ProbeMemory", { content: "probe-nonempty", project: "probe" }))
    .forEachParam("concepts", conceptBody())
    .returning(["mem"]);
}

function probeCrossEntryRef(p = forEachParams) {
  return writeBatch()
    .varAs("mem", g().addN("ProbeMemory", { content: "probe-xref", project: "probe" }))
    .forEachParam("concepts", xrefBody())
    .returning(["mem"]);
}

const upsertParams = defineParams({ content: param.string() });
function probeUpsert(p = upsertParams) {
  return writeBatch()
    .varAs("existing", g().nWithLabel("ProbeMemory").where(Predicate.eqParam("content", "content")))
    .varAsIf(
      "updated",
      BatchCondition.varNotEmpty("existing"),
      g().n(NodeRef.var("existing")).setProperty("project", PropertyInput.value("touched")),
    )
    .varAsIf(
      "created",
      BatchCondition.varEmpty("existing"),
      g().addN("ProbeMemory", { content: PropertyInput.param("content"), project: "probe" }),
    )
    .returning(["updated", "created"]);
}

function probeCount() {
  return readBatch().varAs("count", g().nWithLabel("ProbeMemory").count()).returning(["count"]);
}

function probeBootstrapIndexes() {
  return writeBatch()
    .varAs("i1", g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality("ProbeMemory", "content")))
    .varAs(
      "i2",
      g().createIndexIfNotExists(
        IndexSpec.nodeVector("ProbeMemory", "embedding", 384, VectorDistanceMetric.Cosine, "project"),
      ),
    )
    .varAs(
      "i3",
      g().createIndexIfNotExists(IndexSpec.nodeText("ProbeMemory", "content", "project")),
    )
    .returning(["i1", "i2", "i3"]);
}

const searchParams = defineParams({ q: param.string(), project: param.string() });
function probeTextSearch(p = searchParams) {
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel("ProbeMemory")
        .where(Predicate.eqParam("project", "project"))
        .textSearchWith("ProbeMemory", "content", PropertyInput.param("q"), 5n, PropertyInput.param("project"))
        .project([
          PropertyProjection.renamed("$id", "id"),
          PropertyProjection.new("content"),
          PropertyProjection.renamed("$score", "score"),
        ]),
    )
    .returning(["hits"]);
}

const vecParams = defineParams({
  queryVector: param.array(param.f32()),
  project: param.string(),
});
function probeVectorSearch(p = vecParams) {
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel("ProbeMemory")
        .where(Predicate.eqParam("project", "project"))
        .vectorSearchWith(
          "ProbeMemory",
          "embedding",
          PropertyInput.param("queryVector"),
          5n,
          PropertyInput.param("project"),
        )
        .project([
          PropertyProjection.renamed("$id", "id"),
          PropertyProjection.new("content"),
          PropertyProjection.renamed("$distance", "distance"),
        ]),
    )
    .returning(["hits"]);
}

/** Seed a node that actually carries an embedding so vector search has a target. */
function probeSeedVector(p = vecParams) {
  return writeBatch()
    .varAs(
      "seed",
      g().addN("ProbeMemory", {
        content: "vector seed row",
        project: "probe",
        embedding: PropertyInput.param("queryVector"),
      }),
    )
    .returning(["seed"]);
}

async function main(): Promise<void> {
  console.log(`probing ${url}\n`);

  await run(
    "A1 empty forEachParam",
    probeEmptyForEach().toQueryRequest(forEachParams, { concepts: [] }),
  );
  await run(
    "A2 non-empty forEachParam",
    probeNonEmptyForEach().toQueryRequest(forEachParams, {
      concepts: [{ name: "probe-alpha" }, { name: "probe-beta" }],
    }),
  );
  await run(
    "B  cross-entry NodeRef in forEach",
    probeCrossEntryRef().toQueryRequest(forEachParams, { concepts: [{ name: "probe-gamma" }] }),
  );
  await run(
    "C  upsert varAsIf (run twice: create then update)",
    probeUpsert().toQueryRequest(upsertParams, { content: "probe-upsert" }),
  );
  await run("C2 upsert second call", probeUpsert().toQueryRequest(upsertParams, { content: "probe-upsert" }));
  await run("D  read count", probeCount().toQueryRequest());
  await run("E  bootstrap indexes", probeBootstrapIndexes().toQueryRequest());

  const vec = Array.from({ length: 384 }, (_, i) => Math.sin(i) / 10);
  await run("E2 seed embedding row", probeSeedVector().toQueryRequest(vecParams, { queryVector: vec, project: "probe" }));
  await run("F  textSearch scoped", probeTextSearch().toQueryRequest(searchParams, { q: "probe", project: "probe" }));
  await run("G  vectorSearch scoped", probeVectorSearch().toQueryRequest(vecParams, { queryVector: vec, project: "probe" }));
  await run("H  final count", probeCount().toQueryRequest());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
