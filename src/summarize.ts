/**
 * Deterministic session summarization (P2.4, no LLM).
 *
 * Pure + deterministic: same memories -> byte-identical summary, in this
 * process and any other process running this file (no clock, no randomness,
 * no network, no env reads). Pipeline:
 *
 *   1. top concepts over the concatenated contents via src/concepts.ts
 *      (same derivation remember() uses — proven deterministic)
 *   2. counts by origin (sorted origin ASC for determinism)
 *   3. time range from parseable createdAt values (min/max, "" when none)
 *   4. extractive picks: top 5 by importance DESC, then createdAt ASC,
 *      then content ASC (all locale-free) — excerpts clipped to 240 chars
 *      (same CLIP_CONTENT budget the plugin uses for recall blocks)
 *   5. lessons: top 3 picks reworded as `lesson: <excerpt>` lines
 *
 * Stored importance is never modified here — this module only READS rows
 * (sessionMemories shape) and renders text the caller saves via
 * POST /memory/lesson under the SAME sessionId (retrievable by session).
 */

import { extractConcepts } from "./concepts.js";

export interface SummaryMemory {
  readonly content: string;
  readonly origin: string;
  readonly importance: number;
  readonly createdAt: string;
  readonly sessionId: string;
}

export interface SessionSummary {
  /** One compact multi-line text — saved as a single lesson row. */
  readonly summary: string;
  /** Up to 3 mined lesson lines — each saved as its own lesson row. */
  readonly lessons: readonly string[];
  /** Top concepts across the session (≤8, derivation order). */
  readonly topConcepts: readonly string[];
  /** Memories consumed. */
  readonly count: number;
}

const EXCERPT_CHARS = 240;
const SUMMARY_PICKS = 5;
const LESSON_PICKS = 3;

function excerpt(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= EXCERPT_CHARS) return oneLine;
  return `${oneLine.slice(0, Math.max(0, EXCERPT_CHARS - 3))}...`;
}

function comparePicks(
  a: SummaryMemory,
  b: SummaryMemory,
): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.content !== b.content) return a.content < b.content ? -1 : 1;
  return 0;
}

/**
 * Build a deterministic summary + lessons for one session's memories.
 * Returns count 0 with an explicit empty summary when given no memories
 * (the caller decides whether to save it — the script skips empty).
 */
export function buildSessionSummary(
  memories: readonly SummaryMemory[],
  sessionId: string,
  project: string,
): SessionSummary {
  if (memories.length === 0) {
    return {
      summary: `session ${sessionId} (project ${project}): no memories`,
      lessons: [],
      topConcepts: [],
      count: 0,
    };
  }

  const topConcepts = extractConcepts(memories.map((m) => m.content).join("\n"));

  const byOrigin = new Map<string, number>();
  for (const m of memories) byOrigin.set(m.origin, (byOrigin.get(m.origin) ?? 0) + 1);
  const originCounts = [...byOrigin.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([origin, n]) => `${origin}=${n}`)
    .join(" ");

  let earliest = "";
  let latest = "";
  for (const m of memories) {
    const at = Date.parse(m.createdAt);
    if (Number.isNaN(at)) continue;
    if (earliest === "" || m.createdAt < earliest) earliest = m.createdAt;
    if (latest === "" || m.createdAt > latest) latest = m.createdAt;
  }
  const range = earliest === "" ? "time unknown" : earliest === latest ? earliest : `${earliest}..${latest}`;

  const picks = [...memories].sort(comparePicks).slice(0, SUMMARY_PICKS);
  const lines = picks.map((m, i) => `${i + 1}. [${m.origin} imp=${m.importance}] ${excerpt(m.content)}`);
  const lessons = picks
    .slice(0, LESSON_PICKS)
    .map((m) => `lesson: ${excerpt(m.content)}`);

  const conceptsLine = topConcepts.length > 0 ? topConcepts.join(", ") : "none";
  const summary = [
    `session ${sessionId} (project ${project}): ${memories.length} memories, ${originCounts}, ${range}`,
    `top concepts: ${conceptsLine}`,
    ...lines,
  ].join("\n");

  return { summary, lessons, topConcepts, count: memories.length };
}
