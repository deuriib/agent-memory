# Refuter Review: Brainy v1 (SPEC-001..005)

**Reviewer:** review-refuter (adversarial)
**Date:** 2026-09-25
**Verdict:** pass ("could not falsify")
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md + SPEC-002..005 (frozen REQ-BRAINY-* + ACs) / HARD:subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+never-kill-3111/3112/3113+evidence-allowlist / GATE:pending / DOMAINS:R1,R2,R4,R5,R8`
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD`. Read-only verification only: `npm run typecheck`, `npm test`, `npx tsx scripts/verify-lifecycle.ts`, `npx tsx scripts/verify-ops.ts`, greps, `git show/log/grep`. No `helix start/stop`, no traffic to 3111/3112/3113, no file modified except this one.

## Mission

Attempt to **falsify** the executing lanes' claims in `TEST_MATRIX.md` (Brainy v1 section, commit `908ce3e`), `SECURITY_REVIEW.md` C1..C8, `BRAND_SIGNOFF.md` AC-01..07, and ADR-0003 C1..C4. Success = a counterexample. Result: **18 attacks, 0 refutations, 0 new findings.**

## Attack Vectors Tried

| ID | Hypothesis | Attempt | Result |
|----|-----------|---------|--------|
| RF-01 | Cited commit hashes in the 45-row matrix are dangling or wrong | `git cat-file -t` on all 22 unique hashes (`53f5588`..`bf2b595`) | CLAIM HOLDS — all 22 resolve to `commit` |
| RF-02 | Cited tests do not assert cited REQs (≥8 rows spot-checked) | `ls tests/` (11 files present) + content greps: `move.test.ts` 12 move hits (ENG-06), `step3.test.ts` 9×1536 (ENG-04), `step7.test.ts` unauthorized asserts (SEC-02), `ttl.test.ts` 17 TTL hits (LEG-03), `step6.test.ts:371-377` 401-without-auth assert (SEC-01/C1), `step8.test.ts` 23 slot/quartet hits (OPS-01/02) | CLAIM HOLDS — every sampled row binds to a real asserting test |
| RF-03 | "80/80 tests" is stale or inflated | `npm test` re-run | CLAIM HOLDS — `pass 80, fail 0` |
| RF-04 | "typecheck 0" is stale | `npm run typecheck` re-run | CLAIM HOLDS — exit 0, 0 errors |
| RF-05 | "verify-lifecycle 123/123" is stale | `npx tsx scripts/verify-lifecycle.ts` re-run | CLAIM HOLDS — `123 passed, 0 failed / VERIFY PASS` |
| RF-06 | "verify-ops 124/124" is stale or touches protected ports | `npx tsx scripts/verify-ops.ts` re-run (read-only harness, synthetic listeners) | CLAIM HOLDS — `124 passed, 0 failed / VERIFY PASS`, tail shows `C1: zero requests sent to foreign listener` |
| RF-07 | C1 bearer-parity anchor does not exist at cited lines | `grep isBearerAuthorized/livez/timingSafeEqual` in `src/server.ts`+`src/auth.ts` | CLAIM HOLDS — guard at `src/server.ts:375-377` (livez-only exempt), `timingSafeEqual` at `src/auth.ts:48`, non-loopback `WARN INSECURE` at `src/server.ts:981` (line numbers drifted from review text, anchors intact) |
| RF-08 | C4 DoS caps are aspirational (no code) | `grep MAX_BODY_BYTES/200_000/withTimeout` | CLAIM HOLDS — `src/server.ts:32` 1 MiB, `:38,180` 200k content caps, `:314` 413 path, `src/store.ts:853` `withTimeout` |
| RF-09 | C8 tenant isolation is doc-only | `grep invalid_tenant_link` + `defineParams` | CLAIM HOLDS — `src/server.ts:446,574` tenant throws, `db/queries.ts` 34 `defineParams` hits, zero query string-concat found |
| RF-10 | C5/C6/C7 anchors are missing | `hooks/capture.mjs:72` fixed string; `bin/brainy.mjs:478-481,532-533` 0700/0600; `:1354` doctor order comment; `docs/CONTRACT.md:19,22` PII/TTL-365 declaration | CLAIM HOLDS — all anchors exist |
| RF-11 | Brand AC-01/AC-07 greps do not reproduce (counts differ: 191→162, 23→27, 109→111) | Re-ran all four greps in working tree; then `git grep -c` pinned at `d41ded1` (199 agentmemory / 26 iii-engine lines) vs `HEAD` (200/27) | CLAIM HOLDS — drift is methodology (working-tree `grep -r` vs `git grep`, binary/exclude handling) plus 2 post-signoff gate-review commits adding prose mentions; variance rationale (frozen history, allowed set) unaffected |
| RF-12 | Authorized purge set still dirty (skills/, ROADMAP, CONTRIBUTING, SECURITY) | `grep -rni "agentmemory\|iii-engine"` over exactly that set | CLAIM HOLDS — 0 hits |
| RF-13 | ADR-0003 C1..C4 unsatisfied | C1: commit `4626695` R2 STRIDE verdict for move-route delta exists; C2: move rows present at `ARCHITECTURE.md:141` + `SPEC-001:129`; C3: commit `201b1ee` repoints CLI move (stat: `bin/brainy.mjs` +216/-22 with tests); C4: `src/server.ts:427` route + `tests/move.test.ts` + `step6.test.ts:371-414` pattern | CLAIM HOLDS — all four conditions satisfied in code |
| RF-14 | Gap 3 (forgetNote unexposed) is understated — maybe exposed somewhere | `grep -n "forgetNote" src/server.ts src/mcp.ts` | CLAIM HOLDS — 0 callers (exit 1); lane's self-report accurate, no worse hiding |
| RF-15 | Gap 10 (HELIX_URL-only) is wrong — maybe BRAINY_URL already canonical | `grep HELIX_URL/BRAINY_URL src/store.ts` + read `:848` | CLAIM HOLDS — constructor reads `HELIX_URL` only; self-report accurate |
| RF-16 | The 5 `verify.ts` FAILs are invented or actually passing now | `grep -n 384 scripts/verify.ts` (`:249` length-is-384, `:256-257` zero-vector-384) vs `src/embed.ts` 1536-dim | CLAIM HOLDS — structural contradiction confirmed in code; cannot live-reproduce (slot9 server torn down, out of read-only scope) but the FAIL claim is code-consistent and was reported as FAIL, not passed |
| RF-17 | Secret scan fallback hides real keys | `grep -rEn "ghp_\|sk-live\|AKIA\|PRIVATE KEY"` excluding scanners/frozen SPECs/archives | CLAIM HOLDS — only `scripts/verify-skills.ts` self-descriptions match; 0 real findings |
| RF-18 | A vacuous/not-run "pass" hides beyond the 10 self-reported gaps | Reviewed every `pass` row in C1..C8 audit + CDR-07 table against anchors above; live-only items (401 matrix, MCP handshake, 413/timeout, README examples, breach drill) are all explicitly marked gap/not-run by the lane itself | CLAIM HOLDS — no undeclared vacuous pass found; known-ruled items (bootstrap conflict, 384 goldens, NFR-01 scale, :3111 probe) show nothing worse underneath |

## Counterexamples Found

None. Zero refuted claims, zero new findings.

| ID | Counterexample | Impact | Reproduction |
|----|---------------|--------|--------------|
| — | — | — | — |

(Related honest gaps — `forgetNote` unexposed, `HELIX_URL`-only, NFR-01 scale not-run, live 401 matrix not-run — remain owned by their reporting lane and sibling reviewers; per no-freelance-fix I record no duplicate findings here. Severity + location + owner for those live with the executing lane's report.)

## Verdict Rationale

- pass = attempted falsification across all five priority claim families with independent re-runs (typecheck, 80 tests, 123 lifecycle, 124 ops) and anchor greps; no counterexamples found.
- The two numeric variances encountered (brand grep counts, cited line numbers) were both resolved to methodology/line-drift with anchors intact — investigated, not waived.
- Live-server claims (slot9/:38911 bar #7–10) could not be independently re-run read-only (instance torn down; starting one is out of scope); code-structural evidence corroborates them where checkable (RF-16). Residual trust in those rows belongs to QA verification, flagged as cross-domain request below.

**Cross-domain requests:** QA (quality-assurance reviewer) asked to re-prove or explicitly accept the slot9 live rows (TEST_MATRIX bar #7–10, CDR-07 table) on a fresh instance; R1 owns the 10 self-reported gaps disposition (especially `forgetNote` REST/MCP exposure, `HELIX_URL`→`BRAINY_URL` canonical-first, `verify.ts` 384→1536 golden migration, NFR-01 scale harness).
