/**
 * RL-001 (Med): `GET /v1/context/:project` substituted `memories: []` on
 * text-probe failure with no `signals` entry — the one non-LOUD degradation
 * path. Plus DAT-003: SPEC-005 §4.3 assigns `filterExpired` to this route, so
 * context assembly hides TTL-expired notes AND memories (additive `signals`
 * only — no status-code or shape change beyond the new field).
 *
 * Hermetic: mock store + ephemeral port-0 HTTP — no Helix, no secrets, no PII.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createBrainyServer } from "../src/server.js";
import { _resetTtlWarningState } from "../src/lifecycle.js";
import type { BrainyStore, NoteRow, SearchHit } from "../src/store.js";

const DAY_MS = 86_400_000;

function saveTtlEnv(): { canonical: string | undefined; alias: string | undefined } {
  return {
    canonical: process.env["BRAINY_TTL_DAYS"],
    alias: process.env["AGENT_MEMORY_TTL_DAYS"],
  };
}

function restoreTtlEnv(saved: { canonical: string | undefined; alias: string | undefined }): void {
  if (saved.canonical === undefined) delete process.env["BRAINY_TTL_DAYS"];
  else process.env["BRAINY_TTL_DAYS"] = saved.canonical;
  if (saved.alias === undefined) delete process.env["AGENT_MEMORY_TTL_DAYS"];
  else process.env["AGENT_MEMORY_TTL_DAYS"] = saved.alias;
}

function noteRow(id: string, createdAt: string): NoteRow {
  return {
    id,
    noteId: id,
    title: `title-${id}`,
    content: `content-${id}`,
    project: "ctx",
    paraCategory: "resource",
    createdAt,
    updatedAt: createdAt,
    status: "active",
  };
}

function memoryHit(id: string, createdAt: string): SearchHit {
  return {
    id,
    memoryId: id,
    content: `memory-${id}`,
    sessionId: "sess-1",
    origin: "rest",
    importance: 0.5,
    createdAt,
    score: 1,
  };
}

function mockStore(notes: NoteRow[], textProbe: () => Promise<SearchHit[]>): BrainyStore {
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
    async searchByVector() { return []; },
    async searchByText(input) { return textProbe(); },
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
    async listNotes() { return notes; },
    async getNoteById() { return undefined; },
    async moveNote() { return true; },
    async distillNote() { throw new Error("not implemented"); },
    async forgetNote() { return false; },
    classifyPara() {
      return { category: "resource", target: "inbox", confidence: 0.9, reason: "mock" };
    },
    async searchNotesByVector() { return []; },
    async searchNotesByText() { return []; },
    async graphSearchNotes() { return []; },
    async traverseNoteGraph() { return { references: [], relates: [], belongsTo: [] }; },
    async linkNodes() { return true; },
  };
}

async function get(
  server: http.Server,
  path: string,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (addr === null || typeof addr === "string") return reject(new Error("Server not listening"));
    const req = http.request(
      { host: "127.0.0.1", port: addr.port, path, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          let json: unknown = undefined;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
          } catch {
            // not json
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

interface ContextPayload {
  project?: unknown;
  notes?: unknown[];
  memories?: unknown[];
  graph?: { notesCount?: unknown; memoriesCount?: unknown };
  signals?: unknown;
}

function asPayload(json: unknown): ContextPayload {
  if (typeof json !== "object" || json === null) throw new Error("context payload is not an object");
  return json as ContextPayload;
}

test("RL-001: text-probe failure degrades LOUD — 200, memories [], signals carries a text: entry", async () => {
  const saved = saveTtlEnv();
  try {
    _resetTtlWarningState();
    delete process.env["BRAINY_TTL_DAYS"];
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const store = mockStore([], () => Promise.reject(new Error("probe down")));
    const server = createBrainyServer({ store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await get(server, "/v1/context/ctx");
      assert.equal(res.status, 200);
      const data = asPayload(res.json);
      assert.deepEqual(data.memories, []);
      assert.ok(Array.isArray(data.signals), "signals field must be present");
      const signals = data.signals as unknown[];
      assert.ok(
        signals.some((s) => typeof s === "string" && s.startsWith("text: ")),
        `expected a "text: <failure>" signal, got ${JSON.stringify(signals)}`,
      );
      assert.equal(data.graph?.memoriesCount, 0);
    } finally {
      server.close();
    }
  } finally {
    restoreTtlEnv(saved);
  }
});

test("RL-001: healthy context carries a signals array (empty when nothing degraded)", async () => {
  const saved = saveTtlEnv();
  try {
    _resetTtlWarningState();
    delete process.env["BRAINY_TTL_DAYS"];
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const store = mockStore([noteRow("n1", new Date().toISOString())], () =>
      Promise.resolve([memoryHit("m1", new Date().toISOString())]),
    );
    const server = createBrainyServer({ store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await get(server, "/v1/context/ctx");
      assert.equal(res.status, 200);
      const data = asPayload(res.json);
      assert.deepEqual(data.signals, []);
      assert.equal(data.graph?.notesCount, 1);
      assert.equal(data.graph?.memoriesCount, 1);
    } finally {
      server.close();
    }
  } finally {
    restoreTtlEnv(saved);
  }
});

test("DAT-003: context hides TTL-expired notes AND memories with a ttl signal; graph counts agree", async () => {
  const saved = saveTtlEnv();
  try {
    _resetTtlWarningState();
    process.env["BRAINY_TTL_DAYS"] = "1";
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const oldNote = noteRow("expired-note", String(Date.now() - 2 * DAY_MS));
    const freshNote = noteRow("fresh-note", new Date().toISOString());
    const oldMem = memoryHit("expired-mem", new Date(Date.now() - 2 * DAY_MS).toISOString());
    const freshMem = memoryHit("fresh-mem", new Date().toISOString());
    const store = mockStore([oldNote, freshNote], () => Promise.resolve([oldMem, freshMem]));
    const server = createBrainyServer({ store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await get(server, "/v1/context/ctx?limit=10");
      assert.equal(res.status, 200);
      const data = asPayload(res.json);
      const noteIds = (data.notes ?? []).map((n) => (n as { id?: unknown }).id);
      const memIds = (data.memories ?? []).map((m) => (m as { memoryId?: unknown }).memoryId);
      assert.deepEqual(noteIds, ["fresh-note"]);
      assert.deepEqual(memIds, ["fresh-mem"]);
      const signals = data.signals as unknown[];
      assert.ok(
        signals.some((s) => s === "ttl: hidden 2 expired rows"),
        `expected ttl hidden-2 signal, got ${JSON.stringify(signals)}`,
      );
      assert.equal(data.graph?.notesCount, 1);
      assert.equal(data.graph?.memoriesCount, 1);
    } finally {
      server.close();
    }
  } finally {
    restoreTtlEnv(saved);
  }
});

test("DAT-003: TTL OFF keeps expired rows in context with no ttl signal (declared, not silent)", async () => {
  const saved = saveTtlEnv();
  try {
    _resetTtlWarningState();
    delete process.env["BRAINY_TTL_DAYS"];
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const oldNote = noteRow("old-note", String(Date.now() - 400 * DAY_MS));
    const store = mockStore([oldNote], () => Promise.resolve([]));
    const server = createBrainyServer({ store });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await get(server, "/v1/context/ctx");
      assert.equal(res.status, 200);
      const data = asPayload(res.json);
      assert.equal((data.notes ?? []).length, 1);
      assert.deepEqual(data.signals, []);
    } finally {
      server.close();
    }
  } finally {
    restoreTtlEnv(saved);
  }
});
