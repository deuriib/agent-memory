import test from "node:test";
import assert from "node:assert/strict";
import { EMBED_DIM, embed, getEmbedDim, embedWithProvider, tokenize } from "../src/embed.js";

test("Step 3: EMBED_DIM constant is 1536", () => {
  assert.equal(EMBED_DIM, 1536);
  assert.equal(getEmbedDim(), 1536);
});

test("Step 3: embed produces 1536-dim L2-normalized vector", () => {
  const vector = embed("Brainy segundo cerebro aumentado con agentes");
  assert.equal(vector.length, 1536);

  // Compute L2 norm
  let sumOfSquares = 0;
  for (const v of vector) sumOfSquares += v * v;
  const norm = Math.sqrt(sumOfSquares);
  assert.ok(Math.abs(norm - 1.0) < 1e-6, `Expected L2 norm ~1.0, got ${norm}`);
});

test("Step 3: embed is deterministic across repeated calls", () => {
  const v1 = embed("deterministic test content");
  const v2 = embed("deterministic test content");
  assert.deepEqual(v1, v2);

  const vOther = embed("different content entirely");
  assert.notDeepEqual(v1, vOther);
});

test("Step 3: empty text produces all-zero vector of 1536 dimensions", () => {
  const zero = embed("");
  assert.equal(zero.length, 1536);
  assert.ok(zero.every((v) => v === 0));
});

test("Step 3: BRAINY_EMBED_DIM env override fallback to 384", () => {
  process.env.BRAINY_EMBED_DIM = "384";
  try {
    assert.equal(getEmbedDim(), 384);
    const v384 = embed("testing legacy dimension");
    assert.equal(v384.length, 384);
  } finally {
    delete process.env.BRAINY_EMBED_DIM;
  }
  assert.equal(getEmbedDim(), 1536);
});

test("Step 3: embedWithProvider falls back to deterministic embedder when no key", async () => {
  const vector = await embedWithProvider("provider fallback test");
  assert.equal(vector.length, 1536);
  let sumOfSquares = 0;
  for (const v of vector) sumOfSquares += v * v;
  const norm = Math.sqrt(sumOfSquares);
  assert.ok(Math.abs(norm - 1.0) < 1e-6);
});
