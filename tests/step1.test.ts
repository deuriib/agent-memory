import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("Step 1: package.json manifest, helix.toml, and mcp_config.json", () => {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.equal(pkg.name, "brainy", "package.json name must be brainy");
  assert.equal(
    pkg.description,
    "Brainy — Segundo cerebro aumentado con agentes sobre HelixDB (CODE/PARA, hybrid retrieval)",
    "package.json description must match Brainy specification"
  );
  assert.deepEqual(pkg.bin, {
    brainy: "./bin/brainy.mjs",
    "agent-memory": "./bin/agent-memory.mjs",
  });
  assert.equal(
    pkg.scripts["migrate-embeddings"],
    "tsx scripts/migrate-embeddings.ts",
    "migrate-embeddings script must be registered"
  );

  const helixPath = path.join(ROOT, "helix.toml");
  const helixContent = fs.readFileSync(helixPath, "utf8");
  assert.match(
    helixContent,
    /\[project\]\s+name\s*=\s*"brainy"/,
    "helix.toml must have [project] name = \"brainy\""
  );

  const mcpConfigPath = path.join(ROOT, "mcp_config.json");
  const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
  assert.ok(
    mcpConfig.mcpServers?.brainy || mcpConfig.mcpServers?.["agent-memory"],
    "mcp_config.json must have brainy or agent-memory server config"
  );
  assert.ok(
    mcpConfig.mcpServers?.brainy,
    "mcp_config.json must have brainy server config"
  );
});
