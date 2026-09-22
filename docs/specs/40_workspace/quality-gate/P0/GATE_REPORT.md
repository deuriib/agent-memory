# Quality Gate Report: P0 (publishable foundations) — agent-memory

**Date:** 2026-09-22
**Gate Status:** CLOSED
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
Medium ~24 (enumerated as COND-01..15 below) · Low ~50 → backlog per severity
guardrail (none release-blocking).

**Execution:** 9 dedicated subagents, strictly 1 reviewer each, zero bundled
reviews; wave 1 = 8 reviewers, wave 2 = quality-assurance strictly after
review-refuter (ordering rule). Retries: refuter + risk re-dispatched after
interruption, quality-assurance after cancellation — all 9 deliverables
complete.

**Mechanisms green:** the refuter could NOT refute REQ-P0-1/3/5/6 (license,
governance docs, env migration, port ownership all withstand falsification);
risk traced the never-kill process surface clean (every `.kill()` targets only
self-spawned children; repo-wide grep `pkill|pgrep|killall|process.kill` = 0);
security found no Critical/High; `typecheck` + `verify-injection` 73/73 green
reproduced by multiple reviewers.

## Why CLOSED

Skill rule: any ❌ → CLOSED. Two ❌ verdicts — one shared root plus evidence
citation defects, all on the evidence-integrity side, none in shipped
mechanisms:

1. **CE-01/QA-01 (High):** ROADMAP P0-2 ✅ tick + T-002 `pass` claimed "green
   on `main`" while the workflow exists only in 6 unpushed local commits
   (`origin/main = 069e1cf` has no `ci.yml`; GitHub Actions: zero workflow
   runs). Local equivalents are green (reproduced); the acceptance is not
   reachable without a push.
2. Evidence-citation defects (70→73, stale commit count, evidence-less
   actionlint/canary numbers) — all remediated this date (ledger below).

## Remediation ledger (updated 2026-09-22)

| Finding(s) | Action | State |
| --- | --- | --- |
| CE-02 / QA-02 (70 → 73 assertions) | `IMPLEMENTATION_PLAN.md` gate + `ROADMAP.md:44` corrected to 73; reproduced by all reviewers | ✅ fixed |
| CE-03 / QA-03 (stale "24 commits") | gitleaks basis re-cited: 25 scanned / 26 in history | ✅ fixed |
| QA-05 (actionlint evidence-less) | artifact captured: `evidence/actionlint.log` (reproducible cmd, exit 0) | ✅ fixed |
| QA-04 (canary single-source) | artifact-backed rerun: `evidence/p0-4-restart-canary.log` — token `p04canary1790108269` found on first post-restart attempt, `storage: disk` both sides | ✅ fixed |
| CE-01 / QA-01 (green-on-main, High) | escalated — push decision (Escalations) | ⏳ COND-01 |
| docs Mediums | COND-02..COND-09 (below) | ⏳ pending |
| accepted-risk Mediums | waivers W1..W6 (below), approval pending | ⏳ pending |

## Conditions for Opening

Docs/evidence fixes (in-scope remediation of approved deliverables; no code):

- [ ] **COND-01** (refuter CE-01 + QA-01, **High**): resolve "green on `main`" — owner push decision (branch+PR / direct push / defer-with-honest-restatus), then re-cite ROADMAP P0.2 + T-002 after the first real run.
- [ ] **COND-02** (RD-001): ROADMAP §1.1 parity table stale vs P0 ticks.
- [ ] **COND-03** (RD-002 + CE-05): README persistence self-contradiction (`:88-90`, `:401-405` — the determinant is the `helix.toml` key, not the `--disk` flag) + limitation #6 stale in-memory recipe.
- [ ] **COND-04** (RD-005, RD-006): CONTRIBUTING test-type list stale; ROADMAP "3111/3121" → port-ownership wording (3151).
- [ ] **COND-05** (SEC-001): SECURITY.md scope omits the Antigravity plugin.
- [ ] **COND-06** (SEC-002): env-only-secret policy contradicts the plugin `secret` option accepted from `opencode.json` — document actual precedence.
- [ ] **COND-07** (RK-001): guard-open default (unset secret = unauthenticated server) and `AGENT_MEMORY_HOST` override silently killing the 127.0.0.1 compensating control — both absent from SECURITY.md.
- [ ] **COND-08** (RK-002): dual-spell split-brain — both secrets set to *different* values: new name wins with zero warning, stale legacy value 401s with no server signal, no removal version documented → README migration note.
- [ ] **COND-09** (RS-011 + CE-07 + QA-07): host-reboot availability undocumented (data survives on the volume; the container does not auto-start; degradation is symptom-free) → README "Durability & recovery" subsection, reroute client-`AGENT_MEMORY_URL` note, T-006 citation tidy.

Waiver-bound (three-block bar; approval pending — W-rows in C3):

- [ ] **COND-10** (LGL-001/LGL-002) → **W1**: license + CVE scan absent from CI, undocumented until now.
- [ ] **COND-11** (AUT-001 + CE-08) → **W2**: `verify-env` (T-005/T-006's cited evidence) gated in neither CI nor CONTRIBUTING's PR bar.
- [ ] **COND-12** (OPS-003 + RK-004 + CE-06/RL-002) → **W3**: no backup/DR automation; bootstrap advisory regex false-negatives (comment-out / wrong-table / container-created-before-key).
- [ ] **COND-13** (RK-003 + CE-09) → **W4**: gitleaks checksum fetched from the same release URL as the artifact; actions tag-pinned, not SHA-pinned.
- [ ] **COND-14** (QA-06 + coverage gaps) → **W5**: P0-5 precedence ("new name wins" both-set), bootstrap-advisory, hint-absence, whitespace, antigravity-output tests absent → deferred to P1.
- [ ] **COND-15** (RL-001 + CE-04) → **W6**: empty-new-name divergence (server `nonEmpty` fallback vs hooks `??`) accepted as a documented residual pending P1 unification via the proposal lane.

Low findings (~50) → backlog per severity guardrail (Medium = this sprint,
Low = backlog; only Critical/High block release — the 2 Highs are COND-01).

## C3 — CONDITIONAL/waiver review record (surgical, security-owned)

> Every CONDITIONAL/waiver challenged against the normative three-block bar in
> `references/waiver-template.md`. Missing block = FAIL, no promotion. Full
> waiver text lands in `WAIVERS-P0.md` on approval.

| Waiver / CONDITIONAL | Accepted-risk | Compensating-controls + owner | Expiry + re-review owner | Verdict |
|---|---|---|---|---|
| W1 (LGL-001/002) | pass — P0 scope = secret scan; manual 248-pkg license scan (all permissive, zero copyleft) recorded at `legal-reviewer.md` LGL-004 | pass — lockfile + manual scan evidence + gitleaks; owner: legal/orchestrator | pass — 2026-12-21 or P1 close, whichever first; re-review: legal owner | PENDING approval |
| W2 (AUT-001/CE-08) | pass — verify-env not CI-gated is outside P0 acceptance as written | pass — recorded VERIFY PASS 21/21 + TEST_MATRIX cite; owner: engineering | pass — 2026-12-21 / P1 close; re-review: engineering owner | PENDING approval |
| W3 (OPS-003/RK-004/CE-06) | pass — no automated backup/DR; advisory backstop can false-negative | pass — disk volume + README durability section (COND-09) + `helix status` shows `storage: disk`; owner: ops | pass — 2026-12-21 / P4-open, whichever first; re-review: ops owner | PENDING approval |
| W4 (RK-003/CE-09) | pass — same-origin checksum guards corruption, not release compromise; mutable tag pins | pass — sha256 verification wired in CI + local docker gitleaks evidence + tags verified to exist; owner: security | pass — 2026-12-21 / P1 (pin literal sha256 + action SHAs); re-review: security owner | PENDING approval |
| W5 (QA-06 + G-*) | pass — precedence/bootstrap/hint/whitespace/antigravity tests absent | pass — verify-injection 73/73 + verify-env 21/21 + 9-reviewer manual traces; owner: engineering | pass — 2026-12-21 / P1 close; re-review: engineering owner | PENDING approval |
| W6 (RL-001/CE-04) | pass — empty-new-name divergence: hooks `??` vs server `nonEmpty` (narrow but legal config) | pass — README "never set empty" guidance in COND-03 batch; owner: engineering | pass — 2026-12-21 / P1 unify via proposal lane; re-review: engineering owner | PENDING approval |
| COND-02..09 (docs fixes) | none — remediated by fix, never waived | docs diffs + scoped reviewer recheck; owner: orchestrator | n/a — closed by fix evidence | PENDING fix |
| COND-01 (High) | none — no waiver below owner authority; escalated | push decision (owner) + post-push run citation; owner: repo owner/orchestrator | resolves on first green `main` run | ESCALATED |

**Residual-risk:** unpushed CI until COND-01 resolves (owner: repo owner);
six accepted-risk clusters W1..W6 with 90-day / P1–P4 expiries (owners per
row); all Low findings to roadmap backlog (owner: orchestrator triage). No
silent PASS: every row carries substance above; thin box-ticks FAIL by rule.

**PII checkpoint (REQ-SEC-003/004 + REQ-P-006 co-sign):** zero
PII/secrets/tokens/credentials/sessions in any review, waiver, or evidence
artifact. Evidence files contain run logs only; the canary token is a random
non-secret probe string. Declared use: purpose = gate evidence; TTL = repo
history; deletion = history rewrite on request. Allowlisted fields only
(Ley 172-13 minimization).

## Load Evidence (HARD STOP — missing = CLOSED)

- [x] Stage skill loaded: `skill(quality-gate)` — trigger match: "implementation ready for review".
- [x] Domain owner/specialist role understood: engineering (7 reviewers), security, legal, automation/ops dispatched as distinct roles.
- [x] Execution mode declared: `subagents` — 2 waves (wave 2 = quality-assurance strictly after review-refuter).
- [x] Reviewer independence verified: strictly 1 dedicated subagent per reviewer — 9/9, zero bundled reviews across domains or wave criteria.
- [x] Packet intact: every dispatch carried `SPEC:<paths>#REQ-P0-1..6 / HARD:<AGENTS.md: never-kill, no-secrets/PII-in-logs> / GATE:<TEST_MATRIX + plan gates> / DOMAINS:<list>` by reference — no full-context paste.

## Escalations

- **COND-01 (High; refuter + QA concur, security/legal evidence lines agree):**
  escalated to the repo owner for the push decision (branch+PR recommended /
  direct push / defer-with-honest-restatus). No reviewer can resolve it; the
  gate cannot OPEN until it clears or the claim is honestly re-stated.
- Conflicting-verdict note: refuter RF-f1 found the persistence basis (Helix
  docs: `--persist` … "future runs reuse them") while CE-05 shows README
  self-negates — merged into COND-03 (wording), not a mechanism dispute.
- Data-lens skip recorded in header as an explicit assumption.
- Retry ledger: refuter (`ses_f3568d6baffeUe4…`) + risk (`ses_f3568d6b5ffeUp8…`)
  re-dispatched after interruption; QA (`ses_f354c71c1ffee8a…`) after
  cancellation — all final deliverables complete.

## Sign-off

- [ ] All reviewers pass or conditions met — **NOT met (CLOSED)**
- [ ] Gate Keeper: owning domain owner (engineering) — after COND-01..15 clear
- [ ] Final authority (if waived): domain owners + orchestrator — W1..W6 approval pending

**State machine:** CLOSED → (W1..W6 approval + COND-02..09 fixes) →
CONDITIONAL → (COND-01 resolution + scoped recheck by review-refuter and
quality-assurance of their ❌ findings) → OPEN → `verify-handoff`.
