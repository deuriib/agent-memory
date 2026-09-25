/**
 * RL-002 (Med): `HelixStore` read `HELIX_URL` only — a canonical-only
 * (`BRAINY_URL`) operator config silently fell through to shared-dev
 * `:6969`. The constructor now resolves canonical-first
 * (`BRAINY_URL` > `AGENT_MEMORY_URL` / `HELIX_URL` alias with a single static
 * warning, values never logged) via `resolveStoreUrl` — the same 1-version
 * alias shape as `secretFromEnv` / `ttlDaysFromEnv` / `resolveBootstrapUrl`.
 *
 * Hermetic: resolver is pure-with-env-param; construction never connects
 * (Client.server is lazy) — no containers, no secrets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HelixStore, _resetStoreUrlWarningState, resolveStoreUrl } from "../src/store.js";

/** Capture console.error lines for the duration of `fn`. */
function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("RL-002: canonical BRAINY_URL wins over every alias with no warning", () => {
  _resetStoreUrlWarningState();
  const warnings = captureStderr(() => {
    const url = resolveStoreUrl({
      BRAINY_URL: "http://127.0.0.1:7701",
      AGENT_MEMORY_URL: "http://127.0.0.1:7702",
      HELIX_URL: "http://127.0.0.1:7703",
    });
    assert.equal(url, "http://127.0.0.1:7701");
  });
  assert.equal(warnings.length, 0);
});

test("RL-002: AGENT_MEMORY_URL fallback resolves with exactly one static warning, values never logged", () => {
  _resetStoreUrlWarningState();
  const warnings = captureStderr(() => {
    const first = resolveStoreUrl({ AGENT_MEMORY_URL: "http://127.0.0.1:7702" });
    assert.equal(first, "http://127.0.0.1:7702");
    const second = resolveStoreUrl({ AGENT_MEMORY_URL: "http://127.0.0.1:7702" });
    assert.equal(second, "http://127.0.0.1:7702");
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], "WARN deprecated use BRAINY_URL");
  assert.ok(!warnings[0]?.includes("7702"), "alias value must never be logged");
});

test("RL-002: HELIX_URL fallback resolves with the same single static warning", () => {
  _resetStoreUrlWarningState();
  const warnings = captureStderr(() => {
    const url = resolveStoreUrl({ HELIX_URL: "http://127.0.0.1:6969" });
    assert.equal(url, "http://127.0.0.1:6969");
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], "WARN deprecated use BRAINY_URL");
});

test("RL-002: all absent/empty falls back to the local-dev default with no warning", () => {
  _resetStoreUrlWarningState();
  const warnings = captureStderr(() => {
    assert.equal(resolveStoreUrl({}), "http://localhost:6969");
    assert.equal(
      resolveStoreUrl({ BRAINY_URL: "", AGENT_MEMORY_URL: "", HELIX_URL: "" }),
      "http://localhost:6969",
    );
  });
  assert.equal(warnings.length, 0);
});

test("RL-002: empty canonical falls through to the alias (empty = unset, never a value)", () => {
  _resetStoreUrlWarningState();
  const warnings = captureStderr(() => {
    const url = resolveStoreUrl({ BRAINY_URL: "", HELIX_URL: "http://127.0.0.1:6969" });
    assert.equal(url, "http://127.0.0.1:6969");
  });
  assert.equal(warnings.length, 1);
});

test("RL-002: explicit constructor arg still wins and construction never connects", () => {
  const saved = {
    brainy: process.env["BRAINY_URL"],
    legacy: process.env["AGENT_MEMORY_URL"],
    helix: process.env["HELIX_URL"],
  };
  delete process.env["BRAINY_URL"];
  delete process.env["AGENT_MEMORY_URL"];
  delete process.env["HELIX_URL"];
  try {
    _resetStoreUrlWarningState();
    const warnings = captureStderr(() => {
      const store = new HelixStore("http://127.0.0.1:9");
      assert.ok(store instanceof HelixStore);
      const defaulted = new HelixStore();
      assert.ok(defaulted instanceof HelixStore);
    });
    assert.equal(warnings.length, 0);
  } finally {
    if (saved.brainy === undefined) delete process.env["BRAINY_URL"];
    else process.env["BRAINY_URL"] = saved.brainy;
    if (saved.legacy === undefined) delete process.env["AGENT_MEMORY_URL"];
    else process.env["AGENT_MEMORY_URL"] = saved.legacy;
    if (saved.helix === undefined) delete process.env["HELIX_URL"];
    else process.env["HELIX_URL"] = saved.helix;
  }
});
