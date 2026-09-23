/**
 * Consolidation tier-1 — near-duplicate detection + safe content merge
 * (REQ-P1-2).
 *
 * Pure helpers except `mergeThreshold`, which re-reads its env knob on every
 * call (same test-controllable pattern as src/lifecycle.ts): no clock, no
 * randomness, no locale. Merging NEVER discards text — the survivor's
 * content only ever GROWS by concatenation (mergedContent), and the
 * substring guard below keeps re-saving an already-merged text from
 * appending it forever.
 */
import { tokenize } from "./embed.js";
import { normalizeContent } from "./lifecycle.js";

/**
 * Jaccard similarity over the token SETS of both strings, using the
 * EMBEDDER's tokenizer (src/embed.ts — the single source of truth for token
 * shape, so near-dup detection agrees with what the vector/BM25 indexes
 * actually store). Union empty (both sides tokenize to nothing) -> 0:
 * never merge on emptiness.
 */
export function jaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Merge threshold from AGENT_MEMORY_MERGE_JACCARD, re-read on EVERY call so
 * tests can flip it without reloading the module:
 *
 *   ABSENT            -> 0.9 (consolidation ON by default — the roadmap
 *                        acceptance assumes near-dup merging, and tier-1
 *                        concatenation loses no text, so the default risk
 *                        surface is zero content loss);
 *   finite, 0 < v < 1 -> v;
 *   anything else (non-finite, <= 0, >= 1; "" parses to 0) -> undefined,
 *                        meaning consolidation OFF (fail-closed: bad config
 *                        never invents a merge threshold).
 */
export function mergeThreshold(): number | undefined {
  const raw = process.env["AGENT_MEMORY_MERGE_JACCARD"];
  if (raw === undefined) return 0.9;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return undefined;
  return value;
}

/** True when the pair's Jaccard is at or above `threshold`. */
export function isNearDuplicate(a: string, b: string, threshold: number): boolean {
  return jaccard(a, b) >= threshold;
}

/**
 * Merge `incomingContent` into `survivorContent`:
 *
 *   SUBSTRING GUARD — when the incoming's normalized text is already
 *   contained in the survivor's normalized text, return the survivor
 *   UNCHANGED. This closes the re-merge loop: someone who later saves the
 *   previously concatenated text would otherwise append the same words on
 *   every write (and it is a legitimate no-op merge, so the caller returns
 *   the survivor id without touching the database).
 *
 *   Otherwise — survivor + "\n" + incoming, collapsing any trailing
 *   whitespace of the survivor first so repeated merges never stack blank
 *   lines. No text is ever dropped.
 */
export function mergedContent(survivorContent: string, incomingContent: string): string {
  if (normalizeContent(survivorContent).includes(normalizeContent(incomingContent))) {
    return survivorContent;
  }
  return `${survivorContent.replace(/\s+$/, "")}\n${incomingContent}`;
}
