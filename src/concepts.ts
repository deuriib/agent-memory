/**
 * Deterministic auto concept extraction (REQ-P1-3 / T-101).
 *
 * Pure + deterministic: same input -> byte-identical concept list, in this
 * process and any other process running this file (no locale, no clock, no
 * randomness). Pipeline:
 *
 *   1. tokenize with the EMBEDDER's tokenizer (src/embed.ts — the single
 *      source of truth for the token shape: lowercase, split /[^a-z0-9]+/,
 *      drop tokens shorter than 2)
 *   2. drop the built-in English stopword list below
 *   3. drop tokens shorter than 3 chars, and tokens longer than the 200-char
 *      concept schema bound (so an echo of the result always validates)
 *   4. rank by term frequency DESC, then lexicographic ASC (code-unit
 *      comparison — locale-free, so the order never drifts across machines)
 *   5. take the top 8
 *
 * Derivation runs ONLY when a request supplies no concepts — explicit
 * caller-supplied concepts always win verbatim (contract §3 echo; enforced
 * by HelixStore.remember and asserted by scripts/verify.ts).
 */
import { tokenize } from "./embed.js";

/** Derived-concept cap: never more than 8 (request schemas allow up to 64). */
export const MAX_CONCEPTS = 8;

/** Concept schema bound — a concept string must fit in 1..200 chars. */
export const MAX_CONCEPT_CHARS = 200;

/**
 * Small built-in English stopword list: derivation must never surface pure
 * function words as concepts. Deliberately small — this is a deterministic
 * keyword ranker, not a linguistics library. Every entry is already lowercase
 * (tokens are lowercased by the shared tokenizer).
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "are", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "will", "would", "could", "should", "shall", "might", "must",
  "can", "may", "but", "not", "nor", "than", "then", "that", "this", "these",
  "those", "there", "here", "when", "where", "which", "while", "what", "who",
  "whom", "how", "why", "with", "without", "within", "into", "onto", "over",
  "under", "about", "after", "before", "between", "during", "above", "below",
  "from", "through", "across", "because", "if", "unless", "against", "per",
  "you", "your", "yours", "they", "them", "their", "theirs", "their", "ours",
  "our", "mine", "my", "me", "we", "us", "he", "him", "his", "she", "her",
  "hers", "its", "it", "for", "all", "any", "both", "each", "few", "more",
  "most", "other", "some", "such", "only", "own", "same", "so", "too", "very",
  "just", "also", "now", "get", "got", "one", "two", "out", "do", "to", "of",
  "in", "on", "at", "by", "up", "off", "as", "is", "am", "be",
]);

/**
 * Derive up to `MAX_CONCEPTS` concepts from `text`.
 *
 * Returns `[]` for empty / all-stop-symbol input (there are no tokens) and
 * for input whose every token is a stopword, too short, or too long.
 */
export function extractConcepts(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    if (token.length < 3 || token.length > MAX_CONCEPT_CHARS) continue;
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // term frequency DESC
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; // lexicographic ASC
  });

  return ranked.slice(0, MAX_CONCEPTS).map(([token]) => token);
}
