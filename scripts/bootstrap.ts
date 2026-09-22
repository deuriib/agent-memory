/**
 * scripts/bootstrap.ts — CONTRACT §3 "Bootstrap retry".
 *
 * Creates the 7 indexes via `bootstrapIndexes()`, then polls `searchByText`
 * until `index_not_found` clears (2s interval, 30s cap) so first-run searches
 * never 500. Prints READY / FAILED and exits non-zero on failure.
 *
 * Run: npx tsx scripts/bootstrap.ts
 */
import { Client, HelixError } from "@helix-db/helix-db";
import { bootstrapIndexes, searchByText, searchByTextParams } from "../db/queries";

const url = process.env.HELIX_URL ?? "http://localhost:6969";
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

async function main(): Promise<void> {
  const client = Client.server(url);

  try {
    await client.query(bootstrapIndexes().toQueryRequest()).send();
    console.log("bootstrapIndexes: OK (7 indexes ensured)");
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
      console.log(`READY — searchByText responding on attempt ${attempt} (${elapsed}s)`);
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

main().catch((err: unknown) => {
  console.error(`FAILED — ${describeError(err)}`);
  process.exit(1);
});
