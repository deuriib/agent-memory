import test from "node:test";
import assert from "node:assert/strict";
import { RRF_K, hybridSearch, bm25Search } from "../src/search.js";
import type { MemoryStore, SearchHit, NoteRow, ParaCategory } from "../src/store.js";

function createMockStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    remember: () => Promise.reject(new Error("not implemented")),
    searchByVector: () => Promise.resolve([]),
    searchByText: () => Promise.resolve([]),
    graphSearch: () => Promise.resolve([]),
    listSessions: () => Promise.resolve([]),
    sessionMemories: () => Promise.resolve([]),
    forget: () => Promise.resolve(false),
    healthCounts: () => Promise.resolve({ memories: 0, sessions: 0 }),
    createTodo: () => Promise.reject(new Error("not implemented")),
    listTodos: () => Promise.resolve([]),
    getTodo: () => Promise.resolve(undefined),
    updateTodo: () => Promise.resolve(undefined),
    deleteTodo: () => Promise.resolve(false),
    frontierTodos: () => Promise.resolve([]),
    ...overrides,
  };
}

test("Step 5: RRF_K is 60", () => {
  assert.equal(RRF_K, 60);
});

test("Step 5: hybridSearch fuses vector, text, and graph with RRF k=60", async () => {
  const hit1: SearchHit = {
    id: "doc-1",
    memoryId: "doc-1",
    content: "Brainy personal knowledge architecture",
    sessionId: "s1",
    origin: "user",
    importance: 0.8,
    createdAt: new Date().toISOString(),
    score: 0,
    distance: 0.05,
  };

  const hit2: SearchHit = {
    id: "doc-2",
    memoryId: "doc-2",
    content: "Agent memory retrieval",
    sessionId: "s1",
    origin: "agent",
    importance: 0.5,
    createdAt: new Date().toISOString(),
    score: 0,
    distance: 0.1,
  };

  const store = createMockStore({
    searchByVector: () => Promise.resolve([hit1, hit2]),
    searchByText: () => Promise.resolve([hit1]),
  });

  const res = await hybridSearch(store, {
    query: "knowledge",
    concepts: [],
    project: "test-p",
    limit: 10,
  });

  assert.equal(res.mode, "hybrid");
  assert.equal(res.results.length, 2);

  const expectedHit1Score = 1 / 61 + 1 / 61;
  const expectedHit2Score = 1 / 62;

  assert.equal(res.results[0]?.id, "doc-1");
  assert.ok(Math.abs((res.results[0]?.score ?? 0) - expectedHit1Score) < 1e-6);

  assert.equal(res.results[1]?.id, "doc-2");
  assert.ok(Math.abs((res.results[1]?.score ?? 0) - expectedHit2Score) < 1e-6);
});

test("Step 5: hybridSearch executes parallel fan-out over Note + Memory", async () => {
  const memoryHit: SearchHit = {
    id: "mem-1",
    memoryId: "mem-1",
    content: "Memory about project goals",
    sessionId: "s1",
    origin: "agent",
    importance: 0.6,
    createdAt: new Date().toISOString(),
    score: 0,
    distance: 0.08,
  };

  const noteHit: SearchHit = {
    id: "note-1",
    memoryId: "note-1",
    content: "Note about project architecture",
    sessionId: "s1",
    origin: "user",
    importance: 0.9,
    createdAt: new Date().toISOString(),
    score: 0,
    distance: 0.04,
  };

  let noteVectorCalled = false;
  let memoryVectorCalled = false;

  const store = createMockStore({
    searchByVector: () => {
      memoryVectorCalled = true;
      return Promise.resolve([memoryHit]);
    },
    searchNotesByVector: () => {
      noteVectorCalled = true;
      return Promise.resolve([noteHit]);
    },
  });

  const res = await hybridSearch(store, {
    query: "project",
    project: "test-p",
    limit: 10,
  });

  assert.ok(memoryVectorCalled, "searchByVector must be called");
  assert.ok(noteVectorCalled, "searchNotesByVector must be called");
  assert.equal(res.results.length, 2);
  // noteHit had smaller distance (0.04 vs 0.08) so rank 1 vs rank 2
  assert.equal(res.results[0]?.id, "note-1");
  assert.equal(res.results[1]?.id, "mem-1");
});

test("Step 5: graph traversal with include_graph populates graph_path", async () => {
  const noteHit: SearchHit = {
    id: "note-10",
    memoryId: "note-10",
    content: "Design document for Brainy",
    sessionId: "s1",
    origin: "user",
    importance: 0.9,
    createdAt: new Date().toISOString(),
    score: 1.0,
  };

  const mockNote: NoteRow = {
    id: "note-rel-1",
    noteId: "note-rel-1",
    title: "Related RFC",
    content: "Content of related RFC",
    project: "test-p",
    paraCategory: "project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  };

  const store = createMockStore({
    searchByText: () => Promise.resolve([noteHit]),
    traverseNoteGraph: (noteId: string) => Promise.resolve({
      references: [],
      relates: [mockNote],
      belongsTo: [{ id: "proj-1", name: "Brainy v1" }],
    }),
  });

  const res = await hybridSearch(store, {
    query: "Brainy design",
    project: "test-p",
    limit: 5,
    include_graph: true,
    max_depth: 2,
  });

  assert.equal(res.results.length, 1);
  assert.ok(res.results[0]?.graph_path);
  assert.ok(res.results[0]?.graph_path?.includes("Brainy v1") || res.results[0]?.graph_path?.includes("note-rel-1"));
});

test("Step 5: graceful degradation on source failure (never 500 / never throws)", async () => {
  const hit: SearchHit = {
    id: "doc-text",
    memoryId: "doc-text",
    content: "Only text survived",
    sessionId: "s1",
    origin: "user",
    importance: 0.7,
    createdAt: new Date().toISOString(),
    score: 1.0,
  };

  const store = createMockStore({
    searchByVector: () => Promise.reject(new Error("IndexNotFound: note_embedding")),
    searchByText: () => Promise.resolve([hit]),
  });

  const res = await hybridSearch(store, {
    query: "survived",
    project: "test-p",
    limit: 10,
  });

  assert.equal(res.mode, "hybrid");
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0]?.id, "doc-text");
  assert.ok(res.signals.some((s) => s.includes("vector:")));
});

test("Step 5: graceful degradation when all sources fail", async () => {
  const store = createMockStore({
    searchByVector: () => Promise.reject(new Error("vector timeout")),
    searchByText: () => Promise.reject(new Error("text error")),
    graphSearch: () => Promise.reject(new Error("graph down")),
  });

  const res = await hybridSearch(store, {
    query: "down",
    concepts: ["ai"],
    project: "test-p",
    limit: 10,
  });

  assert.equal(res.mode, "hybrid");
  assert.equal(res.results.length, 0);
  assert.ok(res.signals.length >= 2);
});
