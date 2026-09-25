/**
 * Deterministic, keyless 1536-dimension embedder (contract §3 / ADR-0002).
 *
 * Algorithm (frozen in docs/CONTRACT.md §3, implementation notes below):
 *   1. lowercase the input, split on /[^a-z0-9]+/, drop tokens shorter than 2
 *   2. FNV-1a 32-bit per token -> bucket `h % EMBED_DIM`
 *   3. sign from a second hash bit (see `signFor` — assumption documented there)
 *   4. accumulate term frequency with 1/(1+ln(tf)) weighting
 *   5. L2-normalize
 *
 * No network, no model download, no key. Same input -> byte-identical vector,
 * in this process and any other process running this file.
 */

/** Canonical embedding dimension, frozen by contract §1/§3 (ADR-0002). */
export const EMBED_DIM = 1536;

/**
 * Inspect BRAINY_EMBED_DIM (or legacy AGENT_MEMORY_EMBED_DIM) env variable.
 * Default: 1536; fallback 384 for migration.
 */
export function getEmbedDim(): number {
  const envDim = process.env.BRAINY_EMBED_DIM ?? process.env.AGENT_MEMORY_EMBED_DIM;
  if (envDim !== undefined) {
    const parsed = parseInt(envDim, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return EMBED_DIM;
}

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
 */
function signFor(token: string): 1 | -1 {
  const second = fnv1a32(token, (FNV_OFFSET_BASIS ^ 0x9e3779b9) >>> 0);
  return ((second >>> 1) & 1) === 1 ? 1 : -1;
}

/**
 * Tokenizer shape is contract-frozen; exported (additive) so the concept
 * extractor (src/concepts.ts) reuses this ONE implementation instead of a
 * drifting copy.
 */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length >= 2) tokens.push(token);
  }
  return tokens;
}

/**
 * Embed `text` into a deterministic, L2-normalized vector (default 1536-dim).
 *
 * Empty / all-stop-symbol input yields the all-zero vector (there is nothing
 * to normalize); every other input has L2 norm 1 within float64 tolerance.
 */
export function embed(text: string, dim: number = getEmbedDim()): number[] {
  const vector: number[] = new Array<number>(dim).fill(0);

  // Count term frequency first: the 1/(1+ln(tf)) weight depends on the final
  // count, so accumulation happens once per unique token.
  const termFrequency = new Map<string, number>();
  for (const token of tokenize(text)) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  // Map iteration order is insertion order -> identical input, identical
  // float accumulation order, identical bytes out.
  for (const [token, tf] of termFrequency) {
    const bucket = fnv1a32(token, FNV_OFFSET_BASIS) % dim;
    const weight = 1 / (1 + Math.log(tf));
    const signed = signFor(token) * weight;
    vector[bucket] = (vector[bucket] ?? 0) + signed;
  }

  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }
  }

  return vector;
}

/**
 * Route embedding request to remote provider (e.g. OpenAI text-embedding-3-small)
 * when configured via env, falling back to deterministic keyless hash embedder.
 */
export async function embedWithProvider(text: string, dim: number = getEmbedDim()): Promise<number[]> {
  const provider = process.env.BRAINY_EMBEDDING_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "local");
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          input: text,
          model: "text-embedding-3-small",
          dimensions: dim,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
        const vec = data.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length === dim) {
          return vec;
        }
      }
    } catch {
      // Fallback on network or API failure
    }
  }
  return embed(text, dim);
}
