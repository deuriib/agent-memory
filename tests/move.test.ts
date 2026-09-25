import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createBrainyServer } from "../src/server.js";
import type { BrainyStore, GetNoteResult, NoteRow, ParaCategory } from "../src/store.js";

interface ParaState {
  category: ParaCategory;
  name: string;
}

function baseNote(id: string, project: string): NoteRow {
  const now = new Date().toISOString();
  return {
    id,
    noteId: id,
    title: `Title ${id}`,
    content: `Content ${id}`,
    project,
    paraCategory: "resource",
    createdAt: now,
    updatedAt: now,
    status: "active",
  };
}

function createMoveMockStore(): BrainyStore & { moveCalls: () => number; paraOf: (id: string) => ParaState | undefined } {
  const notes = new Map<string, NoteRow>();
  const paras = new Map<string, ParaState>();
  let calls = 0;
  const seed = (id: string, project: string): void => {
    notes.set(id, baseNote(id, project));
    paras.set(id, { category: "resource", name: "inbox" });
  };
  seed("note-1", "projA");
  seed("note-foreign", "projB");

  const getNoteById = async (id: string, project?: string): Promise<GetNoteResult | undefined> => {
    const note = notes.get(id);
    if (!note) return undefined;
    if (project !== undefined && note.project !== project) return undefined;
    const para = paras.get(id) ?? { category: "resource" as ParaCategory, name: "inbox" };
    return { note, para, supersedes: [], relatesTo: [] };
  };

  const store = {
    async remember(input: { content: string; project: string; sessionId: string; origin: string; concepts: string[] }) {
      return { id: "mem-1", sessionId: input.sessionId, project: input.project, concepts: input.concepts, deduped: false, consolidated: false };
    },
    async searchByVector() { return []; },
    async searchByText() { return []; },
    async graphSearch() { return []; },
    async listSessions() { return []; },
    async sessionMemories() { return []; },
    async forget() { return true; },
    async healthCounts() { return { memories: 0, sessions: 0 }; },
    async createTodo() { throw new Error("not implemented"); },
    async listTodos() { return []; },
    async getTodo() { return undefined; },
    async updateTodo() { return undefined; },
    async deleteTodo() { return true; },
    async frontierTodos() { return []; },
    async saveNote() { throw new Error("not implemented"); },
    async listNotes() { return []; },
    getNoteById,
    async moveNote(input: { id: string; project: string; toCategory: ParaCategory; toTarget?: string }): Promise<boolean> {
      calls += 1;
      const note = notes.get(input.id);
      if (!note || note.project !== input.project) return false;
      note.paraCategory = input.toCategory;
      paras.set(input.id, { category: input.toCategory, name: input.toTarget ?? input.toCategory });
      return true;
    },
    async distillNote() { throw new Error("not implemented"); },
    async forgetNote() { return true; },
    classifyPara() {
      return { category: "resource" as ParaCategory, target: "inbox", confidence: 0.9, reason: "mock" };
    },
    async searchNotesByVector() { return []; },
    async searchNotesByText() { return []; },
    async graphSearchNotes() { return []; },
    async traverseNoteGraph() { return { references: [], relates: [], belongsTo: [] }; },
    async linkNodes() { return true; },
    moveCalls: () => calls,
    paraOf: (id: string) => paras.get(id),
  } satisfies BrainyStore & { moveCalls: () => number; paraOf: (id: string) => ParaState | undefined };
  return store;
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
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "content-type": "application/json", ...(extra ?? {}) };
}

test("move route: 200 happy path rewrites BELONGS_TO to a single new target (AC-06)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { id: "note-1", para: { label: "Area", name: "Health" } });

    // Single edge proof: GET shows exactly the new target, no residue of inbox.
    const after = await request(server, "/v1/notes/note-1?project=projA");
    assert.equal(after.status, 200);
    assert.deepEqual((after.json as { para: ParaState }).para, { category: "area", name: "Health" });
    assert.equal(store.moveCalls(), 1);
  } finally {
    server.close();
  }
});

test("move route: tenant may arrive via ?project= query (body ?? query ?? default)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await request(server, "/v1/notes/note-1/move?project=projA", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "project", name: "Launch" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { id: "note-1", para: { label: "Project", name: "Launch" } });
  } finally {
    server.close();
  }
});

test("move route: 404 unknown note (AC-06)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await request(server, "/v1/notes/no-such-note/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: "note_not_found" });
    assert.equal(store.moveCalls(), 0);
  } finally {
    server.close();
  }
});

test("move route: 404 para_target_not_found maps store throw", async () => {
  const store = createMoveMockStore();
  store.moveNote = async (): Promise<boolean> => {
    throw new Error("para_target_not_found: no such target");
  };
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: "para_target_not_found" });
  } finally {
    server.close();
  }
});

test("move route: 400 strict-body probes reject unknown keys, empty/oversize name, unknown to (C4)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const probes: Array<{ label: string; body: unknown }> = [
      { label: "unknown key", body: { to: "area", name: "Health", project: "projA", replace: true } },
      { label: "empty name", body: { to: "area", name: "  ", project: "projA" } },
      { label: "unknown to", body: { to: "foo", name: "Health", project: "projA" } },
      { label: "oversize name", body: { to: "area", name: "x".repeat(501), project: "projA" } },
      { label: "workaround shape", body: { fromId: "note-1", toId: "note-2", type: "BELONGS_TO" } },
    ];
    for (const probe of probes) {
      const res = await request(server, "/v1/notes/note-1/move", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(probe.body),
      });
      assert.equal(res.status, 400, probe.label);
      assert.equal((res.json as { error: string }).error, "invalid_request", probe.label);
    }
    assert.equal(store.moveCalls(), 0);
  } finally {
    server.close();
  }
});

test("move route: bearer guard — 401 without/wrong bearer, 200 with correct bearer (SC-MOVE-01)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store, secret: "move-secret" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const noAuth = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.headers["www-authenticate"], "Bearer");

    const wrongAuth = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders({ authorization: "Bearer wrong" }),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(wrongAuth.status, 401);

    // livez stays exempt under the same guard.
    const livez = await request(server, "/v1/livez");
    assert.equal(livez.status, 200);

    const authed = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders({ authorization: "Bearer move-secret" }),
      body: JSON.stringify({ to: "archive", name: "Cold", project: "projA" }),
    });
    assert.equal(authed.status, 200);
    assert.deepEqual(authed.json, { id: "note-1", para: { label: "Archive", name: "Cold" } });
  } finally {
    server.close();
  }
});

test("move route: 400 invalid_tenant_link cross-tenant with zero writes (SC-MOVE-03, C8)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const before = store.moveCalls();
    const res = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projB" }),
    });
    assert.equal(res.status, 400);
    assert.equal((res.json as { error: string }).error, "invalid_tenant_link");
    // Proof of zero write: the store move path never ran and the note is untouched.
    assert.equal(store.moveCalls(), before);
    assert.deepEqual(store.paraOf("note-1"), { category: "resource", name: "inbox" });
  } finally {
    server.close();
  }
});

test("move route: legacy alias behavior unaffected — X-Deprecated only on /memory/* (AC-12)", async () => {
  const store = createMoveMockStore();
  const server = createBrainyServer({ store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const legacy = await request(server, "/memory/livez");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers["x-deprecated"], "use /v1/*");

    const move = await request(server, "/v1/notes/note-1/move", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ to: "area", name: "Health", project: "projA" }),
    });
    assert.equal(move.status, 200);
    assert.equal(move.headers["x-deprecated"], undefined);
  } finally {
    server.close();
  }
});
