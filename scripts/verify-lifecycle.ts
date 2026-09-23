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
import { extractConcepts, MAX_CONCEPTS, MAX_CONCEPT_CHARS } from "../src/concepts.js";
import { contentHash, decayedImportance, filterExpired, normalizeContent } from "../src/lifecycle.js";
import { oneLine } from "../src/logline.js";

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

function main(): void {
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

  /* Summary (verify.ts format). */
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY PASS");
}

main();
