# Quality Gate Report: P0 (publishable foundations) — agent-memory

**Date:** 2026-09-22
**Gate Status:** CONDITIONAL (was CLOSED at first record; moved after W1..W6
approval + COND-02..09 remediation — only COND-01 and the scoped recheck
remain before OPEN)
**Domains Touched:** engineering, security, legal, automation/ops

> Data lens skipped — recorded assumption, not silence: P0 changes no schema, no
> lineage, no PII surface (LICENSE / CI / governance docs / persistence / env
> migration / port ownership). The PII checkpoint still co-signs every waiver
> row below (C3).

## Reviewer Verdicts

| Domain | Reviewer (actual agent) | Verdict | Findings | Artifact |
| --- | --- | --- | --- | --- |
| engineering | review-readability | ⚠️ conditional | 6 (2 Medium) | `review-readability.md` |
| engineering | review-reliability | ⚠️ conditional | 6 (2 Medium) | `review-reliability.md` |
| engineering | review-refuter | ❌ counterexample found | 9 (1 High: CE-01; 5 Medium) | `review-refuter.md` |
| engineering | review-risk | ⚠️ conditional | 10 + PASS row RK-000 (4 Medium) | `review-risk.md` |
| engineering | review-resilience | ⚠️ conditional | 11 (1 Medium: RS-011) | `review-resilience.md` |
| engineering | quality-assurance | ❌ fail | 8 (1 High: QA-01; 5 Medium) | `quality-assurance.md` |
| security | security-reviewer | ⚠️ conditional pass | 8 (2 Medium) | `security-reviewer.md` |
| legal | legal-reviewer | ⚠️ conditional | 8 (1 Medium: LGL-001) | `legal-reviewer.md` |
| automation/ops | automation-reviewer | ⚠️ conditional | 12 (2 Medium) | `automation-reviewer.md` |

(Finance, marketing/brand, people, revenue rows deleted — not touched.)

**Totals:** Critical 0 · High 2 (QA-01 ≡ CE-01 — same root: unpushed CI) ·
Medium ~24 (COND-01..15 below) · Low ~50 → backlog per severity guardrail
(none release-blocking).

**Execution:** 9 dedicated subagents, strictly 1 reviewer each, zero bundled
reviews; wave 1 = 8 reviewers, wave 2 = quality-assurance strictly after
review-refuter (ordering rule). Retries: refuter + risk re-dispatched after
interruption, quality-assurance after cancellation — all 9 deliverables
complete. Remediation of COND-02..09 executed by one dedicated docs
subagent, reviewed line-by-line by the orchestrator before commit.

**Mechanisms green:** the refuter could NOT refute REQ-P0-1/3/5/6; risk
traced the never-kill process surface clean (every `.kill()` targets only
self-spawned children; repo-wide grep `pkill|pgrep|killall|process.kill` = 0);
security found no Critical/High; `typecheck` + `verify-injection` 73/73 green
reproduced by multiple reviewers; CI genuinely ran (see Escalations).

## Why it was CLOSED (first record) — and what moved it

Skill rule: any ❌ → CLOSED. Two ❌ verdicts — one shared root plus evidence
citation defects, all evidence-integrity, none in shipped mechanisms:

1. **CE-01/QA-01 (High):** ROADMAP P0-2 tick + T-002 `pass` claimed "green on
   `main`" while the workflow existed only in unpushed local commits
   (`origin/main = 069e1cf`, no `ci.yml`, zero workflow runs).
2. Evidence-citation defects (70→73, stale commit count, evidence-less
   actionlint/canary numbers).

**Moved to CONDITIONAL on 2026-09-22** because: citation defects fixed and
committed; COND-02..09 docs remediated and committed; W1..W6 approved and
recorded; COND-01's decision (branch + PR) executed — PR **#1** open with
green checks.

## Remediation ledger (updated 2026-09-22)

| Finding(s) | Action | State |
| --- | --- | --- |
| CE-02 / QA-02 (70 → 73 assertions) | `IMPLEMENTATION_PLAN.md` + `ROADMAP.md:44` corrected; reproduced by all reviewers | ✅ fixed (commit `5687135`) |
| CE-03 / QA-03 (stale "24 commits") | gitleaks basis re-cited: 25 scanned / 26 in history | ✅ fixed (`5687135`) |
| QA-05 (actionlint evidence-less) | `evidence/actionlint.log` — reproducible cmd, exit 0 | ✅ fixed (`5687135`) |
| QA-04 (canary single-source) | `evidence/p0-4-restart-canary.log` — token found first attempt post-restart, `storage: disk` both sides | ✅ fixed (`5687135`) |
| CE-01 / QA-01 (green-on-main, **High**) | owner decision: branch + PR → **PR #1**, both CI jobs SUCCESS | ⏳ closes on merge + re-cite (COND-01) |
| COND-02..09 (docs Mediums) | dedicated docs subagent, orchestrator-reviewed diff: ROADMAP parity + P0-6 title, README persistence/traps/reroute/durability/limitation #6, SECURITY scope/secrets/guard-open, CONTRIBUTING types/scripts (+ same-defect dev-setup coherence edit), TEST_MATRIX T-006 | ✅ fixed (this PR) |
| COND-10..15 (accepted-risk Mediums) | W1..W6 approved by repo owner; full three-block text in `WAIVERS-P0.md` | ✅ waived (`6e5e153`) |

## Conditions for Opening

Docs/evidence fixes:

- [ ] **COND-01** (refuter CE-01 + QA-01, **High**): resolve "green on `main`" — **PR #1 open** (<https://github.com/deuriib/agent-memory/pull/1>), branch `feat/p0-publishable-foundations`, run 35780360945 green (`verify` + `secret-scan` SUCCESS). Closes when: final-tree run green → merge → post-merge re-cite of ROADMAP P0-2 + T-002 with the main run URL → scoped recheck by review-refuter + quality-assurance.
- [x] **COND-02** (RD-001): ROADMAP §1.1 parity table refreshed to post-P0 reality (Tests/CI, Governance, Persistence rows; incompleteness honestly retained where true).
- [x] **COND-03** (RD-002 + CE-05): README `:85` + limitation #2 rewritten flag-independent (the `storage = "disk"` key decides); limitation #6 updated to the durable default. Coherence edit applied to CONTRIBUTING's identical dev-setup sentence (same defect, same lane).
- [x] **COND-04** (RD-005, RD-006): CONTRIBUTING types/scopes now match `git log`; script inventory + per-PR bar added; ROADMAP P0-6 title → `3111` default / `3151` reroute.
- [x] **COND-05** (SEC-001): SECURITY.md scope now covers the Antigravity plugin hooks and the OpenCode plugin options surface.
- [x] **COND-06** (SEC-002): SECURITY.md secrets policy states real precedence (servers = env only; plugin accepts `secret` option, prefer env, never commit it).
- [x] **COND-07** (RK-001): SECURITY.md documents guard-open default (+ 127.0.0.1 compensating control) and the `AGENT_MEMORY_HOST` override caveat.
- [x] **COND-08** (RK-002): README migration traps — split-brain dual-spell (silent new-wins, stale legacy 401s) + set-exactly-one-spelling guidance.
- [x] **COND-09** (RS-011 + CE-07 + QA-07): README **Durability & recovery** note (host reboot = manual `helix start dev`, symptom-free failure, check `helix status`); reroute section states clients must set `AGENT_MEMORY_URL` explicitly; T-006 citation corrected to section C.

Waiver-bound (approved):

- [x] **COND-10** (LGL-001/LGL-002) → **W1** approved — `WAIVERS-P0.md`.
- [x] **COND-11** (AUT-001 + CE-08) → **W2** approved.
- [x] **COND-12** (OPS-003 + RK-004 + CE-06/RL-002) → **W3** approved.
- [x] **COND-13** (RK-003 + CE-09) → **W4** approved.
- [x] **COND-14** (QA-06 + coverage gaps) → **W5** approved.
- [x] **COND-15** (RL-001 + CE-04) → **W6** approved (README never-empty guidance shipped in the COND-08 batch as its compensating control).

Low findings (~50) → backlog per severity guardrail (owner: orchestrator
triage); notable candidates: RD-003 hint-wording overstatement, README:92
script list omits `verify-env` (incomplete, not false).

## C3 — CONDITIONAL/waiver review record (surgical, security-owned)

> Every CONDITIONAL/waiver challenged against the normative three-block bar in
> `references/waiver-template.md`. Missing block = FAIL, no promotion. Full
> waiver text: `WAIVERS-P0.md` (same directory), approved 2026-09-22.

| Waiver / CONDITIONAL | Accepted-risk | Compensating-controls + owner | Expiry + re-review owner | Verdict |
|---|---|---|---|---|
| W1 (LGL-001/002) | pass — P0 CI scope = secret scan; manual 248-pkg license scan (zero copyleft) at `legal-reviewer.md` LGL-004 | pass — lockfile pinning + manual scan + gitleaks; owner: legal/orchestrator | pass — 2026-12-21 or P1 close; re-review: legal owner | **PASS (approved)** |
| W2 (AUT-001/CE-08) | pass — CI gating of verify-env outside P0 acceptance as written | pass — VERIFY PASS 21/21 recorded + CONTRIBUTING per-PR bar now names it; owner: engineering | pass — 2026-12-21 / P1; re-review: engineering owner | **PASS (approved)** |
| W3 (OPS-003/RK-004/CE-06) | pass — no backup/DR automation; advisory can false-negative | pass — README *Durability & recovery* (COND-09) + `helix status` `storage: disk` + canary artifact; owner: ops | pass — 2026-12-21 / P4-open; re-review: ops owner | **PASS (approved)** |
| W4 (RK-003/CE-09) | pass — same-origin checksum guards corruption not compromise; tag pins | pass — sha256 step wired + tags verified + independent docker scan evidence; owner: security | pass — 2026-12-21 / P1 (literal sha256 + action SHAs); re-review: security owner | **PASS (approved)** |
| W5 (QA-06 + G-*) | pass — precedence/bootstrap/hint tests absent (code requires proposal) | pass — verify-injection 73/73 + verify-env 21/21 + 9-reviewer manual traces; owner: engineering | pass — 2026-12-21 / P1; re-review: engineering owner | **PASS (approved)** |
| W6 (RL-001/CE-04) | pass — empty-new-name divergence, hooks vs server | pass — README never-empty + split-brain guidance shipped (COND-08 batch); owner: engineering | pass — 2026-12-21 / P1 unify via proposal lane; re-review: engineering owner | **PASS (approved)** |
| COND-02..09 (docs fixes) | none — remediated by fix, never waived | docs diffs, orchestrator line-review, scoped reviewer recheck pending; owner: orchestrator | n/a — closed by fix evidence (this PR) | **FIXED** |
| COND-01 (High) | none — escalated, no waiver below owner authority | PR #1 with green CI; post-merge re-cite + scoped recheck; owner: repo owner/orchestrator | closes on first green `main` run | **PENDING MERGE** |

**Residual-risk:** unpushed-to-main until PR #1 merges (owner: repo owner);
six approved waivers W1..W6 with 90-day / P1–P4 expiries (owners per row);
all Low findings to roadmap backlog (owner: orchestrator triage). No silent
PASS: every row carries substance above.

**PII checkpoint (REQ-SEC-003/004 + REQ-P-006 co-sign):** zero
PII/secrets/tokens/credentials/sessions in any review, waiver, or evidence
artifact. Evidence files contain run logs only; the canary token is a random
non-secret probe string. Declared use: purpose = gate evidence; TTL = repo
history; deletion = history rewrite on request. Allowlisted fields only
(Ley 172-13 minimization).

## Load Evidence (HARD STOP — missing = CLOSED)

- [x] Stage skill loaded: `skill(quality-gate)` — trigger match: "implementation ready for review"; `skill(pull-request)` loaded before branch/PR actions.
- [x] Domain owner/specialist role understood: engineering (7 reviewers), security, legal, automation/ops dispatched as distinct roles; docs remediation by one dedicated subagent (1 = 1), orchestrator-reviewed.
- [x] Execution mode declared: `subagents` — wave 1 (8 reviewers), wave 2 (QA after refuter), remediation lane (1 docs subagent).
- [x] Reviewer independence verified: strictly 1 dedicated subagent per reviewer — 9/9, zero bundled reviews across domains or wave criteria.
- [x] Packet intact: every dispatch carried `SPEC:<paths>#REQ-P0-1..6 / HARD:<AGENTS.md: never-kill, no-secrets/PII-in-logs> / GATE:<TEST_MATRIX + plan gates> / DOMAINS:<list>` by reference — no full-context paste.

## Escalations

- **COND-01 (High; refuter + QA concur):** escalated to repo owner → decided
  branch + PR. Executed: **PR #1** open, both CI jobs SUCCESS
  (<https://github.com/deuriib/agent-memory/pull/1>, run 35780360945).
  Remaining: merge after final green → post-merge re-cite → scoped recheck
  (refuter `ses_f3568d6baffeUe4…`, QA `ses_f354c71c1ffee8a…`).
- Conflicting-verdict note: refuter RF-f1 found the persistence basis (Helix
  docs: `--persist` … "future runs reuse them") while CE-05 showed README
  self-negation — merged into COND-03 (wording), resolved; not a mechanism
  dispute.
- Data-lens skip recorded in header as an explicit assumption.
- Retry ledger: refuter + risk re-dispatched after interruption; QA after
  cancellation — all final deliverables complete.
- Post-push plan guard: merge strategy = **merge commit** (not squash/rebase)
  so the commit SHAs cited across TEST_MATRIX, the plan, and all nine reviews
  stay reachable (assumption stated to owner in PR body context).

## Sign-off

- [ ] All reviewers pass or conditions met — **CONDITIONAL: COND-01 open (merge + re-cite + recheck)**
- [ ] Gate Keeper: owning domain owner (engineering) — after COND-01 clears
- [ ] Final authority (if waived): domain owners + orchestrator — **W1..W6 approved 2026-09-22**

**State machine:** CLOSED → *(W1..W6 approval + COND-02..09 fixes, both done)*
→ **CONDITIONAL (now)** → *(PR #1 merge + green main re-cite + scoped
recheck by review-refuter & quality-assurance)* → OPEN → `verify-handoff`.
