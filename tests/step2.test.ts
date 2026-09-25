import test from "node:test";
import assert from "node:assert/strict";
import {
  LABELS,
  EDGES,
  EMBED_DIM,
  bootstrapIndexes,
  saveNote,
  saveNoteParams,
  listNotes,
  listNotesParams,
  getNoteById,
  getNoteByIdParams,
  moveNote,
  moveNoteParams,
  distillNote,
  distillNoteParams,
  forgetNote,
  forgetNoteParams,
  searchByVector,
  searchByVectorParams,
  searchByText,
  searchByTextParams,
  graphSearch,
  graphSearchParams,
  // Existing compat
  saveMemory,
  saveMemoryParams,
  forgetMemory,
  findMemoryByDedupKey,
} from "../db/queries.js";

test("Step 2: LABELS and EDGES constants", () => {
  // Check required labels
  assert.equal(LABELS.Note, "Note");
  assert.equal(LABELS.Project, "Project");
  assert.equal(LABELS.Area, "Area");
  assert.equal(LABELS.Resource, "Resource");
  assert.equal(LABELS.Archive, "Archive");
  assert.equal(LABELS.Agent, "Agent");
  assert.equal(LABELS.Context, "Context");
  assert.equal(LABELS.Memory, "Memory");
  assert.equal(LABELS.Session, "Session");
  assert.equal(LABELS.Concept, "Concept");
  assert.equal(LABELS.Todo, "Todo");

  // Check required edges
  assert.equal(EDGES.BELONGS_TO, "BELONGS_TO");
  assert.equal(EDGES.REFERENCES, "REFERENCES");
  assert.equal(EDGES.SUPERSEDES, "SUPERSEDES");
  assert.equal(EDGES.ABOUT, "ABOUT");
  assert.equal(EDGES.APPLIES_TO, "APPLIES_TO");
  assert.equal(EDGES.CAPTURED_BY, "CAPTURED_BY");
  assert.equal(EDGES.RELATES_TO, "RELATES_TO");
  assert.equal(EDGES.HAS_CONCEPT, "HAS_CONCEPT");

  // Check embedding dimension
  assert.equal(EMBED_DIM, 1536);
});

test("Step 2: bootstrapIndexes returns >= 18 indexes including 1536-dim vector", () => {
  const batch = bootstrapIndexes();
  assert.ok(batch, "bootstrapIndexes must return a batch");
  // The query request contains all registered indexes
  const req = batch.toQueryRequest(saveMemoryParams, {
    memoryId: "m1",
    content: "c",
    project: "p",
    sessionId: "s",
    embedding: new Array(1536).fill(0),
    origin: "o",
    importance: 0.5,
    createdAt: Date.now(),
    concepts: [],
    dedupKey: "k",
  });
  assert.ok(req);
});

test("Step 2: query builders AST parameter binding", () => {
  const now = Date.now();
  const dummyEmbedding = new Array(1536).fill(0);

  // saveNote
  const saveBatch = saveNote();
  const saveReq = saveBatch.toQueryRequest(saveNoteParams, {
    id: "note-1",
    title: "Note Title",
    content: "Note content",
    project: "project-1",
    paraCategory: "resource",
    paraTarget: "inbox",
    origin: "user",
    createdAt: now,
    updatedAt: now,
    status: "active",
    embedding: dummyEmbedding,
    dedupKey: "dedup-1",
    relatedNotes: [],
    concepts: [],
  });
  assert.ok(saveReq);

  // listNotes
  const listBatch = listNotes();
  const listReq = listBatch.toQueryRequest(listNotesParams, {
    project: "project-1",
    limit: 10n,
  });
  assert.ok(listReq);

  // getNoteById
  const getBatch = getNoteById();
  const getReq = getBatch.toQueryRequest(getNoteByIdParams, {
    id: "note-1",
  });
  assert.ok(getReq);

  // moveNote
  const moveBatch = moveNote("Project");
  const moveReq = moveBatch.toQueryRequest(moveNoteParams, {
    id: "note-1",
    paraCategory: "project",
    paraTarget: "Brainy Launch",
    updatedAt: now,
  });
  assert.ok(moveReq);

  // distillNote
  const distillBatch = distillNote();
  const distillReq = distillBatch.toQueryRequest(distillNoteParams, {
    id: "note-2",
    title: "Distilled summary",
    content: "One-line summary",
    project: "project-1",
    paraCategory: "resource",
    embedding: dummyEmbedding,
    createdAt: now,
    updatedAt: now,
    status: "active",
    supersededId: "note-1",
  });
  assert.ok(distillReq);

  // forgetNote
  const forgetBatch = forgetNote();
  const forgetReq = forgetBatch.toQueryRequest(forgetNoteParams, {
    id: "note-1",
  });
  assert.ok(forgetReq);

  // searchByVector
  const vectorBatch = searchByVector(LABELS.Note);
  const vectorReq = vectorBatch.toQueryRequest(searchByVectorParams, {
    queryVector: dummyEmbedding,
    project: "project-1",
    k: 5n,
  });
  assert.ok(vectorReq);

  // searchByText
  const textBatch = searchByText(LABELS.Note);
  const textReq = textBatch.toQueryRequest(searchByTextParams, {
    q: "brainy",
    project: "project-1",
    k: 5n,
  });
  assert.ok(textReq);

  // graphSearch
  const graphBatch = graphSearch("Note");
  const graphReq = graphBatch.toQueryRequest(graphSearchParams, {
    concepts: ["ai", "pkm"],
    project: "project-1",
    k: 5n,
  });
  assert.ok(graphReq);
});
