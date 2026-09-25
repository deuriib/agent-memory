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
  deleteTodo as deleteTodoQuery,
  deleteTodoParams,
  distillNote as distillNoteQuery,
  distillNoteParams,
  findMemoryByDedupKey as findMemoryByDedupKeyQuery,
  findMemoryByDedupKeyParams,
  forgetMemory as forgetMemoryQuery,
  forgetNote as forgetNoteQuery,
  forgetNoteParams,
  getMemoryById as getMemoryByIdQuery,
  getMemoryByIdParams,
  getNoteById as getNoteByIdQuery,
  getNoteByIdParams,
  getTodoById as getTodoByIdQuery,
  getTodoByIdParams,
  graphSearch as graphSearchQuery,
  graphSearchNotes as graphSearchNotesQuery,
  graphSearchNotesParams,
  healthCount as healthCountQuery,
  linkMemoryConcepts as linkMemoryConceptsQuery,
  linkMemoryConceptsParams,
  linkNotes as linkNotesQuery,
  linkNotesParams,

  listNotes as listNotesQuery,
  listNotesParams,
  listNotesByCategory as listNotesByCategoryQuery,
  listNotesByCategoryParams,
  listSessions as listSessionsQuery,
  listTodos as listTodosQuery,
  listTodosParams,
  memoryConcepts as memoryConceptsQuery,
  memoryConceptsParams,
  moveNote as moveNoteQuery,
  moveNoteParams,
  saveMemory as saveMemoryQuery,
  saveNote as saveNoteQuery,
  saveNoteParams,
  saveTodo as saveTodoQuery,
  saveTodoParams,
  searchByText as searchByTextQuery,
  searchByVector as searchByVectorQuery,
  searchNotesByText as searchNotesByTextQuery,
  searchNotesByVector as searchNotesByVectorQuery,
  searchTodosByText as searchTodosByTextQuery,
  searchTodosByTextParams,
  sessionMemories as sessionMemoriesQuery,
  traverseNoteGraph as traverseNoteGraphQuery,
  traverseNoteGraphParams,
  updateMemoryContent as updateMemoryContentQuery,
  updateMemoryContentParams,
  updateTodo as updateTodoQuery,
  updateTodoParams,
} from "../db/queries.js";
import { embed } from "./embed.js";
import { extractConcepts } from "./concepts.js";
import { deriveWriteImportance } from "./confidence.js";
import { jaccard, mergeThreshold, mergedContent, missingConcepts } from "./consolidate.js";
import { contentHash, filterExpired, normalizeContent } from "./lifecycle.js";
import { oneLine } from "./logline.js";

const QUERY_TIMEOUT_MS = 15_000;

/** Non-empty env read: unset or empty -> undefined (never logs values). */
function readNonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Helix endpoint resolution (REQ-BRAINY-OPS-02, RL-002 re-scoped per
 * orchestrator arbitration 2026-09-25).
 *
 * `HELIX_URL` is the ONLY env read here: SPEC-003 §4.3 declares it with
 * "(no rename)", and ARCH §3 + README env table + `bin/brainy.mjs`
 * `restBaseUrl` define `BRAINY_URL` as the REST URL
 * (`http://127.0.0.1:R(N)`). This function builds a Helix client
 * (`Client.server` below), so it must resolve the Helix endpoint — reading
 * REST-semantics vars (`BRAINY_URL` / `AGENT_MEMORY_URL`) here pointed the
 * store at `<rest>/v2/query` (404 → 500 on every write), the exact
 * regression commit `b91821a` introduced: every spawned child receives BOTH
 * vars (`bin/brainy.mjs` serverEnv), so a `BRAINY_URL`-first read always
 * loses to the REST port. No REST fallback is permissible: when `HELIX_URL`
 * is unset/empty, fail toward the correct local-dev default
 * (`http://localhost:6969`), never toward a wrong port. Canonical-first
 * (`BRAINY_URL` > `AGENT_MEMORY_URL`) still applies where the variable's
 * canonical meaning matches the consumer — i.e. REST clients
 * (`bin/brainy.mjs:462` restBaseUrl) — not here.
 * Exported pure-with-env-param for testability. Values never logged.
 */
export function resolveStoreUrl(env: NodeJS.ProcessEnv = process.env): string {
  return readNonEmptyEnv(env, "HELIX_URL") ?? "http://localhost:6969";
}

/**
 * Reset hook kept for test-file import compat — resolution is now
 * warning-free (single-source `HELIX_URL`, no aliases), so this is a no-op.
 */
export function _resetStoreUrlWarningState(): void {}

/* ------------------------------------------------------------------ */
/* REQ-F-01 embedding verify helpers (internal — never surfaced)       */
/* ------------------------------------------------------------------ */

/**
 * Element-wise embedding equality for the post-write verify. The stored
 * vector round-trips through f32, so each expected element is compared
 * against `Math.fround(expected[i])` with a 1e-6 tolerance. Invalid shape
 * (non-array, wrong dims, non-finite element) is a mismatch — the caller
 * reports a violated invariant (fail-closed), never a silent pass.
 *
 * Plan Q1: a dot-product fallback is DIAGNOSTIC only and deliberately NOT
 * a pass path — any element beyond tolerance returns false.
 */
function embeddingsEqual(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  if (!Array.isArray(actual) || actual.length !== EMBED_DIM) return false;
  if (actual.length !== expected.length) return false;
  for (const value of actual) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
  }
  for (const value of expected) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
  }
  // Diagnostic-only (kept for debugging, never a pass condition):
  //   dot = Σ actual[i]*expected[i]  →  report when 1 - cos < 1 - 1e-6.
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i] as number;
    const e = Math.fround(expected[i] as number);
    if (Math.abs(a - e) > 1e-6) return false;
  }
  return true;
}

/** `readString` analogue for the verify-only embedding vector. */
function readEmbeddingVector(row: Record<string, unknown>): readonly number[] | undefined {
  const value = row["embedding"];
  if (!Array.isArray(value) || value.length !== EMBED_DIM) return undefined;
  for (const element of value) {
    if (typeof element !== "number" || !Number.isFinite(element)) return undefined;
  }
  return value;
}

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

/**
 * REQ-RL-001: the subset of a Memory row the consolidation path needs from a
 * FRESH `getMemoryById` re-read taken under the per-survivor lock — content
 * (merge base), createdAt (TTL re-check) and, for REQ-F-01's post-write
 * verify, the committed `dedupKey`. `project` is
 * enforced in the query's where-clause rather than projected, so it needs no
 * field here; a missing createdAt reads as "" and filterExpired keeps the row
 * (the same documented fail-toward-keeping rule any unparseable timestamp has).
 */
interface FreshSurvivorRow {
  memoryId: string;
  content: string;
  createdAt: string;
  /** REQ-F-01: absent on legacy rows reads as "" — see getFreshSurvivor. */
  dedupKey: string;
  /**
   * REQ-F-01: committed embedding, read via the sanctioned getMemoryById
   * internal projection so the post-write verify can compare it. Missing /
   * malformed reads as undefined and the embedding invariant treats that as
   * a VIOLATION (fail-closed) — not a silent pass.
   */
  embedding?: readonly number[] | undefined;
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

export type TodoPriority = "low" | "medium" | "high";
export type TodoStatus = "pending" | "active" | "done" | "blocked";

export interface TodoRow {
  id: string;
  todoId: string;
  title: string;
  description: string;
  priority: TodoPriority;
  status: TodoStatus;
  project: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  parentId?: string;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: TodoPriority;
  status?: TodoStatus;
  project: string;
  sessionId?: string;
  parentId?: string;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  priority?: TodoPriority;
  status?: TodoStatus;
  parentId?: string | null;
}

export interface ListTodosInput {
  project: string;
  limit: number;
  status?: TodoStatus;
  priority?: TodoPriority;
  search?: string;
  frontier?: boolean;
  parentId?: string;
}

export type ParaCategory = "project" | "area" | "resource" | "archive";

export interface NoteRow {
  id: string;
  noteId: string;
  title: string;
  content: string;
  project: string;
  sessionId?: string;
  paraCategory: ParaCategory;
  origin?: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  dedupKey?: string;
}

export interface ProjectRow {
  name: string;
  description?: string;
  deadline?: string;
}

export interface AreaRow {
  name: string;
  description?: string;
}

export interface ResourceRow {
  name: string;
  category?: string;
}

export interface ArchiveRow {
  name: string;
  archivedAt?: string;
}

export interface ParaClassificationResult {
  category: ParaCategory;
  target: string;
  confidence: number;
  reason: string;
}

export interface SaveNoteInput {
  title: string;
  content: string;
  project?: string;
  sessionId?: string;
  paraCategory?: ParaCategory;
  paraTarget?: string;
  tags?: string[];
  origin?: string;
}

export interface SaveNoteResult {
  id: string;
  project: string;
  paraCategory: ParaCategory;
  paraTarget: string;
  deduped: boolean;
  relatedNoteIds: string[];
}

export interface ListNotesInput {
  project: string;
  limit?: number;
  category?: ParaCategory;
  tag?: string;
}

export interface GetNoteResult {
  note: NoteRow;
  para: {
    category: ParaCategory;
    name: string;
  };
  supersedes: Array<{ id: string; title: string }>;
  supersededBy?: { id: string; title: string };
  relatesTo: Array<{ id: string; title: string }>;
}

export interface MoveNoteInput {
  id: string;
  project: string;
  toCategory: ParaCategory;
  toTarget?: string;
}

export interface DistillNoteInput {
  id: string;
  project: string;
  summary?: string;
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
  // Todos — follow-ups: decisions to revisit, files to inspect, tasks blocked on input
  createTodo(input: CreateTodoInput): Promise<TodoRow>;
  listTodos(input: ListTodosInput): Promise<TodoRow[]>;
  getTodo(todoId: string): Promise<TodoRow | undefined>;
  updateTodo(todoId: string, patch: UpdateTodoInput): Promise<TodoRow | undefined>;
  deleteTodo(todoId: string): Promise<boolean>;
  frontierTodos(input: { project: string; limit: number }): Promise<TodoRow[]>;
  // Brainy v1 Note & PARA methods (optional on base MemoryStore for test stub compat, mandatory on BrainyStore)
  saveNote?(input: SaveNoteInput): Promise<SaveNoteResult>;
  listNotes?(input: ListNotesInput): Promise<NoteRow[]>;
  getNoteById?(id: string, project?: string): Promise<GetNoteResult | undefined>;
  moveNote?(input: MoveNoteInput): Promise<boolean>;
  distillNote?(input: DistillNoteInput): Promise<NoteRow>;
  forgetNote?(id: string, project?: string): Promise<boolean>;
  classifyPara?(title: string, content: string, tags?: string[]): ParaClassificationResult;
  searchNotesByVector?(input: VectorSearchInput): Promise<SearchHit[]>;
  searchNotesByText?(input: TextSearchInput): Promise<SearchHit[]>;
  graphSearchNotes?(input: GraphSearchInput): Promise<SearchHit[]>;
  traverseNoteGraph?(noteId: string, project: string, limit?: number): Promise<{
    references: NoteRow[];
    relates: NoteRow[];
    belongsTo: Array<{ id: string; name: string }>;
  }>;
  linkNodes?(input: { fromId: string; toId: string; type: "REFERENCES" | "BELONGS_TO" | "RELATES_TO"; project?: string }): Promise<boolean>;
}

export interface BrainyStore extends MemoryStore {
  saveNote(input: SaveNoteInput): Promise<SaveNoteResult>;
  listNotes(input: ListNotesInput): Promise<NoteRow[]>;
  getNoteById(id: string, project?: string): Promise<GetNoteResult | undefined>;
  moveNote(input: MoveNoteInput): Promise<boolean>;
  distillNote(input: DistillNoteInput): Promise<NoteRow>;
  forgetNote(id: string, project?: string): Promise<boolean>;
  classifyPara(title: string, content: string, tags?: string[]): ParaClassificationResult;
  searchNotesByVector(input: VectorSearchInput): Promise<SearchHit[]>;
  searchNotesByText(input: TextSearchInput): Promise<SearchHit[]>;
  graphSearchNotes(input: GraphSearchInput): Promise<SearchHit[]>;
  traverseNoteGraph(noteId: string, project: string, limit?: number): Promise<{
    references: NoteRow[];
    relates: NoteRow[];
    belongsTo: Array<{ id: string; name: string }>;
  }>;
  linkNodes(input: { fromId: string; toId: string; type: "REFERENCES" | "BELONGS_TO" | "RELATES_TO"; project?: string }): Promise<boolean>;
}


export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

export function classifyPara(
  title: string,
  content: string,
  tags: string[] = [],
): ParaClassificationResult {
  const normalizedTags = tags.map((t) => t.toLowerCase().trim());

  // Explicit tag check first
  if (normalizedTags.includes("project")) {
    return { category: "project", target: title.trim() || "Project", confidence: 1.0, reason: "tag:project" };
  }
  if (normalizedTags.includes("area")) {
    return { category: "area", target: title.trim() || "Area", confidence: 1.0, reason: "tag:area" };
  }
  if (normalizedTags.includes("archive")) {
    return { category: "archive", target: title.trim() || "Archive", confidence: 1.0, reason: "tag:archive" };
  }
  if (normalizedTags.includes("resource")) {
    return { category: "resource", target: "inbox", confidence: 1.0, reason: "tag:resource" };
  }

  const combined = `${title} ${content}`.toLowerCase();

  // Archive check
  const archiveKeywords = [
    "archive", "archived", "deprecated", "legacy", "completed", "historical", "obsolete", "retired", "inactive",
  ];
  if (archiveKeywords.some((kw) => combined.includes(kw))) {
    return { category: "archive", target: title.trim() || "Archive", confidence: 0.9, reason: "keyword:archive" };
  }

  // Project check: deadline, deliverable, sprint, release, milestone, launch, ship
  const projectKeywords = [
    "deadline", "sprint", "milestone", "deliverable", "launch", "release", "ship", "roadmap", "task", "spec",
  ];
  if (projectKeywords.some((kw) => combined.includes(kw))) {
    return { category: "project", target: title.trim() || "Project", confidence: 0.85, reason: "keyword:project" };
  }

  // Area check: health, routine, standard, maintenance, finance, career, habits
  const areaKeywords = [
    "health", "finance", "habits", "routine", "maintenance", "standards", "compliance", "career", "workout", "gym",
  ];
  if (areaKeywords.some((kw) => combined.includes(kw))) {
    return { category: "area", target: title.trim() || "Area", confidence: 0.85, reason: "keyword:area" };
  }

  // Resource check: guide, cheat sheet, reference, docs, tutorial, handbook
  const resourceKeywords = [
    "reference", "guide", "cheat sheet", "handbook", "tutorial", "docs", "documentation", "book", "article",
  ];
  if (resourceKeywords.some((kw) => combined.includes(kw))) {
    return { category: "resource", target: "inbox", confidence: 0.8, reason: "keyword:resource" };
  }

  // Default fallback
  return {
    category: "resource",
    target: "inbox",
    confidence: 0.5,
    reason: "default:inbox",
  };
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

const TODO_ROW_NAMES = ["todos", "hits", "results", "rows"] as const;

function priorityRank(p: string): number {
  if (p === "high") return 3;
  if (p === "medium") return 2;
  return 1; // low or unknown
}

function toTodoRow(row: Record<string, unknown>): TodoRow {
  const todoId = readString(row, ["todoId", "todo_id"], "");
  const priorityRaw = readString(row, ["priority"], "medium").toLowerCase();
  const statusRaw = readString(row, ["status"], "pending").toLowerCase();
  const priority: TodoPriority = priorityRaw === "high" ? "high" : priorityRaw === "low" ? "low" : "medium";
  const status: TodoStatus =
    statusRaw === "active" ? "active" : statusRaw === "done" ? "done" : statusRaw === "blocked" ? "blocked" : "pending";
  const parentRaw = readString(row, ["parentId", "parent_id"], "");
  return {
    id: readString(row, ["id", "$id"], todoId),
    todoId,
    title: readString(row, ["title"], ""),
    description: readString(row, ["description"], ""),
    priority,
    status,
    project: readString(row, ["project"], ""),
    sessionId: readString(row, ["sessionId", "session_id"], ""),
    createdAt: readString(row, ["createdAt", "created_at"], ""),
    updatedAt: readString(row, ["updatedAt", "updated_at"], ""),
    parentId: parentRaw !== "" ? parentRaw : undefined,
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

export class HelixStore implements BrainyStore {
  private readonly client: Client;

  constructor(baseUrl?: string) {
    this.client = Client.server(
      typeof baseUrl === "string" && baseUrl.length > 0 ? baseUrl : resolveStoreUrl(),
    );
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
   *
   * REQ-RL-001: this lock alone serializes IDENTICAL incoming content only —
   * two DISTINCT variants carry two keys and would both merge against the
   * same survivor concurrently, so consolidation additionally serializes
   * per SURVIVOR via `survivorTails`/`withSurvivorLock` below. LOCK ORDER is
   * always dedupKey (OUTER, acquired in `remember`) → survivor (INNER,
   * acquired only inside `consolidateInto`, while the outer lock is held):
   * one survivor per merge (a call never holds two survivor locks) and no
   * path ever acquires a dedupKey lock while holding a survivor lock, so the
   * order is a fixed acyclic chain — no multi-lock deadlock is possible.
   */
  private readonly dedupTails = new Map<string, Promise<void>>();

  /** REQ-RL-001: per-SURVIVOR FIFO tails — one merge at a time per survivor. */
  private readonly survivorTails = new Map<string, Promise<void>>();

  /**
   * Shared FIFO queue over `tails` (one entry per key, FIFO by arrival; a
   * failed predecessor does not poison the queue — every tail settles
   * resolved; the entry is deleted once its own tail is still the head).
   * `withDedupLock` and `withSurvivorLock` are the two typed fronts; see the
   * lock-ordering contract on `dedupTails` above.
   */
  private async withFifoLock<T>(
    tails: Map<string, Promise<void>>,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(run);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  }

  private async withDedupLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    return this.withFifoLock(this.dedupTails, key, run);
  }

  /** REQ-RL-001 inner lock — see the lock-ordering contract on `dedupTails`. */
  private async withSurvivorLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    return this.withFifoLock(this.survivorTails, key, run);
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
        // REQ-RL-001: the merge runs under the SURVIVOR's FIFO lock (inner)
        // with a FRESH re-read inside it. undefined = the survivor expired
        // while waiting for that lock (never absorbs a fresh write) -> fall
        // through to the plain insert below.
        const merged = await this.consolidateInto(input, survivor);
        if (merged !== undefined) return merged;
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
   * REQ-P1-2 tier-1 merge, now under REQ-RL-001's per-SURVIVOR FIFO lock:
   * rewrite the SURVIVOR in place via updateMemoryContent (probe4 verdict A:
   * setProperty refreshes text + vector indexes live on this instance).
   * Lock order: rememberLocked already holds the incoming dedupKey's FIFO
   * lock; this adds the SURVIVOR's lock inside it (ordering contract on
   * `dedupTails`), so concurrent saves of DISTINCT variants that pick the
   * same survivor serialize here instead of losing one append (the old
   * defect — see ROADMAP RL-001). Under that lock the row is RE-READ fresh
   * (a waiter's probe snapshot may be stale; merging over stale content
   * would silently drop the predecessor's append), TTL is re-checked
   * against the fresh row (an expired-while-queued survivor falls through
   * to a plain insert — never absorbs a fresh write), and only then does
   * the merge below run. NO Session node and NO BELONGS_TO link is written
   * (sessions materialize on novel writes only, contract §3), and the
   * survivor's id / origin / importance / createdAt are untouched
   * (dedup-first-wins semantics carry over to consolidation).
   *
   * Substring guard first (mergedContent): when the incoming's normalized
   * text is already contained in the FRESH survivor's, nothing can grow —
   * content / embedding / dedupKey stay byte-identical (the re-merge loop
   * stays closed) BUT the guard no longer returns blind: it runs the
   * concept-link verify + link-only heal (`ensureConceptLinks` — a
   * `memoryConcepts` read, possibly a `linkMemoryConcepts` write) before
   * returning the survivor.
   * Otherwise the survivor's content only ever GROWS (survivor + "\n" +
   * incoming, no text dropped), re-embedded and re-keyed:
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
   * than letting a silent no-op masquerade as a merge; the fresh read
   * itself throws on shape drift / miss / wrong row / bad content
   * (getFreshSurvivor).
   *
   * Known limits (documented): the survivor lock serializes SAME-PROCESS
   * writers only — contract §3's single-writer assumption still holds;
   * cross-process writers to one Helix instance remain out of contract
   * (residual risk, owner engineering, ROADMAP P4.3).
   */
  private async consolidateInto(
    input: RememberInput,
    survivor: SearchHit,
  ): Promise<RememberResult | undefined> {
    return this.withSurvivorLock(survivor.memoryId, () =>
      this.mergeUnderSurvivorLock(input, survivor),
    );
  }

  /** Merge body under the survivor's FIFO lock — see consolidateInto. */
  private async mergeUnderSurvivorLock(
    input: RememberInput,
    survivor: SearchHit,
  ): Promise<RememberResult | undefined> {
    const fresh = await this.getFreshSurvivor(survivor.memoryId, input.project);
    const [kept] = filterExpired([fresh], Date.now());
    if (kept === undefined) {
      // Expired while queued behind the survivor lock (REQ-RL-002): return
      // undefined so rememberLocked falls through to the plain insert —
      // a fresh write must never be absorbed by an expired row.
      return undefined;
    }
    const nextContent = mergedContent(fresh.content, input.content);
    if (nextContent === fresh.content) {
      // Substring guard hit: the fresh survivor already holds BOTH texts —
      // content is deliberately NOT rewritten (byte-identical survivor).
      // REQ-F-01: the guard must no longer return without reading: a
      // re-save carrying NEW explicit concepts (or an earlier batch that
      // lost the incoming's links) still has to link them, so this path
      // now runs the concept-link verify + link-only heal below — while
      // keeping the response echo (consolidated / survivor id / REQUEST
      // concepts) exactly as before.
      const guardConcepts =
        input.concepts.length > 0 ? [...input.concepts] : extractConcepts(input.content);
      await this.ensureConceptLinks(survivor.memoryId, input.project, guardConcepts);
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

    const nextDedup = contentHash(input.project, normalizeContent(nextContent));
    const mergedWrite = {
      memoryId: survivor.memoryId,
      content: nextContent,
      embedding,
      dedupKey: nextDedup,
      concepts,
      project: input.project,
    };
    await this.sendMergedUpdate(mergedWrite);

    // REQ-F-01: post-write verify + ONE heal (contract §3 tier-1 (b) — the
    // concept links ride this same writeBatch with no return var and
    // mid-batch atomicity is an ENGINE ASSUMPTION, not a verified fact).
    // Runs BEFORE the response is returned, still under the survivor lock,
    // so no same-process writer can interleave between write and verify.
    await this.verifyMergedState({
      memoryId: survivor.memoryId,
      project: input.project,
      expectedContent: nextContent,
      expectedDedupKey: nextDedup,
      expectedConcepts: effectiveConcepts,
      expectedEmbedding: embedding,
      retryWrite: () => this.sendMergedUpdate(mergedWrite),
    });

    return {
      id: survivor.memoryId, // the SURVIVOR's id — no new row was created
      sessionId: input.sessionId, // echo the REQUEST (contract §3)
      project: input.project,
      concepts: [...input.concepts], // request as given — first-wins family
      deduped: false,
      consolidated: true,
    };
  }

  /**
   * REQ-RL-001 fail-closed fresh survivor re-read (getMemoryById): taken
   * UNDER the per-survivor lock so the merge always works against the row
   * as it is NOW, not as the probe snapshot saw it. Shape drift (missing
   * 'memory' return — same posture as the dedup pre-check), a miss (the
   * survivor vanished between probe and lock: probe3 proved the server
   * enforces nothing app-side, so an absent row must never be merged
   * onto), a row whose memoryId is not the one asked for, or non-string
   * content all THROW — fail-closed, never a silent skip or a merge over
   * untrusted data. `project` is enforced in the query's where-clause
   * (the query refuses rows outside the caller's project), so no
   * caller-side project assert is needed here.
   */
  private async getFreshSurvivor(memoryId: string, project: string): Promise<FreshSurvivorRow> {
    const response = await this.send(
      getMemoryByIdQuery().toQueryRequest(getMemoryByIdParams, { memoryId, project }),
    );
    if (!isRecord(response) || !Object.hasOwn(response, "memory")) {
      throw new Error(
        "getMemoryById response did not include the 'memory' return (contract §2 fail-closed: shape drift must never be read as a survivor re-read)",
      );
    }
    const memoryReturn = response["memory"];
    if (memoryReturn !== null && !Array.isArray(memoryReturn)) {
      throw new Error(
        `getMemoryById 'memory' return has unexpected type ${typeof memoryReturn} (contract §2 fail-closed: shape drift must never be read as a survivor re-read)`,
      );
    }
    const row = toRecords(memoryReturn ?? [])[0];
    if (row === undefined) {
      throw new Error(
        `REQ-RL-001: survivor ${memoryId} vanished between probe and merge lock (fail-closed — an absent row must never be merged onto)`,
      );
    }
    const freshMemoryId = readString(row, ["memoryId", "memory_id"], "");
    if (freshMemoryId !== memoryId) {
      throw new Error(
        `REQ-RL-001: fresh re-read returned ${
          freshMemoryId === "" ? "a row with no memoryId" : `row ${freshMemoryId}`
        } when asked for survivor ${memoryId} (fail-closed)`,
      );
    }
    const content = row["content"];
    if (typeof content !== "string") {
      throw new Error(
        `REQ-RL-001: fresh re-read row ${memoryId} has ${typeof content} content (fail-closed)`,
      );
    }
    return {
      memoryId: freshMemoryId,
      content,
      createdAt: readString(row, ["createdAt", "created_at"], ""),
      // REQ-F-01: legacy rows may lack the key (reads as "" — only the
      // post-write dedupKey invariant compares it, and that path WRITES the
      // key first, so a committed row always carries it).
      dedupKey: readString(row, ["dedupKey", "dedup_key"], ""),
      // REQ-F-01: verify-only embedding (sanctioned getMemoryById internal
      // projection). Missing/malformed reads as undefined and the embedding
      // invariant reports a VIOLATION — not a silent pass.
      embedding: readEmbeddingVector(row),
    };
  }

  /**
   * REQ-F-01: the ONE update writer for a tier-1 merge — sends
   * `updateMemoryContent` with the Probe4-calibrated fail-closed asserts
   * ({memory: [anchored row], updated: [setProperty row]}: an empty anchor
   * or empty 'updated' branch means the merge wrote NOTHING and must never
   * masquerade as success). Extracted from the merge body so the post-write
   * heal can re-send the IDENTICAL write with the IDENTICAL asserts
   * (setProperty re-send is idempotent).
   */
  private async sendMergedUpdate(args: {
    memoryId: string;
    content: string;
    embedding: number[];
    dedupKey: string;
    concepts: Record<string, PropertyValueInput>[];
    project: string;
  }): Promise<void> {
    const response = await this.send(
      updateMemoryContentQuery().toQueryRequest(updateMemoryContentParams, args),
    );
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
  }

  /**
   * REQ-F-01: read the survivor's linked concept names via `memoryConcepts`
   * (anchor + HAS_CONCEPT traversal). Shape drift — a missing 'names'
   * return or a wrong-typed one — throws fail-closed: a broken read must
   * never be interpreted as "all concepts linked" (that would silently
   * skip the heal). Individual rows without a name read as "" (they can
   * never equal a non-empty expected name, so they only ever count as
   * NOT-yet-linked for their own — nonexistent — name).
   */
  private async readLinkedConcepts(memoryId: string, project: string): Promise<string[]> {
    const response = await this.send(
      memoryConceptsQuery().toQueryRequest(memoryConceptsParams, { memoryId, project }),
    );
    if (!isRecord(response) || !Object.hasOwn(response, "names")) {
      throw new Error(
        "memoryConcepts response did not include the 'names' return (contract §2 fail-closed: shape drift must never be read as 'every concept linked')",
      );
    }
    const namesReturn = response["names"];
    if (namesReturn !== null && !Array.isArray(namesReturn)) {
      throw new Error(
        `memoryConcepts 'names' return has unexpected type ${typeof namesReturn} (contract §2 fail-closed: shape drift must never be read as 'every concept linked')`,
      );
    }
    const names: string[] = [];
    for (const row of toRecords(namesReturn ?? [])) {
      names.push(readString(row, ["name"], ""));
    }
    return names;
  }

  /**
   * REQ-F-01 concept-link verify + ONE link-only heal: read the linked
   * names, compute the missing set (pure `missingConcepts` — exact-name,
   * deduped, sorted), link ONLY those via `linkMemoryConcepts` (content /
   * embedding / dedupKey are NEVER touched by this write), re-read, and
   * fail closed NAMING the invariant if anything is still missing. A
   * no-op when every expected name is already linked (and when nothing is
   * expected). Used by BOTH the substring-guard path and the post-write
   * verify's concepts-only branch.
   */
  private async ensureConceptLinks(
    memoryId: string,
    project: string,
    expectedConcepts: readonly string[],
  ): Promise<void> {
    if (expectedConcepts.length === 0) return;
    const linked = await this.readLinkedConcepts(memoryId, project);
    let missing = missingConcepts(linked, expectedConcepts);
    if (missing.length === 0) return;
    const healedCount = missing.length; // captured BEFORE the heal send — the log reports it only after the re-read confirms
    const response = await this.send(
      linkMemoryConceptsQuery().toQueryRequest(linkMemoryConceptsParams, {
        memoryId,
        project,
        concepts: missing.map((name): Record<string, PropertyValueInput> => ({ name })),
      }),
    );
    if (!isRecord(response) || !Object.hasOwn(response, "memory")) {
      throw new Error(
        "linkMemoryConcepts response did not include the 'memory' return (contract §2 fail-closed: a silent no-op must never masquerade as a heal)",
      );
    }
    if (!indicatesPresence(response["memory"])) {
      throw new Error(
        `linkMemoryConcepts anchored no Memory row for survivor ${memoryId} (contract §2 fail-closed)`,
      );
    }
    const after = await this.readLinkedConcepts(memoryId, project);
    missing = missingConcepts(after, expectedConcepts);
    if (missing.length > 0) {
      throw new Error(
        `REQ-F-01: concept-link invariant violated after heal — survivor ${memoryId} is still missing linked concept(s): ${missing.join(", ")} (fail-closed)`,
      );
    }
    // Gate RL001-F01 / COND-RK-02: ONE allowlisted observability line per
    // CONFIRMED heal — survivor id + healed-link COUNT only. Never content,
    // never embedding, never concept names (security SEC-F02). `oneLine`
    // collapses the rendered form to a single line (CWE-117); stderr —
    // stdout is the MCP protocol channel (`src/mcp.ts`), and both streams
    // are covered by the §3 process-log declaration.
    console.error(oneLine(`heal survivor=${memoryId} links=${healedCount}`));
  }

  /**
   * REQ-F-01 post-write verify + ONE heal (contract §3 tier-1 (b)): the
   * merged state is re-read FRESH (still under the survivor lock) and
   * four invariants are asserted:
   *   (a) `content` === the merged content we asked to write;
   *   (b) `dedupKey` === contentHash(project, normalize(content)) — the
   *       exact key passed to the write;
   *   (c) every EFFECTIVE concept of this merge is linked from the survivor;
   *   (d) `embedding` === the f32-round-tripped vector we embedded
   *       (embeddingsEqual — element-wise, fail-closed on malformed).
   * On any violation: ONE heal — content-state wrong (content / dedupKey /
   * embedding) → `retryWrite` (the full updateMemoryContent re-sent:
   * content + key + links together); links-only wrong → the link-only heal
   * via `ensureConceptLinks` — then re-verify; still wrong → throw NAMING
   * the violated invariant(s), fail-closed. A survivor that vanished
   * between write and verify propagates getFreshSurvivor's own fail-closed
   * error.
   */
  private async verifyMergedState(args: {
    memoryId: string;
    project: string;
    expectedContent: string;
    expectedDedupKey: string;
    expectedConcepts: readonly string[];
    expectedEmbedding: readonly number[];
    retryWrite: () => Promise<void>;
  }): Promise<void> {
    const violations = async (): Promise<string[]> => {
      const fresh = await this.getFreshSurvivor(args.memoryId, args.project);
      const linked = await this.readLinkedConcepts(args.memoryId, args.project);
      const names: string[] = [];
      if (fresh.content !== args.expectedContent) names.push("content");
      if (fresh.dedupKey !== args.expectedDedupKey) names.push("dedupKey");
      if (!embeddingsEqual(fresh.embedding, args.expectedEmbedding)) names.push("embedding");
      const missing = missingConcepts(linked, args.expectedConcepts);
      if (missing.length > 0) names.push(`concepts[${missing.join(",")}]`);
      return names;
    };
    const before = await violations();
    if (before.length === 0) return;
    const viaRetryWrite =
      before.includes("content") || before.includes("dedupKey") || before.includes("embedding");
    if (viaRetryWrite) {
      await args.retryWrite();
    } else {
      // Links-only branch: `ensureConceptLinks` emits its own heal line.
      await this.ensureConceptLinks(args.memoryId, args.project, args.expectedConcepts);
    }
    const after = await violations();
    if (after.length > 0) {
      throw new Error(
        `REQ-F-01: post-write verify failed after one heal on survivor ${args.memoryId}: invariant(s) violated — ${after.join(", ")} (fail-closed)`,
      );
    }
    if (viaRetryWrite) {
      // Gate RL001-F01 / COND-RK-02: ONE allowlisted line per CONFIRMED
      // full-write heal — invariant FAMILY tokens only (content/dedupKey/
      // embedding/links). The `concepts[...]` violation strings carry concept NAMES
      // and deliberately stay OUT of the line (security SEC-F02); ids and
      // tokens only, collapsed single-line via `oneLine` (CWE-117),
      // stderr — stdout is the MCP protocol channel (`src/mcp.ts`).
      const healed: string[] = [];
      if (before.includes("content")) healed.push("content");
      if (before.includes("dedupKey")) healed.push("dedupKey");
      if (before.includes("embedding")) healed.push("embedding");
      if (before.some((name) => name.startsWith("concepts"))) healed.push("links");
      console.error(oneLine(`heal survivor=${args.memoryId} invariants=${healed.join(",")}`));
    }
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

  // ---- Todos ----------------------------------------------------
  async createTodo(input: CreateTodoInput): Promise<TodoRow> {
    const todoId = `todo_${randomUUID()}`;
    const now = new Date().toISOString();
    const title = input.title.trim();
    if (title.length === 0) throw new Error("title is required");
    if (title.length > 500) throw new Error("title too long (max 500)");
    const description = (input.description ?? "").trim().slice(0, 5000);
    const priority = input.priority ?? "medium";
    const status = input.status ?? "pending";
    const parentId = (input.parentId ?? "").trim().slice(0, 200);
    if (parentId !== "") {
      // best-effort parent check: if parent exists but in different project, allow? enforce same project if found
      const parent = await this.getTodo(parentId).catch(() => undefined);
      if (parent === undefined) throw new Error(`parent todo not found: ${parentId}`);
    }
    const response = await this.send(
      saveTodoQuery().toQueryRequest(saveTodoParams, {
        todoId,
        title,
        description,
        priority,
        status,
        project: input.project,
        sessionId: input.sessionId ?? "",
        createdAt: now,
        updatedAt: now,
        parentId,
      }),
    );
    if (!isRecord(response) || !Object.hasOwn(response, "todo")) {
      throw new Error("saveTodo response did not include the 'todo' return");
    }
    const rows = rowsOf(response, ["todo"]);
    if (rows !== undefined && rows.length > 0) {
      const parsed = toRecords(rows).map(toTodoRow)[0];
      if (parsed !== undefined && parsed.todoId !== "") return parsed;
    }
    return {
      id: todoId,
      todoId,
      title,
      description,
      priority,
      status,
      project: input.project,
      sessionId: input.sessionId ?? "",
      createdAt: now,
      updatedAt: now,
      parentId: parentId !== "" ? parentId : undefined,
    };
  }

  async listTodos(input: ListTodosInput): Promise<TodoRow[]> {
    // Text search path — project-scoped BM25 on title
    if (input.search !== undefined && input.search.trim().length > 0) {
      const q = input.search.trim();
      const response = await this.send(
        searchTodosByTextQuery().toQueryRequest(searchTodosByTextParams, { q, project: input.project, k: input.limit }),
      );
      let hits = hitsFromTodo(response, ["hits"]);
      hits = this.filterTodos(hits, input);
      // also include substring fallback that text index may miss (e.g. short tokens)
      if (hits.length === 0) {
        const all = await this.rawListTodos(input.project, 200);
        const lower = q.toLowerCase();
        const sub = all.filter((t) => t.title.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower));
        hits = this.filterTodos(sub, input);
      }
      return hits.slice(0, input.limit);
    }
    const all = await this.rawListTodos(input.project, Math.max(input.limit * 4, 100));
    const filtered = this.filterTodos(all, input);
    return filtered.slice(0, input.limit);
  }

  private filterTodos(rows: TodoRow[], input: ListTodosInput): TodoRow[] {
    let out = rows;
    if (input.status !== undefined) out = out.filter((t) => t.status === input.status);
    if (input.priority !== undefined) out = out.filter((t) => t.priority === input.priority);
    if (input.parentId !== undefined) out = out.filter((t) => (t.parentId ?? "") === input.parentId);
    if (input.frontier === true) out = out.filter((t) => t.status === "pending" || t.status === "active");
    // sort: frontier ordering high→low priority, then updatedAt desc, then todoId
    out.sort((a, b) => {
      const pr = priorityRank(b.priority) - priorityRank(a.priority);
      if (pr !== 0) return pr;
      const at = b.updatedAt.localeCompare(a.updatedAt);
      if (at !== 0) return at;
      return a.todoId.localeCompare(b.todoId);
    });
    return out;
  }

  private async rawListTodos(project: string, limit: number): Promise<TodoRow[]> {
    const response = await this.send(listTodosQuery().toQueryRequest(listTodosParams, { project, limit }));
    if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
    const rows = rowsOf(response, TODO_ROW_NAMES);
    if (rows === undefined) return [];
    return toRecords(rows).map(toTodoRow);
  }

  async getTodo(todoId: string): Promise<TodoRow | undefined> {
    const response = await this.send(getTodoByIdQuery().toQueryRequest(getTodoByIdParams, { todoId }));
    if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
    const rows = rowsOf(response, ["todo"]);
    if (rows === undefined || rows.length === 0) return undefined;
    const row = toRecords(rows)[0];
    if (row === undefined) return undefined;
    const parsed = toTodoRow(row);
    if (parsed.todoId === "") return undefined;
    return parsed;
  }

  async updateTodo(todoId: string, patch: UpdateTodoInput): Promise<TodoRow | undefined> {
    const existing = await this.getTodo(todoId);
    if (existing === undefined) return undefined;
    const title = patch.title !== undefined ? patch.title.trim() : existing.title;
    const description = patch.description !== undefined ? patch.description.trim().slice(0, 5000) : existing.description;
    const priority = patch.priority ?? existing.priority;
    const status = patch.status ?? existing.status;
    let parentId: string;
    if (patch.parentId === null) parentId = "";
    else if (patch.parentId !== undefined) {
      parentId = patch.parentId.trim().slice(0, 200);
      if (parentId !== "") {
        if (parentId === todoId) throw new Error("todo cannot be its own parent");
        const parent = await this.getTodo(parentId).catch(() => undefined);
        if (parent === undefined) throw new Error(`parent todo not found: ${parentId}`);
      }
    } else {
      parentId = existing.parentId ?? "";
    }
    if (title.length === 0) throw new Error("title is required");
    const updatedAt = new Date().toISOString();
    const response = await this.send(
      updateTodoQuery().toQueryRequest(updateTodoParams, { todoId, title, description, priority, status, updatedAt, parentId }),
    );
    if (!isRecord(response) || !Object.hasOwn(response, "updated")) {
      throw new Error("updateTodo response did not include the 'updated' return");
    }
    if (!indicatesPresence(response["updated"])) throw new Error("updateTodo did not update any row");
    return { ...existing, title, description, priority, status, updatedAt, parentId: parentId !== "" ? parentId : undefined };
  }

  async deleteTodo(todoId: string): Promise<boolean> {
    const response = await this.send(deleteTodoQuery().toQueryRequest(deleteTodoParams, { todoId }));
    return indicatesPresence(response);
  }

  async frontierTodos(input: { project: string; limit: number }): Promise<TodoRow[]> {
    return this.listTodos({ project: input.project, limit: input.limit, frontier: true });
  }

  classifyPara(title: string, content: string, tags?: string[]): ParaClassificationResult {
    return classifyPara(title, content, tags);
  }

  async saveNote(input: SaveNoteInput): Promise<SaveNoteResult> {
    const project = input.project ?? "default";
    const title = input.title.trim();
    const content = input.content.trim();
    const tags = input.tags ?? [];

    const dedupKey = contentHash(project, normalizeContent(content));

    let category: ParaCategory = input.paraCategory ?? "resource";
    let target: string = input.paraTarget ?? "inbox";
    if (!input.paraCategory) {
      const classification = this.classifyPara(title, content, tags);
      category = classification.category;
      target = input.paraTarget ?? classification.target;
    }

    const noteId = randomUUID();
    const embedding = embed(content);
    const now = Date.now();

    // Check candidate notes in same project with cosine similarity > 0.85 (C8)
    const relatedNoteIds: string[] = [];
    try {
      const candidates = await this.searchNotesByVector({
        queryVector: embedding,
        project,
        k: 10,
      });
      for (const hit of candidates) {
        if (hit.id !== noteId) {
          const sim = hit.distance !== undefined ? 1 - hit.distance : 0;
          if (sim > 0.85) {
            relatedNoteIds.push(hit.id);
          }
        }
      }
    } catch {
      // Graceful fallback if vector search unready
    }

    const paraLabelMap: Record<ParaCategory, "Project" | "Area" | "Resource" | "Archive"> = {
      project: "Project",
      area: "Area",
      resource: "Resource",
      archive: "Archive",
    };
    const paraLabel = paraLabelMap[category] ?? "Resource";

    const concepts = tags.map((name) => ({ name }));
    const relatedNotes = relatedNoteIds.map((targetId) => ({ targetId }));

    const req = saveNoteQuery(paraLabel).toQueryRequest(saveNoteParams, {
      id: noteId,
      title,
      content,
      project,
      paraCategory: category,
      paraTarget: target,
      origin: input.origin ?? "user",
      createdAt: now,
      updatedAt: now,
      status: "active",
      embedding,
      dedupKey,
      relatedNotes,
      concepts,
    });

    await this.send(req);

    return {
      id: noteId,
      project,
      paraCategory: category,
      paraTarget: target,
      deduped: false,
      relatedNoteIds,
    };
  }

  async listNotes(input: ListNotesInput): Promise<NoteRow[]> {
    const project = input.project;
    const limit = BigInt(Math.max(1, Math.min(input.limit ?? 50, 100)));

    let req: QueryRequest;
    if (input.category) {
      req = listNotesByCategoryQuery().toQueryRequest(listNotesByCategoryParams, {
        project,
        paraCategory: input.category,
        limit,
      });
    } else {
      req = listNotesQuery().toQueryRequest(listNotesParams, {
        project,
        limit,
      });
    }

    const response = await this.send(req);
    const rows = this.extractRecords(response, "notes");
    const notes: NoteRow[] = [];
    for (const r of rows) {
      notes.push({
        id: readString(r, ["id", "noteId"], ""),
        noteId: readString(r, ["noteId", "id"], ""),
        title: readString(r, ["title"], ""),
        content: readString(r, ["content"], ""),
        project: readString(r, ["project"], project),
        sessionId: r["sessionId"] ? String(r["sessionId"]) : undefined,
        paraCategory: (readString(r, ["paraCategory"], "resource") as ParaCategory),
        origin: r["origin"] ? String(r["origin"]) : undefined,
        createdAt: readString(r, ["createdAt"], ""),
        updatedAt: readString(r, ["updatedAt"], ""),
        status: readString(r, ["status"], "active"),
        dedupKey: r["dedupKey"] ? String(r["dedupKey"]) : undefined,
      });
    }

    if (input.tag) {
      const lowerTag = input.tag.toLowerCase();
      return notes.filter((n) => n.content.toLowerCase().includes(lowerTag) || n.title.toLowerCase().includes(lowerTag));
    }

    return notes;
  }

  async getNoteById(id: string, project?: string): Promise<GetNoteResult | undefined> {
    const req = getNoteByIdQuery().toQueryRequest(getNoteByIdParams, { id });
    const response = await this.send(req);
    const noteRows = this.extractRecords(response, "note");
    if (noteRows.length === 0) return undefined;
    const r = noteRows[0]!;
    const noteProject = readString(r, ["project"], "");

    // Tenant check C8
    if (project !== undefined && noteProject !== project) {
      return undefined;
    }

    const belongsToRows = this.extractRecords(response, "belongsTo");
    const supersedesRows = this.extractRecords(response, "supersedes");
    const supersededByRows = this.extractRecords(response, "supersededBy");
    const relatesToRows = this.extractRecords(response, "relatesTo");

    const noteIdVal = readString(r, ["id", "noteId"], id);
    const note: NoteRow = {
      id: noteIdVal,
      noteId: readString(r, ["noteId", "id"], noteIdVal),
      title: readString(r, ["title"], ""),
      content: readString(r, ["content"], ""),
      project: noteProject,
      sessionId: r["sessionId"] ? String(r["sessionId"]) : undefined,
      paraCategory: (readString(r, ["paraCategory"], "resource") as ParaCategory),
      origin: r["origin"] ? String(r["origin"]) : undefined,
      createdAt: readString(r, ["createdAt"], ""),
      updatedAt: readString(r, ["updatedAt"], ""),
      status: readString(r, ["status"], "active"),
      dedupKey: r["dedupKey"] ? String(r["dedupKey"]) : undefined,
    };

    const paraTarget = belongsToRows[0] ? readString(belongsToRows[0], ["name"], "") : "";
    const supersedes = supersedesRows.map((s) => ({
      id: readString(s, ["id", "noteId"], ""),
      title: readString(s, ["title"], ""),
    }));
    const supersededBy = supersededByRows[0]
      ? {
          id: readString(supersededByRows[0], ["id", "noteId"], ""),
          title: readString(supersededByRows[0], ["title"], ""),
        }
      : undefined;
    const relatesTo = relatesToRows.map((rel) => ({
      id: readString(rel, ["id", "noteId"], ""),
      title: readString(rel, ["title"], ""),
    }));

    return {
      note,
      para: {
        category: note.paraCategory,
        name: paraTarget,
      },
      supersedes,
      supersededBy,
      relatesTo,
    };
  }

  async moveNote(input: MoveNoteInput): Promise<boolean> {
    const existing = await this.getNoteById(input.id, input.project);
    if (!existing) return false;

    const paraLabelMap: Record<ParaCategory, "Project" | "Area" | "Resource" | "Archive"> = {
      project: "Project",
      area: "Area",
      resource: "Resource",
      archive: "Archive",
    };
    const targetLabel = paraLabelMap[input.toCategory] ?? "Resource";
    const targetName = input.toTarget ?? input.toCategory;

    const req = moveNoteQuery(targetLabel).toQueryRequest(moveNoteParams, {
      id: input.id,
      paraCategory: input.toCategory,
      paraTarget: targetName,
      updatedAt: Date.now(),
    });

    await this.send(req);
    return true;
  }

  async distillNote(input: DistillNoteInput): Promise<NoteRow> {
    const existing = await this.getNoteById(input.id, input.project);
    if (!existing) {
      throw new Error(`Note not found: ${input.id}`);
    }

    const summary = input.summary ?? `Summary: ${existing.note.title} — ${existing.note.content.slice(0, 100)}`;
    const newId = randomUUID();
    const embedding = embed(summary);
    const now = Date.now();

    const req = distillNoteQuery().toQueryRequest(distillNoteParams, {
      id: newId,
      title: `Distilled: ${existing.note.title}`,
      content: summary,
      project: input.project,
      paraCategory: existing.note.paraCategory,
      embedding,
      createdAt: now,
      updatedAt: now,
      status: "active",
      supersededId: input.id,
    });

    await this.send(req);

    return {
      id: newId,
      noteId: newId,
      title: `Distilled: ${existing.note.title}`,
      content: summary,
      project: input.project,
      paraCategory: existing.note.paraCategory,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      status: "active",
    };
  }

  async forgetNote(id: string, project?: string): Promise<boolean> {
    if (project !== undefined) {
      const existing = await this.getNoteById(id, project);
      if (!existing) return false;
    }

    const req = forgetNoteQuery().toQueryRequest(forgetNoteParams, { id });
    const response = await this.send(req);
    const forgotten = this.extractRecords(response, "target");
    return forgotten.length > 0;
  }

  async linkNodes(input: {
    fromId: string;
    toId: string;
    type: "REFERENCES" | "BELONGS_TO" | "RELATES_TO";
    project?: string;
  }): Promise<boolean> {
    const project = input.project ?? "default";
    const fromNote = await this.getNoteById(input.fromId, project);
    const toNote = await this.getNoteById(input.toId, project);
    if (!fromNote || !toNote || fromNote.note.project !== toNote.note.project) {
      throw new Error("invalid_tenant_link: nodes must belong to the same project tenant");
    }

    const req = linkNotesQuery(input.type).toQueryRequest(linkNotesParams, {
      fromId: input.fromId,
      toId: input.toId,
      project,
    });
    await this.send(req);
    return true;
  }


  async searchNotesByVector(input: VectorSearchInput): Promise<SearchHit[]> {
    const k = BigInt(input.k);
    const response = await this.send(
      searchNotesByVectorQuery().toQueryRequest(searchByVectorParams, {
        queryVector: input.queryVector,
        project: input.project,
        k,
      }),
    );
    return hitsFrom(response, ["hits"]);
  }

  async searchNotesByText(input: TextSearchInput): Promise<SearchHit[]> {
    const k = BigInt(input.k);
    const response = await this.send(
      searchNotesByTextQuery().toQueryRequest(searchByTextParams, {
        q: input.q,
        project: input.project,
        k,
      }),
    );
    return hitsFrom(response, ["hits"]);
  }

  async graphSearchNotes(input: GraphSearchInput): Promise<SearchHit[]> {
    const k = BigInt(input.k);
    const response = await this.send(
      graphSearchNotesQuery().toQueryRequest(graphSearchNotesParams, {
        concepts: input.concepts,
        project: input.project,
        k,
      }),
    );
    return hitsFrom(response, ["hits"]);
  }

  async traverseNoteGraph(
    noteId: string,
    project: string,
    limit = 10,
  ): Promise<{
    references: NoteRow[];
    relates: NoteRow[];
    belongsTo: Array<{ id: string; name: string }>;
  }> {
    const response = await this.send(
      traverseNoteGraphQuery().toQueryRequest(traverseNoteGraphParams, {
        noteId,
        project,
        limit: BigInt(limit),
      }),
    );
    const refs = this.extractRecords(response, "references").map((r) => ({
      id: readString(r, ["id", "noteId"], ""),
      noteId: readString(r, ["noteId", "id"], ""),
      title: readString(r, ["title"], ""),
      content: readString(r, ["content"], ""),
      project: readString(r, ["project"], project),
      paraCategory: (readString(r, ["paraCategory"], "resource") as ParaCategory),
      createdAt: readString(r, ["createdAt"], ""),
      updatedAt: readString(r, ["updatedAt"], ""),
      status: readString(r, ["status"], "active"),
    }));
    const rels = this.extractRecords(response, "relates").map((r) => ({
      id: readString(r, ["id", "noteId"], ""),
      noteId: readString(r, ["noteId", "id"], ""),
      title: readString(r, ["title"], ""),
      content: readString(r, ["content"], ""),
      project: readString(r, ["project"], project),
      paraCategory: (readString(r, ["paraCategory"], "resource") as ParaCategory),
      createdAt: readString(r, ["createdAt"], ""),
      updatedAt: readString(r, ["updatedAt"], ""),
      status: readString(r, ["status"], "active"),
    }));
    const belongs = this.extractRecords(response, "belongsTo").map((b) => ({
      id: readString(b, ["id"], ""),
      name: readString(b, ["name"], ""),
    }));
    return { references: refs, relates: rels, belongsTo: belongs };
  }

  private extractRecords(response: unknown, name: string): Record<string, unknown>[] {
    if (!isRecord(response)) return [];
    const val = response[name];
    if (Array.isArray(val)) {
      return toRecords(val);
    }
    return [];
  }
}

function hitsFromTodo(response: unknown, names: readonly string[]): TodoRow[] {
  if (!isRecord(response)) throw new Error("unexpected helix response shape (not an object)");
  const rows = rowsOf(response, names);
  if (rows === undefined) throw new Error(`helix response missing a result array (wanted one of: ${names.join(", ")})`);
  return toRecords(rows).map(toTodoRow);
}

/** Shared factory: REST server and MCP server build the same store. */
export function createDefaultStore(): BrainyStore {
  return new HelixStore();
}
