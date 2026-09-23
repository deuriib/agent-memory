/**
 * scripts/summarize-session.ts — P2.4 session summarization (deterministic).
 *
 *   npx tsx scripts/summarize-session.ts --session-id <s> [--project <p>]
 *     [--limit <n>] [--dry-run]
 *
 * Reads GET /memory/sessions/:id/memories, builds a deterministic summary +
 * lessons via src/summarize.ts (no LLM, no network beyond the REST service),
 * and saves them as POST /memory/lesson rows under the SAME sessionId so a
 * closed session is retrievable by session (P2.4 acceptance).
 *
 * Empty sessions print a plan line and exit 0 without writing (nothing to
 * summarize). Content is never printed — stdout carries counts/ids only
 * (oneLine-guarded, CWE-117). Opt-in auto-wire: chain this script after a
 * SessionEnd hook with AGENT_MEMORY_SUMMARIZE=1 (capture.mjs itself stays a
 * single-observation, exit-0 hook by design and never fans out here).
 *
 * Exit codes: 0 success · 1 operational failure · 2 usage/validation error.
 */
import { fileURLToPath } from "node:url";
import { oneLine } from "../src/logline.js";
import { buildSessionSummary, type SummaryMemory } from "../src/summarize.js";

const USAGE =
  "usage: npx tsx scripts/summarize-session.ts --session-id <s> [--project <p>] [--limit <n>] [--dry-run]";

interface CliArgs {
  sessionId: string;
  project: string | undefined;
  limit: number;
  dryRun: boolean;
}

function failUsage(message: string): never {
  console.error(`summarize-session: ${oneLine(message)}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliArgs {
  let sessionId: string | undefined;
  let project: string | undefined;
  let limit = 100;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--session-id" || arg === "--project" || arg === "--limit") {
      const raw = argv[++i];
      if (raw === undefined || raw === "") failUsage(`${arg} requires a value`);
      if (arg === "--session-id") sessionId = raw;
      else if (arg === "--project") project = raw;
      else {
        if (!/^[1-9][0-9]{0,2}$/.test(raw) || Number(raw) > 100) {
          failUsage(`--limit must be an integer 1..100 (got "${raw}")`);
        }
        limit = Number(raw);
      }
      continue;
    }
    failUsage(`unknown argument "${arg}"`);
  }
  if (sessionId === undefined) failUsage("missing required --session-id");
  return { sessionId, project, limit, dryRun };
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSummaryMemory(row: unknown, sessionId: string): SummaryMemory | undefined {
  if (!isBag(row)) return undefined;
  const content = row["content"];
  if (typeof content !== "string" || content.trim() === "") return undefined;
  const origin = typeof row["origin"] === "string" ? row["origin"] : "";
  const importance = typeof row["importance"] === "number" && Number.isFinite(row["importance"])
    ? row["importance"]
    : 0.5;
  const createdAt = typeof row["createdAt"] === "string" ? row["createdAt"] : "";
  const sid = typeof row["sessionId"] === "string" && row["sessionId"] !== "" ? row["sessionId"] : sessionId;
  return { content, origin, importance, createdAt, sessionId: sid };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env["AGENT_MEMORY_URL"] ?? "http://127.0.0.1:3111";
  const project = args.project ?? process.env["AGENT_MEMORY_PROJECT"] ?? "default";
  const secret = process.env["AGENT_MEMORY_SECRET"];
  const headers: Record<string, string> = { accept: "application/json" };
  if (typeof secret === "string" && secret.length > 0) headers["authorization"] = `Bearer ${secret}`;

  let listUrl: URL;
  try {
    const root = base.endsWith("/") ? base : `${base}/`;
    listUrl = new URL(
      `memory/sessions/${encodeURIComponent(args.sessionId)}/memories?project=${encodeURIComponent(project)}&limit=${args.limit}`,
      root,
    );
  } catch {
    console.error("summarize-session failed: invalid AGENT_MEMORY_URL");
    process.exit(1);
  }

  let listRes: Response;
  try {
    listRes = await fetch(listUrl, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    console.error(`summarize-session failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  }
  if (!listRes.ok) {
    console.error(`summarize-session failed: HTTP ${oneLine(listRes.status)}`);
    process.exit(1);
  }
  let listBody: unknown;
  try {
    listBody = JSON.parse(await listRes.text());
  } catch {
    console.error("summarize-session failed: unexpected response shape");
    process.exit(1);
  }
  const rows = isBag(listBody) && Array.isArray(listBody["memories"]) ? listBody["memories"] : undefined;
  if (rows === undefined) {
    console.error("summarize-session failed: unexpected response shape");
    process.exit(1);
  }
  const memories: SummaryMemory[] = [];
  for (const row of rows) {
    const m = toSummaryMemory(row, args.sessionId);
    if (m !== undefined) memories.push(m);
  }

  console.error(
    `summarize-plan project=${oneLine(project)} session=${oneLine(args.sessionId)} memories=${oneLine(memories.length)} dry_run=${oneLine(args.dryRun)}`,
  );
  if (memories.length === 0) {
    console.log(
      `summarize project=${oneLine(project)} session=${oneLine(args.sessionId)} saved=0 lessons=0 at=${oneLine(new Date().toISOString())}`,
    );
    return;
  }

  const { summary, lessons } = buildSessionSummary(memories, args.sessionId, project);
  if (args.dryRun) {
    console.log(
      `summarize-dry-run project=${oneLine(project)} session=${oneLine(args.sessionId)} memories=${oneLine(memories.length)} lessons=${oneLine(lessons.length)} at=${oneLine(new Date().toISOString())}`,
    );
    return;
  }

  let postUrl: URL;
  try {
    postUrl = new URL("memory/lesson", base.endsWith("/") ? base : `${base}/`);
  } catch {
    console.error("summarize-session failed: invalid AGENT_MEMORY_URL");
    process.exit(1);
  }
  const postHeaders: Record<string, string> = { "content-type": "application/json" };
  if (typeof secret === "string" && secret.length > 0) postHeaders["authorization"] = `Bearer ${secret}`;

  const payloads = [summary, ...lessons];
  let saved = 0;
  for (const content of payloads) {
    let res: Response;
    try {
      res = await fetch(postUrl, {
        method: "POST",
        headers: postHeaders,
        body: JSON.stringify({ content, project, sessionId: args.sessionId }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error(`summarize-session failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    }
    if (res.status !== 201) {
      console.error(`summarize-session failed: HTTP ${oneLine(res.status)}`);
      process.exit(1);
    }
    // Drain the body so keep-alive sockets do not hang the CLI.
    await res.text().catch(() => "");
    saved += 1;
  }

  console.log(
    `summarize project=${oneLine(project)} session=${oneLine(args.sessionId)} saved=${oneLine(saved)} lessons=${oneLine(lessons.length)} at=${oneLine(new Date().toISOString())}`,
  );
}

/**
 * Entry guard: direct execution only (same argv[1]-vs-module-path comparison
 * as import-transcript.ts — import.meta.url alone also matches on import).
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return fileURLToPath(import.meta.url) === process.argv[1];
    } catch {
      return false;
    }
  })();
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(`summarize-session failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
