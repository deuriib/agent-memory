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

  /* Summary (verify.ts format). */
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`VERIFY FAIL\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("VERIFY PASS");
}

main();
