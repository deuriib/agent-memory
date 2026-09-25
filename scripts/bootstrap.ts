/**
 * scripts/bootstrap.ts — CONTRACT §3 "Bootstrap retry" (Brainy v1).
 *
 * Creates the full Brainy index set (>= 18 indexes) via
 * `bootstrapIndexes()`, then polls `searchByText` until `index_not_found`
 * clears (2s interval, 30s cap) so first-run searches never 500.
 * Prints READY / FAILED and exits non-zero on failure.
 *
 * Run: npx tsx scripts/bootstrap.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, HelixError } from "@helix-db/helix-db";
import { bootstrapIndexes, searchByText, searchByTextParams } from "../db/queries";

/**
 * Brainy URL resolution: BRAINY_URL is canonical, HELIX_URL is a 1-version
 * fallback alias. Exported pure for testability (no side effects here —
 * the caller prints the single deprecation line).
 */
export function resolveBootstrapUrl(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  usedLegacy: boolean;
} {
  const brainy = env["BRAINY_URL"];
  if (typeof brainy === "string" && brainy !== "") return { url: brainy, usedLegacy: false };
  const legacy = env["HELIX_URL"];
  if (typeof legacy === "string" && legacy !== "") return { url: legacy, usedLegacy: true };
  return { url: "http://localhost:6969", usedLegacy: false };
}

const INTERVAL_MS = 2_000;
const CAP_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Never log query values — only the error's own message/details. */
function describeError(err: unknown): string {
  if (err instanceof HelixError) {
    return `${err.kind}: ${err.message}${err.details === undefined ? "" : ` — ${err.details}`}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * P0.4 advisory: helix.toml declares the dev instance's storage mode. When
 * `storage = "disk"` is absent the instance is IN-MEMORY — every Helix
 * restart wipes it — so say so loudly instead of losing data silently.
 * Advisory only: never blocks bootstrap (unreadable helix.toml -> skip).
 */
function warnIfVolatileStorage(): void {
  try {
    const toml = readFileSync(new URL("../helix.toml", import.meta.url), "utf8");
    if (!/storage\s*=\s*"disk"/.test(toml)) {
      console.error(
        `[brainy] WARNING: helix.toml lacks storage = "disk" — this Helix dev ` +
          `instance is in-memory: EVERY restart wipes it. Run: helix start dev --disk --persist`,
      );
    }
  } catch {
    // helix.toml unreadable: skip the advisory (bootstrap must not fail on it).
  }
}

async function main(): Promise<void> {
  warnIfVolatileStorage();
  const { url, usedLegacy } = resolveBootstrapUrl();
  if (usedLegacy) {
    console.error("WARN deprecated use BRAINY_URL — HELIX_URL will be removed in next major");
  }
  const client = Client.server(url);

  try {
    await client.query(bootstrapIndexes().toQueryRequest()).send();
    console.log("bootstrapIndexes: OK (25 indexes ensured)");
  } catch (err) {
    console.error(`FAILED — bootstrapIndexes rejected by ${url}: ${describeError(err)}`);
    process.exit(1);
  }

  // Poll the BM25 route; empty result sets are a valid "ready" answer.
  const probeValues = { q: "bootstrap", project: "default", k: 1 };
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt++) {
    try {
      await client.query(searchByText().toQueryRequest(searchByTextParams, probeValues)).send();
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`READY — Brainy indexes verified (searchByText responding on attempt ${attempt}, ${elapsed}s)`);
      return;
    } catch (err) {
      const message = describeError(err);
      const elapsedMs = Date.now() - startedAt;
      if (!message.includes("index_not_found")) {
        console.error(`FAILED — non-index error on attempt ${attempt}: ${message}`);
        process.exit(1);
      }
      if (elapsedMs >= CAP_MS) {
        console.error(
          `FAILED — index_not_found still clearing after ${CAP_MS / 1000}s (attempt ${attempt})`,
        );
        process.exit(1);
      }
      await sleep(INTERVAL_MS);
    }
  }
}

/**
 * Entry guard: run main() only when executed directly, so unit tests can
 * import the pure resolvers (resolveBootstrapUrl) with zero side effects.
 * Same argv[1]-comparison posture as scripts/import-transcript.ts.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return fileURLToPath(import.meta.url) === process.argv[1];
    } catch {
      return false;
    }
  })();
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(`FAILED — ${describeError(err)}`);
    process.exit(1);
  });
}
