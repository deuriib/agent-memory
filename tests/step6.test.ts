import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createAgentMemoryServer, createBrainyServer } from "../src/server.js";
import { secretFromEnv, _resetSecretWarningState, isBearerAuthorized } from "../src/auth.js";
import type { MemoryStore, BrainyStore, SaveNoteResult, GetNoteResult, NoteRow } from "../src/store.js";

function createMockStore(): BrainyStore {
  const notes = new Map<string, NoteRow>();
  const memories = new Map<string, { id: string; content: string; project: string }>();

  return {
    async remember(input) {
      const id = "mem-1";
      memories.set(id, { id, content: input.content, project: input.project });
      return {
        id,
        sessionId: input.sessionId,
        project: input.project,
        concepts: input.concepts,
        deduped: false,
        action: "created",
      };
    },
    async searchByVector() { return []; },
    async searchByText() { return []; },
    async graphSearch() { return []; },
    async listSessions() { return []; },
    async sessionMemories() { return []; },
    async forget() { return true; },
    async healthCounts() { return { memories: memories.size, sessions: 0 }; },
    async createTodo() { throw new Error("not implemented"); },
    async listTodos() { return []; },
    async getTodo() { return undefined; },
    async updateTodo() { return undefined; },
    async deleteTodo() { return true; },
    async frontierTodos() { return []; },
    async saveNote(input): Promise<SaveNoteResult> {
      const id = "note-123";
      const note: NoteRow = {
        id,
        title: input.title,
        content: input.content,
        project: input.project ?? "default",
        paraCategory: input.paraCategory ?? "resource",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
      };
      notes.set(id, note);
      return {
        id,
        project: note.project,
        paraCategory: note.paraCategory,
        paraTarget: input.paraTarget ?? "inbox",
        deduped: false,
        relatedNoteIds: [],
      };
    },
    async listNotes() {
      return Array.from(notes.values());
    },
    async getNoteById(id: string, project?: string): Promise<GetNoteResult | undefined> {
      const note = notes.get(id);
      if (!note) return undefined;
      if (project && note.project !== project) return undefined;
      return {
        note,
        para: { category: note.paraCategory, name: "inbox" },
        supersedes: [],
        relatesTo: [],
      };
    },
    async moveNote() { return true; },
    async distillNote(input) {
      const existing = notes.get(input.id);
      if (!existing) throw new Error("not found");
      const distilled: NoteRow = {
        id: "distilled-1",
        title: `Distilled: ${existing.title}`,
        content: input.summary ?? "Summary",
        project: existing.project,
        paraCategory: existing.paraCategory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "active",
      };
      notes.set(distilled.id, distilled);
      return distilled;
    },
    async forgetNote(id: string) {
      return notes.delete(id);
    },
    classifyPara() {
      return { category: "resource", target: "inbox", confidence: 0.9, reason: "mock" };
    },
    async searchNotesByVector() { return []; },
    async searchNotesByText() { return []; },
    async graphSearchNotes() { return []; },
    async linkNodes(input) {
      const from = await this.getNoteById(input.fromId, input.project);
      const to = await this.getNoteById(input.toId, input.project);
      if (!from || !to || from.note.project !== to.note.project) {
        throw new Error("invalid_tenant_link");
      }
      return true;
    },

  };
}

async function request(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Server not listening"));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: addr.port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: unknown = undefined;
          try {
            json = JSON.parse(body);
          } catch {
            // not json
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json,
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("Step 6: secretFromEnv resolves BRAINY_SECRET first, then AGENT_MEMORY_SECRET with warning", () => {
  _resetSecretWarningState();
  assert.equal(secretFromEnv({}), undefined);

  // BRAINY_SECRET takes precedence
  assert.equal(secretFromEnv({ BRAINY_SECRET: "s1", AGENT_MEMORY_SECRET: "s2" }), "s1");

  // AGENT_MEMORY_SECRET fallback
  _resetSecretWarningState();
  const stderrChunks: string[] = [];
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = ((chunk: any) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as any;

  try {
    const resolved = secretFromEnv({ AGENT_MEMORY_SECRET: "legacy_secret" });
    assert.equal(resolved, "legacy_secret");
    assert.ok(stderrChunks.some((c) => c.includes("WARN deprecated use BRAINY_SECRET")));
  } finally {
    process.stderr.write = originalStderrWrite;
  }
});

test("Step 6: REST /v1/notes (201) and GET /v1/notes/:id (200/404)", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    // POST /v1/notes
    const createRes = await request(server, "/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Architecture Decision Record",
        content: "We use HelixDB for graph and vectors.",
        project: "brainy",
        tags: ["adr", "architecture"],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = createRes.json as any;
    assert.equal(created.id, "note-123");
    assert.equal(created.project, "brainy");

    // GET /v1/notes/:id
    const getRes = await request(server, "/v1/notes/note-123?project=brainy");
    assert.equal(getRes.status, 200);
    const fetched = getRes.json as any;
    assert.equal(fetched.note.id, "note-123");
    assert.equal(fetched.note.title, "Architecture Decision Record");

    // GET /v1/notes/:id 404
    const notFoundRes = await request(server, "/v1/notes/nonexistent?project=brainy");
    assert.equal(notFoundRes.status, 404);
  } finally {
    server.close();
  }
});

test("Step 6: REST /v1/memory compat translates statement to content (201)", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const res = await request(server, "/v1/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        statement: "Legacy agent statement",
        project: "default",
        concepts: ["legacy", "compat"],
      }),
    });
    assert.equal(res.status, 201);
    const data = res.json as any;
    assert.equal(data.id, "mem-1");
    assert.deepEqual(data.concepts, ["legacy", "compat"]);
  } finally {
    server.close();
  }
});

test("Step 6: REST /v1/search (200) executes hybrid search", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const res = await request(server, "/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "HelixDB vector graph",
        project: "brainy",
        limit: 5,
      }),
    });
    assert.equal(res.status, 200);
    const data = res.json as any;
    assert.ok(Array.isArray(data.results));
    assert.ok(Array.isArray(data.signals));
  } finally {
    server.close();
  }
});

test("Step 6: REST GET /v1/context/:project (200)", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const res = await request(server, "/v1/context/brainy");
    assert.equal(res.status, 200);
    const data = res.json as any;
    assert.equal(data.project, "brainy");
    assert.ok(Array.isArray(data.notes));
    assert.ok(Array.isArray(data.memories));
  } finally {
    server.close();
  }
});

test("Step 6: REST POST /v1/link (201) and Condition C8 tenant check", async () => {
  const store = createMockStore();
  await store.saveNote({ title: "Note 1", content: "Content 1", project: "projA" });
  // Add a note in another project
  const n2: NoteRow = {
    id: "note-foreign",
    title: "Note Foreign",
    content: "Foreign content",
    project: "projB",
    paraCategory: "resource",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  };
  (store as any).getNoteById = async (id: string, project?: string) => {
    if (id === "note-123") return { note: { id: "note-123", project: "projA", title: "Note 1", content: "C1", paraCategory: "resource", createdAt: "", updatedAt: "", status: "active" }, para: { category: "resource", name: "inbox" }, supersedes: [], relatesTo: [] };
    if (id === "note-foreign") return { note: n2, para: { category: "resource", name: "inbox" }, supersedes: [], relatesTo: [] };
    return undefined;
  };

  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    // Cross tenant link -> 400 invalid_tenant_link (Condition C8)
    const badLinkRes = await request(server, "/v1/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromId: "note-123",
        toId: "note-foreign",
        type: "REFERENCES",
        project: "projA",
      }),
    });
    assert.equal(badLinkRes.status, 400);

    // Same tenant link -> 201
    (store as any).getNoteById = async (id: string) => {
      return { note: { id, project: "projA", title: "Note", content: "C", paraCategory: "resource", createdAt: "", updatedAt: "", status: "active" }, para: { category: "resource", name: "inbox" }, supersedes: [], relatesTo: [] };
    };

    const goodLinkRes = await request(server, "/v1/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fromId: "note-123",
        toId: "note-456",
        type: "REFERENCES",
        project: "projA",
      }),
    });
    assert.equal(goodLinkRes.status, 201);
  } finally {
    server.close();
  }
});

test("Step 6: 1-version /memory/* alias emits X-Deprecated header", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const res = await request(server, "/memory/livez");
    assert.equal(res.status, 200);
    assert.equal(res.headers["x-deprecated"], "use /v1/*");
  } finally {
    server.close();
  }
});

test("Step 6: Bearer authentication guards /v1/* and exempts livez", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store, secret: "topsecret" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    // /v1/livez exempt
    const livezRes = await request(server, "/v1/livez");
    assert.equal(livezRes.status, 200);

    // /memory/livez exempt
    const memLivezRes = await request(server, "/memory/livez");
    assert.equal(memLivezRes.status, 200);

    // /v1/notes without auth -> 401
    const unauthRes = await request(server, "/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "T", content: "C" }),
    });
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.headers["www-authenticate"], "Bearer");

    // /v1/notes with correct bearer -> 201
    const authRes = await request(server, "/v1/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer topsecret",
      },
      body: JSON.stringify({ title: "T", content: "C" }),
    });
    assert.equal(authRes.status, 201);
  } finally {
    server.close();
  }
});

test("Step 6: Strict Zod schemas reject unknown fields and enforce size limits", async () => {
  const store = createMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    // Unknown field -> 400
    const unknownFieldRes = await request(server, "/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Valid title",
        content: "Valid content",
        maliciousExtraField: "attack",
      }),
    });
    assert.equal(unknownFieldRes.status, 400);

    // Note content > 200k chars -> 400
    const hugeContentRes = await request(server, "/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Title",
        content: "A".repeat(200_001),
      }),
    });
    assert.equal(hugeContentRes.status, 400);
  } finally {
    server.close();
  }
});
