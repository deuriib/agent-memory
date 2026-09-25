/**
 * TTL canonical-first wiring (CDR-02, REQ-BRAINY-LEG-03 / AC-03).
 *
 * `filterExpired` resolves `BRAINY_TTL_DAYS` first with the legacy
 * `AGENT_MEMORY_TTL_DAYS` alias behind a single static deprecation notice.
 * Absent / non-numeric / <= 0 -> TTL OFF declared (all rows kept).
 * Hermetic: synthetic row content only, no secrets, no containers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _resetTtlWarningState, filterExpired } from "../src/lifecycle.js";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-25T00:00:00.000Z");

interface Row {
  createdAt: string;
}

function row(ageDays: number): Row {
  return { createdAt: new Date(NOW - ageDays * DAY_MS).toISOString() };
}

function saveEnv(): { canonical: string | undefined; alias: string | undefined } {
  return {
    canonical: process.env["BRAINY_TTL_DAYS"],
    alias: process.env["AGENT_MEMORY_TTL_DAYS"],
  };
}

function restoreEnv(saved: { canonical: string | undefined; alias: string | undefined }): void {
  if (saved.canonical === undefined) delete process.env["BRAINY_TTL_DAYS"];
  else process.env["BRAINY_TTL_DAYS"] = saved.canonical;
  if (saved.alias === undefined) delete process.env["AGENT_MEMORY_TTL_DAYS"];
  else process.env["AGENT_MEMORY_TTL_DAYS"] = saved.alias;
}

function setEnv(canonical: string | undefined, alias: string | undefined): void {
  if (canonical === undefined) delete process.env["BRAINY_TTL_DAYS"];
  else process.env["BRAINY_TTL_DAYS"] = canonical;
  if (alias === undefined) delete process.env["AGENT_MEMORY_TTL_DAYS"];
  else process.env["AGENT_MEMORY_TTL_DAYS"] = alias;
}

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

test("canonical BRAINY_TTL_DAYS wins over alias when both set", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    setEnv("30", "1");
    const warnings = captureStderr(() => {
      const kept = filterExpired([row(5), row(60)], NOW);
      assert.equal(kept.length, 1);
    });
    assert.equal(warnings.length, 0);
  } finally {
    restoreEnv(saved);
  }
});

test("alias-only resolves value with exactly one static deprecation warning", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    setEnv(undefined, "30");
    const warnings = captureStderr(() => {
      const first = filterExpired([row(5), row(60)], NOW);
      assert.equal(first.length, 1);
      const second = filterExpired([row(5)], NOW);
      assert.equal(second.length, 1);
    });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0], "WARN deprecated use BRAINY_TTL_DAYS");
  } finally {
    restoreEnv(saved);
  }
});

test("canonical-only resolves with no warning", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    setEnv("30", undefined);
    const warnings = captureStderr(() => {
      const kept = filterExpired([row(5), row(60)], NOW);
      assert.equal(kept.length, 1);
    });
    assert.equal(warnings.length, 0);
  } finally {
    restoreEnv(saved);
  }
});

test("absent / invalid / zero / negative TTL declares OFF (all rows kept)", () => {
  const saved = saveEnv();
  try {
    const rows = [row(5), row(600)];
    for (const value of [undefined, "not-a-number", "0", "-3"]) {
      _resetTtlWarningState();
      setEnv(value, undefined);
      const warnings = captureStderr(() => {
        const kept = filterExpired(rows, NOW);
        assert.equal(kept.length, 2);
      });
      assert.equal(warnings.length, 0);
    }
    _resetTtlWarningState();
    setEnv(undefined, "0");
    const kept = filterExpired(rows, NOW);
    assert.equal(kept.length, 2);
  } finally {
    restoreEnv(saved);
  }
});

test("strict-greater expiry: boundary row survives, older row hidden, unparseable kept", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    setEnv("30", undefined);
    const kept = filterExpired(
      [row(30), row(31), { createdAt: "not-a-date" }],
      NOW,
    );
    assert.equal(kept.length, 2);
    assert.equal(kept[0]?.createdAt, row(30).createdAt);
  } finally {
    restoreEnv(saved);
  }
});

test("warning and returns carry no row content and no secret", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    setEnv(undefined, "30");
    const marker = "ttl-canary-content-never-echoed";
    const warnings = captureStderr(() => {
      filterExpired([{ createdAt: new Date(NOW - 60 * DAY_MS).toISOString(), note: marker } as Row], NOW);
    });
    for (const line of warnings) {
      assert.ok(!line.includes(marker));
      assert.ok(!line.includes("BRAINY_SECRET"));
      assert.ok(!line.includes("s3cr3t"));
    }
    assert.equal(warnings.join("\n").includes("30"), false);
  } finally {
    restoreEnv(saved);
  }
});
