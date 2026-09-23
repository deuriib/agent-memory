/**
 * Derived confidence (REQ-P1-4): write-time importance derivation + the
 * ranking-time recall boost over an in-process recall ledger.
 *
 * All derivation/boost helpers are PURE with respect to their inputs — no
 * clock of their own, no randomness, no env reads: same inputs ->
 * byte-identical output, in this process and any other process running this
 * file (mirrors the src/lifecycle.ts docstring style). The ledger is the one
 * piece of process-local STATE: a module-level Map, deliberately best-effort
 * and bounded (see `noteRecall` cap below) — it is ranking input, never
 * persisted, never rewritten onto a row.
 *
 * Stored `importance` is never modified by anything in this module:
 * `deriveWriteImportance` runs ONCE at insert (when the caller passed no
 * importance) and `confidenceBoost` only feeds the fused-row TIE-BREAK in
 * src/search.ts (decay FIRST, then recall boost — see compareFusedAt).
 */

/** Clamp to 0..1; non-finite collapses to 0 (same rule as src/lifecycle.ts). */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Concept bonus cap: contributions past 8 derived concepts do not count. */
const MAX_BONUS_CONCEPTS = 8;

/**
 * Write-time importance when the caller passed none (REQ-P1-4):
 *
 *   base:   origin === "lesson"          -> 0.75
 *           origin starts with "hook:"   -> 0.55
 *           anything else (rest/mcp/…)   -> 0.50
 *   bonus:  0.025 · min(max(conceptCount, 0), 8)
 *   result: clamp01(base + bonus)
 *
 * Deterministic provenance scoring: a lesson is the highest-signal
 * provenance, hook observations carry context but not intent, everything
 * else keeps the historical 0.5 base. The concept bonus rewards memories
 * that carried a richer topic list (explicit or derived — the caller passes
 * the EFFECTIVE concept count, i.e. what actually got stored). Negative
 * concept counts clamp to 0; the bonus can never exceed 0.2, so the max
 * output is 0.95 (lesson + 8) — always within 0..1 before clamping too.
 */
export function deriveWriteImportance(origin: string, conceptCount: number): number {
  let base = 0.5;
  if (origin === "lesson") base = 0.75;
  else if (origin.startsWith("hook:")) base = 0.55;
  const bonus = 0.025 * Math.min(Math.max(conceptCount, 0), MAX_BONUS_CONCEPTS);
  return clamp01(base + bonus);
}

/**
 * Ranking-time recall boost (REQ-P1-4):
 *
 *   clamp01(storedImportance + 0.2 · n/(n+1)),  n = max(0, recallCount)
 *
 * n = 0 leaves the value unchanged (0 · anything = 0); the boost is strictly
 * monotonically increasing in n and asymptotically approaches +0.2 — a row
 * recalled many times can never gain more than a fifth of the scale, so
 * recall history tilts TIES without ever overpowering a genuinely higher
 * stored importance by more than that. Negative recall counts are treated
 * as 0 (fail toward "never recalled"). Pure: the ledger is read by the
 * CALLER (see recallCount) and passed in as `recallCount` — this function
 * never touches it.
 */
export function confidenceBoost(storedImportance: number, recallCount: number): number {
  const n = Math.max(0, recallCount);
  return clamp01(storedImportance + (0.2 * n) / (n + 1));
}

/* ------------------------------------------------------------------ */
/* Recall ledger — process-local, bounded, best-effort                 */
/* ------------------------------------------------------------------ */

/**
 * Hard cap on tracked memory ids. Reaching the cap BEFORE inserting a NEW
 * key clears the whole map (then the new key is inserted fresh). Documented
 * BEST-EFFORT trade-off: bounded memory beats perfect recall history — the
 * ledger is ranking input only, losing it degrades a tie-break to the
 * pre-recall order, never correctness. Re-noting an EXISTING key at the cap
 * increments normally (no clear) — only a new key at the cap trips it.
 */
const RECALL_CAP = 10_000;

const recalls = new Map<string, number>();

/**
 * Record that `memoryId` was returned by a search. Idempotent per call is
 * NOT the goal — every call increments (one row recalled by N searches has
 * count N). Empty `memoryId` is ignored (rows without a stored id must
 * never pollute the ledger).
 */
export function noteRecall(memoryId: string): void {
  if (memoryId === "") return;
  if (!recalls.has(memoryId) && recalls.size >= RECALL_CAP) recalls.clear();
  recalls.set(memoryId, (recalls.get(memoryId) ?? 0) + 1);
}

/** How many times `memoryId` was recalled in this process (0 = never). */
export function recallCount(memoryId: string): number {
  return recalls.get(memoryId) ?? 0;
}

/** Wipe the ledger — tests only (the production paths never reset it). */
export function resetRecalls(): void {
  recalls.clear();
}
