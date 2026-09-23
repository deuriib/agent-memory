/**
 * Deterministic, keyless 384-dimension embedder (contract §3).
 *
 * Algorithm (frozen in docs/CONTRACT.md §3, implementation notes below):
 *   1. lowercase the input, split on /[^a-z0-9]+/, drop tokens shorter than 2
 *   2. FNV-1a 32-bit per token -> bucket `h % 384`
 *   3. sign from a second hash bit (see `signFor` — assumption documented there)
 *   4. accumulate term frequency with 1/(1+ln(tf)) weighting
 *   5. L2-normalize
 *
 * No network, no model download, no key. Same input -> byte-identical vector,
 * in this process and any other process running this file.
 */

/** Embedding dimension, frozen by contract §1/§3. */
export const EMBED_DIM = 384;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit over the token's character codes.
 *
 * Tokens reaching this function are guaranteed `[a-z0-9]+` (the tokenizer
 * removed everything else), i.e. pure ASCII, so char codes and UTF-8 bytes
 * are identical and this is a textbook FNV-1a.
 */
function fnv1a32(text: string, basis: number): number {
  let hash = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Sign for one token: a SECOND FNV-1a pass over the token with a golden-ratio
 * salted basis; bit 1 of that second hash decides +1 / -1.
 *
 * Assumption (contract says only "sign from a second hash bit"): this reads
 * "a bit of a second hash". Deterministic and stable; flagged in the lane
 * report as an interpretation of an under-specified detail.
 */
function signFor(token: string): 1 | -1 {
  const second = fnv1a32(token, (FNV_OFFSET_BASIS ^ 0x9e3779b9) >>> 0);
  return ((second >>> 1) & 1) === 1 ? 1 : -1;
}

/** Tokenizer shape is contract-frozen; exported (additive) so the concept
 * extractor (src/concepts.ts) reuses this ONE implementation instead of a
 * drifting copy. */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

/**
 * Embed `text` into a deterministic, L2-normalized 384-dim vector.
 *
 * Empty / all-stop-symbol input yields the all-zero vector (there is nothing
 * to normalize); every other input has L2 norm 1 within float64 tolerance.
 */
export function embed(text: string): number[] {
  const vector: number[] = new Array<number>(EMBED_DIM).fill(0);

  // Count term frequency first: the 1/(1+ln(tf)) weight depends on the final
  // count, so accumulation happens once per unique token.
  const termFrequency = new Map<string, number>();
  for (const token of tokenize(text)) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  // Map iteration order is insertion order -> identical input, identical
  // float accumulation order, identical bytes out.
  for (const [token, tf] of termFrequency) {
    const bucket = fnv1a32(token, FNV_OFFSET_BASIS) % EMBED_DIM;
    const weight = 1 / (1 + Math.log(tf));
    const signed = signFor(token) * weight;
    vector[bucket] = (vector[bucket] ?? 0) + signed;
  }

  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (norm > 0) {
    for (let i = 0; i < EMBED_DIM; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }
  }

  return vector;
}
