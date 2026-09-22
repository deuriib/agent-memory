/**
 * Recap/handoff digest (contract §3, P3.1 — degrades, never rejects).
 *
 * Single source of truth shared by BOTH lanes (`src/server.ts` REST and
 * `src/mcp.ts` stdio): the frozen contract requires the two to mirror each
 * other, and a copy in each lane can only drift silently (the MCP mirrors are
 * not re-asserted by `scripts/verify.ts`).
 *
 * Fan-out budget: a project-wide digest issues one sequential store call per
 * session, each capped at 15s (`src/store.ts`), so the unbounded aggregate was
 * ~25min against a slow-but-alive store. `DIGEST_BUDGET_MS` stops the loop
 * mid-fan-out and records `digest: budget exceeded` in `signals` — same
 * `<source>: <failure>` style as `memories(…)`, `sessions`, `counts`.
 */
import { failureSignal } from "./errors.js";
import { type MemoryStore } from "./store.js";

const DEFAULT_PROJECT = "default";
const DEFAULT_LIMIT = 10;
/** Aggregate wall-clock budget for the digest's sequential store fan-out. */
export const DIGEST_BUDGET_MS = 20_000;

export interface DigestInput {
  project?: string | undefined;
  sessionId?: string | undefined;
  limit?: number | undefined;
}

export interface DigestLines {
  lines: string[];
  /** Number of memories summarized across all sessions. */
  count: number;
  /** Per-store-call failures as `<source>: <failure>` (src/search.ts style). */
  signals: string[];
}

/**
 * One bullet per memory: `- [sessionId] createdAt (origin): content`, in
 * session order then memory order. Every store call is individually wrapped:
 * a failure lands in `signals` while the remaining sessions still contribute
 * lines — a digest never rejects/throws for store failures. The session loop
 * also honors `DIGEST_BUDGET_MS`, appending `digest: budget exceeded` and
 * stopping instead of fanning out further.
 */
export async function buildDigestLines(store: MemoryStore, input: DigestInput): Promise<DigestLines> {
  const project = input.project ?? DEFAULT_PROJECT;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const deadline = Date.now() + DIGEST_BUDGET_MS;
  const lines: string[] = [];
  const signals: string[] = [];
  let count = 0;

  const appendSession = async (sessionId: string): Promise<void> => {
    try {
      const memories = await store.sessionMemories({ sessionId, project, limit });
      for (const memory of memories) {
        lines.push(`- [${sessionId}] ${memory.createdAt} (${memory.origin}): ${memory.content}`);
      }
      count += memories.length;
    } catch (err) {
      signals.push(`memories(${sessionId}): ${failureSignal(err)}`);
    }
  };

  if (input.sessionId !== undefined) {
    await appendSession(input.sessionId);
    return { lines, count, signals };
  }

  try {
    // appendSession never rejects (fully wrapped), so this catch is listSessions only.
    const sessions = await store.listSessions({ project, limit });
    for (const session of sessions) {
      if (Date.now() >= deadline) {
        signals.push("digest: budget exceeded");
        break;
      }
      await appendSession(session.sessionId);
    }
  } catch (err) {
    signals.push(`sessions: ${failureSignal(err)}`);
  }
  return { lines, count, signals };
}
