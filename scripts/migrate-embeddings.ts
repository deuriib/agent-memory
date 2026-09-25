/**
 * scripts/migrate-embeddings.ts — Batched 384 → 1536 re-embedding (INV-014, NFR-03).
 *
 * Legacy `Memory` rows written under the old 384-dim embedder are re-embedded
 * to the canonical 1536-dim space (`EMBED_DIM`) without downtime:
 *
 *   1. Enumerate projects → sessions → memories using ONLY proven frozen
 *      builders (listProjects / listSessions / sessionMemories / getMemoryById).
 *   2. `getMemoryById` projects `embedding` (sanctioned internal exception,
 *      CONTRACT §2) so the dimension check runs client-side.
 *   3. Rows whose embedding length already equals the target dim are skipped —
 *      the script is re-runnable (second run = zero writes).
 *   4. Each stale row is refreshed via `updateMemoryContent` (proven Probe4
 *      path): anchor by unique memoryId, `setProperty("embedding", vector)`
 *      — which refreshes the vector index — with `concepts: []`, and
 *      CONTRACT §0 guarantees `forEachParam` with empty params commits fine.
 *      Content and dedupKey pass through UNCHANGED (byte-identical survivor).
 *
 * Forward-only, never destructive (INV-014): the script contains no `drop()`
 * and never deletes nodes — a row is either refreshed in place or skipped.
 *
 * Run: npx tsx scripts/migrate-embeddings.ts [--batch-size N] [--project p] [--dry-run]
 * Exit codes: 0 success · 1 operational failure · 2 usage/validation error.
 */
import { Client, type QueryRequest } from "@helix-db/helix-db";
import {
  getMemoryById,
  getMemoryByIdParams,
  listProjects,
  listProjectsParams,
  listSessions,
  listSessionsParams,
  sessionMemories,
  sessionMemoriesParams,
  updateMemoryContent,
  updateMemoryContentParams,
} from "../db/queries.js";
import { EMBED_DIM, embed } from "../src/embed.js";
import { contentHash, normalizeContent } from "../src/lifecycle.js";
import { oneLine } from "../src/logline.js";

const USAGE =
  "usage: npx tsx scripts/migrate-embeddings.ts [--batch-size <n>] [--project <p>] [--dry-run]";
const DEFAULT_BATCH_SIZE = 25;
const SCAN_LIMIT = BigInt(100_000);

/** One stale row selected for re-embedding (content never printed, only counted). */
export interface ReembedRecord {
  memoryId: string;
  project: string;
  content: string;
  dedupKey: string;
  fromDim: number;
}

/** True when the stored embedding is missing or not in the target dim space. */
export function needsReembed(embedding: readonly number[] | undefined, targetDim: number): boolean {
  if (embedding === undefined) return true;
  return embedding.length !== targetDim;
}

/** Split rows into write chunks of at most `size` (size < 1 → usage error). */
export function chunk<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("batch_size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Fresh target-dim embedding for one record's content (deterministic, L2-normalized). */
export function reembedVector(content: string, targetDim: number): number[] {
  return embed(content, targetDim);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensive row extraction mirroring src/store.ts (preferred names, then fallback). */
function rowsOf(response: unknown, names: readonly string[]): Record<string, unknown>[] {
  if (!isRecord(response)) return [];
  for (const name of names) {
    const value = response[name];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  for (const value of Object.values(response)) {
    if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) return value.filter(isRecord);
  }
  return [];
}

function readString(row: Record<string, unknown>, keys: readonly string[], fallback: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return fallback;
}

function readEmbedding(row: Record<string, unknown>): number[] | undefined {
  const value = row["embedding"];
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry === "number" && Number.isFinite(entry)) out.push(entry);
    else return undefined;
  }
  return out;
}

interface CliArgs {
  batchSize: number;
  project: string | undefined;
  dryRun: boolean;
}

function failUsage(message: string): never {
  console.error(`migrate-embeddings: ${oneLine(message)}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliArgs {
  let batchSize = DEFAULT_BATCH_SIZE;
  let project: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--batch-size" || arg === "--project") {
      const raw = argv[++i];
      if (raw === undefined || raw === "") failUsage(`${arg} requires a value`);
      if (arg === "--batch-size") {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed) || parsed < 1) failUsage("--batch-size must be a positive integer");
        batchSize = parsed;
      } else {
        project = raw;
      }
      continue;
    }
    failUsage(`unknown argument "${arg}"`);
  }
  return { batchSize, project, dryRun };
}

export function resolveMigrationUrl(env: NodeJS.ProcessEnv = process.env): { url: string; usedLegacy: boolean } {
  const brainy = env["BRAINY_URL"];
  if (typeof brainy === "string" && brainy !== "") return { url: brainy, usedLegacy: false };
  const legacy = env["HELIX_URL"];
  if (typeof legacy === "string" && legacy !== "") return { url: legacy, usedLegacy: true };
  return { url: "http://localhost:6969", usedLegacy: false };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { url, usedLegacy } = resolveMigrationUrl();
  if (usedLegacy) {
    console.error("WARN deprecated use BRAINY_URL — HELIX_URL will be removed in next major");
  }
  const targetDim = EMBED_DIM;
  const client = Client.server(url);

  const send = async (request: QueryRequest): Promise<unknown> => client.query(request).send();

  // 1. Projects (or the single --project filter).
  let projects: string[];
  if (args.project !== undefined) {
    projects = [args.project];
  } else {
    const res = await send(listProjects().toQueryRequest(listProjectsParams, { limit: SCAN_LIMIT })).catch(
      (err: unknown) => {
        console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
        process.exit(1);
      },
    );
    const names = new Set<string>();
    for (const row of rowsOf(res, ["projects"])) {
      const name = readString(row, ["project"], "");
      if (name !== "") names.add(name);
    }
    projects = [...names];
  }

  // 2-3. Sessions → memories → dim check via getMemoryById (projects embedding).
  const stale: ReembedRecord[] = [];
  let scanned = 0;
  for (const project of projects) {
    const sessionsRes = await send(
      listSessions().toQueryRequest(listSessionsParams, { project, limit: SCAN_LIMIT }),
    ).catch((err: unknown) => {
      console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
    const sessionIds = rowsOf(sessionsRes, ["sessions"])
      .map((row) => readString(row, ["sessionId", "session_id"], ""))
      .filter((id) => id !== "");
    for (const sessionId of sessionIds) {
      const memRes = await send(
        sessionMemories().toQueryRequest(sessionMemoriesParams, { sessionId, project, limit: SCAN_LIMIT }),
      ).catch((err: unknown) => {
        console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
        process.exit(1);
      });
      const ids = rowsOf(memRes, ["memories"])
        .map((row) => readString(row, ["memoryId", "memory_id"], ""))
        .filter((id) => id !== "");
      for (const memoryId of ids) {
        const rowRes = await send(getMemoryById().toQueryRequest(getMemoryByIdParams, { memoryId, project })).catch(
          (err: unknown) => {
            console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
            process.exit(1);
          },
        );
        const rows = rowsOf(rowRes, ["memory"]);
        const row = rows[0];
        scanned += 1;
        if (row === undefined) continue;
        const embedding = readEmbedding(row);
        if (!needsReembed(embedding, targetDim)) continue;
        const content = readString(row, ["content", "statement"], "");
        if (content === "") continue;
        stale.push({
          memoryId,
          project,
          content,
          dedupKey: contentHash(project, normalizeContent(content)),
          fromDim: embedding?.length ?? 0,
        });
      }
    }
  }

  console.error(
    `migrate-plan scanned=${oneLine(scanned)} stale=${oneLine(stale.length)} target_dim=${oneLine(targetDim)} dry_run=${oneLine(args.dryRun)}`,
  );
  if (args.dryRun) {
    console.log(
      `migrate-dry-run scanned=${oneLine(scanned)} stale=${oneLine(stale.length)} target_dim=${oneLine(targetDim)} at=${oneLine(new Date().toISOString())}`,
    );
    return;
  }

  // 4. Refresh in client-side batches via the proven setProperty path.
  let refreshed = 0;
  for (const batch of chunk(stale, args.batchSize)) {
    for (const record of batch) {
      await send(
        updateMemoryContent().toQueryRequest(updateMemoryContentParams, {
          memoryId: record.memoryId,
          content: record.content,
          embedding: reembedVector(record.content, targetDim),
          dedupKey: record.dedupKey,
          concepts: [],
          project: record.project,
        }),
      ).catch((err: unknown) => {
        console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
        process.exit(1);
      });
      refreshed += 1;
    }
  }

  console.log(
    `migrate-embeddings scanned=${oneLine(scanned)} refreshed=${oneLine(refreshed)} target_dim=${oneLine(targetDim)} at=${oneLine(new Date().toISOString())}`,
  );
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("migrate-embeddings.ts");
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(`migrate-embeddings failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
