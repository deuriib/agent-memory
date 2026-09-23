/**
 * MemoryStore (contract §3) + HelixStore over db/queries.ts (contract §2).
 *
 * Inter-lane contract surface: this module only relies on the FROZEN export
 * names and FROZEN param schemas from docs/CONTRACT.md §2. Parameters are
 * attached by the caller at request-build time (`toQueryRequest(defineParams,
 * values)`), so the param schemas below are declared here, per contract —
 * db/queries.ts only references them by name.
 *
 * Response rows are read defensively (preferred return-var names first, then
 * a first-array-of-records fallback; snake_case/$id key fallbacks per field):
 * only `saveMemory`'s `["memory", …]` return name is frozen by contract, so
 * every other return shape is treated as likely-but-unfrozen.
 */
import { randomUUID } from "node:crypto";
import {
  Client,
  defineParams,
  param,
  type PropertyValueInput,
  type QueryRequest,
} from "@helix-db/helix-db";
import {
  EMBED_DIM,
  findMemoryByDedupKey as findMemoryByDedupKeyQuery,
  findMemoryByDedupKeyParams,
  forgetMemory as forgetMemoryQuery,
  graphSearch as graphSearchQuery,
  healthCount as healthCountQuery,
  listSessions as listSessionsQuery,
  saveMemory as saveMemoryQuery,
  searchByText as searchByTextQuery,
  searchByVector as searchByVectorQuery,
  sessionMemories as sessionMemoriesQuery,
  updateMemoryContent as updateMemoryContentQuery,
  updateMemoryContentParams,
} from "../db/queries.js";
import { embed } from "./embed.js";
import { extractConcepts } from "./concepts.js";
import { deriveWriteImportance } from "./confidence.js";
import { jaccard, mergeThreshold, mergedContent } from "./consolidate.js";
import { contentHash, filterExpired, normalizeContent } from "./lifecycle.js";

const QUERY_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Param schemas — frozen names/types from contract §2                 */
/* ------------------------------------------------------------------ */

const saveMemoryParams = defineParams({
  memoryId: param.string(),
  content: param.string(),
  project: param.string(),
  sessionId: param.string(),
  embedding: param.array(param.f32()),
  origin: param.string(),
  importance: param.f64(),
  createdAt: param.dateTime(),
  concepts: param.array(param.object()),
  dedupKey: param.string(), // REQ-P1-6
});

const listSessionsParams = defineParams({
  project: param.string(),
  limit: param.i64(),
});

const sessionMemoriesParams = defineParams({
  sessionId: param.string(),
  project: param.string(),
  limit: param.i64(),
});

const searchByVectorParams = defineParams({
  queryVector: param.array(param.f32()),
  project: param.string(),
  k: param.i64(),
});

const searchByTextParams = defineParams({
  q: param.string(),
  project: param.string(),
  k: param.i64(),
});

const graphSearchParams = defineParams({
  concepts: param.array(param.string()),
  project: param.string(),
  k: param.i64(),
});

const forgetMemoryParams = defineParams({
  memoryId: param.string(),
});

const healthCountParams = defineParams({
  project: param.string(),
});

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface RememberInput {
  content: string;
  project: string;
  sessionId: string;
  origin: string;
  /**
   * REQ-P1-4: caller-supplied importance (0..1) — caller WINS when present.
   * Absent -> the store derives it at insert time from provenance (origin)
   * + the EFFECTIVE concept count actually stored (`deriveWriteImportance`).
   * Dedup/consolidation first-wins paths never derive: the existing row
   * keeps its ORIGINAL importance.
   */
  importance?: number;
  concepts: string[];
}

export interface RememberResult {
  id: string;
  sessionId: string;
  project: string;
  concepts: string[];
  /** REQ-P1-6: true when an identical (normalized) memory already existed. */
  deduped: boolean;
  /**
   * REQ-P1-2: true when the incoming text was merged into an EXISTING
   * near-duplicate survivor (tier-1 consolidation) — `id` is then the
   * SURVIVOR's memoryId. false on the exact-dedup hit and the plain insert
   * paths. Consolidated responses echo the REQUEST's sessionId/concepts
   * (contract §3 first-wins family, same as deduped); no Session node and no
   * BELONGS_TO link is written on merge — sessions materialize on novel
   * writes only.
   */
  consolidated: boolean;
}

/** Base memory row (session listings share it, without `score`). */
export interface MemoryRow {
  id: string;
  memoryId: string;
  content: string;
  sessionId: string;
  origin: string;
  importance: number;
  createdAt: string;
}

export interface SearchHit extends MemoryRow {
  /** Upstream score (BM25 `$score`); RRF overwrites it in fusion. */
  score: number;
  /**
   * Cosine distance to the query vector — set on vector hits only (lower is
   * closer). Vector rows are projected as `$distance`, NOT `$score`, so their
   * `score` stays 0 until RRF assigns one; reading `score` from a raw vector
   * hit always yields 0 — use `distance` to rank or display them.
   */
  distance?: number;
}

export interface SessionRow {
  sessionId: string;
  project: string;
  startedAt: string;
  updatedAt: string;
}

export interface HealthCounts {
  memories: number;
  sessions: number;
}

export interface VectorSearchInput {
  queryVector: number[];
  project: string;
  k: number;
}

export interface TextSearchInput {
  q: string;
  project: string;
  k: number;
}

export interface GraphSearchInput {
  concepts: string[];
  project: string;
  k: number;
}

export interface SessionListInput {
  project: string;
  limit: number;
}

export interface SessionMemoriesInput {
  sessionId: string;
  project: string;
  limit: number;
}

export interface MemoryStore {
  remember(input: RememberInput): Promise<RememberResult>;
  searchByVector(input: VectorSearchInput): Promise<SearchHit[]>;
  searchByText(input: TextSearchInput): Promise<SearchHit[]>;
  graphSearch(input: GraphSearchInput): Promise<SearchHit[]>;
  listSessions(input: SessionListInput): Promise<SessionRow[]>;
  sessionMemories(input: SessionMemoriesInput): Promise<MemoryRow[]>;
  /** true when the response indicates the node was deleted, false when not found. */
  forget(memoryId: string): Promise<boolean>;
  healthCounts(project: string): Promise<HealthCounts>;
}

/* ------------------------------------------------------------------ */
/* Response narrowing (cast-free: type predicates + runtime checks)     */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Preferred return-var names first; then first array-of-records fallback. */
function rowsOf(response: Record<string, unknown>, names: readonly string[]): unknown[] | undefined {
  for (const name of names) {
    const value = response[name];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value) && value.length > 0 && value.every((entry) => isRecord(entry))) {
      return value;
    }
  }
  return undefined;
}

function toRecords(rows: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (isRecord(row)) out.push(row);
  }
  return out;
}

function readString(row: Record<string, unknown>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
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

function missingShapeError(names: readonly string[], response: Record<string, unknown>): Error {
  const keys = Object.keys(response);
  return new Error(
    `helix response missing a result array (wanted one of: ${names.join(", ")}; got keys: ${keys.length > 0 ? keys.join(", ") : "none"})`,
  );
}

function hitsFrom(response: unknown, names: readonly string[]): SearchHit[] {
  if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
  const rows = rowsOf(response, names);
  if (rows === undefined) throw missingShapeError(names, response);
  return toRecords(rows).map(toSearchHit);
}

function toSearchHit(row: Record<string, unknown>): SearchHit {
  const memoryId = readString(row, ["memoryId", "memory_id"], "");
  const hit: SearchHit = {
    id: readString(row, ["id", "$id"], memoryId),
    memoryId,
    content: readString(row, ["content"], ""),
    sessionId: readString(row, ["sessionId", "session_id"], ""),
    origin: readString(row, ["origin"], ""),
    importance: readNumber(row, ["importance"], 0.5),
    createdAt: readString(row, ["createdAt", "created_at"], ""),
    score: readNumber(row, ["score", "$score"], 0),
  };
  // Vector rows project `$distance` (renamed to `distance`); text rows project
  // `$score` instead. Carry the distance through rather than dropping it —
  // without this every vector hit reads score 0 and is indistinguishable.
  const distance = readNumber(row, ["distance", "$distance"], Number.NaN);
  if (Number.isFinite(distance)) hit.distance = distance;
  return hit;
}

function toMemoryRow(row: Record<string, unknown>): MemoryRow {
  const hit = toSearchHit(row);
  return {
    id: hit.id,
    memoryId: hit.memoryId,
    content: hit.content,
    sessionId: hit.sessionId,
    origin: hit.origin,
    importance: hit.importance,
    createdAt: hit.createdAt,
  };
}

function toSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    sessionId: readString(row, ["sessionId", "session_id"], ""),
    project: readString(row, ["project"], ""),
    startedAt: readString(row, ["startedAt", "started_at", "createdAt"], ""),
    updatedAt: readString(row, ["updatedAt", "updated_at"], ""),
  };
}

/**
 * `forgetMemory()` has no frozen return var, so existence is inferred from
 * the response leaves: a returned row (even `$id: 0`), a positive count, or
 * `true` means deleted; `{}`, `[]`, `null`, `0`, `false` mean not found.
 */
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

function firstNumber(value: unknown, depth = 0): number | undefined {
  if (depth > 3) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstNumber(entry, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      const found = firstNumber(entry, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Locate a count by key-substring hint ("mem"… / "sess"…) at any depth. */
function findCountByHint(value: unknown, hint: string, depth = 0): number | undefined {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findCountByHint(entry, hint, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase().includes(hint)) {
      const direct = firstNumber(entry, 0);
      if (direct !== undefined) return direct;
    }
  }
  for (const entry of Object.values(value)) {
    const found = findCountByHint(entry, hint, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* HelixStore                                                          */
/* ------------------------------------------------------------------ */

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`helix query exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Return-var name preferences (only `["memory", …]` is frozen in §2). */
const SEARCH_ROW_NAMES = ["hits", "results", "rows", "memories"] as const;
const SESSIONS_ROW_NAMES = ["sessions", "results", "rows"] as const;
const MEMORIES_ROW_NAMES = ["memories", "hits", "results", "rows"] as const;

/**
 * REQ-P1-2: pick the tier-1 merge survivor from text-probe candidates
 * (highest Jaccard >= threshold first; ties by importance DESC, then
 * memoryId ASC with plain codepoint comparison — locale-free, fully
 * deterministic). Rows without a memoryId are skipped fail-closed: a merge
 * must never target a row whose id cannot be echoed or later forgotten.
 */
function pickSurvivor(
  incomingContent: string,
  candidates: readonly SearchHit[],
  threshold: number,
): SearchHit | undefined {
  let best: SearchHit | undefined;
  let bestJ = 0;
  for (const hit of candidates) {
    if (hit.memoryId === "") continue;
    const j = jaccard(incomingContent, hit.content);
    if (j < threshold) continue;
    if (best === undefined || j > bestJ) {
      best = hit;
      bestJ = j;
      continue;
    }
    if (j < bestJ) continue;
    if (hit.importance !== best.importance) {
      if (hit.importance > best.importance) {
        best = hit;
        bestJ = j;
      }
      continue;
    }
    if (hit.memoryId < best.memoryId) {
      best = hit;
      bestJ = j;
    }
  }
  return best;
}

export class HelixStore implements MemoryStore {
  private readonly client: Client;

  constructor(baseUrl: string = process.env["HELIX_URL"] ?? "http://localhost:6969") {
    this.client = Client.server(baseUrl);
  }

  private async send(request: QueryRequest): Promise<unknown> {
    return withTimeout(this.client.query<unknown>(request).send(), QUERY_TIMEOUT_MS);
  }

  /**
   * Per-dedupKey FIFO lock (REQ-P1-6).
   *
   * Probe3 proved Helix v0.0.6 does NOT enforce unique-equality constraints
   * (duplicate writes accepted — scripts/probe3.ts b2/d1): two truly
   * concurrent remember() calls with the same normalized content would both
   * pass a bare pre-check and write twice. Same-process writers are
   * therefore serialized per dedup key, in arrival order; the waiter re-runs
   * the pre-check after its predecessor settles and returns the existing id.
   * Ordering: one queue per key, FIFO by arrival; distinct keys never block
   * each other; a failed predecessor does not poison the queue (every tail
   * settles resolved). Known limit: SEPARATE processes are not serialized —
   * there is no server-side constraint (documented residual risk).
   */
  private readonly dedupTails = new Map<string, Promise<void>>();

  private async withDedupLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.dedupTails.get(key) ?? Promise.resolve();
    const result = previous.then(run);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.dedupTails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.dedupTails.get(key) === tail) this.dedupTails.delete(key);
    }
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    const dedupKey = contentHash(input.project, normalizeContent(input.content));
    return this.withDedupLock(dedupKey, () => this.rememberLocked(input, dedupKey));
  }

  /** Dedup pre-check -> near-dup consolidation -> insert. Runs while holding the dedup key's lock. */
  private async rememberLocked(input: RememberInput, dedupKey: string): Promise<RememberResult> {
    // 1. Pre-check. Errors PROPAGATE (fail closed: a broken lookup must
    //    never let a possible duplicate through to the write) — and SHAPE
    //    drift now throws too (remediation F1): a response that lacks the
    //    frozen `memory` return must not be read as a miss, or a duplicate
    //    would be silently written, contradicting contract §3 and the
    //    sibling `saveMemory` assert below. Observed live shapes:
    //    `{"memory":[row]}` = hit, `{"memory":[]}` / `{"memory":null}` =
    //    legitimate miss (proven against the dev instance) — those proceed.
    //    Genuine transport errors keep propagating from send() as before.
    const existing = await this.send(
      findMemoryByDedupKeyQuery().toQueryRequest(findMemoryByDedupKeyParams, { dedupKey }),
    );
    if (!isRecord(existing) || !Object.hasOwn(existing, "memory")) {
      throw new Error(
        "findMemoryByDedupKey response lacks the 'memory' return (contract §3 fail-closed: shape drift must never be read as a dedup miss)",
      );
    }
    const memoryReturn = existing["memory"];
    if (memoryReturn !== null && !Array.isArray(memoryReturn)) {
      throw new Error(
        `findMemoryByDedupKey 'memory' return has unexpected type ${typeof memoryReturn} (contract §3 fail-closed: shape drift must never be read as a dedup miss)`,
      );
    }
    const rows: unknown[] = memoryReturn ?? []; // null / [] = miss -> proceed
    const hit = toRecords(rows)[0];
    if (hit !== undefined) {
      // contentHash folds project into the key; this row check is the
      // fail-closed double check before handing back someone else's id.
      const hitProject = readString(hit, ["project"], "");
      if (hitProject !== input.project) {
        throw new Error(
          "dedup pre-check hit belongs to another project — contentHash(project) invariant violated" +
            (hitProject === "" ? " (row missing project)" : ""),
        );
      }
      const memoryId = readString(hit, ["memoryId"], "");
      if (memoryId === "") {
        throw new Error("dedup pre-check hit carried no memoryId");
      }
      return {
        id: memoryId,
        sessionId: input.sessionId, // echo the REQUEST (contract §3), not the stored row's
        project: input.project,
        concepts: [...input.concepts], // caller's as given — [] stays [], never re-derived
        deduped: true,
        consolidated: false, // exact dedup wins BEFORE consolidation is ever probed
      };
    }

    // 2. Near-duplicate consolidation (REQ-P1-2 tier-1, gate: probe4 verdict
    //    A — proven live that setProperty refreshes the text + vector
    //    indexes and unthrones the old content). Runs while STILL holding
    //    the incoming dedup key's FIFO lock. mergeThreshold() re-reads the
    //    env per call: absent -> 0.9, bad config -> undefined -> OFF
    //    (fail-closed: a broken AGENT_MEMORY_MERGE_JACCARD never invents a
    //    merge threshold). The text probe's errors PROPAGATE (same
    //    fail-closed posture as the dedup pre-check above: a broken lookup
    //    must never silently skip a merge). NOTE: the probe passes the
    //    incoming content VERBATIM as `q` (spec) — very large contents
    //    (up to 200k) make very large probe queries (documented residual).
    const threshold = mergeThreshold();
    if (threshold !== undefined) {
      const candidates = await this.searchByText({
        q: input.content,
        project: input.project,
        k: 20,
      });
      // RL-002: TTL-exact rows must never consolidate a LIVE write. Drop
      // expired candidates (every SearchHit carries createdAt) BEFORE the
      // jaccard loop — same filterExpired the read path uses — otherwise a
      // hidden, TTL-expired near-dup could absorb (and keep growing into)
      // content the user just saved. filterExpired re-reads the env per
      // call: absent/invalid TTL → OFF → every candidate kept (no change).
      const liveCandidates = filterExpired(candidates, Date.now());
      const survivor = pickSurvivor(input.content, liveCandidates, threshold);
      if (survivor !== undefined) {
        return this.consolidateInto(input, survivor);
      }
    }

    // 3. Miss — embed and insert.
    const embedding = embed(input.content);
    if (embedding.length !== EMBED_DIM) {
      throw new RangeError(`embed() produced ${embedding.length} dims, db/queries.ts declares ${EMBED_DIM}`);
    }
    const memoryId = randomUUID();
    const createdAt = new Date().toISOString(); // RFC3339 for param.dateTime()
    // REQ-P1-3: derive a default topic list ONLY when the caller passed none —
    // explicit concepts win verbatim (contract §3 echo is preserved below).
    const effectiveConcepts =
      input.concepts.length > 0 ? [...input.concepts] : extractConcepts(input.content);
    const concepts: Record<string, PropertyValueInput>[] = effectiveConcepts.map((name) => ({ name }));
    // REQ-P1-4: caller-supplied importance wins; absent -> derive from
    // provenance (origin) + the EFFECTIVE concept count stored above. The
    // old flat 0.5 server default is gone (server/mcp pass the raw optional).
    const effectiveImportance =
      input.importance ?? deriveWriteImportance(input.origin, effectiveConcepts.length);

    const response = await this.send(
      saveMemoryQuery().toQueryRequest(saveMemoryParams, {
        memoryId,
        content: input.content,
        project: input.project,
        sessionId: input.sessionId,
        embedding,
        origin: input.origin,
        importance: effectiveImportance,
        createdAt,
        concepts,
        dedupKey,
      }),
    );

    // Contract §2: saveMemory returns must include ["memory", …] — assert it,
    // so a silent no-op write can never masquerade as success.
    if (!isRecord(response) || !Object.hasOwn(response, "memory")) {
      throw new Error("saveMemory response did not include the 'memory' return (contract §2)");
    }

    return {
      id: memoryId,
      sessionId: input.sessionId,
      project: input.project,
      concepts: effectiveConcepts, // echo what was actually stored (derived or caller's)
      deduped: false,
      consolidated: false, // plain insert — no near-duplicate matched
    };
  }

  /**
   * REQ-P1-2 tier-1 merge: rewrite the SURVIVOR in place via
   * updateMemoryContent (probe4 verdict A: setProperty refreshes text +
   * vector indexes live on this instance). Runs under the incoming dedup
   * key's FIFO lock; NO Session node and NO BELONGS_TO link is written
   * (sessions materialize on novel writes only, contract §3), and the
   * survivor's id / origin / importance / createdAt are untouched
   * (dedup-first-wins semantics carry over to consolidation).
   *
   * Substring guard first (mergedContent): when the incoming's normalized
   * text is already contained in the survivor's, nothing can grow — return
   * the survivor WITHOUT a write (closes the re-merge loop). Otherwise the
   * survivor's content only ever GROWS (survivor + "\n" + incoming, no text
   * dropped), re-embedded and re-keyed:
   *   - embedding: fresh embed(nextContent) so the vector index serves the
   *     merged text (EMBED_DIM asserted, mirroring the insert path);
   *   - dedupKey: contentHash(project, normalize(nextContent)) so a LATER
   *     re-save of the concatenated text hits exact dedup (verify P);
   *   - concepts: the incoming's EFFECTIVE list (explicit wins verbatim,
   *     else derived from the incoming content — same rule as insert),
   *     linked from the survivor node by conceptBody().
   *
   * The response echoes the REQUEST's sessionId/concepts (first-wins
   * family). Fail-closed asserts mirror saveMemory/forget: missing returns,
   * an empty anchor (survivor vanished mid-merge — probe3 proved the server
   * enforces nothing app-side), or an empty 'updated' branch THROW rather
   * than letting a silent no-op masquerade as a merge.
   *
   * Known limits (documented): the lock serializes only writes of the SAME
   * incoming content — two CONCURRENT saves of different variants that pick
   * the same survivor can lose one append (no cross-key lock exists; the
   * plan scopes serialization to the existing per-key FIFO).
   */
  private async consolidateInto(input: RememberInput, survivor: SearchHit): Promise<RememberResult> {
    const nextContent = mergedContent(survivor.content, input.content);
    if (nextContent === survivor.content) {
      // Substring guard hit: the survivor already holds BOTH texts.
      return {
        id: survivor.memoryId,
        sessionId: input.sessionId, // echo the REQUEST (contract §3)
        project: input.project,
        concepts: [...input.concepts], // request as given — first-wins family
        deduped: false, // this was a NEAR-dup merge, not an exact-dedup hit
        consolidated: true,
      };
    }

    const embedding = embed(nextContent);
    if (embedding.length !== EMBED_DIM) {
      throw new RangeError(`embed() produced ${embedding.length} dims, db/queries.ts declares ${EMBED_DIM}`);
    }
    // Effective concepts follow the insert rule (explicit wins, else derive
    // from the INCOMING content); they are what gets LINKED onto the
    // survivor, while the response echoes the request (see docstring).
    const effectiveConcepts =
      input.concepts.length > 0 ? [...input.concepts] : extractConcepts(input.content);
    const concepts: Record<string, PropertyValueInput>[] = effectiveConcepts.map((name) => ({ name }));

    const response = await this.send(
      updateMemoryContentQuery().toQueryRequest(updateMemoryContentParams, {
        memoryId: survivor.memoryId,
        content: nextContent,
        embedding,
        dedupKey: contentHash(input.project, normalizeContent(nextContent)),
        concepts,
        project: input.project,
      }),
    );

    // Probe4 calibrated the live shape: {memory: [anchored row],
    // updated: [setProperty row]} on success; an empty anchor or an empty
    // 'updated' branch means the merge did NOT happen — throw fail-closed
    // (contract §2 posture; never report a merge that wrote nothing).
    if (!isRecord(response) || !Object.hasOwn(response, "memory") || !Object.hasOwn(response, "updated")) {
      throw new Error(
        "updateMemoryContent response did not include the 'memory' and 'updated' returns (contract §2 fail-closed: a silent no-op must never masquerade as a merge)",
      );
    }
    const anchor = response["memory"];
    if (!Array.isArray(anchor) || anchor.length === 0) {
      throw new Error(
        "updateMemoryContent anchored no Memory row — survivor vanished mid-merge (contract §2 fail-closed)",
      );
    }
    if (!indicatesPresence(response["updated"])) {
      throw new Error(
        "updateMemoryContent 'updated' branch was empty — setProperty did not run (contract §2 fail-closed)",
      );
    }

    return {
      id: survivor.memoryId, // the SURVIVOR's id — no new row was created
      sessionId: input.sessionId, // echo the REQUEST (contract §3)
      project: input.project,
      concepts: [...input.concepts], // request as given — first-wins family
      deduped: false,
      consolidated: true,
    };
  }

  async searchByVector(input: VectorSearchInput): Promise<SearchHit[]> {
    if (input.queryVector.length !== EMBED_DIM) {
      throw new RangeError(`queryVector must have ${EMBED_DIM} dimensions, got ${input.queryVector.length}`);
    }
    const response = await this.send(
      searchByVectorQuery().toQueryRequest(searchByVectorParams, {
        queryVector: input.queryVector,
        project: input.project,
        k: input.k,
      }),
    );
    return hitsFrom(response, SEARCH_ROW_NAMES);
  }

  async searchByText(input: TextSearchInput): Promise<SearchHit[]> {
    const response = await this.send(
      searchByTextQuery().toQueryRequest(searchByTextParams, {
        q: input.q,
        project: input.project,
        k: input.k,
      }),
    );
    return hitsFrom(response, SEARCH_ROW_NAMES);
  }

  async graphSearch(input: GraphSearchInput): Promise<SearchHit[]> {
    const response = await this.send(
      graphSearchQuery().toQueryRequest(graphSearchParams, {
        concepts: input.concepts,
        project: input.project,
        k: input.k,
      }),
    );
    return hitsFrom(response, SEARCH_ROW_NAMES);
  }

  async listSessions(input: SessionListInput): Promise<SessionRow[]> {
    const response = await this.send(
      listSessionsQuery().toQueryRequest(listSessionsParams, {
        project: input.project,
        limit: input.limit,
      }),
    );
    if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
    const rows = rowsOf(response, SESSIONS_ROW_NAMES);
    if (rows === undefined) throw missingShapeError(SESSIONS_ROW_NAMES, response);
    return toRecords(rows).map(toSessionRow);
  }

  async sessionMemories(input: SessionMemoriesInput): Promise<MemoryRow[]> {
    const response = await this.send(
      sessionMemoriesQuery().toQueryRequest(sessionMemoriesParams, {
        sessionId: input.sessionId,
        project: input.project,
        limit: input.limit,
      }),
    );
    if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
    const rows = rowsOf(response, MEMORIES_ROW_NAMES);
    if (rows === undefined) throw missingShapeError(MEMORIES_ROW_NAMES, response);
    return toRecords(rows).map(toMemoryRow);
  }

  async forget(memoryId: string): Promise<boolean> {
    const response = await this.send(
      forgetMemoryQuery().toQueryRequest(forgetMemoryParams, { memoryId }),
    );
    return indicatesPresence(response);
  }

  async healthCounts(project: string): Promise<HealthCounts> {
    const response = await this.send(
      healthCountQuery().toQueryRequest(healthCountParams, { project }),
    );
    if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
    const memories = findCountByHint(response, "mem");
    const sessions = findCountByHint(response, "sess");
    if (memories === undefined || sessions === undefined) {
      const keys = Object.keys(response);
      throw new Error(
        `healthCount response missing counts (keys: ${keys.length > 0 ? keys.join(", ") : "none"})`,
      );
    }
    return { memories, sessions };
  }
}

/** Shared factory: REST server and MCP server build the same store. */
export function createDefaultStore(): MemoryStore {
  return new HelixStore();
}
