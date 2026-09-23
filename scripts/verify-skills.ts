/**
 * Skill-set verification (REQ-P3-2) — structural + LIVE round-trip.
 *
 * PART 1 (no server needed): each of the 8 skill dirs has a SKILL.md whose
 * frontmatter parses (name + description present, non-empty, name === dirname,
 * description >= 80 chars), whose body cites its FROZEN contract route(s) and
 * MCP tool name(s) — expected values come from the explicit SKILL_CONTRACTS
 * table below, NEVER inferred from the file under test — and whose text
 * contains no obvious secret patterns (ghp_/sk-/AKIA/AGENT_MEMORY_SECRET=…).
 * skills/memory/SKILL.md (the index) must list all 8 skill names.
 *
 * PART 2 (live, contract acceptance): base URL from AGENT_MEMORY_URL (default
 * http://127.0.0.1:3111). Identity guard runs FIRST exactly like
 * scripts/verify.ts — read-only POST /memory/recap {}; 200 proves OUR P3.1
 * server, anything else aborts BEFORE any write (never touch a foreign
 * target — 3111 may be the upstream agentmemory). Then GET /memory/livez,
 * then EVERY skill's route exercised in one flow under the dedicated
 * `verify-skills` project (other suites share this Helix instance), with
 * best-effort cleanup of the 4 memory rows created here (Session nodes
 * persist — run budget + declaration in docs/CONTRACT.md §5).
 * Authorization is attached
 * automatically when AGENT_MEMORY_SECRET is set in this shell (same env as
 * the server) — the value is never printed.
 *
 * Output: PASS/FAIL lines, summary `N passed, M failed` + the mode line,
 * `VERIFY SKILLS PASS` / `VERIFY SKILLS FAIL`. Exit 1 on any failure, and
 * exit 1 with a clear abort message when the target is unreachable/not ours.
 *
 * Run modes:
 *   (default)             PART 1 + PART 2 — structural + LIVE round-trip
 *                         (119 checks; needs a running OUR-server target).
 *   --structural          PART 1 ONLY — 73 checks, no server, no network,
 *                         no writes: the CI-safe skills contract gate.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { logSafeNote } from "../src/errors.js";

const BASE_RAW = process.env["AGENT_MEMORY_URL"] ?? "http://127.0.0.1:3111";
const BASE = new URL(BASE_RAW.endsWith("/") ? BASE_RAW : `${BASE_RAW}/`);
const SECRET = process.env["AGENT_MEMORY_SECRET"];
const PROJECT = "verify-skills";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_ROOT = join(REPO_ROOT, "skills");

/* ------------------------------------------------------------------ */
/* Assertion plumbing (same shape as scripts/verify.ts)                */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

function shape<T>(name: string, body: unknown, schema: z.ZodType<T>): T | undefined {
  const result = schema.safeParse(body);
  if (result.success) {
    passed += 1;
    console.log(`PASS  ${name}`);
    return result.data;
  }
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  failures.push(name);
  console.log(`FAIL  ${name} — ${detail} — body=${brief(body)}`);
  return undefined;
}

function brief(body: unknown): string {
  try {
    return (JSON.stringify(body) ?? "undefined").slice(0, 300);
  } catch {
    return String(body).slice(0, 300);
  }
}

function abort(message: string): never {
  console.error(message);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* PART 1 — structural (hardcoded contract table, never file-inferred) */
/* ------------------------------------------------------------------ */

interface SkillContract {
  readonly dir: string;
  /** Every contract route path the body must cite (§3 frozen table). */
  readonly routes: readonly string[];
  /** Every MCP tool name the body must cite (contract §3, 11-tool list). */
  readonly tools: readonly string[];
}

const SKILL_CONTRACTS: readonly SkillContract[] = [
  { dir: "recall", routes: ["/memory/smart-search", "/memory/search"], tools: ["memory_smart_search", "memory_search"] },
  { dir: "remember", routes: ["/memory/remember"], tools: ["memory_save"] },
  { dir: "recap", routes: ["/memory/recap"], tools: ["memory_recap"] },
  { dir: "handoff", routes: ["/memory/handoff"], tools: ["memory_handoff"] },
  { dir: "forget", routes: ["/memory/forget", "/memory/delete"], tools: ["memory_forget", "memory_delete"] },
  { dir: "lesson", routes: ["/memory/lesson"], tools: ["memory_lesson"] },
  { dir: "commit-context", routes: ["/memory/remember", "/memory/smart-search"], tools: ["memory_save", "memory_smart_search"] },
  {
    dir: "session-history",
    routes: ["/memory/sessions", "/memory/sessions/:sessionId/memories"],
    tools: ["memory_sessions", "memory_session_memories"],
  },
];

const MIN_DESCRIPTION_CHARS = 80;

const SECRET_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: "GitHub token (ghp_)", pattern: /ghp_[A-Za-z0-9]{8,}/ },
  { label: "API key (sk-)", pattern: /sk-[A-Za-z0-9_-]{8,}/ },
  { label: "AWS access key (AKIA)", pattern: /AKIA[A-Z0-9]{16}/ },
  { label: "AGENT_MEMORY_SECRET with a value", pattern: /AGENT_MEMORY_SECRET=\S+/ },
];

interface Frontmatter {
  readonly name: string;
  readonly description: string;
}

function parseFrontmatter(text: string): { ok: true; data: Frontmatter } | { ok: false; error: string } {
  const lines = text.split("\n");
  if (lines[0] !== "---") return { ok: false, error: "no opening `---` frontmatter fence" };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { ok: false, error: "no closing `---` frontmatter fence" };
  let name = "";
  let description = "";
  let sawName = false;
  let sawDescription = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i] ?? "";
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "name") {
      name = value;
      sawName = true;
    } else if (key === "description") {
      description = value;
      sawDescription = true;
    }
  }
  if (!sawName || !sawDescription) {
    return { ok: false, error: `missing ${!sawName && !sawDescription ? "name + description" : !sawName ? "name" : "description"}` };
  }
  if (name.length === 0 || description.length === 0) return { ok: false, error: "empty name or description" };
  return { ok: true, data: { name, description } };
}

function verifyStructural(): void {
  console.log("/* PART 1 — structural (no server needed) */");
  for (const contract of SKILL_CONTRACTS) {
    const file = join(SKILLS_ROOT, contract.dir, "SKILL.md");
    const exists = existsSync(file);
    check(`${contract.dir}: SKILL.md exists`, exists, file);
    if (!exists) continue;

    const text = readFileSync(file, "utf8");
    const parsed = parseFrontmatter(text);
    check(
      `${contract.dir}: frontmatter parses (name + description non-empty)`,
      parsed.ok,
      parsed.ok ? undefined : parsed.error,
    );
    if (!parsed.ok) continue;

    check(`${contract.dir}: name === dirname ("${contract.dir}")`, parsed.data.name === contract.dir, parsed.data.name);
    check(
      `${contract.dir}: description >= ${MIN_DESCRIPTION_CHARS} chars`,
      parsed.data.description.length >= MIN_DESCRIPTION_CHARS,
      `${parsed.data.description.length} chars`,
    );
    for (const route of contract.routes) {
      check(`${contract.dir}: body cites contract route ${route}`, text.includes(route));
    }
    for (const tool of contract.tools) {
      check(`${contract.dir}: body cites MCP tool ${tool}`, text.includes(tool));
    }
    const hit = SECRET_PATTERNS.find((entry) => entry.pattern.test(text));
    check(`${contract.dir}: no secret-like pattern`, hit === undefined, hit?.label);
  }

  const indexFile = join(SKILLS_ROOT, "memory", "SKILL.md");
  const indexExists = existsSync(indexFile);
  check("memory index: skills/memory/SKILL.md exists", indexExists, indexFile);
  if (indexExists) {
    const indexText = readFileSync(indexFile, "utf8");
    for (const contract of SKILL_CONTRACTS) {
      check(`memory index: lists skill "${contract.dir}"`, indexText.includes(contract.dir));
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP client (URL + searchParams, no string-built URLs)              */
/* ------------------------------------------------------------------ */

interface HttpResult {
  status: number;
  body: unknown;
}

function endpoint(path: string, query?: Record<string, string>): URL {
  const url = new URL(path.replace(/^\//, ""), BASE);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return url;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (typeof SECRET === "string" && SECRET.length > 0) {
    headers["authorization"] = `Bearer ${SECRET}`;
  }
  return headers;
}

async function call(
  method: string,
  path: string,
  query?: Record<string, string>,
  body?: unknown,
): Promise<HttpResult> {
  const headers = authHeaders(body !== undefined ? { "content-type": "application/json" } : {});
  try {
    const response = await fetch(endpoint(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  } catch (err) {
    return { status: -1, body: logSafeNote(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Expected shapes (contract §3)                                       */
/* ------------------------------------------------------------------ */

const rememberResultSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  project: z.string(),
  concepts: z.array(z.string()),
  deduped: z.boolean().optional(),
  consolidated: z.boolean().optional(),
});

const memoryRowShape = {
  id: z.string(),
  memoryId: z.string(),
  content: z.string(),
  sessionId: z.string(),
  origin: z.string(),
  importance: z.number(),
  createdAt: z.string(),
};

const searchRowShape = { ...memoryRowShape, score: z.number() };

const bm25EnvelopeSchema = z.object({
  mode: z.literal("bm25"),
  results: z.array(z.object({ ...searchRowShape, source: z.literal("text") })),
  signals: z.array(z.string()),
});

const hybridEnvelopeSchema = z.object({
  mode: z.literal("hybrid"),
  results: z.array(
    z.object({
      ...searchRowShape,
      source: z.enum(["vector", "text", "graph"]),
      signals: z.array(z.string()),
    }),
  ),
  signals: z.array(z.string()),
});

const sessionsEnvelopeSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      project: z.string(),
      startedAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

const memoriesEnvelopeSchema = z.object({ memories: z.array(z.object(memoryRowShape)) });

const recapEnvelopeSchema = z.object({
  recap: z.string(),
  sessionId: z.string().nullable(),
  count: z.number(),
  signals: z.array(z.string()),
});

const handoffEnvelopeSchema = z.object({
  handoff: z.string(),
  sessionId: z.string().nullable(),
  counts: z.object({ memories: z.number(), sessions: z.number() }),
  signals: z.array(z.string()),
});

const deleteResultSchema = z.object({
  deleted: z.literal(true),
  receipt: z.object({ memoryId: z.string(), deletedAt: z.string().min(1) }),
});

const notFoundSchema = z.object({ error: z.literal("not_found") });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ------------------------------------------------------------------ */
/* PART 2 — live round-trip vs the REST contract                       */
/* ------------------------------------------------------------------ */

async function verifyRoundTrip(): Promise<void> {
  console.log("\n/* PART 2 — live round-trip (contract acceptance) */");

  /* Identity guard (read-only) — BEFORE the first write, same probe as
   * scripts/verify.ts: POST /memory/recap with {} is our P3.1 surface
   * (every field optional) and reads nothing. 200 => OUR server; 404 /
   * connection failure / 401 => abort with NO writes (3111 may be the
   * upstream agentmemory — never write to a foreign target). */
  const identity = await call("POST", "/memory/recap", undefined, {});
  if (identity.status === -1) {
    abort(
      [
        "",
        `identity guard: POST ${endpoint("memory/recap").href} unreachable (${String(identity.body)})`,
        `no data was written. Start our server and point this suite at it:`,
        "",
        "  AGENT_MEMORY_URL=http://127.0.0.1:<our-port> npx tsx scripts/verify-skills.ts",
        "",
        "(default 3111; ours runs on 3151 when upstream holds 3111 — never kill upstream)",
        "",
      ].join("\n"),
    );
  }
  if (identity.status !== 200) {
    abort(
      [
        "",
        `identity guard: POST ${endpoint("memory/recap").href} -> ${identity.status} (body=${brief(identity.body)})`,
        "expected 200 from OUR P3.1 server — the upstream `agentmemory` most likely holds this",
        "port (3111 is its default; see README \"Known limitations\" → port conflict). Point this",
        "suite at OUR server instead, then re-run:",
        "",
        "  AGENT_MEMORY_URL=http://127.0.0.1:<our-port> npx tsx scripts/verify-skills.ts",
        "",
        "No data was written.",
        "",
      ].join("\n"),
    );
  }
  console.log("identity: POST /memory/recap -> 200 (our P3.1 server), proceeding");

  const livez = await call("GET", "/memory/livez");
  if (livez.status === -1) {
    abort(`\nserver not reachable at ${BASE.href} — start it first: npx tsx src/server.ts\n`);
  }
  check("livez: status 200", livez.status === 200, `got ${livez.status}`);
  shape("livez: {status:'ok'}", livez.body, z.object({ status: z.literal("ok") }));

  const nonce = randomUUID().replace(/-/g, "");
  const sidRemember = `verify-skills-r-${randomUUID().slice(0, 8)}`;
  const sidLesson = `verify-skills-l-${randomUUID().slice(0, 8)}`;
  const sidCommit = `verify-skills-c-${randomUUID().slice(0, 8)}`;

  /* remember — POST /memory/remember -> 201 with id + derived concepts. */
  const rem = await call("POST", "/memory/remember", undefined, {
    content: `REQ-P3-2 remember round-trip probe ${nonce}`,
    project: PROJECT,
    sessionId: sidRemember,
    origin: "rest",
  });
  check("remember: POST /memory/remember -> 201", rem.status === 201, `got ${rem.status}; body=${brief(rem.body)}`);
  const rRem = shape(
    "remember: 201 {id, sessionId, project, concepts, deduped, consolidated}",
    rem.body,
    rememberResultSchema,
  );
  if (rRem !== undefined) {
    check("remember: echoes sessionId", rRem.sessionId === sidRemember, rRem.sessionId);
    check("remember: echoes project", rRem.project === PROJECT, rRem.project);
    check("remember: id is a uuid", UUID_RE.test(rRem.id), rRem.id);
    check(
      "remember: concepts present (derived when omitted, non-empty)",
      rRem.concepts.length > 0,
      JSON.stringify(rRem.concepts),
    );
    check("remember: deduped false on novel insert", rRem.deduped === false, String(rRem.deduped));
    check("remember: consolidated false on novel insert", rRem.consolidated === false, String(rRem.consolidated));
  }
  if (rRem === undefined) {
    throw new Error("aborting: remember step failed (see FAIL lines above)");
  }

  /* lesson — POST /memory/lesson -> 201 (no origin field, forced server-side). */
  const les = await call("POST", "/memory/lesson", undefined, {
    content: `REQ-P3-2 lesson probe: bootstrap must settle before first search ${nonce}`,
    project: PROJECT,
    sessionId: sidLesson,
  });
  check("lesson: POST /memory/lesson -> 201", les.status === 201, `got ${les.status}; body=${brief(les.body)}`);
  const rLes = shape("lesson: 201 {id, sessionId, project, concepts}", les.body, rememberResultSchema);
  check(
    "lesson: lesson rejects a caller-supplied origin key -> 400",
    (
      await call("POST", "/memory/lesson", undefined, {
        content: `origin-forbidden probe ${nonce}`,
        project: PROJECT,
        origin: "rest",
      })
    ).status === 400,
  );

  /* commit-context — save route (distinct content) + smart-search finds it. */
  const commitContent = `REQ-P3-2 commit-context checkpoint decision frozen routes state skills green next typecheck ${nonce}`;
  const com = await call("POST", "/memory/remember", undefined, {
    content: commitContent,
    project: PROJECT,
    sessionId: sidCommit,
    origin: "rest",
  });
  check("commit-context: save via POST /memory/remember -> 201", com.status === 201, `got ${com.status}`);
  const rCom = shape("commit-context: save body shape", com.body, rememberResultSchema);

  const cs = await call("POST", "/memory/smart-search", undefined, {
    query: `commit-context checkpoint ${nonce}`,
    project: PROJECT,
    limit: 10,
  });
  check("commit-context: smart-search -> 200", cs.status === 200, `got ${cs.status}; body=${brief(cs.body)}`);
  const csh = shape("commit-context: hybrid envelope", cs.body, hybridEnvelopeSchema);
  check(
    "commit-context: smart-search finds the saved checkpoint",
    csh !== undefined &&
      rCom !== undefined &&
      csh.results.length > 0 &&
      csh.results.some((row) => row.memoryId === rCom.id),
    csh === undefined ? "no envelope" : `hits=${csh.results.length}`,
  );

  /* recall — POST /memory/search (bm25) + POST /memory/smart-search (hybrid). */
  const bm = await call("POST", "/memory/search", undefined, { query: nonce, project: PROJECT, limit: 10 });
  check("recall: POST /memory/search -> 200", bm.status === 200, `got ${bm.status}; body=${brief(bm.body)}`);
  const bmEnv = shape("recall: {mode:'bm25', results, signals}", bm.body, bm25EnvelopeSchema);
  check("recall: bm25 results non-empty", bmEnv !== undefined && bmEnv.results.length > 0, `hits=${bmEnv?.results.length}`);

  const hy = await call("POST", "/memory/smart-search", undefined, {
    query: nonce,
    project: PROJECT,
    limit: 10,
  });
  check("recall: POST /memory/smart-search -> 200", hy.status === 200, `got ${hy.status}; body=${brief(hy.body)}`);
  const hyEnv = shape("recall: {mode:'hybrid', results, signals}", hy.body, hybridEnvelopeSchema);
  const firstHy = hyEnv?.results[0];
  check(
    "recall: hybrid results non-empty and carry signals[]",
    firstHy !== undefined && Array.isArray(firstHy.signals),
    hyEnv === undefined ? "no envelope" : `hits=${hyEnv.results.length}`,
  );

  /* session-history — sessions list -> pick sid -> its memories. */
  const ses = await call("GET", "/memory/sessions", { project: PROJECT, limit: "100" });
  check("session-history: GET /memory/sessions -> 200", ses.status === 200, `got ${ses.status}; body=${brief(ses.body)}`);
  const sesEnv = shape("session-history: {sessions:[…]}", ses.body, sessionsEnvelopeSchema);
  check(
    "session-history: sessions non-empty and includes the written session",
    sesEnv !== undefined && sesEnv.sessions.length > 0 && sesEnv.sessions.some((row) => row.sessionId === sidRemember),
    sesEnv === undefined ? "no envelope" : `sessions=${sesEnv.sessions.length}`,
  );

  const mem = await call("GET", `/memory/sessions/${encodeURIComponent(sidRemember)}/memories`, {
    project: PROJECT,
    limit: "100",
  });
  check(
    "session-history: GET /memory/sessions/:id/memories -> 200",
    mem.status === 200,
    `got ${mem.status}; body=${brief(mem.body)}`,
  );
  const memEnv = shape("session-history: {memories:[…]}", mem.body, memoriesEnvelopeSchema);
  check(
    "session-history: memories non-empty and includes the written row",
    memEnv !== undefined &&
      memEnv.memories.length > 0 &&
      memEnv.memories.some((row) => row.memoryId === rRem.id),
    memEnv === undefined ? "no envelope" : `memories=${memEnv.memories.length}`,
  );

  /* recap — POST /memory/recap {project} -> 200 {recap, count, signals}. */
  const rec = await call("POST", "/memory/recap", undefined, { project: PROJECT });
  check("recap: POST /memory/recap -> 200", rec.status === 200, `got ${rec.status}; body=${brief(rec.body)}`);
  const recEnv = shape("recap: {recap, sessionId, count, signals}", rec.body, recapEnvelopeSchema);
  check(
    "recap: count >= 1 and signals is an array",
    recEnv !== undefined && recEnv.count >= 1 && Array.isArray(recEnv.signals),
    recEnv === undefined ? "no envelope" : `count=${recEnv.count}`,
  );

  /* handoff — POST /memory/handoff -> 200 {handoff, counts, signals}. */
  const hof = await call("POST", "/memory/handoff", undefined, { project: PROJECT });
  check("handoff: POST /memory/handoff -> 200", hof.status === 200, `got ${hof.status}; body=${brief(hof.body)}`);
  const hofEnv = shape("handoff: {handoff, sessionId, counts, signals}", hof.body, handoffEnvelopeSchema);
  check(
    "handoff: frozen first line + counts.memories >= 1",
    hofEnv !== undefined &&
      hofEnv.handoff.startsWith(`project=${PROJECT} memories=`) &&
      hofEnv.counts.memories >= 1,
    hofEnv === undefined ? "no envelope" : hofEnv.handoff.slice(0, 80),
  );

  /* delete/governance — backs the forget skill's "audited variant" line. */
  const gov = await call("POST", "/memory/remember", undefined, {
    content: `REQ-P3-2 governance delete probe ${nonce}`,
    project: PROJECT,
  });
  check("delete: setup save -> 201", gov.status === 201, `got ${gov.status}; body=${brief(gov.body)}`);
  const rGov = shape("delete: setup body shape", gov.body, rememberResultSchema);
  if (rGov === undefined) {
    throw new Error("aborting: governance setup step failed (see FAIL lines above)");
  }
  const del = await call("POST", "/memory/delete", undefined, {
    memoryId: rGov.id,
    reason: "REQ-P3-2 audited variant round-trip",
  });
  check("delete: POST /memory/delete with reason -> 200", del.status === 200, `got ${del.status}; body=${brief(del.body)}`);
  const delEnv = shape("delete: {deleted:true, receipt:{memoryId, deletedAt}}", del.body, deleteResultSchema);
  check("delete: receipt.memoryId matches", delEnv !== undefined && delEnv.receipt.memoryId === rGov.id, delEnv?.receipt.memoryId);

  /* forget — hard delete by id: 200, then 404 on the repeat. */
  const fg = await call("POST", "/memory/forget", undefined, { memoryId: rRem.id });
  check("forget: POST /memory/forget -> 200 {forgotten:true}", fg.status === 200, `got ${fg.status}; body=${brief(fg.body)}`);
  shape("forget: {forgotten:true}", fg.body, z.object({ forgotten: z.literal(true) }));
  const fg2 = await call("POST", "/memory/forget", undefined, { memoryId: rRem.id });
  check("forget: repeat forget -> 404", fg2.status === 404, `got ${fg2.status}; body=${brief(fg2.body)}`);
  shape("forget: 404 body is {error:'not_found'}", fg2.body, notFoundSchema);

  /* Cleanup — best-effort removal of every row created in this run:
   * rRem (forget, above), rGov (governance delete, above), rLes + rCom here. */
  const remaining: { id: string; label: string }[] = [];
  if (rLes !== undefined) remaining.push({ id: rLes.id, label: "lesson" });
  if (rCom !== undefined) remaining.push({ id: rCom.id, label: "commit-context" });
  let removed = 0; // rRem (forget 200) + rGov (delete 200) already gone
  removed += 2;
  let cleanupOk = true;
  for (const row of remaining) {
    const result = await call("POST", "/memory/forget", undefined, { memoryId: row.id });
    if (result.status === 200 || result.status === 404) removed += 1;
    else cleanupOk = false;
  }
  const created = 4; // remember + lesson + commit-context + governance rows
  check(
    `cleanup: best-effort — removed ${removed}/${created} rows created in project ${PROJECT}`,
    cleanupOk && removed === created,
    `removed=${removed}, ok=${cleanupOk}`,
  );
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  // --structural: PART 1 only (server-free) — used by CI; default runs both parts.
  const structuralOnly = process.argv.includes("--structural");
  verifyStructural();
  if (!structuralOnly) await verifyRoundTrip();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(
    structuralOnly
      ? "mode: structural (PART 1 only — no server, no network, no writes)"
      : "mode: full (structural + live round-trip)",
  );
  if (failures.length > 0) {
    console.error(`VERIFY SKILLS FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY SKILLS PASS");
}

main().catch((err: unknown) => {
  console.error(`verify-skills crashed: ${logSafeNote(err)}`);
  process.exit(1);
});
