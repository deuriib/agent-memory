/**
 * scripts/purge.ts — REQ-P1-1 destructive TTL purge (corte A).
 *
 * Fail-closed CLI: it refuses to run without an explicit scope and an
 * explicit age threshold, it never scans all projects implicitly, and a
 * batch that produces zero deletions aborts instead of looping.
 *
 *   npx tsx scripts/purge.ts --days <N> (--project <name> | --all) [--dry-run]
 *
 *   --days N      expire memories with age strictly > N days (integer >= 1;
 *                 days=0 would mean "older than now" = everything, refused)
 *   --project P   purge exactly this project
 *   --all         purge every project (EXPLICIT opt-in; project discovery
 *                 walks Session nodes — saveMemory guarantees a Session for
 *                 every project that has memories)
 *   --dry-run     print would-delete count + ids only; NO deletions
 *
 * Output is allowlisted: plan line, dry-run count+ids, batch progress lines
 *   purge-progress project=<P> batch=<N> deleted=<M>, one governance line
 *   purge project=<P|all> days=<N> deleted=<M> at=<ISO>
 *   (+ ` status=partial` when a failed run records deletions it completed),
 * and healthCount before/after lines (counts only). Every value interpolated
 * into a rendered stdout/stderr line is collapsed to a single line first
 * (oneLine — CWE-117/SEC-P121-01, same transform as the P3.1 delete-reason
 * guard in src/server.ts; PRINT-site only, query values stay verbatim).
 * Content is never printed. Talks directly to Helix (HELIX_URL, default
 * http://localhost:6969) — the running instance is never restarted.
 *
 * Exit codes: 0 success · 1 operational failure · 2 usage/validation error.
 *
 * Accepted risk — no request timeout (RL-002/C6): the Helix SDK documents NO
 * Client/transport timeout and NO AbortSignal option (verified against
 * dist/index.d.ts: Client's constructor takes only a url, QueryExecution
 * Request.send() takes no options), so a hung Helix stalls this CLI
 * indefinitely. Compensating controls: bounded batches (MAX_BATCHES hard
 * stop + no-progress guard), per-batch progress output (operator sees
 * liveness), and operator Ctrl-C. Residual risk accepted — owner:
 * engineering (contract §3). Do NOT fake a timeout via SDK internals.
 *
 * Run: npx tsx scripts/probe3.ts must be GREEN for listExpired first (it is
 * — probe3 (e): strict older-than on dateTime, project-scoped, ordered).
 */
import { Client, HelixError } from "@helix-db/helix-db";
import {
  forgetMemory,
  forgetMemoryParams,
  healthCount,
  healthCountParams,
  listExpired,
  listExpiredParams,
  listProjects,
  listProjectsParams,
} from "../db/queries";

const MS_PER_DAY = 86_400_000;
const BATCH_LIMIT = 500; // real-run page size (spec: batches of 500)
const DRY_RUN_LIMIT = 100_000; // single-query cap for --dry-run counts
const SESSION_SCAN_LIMIT = 100_000; // project discovery cap for --all
const MAX_BATCHES = 10_000; // hard stop even with progress (runaway guard)

const USAGE =
  "usage: npx tsx scripts/purge.ts --days <N>=1..6 digits> (--project <name> | --all) [--dry-run]";

/**
 * Print-site single-line guard (CWE-117 / SEC-P121-01 + CE-003): EVERY value
 * interpolated into a rendered stdout/stderr line passes through here first —
 * collapse whitespace runs (incl. embedded `\n`/`\r`) to one space + trim,
 * the same transform as the P3.1 delete-reason guard in src/server.ts. Only
 * the PRINTED form is normalized; the query still receives the verbatim
 * value, so a stored newline-bearing project name can no longer forge a
 * second plan/health/governance line out of one purge output line.
 */
function oneLine(value: string | number | boolean): string {
  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Failure-path audit cursor (OPS-001/C2): REAL deletions confirmed so far,
 * plus the run's allowlisted scope/days. Module-scoped so main().catch can
 * render the partial audit line even when main() throws mid-run — completed
 * deletions must never escape the audit trail on an exit-1 failure. Counts
 * only confirmed forgetMemory deletions (dry-run would-delete never touches
 * it). Fields stay on the strict allowlist: scope, days, deleted, at.
 */
const audit = { scope: "unknown", days: 0, deleted: 0 };

interface CliArgs {
  days: number;
  project: string | undefined;
  all: boolean;
  dryRun: boolean;
}

function failUsage(message: string): never {
  console.error(`purge: ${oneLine(message)}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliArgs {
  let days: number | undefined;
  let project: string | undefined;
  let all = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--days" || arg === "--project" || arg === "--all") {
      const raw = arg === "--all" ? undefined : argv[++i];
      if (arg === "--all") {
        if (project !== undefined) failUsage("--all and --project are mutually exclusive");
        all = true;
        continue;
      }
      if (raw === undefined || raw === "") failUsage(`${arg} requires a value`);
      if (arg === "--days") {
        if (!/^[1-9][0-9]{0,5}$/.test(raw)) {
          failUsage(`--days must be an integer >= 1 (got "${raw}") — days=0 would delete EVERYTHING`);
        }
        days = Number(raw);
      } else {
        if (all) failUsage("--project and --all are mutually exclusive");
        project = raw;
      }
      continue;
    }
    failUsage(`unknown argument "${arg}"`);
  }

  if (days === undefined) failUsage("missing required --days");
  if (project === undefined && !all) failUsage("exactly one of --project or --all is required");
  if (project !== undefined && all) failUsage("--project and --all are mutually exclusive");
  return { days, project, all, dryRun };
}

/** Never log query values — only the error's own message (bootstrap pattern). */
function describeError(err: unknown): string {
  if (err instanceof HelixError) {
    return `${err.kind}: ${err.message}${err.details === undefined ? "" : ` — ${err.details}`}`;
  }
  if (err instanceof Error) return `${err.constructor.name}: ${err.message}`;
  return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First finite number at/inside `value` (count responses vary in shape). */
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

function findCount(response: unknown, hint: string, depth = 0): number | undefined {
  if (depth > 4 || !isRecord(response)) return undefined;
  for (const [key, entry] of Object.entries(response)) {
    if (key.toLowerCase().includes(hint)) {
      const direct = firstNumber(entry, 0);
      if (direct !== undefined) return direct;
    }
  }
  for (const entry of Object.values(response)) {
    const found = findCount(entry, hint, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

interface Health {
  memories: number;
  sessions: number;
}

async function healthOf(client: Client, project: string): Promise<Health> {
  const res = await client
    .query<unknown>(healthCount().toQueryRequest(healthCountParams, { project }))
    .send();
  const memories = findCount(res, "mem");
  const sessions = findCount(res, "sess");
  if (memories === undefined || sessions === undefined) {
    throw new Error(`healthCount response missing counts for project=${project}`);
  }
  return { memories, sessions };
}

/** memoryId rows from a listExpired response (fail-closed on bad shapes). */
function expiredIds(response: unknown): string[] {
  if (!isRecord(response)) throw new Error("listExpired response is not an object");
  const rows = response["expired"];
  if (rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error("listExpired 'expired' is not an array");
  const ids: string[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row["memoryId"] !== "string" || row["memoryId"] === "") {
      throw new Error("listExpired row missing memoryId");
    }
    ids.push(row["memoryId"]);
  }
  return ids;
}

/**
 * forgetMemory returns ["target", "forgotten"]: a returned row (even $id 0),
 * positive count, or true means deleted; {}, [], null, 0, false mean not
 * found. Same bounded inference as store.ts indicatesPresence.
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

/** Distinct projects from Session nodes (saveMemory upserts one per project). */
async function discoverProjects(client: Client): Promise<string[]> {
  const res = await client
    .query<unknown>(
      listProjects().toQueryRequest(listProjectsParams, { limit: BigInt(SESSION_SCAN_LIMIT) }),
    )
    .send();
  if (!isRecord(res)) throw new Error("listProjects response is not an object");
  const rows = res["projects"];
  const unique = new Set<string>();
  if (rows !== null && rows !== undefined) {
    if (!Array.isArray(rows)) throw new Error("listProjects 'projects' is not an array");
    for (const row of rows) {
      if (isRecord(row) && typeof row["project"] === "string" && row["project"] !== "") {
        unique.add(row["project"]);
      }
    }
  }
  return [...unique].sort();
}

interface ProjectResult {
  project: string;
  deleted: number;
  before: Health;
  after: Health;
}

async function purgeProject(
  client: Client,
  project: string,
  cutoff: string,
  dryRun: boolean,
): Promise<ProjectResult> {
  if (dryRun) {
    const res = await client
      .query<unknown>(
        listExpired().toQueryRequest(listExpiredParams, {
          project,
          cutoff,
          limit: BigInt(DRY_RUN_LIMIT),
        }),
      )
      .send();
    const ids = expiredIds(res);
    if (ids.length >= DRY_RUN_LIMIT) {
      console.error(`purge-dry-run: page cap ${DRY_RUN_LIMIT} reached for ${oneLine(project)} — count may be higher`);
    }
    for (const id of ids) console.log(oneLine(id)); // ids only (spec: count + ids)
    return { project, deleted: ids.length, before: { memories: 0, sessions: 0 }, after: { memories: 0, sessions: 0 } };
  }

  const before = await healthOf(client, project);
  let deleted = 0;
  for (let batch = 1; ; batch++) {
    if (batch > MAX_BATCHES) {
      throw new Error(`no completion after ${MAX_BATCHES} batches (limit ${BATCH_LIMIT}) — aborting`);
    }
    const res = await client
      .query<unknown>(
        listExpired().toQueryRequest(listExpiredParams, {
          project,
          cutoff,
          limit: BigInt(BATCH_LIMIT),
        }),
      )
      .send();
    const ids = expiredIds(res);
    if (ids.length === 0) break;
    let batchDeleted = 0;
    for (const memoryId of ids) {
      const fr = await client
        .query<unknown>(forgetMemory().toQueryRequest(forgetMemoryParams, { memoryId }))
        .send();
      if (indicatesPresence(fr)) {
        deleted += 1;
        batchDeleted += 1;
        audit.deleted += 1; // failure-path audit cursor (OPS-001/C2)
      }
    }
    // Per-batch progress (allowlisted counts only) — RL-002/C6 compensating
    // control: the operator sees liveness even though the SDK offers no
    // request timeout. stderr, like the plan line; single-line via oneLine.
    console.error(
      `purge-progress project=${oneLine(project)} batch=${oneLine(batch)} deleted=${oneLine(deleted)}`,
    );
    if (batchDeleted === 0) {
      throw new Error(
        `batch of ${ids.length} produced 0 deletions — aborting (no-progress guard, fail closed)`,
      );
    }
  }
  const after = await healthOf(client, project);
  return { project, deleted, before, after };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env["HELIX_URL"] ?? "http://localhost:6969";
  const client = Client.server(url);
  const cutoff = new Date(Date.now() - args.days * MS_PER_DAY).toISOString();
  const scope = args.all ? "all" : (args.project ?? "all");

  // Failure-path audit cursor (OPS-001/C2): scope + days land here BEFORE the
  // first query, so any later failure can render a complete partial line.
  audit.scope = scope;
  audit.days = args.days;

  // Plan line before any destructive action (allowlisted fields only).
  console.error(
    `purge-plan project=${oneLine(scope)} days=${oneLine(args.days)} cutoff=${oneLine(cutoff)} dry_run=${oneLine(args.dryRun)}`,
  );

  const projects = args.all ? await discoverProjects(client) : [args.project ?? ""];
  if (args.all && projects.length === 0) {
    console.error("purge: --all found no projects (no Session nodes) — nothing to do");
  }

  let totalDeleted = 0;
  const results: ProjectResult[] = [];
  for (const project of projects) {
    if (project === "") continue;
    // A mid-loop throw propagates to main().catch, which renders the partial
    // audit line from `audit.deleted` before exiting 1 (OPS-001/C2).
    const result = await purgeProject(client, project, cutoff, args.dryRun);
    results.push(result);
    totalDeleted += result.deleted;
  }

  if (args.dryRun) {
    console.log(
      `purge-dry-run project=${oneLine(scope)} days=${oneLine(args.days)} would-delete=${oneLine(totalDeleted)} at=${oneLine(new Date().toISOString())}`,
    );
    return;
  }

  // healthCount before/after (counts only) — one pair per purged project.
  for (const r of results) {
    console.log(
      `purge-health project=${oneLine(r.project)} phase=before memories=${oneLine(r.before.memories)} sessions=${oneLine(r.before.sessions)}`,
    );
  }
  for (const r of results) {
    console.log(
      `purge-health project=${oneLine(r.project)} phase=after memories=${oneLine(r.after.memories)} sessions=${oneLine(r.after.sessions)}`,
    );
  }

  // ONE governance line (allowlisted fields: project, days, deleted, at).
  console.log(
    `purge project=${oneLine(scope)} days=${oneLine(args.days)} deleted=${oneLine(totalDeleted)} at=${oneLine(new Date().toISOString())}`,
  );
}

main().catch((err: unknown) => {
  // OPS-001/C2: record deletions already performed BEFORE the failure exit.
  // Same four allowlisted fields as the governance line plus the fixed
  // literal `status=partial` (a discriminator, never data/content) so a
  // failed run's `deleted=` is never mistaken for a completed run's. No
  // deletions -> no line; usage errors exit 2 before any deletion exists.
  if (audit.deleted > 0) {
    console.log(
      `purge project=${oneLine(audit.scope)} days=${oneLine(audit.days)} deleted=${oneLine(audit.deleted)} at=${oneLine(new Date().toISOString())} status=partial`,
    );
  }
  console.error(`purge failed: ${oneLine(describeError(err))}`);
  process.exit(1);
});
