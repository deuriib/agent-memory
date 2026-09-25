# Quality Assurance Review: Brainy v1 (SPEC-001..005)

**Reviewer:** quality-assurance (independent; did not write the code)
**Date:** 2026-09-25
**Verdict:** conditional (3 conditions, 0 new findings)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md + SPEC-002..005 (frozen REQ-BRAINY-* + ACs) / HARD:subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+never-kill-3111/3112/3113+evidence-allowlist / GATE:pending / DOMAINS:R1,R2,R4,R5,R8`
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD`. Comes AFTER `review-refuter` (pass, 0/18 refuted, `011ab99`) — builds on it, does not repeat claim-attacking. Owns test adequacy + traceability.

## Checklist

- [x] All acceptance criteria have tests (or an explicitly recorded gap — 10 gaps dispositioned below, none hidden)
- [x] All REQ-IDs traceable to test IDs (45/45 rows; 12 spot-checked, all HOLD)
- [x] Unit + integration + e2e coverage as appropriate (`npm test` 80/80 unit; `verify-ops`/`verify-lifecycle` harness per refuter re-run; live slot2 re-proof by this reviewer)
- [x] Regression suite updated (no regressions in canonical suite)
- [x] No flaky tests introduced (5 `verify.ts` FAILs are deterministic, not flaky — pinned-golden drift, re-run-stable per lane bar #7)
- [ ] Coverage threshold met — CONDITIONAL (see C-QA-01: legacy harness red; C-QA-02: NFR-01 scale unproven)
- [x] Manual exploratory testing done (scoped live re-proof on fresh slot2 instance, torn down)

## Suite health (re-run by this reviewer, never assumed)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, 0 errors |
| `npm test` | **80 passed, 0 failed** (incl. `ttl.test.ts` CDR-02 canaries) |

Prior-harness numbers cited from refuter re-runs (not re-run here): `verify-lifecycle` 123/123, `verify-ops` 124/124. `gitleaks`: not-installed (stated honestly; this reviewer ran no secret scan beyond a 0-hit sentinel grep over the slot2 server log, which is log evidence, not a repo scan).

## Traceability spot-check (12 rows, 5 spec domains — REQ → test → artifact → commit → verdict)

| REQ-ID | Test | Artifact contains the cited code | Commit resolves | Verdict |
|---|---|---|---|---|
| REQ-BRAINY-ENG-04 | `tests/step3.test.ts` (9×1536 hits) | `src/embed.ts:16` `EMBED_DIM = 1536` | `74ec6eb` commit | HOLDS |
| REQ-BRAINY-ENG-05 | `tests/step4.test.ts` | `src/server.ts:390` route; live re-proof: `POST /v1/notes` → 201 (slot2) | `5b40c8e` commit | HOLDS |
| REQ-BRAINY-ENG-06 | `tests/move.test.ts` (12 move hits; `move route: 200 happy path`, AC-06) | `src/server.ts:446` tenant throw; live: move → 200, x-tenant → 400 `invalid_tenant_link` (slot2) | `a1d71c9` commit | HOLDS |
| REQ-BRAINY-ENG-01 | `tests/step1.test.ts` | `bin/agent-memory.mjs:15` `WARN deprecated…` anchor exists | `53f5588` commit | HOLDS |
| REQ-BRAINY-ENG-12 | `tests/step6.test.ts:371-377` 401-without-auth assert | `src/server.ts:367-369` `X-Deprecated` alias; live `/memory/forget` shape proved (slot2) | `af40e87` commit | HOLDS |
| REQ-BRAINY-OPS-01/02 | `tests/step8.test.ts` (slot-math + `R(N) = 3111 + 3(N-1)` asserts) | `bin/brainy.mjs`; `src/store.ts:848` reads `HELIX_URL` only (gap 10 confirmed as reported) | `a1e2e89` commit | HOLDS |
| REQ-BRAINY-OPS-04 | `tests/step8.test.ts` (+216/-22 move repoint) | `bin/brainy.mjs` move repoint | `201b1ee` commit (stat: `bin/brainy.mjs` + tests) | HOLDS |
| REQ-BRAINY-SEC-01/C1 | `tests/step6.test.ts` 401 assert | `src/auth.ts:48` `timingSafeEqual` | `af40e87` commit | HOLDS |
| REQ-BRAINY-SEC-02 | `tests/step7.test.ts` (`unauthorized` asserts) | `src/mcp.ts` `brainy_capture` + `brainy_reality_check` registrations present | `fb9c274` commit | HOLDS |
| REQ-BRAINY-SEC-05/C5 | hook live proof | `hooks/capture.mjs:72` fixed string; live re-proof: stored row exactly `user prompt submitted` (slot2) | `a79643c` commit | HOLDS |
| REQ-BRAINY-LEG-03 | `tests/ttl.test.ts` (17 TTL hits; in 80/80 bar) | `src/lifecycle.ts:144-161` `filterExpired`; live re-proof: canonical-wins silent / alias WARN-once / invalid+absent OFF (slot2) | `5ee1728` commit | HOLDS |
| REQ-BRAINY-LEG-04 | ARCO flow | `src/server.ts:689-693` `/memory/forget`; live: `POST /memory/forget` → `{forgotten:true}` (slot2); `grep -c forgetNote src/server.ts src/mcp.ts` = 0/0 (gap 3 confirmed as reported) | `2232087` commit | HOLDS* (*with gap 3) |

Zero rows where trace is asserted but not demonstrable. All 12 sampled commits `git cat-file -t` = `commit` (full 22-hash set already covered by refuter RF-01).

## Gap dispositions (lane's 10 self-reported gaps → disposition + owner)

| # | Gap | Disposition | Owner |
|---|---|---|---|
| 1 | `verify.ts` 5 FAILs — legacy 384-dim goldens (`verify.ts:249,256-257`) vs 1536-dim impl (`src/embed.ts:16`) | **C-QA-01 must-fix-before-release** (migrate goldens 384→1536; deterministic drift, not a product bug). Blocks R1 "all suites passing" row until green or formally waived | R1 |
| 2 | NFR-01 p95@~10k nodes not-run (lane: p95 8.68ms at N=40 only; `eval.ts` has no scale knob) | **C-QA-02 must-fix-or-waive** (scale harness or explicit waiver with expiry; release bar names 10k nodes) | R1 + orchestrator |
| 3 | `forgetNote` unexposed via REST/MCP (0 callers, verified) — Note-row erasure code-only | **C-QA-03 must-decide** (expose route/tool or record accepted design limit with R4 sign-off; C5 names `forgetNote` as the erasure control) | R1 + R4 |
| 4 | Live 401 matrix with `BRAINY_SECRET` set — no harness, not run | accepted-residual (unit 401 assert + C1 harness proof stand; harness is new-work, next cycle) | R1 |
| 5 | Live MCP stdio handshake not exercised | accepted-residual (unit `isMetaAuthorized` gate asserts stand) | R1 |
| 6 | 1MiB/413 + 15s-timeout live probes not run | accepted-residual (caps exist in code: `server.ts:32,314`, `store.ts:853`; unit zod bounds green) | R1 |
| 7 | README 3 examples not re-executed live | accepted-residual, defer to brand-reviewer | R5 |
| 8 | Brand-debt full-repo grep owned by R5 lane, not re-run here | accepted-residual, defer to brand-reviewer | R5 |
| 9 | Breach drill — doc only | accepted-residual, defer to legal/security reviewers | R4/R2 |
| 10 | `src/store.ts:848` reads `HELIX_URL` only (no `BRAINY_URL` canonical-first; server needed `HELIX_URL=:6977` on slot2 — reproduced by this reviewer) | accepted-residual with fix filed (SPEC-003 REQ-OPS-02 deviation; bootstrap/import already canonical-first; cross-domain request to R1 stands) | R1 |

No gap is understated (gaps 3 and 10 independently re-confirmed; 384-drift structurally confirmed). No undeclared 11th gap found.

## Slot9 live-row decision: RE-PROVED (scoped) + remainder explicitly accepted

The refuter asked QA to re-prove or explicitly accept TEST_MATRIX bar #7–10 + CDR-07 table (slot9 torn down, not re-runnable read-only). This reviewer started its **own** instance (`node bin/brainy.mjs start --slot 2`; Helix 6970, REST 3114; shared `dev` :6969 and ports 3111/3112/3113 never touched, never signaled) and re-proved the gate-blocking subset live:

- **RE-PROVED:** bootstrap `25 indexes ensured` + READY; ENG-05 create → 201; ENG-06 move → 200; C8 unscoped `GET /v1/notes/:id` → 404 + cross-tenant move → 400 `invalid_tenant_link`; ENG-07 distill → new id; ENG-08 export → `project/tags` frontmatter + content only; ARCO memory-forget → `{forgotten:true}`; TTL both-knobs/canonical-silent/alias-WARN-once/invalid+absent-OFF; hook `UserPromptSubmit` → stored row exactly `user prompt submitted` (argv-form invocation; a first probe without `argv[2]` stored nothing — reviewer methodology note, not a product finding); sentinel `s3cr3t-qa-sentinel-7q1m` 0 hits in server log.
- **Explicitly ACCEPTED as recorded** (rationale: structural corroboration exists, full harness re-runs are owning-lane evidence, cost/risk of full re-run outweighs value): bar #7 full 243-run shape (contradiction proven in code: `verify.ts:249` expects 384 vs `EMBED_DIM=1536`; deterministic per lane's ×2 runs); bar #8 eval 1.0000; bar #9 latency numbers; README-example and 401-matrix rows (covered by gap dispositions 4/7).
- Teardown: hook canary forgotten (`{forgotten:true}`), `stop --slot 2` + `helix stop slot2` by name, state removed, `git status` clean (`helix.toml` unmodified — no checkout needed). Synthetic canary Note rows remain in slot2's disk volume (no Note-delete surface = gap 3; no PII content).

## Release-bar ruling (QA seat — engineering rows; other domains cited)

- **R1 Engineering row:** NOT MET as-written → conditional. `npm run typecheck` clean ✓ and canonical suites green ✓, but "all suites passing" fails on `verify.ts` 5 FAILs (C-QA-01) and the p95@10k benchmark is unrun (C-QA-02). Zero-new-deps / lockfile-clean: no evidence to the contrary, defer to automation-reviewer.
- **R8/R5/R4/R2 rows:** no QA objection; QA defers to automation/brand/legal/security reviewers for their verdicts (gaps 7/8/9 recorded as accepted residuals pending their sign-off).

## Findings (severity + location + evidence + owner)

No NEW findings. The three conditions above restate owning-lane evidence, they are not new defects:

- C-QA-01 (High — release-bar blocking): `scripts/verify.ts:249,256-257` pinned 384-dim goldens vs `src/embed.ts:16` 1536-dim. Evidence: code-structural contradiction + lane bar #7 (238/5). Owner R1.
- C-QA-02 (High — release-bar blocking): NFR-01 scale proof absent. Evidence: `scripts/eval.ts` has no scale knob (lane statement, uncontested). Owner R1 + orchestrator.
- C-QA-03 (Medium): Note-row erasure surface missing. Evidence: `grep -c forgetNote src/server.ts src/mcp.ts` = 0/0. Owner R1 + R4.

## Residual risk + owner

- `verify.ts` stays red until C-QA-01 lands — any future harness signal during release is ambiguous until then (owner R1).
- NFR-01 latency at production scale is extrapolated from N=40, not measured (owner R1; waiver or harness per C-QA-02).
- Canary Note rows persist in slot2/slot9 disk volumes until a Note-delete surface exists (synthetic, no PII; owner R1 via C-QA-03).

**Cross-domain requests:** R1 — dispose C-QA-01/02/03 (+ gaps 4/5/6/10); R4 — co-sign C-QA-03; R5 — own gaps 7/8; R2/R4 — own gap 9. No freelance fix performed (review-only; single whitelisted file committed).
