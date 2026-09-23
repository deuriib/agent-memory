# Quality Gate Report: P1-P21 (lane P1 + P2.1 — agent-memory v0.4.0)

**Date:** 2026-09-23
**Gate Status:** OPEN (all ✅ after 3 remediation rounds — handoff to `frame-ship:verify-handoff` cleared)
**Domains Touched:** engineering, security, automation/ops (+ data cross-cutting lens — schema change `dedupKey`, derived hash store, PII-adjacent hook observations).
Finance / legal / marketing / people / revenue: **N/A** — no legal surface (license/SECURITY untouched this lane), no brand/people/revenue/finance content in the diff; deleted from the table per template rule.

**Spec (reference-only packet):** `IMPLEMENTATION_PLAN.md` (steps 1–7) + `TEST_MATRIX.md` (T-101…T-108) + `docs/CONTRACT.md` v1.1.
**Reviewed range:** `1c410ee..HEAD` = `b27364b` (REQ-P1-3) → `101e063` (REQ-P1-6) → `45380b5` (REQ-P1-1) → `8fbd795` (REQ-P2-1) → `6f7f708` (v0.4.0 lockstep + CI) → `eb279a6` (contract v1.1 docs) → `9210208` (remediation R1) → `83e2f3a` (remediation R2) → this commit (orchestrator doc-truth cells).

## Reviewer Verdicts

Strictly 1 dedicated subagent per reviewer, zero bundled reviews. 9 reviewers dispatched by the orchestrator; remediation executed by separate specialist subagents (never reviewers re-fixing their own findings — each CONDITIONAL was re-verified by its OWN independent reviewer session).

| Domain | Reviewer (actual agent) | Verdict | Findings (raised → open) | Rounds | Artifact |
|---|---|---|---|---|---|
| engineering | review-readability | ✅ pass | 8 (all Low) → 0 blocking, 8 hygiene tracked | 1 | `review-readability.md` |
| engineering | review-reliability | ✅ pass | 5 (2 Med) → both Med cleared (RL-001/RL-002); 2 Low + 1 Info tracked | 2 | `review-reliability.md` |
| engineering | review-refuter | ✅ pass | 26 attacks: 22 survived / 5 CE refuted + NEW-001…005 → **all closed** | 5 | `review-refuter.md` |
| engineering | review-resilience | ✅ pass | 5 (1 Med F1) → F1 cleared (fail-closed shape-drift); 4 Low tracked | 1 + F1 fix verify | `review-resilience.md` |
| engineering | review-risk | ✅ pass | risk register 10 (0 Critical/High unmitigated); RK-009 → waiver row below | 1 | `review-risk.md` |
| engineering | quality-assurance | ✅ pass | 11 dispositioned (7 resolved, 3 accepted-tracked, 2 Low backlog) → 0 open conditions | 3 | `quality-assurance.md` |
| data lens | review-data | ✅ pass | 2 (DAT-001 Med tracked, DAT-002 accepted) + 3 referrals | 1 | `review-data.md` |
| security | security-reviewer | ✅ pass | 2 (SEC-01 Med CWE-117, SEC-02 Low) → both FIXED-VERIFIED; SEC-03/04 Low backlog | 3 | `security-reviewer.md` |
| automation/ops | automation-reviewer | ✅ pass | 4 (OPS-001 Med) → FIXED-VERIFIED (live mid-run proof); gitleaks → waiver row below | 2 | `automation-reviewer.md` |

All artifacts live beside this report: `docs/specs/50_archive/P1-P21/`.

## Conditions for Opening

Every round-1 CONDITIONAL condition, in order. All cleared by fix + re-verification by the SAME reviewer that raised it.

- [x] COND-001 (reliability RL-001): single-writer-process dedup assumption documented — `docs/CONTRACT.md` §3 "Single-writer assumption" (residual risk + owner: engineering) → cleared in `9210208` → reviewer round 2 **PASS**.
- [x] COND-002 (reliability RL-002): purge Helix timeout — SDK independently proven to expose NO Client/transport timeout nor AbortSignal (`.d.ts` sweep); accepted-risk record in `scripts/purge.ts` header + contract §3 with compensating controls (fail-closed args, batch bounds, per-batch `purge-progress`, operator Ctrl-C) → `9210208` → **PASS** (record path explicitly permitted by the reviewer; see waiver row W2).
- [x] COND-003 (refuter CE-001 + CE-002): dedup × hook first-wins interaction pinned as declared contract — new `verify.ts` F4 section (+21 assertions: S1 novel → `deduped:false`; S2 same content → same id, count stable, **no Session node for S2**; cross-project → new row) + `sessionMemories` echo-vs-membership + lesson origin first-wins documented in contract §3 → `9210208` → CE-001 *survived-as-declared*, CE-002 REFUTED in rounds 2–3; QA confirmed F4 non-vacuous.
- [x] COND-004 (refuter CE-003 + security SEC-P121-01): CWE-117 newline forgery in purge governance/audit lines — `oneLine()` print-side normalizer (same transform as P3.1 delete guard) at every render site, query values verbatim → `9210208` → refuter round 2 REFUTED (forgery repro now 1 line), security round 2 FIXED-VERIFIED (14 render sites + full line-terminator set).
- [x] COND-005 (refuter CE-004/CE-005 + security SEC-02): falsified `contentHash` docstring rewritten to the provable precondition (normalize strips newlines from text → last-`\n` split unique); TEST_MATRIX T-102 no longer claims a nonexistent `unique_constraint_violation` catch, T-103 no longer cites a nonexistent `verify.ts` TTL E2E → `9210208` → both REFUTED/MET.
- [x] COND-006 (automation OPS-001): purge failure-path audit — module-scope `audit` cursor + allowlisted `… status=partial` line before exit 1 whenever deletions happened, plus per-batch `purge-progress` → `9210208` → reviewer round 2 FIXED-VERIFIED (live mid-run failure proof: `deleted=1 … status=partial`, exit 1; dead-Helix → no spurious line).
- [x] COND-007 (security C-1): the render-guard regression assertion committed as a CI test — `oneLine` extracted verbatim to `src/logline.ts`, `verify-lifecycle` section E (+5 checks: collapse, no `\n`/`\r` in output, idempotency, non-corruption, typed inputs; no NEL assertions) → `83e2f3a` → reviewer round 3 **PASS**.
- [x] COND-008 (QA C-R2 + refuter NEW-001/NEW-002): doc-truth cells — plan step 2/3 cells tell shipped reality, CHANGELOG `102 → 131 → 152`, ROADMAP P2.1 first-wins qualified, T-105 range + `AGENT_MEMORY_URL` corrected → `83e2f3a` → QA round 3 **PASS**, refuter round 3 closed both.
- [x] COND-009 (QA owner+expiry): T-107/T-108 tracked gaps now carry `(owner: engineering — orchestrator; expiry: 2026-10-31 or v0.5.0 release, whichever first)` → `83e2f3a` → QA round 3 **ACCEPTED**.
- [x] COND-010 (refuter NEW-003 + NEW-004 + NEW-005): false-pointer class "lifecycle sections attributed to `verify.ts`" — plan L62 + README L505 one-cell fixes + `dedayImportance` → `decayedImportance` typo, closed by SYSTEMATIC class sweep (grep across all six docs → 0 instances) → orchestrator, this commit → refuter round 5 **PASS, class extinct (N=0)**.

## C3 — CONDITIONAL/waiver review record (surgical, security-owned)

> Three-block bar per `waiver-template.md`: `Accepted-risk` + `Compensating-controls + owner` + `Expiry/Re-review + owner`. Missing block = FAIL.

| # | CONDITIONAL / waiver | Disposition | Accepted-risk | Compensating-controls + owner | Expiry + re-review owner | Verdict |
|---|---|---|---|---|---|---|
| R1 | reliability (round 1) | cleared by fix `9210208` (COND-001/002) + re-verdict PASS | pass (W2 covers its accepted-risk) | pass — contract §3 record, engineering | pass — W2 expiry covers | PASS |
| R2 | refuter (round 1) | cleared by fix `9210208` + F4 pin + rounds 2–5 re-verdict PASS | n/a — fixed, not waived | pass — F4 + contract §3 declaration | n/a | PASS |
| R3 | security (round 1) | cleared by fix `9210208` + test `83e2f3a` + re-verdict PASS | n/a — fixed, not waived | pass — oneLine + section E in CI | n/a | PASS |
| R4 | automation (round 1) | cleared by fix `9210208` + re-verdict PASS | n/a — fixed, not waived | pass — partial-audit line + progress | n/a | PASS |
| R5 | quality-assurance (round 1) | cleared by `83e2f3a` + orchestrator cells + re-verdict PASS | n/a — fixed, not waived | pass — matrix truth + owner/expiry | n/a | PASS |
| **W1** | **gitleaks local run unavailable** (2× download timeout, escalated; risk RK-009) | accepted risk, standing condition on merge | pass — local secret scan impossible this session; manual reviewer diff scans found zero secret-like material | pass — CI P0.2 sha256-pinned gitleaks `secret-scan` job (untouched by this lane: 0-line `.github/` diff across `eb279a6..83e2f3a`), owner: orchestrator (engineering) | pass — **pre-merge condition: first CI secret-scan green at/after `9210208`**; expiry: first push after this lane; re-review owner: orchestrator | PASS |
| **W2** | **purge has no Helix request timeout** (RL-002 — SDK exposes none, proven) | accepted risk recorded in `scripts/purge.ts` header + contract §3 | pass — no SDK API exists; ops script run by a human | pass — fail-closed arg guard, `BATCH_LIMIT`/`MAX_BATCHES`/no-progress bounds, per-batch `purge-progress` output, operator Ctrl-C; owner: engineering | pass — re-review at next release (v0.5.0) or 2026-12-22, whichever first; re-review owner: engineering | PASS |

> **W1 condition SATISFIED (2026-09-23):** first CI `secret-scan` green
> at/after `9210208` = run `35830679212` at commit `69a9a8d` (job success).
> The 2 findings it caught on the first run were reviewed fingerprint-scoped
> false positives (dedup golden test vectors; recomputation proof in
> `69a9a8d` commit body, suppressions in `.gitleaksignore`). The tag run
> `35829774892` failure = the pre-review tree — tag left immutable.

**Residual-risk:** application-side dedup is sound only within ONE writer process (multi-instance out of contract — ROADMAP P4.3 future), owner: engineering; Concept-node orphans on forget (DAT-001) — owner: engineering, expiry 2026-10-31/v0.5.0; NEL/ESC residual in `oneLine` (SEC-03) — owner: engineering, next security pass with the P3.1 server guard. Explicit, not silent: APPROVE+conditions without these records would be FAIL.

**Substance backstop:** no box-tick is vacuous — W1/W2 name concrete evidence (`.d.ts` sweep, 0-line `.github/` diff, live guard re-runs); cleared conditions cite commit SHA + the raising reviewer's own re-verdict.

### PII checkpoint (Ley 172-13 co-sign)

Zero PII/secrets/tokens in every gate artifact, prompt, log and export: evidence is allowlisted (counts, SHAs, paths, verdicts); prompt-text privacy canary asserted non-stored in `verify-capture` (115/115); dedupKey never leaves store projections; hook observations fixed-string/tool-name only; no user content in any `P1-P21/` file. Wide disclosure: none.

## Tracked findings (non-blocking — owner + expiry)

| ID | Severity | Finding | Owner | Expiry |
|---|---|---|---|---|
| DAT-001 | Medium | Concept nodes orphaned on forget/purge (no deletion procedure/TTL for the derived Concept store; Ley 172-13 right-to-erasure adjacent — pre-existing, amplified by auto-derivation) | engineering | 2026-10-31 or v0.5.0, whichever first (bundle with P1.2 consolidation, which touches concepts) |
| T-107 | Medium (coverage) | Route-level `ttl: hidden N expired rows` signal E2E needs a server-env harness | engineering — orchestrator | 2026-10-31 or v0.5.0, whichever first |
| T-108 | Medium (coverage) | Fused-order flip under `AGENT_MEMORY_DECAY_LAMBDA>0` route-level E2E (same harness) | engineering — orchestrator | 2026-10-31 or v0.5.0, whichever first |
| SEC-03 | Low | `oneLine` `\s+` leaves U+0085/ESC (NEL → 2 lines under Python `splitlines`) — same residual exists in the P3.1 server guard; harden both together | engineering (security domain) | next security pass, ≤ 2026-10-31 |
| SEC-04 | Low | No CI assertion ties purge render SITES to the guard (function pinned in section E; a future raw `console.*` would pass green) — ~20-line static check (`verify-injection` source-scan precedent) | engineering | 2026-10-31 or v0.5.0, whichever first |
| RL-004 / RL-007 | Low / Info | TTL filter after limit (may thin below `limit`); call-site `send()` timeout wrapper technically reachable despite no SDK option | engineering | v0.5.0 |
| OPS-002 / AUT-002 / readability 8 / resilience 4 | Low | Hygiene: `purge failed:` echoes server error text (documented channel, no content); readability/resilience Low notes | engineering | backlog — v0.5.0 |
| DAT-002 | Low (accepted) | Unsalted content-derived `dedupKey` allows equality-confirmation — zero marginal disclosure (plaintext content sits in the same node; key never projected) | engineering | re-review only if content ever leaves store projections |
| gitleaks local rerun | hygiene | Re-run gitleaks locally when network allows (CI remains enforcing gate) | orchestrator | next release |

## Load Evidence (HARD STOP — all checked)

- [x] Stage skill loaded: `skill(frame-ship:quality-gate)` cited (trigger: after execute-spec completed).
- [x] Domain owner/specialist role understood: orchestrator as gate dispatcher; engineering/security/automation/data roles cited per dispatch; owning domain = engineering as gate keeper.
- [x] Execution mode declared: `subagents` — 9 dedicated reviewer subagents (strictly 1:1, read orders in prompt), remediation by separate non-reviewer specialists.
- [x] Reviewer independence verified: zero bundled reviews; each CONDITIONAL re-verified only by its own original reviewer session; remediation specialists never touched reviewer artifacts.
- [x] Packet intact: `SPEC:IMPLEMENTATION_PLAN.md#steps / TEST_MATRIX.md / CONTRACT v1.1` + `HARD:strict-TS, frozen surface, iii/3111 invariant, Helix-never-restart` + `GATE:suite counts (typecheck 0 → verify 152, lifecycle 39, capture 115, injection 73, env 21, probe3 GREEN, purge guards, demo OK)` + `DOM AHINS:engineering,security,automation/ops,data` — reference-only, no full-context paste.

## Escalations / process notes

- **Conflicting verdicts requiring owner arbitration: none.** All five round-1 CONDITIONALs converged to PASS after fix + same-reviewer re-verification.
- Process: 3 remediation rounds (`9210208` behavioral, `83e2f3a` docs-truth + render-guard test, orchestrator two-cell doc fixes in this commit). Declared deviations accepted by the orchestrator: (R2-wave) ROADMAP stale count ripple + render-guard mention additions (doc truth), stage-skill re-load omission inside an executing remediation packet (dispatch/approval upstream — no ceremony without verification value). Refuter round-5 scope cap agreed in-prompt: further Low doc discoveries beyond the bounded class → tracked, not conditions (NEW-005 was fixed immediately instead of parked).
- Environment invariants held all gate: upstream `iii`/3111 untouched (pid 2465), Helix/6969 never restarted, servers only on `AGENT_MEMORY_PORT=3151` and stopped after each run, probe writes isolated to random/`probe-*` projects.

## Final evidence (as of this commit)

`typecheck` 0 · `verify` **152/152** (our server, `AGENT_MEMORY_URL=http://127.0.0.1:3151`) · `verify-lifecycle` **39/39** · `verify-capture` **115/115** · `verify-injection` 73 · `verify-env` 21/21 · `bootstrap` 8 indexes · `probe3` GREEN · `purge` dry-run `would-delete=1` + usage guards exit 2 + single-line render proof · `demo` OK · gitleaks → W1 (CI enforcing on push).

## Sign-off

- [x] All reviewers pass or conditions met — **9/9 ✅, 10/10 conditions cleared, 2/2 waivers pass the three-block bar.**
- [x] Gate Keeper: owning domain owner — engineering (orchestrator of record; reviewer independence preserved: verdicts authored only by the 9 dedicated reviewer subagents).
- [x] Final authority (waivers W1/W2): domain owner + orchestrator — recorded above with residual-risk, owner and expiry.
