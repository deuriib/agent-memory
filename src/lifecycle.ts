/**
 * Content normalization + hashing (REQ-P1-6) and decay/TTL (REQ-P1-1).
 *
 * All helpers here are PURE with respect to their inputs except that env
 * knobs are read fresh on every call (so a test can flip them without
 * reloading the module): no clock of their own — the caller passes `nowMs` —
 * no locale, no randomness. Same inputs -> byte-identical output, in this
 * process and any other process running this file.
 *
 * Probe3 finding (scripts/probe3.ts, live dev instance): Helix v0.0.6 does
 * NOT enforce unique-equality constraints — duplicate dedupKey writes are
 * accepted and reads return every row (probe3 b2/d1/d2/d3). Dedup is
 * therefore enforced APPLICATION-SIDE: HelixStore.remember pre-checks via
 * findMemoryByDedupKey under a per-key in-process FIFO lock; index #8 exists
 * to accelerate that lookup, not to reject duplicates.
 *
 * Probe3 (e) verified Predicate.ltParam on a dateTime property against the
 * live instance: strict older-than semantics, project-scoped, $id-ordered —
 * listExpired (db/queries.ts) is built on it.
 */
import { createHash } from "node:crypto";

/** Milliseconds in a day (age arithmetic for decay/TTL). */
const MS_PER_DAY = 86_400_000;

/**
 * Read a positive finite number from env. Returns undefined when the var is
 * absent, unparseable, non-finite, or <= 0 — callers map that to "feature
 * OFF / factor 1" (fail-closed: bad config never invents decay or expiry).
 */
function readPositiveEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

let warnedDeprecatedTtl = false;

/**
 * TTL day-count, canonical-first: `BRAINY_TTL_DAYS` wins; the legacy
 * `AGENT_MEMORY_TTL_DAYS` alias resolves behind a single static deprecation
 * notice on stderr (module flag, one line per process, no values — same shape
 * as `secretFromEnv` in `src/auth.ts`). Absent/invalid/<= 0 -> `undefined`
 * (TTL OFF declared, never silent). Env is re-read per call so tests control
 * the knob without reloading the module.
 */
function ttlDaysFromEnv(): number | undefined {
  const canonical = readPositiveEnv("BRAINY_TTL_DAYS");
  if (canonical !== undefined) return canonical;
  const alias = readPositiveEnv("AGENT_MEMORY_TTL_DAYS");
  if (alias !== undefined) {
    if (!warnedDeprecatedTtl) {
      warnedDeprecatedTtl = true;
      console.error("WARN deprecated use BRAINY_TTL_DAYS");
    }
    return alias;
  }
  return undefined;
}

/** Reset warning state for test isolation */
export function _resetTtlWarningState(): void {
  warnedDeprecatedTtl = false;
}

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
 * crosses project boundaries.
 *
 * PRECONDITION — the "\n" separator alone does NOT make the split safe.
 * At the function level the claim "(project="a", text="b\nc") distinct from
 * (project="a\nb", text="c")" is FALSE: both hash to the same value
 * (ea7fb08b… — both inputs are literally "a\nb\nc"). The PRODUCTION path is
 * safe only because dedup always passes normalizeContent(content), which
 * collapses every whitespace run (newlines included) to a single space:
 * after normalization `text` contains no "\n", so an alternate colliding
 * split would require a newline in `text` — impossible once normalized
 * (the split at the last "\n" then uniquely recovers (project, text)).
 * A future caller that skips normalization reopens the collision: never pass
 * raw text with embedded newlines as `text`.
 *
 * NOTE: probe3 proved the unique index does not enforce this key — the hash
 * is only as strong as the application-side pre-check that consumes it.
 */
export function contentHash(project: string, text: string): string {
  return createHash("sha256").update(`${project}\n${text}`).digest("hex");
}

/**
 * Time-decayed importance for ranking (REQ-P1-1 corte A):
 *
 *   decayed = clamp01(importance · e^(−λ · ageDays))
 *
 * λ comes from AGENT_MEMORY_DECAY_LAMBDA (per time unit = day). Absent,
 * invalid, or <= 0 -> factor 1 (decay OFF). Unparseable createdAt -> factor
 * 1 (a bad timestamp must never inflate or zero a score). Result is always
 * within 0..1. Wire this ONLY into compareFused's importance TIE-BREAK —
 * stored/importance shown to users stays the stored value.
 */
export function decayedImportance(importance: number, createdAt: string, nowMs: number): number {
  const lambda = readPositiveEnv("AGENT_MEMORY_DECAY_LAMBDA");
  if (lambda === undefined) return clamp01(importance);
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return clamp01(importance);
  const ageDays = (nowMs - created) / MS_PER_DAY;
  return clamp01(importance * Math.exp(-lambda * ageDays));
}

/**
 * Tolerant `createdAt` normalizer for the TTL expiry decision (DAT-004).
 *
 * Producer-type reality: Memory rows carry ISO-8601 strings (`new
 * Date().toISOString()`), while Note rows carry epoch-milliseconds numbers
 * (`Date.now()`) that read back as digit strings via `readString`
 * (`src/store.ts`). `Date.parse` alone returns `NaN` for digit strings, which
 * made TTL silently never apply to the entire Note PII store
 * (fail-toward-keep on every row, with no `ttl` signal emitted).
 *
 * Accepted shapes (everything else -> `undefined`):
 *   - finite `number` / `bigint`          -> epoch-ms as-is
 *   - all-digit `string` (optional `-`)   -> epoch-ms (Note read-back shape)
 *   - any other non-empty `string`        -> `Date.parse` (ISO Memory shape)
 *
 * Declared fail policy (SPEC-005 §4.2, unchanged): garbage / absent /
 * non-finite timestamps read as `undefined` and the caller KEEPS the row
 * (fail-toward-keep — hiding wrongly is reversible, deleting is not).
 * Pure input->output; never logs values.
 */
export function parseCreatedAtMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : undefined;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return undefined;
    if (/^-?\d+$/.test(text)) {
      const epochMs = Number(text);
      return Number.isFinite(epochMs) ? epochMs : undefined;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Drop TTL-expired rows (REQ-P1-1 corte A), preserving input order.
 *
 * TTL knob is canonical-first: `BRAINY_TTL_DAYS`, falling back to the legacy
 * `AGENT_MEMORY_TTL_DAYS` alias with a single static `WARN deprecated`
 * notice on stderr. Absent/invalid/<= 0 -> OFF (returns every row).
 * A row expires only when ageDays is STRICTLY GREATER than the TTL — a row
 * exactly at the boundary survives (never delete on the fence). Unparseable
 * createdAt -> NOT expired (fail toward keeping data: hiding wrongly is
 * reversible, deleting is not). Timestamp shapes are normalized by
 * `parseCreatedAtMs` (epoch-ms numbers/digit-strings AND ISO strings), so
 * Note rows (epoch-ms producer) and Memory rows (ISO producer) expire on the
 * same rule without migrating stored rows. Pure input->output; the env is
 * re-read per call so tests control the knob.
 */
export function filterExpired<T extends { createdAt: string }>(
  rows: readonly T[],
  nowMs: number,
): T[] {
  const ttlDays = ttlDaysFromEnv();
  if (ttlDays === undefined) return [...rows];
  const kept: T[] = [];
  for (const row of rows) {
    const created = parseCreatedAtMs(row.createdAt);
    if (created === undefined) {
      kept.push(row);
      continue;
    }
    const ageDays = (nowMs - created) / MS_PER_DAY;
    if (ageDays <= ttlDays) kept.push(row);
  }
  return kept;
}
