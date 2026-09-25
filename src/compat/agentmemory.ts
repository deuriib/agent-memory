/**
 * brainy.compat.agentmemory — SQLite (legacy agent-memory) → HelixDB mapping.
 *
 * PRD §7.2 mapping table (frozen):
 *   memories.statement → Memory.statement (+ Memory.content mirror)
 *   memories.type      → Memory.memory_type
 *   objects.name       → Resource.name
 *   contexts.name      → Context.name
 *   links.about        → E::ABOUT   (Memory → Resource | Project)
 *   links.context      → E::APPLIES_TO (Memory → Context)
 *
 * Idempotency: every migrated memory carries
 * `dedupKey = sha256(project + "\n" + normalize(content))` — the SAME
 * fingerprint the live store uses (src/lifecycle.ts) — so a re-run over the
 * same SQLite dump inserts zero duplicates (first-wins, never overwrite).
 * Batched through the caller's sink so this module stays free of I/O and
 * unit-testable without a Helix instance.
 *
 * No secrets, no PII in logs: helpers below never print row content — only
 * counts and ids flow back to the caller.
 */
import { randomUUID } from "node:crypto";
import { contentHash, normalizeContent } from "../lifecycle.js";
import { embed, EMBED_DIM } from "../embed.js";

/** One row of the legacy SQLite `memories` table. */
export interface SqliteMemoryRow {
  id: string;
  statement: string;
  type?: string | null;
  project?: string | null;
  session_id?: string | null;
  origin?: string | null;
  importance?: number | null;
  created_at?: string | null;
}

/** One row of the legacy SQLite `objects` table. */
export interface SqliteObjectRow {
  name: string;
  category?: string | null;
}

/** One row of the legacy SQLite `contexts` table. */
export interface SqliteContextRow {
  name: string;
  type?: string | null;
}

/** One row of the legacy SQLite `links` table. */
export interface SqliteLinkRow {
  /** Legacy memory id (maps to Memory.memoryId). */
  memory_id: string;
  /** Target resource/project name → E::ABOUT. */
  about?: string | null;
  /** Target context name → E::APPLIES_TO. */
  context?: string | null;
}

/** Documented §7.2 mapping table (reference for tests and operators). */
export const SQLITE_TO_HELIX_MAPPING: ReadonlyArray<{ from: string; to: string }> = [
  { from: "memories.statement", to: "Memory.statement" },
  { from: "memories.type", to: "Memory.memory_type" },
  { from: "objects.name", to: "Resource.name" },
  { from: "contexts.name", to: "Context.name" },
  { from: "links.about", to: "E::ABOUT" },
  { from: "links.context", to: "E::APPLIES_TO" },
] as const;

/** Fallback memory_type when the legacy row carries no type (PRD §7.2). */
export const DEFAULT_MEMORY_TYPE = "general";

/** Origin stamped on rows that arrived without one. */
export const SQLITE_IMPORT_ORIGIN = "import:sqlite";

/** Values for `migrateAgentMemoryRow` (db/queries.ts) built from one row. */
export interface MigrationParams {
  memoryId: string;
  content: string;
  project: string;
  sessionId: string;
  origin: string;
  importance: number;
  createdAt: string;
  embedding: number[];
  dedupKey: string;
  memoryType: string;
}

/** memories.statement → Memory.statement (verbatim, trimmed). */
export function mapMemoryStatement(row: SqliteMemoryRow): string {
  return row.statement.trim();
}

/** memories.type → Memory.memory_type (fallback to `general`). */
export function mapMemoryType(type: string | null | undefined): string {
  const cleaned = (type ?? "").trim();
  return cleaned === "" ? DEFAULT_MEMORY_TYPE : cleaned.slice(0, 100);
}

/** objects.name → Resource.name (trimmed, non-empty). */
export function mapObjectName(row: SqliteObjectRow): string {
  return row.name.trim();
}

/** contexts.name → Context.name (trimmed, non-empty). */
export function mapContextName(row: SqliteContextRow): string {
  return row.name.trim();
}

/** Edge descriptors derived from one legacy `links` row. */
export interface MappedLink {
  memoryId: string;
  target: string;
  edge: "ABOUT" | "APPLIES_TO";
}

/**
 * links.about → E::ABOUT, links.context → E::APPLIES_TO.
 * Empty targets produce no edge (a link row may carry only one side).
 */
export function mapLinkRow(row: SqliteLinkRow): MappedLink[] {
  const edges: MappedLink[] = [];
  const about = (row.about ?? "").trim();
  if (about !== "") edges.push({ memoryId: row.memory_id, target: about, edge: "ABOUT" });
  const context = (row.context ?? "").trim();
  if (context !== "") edges.push({ memoryId: row.memory_id, target: context, edge: "APPLIES_TO" });
  return edges;
}

/** Build the HelixDB write params for one legacy memory row. */
export function buildMigrationParams(row: SqliteMemoryRow, defaultProject = "default"): MigrationParams {
  const content = mapMemoryStatement(row);
  const project = (row.project ?? "").trim() === "" ? defaultProject : (row.project as string).trim();
  const embedding = embed(content, EMBED_DIM);
  return {
    memoryId: row.id,
    content,
    project,
    sessionId:
      row.session_id !== undefined && row.session_id !== null && row.session_id.trim() !== ""
        ? row.session_id.trim()
        : randomUUID(),
    origin:
      row.origin !== undefined && row.origin !== null && row.origin.trim() !== ""
        ? row.origin.trim().slice(0, 100)
        : SQLITE_IMPORT_ORIGIN,
    importance:
      typeof row.importance === "number" && Number.isFinite(row.importance)
        ? Math.min(1, Math.max(0, row.importance))
        : 0.5,
    createdAt:
      row.created_at !== undefined && row.created_at !== null && row.created_at.trim() !== ""
        ? row.created_at.trim()
        : new Date().toISOString(),
    embedding,
    dedupKey: contentHash(project, normalizeContent(content)),
    memoryType: mapMemoryType(row.type),
  };
}

/** Storage sink: the caller's Helix writer behind a dedup pre-check. */
export interface MigrationSink {
  /** True when a node with this dedupKey already exists (any label). */
  has(dedupKey: string): Promise<boolean> | boolean;
  /** Persist one migrated row (Memory node + edges). */
  insert(params: MigrationParams): Promise<void> | void;
}

export interface MigrationReport {
  inserted: number;
  skipped: number;
}

/**
 * Idempotent batched migration: rows whose dedupKey already exists (in the
 * sink OR earlier in this same batch) are skipped. Re-running the same dump
 * inserts zero duplicates and never overwrites (first-wins).
 */
export async function migrateBatch(rows: readonly SqliteMemoryRow[], sink: MigrationSink): Promise<MigrationReport> {
  const seen = new Set<string>();
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.statement.trim() === "") {
      skipped += 1;
      continue;
    }
    const params = buildMigrationParams(row);
    if (seen.has(params.dedupKey) || (await sink.has(params.dedupKey))) {
      skipped += 1;
      continue;
    }
    await sink.insert(params);
    seen.add(params.dedupKey);
    inserted += 1;
  }
  return { inserted, skipped };
}
