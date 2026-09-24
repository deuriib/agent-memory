/**
 * Pure unit verification — no Helix, no server, CI-safe (exit 0/1).
 *
 * REQ-P1-3 / T-101: extractConcepts determinism + bounds + ranking.
 * (Sections for normalizeContent / contentHash / dedup determinism and
 * decayedImportance / filterExpired are appended by the REQ-P1-6 and
 * REQ-P1-1 commits, once src/lifecycle.ts exports those helpers.)
 *
 * Mirrors scripts/verify.ts assertion plumbing: PASS/FAIL lines, a summary
 * count, VERIFY PASS / VERIFY FAIL, exit 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractConcepts, MAX_CONCEPTS, MAX_CONCEPT_CHARS } from "../src/concepts.js";
import { confidenceBoost, deriveWriteImportance, noteRecall, recallCount, resetRecalls } from "../src/confidence.js";
import { isNearDuplicate, jaccard, mergeThreshold, mergedContent, missingConcepts } from "../src/consolidate.js";
import { contentHash, decayedImportance, filterExpired, normalizeContent } from "../src/lifecycle.js";
/* §I-d (F-01-EMB): the canned verify rows carry real vectors from the SAME
 * deterministic embedder the store uses, so the embedding invariant compares
 * like-for-like (f32 round-trip included). */
import { embed } from "../src/embed.js";
import { oneLine } from "../src/logline.js";
/* COND-QA-01: the §H goldens score with the SAME module the eval harness
 * uses (extracted VERBATIM from scripts/eval.ts — pure, zero imports). */
import { aggregate, ndcgAt10, recallAt, scoreQuery, type QueryScore } from "../eval/metrics.js";
/* CE-002: the extracted decay→boost tie-break helper under order test. */
import { tieBreakImportance } from "../src/search.js";
/* §I: real store flow with the transport seam stubbed — ZERO network. */
import { HelixStore, type RememberInput, type SearchHit } from "../src/store.js";

/** Repo root for fs checks (§J) — this file lives in <root>/scripts/. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ */
/* Assertion plumbing (same shape as scripts/verify.ts)                */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  /* A. extractConcepts (REQ-P1-3 / T-101). */

  // Determinism: same input -> byte-identical list, every call, no clock.
  const sample =
    "Kubernetes rolling update failed: crashloop backoff on the api gateway pod and the worker pod";
  const first = extractConcepts(sample);
  const second = extractConcepts(sample);
  const third = extractConcepts(sample);
  check(
    "extractConcepts: deterministic (3 calls, identical output)",
    JSON.stringify(first) === JSON.stringify(second) &&
      JSON.stringify(second) === JSON.stringify(third),
    JSON.stringify({ first, second, third }),
  );

  // Cap: never more than 8 concepts (contract bound), even for rich input.
  const rich = Array.from({ length: 12 }, (_, i) => `alpha${i} beta${i}`).join(" ");
  const richOut = extractConcepts(rich);
  check(
    `extractConcepts: ≤${MAX_CONCEPTS} concepts from 24 distinct tokens`,
    richOut.length === MAX_CONCEPTS,
    `got ${richOut.length}: ${JSON.stringify(richOut)}`,
  );

  // Stopwords must never surface as concepts.
  const stopwordHeavy = "the and are was were been being that this with from";
  const stopOut = extractConcepts(stopwordHeavy);
  check(
    "extractConcepts: pure-stopword input yields no stopwords",
    stopOut.every((c) => c !== "the" && c !== "and" && c !== "was"),
    JSON.stringify(stopOut),
  );
  check(
    "extractConcepts: stopwords excluded from mixed input",
    !first.includes("the") && !first.includes("and") && !first.includes("with"),
    JSON.stringify(first),
  );

  // Tokens shorter than 3 chars are dropped (tokenizer already drops <2).
  const shortOut = extractConcepts("go to ok an id be if we up on");
  check(
    "extractConcepts: no token shorter than 3 chars",
    shortOut.every((c) => c.length >= 3),
    JSON.stringify(shortOut),
  );

  // Every emitted concept fits the 1..200 schema bound (incl. >200-char junk).
  const overlong = `x${"y".repeat(249)} gateway expiry`;
  const boundOut = extractConcepts(overlong);
  check(
    `extractConcepts: every concept within 1..${MAX_CONCEPT_CHARS} chars`,
    boundOut.every((c) => c.length >= 1 && c.length <= MAX_CONCEPT_CHARS),
    JSON.stringify(boundOut.map((c) => c.length)),
  );

  // Empty / punctuation-only input -> [].
  check(
    "extractConcepts: empty string -> []",
    extractConcepts("").length === 0,
    JSON.stringify(extractConcepts("")),
  );
  check(
    "extractConcepts: punctuation-only -> []",
    extractConcepts("!!! ... --- ??? ***").length === 0,
    JSON.stringify(extractConcepts("!!! ... --- ??? ***")),
  );

  // Ranking: term frequency DESC first, then lexicographic ASC on ties.
  const ranked = extractConcepts("cat cat dog dog dog bird");
  check(
    "extractConcepts: tf DESC (dog(3) before cat(2) before bird(1))",
    JSON.stringify(ranked) === JSON.stringify(["dog", "cat", "bird"]),
    JSON.stringify(ranked),
  );
  const tied = extractConcepts("zeta alpha mike");
  check(
    "extractConcepts: tie-break lex ASC (alpha < mike < zeta)",
    JSON.stringify(tied) === JSON.stringify(["alpha", "mike", "zeta"]),
    JSON.stringify(tied),
  );

  /* B. normalizeContent + contentHash (REQ-P1-6 / T-102). */

  // Golden: whitespace runs collapse, ends trim, case folds; punctuation and
  // token order stay (dedup must never merge different sentences).
  check(
    "normalizeContent: golden '  Hello   World \\n\\t Today  ' -> 'hello world today'",
    normalizeContent("  Hello   World \n\t Today  ") === "hello world today",
    JSON.stringify(normalizeContent("  Hello   World \n\t Today  ")),
  );
  check(
    "normalizeContent: punctuation preserved (only case/whitespace change)",
    normalizeContent("Hello, World Today!") === "hello, world today!",
    JSON.stringify(normalizeContent("Hello, World Today!")),
  );

  // Golden hash vector (computed once against node:crypto sha256, hardcoded).
  const GOLDEN_KEY_A = "b3ce2e0503b6d5e36653f56765756cece1ae615f2d33e5b326b0df2cb55bd55a";
  const GOLDEN_KEY_B = "4644cf715771a26d72dbfe634ac7733f5e2068ea0919e11cc971a4438487f1aa";
  const GOLDEN_KEY_DIFF = "7189e50a05216fbc16f984709da63f3ba79cc036d3ec5b1bdac71cff9d62210e";
  check(
    "contentHash: golden vector (proj-a, 'hello world today')",
    contentHash("proj-a", normalizeContent("  Hello   World \n\t Today  ")) === GOLDEN_KEY_A,
    contentHash("proj-a", normalizeContent("  Hello   World \n\t Today  ")),
  );

  // Dedup determinism: the exact properties remember() relies on.
  const base = normalizeContent("Ship the release checklist by Friday");
  check(
    "dedup: same project + same content -> SAME key",
    contentHash("p1", base) === contentHash("p1", base),
    "keys differ",
  );
  check(
    "dedup: same content, DIFFERENT project -> DIFFERENT key",
    contentHash("p1", base) !== contentHash("p2", base),
    `${contentHash("p1", base)} vs ${contentHash("p2", base)}`,
  );
  check(
    "dedup: case/whitespace variant -> SAME key (normalization upstream)",
    contentHash("p1", normalizeContent("  SHIP the   release checklist BY friday ")) ===
      contentHash("p1", base),
    `${contentHash("p1", normalizeContent("  SHIP the   release checklist BY friday "))} vs ${contentHash("p1", base)}`,
  );
  check(
    "dedup: different content -> DIFFERENT key",
    contentHash("p1", base) !== contentHash("p1", normalizeContent("Rewrite the checklist draft")),
    "keys collided",
  );
  check(
    "dedup: golden key for proj-b differs from proj-a (project in hash)",
    contentHash("proj-b", normalizeContent("  Hello   World \n\t Today  ")) === GOLDEN_KEY_B,
    contentHash("proj-b", normalizeContent("  Hello   World \n\t Today  ")),
  );
  check(
    "dedup: golden key for different content matches vector",
    contentHash("proj-a", normalizeContent("different content entirely")) === GOLDEN_KEY_DIFF,
    contentHash("proj-a", normalizeContent("different content entirely")),
  );

  /* C. decayedImportance (REQ-P1-1 / T-103) — env knobs saved/restored. */
  const savedLambda = process.env["AGENT_MEMORY_DECAY_LAMBDA"];
  const savedTtl = process.env["AGENT_MEMORY_TTL_DAYS"];
  const restoreEnv = (): void => {
    if (savedLambda === undefined) delete process.env["AGENT_MEMORY_DECAY_LAMBDA"];
    else process.env["AGENT_MEMORY_DECAY_LAMBDA"] = savedLambda;
    if (savedTtl === undefined) delete process.env["AGENT_MEMORY_TTL_DAYS"];
    else process.env["AGENT_MEMORY_TTL_DAYS"] = savedTtl;
  };
  try {
    const NOW = Date.parse("2026-06-15T00:00:00.000Z"); // fixed clock — pure, no wall time
    const at = (ageDays: number): string => new Date(NOW - ageDays * 86_400_000).toISOString();

    // λ absent / invalid / <= 0 -> factor 1 (decay OFF, fail-closed config).
    delete process.env["AGENT_MEMORY_DECAY_LAMBDA"];
    check(
      "decay: λ absent -> factor 1",
      decayedImportance(0.8, at(7), NOW) === 0.8,
      String(decayedImportance(0.8, at(7), NOW)),
    );
    process.env["AGENT_MEMORY_DECAY_LAMBDA"] = "not-a-number";
    check(
      "decay: λ invalid -> factor 1",
      decayedImportance(0.8, at(7), NOW) === 0.8,
      String(decayedImportance(0.8, at(7), NOW)),
    );
    process.env["AGENT_MEMORY_DECAY_LAMBDA"] = "0";
    check(
      "decay: λ=0 -> factor 1",
      decayedImportance(0.8, at(7), NOW) === 0.8,
      String(decayedImportance(0.8, at(7), NOW)),
    );
    process.env["AGENT_MEMORY_DECAY_LAMBDA"] = "-3";
    check(
      "decay: λ<0 -> factor 1",
      decayedImportance(0.8, at(7), NOW) === 0.8,
      String(decayedImportance(0.8, at(7), NOW)),
    );

    // Golden: half-life 7 days -> after 7 days, exactly 0.5 (±1e-12).
    process.env["AGENT_MEMORY_DECAY_LAMBDA"] = String(Math.LN2 / 7);
    const half = decayedImportance(1, at(7), NOW);
    check("decay: λ=ln2/7 at 7d -> exactly 0.5 ±1e-12", Math.abs(half - 0.5) <= 1e-12, String(half));

    // Monotonic: older age -> strictly smaller decayed importance.
    const d0 = decayedImportance(0.9, at(0), NOW);
    const d3 = decayedImportance(0.9, at(3), NOW);
    const d30 = decayedImportance(0.9, at(30), NOW);
    check(
      "decay: monotonic (age 0 > 3 > 30)",
      d0 > d3 && d3 > d30,
      JSON.stringify([d0, d3, d30]),
    );

    // Clamp to 0..1: future createdAt grows the factor above 1 -> clamp 1;
    // negative importance -> clamp 0.
    check(
      "decay: clamp high (future createdAt) -> 1",
      decayedImportance(1, at(-7), NOW) === 1,
      String(decayedImportance(1, at(-7), NOW)),
    );
    check(
      "decay: clamp low (negative importance) -> 0",
      decayedImportance(-0.5, at(0), NOW) === 0,
      String(decayedImportance(-0.5, at(0), NOW)),
    );

    // Unparseable createdAt -> factor 1 (bad timestamp never rescales).
    check(
      "decay: unparseable createdAt -> factor 1",
      decayedImportance(0.7, "not-a-date", NOW) === 0.7,
      String(decayedImportance(0.7, "not-a-date", NOW)),
    );

    /* D. filterExpired (REQ-P1-1 / T-103). */
    const rows = [
      { id: "fresh", createdAt: at(10) },
      { id: "boundary", createdAt: at(30) }, // age == ttl exactly -> survives
      { id: "old", createdAt: at(31) }, // age > ttl -> expired
      { id: "ancient", createdAt: at(400) },
      { id: "bad", createdAt: "not-a-date" }, // unparseable -> NOT expired
    ];
    process.env["AGENT_MEMORY_TTL_DAYS"] = "30";
    const kept = filterExpired(rows, NOW);
    check(
      "ttl: age>30 dropped, age==30 + unparseable kept",
      JSON.stringify(kept.map((r) => r.id)) === JSON.stringify(["fresh", "boundary", "bad"]),
      JSON.stringify(kept.map((r) => r.id)),
    );
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    check(
      "ttl: OFF (absent) keeps all",
      filterExpired(rows, NOW).length === rows.length,
      String(filterExpired(rows, NOW).length),
    );
    process.env["AGENT_MEMORY_TTL_DAYS"] = "0";
    check(
      "ttl: OFF (0) keeps all",
      filterExpired(rows, NOW).length === rows.length,
      String(filterExpired(rows, NOW).length),
    );
    process.env["AGENT_MEMORY_TTL_DAYS"] = "-5";
    check(
      "ttl: OFF (negative) keeps all",
      filterExpired(rows, NOW).length === rows.length,
      String(filterExpired(rows, NOW).length),
    );
    process.env["AGENT_MEMORY_TTL_DAYS"] = "abc";
    check(
      "ttl: OFF (invalid) keeps all",
      filterExpired(rows, NOW).length === rows.length,
      String(filterExpired(rows, NOW).length),
    );
    process.env["AGENT_MEMORY_TTL_DAYS"] = "30";
    check(
      "ttl: input array untouched (pure)",
      rows.length === 5,
      String(rows.length),
    );
  } finally {
    restoreEnv();
  }

  /* E. oneLine — CWE-117 / SEC-P121-01 render guard (pure, no Helix).
   * Do NOT assert U+0085/NEL behavior — that residual is backlog SEC-P121-03. */

  // (a) line-breakers and whitespace runs collapse to single spaces.
  const wsCases: ReadonlyArray<readonly [input: string, expected: string]> = [
    ["line\nbreak", "line break"],
    ["cr\rreturn", "cr return"],
    ["crlf\r\nend", "crlf end"],
    ["tab\there", "tab here"],
    ["multi   space  run", "multi space run"],
  ];
  check(
    "oneLine: \\n / \\r / \\r\\n / tab / multi-space runs collapse to single spaces",
    wsCases.every(([input, expected]) => oneLine(input) === expected),
    JSON.stringify(wsCases.map(([input]) => oneLine(input))),
  );
  check(
    "oneLine: collapsed output contains no \\n or \\r",
    wsCases.every(([input]) => {
      const out = oneLine(input);
      return !out.includes("\n") && !out.includes("\r");
    }),
    JSON.stringify(wsCases.map(([input]) => oneLine(input))),
  );

  // (b) idempotent — a second pass never changes the rendered line.
  check(
    "oneLine: idempotent (oneLine(oneLine(x)) === oneLine(x))",
    wsCases.every(([input]) => oneLine(oneLine(input)) === oneLine(input)) &&
      oneLine(oneLine("  lead/trail \n\t ")) === oneLine("  lead/trail \n\t "),
    "second pass differed",
  );

  // (c) non-corrupting — names / digits / ISO timestamps / booleans byte-identical.
  const untouched = [
    "readme",
    "probe-p1-ttl",
    "multi word name",
    "1234567890",
    "2026-09-23T10:00:00.000Z",
    "true",
    "false",
  ];
  check(
    "oneLine: names/digits/ISO-timestamps/booleans byte-identical",
    untouched.every((value) => oneLine(value) === value),
    JSON.stringify(untouched.map((value) => oneLine(value))),
  );

  // (d) number/boolean inputs accepted (String()-rendered).
  check(
    "oneLine: number and boolean inputs accepted",
    oneLine(42) === "42" && oneLine(0) === "0" && oneLine(true) === "true" && oneLine(false) === "false",
    JSON.stringify([oneLine(42), oneLine(0), oneLine(true), oneLine(false)]),
  );

  /* F. confidence (REQ-P1-4) — derived write importance + recall boost +
   * recall ledger. All PURE: src/confidence.ts has no clock, no randomness,
   * no env reads, so no env save/restore is needed here. */

  // F1. deriveWriteImportance — provenance bases (0 concepts = no bonus).
  check(
    "confidence: lesson base (0 concepts) -> 0.75",
    deriveWriteImportance("lesson", 0) === 0.75,
    String(deriveWriteImportance("lesson", 0)),
  );
  check(
    "confidence: hook origin base -> 0.55",
    deriveWriteImportance("hook:Stop", 0) === 0.55,
    String(deriveWriteImportance("hook:Stop", 0)),
  );
  check(
    "confidence: the 'hook:' PREFIX is required ('hook'/'hooked' -> base 0.5)",
    deriveWriteImportance("hook", 0) === 0.5 && deriveWriteImportance("hooked", 0) === 0.5,
    JSON.stringify([deriveWriteImportance("hook", 0), deriveWriteImportance("hooked", 0)]),
  );
  check(
    "confidence: rest/mcp/empty origin base -> 0.5",
    deriveWriteImportance("rest", 0) === 0.5 &&
      deriveWriteImportance("mcp", 0) === 0.5 &&
      deriveWriteImportance("", 0) === 0.5,
    JSON.stringify([
      deriveWriteImportance("rest", 0),
      deriveWriteImportance("mcp", 0),
      deriveWriteImportance("", 0),
    ]),
  );

  // F2. Concept bonus: 0.025 · min(max(count, 0), 8). Goldens replicate the
  // implementation's expression so equality is EXACT IEEE-754 (0.5 + 0.025*8
  // is 0.7000000000000001 in float64 — never assert against the decimal
  // literal alone; the ±1e-12 companion check pins the human value).
  const rest8 = deriveWriteImportance("rest", 8);
  check(
    "confidence: concept bonus max (+0.025*8) on base 0.5 -> 0.7 ±1e-12",
    rest8 === 0.5 + 0.025 * 8 && Math.abs(rest8 - 0.7) <= 1e-12,
    String(rest8),
  );
  check(
    "confidence: concept count capped at 8 (99 concepts == 8 concepts)",
    deriveWriteImportance("rest", 99) === rest8,
    `${deriveWriteImportance("rest", 99)} vs ${rest8}`,
  );
  const rest0 = deriveWriteImportance("rest", 0);
  const rest3 = deriveWriteImportance("rest", 3);
  check(
    "confidence: concept ordering — 0 concepts < 3 concepts",
    rest0 < rest3 && rest3 === 0.5 + 0.025 * 3,
    JSON.stringify([rest0, rest3]),
  );
  check(
    "confidence: negative conceptCount clamps to the 0-concept base",
    deriveWriteImportance("rest", -5) === rest0,
    String(deriveWriteImportance("rest", -5)),
  );
  const lesson8 = deriveWriteImportance("lesson", 8);
  check(
    "confidence: clamp01 never exceeds 1 (lesson + 8 = 0.95 <= 1)",
    lesson8 <= 1 && Math.abs(lesson8 - 0.95) <= 1e-12,
    String(lesson8),
  );
  const detA = [
    deriveWriteImportance("lesson", 5),
    deriveWriteImportance("hook:Stop", 3),
    deriveWriteImportance("rest", 7),
  ];
  const detB = [
    deriveWriteImportance("lesson", 5),
    deriveWriteImportance("hook:Stop", 3),
    deriveWriteImportance("rest", 7),
  ];
  const detC = [
    deriveWriteImportance("lesson", 5),
    deriveWriteImportance("hook:Stop", 3),
    deriveWriteImportance("rest", 7),
  ];
  check(
    "confidence: deterministic (3 identical derive calls, all bases)",
    JSON.stringify(detA) === JSON.stringify(detB) && JSON.stringify(detB) === JSON.stringify(detC),
    JSON.stringify([detA, detB, detC]),
  );

  // F3. confidenceBoost — recall lift: clamp01(i + 0.2·n/(n+1)).
  check(
    "boost: n=0 is the identity",
    confidenceBoost(0.5, 0) === 0.5 && confidenceBoost(0.95, 0) === 0.95 && confidenceBoost(0, 0) === 0,
    JSON.stringify([confidenceBoost(0.5, 0), confidenceBoost(0.95, 0), confidenceBoost(0, 0)]),
  );
  const b1 = confidenceBoost(0.5, 1);
  check(
    "boost: n=1 adds exactly 0.2*1/2 = 0.1 (±1e-15)",
    b1 === 0.5 + (0.2 * 1) / (1 + 1) && Math.abs(b1 - 0.6) <= 1e-15,
    String(b1),
  );
  const b0 = confidenceBoost(0.5, 0);
  const b5 = confidenceBoost(0.5, 5);
  const b50 = confidenceBoost(0.5, 50);
  check(
    "boost: strictly monotonic — n=0 < 1 < 5 < 50",
    b0 < b1 && b1 < b5 && b5 < b50,
    JSON.stringify([b0, b1, b5, b50]),
  );
  const bHuge = confidenceBoost(0.5, 1_000_000);
  check(
    "boost: asymptote — n=1e6 adds < +0.2 + 1e-9 (and > +0.19)",
    bHuge - 0.5 < 0.2 + 1e-9 && bHuge - 0.5 > 0.19,
    String(bHuge - 0.5),
  );
  check(
    "boost: clamp01 — importance 0.95 at n=1e6 stays <= 1",
    confidenceBoost(0.95, 1_000_000) <= 1,
    String(confidenceBoost(0.95, 1_000_000)),
  );
  check(
    "boost: negative recallCount treated as 0 (identity)",
    confidenceBoost(0.5, -3) === 0.5 && confidenceBoost(0.5, -1e9) === 0.5,
    JSON.stringify([confidenceBoost(0.5, -3), confidenceBoost(0.5, -1e9)]),
  );

  // F4. Recall ledger — process-local Map, cap 10k, best-effort clear.
  resetRecalls();
  check("ledger: unknown id -> 0", recallCount("never-seen") === 0, String(recallCount("never-seen")));
  noteRecall("m-x");
  noteRecall("m-x");
  noteRecall("m-x");
  check("ledger: noteRecall x3 -> recallCount 3", recallCount("m-x") === 3, String(recallCount("m-x")));
  noteRecall("");
  check("ledger: empty memoryId ignored (stays 0)", recallCount("") === 0, String(recallCount("")));
  resetRecalls();
  check(
    "ledger: resetRecalls clears every id",
    recallCount("m-x") === 0 && recallCount("") === 0,
    String(recallCount("m-x")),
  );

  // Cap semantics: fill to exactly 10k; an EXISTING key at the cap just
  // increments, a NEW key at the cap clears the map first (documented).
  for (let i = 0; i < 10_000; i++) noteRecall(`cap-${i}`);
  check(
    "ledger: 10k distinct keys held (cap-0 and cap-9999 both count 1)",
    recallCount("cap-0") === 1 && recallCount("cap-9999") === 1,
    JSON.stringify([recallCount("cap-0"), recallCount("cap-9999")]),
  );
  noteRecall("cap-0");
  check(
    "ledger: EXISTING key at the cap increments WITHOUT clearing",
    recallCount("cap-0") === 2 && recallCount("cap-5000") === 1,
    JSON.stringify([recallCount("cap-0"), recallCount("cap-5000")]),
  );
  noteRecall("cap-overflow"); // NEW key while size == 10_000 -> clear, then insert
  check(
    "ledger: NEW key at the 10k cap clears the map (bounded, best-effort)",
    recallCount("cap-overflow") === 1 && recallCount("cap-0") === 0 && recallCount("cap-9999") === 0,
    JSON.stringify({
      overflow: recallCount("cap-overflow"),
      cap0: recallCount("cap-0"),
      cap9999: recallCount("cap-9999"),
    }),
  );
  resetRecalls(); // leave the ledger empty for any section appended later

  /* F-bis. Tie-break ORDER (COND-QA-02 / CE-002) — decay FIRST, then the
   * recall boost, through the exported tieBreakImportance helper (extracted
   * verbatim from compareFusedAt). λ>0 via env (saved/restored); createdAt
   * exactly 10 days before a FIXED nowMs; n>0. Expected values are hand
   * expressions of the formula — they never call decayedImportance or
   * confidenceBoost, so a broken helper cannot self-certify. */
  try {
    const FB_NOW = Date.parse("2026-06-15T00:00:00.000Z"); // fixed clock — pure
    const FB_CREATED = new Date(FB_NOW - 10 * 86_400_000).toISOString(); // exactly 10d before
    process.env["AGENT_MEMORY_DECAY_LAMBDA"] = String(Math.LN2 / 10); // half-life 10d -> factor 0.5 at 10d

    // Hand: clamp01(0.6 · e^(−λ·10) + 0.2·3/4) = 0.6·0.5 + 0.15 = 0.45.
    const handExpected = 0.6 * 0.5 + (0.2 * 3) / (3 + 1);
    const actual = tieBreakImportance(0.6, FB_CREATED, FB_NOW, 3);
    check(
      "tieBreak: decay FIRST then boost — hand 0.6·e^(−λ·10) + 0.2·3/4 = 0.45 ±1e-9",
      Math.abs(actual - handExpected) <= 1e-9,
      `${actual} vs hand ${handExpected}`,
    );

    // Wrong order (boost THEN decay): 0.5 · (0.6 + 0.15) = 0.375 — must differ.
    const wrongOrder = 0.5 * (0.6 + (0.2 * 3) / (3 + 1));
    check(
      "tieBreak: wrong order decay(boost(stored)) differs by > 1e-9 (0.375 vs 0.45)",
      Math.abs(actual - wrongOrder) > 1e-9,
      `${actual} vs wrong-order ${wrongOrder}`,
    );
  } finally {
    restoreEnv(); // restores AGENT_MEMORY_DECAY_LAMBDA + AGENT_MEMORY_TTL_DAYS to their original values
  }

  /* G. consolidation tier-1 (REQ-P1-2 / T-202) — pure goldens for
   * jaccard / mergeThreshold (env saved+restored) / isNearDuplicate /
   * mergedContent's substring guard. No Helix, no server. */

  // Exact-construction samples: v1 has 10 tokens (tokenize drops nothing),
  // v2 = v1 + one extra token (j = 10/11), v3 = comma variant of v1 (same
  // token SET -> j(v1,v3) = 1, but a DIFFERENT dedupKey because
  // normalizeContent keeps punctuation — the near-dup, not exact-dedup,
  // path). 10/11 is asserted against the LITERAL 10/11 so the golden is the
  // same IEEE-754 division the implementation performs (exact equality).
  const V1 = "deploy staging checklist runs database migration then restarts api workers";
  const V2 = `${V1} today`;
  const V3 = "deploy staging checklist runs database migration, then restarts api workers";
  const V1_TOKENS = 10;

  check(
    "consolidate: jaccard identical -> 1",
    jaccard(V1, V1) === 1,
    String(jaccard(V1, V1)),
  );
  check(
    "consolidate: jaccard disjoint texts -> 0",
    jaccard(V1, "gardening soil tomatoes watering schedule") === 0,
    String(jaccard(V1, "gardening soil tomatoes watering schedule")),
  );
  check(
    "consolidate: jaccard(V1, V2) == 10/11 exactly (one extra token)",
    jaccard(V1, V2) === V1_TOKENS / (V1_TOKENS + 1),
    String(jaccard(V1, V2)),
  );
  check(
    "consolidate: jaccard(V1, V3) == 1 (punctuation ignored, token SETS equal)",
    jaccard(V1, V3) === 1,
    String(jaccard(V1, V3)),
  );
  check(
    "consolidate: jaccard(V3, concatenated survivor V1\\nV2) == 10/11",
    jaccard(V3, `${V1}\n${V2}`) === V1_TOKENS / (V1_TOKENS + 1),
    String(jaccard(V3, `${V1}\n${V2}`)),
  );
  check(
    "consolidate: jaccard empty vs empty -> 0 (never merge on emptiness)",
    jaccard("", "") === 0,
    String(jaccard("", "")),
  );
  check(
    "consolidate: jaccard case-insensitive (shared tokenizer with embed)",
    jaccard(V1, V1.toUpperCase()) === 1,
    String(jaccard(V1, V1.toUpperCase())),
  );

  // mergeThreshold — env knob saved/restored like section C.
  const savedMerge = process.env["AGENT_MEMORY_MERGE_JACCARD"];
  const restoreMerge = (): void => {
    if (savedMerge === undefined) delete process.env["AGENT_MEMORY_MERGE_JACCARD"];
    else process.env["AGENT_MEMORY_MERGE_JACCARD"] = savedMerge;
  };
  try {
    delete process.env["AGENT_MEMORY_MERGE_JACCARD"];
    check("merge: AGENT_MEMORY_MERGE_JACCARD absent -> 0.9 (ON by default)", mergeThreshold() === 0.9, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "0.75";
    check("merge: valid 0<v<1 -> v", mergeThreshold() === 0.75, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "0.5";
    check("merge: 0.5 -> 0.5", mergeThreshold() === 0.5, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "1";
    check("merge: v >= 1 -> undefined (OFF, fail-closed)", mergeThreshold() === undefined, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "0";
    check("merge: v <= 0 -> undefined (OFF, fail-closed)", mergeThreshold() === undefined, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "-0.5";
    check("merge: negative -> undefined (OFF, fail-closed)", mergeThreshold() === undefined, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "not-a-number";
    check("merge: non-numeric -> undefined (OFF, fail-closed)", mergeThreshold() === undefined, String(mergeThreshold()));
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "";
    check("merge: empty string -> undefined (OFF, fail-closed)", mergeThreshold() === undefined, String(mergeThreshold()));

    // Back to ABSENT for the default-knob checks below.
    delete process.env["AGENT_MEMORY_MERGE_JACCARD"];

    // isNearDuplicate at the boundary: at threshold -> true, just above -> false.
    const t1011 = V1_TOKENS / (V1_TOKENS + 1);
    check(
      "consolidate: isNearDuplicate at EXACTLY threshold -> true",
      isNearDuplicate(V1, V2, t1011) === true,
      String(jaccard(V1, V2)),
    );
    check(
      "consolidate: isNearDuplicate above threshold (0.91 > 10/11) -> false",
      isNearDuplicate(V1, V2, 0.91) === false,
      String(jaccard(V1, V2)),
    );
    check(
      "consolidate: default 0.9 admits the V1/V2 pair (10/11 >= 0.9)",
      mergeThreshold() === 0.9 && isNearDuplicate(V1, V2, mergeThreshold() ?? 0),
      String(mergeThreshold()),
    );
    check(
      "consolidate: default 0.9 REJECTS unrelated texts",
      isNearDuplicate(V1, "gardening soil tomatoes watering schedule", 0.9) === false,
    );

    // mergedContent — concatenation + substring guard (closes the re-merge loop).
    check(
      "merge: concatenates survivor + \\n + incoming (no text dropped)",
      mergedContent(V1, V2) === `${V1}\n${V2}`,
      JSON.stringify(mergedContent(V1, V2).slice(0, 80)),
    );
    const mergedOnce = `${V1}\n${V2}`;
    check(
      "merge: substring guard — incoming already contained -> survivor UNCHANGED",
      mergedContent(mergedOnce, V1) === mergedOnce,
      JSON.stringify(mergedContent(mergedOnce, V1).slice(0, 120)),
    );
    check(
      "merge: guard closes the re-merge loop (re-saving the merged text is a no-op)",
      mergedContent(mergedOnce, mergedOnce) === mergedOnce,
      JSON.stringify(mergedContent(mergedOnce, mergedOnce).slice(0, 120)),
    );
    check(
      "merge: trailing whitespace of the survivor collapses before append",
      mergedContent("deploy api  \n\n", "restart workers") === "deploy api\nrestart workers",
      JSON.stringify(mergedContent("deploy api  \n\n", "restart workers")),
    );
    check(
      "merge: case/whitespace-normalized containment also guards (punctuation kept)",
      mergedContent("Deploy Staging   Today", "deploy staging") === "Deploy Staging   Today",
      JSON.stringify(mergedContent("Deploy Staging   Today", "deploy staging")),
    );
  } finally {
    restoreMerge();
  }

  // missingConcepts (REQ-F-01) — the pure set-difference behind the
  // concept-link verify + heal: DEDUP, EXACT-name/case matching (Concept
  // nodes are keyed by exact name — Predicate.eqParam("name") — and
  // graphSearch matches isInParam exactly, so "Deploy" ≠ "deploy"), and
  // code-unit SORTED output so the result is ORDER-INDEPENDENT: any
  // permutation of either list yields a byte-identical array (which is
  // what makes the heal payload and these goldens deterministic).
  check(
    "missingConcepts: every expected name already linked -> empty",
    missingConcepts(["deploy", "staging"], ["deploy", "staging"]).length === 0,
    JSON.stringify(missingConcepts(["deploy", "staging"], ["deploy", "staging"])),
  );
  check(
    "missingConcepts: partial -> the exact missing names, sorted (incoming order ignored)",
    JSON.stringify(missingConcepts(["deploy"], ["zeta", "deploy", "alpha"])) ===
      JSON.stringify(["alpha", "zeta"]),
    JSON.stringify(missingConcepts(["deploy"], ["zeta", "deploy", "alpha"])),
  );
  check(
    "missingConcepts: ORDER-INDEPENDENT over shuffled incoming (byte-identical)",
    JSON.stringify(missingConcepts(["alpha", "beta"], ["z", "y", "x"])) ===
      JSON.stringify(missingConcepts(["alpha", "beta"], ["x", "z", "y"])),
    `${JSON.stringify(missingConcepts(["alpha", "beta"], ["z", "y", "x"]))} vs ${JSON.stringify(missingConcepts(["alpha", "beta"], ["x", "z", "y"]))}`,
  );
  check(
    "missingConcepts: ORDER-INDEPENDENT over shuffled linked (byte-identical)",
    JSON.stringify(missingConcepts(["b", "a", "c"], ["q", "p"])) ===
      JSON.stringify(missingConcepts(["c", "a", "b"], ["p", "q"])),
    `${JSON.stringify(missingConcepts(["b", "a", "c"], ["q", "p"]))} vs ${JSON.stringify(missingConcepts(["c", "a", "b"], ["p", "q"]))}`,
  );
  check(
    "missingConcepts: incoming duplicates DEDUPED",
    JSON.stringify(missingConcepts(["deploy"], ["x", "x", "y", "x"])) ===
      JSON.stringify(["x", "y"]),
    JSON.stringify(missingConcepts(["deploy"], ["x", "x", "y", "x"])),
  );
  check(
    "missingConcepts: EXACT-name/case match (linked 'Deploy' does NOT cover incoming 'deploy')",
    JSON.stringify(missingConcepts(["Deploy"], ["deploy"])) === JSON.stringify(["deploy"]),
    JSON.stringify(missingConcepts(["Deploy"], ["deploy"])),
  );
  check(
    "missingConcepts: NO substring match (linked 'deploy staging' does not cover 'deploy')",
    JSON.stringify(missingConcepts(["deploy staging"], ["deploy"])) === JSON.stringify(["deploy"]),
    JSON.stringify(missingConcepts(["deploy staging"], ["deploy"])),
  );
  check(
    "missingConcepts: empty incoming -> empty (nothing to heal)",
    missingConcepts(["a", "b"], []).length === 0,
    JSON.stringify(missingConcepts(["a", "b"], [])),
  );
  check(
    "missingConcepts: empty linked -> every distinct incoming name, sorted",
    JSON.stringify(missingConcepts([], ["b", "a"])) === JSON.stringify(["a", "b"]),
    JSON.stringify(missingConcepts([], ["b", "a"])),
  );

  /* H. eval/metrics goldens (COND-QA-01) — every expected value is a
   * hand-computed literal (never produced by the function under test), so a
   * formula breakage cannot self-certify. eps 1e-9 throughout. */

  // Relevant docs at ranks 1 and 7 (1-based) in a top-10 ranked list.
  const H_RANKED_1_7 = ["rel-a", "d2", "d3", "d4", "d5", "d6", "rel-b", "d8", "d9", "d10"];
  const H_RELEVANT_2 = ["rel-a", "rel-b"];
  check(
    "metrics: recall@5 with relevant at ranks 1&7 -> 1/2 = 0.5",
    recallAt(H_RANKED_1_7, H_RELEVANT_2, 5) === 0.5,
    String(recallAt(H_RANKED_1_7, H_RELEVANT_2, 5)),
  );
  check(
    "metrics: recall@10 with relevant at ranks 1&7 -> 2/2 = 1.0",
    recallAt(H_RANKED_1_7, H_RELEVANT_2, 10) === 1,
    String(recallAt(H_RANKED_1_7, H_RELEVANT_2, 10)),
  );
  check(
    "metrics: relevant never retrieved -> recall@10 = 0",
    recallAt(H_RANKED_1_7, ["absent-doc"], 10) === 0,
    String(recallAt(H_RANKED_1_7, ["absent-doc"], 10)),
  );

  // MRR: first relevant at rank 3 -> 1/3 (±1e-9); none -> 0.
  const H_RANKED_3 = ["d1", "d2", "rel-a", "d4", "d5", "d6", "d7", "d8", "d9", "d10"];
  const H_MRR3 = scoreQuery("mrr rank 3", H_RANKED_3, ["rel-a"]);
  check(
    "metrics: MRR first relevant at rank 3 -> 1/3 ±1e-9",
    Math.abs(H_MRR3.reciprocal - 1 / 3) <= 1e-9,
    String(H_MRR3.reciprocal),
  );
  const H_MRR_NONE = scoreQuery("mrr none", H_RANKED_1_7, ["absent-doc"]);
  check(
    "metrics: MRR none retrieved -> firstRank 0, reciprocal 0",
    H_MRR_NONE.firstRank === 0 && H_MRR_NONE.reciprocal === 0,
    JSON.stringify({ firstRank: H_MRR_NONE.firstRank, reciprocal: H_MRR_NONE.reciprocal }),
  );

  // nDCG@10, relevant at ranks 1 & 3: DCG = 1 + 1/log2(4) = 1.5;
  // IDCG = 1 + 1/log2(3)  ->  nDCG = 1.5 / (1 + 1/log2(3)).
  const H_RANKED_1_3 = ["rel-a", "d2", "rel-b", "d4", "d5", "d6", "d7", "d8", "d9", "d10"];
  const H_NDCG_1_3 = ndcgAt10(H_RANKED_1_3, H_RELEVANT_2);
  check(
    "metrics: nDCG ranks 1&3 -> 1.5 / (1 + 1/log2(3)) ±1e-9",
    Math.abs(H_NDCG_1_3 - 1.5 / (1 + 1 / Math.log2(3))) <= 1e-9,
    String(H_NDCG_1_3),
  );

  // MISS case: relevant at rank 9 — outside recall@5 but inside nDCG@10.
  const H_RANKED_9 = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "rel-a", "d10"];
  check(
    "metrics: rank-9 MISS — recall@5 = 0 yet nDCG@10 > 0",
    recallAt(H_RANKED_9, ["rel-a"], 5) === 0 && ndcgAt10(H_RANKED_9, ["rel-a"]) > 0,
    JSON.stringify({
      recall5: recallAt(H_RANKED_9, ["rel-a"], 5),
      ndcg10: ndcgAt10(H_RANKED_9, ["rel-a"]),
    }),
  );

  // Rank-1 perfect ordering -> nDCG exactly 1, rendered "1.0000".
  const H_NDCG_1 = ndcgAt10(H_RANKED_1_3, ["rel-a"]); // only rel-a relevant -> ideal rank 1
  check(
    "metrics: rank-1 nDCG = 1.0000 (toFixed(4))",
    H_NDCG_1 === 1 && H_NDCG_1.toFixed(4) === "1.0000",
    `${String(H_NDCG_1)} -> ${H_NDCG_1.toFixed(4)}`,
  );

  // aggregate over hand-built QueryScore literals: cells (1.0, 0.5, 0.0) -> mean 0.5.
  const hq = (query: string, v: number): QueryScore => ({
    query,
    relevant: ["r"],
    firstRank: v > 0 ? 1 : 0,
    recall5: v,
    recall10: v,
    reciprocal: v,
    ndcg10: v,
  });
  const H_AGG = aggregate("bm25", [hq("cell 1.0", 1), hq("cell 0.5", 0.5), hq("cell 0.0", 0)]);
  check(
    "metrics: aggregate of (1.0, 0.5, 0.0) -> every cell 0.5 ±1e-9",
    Math.abs(H_AGG.recall5 - 0.5) <= 1e-9 &&
      Math.abs(H_AGG.recall10 - 0.5) <= 1e-9 &&
      Math.abs(H_AGG.mrr10 - 0.5) <= 1e-9 &&
      Math.abs(H_AGG.ndcg10 - 0.5) <= 1e-9,
    JSON.stringify({
      recall5: H_AGG.recall5,
      recall10: H_AGG.recall10,
      mrr10: H_AGG.mrr10,
      ndcg10: H_AGG.ndcg10,
    }),
  );

  /* I. Store-level seam tests — real HelixStore flow with `send` /
   * `searchByText` stubbed via own-property dispatch: ZERO network, no
   * server, CI-safe (construction does no I/O — see the offline check). */

  // Offline factory: record every transport call, answer by call order.
  // Default sequence: call 1 = dedup pre-check (legitimate MISS); call >= 2
  // = the fabricated insert success. `replies` overrides calls 1..n for
  // tests whose flow needs a REAL canned answer for a specific call —
  // REQ-RL-001: reaching the merge now also issues a fresh getMemoryById
  // re-read under the survivor lock (call 2), which must be served an
  // actual row (shape drift / miss / wrong row throw fail-closed).
  // searchByText is the near-dup probe seam (public method, overrideable).
  const makeSeamStore = (
    sends: unknown[],
    probe: () => Promise<SearchHit[]>,
    replies: readonly unknown[] = [],
  ): HelixStore => {
    const store = new HelixStore("http://127.0.0.1:9"); // unreachable port — proves no connection is made
    Object.assign(store, {
      send: async (request: unknown): Promise<unknown> => {
        sends.push(request);
        const index = sends.length - 1;
        if (index < replies.length) return replies[index];
        if (sends.length === 1) return { memory: null }; // dedup pre-check: MISS
        return { memory: [{ memoryId: "insert-ok" }] }; // fabricated insert success
      },
      searchByText: probe,
    });
    return store;
  };

  const savedTtlI = process.env["AGENT_MEMORY_TTL_DAYS"];
  const savedMergeI = process.env["AGENT_MEMORY_MERGE_JACCARD"];
  const restoreI = (): void => {
    if (savedTtlI === undefined) delete process.env["AGENT_MEMORY_TTL_DAYS"];
    else process.env["AGENT_MEMORY_TTL_DAYS"] = savedTtlI;
    if (savedMergeI === undefined) delete process.env["AGENT_MEMORY_MERGE_JACCARD"];
    else process.env["AGENT_MEMORY_MERGE_JACCARD"] = savedMergeI;
  };
  try {
    process.env["AGENT_MEMORY_MERGE_JACCARD"] = "0.9"; // probe ON — explicit, host-independent

    /* I-a. Fail-closed probe (COND-QA-03): a broken near-dup text probe must
     * PROPAGATE (never silently skip the merge) AND the insert must never run. */
    const i1Sends: unknown[] = [];
    const i1 = makeSeamStore(i1Sends, () => Promise.reject(new Error("probe down")));
    const i1Input: RememberInput = {
      content: "fail closed probe content alpha beta gamma",
      project: "verify-lifecycle",
      sessionId: "i1",
      origin: "test",
      concepts: [],
    };
    let probeErr: unknown;
    try {
      await i1.remember(i1Input);
    } catch (err) {
      probeErr = err;
    }
    check(
      'probe fail-closed: searchByText failure propagates as "probe down" (merge never silently skipped)',
      probeErr instanceof Error && probeErr.message === "probe down",
      probeErr instanceof Error ? probeErr.message : String(probeErr),
    );
    check(
      "probe fail-closed: insert NEVER sent — only the dedup pre-check ran (sends=1)",
      i1Sends.length === 1,
      `sends=${i1Sends.length}`,
    );

    /* Offline guarantee: importing src/store.ts (done at module load above)
     * + constructing HelixStore against an unreachable port performs NO
     * network I/O — any load-time connection here would already have thrown
     * or hung this Helix-free CI suite. */
    let constructOk = false;
    try {
      const probeStore = new HelixStore("http://127.0.0.1:9");
      constructOk = probeStore !== undefined;
    } catch {
      constructOk = false;
    }
    check(
      "store: import + construct are offline (no load-time network side effect)",
      constructOk,
      "HelixStore construction threw",
    );

    /* I-b. TTL × merge golden (reliability): an EXPIRED identical near-dup
     * candidate must be dropped BEFORE the jaccard loop -> plain insert.
     * Without the filterExpired guard the substring guard would swallow it
     * (consolidated=true, NO insert) — this discriminates the two orders. */
    process.env["AGENT_MEMORY_TTL_DAYS"] = "1"; // TTL 1 day
    const expiredContent = "ttl guard candidate content delta epsilon zeta";
    const expiredHit: SearchHit = {
      id: "e1",
      memoryId: "expired-hit",
      content: expiredContent, // IDENTICAL to the incoming -> jaccard 1 >= 0.9
      sessionId: "old-session",
      origin: "rest",
      importance: 0.5,
      createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), // age 10d > TTL 1d -> expired
      score: 3.5,
    };
    const i4Sends: unknown[] = [];
    const i4 = makeSeamStore(i4Sends, () => Promise.resolve([expiredHit]));
    const i4Result = await i4.remember({
      content: expiredContent,
      project: "verify-lifecycle",
      sessionId: "i4",
      origin: "test",
      concepts: [],
    });
    check(
      "TTL×merge: expired identical candidate dropped -> plain insert (consolidated=false, deduped=false, 2 sends)",
      i4Result.consolidated === false &&
        i4Result.deduped === false &&
        i4Sends.length === 2,
      JSON.stringify({
        consolidated: i4Result.consolidated,
        deduped: i4Result.deduped,
        sends: i4Sends.length,
      }),
    );

    // Control: TTL OFF -> the same candidate survives, consolidates via the
    // substring guard (consolidated=true, NO insert send) — proves the TTL
    // filter is the only thing that changed between the two runs.
    // REQ-RL-001: reaching the merge re-reads the survivor FRESH under the
    // survivor lock (call 2). REQ-F-01: the guard path now also verifies +
    // heals the concept LINKS instead of returning without reading —
    // canned here as a simulated partial commit (call 3 says NOTHING is
    // linked → linkMemoryConcepts heal (call 4) → re-read shows the links
    // landed (call 5)). sends=5 therefore means pre-check + fresh re-read +
    // concepts read + link heal + re-read with NO insert (a plain insert
    // would bypass all of that; a skipped fresh read would leave sends=4;
    // a skipped concepts read would leave sends=2).
    delete process.env["AGENT_MEMORY_TTL_DAYS"];
    const i5Sends: unknown[] = [];
    const i5ExpectedConcepts = extractConcepts(expiredContent); // guard derives from content (request passed none)
    const i5 = makeSeamStore(
      i5Sends,
      () => Promise.resolve([expiredHit]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        {
          // call 2: fresh getMemoryById re-read under the survivor lock
          memory: [
            {
              memoryId: "expired-hit",
              content: expiredContent,
              createdAt: expiredHit.createdAt,
            },
          ],
        },
        { names: [] }, // call 3: guard-path memoryConcepts read — NOTHING linked (simulated partial commit)
        { memory: [{ memoryId: "expired-hit" }] }, // call 4: linkMemoryConcepts heal — anchor present
        // call 5: re-read — the heal landed every expected name. Rows are
        // RECORDS {name} (memoryConcepts projects PropertyProjection.new("name");
        // readLinkedConcepts drops non-record rows via toRecords, so a plain
        // string array would read as "nothing linked" and trip the invariant).
        { names: i5ExpectedConcepts.map((name) => ({ name })) },
      ],
    );
    const i5Result = await i5.remember({
      content: expiredContent,
      project: "verify-lifecycle",
      sessionId: "i5",
      origin: "test",
      concepts: [],
    });
    check(
      "TTL×merge: TTL OFF control -> consolidates via guard; guard path heals missing concept links offline (consolidated=true, 5 sends, NO insert)",
      i5Result.consolidated === true && i5Sends.length === 5,
      JSON.stringify({ consolidated: i5Result.consolidated, sends: i5Sends.length }),
    );

    /* Gate RL001-F01 / COND-RK-02: the guard-path heal above now emits the
     * one-line allowlisted heal record (stderr observability). The LOG is
     * observability, NOT contract — so the assert here pins the RESPONSE
     * shape only (consolidated + survivor-id echo unchanged), never stdout
     * text (brittle). */
    check(
      "COND-RK-02: guard-path heal response shape unchanged by the heal log (consolidated=true, survivor id echoed)",
      i5Result.consolidated === true && i5Result.id === "expired-hit",
      JSON.stringify({ consolidated: i5Result.consolidated, idEchoed: i5Result.id === "expired-hit" }),
    );

    /* I-c. Gate RL001-F01 / COND-RF-03 (folds resilience COND-RS-03): the
     * THREE contract-claimed fail-closed sub-paths that had zero asserting
     * tests — each driven offline through the same `makeSeamStore`
     * per-call canned replies (ZERO network, CI-safe, call-order trap).
     * The canned strings below are synthetic fixtures — no content, no
     * PII; details print counts/statuses only. */

    /* (a) expired-while-WAITING (REQ-RL-001, src/store.ts mergeUnderSurvivorLock):
     * the probe candidate is LIVE (it survives the pre-lock filterExpired),
     * but the FRESH re-read under the survivor lock comes back EXPIRED ->
     * `remember` falls through to the PLAIN INSERT (consolidated=false,
     * insert SENT — a fresh write is never absorbed by a TTL-expired row).
     * The I-b TTL-ON case above drops the candidate at PROBE time; this one
     * exercises the under-lock re-check itself. */
    process.env["AGENT_MEMORY_TTL_DAYS"] = "1"; // TTL 1 day
    const waitingContent = "expired while waiting seam content november oscar papa";
    const liveAtProbe: SearchHit = {
      id: "w1",
      memoryId: "waiting-hit",
      content: waitingContent, // IDENTICAL to the incoming -> jaccard 1 >= 0.9 -> survivor picked
      sessionId: "old-session",
      origin: "rest",
      importance: 0.5,
      createdAt: new Date().toISOString(), // LIVE at probe time -> survives the pre-lock filterExpired
      score: 4.2,
    };
    const i6Sends: unknown[] = [];
    const i6 = makeSeamStore(
      i6Sends,
      () => Promise.resolve([liveAtProbe]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        {
          // call 2: fresh getMemoryById re-read under the lock — EXPIRED row
          memory: [
            {
              memoryId: "waiting-hit",
              content: waitingContent,
              createdAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), // age 10d > TTL 1d
            },
          ],
        },
        // call 3: fabricated plain-insert success (default canned reply)
      ],
    );
    const i6Result = await i6.remember({
      content: waitingContent,
      project: "verify-lifecycle",
      sessionId: "i6",
      origin: "test",
      concepts: [],
    });
    check(
      "COND-RF-03(a) expired-while-waiting: fresh re-read EXPIRED -> plain insert, never absorbs (consolidated=false, deduped=false, insert SENT, 3 sends)",
      i6Result.consolidated === false &&
        i6Result.deduped === false &&
        i6Sends.length === 3,
      JSON.stringify({
        consolidated: i6Result.consolidated,
        deduped: i6Result.deduped,
        sends: i6Sends.length,
      }),
    );
    delete process.env["AGENT_MEMORY_TTL_DAYS"]; // remaining cases run TTL OFF

    /* (b) fresh-read MISS (REQ-RL-001, src/store.ts getFreshSurvivor): the
     * survivor vanished between probe and lock -> the under-lock re-read
     * returns `{memory: []}` -> `remember` REJECTS fail-closed NAMING the
     * vanished survivor, and the insert is NEVER sent (2 sends total). */
    const vanishedContent = "vanished survivor seam content quebec romeo sierra tango";
    const vanishedHit: SearchHit = {
      id: "v1",
      memoryId: "vanished-hit",
      content: vanishedContent, // identical -> survivor picked off the probe
      sessionId: "old-session",
      origin: "rest",
      importance: 0.5,
      createdAt: new Date().toISOString(),
      score: 4.1,
    };
    const i7Sends: unknown[] = [];
    const i7 = makeSeamStore(
      i7Sends,
      () => Promise.resolve([vanishedHit]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        { memory: [] }, // call 2: fresh re-read — ROW GONE
      ],
    );
    let i7Err: unknown;
    try {
      await i7.remember({
        content: vanishedContent,
        project: "verify-lifecycle",
        sessionId: "i7",
        origin: "test",
        concepts: [],
      });
    } catch (err) {
      i7Err = err;
    }
    check(
      "COND-RF-03(b) fresh-read miss: survivor vanished -> remember REJECTS fail-closed (named REQ-RL-001 throw), insert NEVER sent (2 sends)",
      i7Err instanceof Error &&
        i7Err.message.includes("REQ-RL-001: survivor") &&
        i7Err.message.includes("vanished between probe and merge lock") &&
        i7Sends.length === 2,
      `${i7Err instanceof Error ? i7Err.message : String(i7Err)} (sends=${i7Sends.length})`,
    );

    /* (c) post-heal STILL-VIOLATED (REQ-F-01, src/store.ts verifyMergedState):
     * the merge write lands, round 1 of the post-write verify reports
     * content drift + missing links, the ONE heal (`retryWrite` — the full
     * updateMemoryContent re-send) runs, round 2 sees content/dedupKey
     * restored but the concepts STILL missing -> the named-invariant throw
     * fires (fail-closed). 8 canned calls: pre-check, fresh re-read, write,
     * verify read ×2, retryWrite, verify read ×2. `cIncoming` is the token
     * REVERSE of `cBase` (jaccard 1.0 >= 0.9, yet NOT a normalized
     * substring -> the substring guard cannot swallow the merge). */
    const cBase = "seam post heal survivor content alpha bravo charlie delta echo";
    const cIncoming = "echo delta charlie bravo alpha content heal post seam";
    const cConcepts = ["cseamalpha", "cseambravo"]; // explicit request concepts = the merge's EFFECTIVE list
    const cProject = "verify-lifecycle";
    const cNextContent = mergedContent(cBase, cIncoming); // base + "\n" + incoming (guard cannot hit)
    const cNextDedup = contentHash(cProject, normalizeContent(cNextContent));
    // F-01-EMB: the verify now reads the projected embedding too, so both
    // canned verify rows carry real vectors (f32 round-tripped). NOTE (bag-of-
    // words embedder): (c)'s reverse-token fixture keeps the token MULTISET
    // — every tf doubles uniformly and L2 normalization cancels the scale —
    // so embed(cBase) === embed(cNextContent) and the embedding invariant
    // does NOT fire here; the throw this case pins stays concept-only. The
    // discriminating seam for the embedding invariant is §I-d below.
    const cStaleEmb = embed(cBase).map((value) => Math.fround(value));
    const cFreshEmb = embed(cNextContent).map((value) => Math.fround(value));
    const cMergedRow = {
      memoryId: "seam-merge-hit",
      content: cNextContent,
      createdAt: new Date().toISOString(),
      dedupKey: cNextDedup, // round 2: content + dedupKey BOTH restored
      embedding: cFreshEmb, // round 2: embedding restored too (v1.6 4-invariant scope)
    };
    const cUpdateOk = {
      memory: [{ memoryId: "seam-merge-hit" }], // anchor present
      updated: [{ memoryId: "seam-merge-hit" }], // setProperty branch non-empty
    };
    const i8Sends: unknown[] = [];
    const i8 = makeSeamStore(
      i8Sends,
      () =>
        Promise.resolve([
          {
            id: "m1",
            memoryId: "seam-merge-hit",
            content: cBase,
            sessionId: "old-session",
            origin: "rest",
            importance: 0.5,
            createdAt: new Date().toISOString(),
            score: 4.0,
          },
        ]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        { memory: [{ memoryId: "seam-merge-hit", content: cBase, createdAt: new Date().toISOString() }] }, // call 2: fresh re-read
        cUpdateOk, // call 3: the merge write (updateMemoryContent)
        // call 4: verify round 1 — content still the PRE-merge snapshot (drift) …
        // (embedding present but NOT a violation here: reverse-token fixture,
        // identical bag-of-words vector — see the fixture note above)
        {
          memory: [
            {
              memoryId: "seam-merge-hit",
              content: cBase,
              createdAt: new Date().toISOString(),
              embedding: cStaleEmb,
            },
          ],
        },
        { names: [] }, // call 5: … and NOTHING linked yet -> violations = content + concepts[…]
        cUpdateOk, // call 6: the ONE heal — retryWrite re-sends the identical write
        { memory: [cMergedRow] }, // call 7: verify round 2 — content + dedupKey + embedding now match …
        { names: [] }, // call 8: … but the concepts are STILL missing -> named throw
      ],
    );
    let i8Err: unknown;
    try {
      await i8.remember({
        content: cIncoming,
        project: cProject,
        sessionId: "i8",
        origin: "test",
        concepts: cConcepts,
      });
    } catch (err) {
      i8Err = err;
    }
    check(
      "COND-RF-03(c) post-heal still-violated: one retryWrite heal, re-verify still misses concepts -> named REQ-F-01 invariant throw (fail-closed, 8 sends)",
      i8Err instanceof Error &&
        i8Err.message.includes("REQ-F-01: post-write verify failed after one heal") &&
        i8Err.message.includes("concepts[") &&
        i8Sends.length === 8,
      `${i8Err instanceof Error ? i8Err.message : String(i8Err)} (sends=${i8Sends.length})`,
    );

    /* (d) F-01-EMB embedding invariant (SPEC-F01-EMB REQ-F-01-EMB-04/05):
     * the SAME merge flow as (c), canned per call, driving ONLY the fourth
     * invariant. FIXTURE NOTE (the precondition below proves it numerically):
     * `embed` is BAG-OF-WORDS, so a pure token-REVERSAL like (c)'s keeps the
     * token multiset — every tf doubles uniformly, L2 normalization cancels
     * the scale factor, and the vector comes out IDENTICAL (drift 0, no
     * violation to heal). `dIncoming` therefore adds ONE token (`lima`) the
     * survivor lacks: jaccard = 12/13 = 0.923 >= 0.9 still qualifies as a
     * near-dup, it is NOT a normalized substring of the survivor (the guard
     * cannot swallow the merge), and the merged vector genuinely differs from
     * the stored one. Three cases, all offline (ZERO network, CI-safe):
     *   d1 stale embedding ONLY -> ONE retryWrite heal -> re-verify green
     *      (8 sends) + the stderr `invariants=embedding` family token;
     *   d2 STILL stale after that one heal -> named REQ-F-01 throw (8 sends,
     *      and NO heal line — an unconfirmed heal is never logged);
     *   d3 f32-round-tripped correct vector -> verify green with NO heal
     *      (5 sends) — the false-positive guard for embeddingsEqual's
     *      Math.fround + 1e-6 tolerance.
     * Canned vectors come from src/embed.ts (deterministic, in-memory);
     * only counts/tokens are ever printed — no content, no embedding
     * VALUES, no PII (probe3/SEC-F02 logging discipline). */

    /** Capture the store's STDERR around one offline call — the allowlisted
     *  `heal survivor=…` record goes to stderr (contract §3 COND-RK-02;
     *  stdout is the MCP channel). Returns the body's value OR its error
     *  plus every captured stderr line. */
    const captureStderr = async <T>(
      body: () => Promise<T>,
    ): Promise<{ value: T | undefined; error: unknown; lines: string[] }> => {
      const lines: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]): void => {
        lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
      };
      try {
        const value = await body();
        return { value, error: undefined, lines };
      } catch (err) {
        return { value: undefined, error: err, lines };
      } finally {
        console.error = original;
      }
    };

    const dBase = "seam embedding survivor delta foxtrot golf hotel india juliet kilo romeo sierra";
    const dIncoming =
      "sierra romeo kilo juliet india hotel golf foxtrot delta survivor embedding seam lima"; // +1 NEW token -> jaccard 12/13 = 0.923, not a substring, merged vector CHANGES
    const dProject = "verify-lifecycle";
    const dConcepts = ["dseamalpha", "dseambravo"]; // explicit request concepts = the merge's EFFECTIVE list
    const dNextContent = mergedContent(dBase, dIncoming); // base + "\n" + incoming (guard cannot hit)
    const dNextDedup = contentHash(dProject, normalizeContent(dNextContent));
    const dStaleEmb = embed(dBase).map((value) => Math.fround(value)); // PRE-merge vector the partial commit left behind
    const dFreshEmb = embed(dNextContent).map((value) => Math.fround(value)); // f32-round-tripped EXPECTED vector
    const dMaxDrift = dStaleEmb.reduce(
      (max, value, index) => Math.max(max, Math.abs(value - (dFreshEmb[index] ?? 0))),
      0,
    );
    check(
      "F-01-EMB precondition: fixture qualifies (jaccard >= 0.9, drifts > 1e-6 — a genuine mismatch, not an epsilon artifact)",
      jaccard(dBase, dIncoming) >= 0.9 &&
        dStaleEmb.length === dFreshEmb.length &&
        dMaxDrift > 1e-6,
      `jaccard=${jaccard(dBase, dIncoming).toFixed(4)} dims=${dStaleEmb.length}/${dFreshEmb.length} maxDrift=${dMaxDrift}`,
    );

    const dProbeHit = (memoryId: string): SearchHit => ({
      id: memoryId,
      memoryId,
      content: dBase, // IDENTICAL to the fresh survivor's -> jaccard(base, incoming) = 12/13 = 0.923 >= 0.9 -> survivor picked
      sessionId: "old-session",
      origin: "rest",
      importance: 0.5,
      createdAt: new Date().toISOString(),
      score: 4.0,
    });
    const dSurvivorRow = (memoryId: string): Record<string, unknown> => ({
      memoryId,
      content: dBase, // call 2 re-read: the row as it is NOW (pre-merge)
      createdAt: new Date().toISOString(),
    });
    const dVerifyRow = (memoryId: string, embedding: readonly number[]): Record<string, unknown> => ({
      memoryId,
      content: dNextContent, // the merge write landed
      dedupKey: dNextDedup, // … with the right key
      createdAt: new Date().toISOString(),
      embedding: [...embedding], // the VECTOR under test (stale or f32-fresh)
    });
    const dUpdateOk = (memoryId: string): Record<string, unknown> => ({
      memory: [{ memoryId }], // anchor present
      updated: [{ memoryId }], // setProperty branch non-empty
    });
    const dLinked = { names: dConcepts.map((name) => ({ name })) };

    /* d1: embedding STALE, content/dedupKey/links green -> violations =
     * ["embedding"] ONLY -> viaRetryWrite -> the ONE heal (retryWrite) ->
     * re-verify green. 8 canned calls, mirroring (c). */
    const d1Sends: unknown[] = [];
    const d1 = makeSeamStore(
      d1Sends,
      () => Promise.resolve([dProbeHit("seam-emb-d1")]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        { memory: [dSurvivorRow("seam-emb-d1")] }, // call 2: fresh re-read under the survivor lock
        dUpdateOk("seam-emb-d1"), // call 3: the merge write (updateMemoryContent)
        { memory: [dVerifyRow("seam-emb-d1", dStaleEmb)] }, // call 4: verify round 1 — content + dedupKey landed, embedding STALE
        dLinked, // call 5: … and every concept linked -> violations = ["embedding"] alone
        dUpdateOk("seam-emb-d1"), // call 6: the ONE heal — an embedding violation routes to retryWrite
        { memory: [dVerifyRow("seam-emb-d1", dFreshEmb)] }, // call 7: verify round 2 — embedding now matches (f32) …
        dLinked, // call 8: … links still green -> confirmed heal, no throw
      ],
    );
    const d1Run = await captureStderr(() =>
      d1.remember({
        content: dIncoming,
        project: dProject,
        sessionId: "d1",
        origin: "test",
        concepts: dConcepts,
      }),
    );
    check(
      "F-01-EMB(d1) stale embedding heals: violations=[embedding] only -> ONE retryWrite heal -> re-verify green (consolidated=true, 8 sends, NO insert)",
      d1Run.error === undefined &&
        d1Run.value !== undefined &&
        d1Run.value.consolidated === true &&
        d1Sends.length === 8,
      JSON.stringify({
        consolidated: d1Run.value?.consolidated ?? null,
        error: d1Run.error === undefined ? null : String(d1Run.error),
        sends: d1Sends.length,
      }),
    );
    check(
      "F-01-EMB(d1) heal observability: stderr line is exactly `heal survivor=seam-emb-d1 invariants=embedding` (family token only)",
      d1Run.lines.includes("heal survivor=seam-emb-d1 invariants=embedding"),
      JSON.stringify({ lines: d1Run.lines }),
    );

    /* d2: the heal does NOT fix the embedding (persistent partial commit) ->
     * re-verify still reports `embedding` -> named REQ-F-01 throw,
     * fail-closed, and NO heal line (the log fires only on a CONFIRMED
     * heal — COND-RK-02). */
    const d2Sends: unknown[] = [];
    const d2 = makeSeamStore(
      d2Sends,
      () => Promise.resolve([dProbeHit("seam-emb-d2")]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        { memory: [dSurvivorRow("seam-emb-d2")] }, // call 2: fresh re-read
        dUpdateOk("seam-emb-d2"), // call 3: the merge write
        { memory: [dVerifyRow("seam-emb-d2", dStaleEmb)] }, // call 4: verify round 1 — STALE
        dLinked, // call 5: links green -> violations = ["embedding"]
        dUpdateOk("seam-emb-d2"), // call 6: the ONE heal — retryWrite
        { memory: [dVerifyRow("seam-emb-d2", dStaleEmb)] }, // call 7: verify round 2 — STILL stale
        dLinked, // call 8: links green -> the throw names embedding ALONE
      ],
    );
    const d2Run = await captureStderr(() =>
      d2.remember({
        content: dIncoming,
        project: dProject,
        sessionId: "d2",
        origin: "test",
        concepts: dConcepts,
      }),
    );
    check(
      "F-01-EMB(d2) still-stale after one heal: named REQ-F-01 throw naming `embedding` (fail-closed, 8 sends)",
      d2Run.value === undefined &&
        d2Run.error instanceof Error &&
        d2Run.error.message.includes("REQ-F-01: post-write verify failed after one heal") &&
        d2Run.error.message.includes("invariant(s) violated — embedding") &&
        d2Sends.length === 8,
      `${d2Run.error instanceof Error ? d2Run.error.message : String(d2Run.error)} (sends=${d2Sends.length})`,
    );
    check(
      "F-01-EMB(d2) unconfirmed heal is never logged (no `heal survivor=` line on the throw path)",
      !d2Run.lines.some((line) => line.startsWith("heal survivor=")),
      JSON.stringify({ lines: d2Run.lines }),
    );

    /* d3: the EXPECTED vector, f32-round-tripped — must PASS the verify with
     * NO heal (5 sends) and no heal line: embeddingsEqual's Math.fround +
     * 1e-6 tolerance is not a false-positive machine. */
    const d3Sends: unknown[] = [];
    const d3 = makeSeamStore(
      d3Sends,
      () => Promise.resolve([dProbeHit("seam-emb-d3")]),
      [
        { memory: null }, // call 1: dedup pre-check — MISS
        { memory: [dSurvivorRow("seam-emb-d3")] }, // call 2: fresh re-read
        dUpdateOk("seam-emb-d3"), // call 3: the merge write
        { memory: [dVerifyRow("seam-emb-d3", dFreshEmb)] }, // call 4: verify round 1 — content + dedupKey + embedding ALL green
        dLinked, // call 5: links green -> NOTHING violated -> return, no heal
      ],
    );
    const d3Run = await captureStderr(() =>
      d3.remember({
        content: dIncoming,
        project: dProject,
        sessionId: "d3",
        origin: "test",
        concepts: dConcepts,
      }),
    );
    check(
      "F-01-EMB(d3) f32 round-trip green: correct embedding passes verify with NO heal (consolidated=true, 5 sends, no heal line)",
      d3Run.error === undefined &&
        d3Run.value !== undefined &&
        d3Run.value.consolidated === true &&
        d3Sends.length === 5 &&
        !d3Run.lines.some((line) => line.startsWith("heal survivor=")),
      JSON.stringify({
        consolidated: d3Run.value?.consolidated ?? null,
        sends: d3Sends.length,
        healLines: d3Run.lines.filter((line) => line.startsWith("heal survivor=")).length,
      }),
    );
  } finally {
    restoreI();
  }

  /* J. opencode plugin importance default (COND-QA-02 / CE-004) — fs check
   * against the shipped plugin source (READ-ONLY, no import: the plugin
   * pulls the opencode runtime). The plugin must not pin a 0.5 default; it
   * spreads `importance` ONLY when the caller supplied one so the server
   * derives it (REQ-P1-4). */
  const pluginSource = readFileSync(
    join(REPO_ROOT, "plugins/opencode/plugins/agent-memory.ts"),
    "utf8",
  );
  check(
    "plugin: NO DEFAULT_IMPORTANCE anywhere in agent-memory.ts",
    !pluginSource.includes("DEFAULT_IMPORTANCE"),
    "DEFAULT_IMPORTANCE found",
  );
  check(
    "plugin: omit-when-absent spread present verbatim (importance !== undefined ? { importance } : {})",
    pluginSource.includes("importance !== undefined ? { importance } : {}"),
    "spread guard not found",
  );

  /* Summary (verify.ts format). */
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY PASS");
}

main().catch((err: unknown) => {
  console.error(`verify-lifecycle crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
