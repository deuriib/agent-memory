/**
 * Content normalization + hashing for REQ-P1-6 (content-hash dedup).
 *
 * Pure and deterministic: no clock, no locale, no randomness — the same
 * content in the same project always yields the same dedup key, in this
 * process and any other process running this file.
 *
 * Probe3 finding (scripts/probe3.ts, live dev instance): Helix v0.0.6 does
 * NOT enforce unique-equality constraints — duplicate dedupKey writes are
 * accepted and reads return every row (probe3 b2/d1/d2/d3). Dedup is
 * therefore enforced APPLICATION-SIDE: HelixStore.remember pre-checks via
 * findMemoryByDedupKey under a per-key in-process FIFO lock; index #8 exists
 * to accelerate that lookup, not to reject duplicates.
 *
 * REQ-P1-1 adds decayedImportance + filterExpired here.
 */
import { createHash } from "node:crypto";

/**
 * Normalize content for hashing: lowercase, collapse every whitespace run to
 * a single space, trim the ends. "  Hello   World  " and "hello world" are
 * the SAME memory for dedup purposes; punctuation and token order stay
 * untouched (dedup must never merge semantically different sentences).
 */
export function normalizeContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Content hash = sha256(project + "\n" + text) as lowercase hex.
 *
 * `text` is whatever the caller wants fingerprinted (dedup passes
 * `normalizeContent(content)`). Project participates in the hash, so the
 * same sentence in two projects yields two different keys — dedup never
 * crosses project boundaries. The "\n" separator makes
 * (project="a", text="b\nc") distinct from (project="a\nb", text="c").
 *
 * NOTE: probe3 proved the unique index does not enforce this key — the hash
 * is only as strong as the application-side pre-check that consumes it.
 */
export function contentHash(project: string, text: string): string {
  return createHash("sha256").update(`${project}\n${text}`).digest("hex");
}
