#!/usr/bin/env node
/**
 * agent-memory — 1-version deprecation shim (SPEC-003-brainy-ops REQ-BRAINY-OPS-01).
 *
 * Zero logic: emits one deprecation line on stderr and delegates every
 * invocation to the canonical `bin/brainy.mjs`, mirroring its exit code.
 * Alias window ends at the next major (INV-001 / HARD alias1version).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "brainy.mjs");
try {
  process.stderr.write("WARN deprecated use brainy — agent-memory alias will be removed in next major\n");
} catch {
  /* never crash on a closed pipe */
}
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(typeof result.status === "number" ? result.status : 1);
