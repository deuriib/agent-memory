/**
 * Bearer guard shared by the REST server and the stdio MCP server.
 *
 * Rule (contract §3, SPEC-001 §4.3, C1): when BRAINY_SECRET (or fallback
 * AGENT_MEMORY_SECRET) is set to a NON-EMPTY value, every surface except
 * `livez` requires `Authorization: Bearer <secret>`; mismatch -> reject.
 * Unset/empty -> open (local-dev default).
 *
 * The secret value is never logged, echoed, or included in error text.
 */
import { createHash, timingSafeEqual } from "node:crypto";

let warnedDeprecatedSecret = false;

/**
 * Non-empty secret arms the guard; unset or empty disarms it.
 * Resolves BRAINY_SECRET first, falling back to AGENT_MEMORY_SECRET with a
 * single static deprecation notice on stderr (C2).
 */
export function secretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const brainy = env["BRAINY_SECRET"];
  if (typeof brainy === "string" && brainy.length > 0) {
    return brainy;
  }
  const legacy = env["AGENT_MEMORY_SECRET"];
  if (typeof legacy === "string" && legacy.length > 0) {
    if (!warnedDeprecatedSecret) {
      warnedDeprecatedSecret = true;
      console.error("WARN deprecated use BRAINY_SECRET — AGENT_MEMORY_SECRET will be removed in next major");
    }
    return legacy;
  }
  return undefined;
}

/** Reset warning state for test isolation */
export function _resetSecretWarningState(): void {
  warnedDeprecatedSecret = false;
}

/** Constant-time comparison of the presented bearer against `secret` via SHA-256 digests. */
function bearerMatches(authorizationHeader: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const presented = Buffer.from(authorizationHeader, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  const h1 = createHash("sha256").update(presented).digest();
  const h2 = createHash("sha256").update(wanted).digest();
  return timingSafeEqual(h1, h2);
}

/**
 * REST guard: `header` is the raw Authorization header value (first entry
 * when a client sends duplicates).
 */
export function isBearerAuthorized(
  header: string | string[] | undefined,
  secret: string | undefined,
): boolean {
  if (secret === undefined) return true; // guard disarmed
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return false;
  return bearerMatches(raw, secret);
}

/**
 * MCP guard: same rule over stdio, where the bearer rides in the request's
 * `_meta.authorization` field instead of an HTTP header (stdio has no
 * headers; this keeps the tool schemas unchanged).
 */
export function isMetaAuthorized(meta: unknown, secret: string | undefined): boolean {
  if (secret === undefined) return true; // guard disarmed
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return false;
  const record = meta as Record<string, unknown>;
  const value = record["authorization"];
  if (typeof value !== "string") return false;
  return bearerMatches(value, secret);
}

