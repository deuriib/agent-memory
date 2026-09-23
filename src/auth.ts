/**
 * Bearer guard shared by the REST server and the stdio MCP server.
 *
 * Rule (contract §3): when AGENT_MEMORY_SECRET is set to a NON-EMPTY value,
 * every surface except `livez` requires `Authorization: Bearer <secret>`;
 * mismatch -> reject. Unset/empty -> open (local-dev default).
 *
 * The secret value is never logged, echoed, or included in error text.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Non-empty secret arms the guard; unset or empty disarms it.
 */
export function secretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env["AGENT_MEMORY_SECRET"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Constant-time comparison of the presented bearer against `secret`. */
function bearerMatches(authorizationHeader: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const presented = Buffer.from(authorizationHeader, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (presented.length !== wanted.length) return false;
  return timingSafeEqual(presented, wanted);
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
