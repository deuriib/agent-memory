/**
 * Step 9 — Operational scripts & compatibility layers
 * (REQ-BRAINY-ENG-04, REQ-BRAINY-ENG-11, NFR-02, NFR-03, C5).
 *
 * All offline (no ports, no Helix): pure mapping helpers, idempotent batch
 * migration against an in-memory sink, embedding plan helpers, and env
 * resolution for bootstrap / migrate-embeddings / import-transcript.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SQLITE_TO_HELIX_MAPPING,
  buildMigrationParams,
  mapContextName,
  mapLinkRow,
  mapMemoryStatement,
  mapMemoryType,
  mapObjectName,
  migrateBatch,
  type MigrationParams,
  type MigrationSink,
  type SqliteMemoryRow,
} from "../src/compat/agentmemory.js";
import { EMBED_DIM } from "../src/embed.js";
import { contentHash, normalizeContent } from "../src/lifecycle.js";
import { chunk, needsReembed, reembedVector, resolveMigrationUrl } from "../scripts/migrate-embeddings.js";
import { resolveBootstrapUrl } from "../scripts/bootstrap.js";
import { resolveImportEnv, rowsForLine } from "../scripts/import-transcript.js";

function sqliteRow(partial: Partial<SqliteMemoryRow> & { id: string; statement: string }): SqliteMemoryRow {
  return { ...partial };
}

function memorySink(): MigrationSink & { rows: MigrationParams[]; keys: Set<string> } {
  const rows: MigrationParams[] = [];
  const keys = new Set<string>();
  return {
    rows,
    keys,
    has: (dedupKey: string) => keys.has(dedupKey),
    insert: (params: MigrationParams) => {
      rows.push(params);
      keys.add(params.dedupKey);
    },
  };
}

test("Step 9: PRD §7.2 mapping table covers all six legacy mappings", () => {
  const pairs = new Map(SQLITE_TO_HELIX_MAPPING.map((m) => [m.from, m.to]));
  assert.equal(pairs.get("memories.statement"), "Memory.statement");
  assert.equal(pairs.get("memories.type"), "Memory.memory_type");
  assert.equal(pairs.get("objects.name"), "Resource.name");
  assert.equal(pairs.get("contexts.name"), "Context.name");
  assert.equal(pairs.get("links.about"), "E::ABOUT");
  assert.equal(pairs.get("links.context"), "E::APPLIES_TO");
});

test("Step 9: field mappings — statement verbatim, type default, names trimmed", () => {
  assert.equal(mapMemoryStatement({ id: "1", statement: "  hello  " }), "hello");
  assert.equal(mapMemoryType("episodic"), "episodic");
  assert.equal(mapMemoryType(null), "general");
  assert.equal(mapMemoryType("   "), "general");
  assert.equal(mapObjectName({ name: "  Handbook " }), "Handbook");
  assert.equal(mapContextName({ name: " work " }), "work");
});

test("Step 9: link rows map about→ABOUT and context→APPLIES_TO", () => {
  assert.deepEqual(mapLinkRow({ memory_id: "m1", about: "Handbook", context: "work" }), [
    { memoryId: "m1", target: "Handbook", edge: "ABOUT" },
    { memoryId: "m1", target: "work", edge: "APPLIES_TO" },
  ]);
  assert.deepEqual(mapLinkRow({ memory_id: "m1", about: "  ", context: null }), []);
});

test("Step 9: migration params carry store-identical dedupKey + 1536-dim embedding", () => {
  const params = buildMigrationParams(
    sqliteRow({ id: "m1", statement: "  Hello World  ", type: "semantic", project: "p1" }),
  );
  assert.equal(params.memoryId, "m1");
  assert.equal(params.content, "Hello World");
  assert.equal(params.memoryType, "semantic");
  assert.equal(params.dedupKey, contentHash("p1", normalizeContent("  Hello World  ")));
  assert.equal(params.embedding.length, EMBED_DIM);
  const norm = Math.sqrt(params.embedding.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, "L2-normalized");
  assert.ok(params.sessionId.length > 0 && params.origin.length > 0 && params.createdAt.length > 0);
});

test("Step 9: migration params clamp importance and fall back cleanly", () => {
  const clamped = buildMigrationParams(sqliteRow({ id: "a", statement: "x", importance: 5 }));
  assert.equal(clamped.importance, 1);
  const fallback = buildMigrationParams(sqliteRow({ id: "b", statement: "y", importance: Number.NaN }));
  assert.equal(fallback.importance, 0.5);
  assert.equal(fallback.project, "default");
  assert.equal(fallback.memoryType, "general");
});

test("Step 9: migrateBatch is idempotent — re-run inserts zero duplicates", async () => {
  const rows = [
    sqliteRow({ id: "m1", statement: "alpha" }),
    sqliteRow({ id: "m2", statement: "beta" }),
    sqliteRow({ id: "m3", statement: "  ALPHA " }),
    sqliteRow({ id: "m4", statement: "   " }),
  ];
  const sink = memorySink();
  const first = await migrateBatch(rows, sink);
  assert.deepEqual(first, { inserted: 2, skipped: 2 });
  assert.equal(sink.rows.length, 2);
  const second = await migrateBatch(rows, sink);
  assert.deepEqual(second, { inserted: 0, skipped: 4 });
  assert.equal(sink.rows.length, 2, "no duplicates after re-run");
});

test("Step 9: needsReembed detects stale dims, passes canonical 1536", () => {
  assert.equal(needsReembed(new Array(384).fill(0), 1536), true);
  assert.equal(needsReembed(new Array(1536).fill(0), 1536), false);
  assert.equal(needsReembed(undefined, 1536), true);
  assert.equal(needsReembed([], 1536), true);
});

test("Step 9: reembedVector is deterministic 1536-dim unit norm", () => {
  const a = reembedVector("hello world", 1536);
  const b = reembedVector("hello world", 1536);
  assert.deepEqual(a, b);
  assert.equal(a.length, 1536);
  const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});

test("Step 9: chunk splits batches and rejects non-positive sizes", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
  assert.throws(() => chunk([1], 0), /positive integer/);
});

test("Step 9: migration URL resolution prefers BRAINY_URL, falls back once", () => {
  assert.deepEqual(resolveMigrationUrl({ BRAINY_URL: "http://b:6969", HELIX_URL: "http://h:6969" }), {
    url: "http://b:6969",
    usedLegacy: false,
  });
  assert.deepEqual(resolveMigrationUrl({ HELIX_URL: "http://h:6969" }), {
    url: "http://h:6969",
    usedLegacy: true,
  });
  assert.deepEqual(resolveMigrationUrl({}), { url: "http://localhost:6969", usedLegacy: false });
});

test("Step 9: bootstrap URL resolution prefers BRAINY_URL, falls back once", () => {
  assert.deepEqual(resolveBootstrapUrl({ BRAINY_URL: "http://b:6969", HELIX_URL: "http://h:6969" }), {
    url: "http://b:6969",
    usedLegacy: false,
  });
  assert.deepEqual(resolveBootstrapUrl({ HELIX_URL: "http://h:6969" }), {
    url: "http://h:6969",
    usedLegacy: true,
  });
  assert.deepEqual(resolveBootstrapUrl({}), { url: "http://localhost:6969", usedLegacy: false });
});

test("Step 9: import-transcript env — BRAINY_* wins, legacy flags deprecation", () => {
  const canonical = resolveImportEnv(
    { BRAINY_URL: "http://b:3111", BRAINY_PROJECT: "bp", BRAINY_SECRET: "s1" },
    undefined,
  );
  assert.deepEqual(canonical, { base: "http://b:3111", project: "bp", secret: "s1", usedLegacy: false });
  const legacy = resolveImportEnv(
    { AGENT_MEMORY_URL: "http://h:3111", AGENT_MEMORY_PROJECT: "lp", AGENT_MEMORY_SECRET: "s2" },
    undefined,
  );
  assert.deepEqual(legacy, { base: "http://h:3111", project: "lp", secret: "s2", usedLegacy: true });
  const cliWins = resolveImportEnv({ BRAINY_PROJECT: "env-p", AGENT_MEMORY_PROJECT: "lp" }, "cli-p");
  assert.equal(cliWins.project, "cli-p");
  assert.equal(cliWins.usedLegacy, false);
  const defaults = resolveImportEnv({}, undefined);
  assert.deepEqual(defaults, { base: "http://127.0.0.1:3111", project: "default", secret: undefined, usedLegacy: false });
});

test("Step 9: import-transcript omits user prompts unless --include-prompts (C5)", () => {
  const userLine = { type: "user", message: { content: "my secret prompt" } };
  const assistantLine = { type: "assistant", message: { content: "answer text" } };
  assert.deepEqual(rowsForLine(userLine, false), [], "prompts skipped by default");
  const included = rowsForLine(userLine, true);
  assert.equal(included.length, 1);
  assert.equal(included[0]?.origin, "import:user");
  const assistant = rowsForLine(assistantLine, false);
  assert.equal(assistant.length, 1, "assistant text always importable");
});
