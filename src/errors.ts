/**
 * Error description helpers.
 *
 * Two audiences, two leak budgets:
 *   - `failureSignal`  goes into search `signals` — an HTTP/MCP RESPONSE
 *     addressed to the caller who just sent the query, so echoing a short
 *     piece of the diagnostic is acceptable (worst case it echoes the
 *     caller's own parameter back at them).
 *   - `logSafeNote` goes to process logs — logs may be read by operators and
 *     shipped elsewhere, so REMOTE diagnostics are reduced to their stable
 *     error code only: a remote message can embed query parameters (memory
 *     content). Local error messages never see request content, so they are
 *     kept (they are what makes an operator's day survivable).
 *
 * Neither helper ever prints an auth secret; the bearer value never reaches
 * these functions.
 */
import { HelixError } from "@helix-db/helix-db";

function trimmed(value: string, max: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}

function parseRemoteEnvelope(details: string | undefined): { code: string; msg: string } | undefined {
  if (details === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    // Current envelope: {"error":"<stable_code>","msg":"<diagnostic>"};
    // legacy/proxy envelopes may swap those or use code/message.
    const code =
      typeof record["error"] === "string"
        ? record["error"]
        : typeof record["code"] === "string"
          ? record["code"]
          : "remote_error";
    const msg =
      typeof record["msg"] === "string"
        ? record["msg"]
        : typeof record["message"] === "string"
          ? record["message"]
          : "";
    return { code, msg };
  } catch {
    return undefined;
  }
}

/** Short failure text for `signals` in a search RESPONSE (caller-facing). */
export function failureSignal(err: unknown): string {
  if (err instanceof HelixError && err.kind === "Remote") {
    const envelope = parseRemoteEnvelope(err.details);
    if (envelope === undefined) return `remote: ${trimmed(err.details ?? "unparseable remote error", 160)}`;
    return envelope.msg.length > 0 ? `${envelope.code}: ${trimmed(envelope.msg, 160)}` : envelope.code;
  }
  if (err instanceof Error) return `${err.name}: ${trimmed(err.message, 200)}`;
  return trimmed(String(err), 200);
}

/** Log-safe failure note: remote failures reduce to their stable code only. */
export function logSafeNote(err: unknown): string {
  if (err instanceof HelixError) {
    if (err.kind === "Remote") {
      const envelope = parseRemoteEnvelope(err.details);
      return `HelixError:remote:${envelope?.code ?? "unknown_code"}`;
    }
    return `HelixError:${err.kind}`;
  }
  if (err instanceof Error) return `${err.name}: ${trimmed(err.message, 200)}`;
  return trimmed(String(err), 200);
}
