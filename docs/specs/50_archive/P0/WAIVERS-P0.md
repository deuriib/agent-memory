# Quality Gate Waivers: P0 (publishable foundations) — agent-memory

**Issued By:** domain owners (repo owner) + orchestrator
**Date:** 2026-09-22
**Gate Status at Waiver:** CLOSED
**Approval record:** repo owner approved all six waivers as drafted on
2026-09-22, immediately after the C3 table was published in `GATE_REPORT.md`
(same directory); this file records the full normative three-block text.
**Expiry default:** 90 days or the named milestone, whichever first — here
**2026-12-21** or the milestone stated per waiver; re-review owner mandatory
per waiver.

## Reviewer(s) Overridden

| Reviewer | Verdict | Reason for Override |
|----------|---------|---------------------|
| legal-reviewer (LGL-001/LGL-002) | conditional | P0 CI scope as accepted never included license/CVE jobs; the real gap was *undocumented* — W1 records it with owner, justification, expiry |
| automation-reviewer (AUT-001, OPS-003) | conditional | Mediums accepted as owned, expiring residuals with compensating docs/controls (W2, W3) |
| review-risk (RK-003, RK-004) | conditional | Mediums accepted with compensating controls and dated fix conditions (W3, W4) |
| quality-assurance (QA-06 + G-* coverage gaps) | fail (Medium lane) | Coverage gaps deferred to P1 tests with owner + expiry (W5); its High (QA-01) is NOT waived — resolved via COND-01 |
| review-reliability + review-refuter (RL-001, CE-04) | conditional | Divergence accepted as documented residual pending P1 unification through the proposal lane (W6) |

> COND-01 (CE-01/QA-01, High) is deliberately absent: High findings are not
> waivable below owner authority — it was resolved by decision (branch + PR),
> see GATE_REPORT Escalations.

## W1 — license + CVE scan absent from CI (LGL-001, LGL-002)

**Accepted-risk:** CI runs no automated license scan and no CVE scan, while
the guardrails mandate both. Accepted because the approved P0.2 acceptance
scope was typecheck + verify-injection + secret scan only; the dependency
tree was manually license-scanned this date with zero copyleft hits, and
lockfile pinning + gitleaks cover the P0 threat model.

**Compensating-controls:** lockfile-pinned dependencies (`npm ci` in CI) +
manual license scan of all 248 packages (147 MIT, 44 ISC, 12 BlueOak-1.0.0,
11 Apache-2.0, 7 BSD-family, 3 CC0-1.0, 1 CC-BY-3.0, 1 dual AFL/BSD, 1 0BSD;
**zero GPL/AGPL/SSPL/ELv2/MPL/EPL/BUSL**) recorded at `legal-reviewer.md`
LGL-004 + CI secret scan — **owner: legal/orchestrator** — evidence-ref:
`legal-reviewer.md`, `.github/workflows/ci.yml`.

**Expiry:** 2026-12-21 or P1 close, whichever first — **re-review owner: legal
owner.**

**Sign-off:** repo owner (2026-09-22) + orchestrator.

**Residual-risk:** a copyleft or vulnerable dependency introduced before
expiry passes CI undetected — **owner: engineering** (mitigated by PR review
bar + daily manual scan discipline until the CI step lands).

## W2 — verify-env not gated in CI or the PR bar (AUT-001, CE-08)

**Accepted-risk:** `scripts/verify-env.ts` — the cited evidence for T-005
(21/21) and T-006 (hint) — is gated in neither `.github/workflows/ci.yml` nor
`CONTRIBUTING.md`'s PR bar, so a regression of the legacy migration or the
reroute hint could ship behind a green `main`. Accepted because P0's approved
CI scope did not include it, the run is recorded and reproducible locally, and
CI cannot yet assume the port/env shape verify-env probes (it binds 3199 and
spawns servers — runner design question, not a wording fix).

**Compensating-controls:** recorded `VERIFY PASS 21/21` (2026-09-22) cited at
`TEST_MATRIX.md` T-005/T-006 + CONTRIBUTING documents `verify-env` as a
local pre-PR command — **owner: engineering** — evidence-ref:
`TEST_MATRIX.md`, `CONTRIBUTING.md`.

**Expiry:** 2026-12-21 or P1 close, whichever first (decision: gate it in CI
or explicitly out-scope it in the plan) — **re-review owner: engineering
owner.**

**Sign-off:** repo owner (2026-09-22) + orchestrator.

**Residual-risk:** silent regression of T-005/T-006 behaviors until gated —
**owner: engineering.**

## W3 — no backup/DR automation + advisory-regex false negatives (OPS-003, RK-004, CE-06/RL-002)

**Accepted-risk:** disk persistence ships with no automated backup or DR runbook
(restore path untested; host reboot leaves the container down with a
symptom-free failure mode), and the bootstrap advisory that guards the
config path can false-negative (commented-out `storage` key, key in the wrong
table, or a container created before the key existed). Accepted because P0.4's
acceptance was persistence + advisory warning (both delivered and
artifact-proven), durability automation is explicitly P4 roadmap work, and the
advisory is non-blocking by design.

**Compensating-controls:** `storage = "disk"` in git-tracked `helix.toml`
(verified by CI-visible config + live `helix status` showing `storage: disk`)
+ README **Durability & recovery** section added by gate remediation COND-09
(data survives restarts on the volume; after host reboot run `helix start
dev`; check `helix status` when captures go quiet) + artifact-backed restart
canary (`evidence/p0-4-restart-canary.log`) — **owner: ops** — evidence-ref:
`README.md` Durability section, `evidence/p0-4-restart-canary.log`,
`ROADMAP.md` P4 rows.

**Expiry:** 2026-12-21 or P4 open, whichever first — **re-review owner: ops
owner.**

**Sign-off:** repo owner (2026-09-22) + orchestrator.

**Residual-risk:** undetected data loss until backup lands (probability low:
single-dev disk volume; impact high) — **owner: ops** — and advisory
false-negative leaving a volatile instance unwarned — **owner: engineering**
(mitigated by `helix status` check in the README section).

## W4 — gitleaks checksum same-origin + tag-pinned actions (RK-003, CE-09)

**Accepted-risk:** the CI gitleaks `checksums.txt` is fetched from the same
release URL as the artifact (guards corruption, not a compromised release;
offline verification impossible as wired) and the two actions are pinned by
mutable tag (`v4.4.0`) rather than commit SHA. Accepted because an attacker
who can edit the workflow already owns CI (checksum pinning would not stop
them), no doc falsely claims SHA-pinning, and local docker-evidenced scans
independently corroborate clean results.

**Compensating-controls:** sha256 verification step is wired (corruption
guard) + version pinned to exact `8.30.1` + tags verified to exist via
`git ls-remote` + independent local scan evidence (docker `zricethezav/gitleaks:v8.30.1`,
`no leaks found`, recorded across security/legal/automation reviews) —
**owner: security** — evidence-ref: `.github/workflows/ci.yml:36-46`,
`security-reviewer.md`, `legal-reviewer.md`.

**Expiry:** 2026-12-21 or P1 (pin literal sha256 + action commit SHAs),
whichever first — **re-review owner: security owner.**

**Sign-off:** repo owner acting as security authority (2026-09-22; C3 row
published in `GATE_REPORT.md` before approval) + orchestrator.

**Residual-risk:** supply-chain compromise of a gitleaks release or action
tag between now and expiry slips into CI — **owner: security** (likelihood
low, blast radius = CI read-only token + build logs).

## W5 — P0-5 precedence and backstop tests deferred (QA-06, G-* coverage gaps)

**Accepted-risk:** no automated assertion covers (a) "new name wins" with both
spellings set, (b) the bootstrap advisory on/off, (c) hint ABSENCE on
non-EADDRINUSE errors, (d) whitespace-only values, (e) antigravity
zero-output, (f) verify-env gating. Accepted because P0's test bar was
`typecheck` + `verify-injection` + `verify-env` (all green, reproducible),
the nine-reviewer gate traced each behavior manually this date, and writing
tests is code that requires its own proposal (hard rule 1).

**Compensating-controls:** `verify-injection` 73/73 + `verify-env` 21/21 +
`verify` 102/102 recorded at `TEST_MATRIX.md` + manual nine-reviewer traces
of every listed behavior (artifacts in this directory) — **owner:
engineering** — evidence-ref: `TEST_MATRIX.md`, `quality-assurance.md` G-*,
`review-refuter.md` RF-*.

**Expiry:** 2026-12-21 or P1 close, whichever first (tests land via
propose-changes lane) — **re-review owner: engineering owner.**

**Sign-off:** repo owner (2026-09-22) + orchestrator.

**Residual-risk:** a precedence or backstop regression ships undetected
between now and the tests — **owner: engineering.**

## W6 — empty-new-name divergence across surfaces (RL-001, CE-04)

**Accepted-risk:** with a set-but-**empty** new name and a legacy value set,
surfaces disagree: server/MCP treat empty as unset (nonEmpty → legacy fallback
+ warning, guard armed) while hooks use `??` (empty wins → no bearer → captures
401 and are swallowed); recall/plugin length-checks do fall back. Narrow but
legal config; silent capture loss on the hook path only (server-side secret is
never dropped — REQ-P0-5's server claim holds). Accepted because unifying the
semantics is a behavior change requiring its own proposal, and the exposure is
self-inflicted misconfiguration (empty-string values are never legitimate).

**Compensating-controls:** README env section now states **never set a new
name to an empty string — unset it instead**, documents the split-brain
behavior (COND-08 batch), and README:375-376 wording corrected to match
reality — **owner: engineering** — evidence-ref: `README.md` env-migration
section, `review-reliability.md` RL-001, `review-refuter.md` CE-04.

**Expiry:** 2026-12-21 or P1 (unify empty/unset semantics across hooks,
plugin, server via proposal lane) — **re-review owner: engineering owner.**

**Sign-off:** repo owner (2026-09-22) + orchestrator.

**Residual-risk:** silent capture loss if an operator sets an empty new name
with legacy set — **owner: engineering** (probability low after README
guidance; impact = missed captures until config fixed).

## PII checkpoint (REQ-SEC-003/004 + REQ-P-006 co-sign)

Zero PII/secrets/tokens/credentials/sessions in this file, the grill
questions/answers, prompts, logs, examples, or exports. Every prompt/adapter/
event/log/export referenced here is a declared PII checkpoint (mask/tokenize +
allowlist); allowlisted evidence only; Ley 172-13 minimization — purpose:
gate waiver record; TTL: repo history; deletion: history rewrite on request.
Wide/cross-tenant disclosure = finding. No-freelance-fix: findings report
`severity + location + evidence`, owner remediates. Proof-or-refuted: a
finding without `diff/scan/log` = REFUTED. The canary token in
`evidence/p0-4-restart-canary.log` is a random non-secret probe string, not a
credential. Masking reminder: no reviewer artifact exports raw env values
(name-only warnings by construction).

## Sign-off

- [x] orchestrator — 2026-09-22
- [x] Relevant domain owner(s) — repo owner approved all six as drafted, 2026-09-22
- [x] security owner (W4) — repo owner acting as security authority; C3 row
  published in `GATE_REPORT.md` prior to approval
