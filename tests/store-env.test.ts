/**
 * RL-002 re-scoped (orchestrator arbitration 2026-09-25): `HelixStore`
 * builds a Helix client (`Client.server`), so it must resolve the Helix
 * endpoint — `HELIX_URL` primary (SPEC-003 §4.3: no rename), default
 * `http://localhost:6969`. `BRAINY_URL` / `AGENT_MEMORY_URL` are REST
 * semantics (ARCH §3, README env table, `bin/brainy.mjs` restBaseUrl) and
 * must NOT drive the store: commit `b91821a` read `BRAINY_URL` first, so
 * every spawned child (which receives BOTH vars) pointed its Helix client
 * at `<rest>/v2/query` → 404 → 500 on every write.
 *
 * Hermetic: resolver is pure-with-env-param; construction never connects
 * (Client.server is lazy) — no containers, no secrets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HelixStore, _resetStoreUrlWarningState, resolveStoreUrl } from "../src/store.js";

test("RL-002: HELIX_URL wins even when BRAINY_URL points at a REST-style port", () => {
  _resetStoreUrlWarningState();
  const url = resolveStoreUrl({
    BRAINY_URL: "http://127.0.0.1:3114",
    AGENT_MEMORY_URL: "http://127.0.0.1:3114",
    HELIX_URL: "http://127.0.0.1:6970",
  });
  assert.equal(url, "http://127.0.0.1:6970");
});

test("RL-002: BRAINY_URL alone does NOT drive the store (falls to the Helix default)", () => {
  _resetStoreUrlWarningState();
  assert.equal(resolveStoreUrl({ BRAINY_URL: "http://127.0.0.1:3114" }), "http://localhost:6969");
});

test("RL-002: AGENT_MEMORY_URL alone does NOT drive the store", () => {
  _resetStoreUrlWarningState();
  assert.equal(
    resolveStoreUrl({ AGENT_MEMORY_URL: "http://127.0.0.1:3114" }),
    "http://localhost:6969",
  );
});

test("RL-002: all absent/empty falls back to the local-dev default with no warning", () => {
  _resetStoreUrlWarningState();
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    assert.equal(resolveStoreUrl({}), "http://localhost:6969");
    assert.equal(resolveStoreUrl({ BRAINY_URL: "", AGENT_MEMORY_URL: "", HELIX_URL: "" }), "http://localhost:6969");
    assert.equal(resolveStoreUrl({ HELIX_URL: "" }), "http://localhost:6969");
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 0);
});

test("RL-002: no REST fallback warning is ever emitted (single-source HELIX_URL)", () => {
  _resetStoreUrlWarningState();
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    resolveStoreUrl({ HELIX_URL: "http://127.0.0.1:6970" });
    resolveStoreUrl({ BRAINY_URL: "http://127.0.0.1:3114" });
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 0);
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
    const store = new HelixStore("http://127.0.0.1:9");
    assert.ok(store instanceof HelixStore);
    const defaulted = new HelixStore();
    assert.ok(defaulted instanceof HelixStore);
  } finally {
    if (saved.brainy === undefined) delete process.env["BRAINY_URL"];
    else process.env["BRAINY_URL"] = saved.brainy;
    if (saved.legacy === undefined) delete process.env["AGENT_MEMORY_URL"];
    else process.env["AGENT_MEMORY_URL"] = saved.legacy;
    if (saved.helix === undefined) delete process.env["HELIX_URL"];
    else process.env["HELIX_URL"] = saved.helix;
  }
});

test("RL-002: spawn passes BOTH BRAINY_URL (REST) and HELIX_URL (Helix) per REQ-BRAINY-OPS-02", () => {
  // Read-only shape assertion on the spawn contract owner (R8 file —
  // never edited here): the child must receive both endpoints so the
  // server's REST layer and its Helix client each resolve correctly.
  const cli = readFileSync(new URL("../bin/brainy.mjs", import.meta.url), "utf8");
  assert.match(cli, /BRAINY_URL:\s*`http:\/\/127\.0\.0\.1:\$\{ports\.rest\}`/);
  assert.match(cli, /HELIX_URL:\s*`http:\/\/127\.0\.0\.1:\$\{ports\.helix\}`/);
});
