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
} from "../db/queries.js";
import { embed } from "./embed.js";
import { extractConcepts } from "./concepts.js";
import { contentHash, normalizeContent } from "./lifecycle.js";

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
  importance: number;
  concepts: string[];
}

export interface RememberResult {
  id: string;
  sessionId: string;
  project: string;
  concepts: string[];
  /** REQ-P1-6: true when an identical (normalized) memory already existed. */
  deduped: boolean;
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

  /** Dedup pre-check + insert. Runs while holding the dedup key's lock. */
  private async rememberLocked(input: RememberInput, dedupKey: string): Promise<RememberResult> {
    // 1. Pre-check. Errors PROPAGATE (fail closed: a broken lookup must
    //    never let a possible duplicate through to the write).
    const existing = await this.send(
      findMemoryByDedupKeyQuery().toQueryRequest(findMemoryByDedupKeyParams, { dedupKey }),
    );
    if (isRecord(existing)) {
      const rows = rowsOf(existing, ["memory"]);
      const hit = rows !== undefined ? toRecords(rows)[0] : undefined;
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
        };
      }
    }

    // 2. Miss — embed and insert.
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

    const response = await this.send(
      saveMemoryQuery().toQueryRequest(saveMemoryParams, {
        memoryId,
        content: input.content,
        project: input.project,
        sessionId: input.sessionId,
        embedding,
        origin: input.origin,
        importance: input.importance,
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
