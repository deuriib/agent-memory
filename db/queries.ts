/**
 * db/queries.ts — frozen query surface (docs/CONTRACT.md §1–§3).
 *
 * Every function builds a fresh batch; attach values at send time with
 * `.toQueryRequest(<exportedParams>, { ...values })`.
 * Every construct here was empirically verified against the live instance
 * before ship (CONTRACT §0 + the Lane-A build report).
 */
import {
  BatchCondition,
  Expr,
  IndexSpec,
  NodeRef,
  Order,
  Predicate,
  PropertyInput,
  PropertyProjection,
  VectorDistanceMetric,
  defineParams,
  g,
  param,
  readBatch,
  writeBatch,
  type ReadBatch,
  type WriteBatch,
} from "@helix-db/helix-db";

/** Node labels — CONTRACT §1. */
export const LABELS = {
  Session: "Session",
  Memory: "Memory",
  Concept: "Concept",
} as const;

/** Edge labels — CONTRACT §1. */
export const EDGES = {
  BELONGS_TO: "BELONGS_TO", // Memory -> Session
  HAS_CONCEPT: "HAS_CONCEPT", // Memory -> Concept
} as const;

/** Embedding dimension — CONTRACT §1. */
export const EMBED_DIM = 384;

/* ------------------------------------------------------------------ *
 * Parameter schemas (CONTRACT §2). Exported so callers can build the
 * QueryRequest via `batch.toQueryRequest(<name>Params, values)`.
 * ------------------------------------------------------------------ */

export const saveMemoryParams = defineParams({
  memoryId: param.string(),
  content: param.string(),
  project: param.string(),
  sessionId: param.string(),
  embedding: param.array(param.f32()),
  origin: param.string(),
  importance: param.f64(),
  createdAt: param.dateTime(),
  concepts: param.array(param.object()), // [{ name: "..." }, ...] — may be EMPTY
  dedupKey: param.string(), // REQ-P1-6: sha256(project + "\n" + normalize(content))
});

export const listSessionsParams = defineParams({
  project: param.string(),
  limit: param.i64(),
});

export const sessionMemoriesParams = defineParams({
  sessionId: param.string(),
  project: param.string(),
  limit: param.i64(),
});

export const searchByVectorParams = defineParams({
  queryVector: param.array(param.f32()),
  project: param.string(),
  k: param.i64(),
});

export const searchByTextParams = defineParams({
  q: param.string(),
  project: param.string(),
  k: param.i64(),
});

export const graphSearchParams = defineParams({
  concepts: param.array(param.string()),
  project: param.string(),
  k: param.i64(),
});

export const forgetMemoryParams = defineParams({
  memoryId: param.string(),
});

export const healthCountParams = defineParams({
  project: param.string(),
});

/* ------------------------------------------------------------------ *
 * Projections reused by the read routes (CONTRACT §2: never expose
 * `embedding`; project $score / $distance before leaving the hit stream).
 * Sanctioned internal exception: `getMemoryById` projects `embedding` so
 * the consolidation post-write verify (REQ-F-01) can compare it in-process
 * — that row never leaves the store/verify path.
 * ------------------------------------------------------------------ */

const memoryRowProjection: PropertyProjection[] = [
  PropertyProjection.renamed("$id", "id"),
  PropertyProjection.new("memoryId"),
  PropertyProjection.new("content"),
  PropertyProjection.new("sessionId"),
  PropertyProjection.new("origin"),
  PropertyProjection.new("importance"),
  PropertyProjection.new("createdAt"),
];

/* ------------------------------------------------------------------ *
 * bootstrapIndexes — CONTRACT §2 (all 8 indexes, createIndexIfNotExists).
 *
 * #8 (memory_dedup) is a unique-equality LOOKUP index for
 * findMemoryByDedupKey. Probe3 proved the server does NOT enforce its
 * uniqueness (duplicate writes accepted) — it accelerates reads only;
 * dedup is enforced application-side in HelixStore.remember.
 * ------------------------------------------------------------------ */

export function bootstrapIndexes(): WriteBatch {
  return writeBatch()
    .varAs(
      "memory_id",
      g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality(LABELS.Memory, "memoryId")),
    )
    .varAs(
      "session_id",
      g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality(LABELS.Session, "sessionId")),
    )
    .varAs(
      "concept_name",
      g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality(LABELS.Concept, "name")),
    )
    .varAs(
      "memory_session",
      g().createIndexIfNotExists(IndexSpec.nodeEquality(LABELS.Memory, "sessionId")),
    )
    .varAs(
      "memory_project",
      g().createIndexIfNotExists(IndexSpec.nodeEquality(LABELS.Memory, "project")),
    )
    .varAs(
      "memory_embedding",
      g().createIndexIfNotExists(
        IndexSpec.nodeVector(LABELS.Memory, "embedding", EMBED_DIM, VectorDistanceMetric.Cosine, "project"),
      ),
    )
    .varAs(
      "memory_content",
      g().createIndexIfNotExists(IndexSpec.nodeText(LABELS.Memory, "content", "project")),
    )
    .varAs(
      "memory_dedup",
      g().createIndexIfNotExists(IndexSpec.nodeUniqueEquality(LABELS.Memory, "dedupKey")),
    )
    .returning([
      "memory_id",
      "session_id",
      "concept_name",
      "memory_session",
      "memory_project",
      "memory_embedding",
      "memory_content",
      "memory_dedup",
    ]);
}

/* ------------------------------------------------------------------ *
 * saveMemory — CONTRACT §2/§3: ONE writeBatch, five entries.
 *
 *   1. session upsert   — anchor by sessionId unique equality,
 *                         varNotEmpty branch bumps updatedAt,
 *                         varEmpty branch creates the Session.
 *   2. memory           — addN with PropertyInput.param for every property.
 *   3. BELONGS_TO link  — two conditional entries so the edge resolves on
 *                         BOTH the session-created and session-updated paths.
 *   4. concepts forEach — per element: upsert Concept by name (unique
 *                         equality + varAsIf) ...
 *   5. HAS_CONCEPT edge — ... from NodeRef.var("memory") to that Concept.
 *
 * Empty `concepts` array is safe (CONTRACT §0, probe A1).
 * Returns include "memory" so the caller receives the new $id.
 * ------------------------------------------------------------------ */

/** Entry 4+5 body: one Concept upsert + HAS_CONCEPT edge, run per element. */
function conceptBody(): WriteBatch {
  return writeBatch()
    .varAs(
      "concept_anchor",
      g().nWithLabel(LABELS.Concept).where(Predicate.eqParam("name", "name")),
    )
    .varAsIf(
      "concept_created",
      BatchCondition.varEmpty("concept_anchor"),
      g().addN(LABELS.Concept, {
        name: PropertyInput.param("name"),
        project: PropertyInput.param("project"), // outer param visible inside forEach body (verified)
      }),
    )
    .varAsIf(
      "concept_link_existing",
      BatchCondition.varNotEmpty("concept_anchor"),
      g()
        .n(NodeRef.var("memory"))
        .addE(EDGES.HAS_CONCEPT, NodeRef.var("concept_anchor"), {}),
    )
    .varAsIf(
      "concept_link_created",
      BatchCondition.varEmpty("concept_anchor"),
      g()
        .n(NodeRef.var("memory"))
        .addE(EDGES.HAS_CONCEPT, NodeRef.var("concept_created"), {}),
    );
}

export function saveMemory(): WriteBatch {
  return writeBatch()
    // Entry 1a — session anchor (unique-equality index on Session.sessionId).
    .varAs(
      "session_anchor",
      g().nWithLabel(LABELS.Session).where(Predicate.eqParam("sessionId", "sessionId")),
    )
    // Entry 1b — existing session: bump updatedAt ("now" on the server).
    .varAsIf(
      "session_existing",
      BatchCondition.varNotEmpty("session_anchor"),
      g().n(NodeRef.var("session_anchor")).setProperty("updatedAt", Expr.datetime()),
    )
    // Entry 1c — new session: create it.
    .varAsIf(
      "session_created",
      BatchCondition.varEmpty("session_anchor"),
      g().addN(LABELS.Session, {
        sessionId: PropertyInput.param("sessionId"),
        project: PropertyInput.param("project"),
        startedAt: PropertyInput.param("createdAt"),
        updatedAt: PropertyInput.param("createdAt"),
      }),
    )
    // Entry 2 — memory node.
    .varAs(
      "memory",
      g().addN(LABELS.Memory, {
        memoryId: PropertyInput.param("memoryId"),
        content: PropertyInput.param("content"),
        project: PropertyInput.param("project"),
        sessionId: PropertyInput.param("sessionId"),
        origin: PropertyInput.param("origin"),
        importance: PropertyInput.param("importance"),
        createdAt: PropertyInput.param("createdAt"),
        embedding: PropertyInput.param("embedding"),
        dedupKey: PropertyInput.param("dedupKey"), // REQ-P1-6
      }),
    )
    // Entry 3 — BELONGS_TO, updated-session path.
    .varAsIf(
      "link_existing",
      BatchCondition.varNotEmpty("session_anchor"),
      g()
        .n(NodeRef.var("memory"))
        .addE(EDGES.BELONGS_TO, NodeRef.var("session_existing"), {}),
    )
    // Entry 3 — BELONGS_TO, created-session path.
    .varAsIf(
      "link_created",
      BatchCondition.varEmpty("session_anchor"),
      g()
        .n(NodeRef.var("memory"))
        .addE(EDGES.BELONGS_TO, NodeRef.var("session_created"), {}),
    )
    // Entries 4+5 — concept upsert + HAS_CONCEPT, per element (may be empty).
    .forEachParam("concepts", conceptBody())
    .returning(["memory", "session_existing", "session_created"]);
}

/* ------------------------------------------------------------------ *
 * Read routes — CONTRACT §2. Reads anchor narrow, scope, then search;
 * never source-search followed by where; never return `embedding`.
 * ------------------------------------------------------------------ */

export function listSessions(): ReadBatch {
  return readBatch()
    .varAs(
      "sessions",
      g()
        .nWithLabel(LABELS.Session)
        .where(Predicate.eqParam("project", "project"))
        // Server v0.0.6 does NOT sort DateTime keys (string/$id verified OK,
        // updatedAt verified non-monotone across 8 sessions). $id desc =
        // deterministic newest-created-first, asserted by the build probe.
        .orderBy("$id", Order.Desc)
        .limit(listSessionsParams.limit)
        .project([
          PropertyProjection.renamed("$id", "id"),
          PropertyProjection.new("sessionId"),
          PropertyProjection.new("project"),
          PropertyProjection.new("startedAt"),
          PropertyProjection.new("updatedAt"),
        ]),
    )
    .returning(["sessions"]);
}

export function sessionMemories(): ReadBatch {
  return readBatch()
    .varAs(
      "memories",
      g()
        .nWithLabel(LABELS.Memory)
        .where(
          Predicate.and([
            Predicate.eqParam("sessionId", "sessionId"),
            Predicate.eqParam("project", "project"),
          ]),
        )
        // See listSessions: DateTime ordering is broken server-side; $id desc
        // gives deterministic newest-first (node ids increase on creation).
        .orderBy("$id", Order.Desc)
        .limit(sessionMemoriesParams.limit)
        .project([...memoryRowProjection]),
    )
    .returning(["memories"]);
}

export function searchByVector(): ReadBatch {
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel(LABELS.Memory)
        .where(Predicate.eqParam("project", "project"))
        .vectorSearchWith(
          LABELS.Memory,
          "embedding",
          PropertyInput.param("queryVector"),
          searchByVectorParams.k,
          PropertyInput.param("project"),
        )
        .project([
          ...memoryRowProjection,
          PropertyProjection.renamed("$distance", "distance"),
        ]),
    )
    .returning(["hits"]);
}

export function searchByText(): ReadBatch {
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel(LABELS.Memory)
        .where(Predicate.eqParam("project", "project"))
        .textSearchWith(
          LABELS.Memory,
          "content",
          PropertyInput.param("q"),
          searchByTextParams.k,
          PropertyInput.param("project"),
        )
        .project([
          ...memoryRowProjection,
          PropertyProjection.renamed("$score", "score"),
        ]),
    )
    .returning(["hits"]);
}

export function graphSearch(): ReadBatch {
  return readBatch()
    .varAs(
      "hits",
      g()
        .nWithLabel(LABELS.Concept)
        .where(Predicate.isInParam("name", "concepts"))
        .in(EDGES.HAS_CONCEPT)
        .where(Predicate.eqParam("project", "project"))
        .dedup()
        .limit(graphSearchParams.k)
        .project([...memoryRowProjection]),
    )
    .returning(["hits"]);
}

export function forgetMemory(): WriteBatch {
  return writeBatch()
    .varAs(
      "target",
      g().nWithLabel(LABELS.Memory).where(Predicate.eqParam("memoryId", "memoryId")),
    )
    .varAsIf(
      "forgotten",
      BatchCondition.varNotEmpty("target"),
      g().n(NodeRef.var("target")).drop(),
    )
    // "target" carries the pre-drop binding so callers can distinguish
    // 200 (target non-empty) from 404 (both empty); drop() emits no rows.
    .returning(["target", "forgotten"]);
}

export function healthCount(): ReadBatch {
  return readBatch()
    .varAs(
      "memories",
      g().nWithLabel(LABELS.Memory).where(Predicate.eqParam("project", "project")).count(),
    )
    .varAs(
      "sessions",
      g().nWithLabel(LABELS.Session).where(Predicate.eqParam("project", "project")).count(),
    )
    .returning(["memories", "sessions"]);
}

/* ------------------------------------------------------------------ *
 * findMemoryByDedupKey — REQ-P1-6 (ADDITIVE, contract §2 delta).
 *
 * Exact equality on the dedup hash (index #8), project carried in the row
 * so remember() can assert the hit belongs to the caller's project before
 * returning someone else's id (hash includes project, this is the
 * fail-closed double check). Probe3 (c2) verified this exact shape against
 * the live instance: match -> array of {id, memoryId, sessionId, project};
 * miss -> null.
 * ------------------------------------------------------------------ */

export const findMemoryByDedupKeyParams = defineParams({
  dedupKey: param.string(),
});

export function findMemoryByDedupKey(): ReadBatch {
  return readBatch()
    .varAs(
      "memory",
      g()
        .nWithLabel(LABELS.Memory)
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

/* ------------------------------------------------------------------ *
 * listExpired — REQ-P1-1 (ADDITIVE, contract §2 delta).
 *
 * Project-scoped rows older than `cutoff` (strict ltParam on createdAt —
 * probe3 (e) verified against the live instance: strict older-than,
 * dateTime-typed, $id Asc deterministic because the server does NOT sort
 * DateTime keys). Consumed by scripts/purge.ts in batches of 500.
 *
 * Projects ONLY memoryId: the sole field purge ever acts on (dry-run ids,
 * forget targets) — content and the rest of the row never leave the query
 * (data minimization; a deviation from "memoryRowProjection" noted in the
 * lane report).
 * ------------------------------------------------------------------ */

export const listExpiredParams = defineParams({
  project: param.string(),
  cutoff: param.dateTime(),
  limit: param.i64(),
});

export function listExpired(): ReadBatch {
  return readBatch()
    .varAs(
      "expired",
      g()
        .nWithLabel(LABELS.Memory)
        .where(
          Predicate.and([
            Predicate.eqParam("project", "project"),
            Predicate.ltParam("createdAt", "cutoff"),
          ]),
        )
        .orderBy("$id", Order.Asc)
        .limit(listExpiredParams.limit)
        .project([PropertyProjection.new("memoryId")]),
    )
    .returning(["expired"]);
}

/* ------------------------------------------------------------------ *
 * listProjects — project discovery for scripts/purge.ts --all
 * (ADDITIVE, contract §2 delta; beyond the spec's single listExpired).
 *
 * purge --all must still run the SIGNED listExpired (project-scoped) per
 * project, so it needs the project names first: listSessions cannot be
 * reused (its eqParam(project) filter is baked in — probing it with an
 * empty project returns nothing). saveMemory upserts a Session for every
 * project it writes, so walking Session rows enumerates every project that
 * has memories. Rows are raw {project} records; the caller dedups.
 * ------------------------------------------------------------------ */

export const listProjectsParams = defineParams({
  limit: param.i64(),
});

export function listProjects(): ReadBatch {
  return readBatch()
    .varAs(
      "projects",
      g()
        .nWithLabel(LABELS.Session)
        .limit(listProjectsParams.limit)
        .project([PropertyProjection.new("project")]),
    )
    .returning(["projects"]);
}

/* ------------------------------------------------------------------ *
 * getMemoryById — REQ-RL-001 (ADDITIVE, contract §2 delta).
 *
 * Fresh survivor re-read for tier-1 consolidation: the probe snapshot can
 * go stale while a caller waits on the per-survivor FIFO lock, so the merge
 * re-reads the row HERE, under the lock, and works against that snapshot.
 * Anchors Memory by its unique-equality memoryId (index #1) and ALSO
 * filters `project` in the same where-clause — the fail-closed double
 * check (same posture as findMemoryByDedupKey, which instead carries
 * `project` in the row for a caller-side assert: here the query itself
 * refuses to return a row outside the caller's project).
 *
 * Projects memoryRowProjection + `dedupKey` + `embedding`: content +
 * dedupKey are exactly what the post-write verify (REQ-F-01) checks, and
 * createdAt feeds the lock-wait TTL re-check. `embedding` is projected for
 * the INTERNAL verify only (sanctioned exception to CONTRACT §2's "never
 * expose embedding") — the row is consumed by verifyMergedState under the
 * survivor lock and never returned to a caller. No new index (existing #1).
 * Probe4/post-write reads verified the shape live before ship.
 * ------------------------------------------------------------------ */

export const getMemoryByIdParams = defineParams({
  memoryId: param.string(),
  project: param.string(),
});

export function getMemoryById(): ReadBatch {
  return readBatch()
    .varAs(
      "memory",
      g()
        .nWithLabel(LABELS.Memory)
        .where(
          Predicate.and([
            Predicate.eqParam("memoryId", "memoryId"),
            Predicate.eqParam("project", "project"),
          ]),
        )
        .limit(1)
        .project([
          ...memoryRowProjection,
          PropertyProjection.new("dedupKey"),
          PropertyProjection.new("embedding"),
        ]),
    )
    .returning(["memory"]);
}

/* ------------------------------------------------------------------ *
 * memoryConcepts — REQ-F-01 (ADDITIVE, contract §2 delta).
 *
 * Concept-link READ for the post-write verify + guard-path heal: anchor
 * the Memory by its unique memoryId AND project (same fail-closed
 * where-clause posture as getMemoryById — the query refuses rows outside
 * the caller's project), traverse OUT HAS_CONCEPT, dedup (conceptBody
 * links unconditionally, so repeated merges CAN add duplicate edges),
 * project the Concept `name`. The store compares this against the merge's
 * effective concept list (pure missingConcepts) and heals via
 * linkMemoryConcepts. No index needed — edge traversal from an anchored
 * node. Returns ["names"] (rows of {name}).
 * ------------------------------------------------------------------ */

export const memoryConceptsParams = defineParams({
  memoryId: param.string(),
  project: param.string(),
});

export function memoryConcepts(): ReadBatch {
  return readBatch()
    .varAs(
      "names",
      g()
        .nWithLabel(LABELS.Memory)
        .where(
          Predicate.and([
            Predicate.eqParam("memoryId", "memoryId"),
            Predicate.eqParam("project", "project"),
          ]),
        )
        .out(EDGES.HAS_CONCEPT)
        .dedup()
        .project([PropertyProjection.new("name")]),
    )
    .returning(["names"]);
}

/* ------------------------------------------------------------------ *
 * linkMemoryConcepts — REQ-F-01 (ADDITIVE, contract §2 delta).
 *
 * Link-only heal: anchor the Memory by memoryId + project, then run the
 * SAME conceptBody() per missing name (Concept upsert + HAS_CONCEPT edge)
 * that saveMemory/updateMemoryContent already use. It NEVER writes
 * content / embedding / dedupKey — so the substring-guard path can heal
 * lost links WITHOUT touching content (byte-identical survivor) and the
 * post-write heal can add links without re-deriving content state.
 * Returns ["memory"] (the anchor — forget-style presence read); the REAL
 * gate is the caller's re-read via memoryConcepts: link rows carry no
 * return var (the F-01 assumption), so a batch that links nothing is
 * caught by the VERIFY, never trusted from this response.
 * ------------------------------------------------------------------ */

// Param order matches the frozen contract §2 surface verbatim
// (`docs/CONTRACT.md`: memoryId, project, concepts). `defineParams` values
// attach BY NAME at `toQueryRequest`, so the order is non-semantic at
// runtime — it is pinned here only so the code and §2 cannot drift (gate
// RL001-F01 / COND-RF-04).
export const linkMemoryConceptsParams = defineParams({
  memoryId: param.string(),
  project: param.string(), // outer param for conceptBody's Concept creation (same as saveMemory)
  concepts: param.array(param.object()), // missing names only — may be EMPTY
});

export function linkMemoryConcepts(): WriteBatch {
  return writeBatch()
    .varAs(
      "memory",
      g()
        .nWithLabel(LABELS.Memory)
        .where(
          Predicate.and([
            Predicate.eqParam("memoryId", "memoryId"),
            Predicate.eqParam("project", "project"),
          ]),
        ),
    )
    .forEachParam("concepts", conceptBody())
    .returning(["memory"]);
}

/* ------------------------------------------------------------------ *
 * updateMemoryContent — REQ-P1-2 (ADDITIVE, contract §2 delta).
 *
 * Tier-1 consolidation's in-place survivor update: anchor the Memory by its
 * unique memoryId, then setProperty content / embedding / dedupKey on it
 * (Probe4 scripts/probe4.ts is the decision gate proving setProperty
 * refreshes the text + vector indexes on the live instance — verdict A/B
 * recorded in the lane report). No Session is written (merges follow dedup
 * first-wins: sessions materialize on novel writes only) and no NEW index is
 * needed (index #6/#7/#8 already cover the updated properties).
 *
 * conceptBody() is reused verbatim for the INCOMING's concept re-link: the
 * anchor var above is named "memory" (exactly what conceptBody references),
 * "name" comes from the forEach element and "project" is an outer param —
 * both resolve the same way they do inside saveMemory (verified comment in
 * conceptBody). `concepts` may be EMPTY (CONTRACT §0 probe A1).
 *
 * Returns ["updated", "memory"]: "memory" carries the anchored row (forget-
 * style presence read), "updated" the setProperty branch result.
 * ------------------------------------------------------------------ */

export const updateMemoryContentParams = defineParams({
  memoryId: param.string(),
  content: param.string(),
  embedding: param.array(param.f32()),
  dedupKey: param.string(),
  concepts: param.array(param.object()), // incoming's effective concepts — may be EMPTY
  project: param.string(), // outer param for conceptBody's Concept creation (same as saveMemory)
});

export function updateMemoryContent(): WriteBatch {
  return writeBatch()
    .varAs(
      "memory",
      g().nWithLabel(LABELS.Memory).where(Predicate.eqParam("memoryId", "memoryId")),
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
    .forEachParam("concepts", conceptBody())
    .returning(["updated", "memory"]);
}
