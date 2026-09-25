import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPara,
  cosineSimilarity,
  type ParaCategory,
  type SaveNoteInput,
  type NoteRow,
  type ProjectRow,
  type AreaRow,
  type ResourceRow,
  type ArchiveRow,
  type ParaClassificationResult,
  HelixStore,
} from "../src/store.js";
import { embed } from "../src/embed.js";

test("Step 4: classifyPara heuristic accurately classifies PARA categories", () => {
  // Project: deadlines, goals, deliverables
  const p1 = classifyPara("Ship Brainy v1.0", "Finish sprint deliverable before Friday deadline", ["release"]);
  assert.equal(p1.category, "project");

  // Area: ongoing responsibilities, standards, health, finance
  const a1 = classifyPara("Daily Health Habits", "Routine maintenance and gym workout standards", ["health"]);
  assert.equal(a1.category, "area");

  // Resource: guides, reference, bookmarks
  const r1 = classifyPara("TypeScript Handbook", "Reference guide and cheat sheet for generics", ["docs"]);
  assert.equal(r1.category, "resource");

  // Archive: completed, legacy, deprecated
  const ar1 = classifyPara("Old 2021 Client Website", "Completed and deprecated client project archive", ["legacy"]);
  assert.equal(ar1.category, "archive");

  // Tag overrides
  const tagP = classifyPara("General text", "Some body text", ["project"]);
  assert.equal(tagP.category, "project");

  const tagAr = classifyPara("Random text", "Some body text", ["archive"]);
  assert.equal(tagAr.category, "archive");

  // Default fallback -> resource with inbox target
  const def = classifyPara("Quick note", "Something to remember later", []);
  assert.equal(def.category, "resource");
  assert.equal(def.target, "inbox");
});

test("Step 4: cosineSimilarity correctly computes vector similarity", () => {
  const v1 = embed("TypeScript compiler architecture and AST traversal");
  const v2 = embed("TypeScript compiler architecture and AST traversal");
  assert.ok(Math.abs(cosineSimilarity(v1, v2) - 1.0) < 1e-6);

  const vSimilar = embed("TypeScript compiler AST traversal and parser");
  const sim = cosineSimilarity(v1, vSimilar);
  assert.ok(sim > 0.7, `Expected high similarity, got ${sim}`);

  const vDifferent = embed("Chocolate cake recipe baking temperature degrees oven");
  const diffSim = cosineSimilarity(v1, vDifferent);
  assert.ok(diffSim < 0.3, `Expected low similarity, got ${diffSim}`);
});

test("Step 4: HelixStore interface declares all required PARA methods", () => {
  const store = new HelixStore("http://localhost:6969");
  assert.equal(typeof store.saveNote, "function");
  assert.equal(typeof store.listNotes, "function");
  assert.equal(typeof store.getNoteById, "function");
  assert.equal(typeof store.moveNote, "function");
  assert.equal(typeof store.distillNote, "function");
  assert.equal(typeof store.forgetNote, "function");
  assert.equal(typeof store.classifyPara, "function");

  // Existing methods preserved without regression
  assert.equal(typeof store.remember, "function");
  assert.equal(typeof store.searchByVector, "function");
  assert.equal(typeof store.searchByText, "function");
  assert.equal(typeof store.graphSearch, "function");
  assert.equal(typeof store.listSessions, "function");
  assert.equal(typeof store.sessionMemories, "function");
  assert.equal(typeof store.forget, "function");
  assert.equal(typeof store.createTodo, "function");
});
