/**
 * DAT-004 (High): Note TTL never applied — `createdAt` is written as
 * epoch-ms but the TTL comparison did `Date.parse` (-> NaN ->
 * fail-toward-keep), so `filterExpired` kept every Note row silently.
 *
 * These tests pin the fix: a single tolerant normalizer (`parseCreatedAtMs`)
 * used by the TTL path that accepts epoch-ms numbers/strings AND ISO
 * strings, with NO stored-row migration. Synthetic timestamps only — no
 * secrets, no containers, no PII.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _resetTtlWarningState, filterExpired, parseCreatedAtMs } from "../src/lifecycle.js";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-25T00:00:00.000Z");

interface Row {
  createdAt: string;
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

function ttlOn(days = "1"): void {
  _resetTtlWarningState();
  process.env["BRAINY_TTL_DAYS"] = days;
  delete process.env["AGENT_MEMORY_TTL_DAYS"];
}

test("DAT-004: Note epoch-ms digit-string (readString read-back shape) past TTL is expired", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const expiredAt = String(NOW - 2 * DAY_MS);
    const kept = filterExpired([{ createdAt: expiredAt }], NOW);
    assert.equal(kept.length, 0);
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: Note epoch-ms digit-string within TTL is kept", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const freshAt = String(NOW - 12 * 3_600_000);
    const kept = filterExpired([{ createdAt: freshAt }], NOW);
    assert.equal(kept.length, 1);
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: Note epoch-ms NUMBER (pre-readString producer shape) past expired, future kept", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const rows = [
      { createdAt: NOW - 2 * DAY_MS },
      { createdAt: NOW + 1 * DAY_MS },
    ] as unknown as Row[];
    const kept = filterExpired(rows, NOW);
    assert.equal(kept.length, 1);
    assert.equal((kept[0] as unknown as { createdAt: number }).createdAt, NOW + 1 * DAY_MS);
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: Memory ISO strings unchanged — past expired, future kept (no regression)", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const rows: Row[] = [
      { createdAt: new Date(NOW - 2 * DAY_MS).toISOString() },
      { createdAt: new Date(NOW + 1 * DAY_MS).toISOString() },
    ];
    const kept = filterExpired(rows, NOW);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.createdAt, new Date(NOW + 1 * DAY_MS).toISOString());
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: strict-greater boundary holds for epoch-ms — exactly-at-TTL survives, older hidden", () => {
  const saved = saveEnv();
  try {
    ttlOn("30");
    const rows: Row[] = [
      { createdAt: String(NOW - 30 * DAY_MS) },
      { createdAt: String(NOW - 31 * DAY_MS) },
    ];
    const kept = filterExpired(rows, NOW);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.createdAt, String(NOW - 30 * DAY_MS));
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: mixed Note epoch-ms + Memory ISO batch filters on one rule, order preserved", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const rows: Row[] = [
      { createdAt: String(NOW - 2 * DAY_MS) },
      { createdAt: new Date(NOW).toISOString() },
      { createdAt: new Date(NOW - 2 * DAY_MS).toISOString() },
      { createdAt: String(NOW) },
    ];
    const kept = filterExpired(rows, NOW);
    assert.deepEqual(
      kept.map((r) => r.createdAt),
      [new Date(NOW).toISOString(), String(NOW)],
    );
  } finally {
    restoreEnv(saved);
  }
});

/**
 * DECLARED fail-toward-keep (SPEC-005 §4.2, unchanged by this lane):
 * garbage / empty / absent `createdAt` can never hide a row — an unparseable
 * timestamp is KEPT, never expired. Silence is not allowed, so the policy is
 * pinned here by name: any future change to fail-toward-expire must rename
 * this test and update the SPEC-005 §4.2 line it cites.
 */
test("DECLARED fail-toward-keep (SPEC-005 §4.2): garbage/empty/absent createdAt is KEPT, never hidden", () => {
  const saved = saveEnv();
  try {
    ttlOn("1");
    const rows = [
      { createdAt: "not-a-date" },
      { createdAt: "" },
      { createdAt: "   " },
      {},
    ] as unknown as Row[];
    const kept = filterExpired(rows, NOW);
    assert.equal(kept.length, 4);
  } finally {
    restoreEnv(saved);
  }
});

test("DAT-004: TTL OFF (env absent) keeps expired epoch-ms rows — declared, not silent", () => {
  const saved = saveEnv();
  try {
    _resetTtlWarningState();
    delete process.env["BRAINY_TTL_DAYS"];
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const kept = filterExpired([{ createdAt: String(NOW - 400 * DAY_MS) }], NOW);
    assert.equal(kept.length, 1);
  } finally {
    restoreEnv(saved);
  }
});

test("parseCreatedAtMs accepts epoch-ms number/string and ISO, rejects garbage without logging", () => {
  assert.equal(parseCreatedAtMs(NOW - 2 * DAY_MS), NOW - 2 * DAY_MS);
  assert.equal(parseCreatedAtMs(String(NOW - 2 * DAY_MS)), NOW - 2 * DAY_MS);
  assert.equal(parseCreatedAtMs(new Date(NOW).toISOString()), NOW);
  assert.equal(parseCreatedAtMs("not-a-date"), undefined);
  assert.equal(parseCreatedAtMs(""), undefined);
  assert.equal(parseCreatedAtMs(undefined), undefined);
  assert.equal(parseCreatedAtMs(null), undefined);
  assert.equal(parseCreatedAtMs(Number.NaN), undefined);
  assert.equal(parseCreatedAtMs(true), undefined);
  assert.equal(parseCreatedAtMs({}), undefined);
});
