/**
 * Step 7 — Stdio MCP Server Brainy (REQ-BRAINY-ENG-10, AC-10, C1).
 *
 * In-process handshake over InMemoryTransport (no ports, no Helix):
 * - tools/list exposes the 4 native brainy_* tools + 11 memory_* aliases
 *   + 6 memory_todo_* tools (21 total), aliases flagged Deprecated.
 * - brainy_search / capture / link / reality_check round-trip.
 * - _meta.authorization bearer guard fail-closed (C1).
 * - stderr diagnostics are single-line sanitized, never secret/content.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp.js";
import type {
  BrainyStore,
  GetNoteResult,
  NoteRow,
  SaveNoteResult,
  SearchHit,
} from "../src/store.js";

const SECRET = "step7-test-secret";
const AUTH = { authorization: `Bearer ${SECRET}` };

let noteCounter = 0;

function hit(memoryId: string, content: string): SearchHit {
  return {
    id: memoryId,
    memoryId,
    content,
    sessionId: "sess-1",
    origin: "mcp",
    importance: 0.5,
    createdAt: new Date().toISOString(),
    score: 1,
  };
}

function createMockStore(): BrainyStore {
  const notes = new Map<string, NoteRow>();
  return {
    async remember(input) {
      return {
        id: "mem-1",
        sessionId: input.sessionId,
        project: input.project,
        concepts: input.concepts,
        deduped: false,
        consolidated: false,
      };
    },
    async searchByVector() {
      return [hit("mem-vec", "vector hit")];
    },
    async searchByText() {
      return [hit("mem-text", "text hit")];
    },
    async graphSearch() {
      return [];
    },
    async listSessions() {
      return [];
    },
    async sessionMemories() {
      return [];
    },
    async forget() {
      return true;
    },
    async healthCounts() {
      return { memories: 1, sessions: 0 };
    },
    async createTodo() {
      throw new Error("not implemented");
    },
    async listTodos() {
      return [];
    },
    async getTodo() {
      return undefined;
    },
    async updateTodo() {
      return undefined;
    },
    async deleteTodo() {
      return true;
    },
    async frontierTodos() {
      return [];
    },
    async saveNote(input): Promise<SaveNoteResult> {
      noteCounter += 1;
      const id = `note-${noteCounter}`;
      const note: NoteRow = {
        id,
        noteId: id,
        title: input.title,
        content: input.content,
        project: input.project ?? "default",
        paraCategory: input.paraCategory ?? "resource",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
      };
      notes.set(id, note);
      return { id, project: note.project, paraCategory: note.paraCategory, paraTarget: "inbox", deduped: false, relatedNoteIds: [] };
    },
    async listNotes(input) {
      return [...notes.values()].filter((n) => n.project === input.project);
    },
    async getNoteById(id: string, project?: string): Promise<GetNoteResult | undefined> {
      const note = notes.get(id);
      if (!note) return undefined;
      if (project && note.project !== project) return undefined;
      return { note, para: { category: note.paraCategory, name: "inbox" }, supersedes: [], relatesTo: [] };
    },
    async moveNote() {
      return true;
    },
    async distillNote(input) {
      const existing = notes.get(input.id);
      if (!existing) throw new Error("not found");
      return { ...existing, id: "distilled-1", noteId: "distilled-1" };
    },
    async forgetNote(id: string) {
      return notes.delete(id);
    },
    classifyPara() {
      return { category: "resource", target: "inbox", confidence: 0.9, reason: "mock" };
    },
    async searchNotesByVector() {
      return [];
    },
    async searchNotesByText() {
      return [];
    },
    async graphSearchNotes() {
      return [];
    },
    async traverseNoteGraph() {
      return { references: [], relates: [], belongsTo: [] };
    },
    async linkNodes(input) {
      const from = notes.get(input.fromId);
      const to = notes.get(input.toId);
      if (!from || !to || from.project !== to.project) {
        throw new Error("invalid_tenant_link: nodes must belong to the same project tenant");
      }
      return true;
    },
  };
}

async function linkedClient(store: BrainyStore, secret: string | undefined): Promise<Client> {
  const server = new McpServer({ name: "brainy", version: "1.0.0" });
  registerTools(server, store, secret);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "step7-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function payloadOf(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  assert.ok(first && first.type === "text" && typeof first.text === "string");
  return JSON.parse(first.text) as unknown;
}

test("Step 7: tools/list exposes 4 brainy_* tools + 17 legacy aliases (21 total)", async () => {
  const client = await linkedClient(createMockStore(), SECRET);
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  for (const native of ["brainy_search", "brainy_capture", "brainy_link", "brainy_reality_check"]) {
    assert.ok(names.includes(native), `tools/list must include ${native}`);
  }
  const legacy = listed.tools.filter((t) => t.name.startsWith("memory_")).map((t) => t.name);
  assert.equal(legacy.length, 17, "11 memory_* + 6 memory_todo_* aliases stay registered");
  assert.equal(names.length, 21);
  for (const tool of listed.tools.filter((t) => t.name.startsWith("memory_"))) {
    assert.match(tool.description ?? "", /Deprecated alias/, `${tool.name} carries a deprecation note`);
  }
  await client.close();
});

test("Step 7: brainy_search hybrid round-trip with RRF scores", async () => {
  const client = await linkedClient(createMockStore(), SECRET);
  const result = await client.callTool(
    { name: "brainy_search", arguments: { query: "hello", project: "default", limit: 10 }, _meta: AUTH },
  );
  assert.equal(result.isError, undefined);
  const payload = payloadOf(result) as { mode: string; results: Array<{ score: number }>; signals: string[] };
  assert.equal(payload.mode, "hybrid");
  assert.ok(payload.results.length >= 2, "vector + text hits fuse");
  for (const row of payload.results) assert.ok(row.score > 0, "RRF score assigned");
  await client.close();
});

test("Step 7: brainy_capture stores a note with PARA target", async () => {
  const client = await linkedClient(createMockStore(), SECRET);
  const result = await client.callTool(
    {
      name: "brainy_capture",
      arguments: { content: "capture me", title: "t", project: "default", tags: ["a"] },
      _meta: AUTH,
    },
  );
  const payload = payloadOf(result) as { id: string; project: string; paraCategory: string };
  assert.ok(payload.id.startsWith("note-"));
  assert.equal(payload.project, "default");
  await client.close();
});

test("Step 7: brainy_link same-tenant ok, cross-tenant rejected", async () => {
  const store = createMockStore();
  const client = await linkedClient(store, SECRET);
  const first = payloadOf(
    await client.callTool(
      { name: "brainy_capture", arguments: { content: "aaa", project: "default" }, _meta: AUTH },
    ),
  ) as { id: string };
  const second = payloadOf(
    await client.callTool(
      { name: "brainy_capture", arguments: { content: "bbb", project: "default" }, _meta: AUTH },
    ),
  ) as { id: string };
  const other = payloadOf(
    await client.callTool(
      { name: "brainy_capture", arguments: { content: "ccc", project: "other" }, _meta: AUTH },
    ),
  ) as { id: string };

  const linked = payloadOf(
    await client.callTool(
      {
        name: "brainy_link",
        arguments: { fromId: first.id, toId: second.id, type: "REFERENCES", project: "default" },
        _meta: AUTH,
      },
    ),
  ) as { linked: boolean };
  assert.equal(linked.linked, true);

  const cross = await client.callTool(
    {
      name: "brainy_link",
      arguments: { fromId: first.id, toId: other.id, type: "REFERENCES", project: "default" },
      _meta: AUTH,
    },
  );
  assert.equal(cross.isError, true);
  const crossPayload = payloadOf(cross) as { error: string };
  assert.equal(crossPayload.error, "invalid_tenant_link");
  await client.close();
});

test("Step 7: brainy_reality_check returns project context envelope", async () => {
  const client = await linkedClient(createMockStore(), SECRET);
  const result = await client.callTool(
    { name: "brainy_reality_check", arguments: { project: "default" }, _meta: AUTH },
  );
  const payload = payloadOf(result) as {
    project: string;
    counts: { memories: number };
    notes: unknown[];
    signals: string[];
  };
  assert.equal(payload.project, "default");
  assert.equal(payload.counts.memories, 1);
  assert.deepEqual(payload.signals, []);
  await client.close();
});

test("Step 7: bearer guard fail-closed without or with wrong _meta.authorization (C1)", async () => {
  const client = await linkedClient(createMockStore(), SECRET);
  const noMeta = await client.callTool({ name: "brainy_reality_check", arguments: { project: "default" } });
  assert.equal(noMeta.isError, true);
  const noMetaText = (noMeta.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(noMetaText, /unauthorized/);
  const wrongSecret = await client.callTool({
    name: "brainy_reality_check",
    arguments: { project: "default" },
    _meta: { authorization: "Bearer wrong" },
  });
  assert.equal(wrongSecret.isError, true);
  const wrongText = (wrongSecret.content as Array<{ text?: string }>)[0]?.text ?? "";
  assert.match(wrongText, /unauthorized/);
  // Legacy alias is guarded by the same rule.
  const legacyNoMeta = await client.callTool({ name: "memory_save", arguments: { content: "x" } });
  assert.equal(legacyNoMeta.isError, true);
  // Correct bearer passes.
  const okResult = await client.callTool(
    { name: "memory_save", arguments: { content: "x" }, _meta: AUTH },
  );
  assert.equal(okResult.isError, undefined);
  await client.close();
});

test("Step 7: open guard when no secret is configured", async () => {
  const client = await linkedClient(createMockStore(), undefined);
  const result = await client.callTool({ name: "brainy_reality_check", arguments: {} });
  assert.equal(result.isError, undefined);
  await client.close();
});

test("Step 7: stderr diagnostics are single-line sanitized, never secret/content", async () => {
  const store = createMockStore();
  store.saveNote = async () => {
    throw new Error("boom-failure-marker");
  };
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const client = await linkedClient(store, SECRET);
    const result = await client.callTool(
      { name: "brainy_capture", arguments: { content: "super-secret-content", project: "default" }, _meta: AUTH },
      undefined,
      { timeout: 5000 },
    ).catch(() => undefined);
    assert.ok(result !== undefined && result.isError === true, "store failure surfaces as isError");
    await client.close();
  } finally {
    console.error = original;
  }
  assert.ok(lines.length >= 1, "one diagnostic line on stderr");
  for (const line of lines) {
    assert.ok(!line.includes("\n"), "diagnostic is a single line");
    assert.ok(!line.includes(SECRET), "diagnostic never carries the secret");
    assert.ok(!line.includes("super-secret-content"), "diagnostic never carries note content");
    assert.match(line, /^\[brainy mcp\] brainy_capture: /, "brainy stderr prefix");
  }
});
