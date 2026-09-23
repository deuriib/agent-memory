/**
 * scripts/import-transcript.ts — P2.3 transcript import (script-only, no route).
 *
 *   npx tsx scripts/import-transcript.ts --file <path> [--project <p>]
 *     [--session-id <s>] [--dry-run] [--include-prompts]
 *
 * Reads a persisted session transcript (JSONL, one object per line) and makes
 * it searchable via the existing POST /memory/remember surface — no new
 * route, no new MCP tool (deliberate divergence: focused surface).
 *
 * Accepted line shapes (first match wins, unknown lines are skipped):
 *   1. Claude Code JSONL: {type:"user"|"assistant", message:{content:...}}
 *      content may be a string or an array of {type:"text",text} /
 *      {type:"tool_use",name} blocks.
 *   2. Tool-result lines: {type:"tool_result"|"tool_use", name|tool_name}
 *   3. Generic fallback: {content:"...", sessionId?, project?, origin?}
 *
 * Privacy (Ley 172-13): user prompt text is SKIPPED by default (counted as
 * skipped-prompts, never stored, never printed). --include-prompts stores it
 * verbatim as origin import:user (explicit opt-in). Content is never printed
 * — stdout carries counts/ids only (oneLine-guarded, CWE-117).
 *
 * All rows land under ONE sessionId (--session-id or derived or random) so
 * P2.4 summarization and sessionMemories work unchanged. Writes go through
 * store.remember semantics server-side (dedup + tier-1 consolidation apply).
 *
 * Exit codes: 0 success · 1 operational failure · 2 usage/validation error.
 */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { oneLine } from "../src/logline.js";

const USAGE =
  "usage: npx tsx scripts/import-transcript.ts --file <path> [--project <p>] [--session-id <s>] [--dry-run] [--include-prompts]";
const MAX_BODY_BYTES = 1_048_576;

interface CliArgs {
  file: string;
  project: string | undefined;
  sessionId: string | undefined;
  dryRun: boolean;
  includePrompts: boolean;
}

export interface ImportRow {
  content: string;
  origin: string;
}

function failUsage(message: string): never {
  console.error(`import-transcript: ${oneLine(message)}`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliArgs {
  let file: string | undefined;
  let project: string | undefined;
  let sessionId: string | undefined;
  let dryRun = false;
  let includePrompts = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--include-prompts") {
      includePrompts = true;
      continue;
    }
    if (arg === "--file" || arg === "--project" || arg === "--session-id") {
      const raw = argv[++i];
      if (raw === undefined || raw === "") failUsage(`${arg} requires a value`);
      if (arg === "--file") file = raw;
      else if (arg === "--project") project = raw;
      else sessionId = raw;
      continue;
    }
    failUsage(`unknown argument "${arg}"`);
  }
  if (file === undefined) failUsage("missing required --file");
  return { file, project, sessionId, dryRun, includePrompts };
}

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOfBlocks(blocks: unknown): { text: string; tools: string[] } {
  if (typeof blocks === "string") return { text: blocks, tools: [] };
  if (!Array.isArray(blocks)) return { text: "", tools: [] };
  const texts: string[] = [];
  const tools: string[] = [];
  for (const b of blocks) {
    if (!isBag(b)) continue;
    if (typeof b["text"] === "string") texts.push(b["text"]);
    const name = b["name"] ?? b["tool_name"];
    if (typeof name === "string" && name !== "") tools.push(name);
  }
  return { text: texts.join("\n"), tools };
}

/**
 * Map one parsed JSONL line to 0+ import rows. Pure (no env reads) so it is
 * unit-testable without I/O. includePrompts gates user text only.
 *
 * Order matters (gate P2-COMPLETE refuter): recognized `type` values dispatch
 * FIRST so a `{type:"user", content:"..."}` line can never bypass the
 * --include-prompts gate via the generic fallback. The generic fallback only
 * serves lines with NO recognized type. Caller-supplied `origin` is coerced
 * into the `import:*` namespace (data review: a crafted file must not mint
 * `lesson`/`hook:*` origins and inherit their importance base).
 */
export function rowsForLine(line: unknown, includePrompts: boolean): ImportRow[] {
  if (!isBag(line)) return [];
  const type = line["type"];
  if (type === "user" || type === "assistant" || type === "tool_result" || type === "tool_use") {
    return rowsForTyped(line, type, includePrompts);
  }
  // Generic fallback: explicit content wins verbatim, origin coerced.
  if (typeof line["content"] === "string" && line["content"].trim() !== "") {
    return [{ content: line["content"], origin: coerceImportOrigin(line["origin"]) }];
  }
  return [];
}

/** Coerce a caller-supplied origin into the `import:*` namespace. */
function coerceImportOrigin(raw: unknown): string {
  if (typeof raw === "string" && raw.trim() !== "") {
    const cleaned = raw.trim().slice(0, 100);
    if (cleaned.startsWith("import:")) return cleaned;
    return `import:${cleaned}`;
  }
  return "import:transcript";
}

function rowsForTyped(line: Record<string, unknown>, type: unknown, includePrompts: boolean): ImportRow[] {
  const message = isBag(line["message"]) ? line["message"] : line;
  const rawContent: unknown = isBag(message) ? message["content"] : undefined;
  const { text, tools } = textOfBlocks(rawContent ?? line["content"]);
  const rows: ImportRow[] = [];
  for (const tool of tools) {
    const name = tool.slice(0, 80);
    rows.push({ content: `tool used: ${name}`, origin: "import:tool" });
  }
  if (type === "tool_result" || type === "tool_use") {
    if (rows.length === 0) {
      const name = line["name"] ?? line["tool_name"];
      if (typeof name === "string" && name.trim() !== "") {
        rows.push({ content: `tool used: ${name.trim().slice(0, 80)}`, origin: "import:tool" });
      }
    }
    const isError = line["is_error"] === true || line["error"] === true;
    if (isError && rows.length > 0) {
      const first = rows[0];
      if (first !== undefined) rows[0] = { content: first.content.replace("tool used:", "tool failed:"), origin: "import:tool" };
    }
    return rows;
  }
  if (type === "user") {
    if (!includePrompts) return rows;
    if (text.trim() === "") return rows;
    return [...rows, { content: text, origin: "import:user" }];
  }
  if (type === "assistant") {
    if (text.trim() === "") return rows;
    return [...rows, { content: text, origin: "import:assistant" }];
  }
  return rows;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env["AGENT_MEMORY_URL"] ?? "http://127.0.0.1:3111";
  const project = args.project ?? process.env["AGENT_MEMORY_PROJECT"] ?? "default";
  const secret = process.env["AGENT_MEMORY_SECRET"];
  const sessionId = args.sessionId ?? randomUUID();

  let raw: string;
  try {
    raw = await readFile(args.file, "utf8");
  } catch {
    failUsage(`cannot read file "${args.file}"`);
  }

  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  let parsed = 0;
  let skippedPrompts = 0;
  const rows: ImportRow[] = [];
  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    parsed += 1;
    const before = rows.length;
    for (const r of rowsForLine(obj, args.includePrompts)) {
      if (r.content.trim() !== "") rows.push(r);
    }
    if (isBag(obj) && obj["type"] === "user" && !args.includePrompts && rows.length === before) {
      // A user line that produced no rows = a skipped prompt (or tool-only line).
      if (typeof (obj["message"] ?? obj["content"]) !== "undefined") skippedPrompts += 1;
    }
  }

  console.error(
    `import-plan file=${oneLine(args.file)} project=${oneLine(project)} session=${oneLine(sessionId)} lines=${oneLine(lines.length)} rows=${oneLine(rows.length)} dry_run=${oneLine(args.dryRun)}`,
  );
  if (args.dryRun) {
    console.log(
      `import-dry-run project=${oneLine(project)} session=${oneLine(sessionId)} parsed=${oneLine(parsed)} rows=${oneLine(rows.length)} skipped_prompts=${oneLine(skippedPrompts)} at=${oneLine(new Date().toISOString())}`,
    );
    return;
  }

  let url: URL;
  try {
    url = new URL("memory/remember", base.endsWith("/") ? base : `${base}/`);
  } catch {
    console.error("import-transcript failed: invalid AGENT_MEMORY_URL");
    process.exit(1);
  }

  let saved = 0;
  let deduped = 0;
  for (const row of rows) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (typeof secret === "string" && secret.length > 0) headers["authorization"] = `Bearer ${secret}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: row.content, project, sessionId, origin: row.origin }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error(`import-transcript failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    }
    if (res.status !== 201) {
      console.error(`import-transcript failed: HTTP ${oneLine(res.status)}`);
      process.exit(1);
    }
    const body = await res.text().catch(() => "");
    if (body.length > MAX_BODY_BYTES) {
      console.error("import-transcript failed: response too large");
      process.exit(1);
    }
    try {
      const parsedBody: unknown = JSON.parse(body);
      if (isBag(parsedBody) && parsedBody["deduped"] === true) deduped += 1;
    } catch {
      // Non-JSON 201: count as saved anyway.
    }
    saved += 1;
  }

  console.log(
    `import project=${oneLine(project)} session=${oneLine(sessionId)} saved=${oneLine(saved)} deduped=${oneLine(deduped)} skipped_prompts=${oneLine(skippedPrompts)} at=${oneLine(new Date().toISOString())}`,
  );
}

/**
 * Entry guard: run main() only when executed directly. Comparing argv[1]
 * against this module's path (not import.meta.url alone, which also matches
 * on import — gate P2-COMPLETE QA G3) keeps rowsForLine unit-testable via a
 * plain import with zero side effects.
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
    console.error(`import-transcript failed: ${oneLine(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
