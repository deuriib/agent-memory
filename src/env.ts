/**
 * Legacy `AGENTMEMORY_*` -> `AGENT_MEMORY_*` environment migration helper
 * (REQ-P0-5 / P0.5).
 *
 * Rules:
 *   - the NEW name (`AGENT_MEMORY_*`) ALWAYS wins when it holds a non-empty
 *     value — even if the legacy name is set too;
 *   - a non-empty legacy `AGENTMEMORY_*` value is a read-only fallback, so a
 *     restart under the old names can never silently drop the bearer secret
 *     or the port/host binding;
 *   - unset or empty on both sides -> `undefined` (guard-open / defaults).
 *
 * Warning contract (name-only, stderr, once): when the LEGACY value is the
 * one actually used, exactly one line goes to `console.error` (stderr), at
 * most once per variable per process, naming the VARIABLES only. The value
 * itself must never reach any stream (contract §3: "no secret value ever
 * logged").
 *
 * Hooks and plugin surfaces must NOT import this module: their zero-output
 * guarantee is absolute, so they read legacy names with a SILENT fallback
 * instead (see `hooks/capture.mjs`).
 */

/** Legacy names already warned about in this process — one warning each. */
const warnedLegacy = new Set<string>();

/** Non-empty means "usable": unset, empty and whitespace-only-free empty all -> undefined. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Read `env[name]`, falling back to `env[legacyName]` when the new name is
 * unset or empty. Emits the one-time, name-only deprecation warning if — and
 * only if — the legacy value is the one being returned.
 */
export function readLegacyEnv(
  name: string,
  legacyName: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const current = nonEmpty(env[name]);
  if (current !== undefined) return current; // new name wins — no warning
  const legacy = nonEmpty(env[legacyName]);
  if (legacy === undefined) return undefined;
  if (!warnedLegacy.has(legacyName)) {
    warnedLegacy.add(legacyName);
    // Names only. NEVER interpolate `legacy` here — it may be the secret.
    console.error(`[agentmemory] deprecated ${legacyName} in use; rename to ${name}`);
  }
  return legacy;
}
