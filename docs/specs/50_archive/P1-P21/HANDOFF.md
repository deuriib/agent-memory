# Handoff: DoD verifier / orchestrator

**Spec Reference:** P1-P21 (lane P1 + P2.1 — agent-memory v0.4.0)
**Agent:** DoD verifier / handoff producer (verify-handoff stage, independent auditor — did not author the work)
**Date:** 2026-09-23
**Status:** complete
**Domains-Touched:** engineering, security, automation/ops, data lens
(finance / legal / marketing / people / revenue = **N/A** — code+docs lane, no such surface touched)

**Load evidence:** stage skill `/mnt/DATA/GitHub/frame-ship/skills/verify-handoff/SKILL.md` + template `.../references/handoff-template.md` + DoD `.../references/dod-checklist.md` read before acting · execution_mode: `subagents` · packet intact (SPEC: IMPLEMENTATION_PLAN.md + TEST_MATRIX.md + CONTRACT v1.1 / HARD: strict-TS + frozen surface + iii-3111 + Helix-never-restart / GATE: P1-P21 GATE_REPORT.md OPEN 9/9 / DOMAINS: engineering, security, automation/ops, data) — reference-only, no full-context paste.

## Deliverables

| Artifact | Location / Evidence | Status |
|----------|---------------------|--------|
| Implementation | `src/concepts.ts` (b27364b) · `src/lifecycle.ts` (101e063, 45380b5, 9210208) · `src/logline.ts` (83e2f3a) · `src/store.ts` (b27364b, 101e063, 9210208) · `src/search.ts` (45380b5) · `db/queries.ts` (101e063, 45380b5) · `hooks/capture.mjs` (8fbd795) · `plugins/opencode/plugins/agent-memory.ts` (8fbd795, 6f7f708) · `scripts/purge.ts` (45380b5, 9210208, 83e2f3a) | done |
| Tests / Evidence | `scripts/verify.ts` **152/152** (own run, our server `AGENT_MEMORY_PORT=3151`, stopped after) · `verify-lifecycle` **39/39** · `verify-capture` **115/115** · `verify-injection` **73/73 ok, 0 fail** · `verify-env` **21/21** · `scripts/probe3.ts` GREEN (b2/d1/d2/d3/a3-2/(e) present in file; plan/gate run logs) · `npm run typecheck` exit 0 · no-any/no-TODO grep = 0 matches · purge usage-guard exit 2 + dry-run `would-delete=1` (re-run this session) · `bootstrap` 8 indexes · CI workflow `.github/workflows/ci.yml` (verify-lifecycle + verify-capture + secret-scan) | done |
| Docs | `docs/CONTRACT.md` v1.1 · `README.md` (env vars, purge, 7 events, badge) · `CHANGELOG.md` v0.4.0 · `ROADMAP.md` P1.1/P1.3/P1.6/P2.1 ticks · `TEST_MATRIX.md` (T-101…T-108) · `IMPLEMENTATION_PLAN.md` (steps 1–7, gates checked) | done |
| Domain artifact | `docs/specs/50_archive/P1-P21/GATE_REPORT.md` (OPEN) + 9 reviewer artifacts (same dir) + W1/W2 waiver rows + `docs/adr/ADR-0001-application-side-dedup-uniqueness.md` | done |

## Definition of Done Checklist

Template boxes:

- [x] **Acceptance criteria satisfied (all domains)** — plan Quality Gates all `[x]` (`IMPLEMENTATION_PLAN.md` L58–66); gate 9/9 reviewers pass, COND-001..010 cleared (`GATE_REPORT.md` L33–42, L100).
- [x] **Tests/evidence linked per REQ-ID** — C4 run (present AND resolves AND relevant), table below: REQ-P1-3→T-101, REQ-P1-6→T-102, REQ-P1-1→T-103 (+T-107/T-108 tracked), REQ-P2-1→T-104, regression T-105, docs T-106 — **6/6 PASS, 0 FAIL**; no attestation-alone passes.
- [x] **Load evidence present (skill + template paths + mode + packet)** — cited at top of this file; mode `subagents`; packet intact.
- [x] **Domain checks passing (Common + touched appendix)** — full DoD run with per-checkbox evidence in the annex below.
- [x] **Security checks passing (security-touched)** — security-reviewer ✅ pass, SEC-01/02 FIXED-VERIFIED; secret-pattern grep = 0 matches; gitleaks local unavailable → recorded waiver W1 (not silent).
- [x] **Documentation / filing / comms updated** — CONTRACT v1.1, README, CHANGELOG v0.4.0, ROADMAP ticks, TEST_MATRIX, plan; ADR-0001 written (architecture contract v1→v1.1).

C4 REQ→evidence (surgical):

| REQ | Link (present) | Resolves (ran / grepped) | Relevant | Verdict |
|-----|----------------|--------------------------|----------|---------|
| REQ-P1-3 | TEST_MATRIX L13 (T-101), plan L26, CONTRACT §5 L354 | `verify-lifecycle.ts` 39/39 incl. extractConcepts determinism/≤8/stopwords (file L34–82); `verify.ts` D-section derived ≤8 (L356) + graph-branch score == 3/61 (L407–462) | assertions test derivation + graph reachability exactly | **PASS** |
| REQ-P1-6 | TEST_MATRIX L14 (T-102), plan L27, CONTRACT §0 L32–33 + §3 | `probe3.ts` b2/d1/d2/d3/a3-2 present; `store.ts` `withDedupLock` L414 + `findMemoryByDedupKey` pre-check L446 + fail-closed L450/456; `verify.ts` F3 (L467) same id/count-stable/cross-project + race same-id `{false,true}` (L538) + F4 hook first-wins/no-Session-node (L561/604/632) | tests the exact acceptance (one row, existing id) | **PASS** — residual-risk: single-writer cross-process (RL-001, CONTRACT §3, owner: engineering) |
| REQ-P1-1 | TEST_MATRIX L15 (T-103), plan L28, CONTRACT §3/§5 | `verify-lifecycle` half-life golden (L213), TTL boundary/OFF/purity (L251–260), section E render-guard (L297–350); `probe3 (e)` GREEN verdict (L400); `purge.ts` dry-run/exit-2/MAX_BATCHES/progress — usage exit 2 + `would-delete=1` re-run this session | decay math, TTL filter, purge guards each map to a REQ-P1-1 clause | **PASS** |
| REQ-P1-1 (gaps) | TEST_MATRIX L19–20 (T-107/T-108) with owner+expiry; GATE_REPORT tracked L71–72 | rows exist, carry owner `engineering — orchestrator` + expiry `2026-10-31 or v0.5.0` | declared coverage gaps, not claimed as passing evidence | **PASS (tracked)** — residual-risk: route-level TTL/λ-on E2E not harnessed, owner: engineering — orchestrator |
| REQ-P2-1 | TEST_MATRIX L16 (T-104), plan L29, CONTRACT hooks | `capture.mjs` SUPPORTED 7 events (L31–38) + prompt never read (L62–65); plugin `captureToolStart` (L594) + `tool.execute.before` (L939) + `memory*` skip; `verify-capture` 115/115 re-run | events/payload/silence/exit-0/canary all target the REQ | **PASS** |
| T-105 (regression) | TEST_MATRIX L17 | injection **73**, verify **152**, env **21**, typecheck **0** — all re-run green this session; gitleaks → W1 | regression bar = §5 counts | **PASS** (W1 standing condition below) |
| T-106 (docs) | TEST_MATRIX L18 | CONTRACT v1.1 + README env/purge/7-events + CHANGELOG v0.4.0 + ROADMAP 4 ticks + version 0.4.0 lockstep (package.json/lock/mcp.ts L375/plugin L63/badge) + CI L27–28 | each doc claim greps true | **PASS** |

DoD annex — **Common (all 8 domains)**, evidence per box:

- [x] All acceptance criteria met — plan L58–66 all `[x]`; gate OPEN (`GATE_REPORT.md` L4).
- [x] All REQ-IDs have linked evidence (present + resolves + relevant) — C4 table above, 6/6 PASS.
- [x] C4 FAIL lists residual-risk + owner — 0 C4 FAILs; residuals recorded with owner+expiry in `GATE_REPORT.md` L58 + tracked table L68–78 (no silent PASS).
- [x] Edge cases / failure modes handled — fail-closed shape-drift (`store.ts` L450/456), dead-server/negative paths (verify-injection sections F–G, 73/73), purge usage-guard exit 2 + `status=partial` audit line, hook exit-0-always (`capture.mjs`).
- [x] Gate OPEN + conditions cleared + waivers recorded — OPEN; COND-001..010 all cleared (L33–42); W1/W2 pass the three-block bar (L55–56).
- [x] Load evidence (skill + template cited, mode `subagents`, packet intact) — see header.
- [x] Docs/changelog updated for user-facing impact — CHANGELOG v0.4.0, README, CONTRACT v1.1.

**Engineering appendix:**

- [x] Lint passes with zero warnings — **justification: this repo has no linter script** (package.json scripts = typecheck/verify\*/bootstrap/demo/dev/purge only). Lint equivalent run = `tsc --noEmit` (exit 0) + the no-any/no-TODO/no-@ts-ignore grep → **0 matches** (`grep ... src/ db/ scripts/ hooks/ plugins/` exit 1).
- [x] Type checks pass — `npm run typecheck` exit 0, this session.
- [x] Test coverage meets threshold — repo bar = assertion-count suites all green, observed: lifecycle **39/39**, capture **115/115**, injection **73/73** (0 fail), env **21/21**, verify **152/152**.
- [x] No TODO/FIXME left in code — grep exit 1 (code + docs, zero hits).

**Security appendix:**

- [x] Security review conditions met — `security-reviewer.md` ✅ pass; SEC-01 (CWE-117) + SEC-02 FIXED-VERIFIED; COND-004/007 cleared (`GATE_REPORT.md` L36/39).
- [x] No secrets in code/config/logs/examples — secret-pattern grep (sk-/AKIA/ghp_/xox/PEM) = exit 1 no matches across src/db/scripts/hooks/plugins/docs/\*.md; gitleaks local unavailable → **W1** waiver with CI-enforcing compensating control (`.github/` diff `eb279a6..83e2f3a` = 0 lines, verified this session).
- [x] Input validation at all boundaries — zod schemas on every route body, purge arg guard exit 2 (re-run), hook unlisted-event/missing-tool_name stores nothing (fail-closed), bearer auth on governance routes (CONTRACT §3).

**Automation/ops appendix:**

- [x] Workflow tested — CI runs `verify-lifecycle` + `verify-capture` (ci.yml L27–28) + sha256-pinned gitleaks `secret-scan` (L30–51); both local suites re-run green this session.
- [x] Rollback/runbook/monitoring/flags checked — plan "Rollback Points" L43–54 per step; TTL/decay default OFF (flag semantics); purge guards re-verified first-hand (exit 2 usage, dry-run read-only).
- [x] Servers stopped after run — our 3151 server stopped (pid killed, verified: only 3111 iii pid 2465 + Helix 6969 remain); Helix never restarted; upstream never touched.

**Data lens appendix:**

- [x] Lineage/schema/migration/backfill + PII — schema change `dedupKey` documented (CONTRACT §1, hash never leaves store projections); no backfill by design (probe3 a3-2 harmless); DAT-001 (Concept orphans, owner engineering, expiry 2026-10-31/v0.5.0) + DAT-002 (accepted) tracked; PII: prompt-text canary non-stored (verify-capture), hook fixed-string/tool-name only.

**Not-touched domains (explicit N/A):**

- [x] Finance — **N/A**: no budget/controls/audit-trail surface in this code+docs lane (diff = src/db/hooks/plugins/scripts/docs; no finance artifacts touched).
- [x] Legal — **N/A**: no license/SECURITY/regulatory filing surface touched this lane (per `GATE_REPORT.md` L6).
- [x] Marketing — **N/A**: no brand/copy/GTM/external-facing surface in the diff.
- [x] People — **N/A**: no skills/change-plan/comms surface in the diff.
- [x] Revenue — **N/A**: no pipeline/quota/forecast surface in the diff.

**Documentation:**

- [x] API docs updated / domain artifact filed — CONTRACT v1.1 (frozen names unchanged, v1.1 additions documented §0–§3) + README; gate artifacts in agreed location `docs/specs/50_archive/P1-P21/`.
- [x] Changelog entry added — `CHANGELOG.md` `[v0.4.0] — 2026-09-23`.
- [x] ADR written (architecture contract changed) — `docs/adr/ADR-0001-application-side-dedup-uniqueness.md` (CONTRACT v1→v1.1, probe3 b2/d1/d2/d3 evidence).

## Blockers / Open Questions

1. **W1 — first CI secret-scan green at/after `9210208` is a PRE-MERGE condition** (gitleaks local run unavailable: 2× download timeout, escalated; local binary absent — confirmed this session). Owner: **orchestrator**. Compensating control = sha256-pinned gitleaks `secret-scan` CI job (untouched by lane: `.github/` diff `eb279a6..83e2f3a` = 0 lines, verified). Do not merge before that run is green.
2. Tracked findings (non-blocking, owner + expiry each) → `GATE_REPORT.md` "Tracked findings" table L68–78: DAT-001, T-107, T-108, SEC-03, SEC-04, RL-004/007, hygiene rows (DAT-002 accepted; gitleaks local rerun).
3. W2 (purge no Helix timeout) — accepted risk with compensating controls, re-review at v0.5.0 or 2026-12-22, owner: engineering (`GATE_REPORT.md` L56). Not blocking.
4. New this audit: none — no C4 FAIL, no missing/dead/irrelevant link, no new finding beyond the gate's own tracked table.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens/credentials in this HANDOFF and ADR — allowlisted evidence only (suite counts, commit SHAs, file paths, verdicts, owners/expiries). No user content, prompt text, memory content, or secret values reproduced anywhere in either artifact.

## Next Agent

`frame-ship:ship-release` — version **0.4.0** lockstep already done (package.json, lockfile, `src/mcp.ts` L375, plugin `VERSION` L63, README badge) and the CHANGELOG v0.4.0 entry exists. What they need:

- Gate report (OPEN, 9/9, COND 10/10, W1/W2 pass): `docs/specs/50_archive/P1-P21/GATE_REPORT.md`.
- This handoff: `docs/specs/50_archive/P1-P21/HANDOFF.md`.
- Release-notes draft + per-step rollback points live in `IMPLEMENTATION_PLAN.md` (Rollback Points L43–54).
- **Confirm W1 on push:** first CI `secret-scan` green at/after `9210208` before merge (owner: orchestrator).
- ADR-0001 filed for the contract change: `docs/adr/ADR-0001-application-side-dedup-uniqueness.md`.
