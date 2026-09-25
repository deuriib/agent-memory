/**
 * Step 8: Ops control plane — canonical bin/brainy.mjs + 1-version shim.
 * REQ-BRAINY-OPS-01..06, NFR-BRAINY-OPS-01 (AC-01..06, AC-NFR01).
 * Hermetic: high slots (61..63), read-only probes, synthetic secrets only.
 * Never binds 3111/3112/3113/3151/6969, never signals, no Docker needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BRAINY = path.join(ROOT, "bin/brainy.mjs");
const SHIM = path.join(ROOT, "bin/agent-memory.mjs");

interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function scrubSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of [
    "BRAINY_SECRET",
    "AGENT_MEMORY_SECRET",
    "BRAINY_URL",
    "AGENT_MEMORY_URL",
    "BRAINY_PORT",
    "AGENT_MEMORY_PORT",
    "BRAINY_DATA_DIR",
    "AGENT_MEMORY_DATA_DIR",
  ]) {
    delete next[key];
  }
  return next;
}

function run(bin: string, args: readonly string[], extraEnv: Record<string, string> = {}, scrub = true): RunResult {
  const base = scrub ? scrubSecrets(process.env) : { ...process.env };
  const res = spawnSync("node", [bin, ...args], {
    cwd: ROOT,
    env: { ...base, ...extraEnv },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: res.status, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function brainy(args: readonly string[], extraEnv: Record<string, string> = {}, scrub = true): RunResult {
  return run(BRAINY, args, extraEnv, scrub);
}

test("Step 8: brainy --help usage on stdout exit 0 (REQ-01 AC-01)", () => {
  const res = brainy(["--help"]);
  assert.equal(res.code, 0);
  assert.ok(res.out.includes("brainy add"), res.out.slice(0, 200));
  for (const cmd of ["add", "move", "distill", "context", "export", "search", "start", "stop", "status", "doctor"]) {
    assert.ok(res.out.includes(cmd), `missing ${cmd}`);
  }
  assert.ok(res.out.includes("R(N) = 3111 + 3(N-1)"), "slot math missing");
});

test("Step 8: shim --help same usage + deprecation on stderr exit 0 (REQ-01 AC-01)", () => {
  const shim = run(SHIM, ["--help"]);
  const direct = brainy(["--help"]);
  assert.equal(shim.code, 0);
  assert.equal(shim.out, direct.out);
  assert.ok(shim.err.includes("WARN deprecated use brainy"), shim.err.slice(0, 200));
});

test("Step 8: fail-closed parser — unknown subcommand/flag/value exit 2 (REQ-01)", () => {
  for (const args of [["bogus"], ["status", "--slot", "1", "--nope"], ["status", "--slot", "0"], ["status", "--slot", "abc"], ["move", "x"], ["context"], ["export", "--format", "pdf", "--out", "/tmp/x", "--project", "p"]]) {
    const res = brainy(args);
    assert.equal(res.code, 2, `${args.join(" ")} -> ${String(res.code)}`);
    assert.ok(res.err.toLowerCase().includes("usage"), args.join(" "));
  }
  const shim = run(SHIM, ["bogus"]);
  assert.equal(shim.code, 2);
});

test("Step 8: derive(1)=3111/6969 derive(2)=3114/6970, out-of-range usage (REQ-01 AC-01)", () => {
  const s2 = brainy(["status", "--slot", "2"]);
  assert.ok(s2.out.includes("rest=3114"), s2.out);
  assert.ok(s2.out.includes("helix=6970"), s2.out);
  assert.ok(s2.out.includes("reserved=3115,3116"), s2.out);
  assert.ok(s2.out.includes("instance: slot2"), s2.out);
  const s1 = brainy(["status", "--slot", "1"]);
  assert.ok(s1.out.includes("instance: dev"), s1.out);
  assert.ok(s1.out.includes("rest=3111"), s1.out);
  assert.ok(s1.out.includes("helix=6969"), s1.out);
  const oor = brainy(["status", "--slot", "30000"]);
  assert.equal(oor.code, 2);
  const s20 = brainy(["status", "--slot", "20"]);
  assert.ok(s20.out.includes("rest=3168") && s20.out.includes("helix=6988"), s20.out);
});

test("Step 8: BRAINY_* canonical + AGENT_MEMORY_* single-warning fallback (REQ-02 AC-02)", () => {
  const alias = brainy(["status", "--slot", "63"], { AGENT_MEMORY_DATA_DIR: "/tmp/xyz-alias-step8" });
  assert.ok(alias.err.includes("WARN deprecated use BRAINY_DATA_DIR"), alias.err);
  const warns = (alias.err.match(/WARN deprecated use BRAINY_DATA_DIR/g) ?? []).length;
  assert.equal(warns, 1);
  assert.ok(alias.out.includes("/tmp/xyz-alias-step8"), alias.out);
  const prec = brainy(
    ["status", "--slot", "63"],
    { BRAINY_DATA_DIR: "/tmp/brainy-dd-step8", AGENT_MEMORY_DATA_DIR: "/tmp/xyz-alias-step8" },
  );
  assert.ok(prec.out.includes("/tmp/brainy-dd-step8"), prec.out);
  assert.ok(!prec.err.includes("WARN deprecated"), prec.err);
  const secretWarn = brainy(["status", "--slot", "63"], { AGENT_MEMORY_SECRET: "synthetic-step8-secret" });
  assert.equal((secretWarn.err.match(/WARN deprecated use BRAINY_SECRET/g) ?? []).length, 1);
  assert.ok(secretWarn.out.includes("bearer: armed"), secretWarn.out);
  assert.ok(!secretWarn.out.includes("synthetic-step8-secret") && !secretWarn.err.includes("synthetic-step8-secret"));
});

test("Step 8: status read-only, bearer flag only, never a secret (REQ-04 NFR-01)", () => {
  const res = brainy(["status", "--slot", "63"], { BRAINY_SECRET: "synthetic-step8-secret" });
  assert.ok([0, 1].includes(res.code ?? -1), `code=${String(res.code)}`);
  assert.ok(res.out.includes("bearer: armed"), res.out);
  assert.ok(!res.out.includes("synthetic-step8-secret") && !res.err.includes("synthetic-step8-secret"));
  const unset = brainy(["status", "--slot", "63"]);
  assert.ok(unset.out.includes("bearer: unset"), unset.out);
});

test("Step 8: doctor one VERDICT, precedence secret-missing(5) > helix-down(4) (REQ-05 AC-05)", () => {
  const noSecret = brainy(["doctor", "--slot", "63"]);
  assert.equal(noSecret.code, 5);
  assert.ok(noSecret.out.includes("VERDICT: secret-missing"), noSecret.out);
  assert.equal((noSecret.out.match(/VERDICT:/g) ?? []).length, 1);
  const withSecret = brainy(["doctor", "--slot", "63"], { BRAINY_SECRET: "synthetic-step8-secret" });
  assert.equal(withSecret.code, 4);
  assert.ok(withSecret.out.includes("VERDICT: helix-down"), withSecret.out);
  const order = ["C1 helix-healthz", "C3 ports", "C2 rest-health", "C4 secret-presence", "C5 storage-data-dir"];
  const idxs = order.map((t) => withSecret.out.indexOf(t));
  assert.ok(idxs.every((v) => v !== -1), `missing check: ${idxs.join(",")}`);
  assert.ok(idxs.every((v, i) => i === 0 || v > (idxs[i - 1] as number)), `order: ${idxs.join(",")}`);
});

test("Step 8: --migrate fail-closed abort, --apply without --yes usage (REQ-06 AC-06)", () => {
  const dry = brainy(["doctor", "--slot", "63", "--migrate"]);
  const dryCombined = dry.out + dry.err;
  assert.ok(dryCombined.includes("MIGRATE ABORT") && dryCombined.includes("unsupported-runtime"), dryCombined);
  assert.ok(dryCombined.includes("no backup was written"), dryCombined);
  const noYes = brainy(["doctor", "--slot", "63", "--migrate", "--apply"]);
  assert.equal(noYes.code, 2);
  const apply = brainy(["doctor", "--slot", "63", "--migrate", "--apply", "--yes", "--backup-dir", "/tmp/step8-backup"]);
  assert.ok((apply.out + apply.err).includes("unsupported-runtime"));
});

test("Step 8: thin clients refuse without server, exit 1, no crash (REQ-04 ARCH §1)", () => {
  const add = brainy(["add", "hello without server", "--slot", "63"]);
  assert.equal(add.code, 1);
  assert.ok((add.out + add.err).includes("REFUSE"), add.out + add.err);
  const search = brainy(["search", "hello", "--slot", "63"]);
  assert.equal(search.code, 1);
});

test("Step 8: never-kill static audit — guarded signals only, never a secret print (NFR-01)", () => {
  const text = readFileSync(BRAINY, "utf8");
  for (const needle of ["verifyOwnedPid", "signalOwned", "NEVER_BIND", "neverKillHint"]) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
  assert.ok(text.includes("BRAINY_PORT=3151"), "hint must use BRAINY_PORT=3151");
  for (const needle of ["fuser", "docker rm", "pkill", "killall", "helix prune"]) {
    assert.ok(!text.includes(needle), `forbidden ${needle}`);
  }
  assert.ok(text.includes("bearer: armed|unset"), "presence flag only");
  const killCalls = (text.match(/process\.kill\(/g) ?? []).length;
  assert.ok(killCalls >= 1, "expected guarded process.kill via signalOwned/pidAlive");
});

test("Step 8: move --help documents the dedicated move route semantics (REQ-04 ADR-0003-C3)", () => {
  const res = brainy(["move", "--help"]);
  assert.equal(res.code, 0);
  assert.ok(res.out.includes("--to <project|area|resource|archive>"), res.out.slice(0, 400));
  assert.ok(res.out.includes("--name"), res.out.slice(0, 800));
  assert.ok(res.out.includes("current PARA node name"), res.out);
});

test("Step 8: move parser fail-closed — bad category/empty/conflict exit 2 (REQ-04)", () => {
  for (const args of [
    ["move", "n1"],
    ["move", "n1", "--to", "bogus:X"],
    ["move", "n1", "--to", "Project:X"],
    ["move", "n1", "--to", "project:"],
    ["move", "n1", "--to", "area:A", "--name", "B"],
    ["move", "n1", "--to", "project", "--name", ""],
  ]) {
    const res = brainy(args);
    assert.equal(res.code, 2, `${args.join(" ")} -> ${String(res.code)}`);
    assert.ok(res.err.toLowerCase().includes("usage"), args.join(" "));
  }
});

test("Step 8: move static — POST /v1/notes/:id/move, stale comment gone, no /v1/link (REQ-04 ADR-0003-C3)", () => {
  const text = readFileSync(BRAINY, "utf8");
  assert.ok(text.includes("/move"), "missing /move route");
  assert.ok(!text.includes("no dedicated move route"), "stale comment still present");
  assert.ok(!text.includes("/v1/link"), "old link workaround still present");
  assert.ok(!text.includes("BELONGS_TO"), "old link type still present");
});

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

type MoveHandler = (req: RecordedRequest) => { status: number; payload: unknown };

async function withMoveServer(handler: MoveHandler, fn: (baseUrl: string, requests: RecordedRequest[]) => Promise<void>): Promise<void> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const rec: RecordedRequest = { method: req.method ?? "", url: req.url ?? "", body };
      requests.push(rec);
      const answer = handler(rec);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.payload));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr !== null && typeof addr === "object", "server did not bind");
  try {
    await fn(`http://127.0.0.1:${(addr as { port: number }).port}`, requests);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

function runBrainyAsync(args: readonly string[], extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [BRAINY, ...args], {
      cwd: ROOT,
      env: { ...scrubSecrets(process.env), ...extraEnv },
    });
    let out = "";
    let errOut = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      errOut += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli timeout: brainy ${args.join(" ")}`));
    }, 25_000);
    if (typeof timer.unref === "function") timer.unref();
    child.on("error", (cause: Error) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err: errOut });
    });
  });
}

test("Step 8: move shorthand POSTs /v1/notes/:id/move with {to,name,project} (REQ-04 ADR-0003-C3)", async () => {
  await withMoveServer(
    (req) => {
      if (req.method === "POST" && req.url === "/v1/notes/n1/move") {
        return { status: 200, payload: { id: "n1", para: { label: "Project", name: "Foo" } } };
      }
      return { status: 404, payload: { error: "not_found" } };
    },
    async (baseUrl, requests) => {
      const res = await runBrainyAsync(["move", "n1", "--to", "project:Foo"], { BRAINY_URL: baseUrl });
      assert.equal(res.code, 0, res.out + res.err);
      assert.ok(res.out.includes("moved: n1 -> project:Foo"), res.out);
      assert.equal(requests.length, 1, `expected POST only, got ${JSON.stringify(requests)}`);
      assert.equal(requests[0]?.method, "POST");
      assert.equal(requests[0]?.url, "/v1/notes/n1/move");
      assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), { to: "project", name: "Foo", project: "default" });
      assert.ok(!requests.some((r) => r.url === "/v1/link"), "must not call the old workaround");
    },
  );
});

test("Step 8: move --name flag plus --project reach the move body (REQ-04 ADR-0003-C3)", async () => {
  await withMoveServer(
    (req) => {
      if (req.method === "POST" && req.url === "/v1/notes/n1/move") {
        return { status: 200, payload: { id: "n1", para: { label: "Area", name: "Work" } } };
      }
      return { status: 404, payload: { error: "not_found" } };
    },
    async (baseUrl, requests) => {
      const res = await runBrainyAsync(["move", "n1", "--to", "area", "--name", "Work", "--project", "p1"], {
        BRAINY_URL: baseUrl,
      });
      assert.equal(res.code, 0, res.out + res.err);
      assert.ok(res.out.includes("moved: n1 -> area:Work"), res.out);
      assert.equal(requests.length, 1, `expected POST only, got ${JSON.stringify(requests)}`);
      assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), { to: "area", name: "Work", project: "p1" });
      assert.ok(!requests.some((r) => r.url === "/v1/link"), "must not call the old workaround");
    },
  );
});

test("Step 8: move without --name reuses the current PARA name, never prints content (REQ-04 ADR-0003-C3)", async () => {
  await withMoveServer(
    (req) => {
      if (req.method === "GET" && req.url.startsWith("/v1/notes/n1")) {
        return {
          status: 200,
          payload: {
            note: { id: "n1", title: "t", content: "super-secret-content-step8", project: "default" },
            para: { category: "resource", name: "KeptName" },
          },
        };
      }
      if (req.method === "POST" && req.url === "/v1/notes/n1/move") {
        return { status: 200, payload: { id: "n1", para: { label: "Archive", name: "KeptName" } } };
      }
      return { status: 404, payload: { error: "not_found" } };
    },
    async (baseUrl, requests) => {
      const res = await runBrainyAsync(["move", "n1", "--to", "archive"], { BRAINY_URL: baseUrl });
      assert.equal(res.code, 0, res.out + res.err);
      assert.ok(res.out.includes("moved: n1 -> archive:KeptName"), res.out);
      assert.ok(!res.out.includes("super-secret-content-step8") && !res.err.includes("super-secret-content-step8"));
      assert.equal(requests.length, 2, `expected GET+POST, got ${JSON.stringify(requests)}`);
      assert.equal(requests[0]?.method, "GET");
      assert.equal(requests[1]?.method, "POST");
      assert.equal(requests[1]?.url, "/v1/notes/n1/move");
      assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), { to: "archive", name: "KeptName", project: "default" });
      assert.ok(!requests.some((r) => r.url === "/v1/link"), "must not call the old workaround");
    },
  );
});

test("Step 8: move maps POST 404/400 and missing-note GET to exit 1 (REQ-04 ADR-0003-C3)", async () => {
  await withMoveServer(
    (req) => {
      if (req.method === "POST" && req.url === "/v1/notes/n-missing/move") {
        return { status: 404, payload: { error: "para_target_not_found" } };
      }
      return { status: 404, payload: { error: "not_found" } };
    },
    async (baseUrl) => {
      const missing = await runBrainyAsync(["move", "n-missing", "--to", "project:Nope"], { BRAINY_URL: baseUrl });
      assert.equal(missing.code, 1, missing.out + missing.err);
      assert.ok((missing.out + missing.err).includes("404"), missing.out + missing.err);
    },
  );
  await withMoveServer(
    (req) => {
      if (req.method === "POST" && req.url === "/v1/notes/n-bad/move") {
        return { status: 400, payload: { error: "invalid_request" } };
      }
      return { status: 404, payload: { error: "not_found" } };
    },
    async (baseUrl) => {
      const bad = await runBrainyAsync(["move", "n-bad", "--to", "project:Nope"], { BRAINY_URL: baseUrl });
      assert.equal(bad.code, 1, bad.out + bad.err);
      assert.ok((bad.out + bad.err).includes("400"), bad.out + bad.err);
    },
  );
  await withMoveServer(
    () => ({ status: 404, payload: { error: "not_found" } }),
    async (baseUrl, requests) => {
      const gone = await runBrainyAsync(["move", "n-gone", "--to", "archive"], { BRAINY_URL: baseUrl });
      assert.equal(gone.code, 1, gone.out + gone.err);
      assert.ok((gone.out + gone.err).includes("note not found"), gone.out + gone.err);
      assert.equal(requests.length, 1, "missing note must not attempt the move POST");
      assert.equal(requests[0]?.method, "GET");
    },
  );
});
