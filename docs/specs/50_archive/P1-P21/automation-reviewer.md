# Automation Review: P1-P21

**Reviewer:** automation-reviewer (automation domain + ops lens)
**Date:** 2026-09-23
**Verdict:** PASS (round 2 re-verification of prior CONDITIONAL — condition OPS-001 cleared, see [Re-verification](#re-verification-round-2--2026-09-23))
**Scope:** automation/ops only (1 of 9 independent reviewers) — `1c410ee..HEAD` (7 commits incl. remediation `9210208`) + current files.

## Checklist — automation-review.md

- [x] Workflow/port/adapter/event boundary mapped — purge talks only to Helix via `HELIX_URL` (default `http://localhost:6969`); hooks post only to `AGENT_MEMORY_URL`; verify-capture binds ephemeral `127.0.0.1:0` + dead `127.0.0.1:1`; output allowlisted (no memory content on stdout; governance line fields: project/days/deleted/at). PII checkpoint: `UserPromptSubmit` prompt text asserted absent (canaries, verify-capture B).
- [x] Least-privilege scopes — CI `permissions: contents: read`; no new secrets/tokens/keys introduced; purge uses the same Helix endpoint the store already uses (no widened interface).
- [x] Idempotency + retry budget — purge re-runnable: second run lists 0 expired → clean exit 0 with `deleted=0`; no-progress guard = fail-closed abort (documented retry N=2→escalate posture; script itself performs no retries).
- [x] Deployment plan + rollback — no deploy surface; rollback points per IMPLEMENTATION_PLAN.md (env knobs default OFF; CI step revert is 3 lines).
- [x] Monitoring/alerting + runbook — plan/governance/health lines allowlisted; runbook-grade header in `scripts/purge.ts` (usage, flag semantics, exit codes 0/1/2, output contract). Gap → OPS-001 below.
- [x] Capacity/scaling + feature flags — N/A (no feature flags; TTL/decay default off = de-facto flags, off by default as declared).
- [x] No freelance fixes — reviewer changed nothing.

## Checklist — ops-review.md (ops lens)

- [x] Deployment plan defined — N/A (library/scripts, no infra deploy).
- [x] Rollback tested — revert paths documented per step; defaults-off means rollback never changes live behavior.
- [x] Monitoring/alerting updated — purge plan + health before/after + governance lines; gap on failure path → OPS-001.
- [x] Runbook updated — script header is runbook-grade; README coverage partial → OPS-002.
- [x] On-call impact assessed — no new service, no new required env vars, no new ports (3151/3111 coexistence untouched: verify-capture hard-forbids 3111/3112/3113/3151/6969, verify-lifecycle opens no socket, purge only reaches `HELIX_URL`).
- [x] Capacity/scaling reviewed — batch caps (`BATCH_LIMIT=500`, `MAX_BATCHES=10_000`, `DRY_RUN_LIMIT=100_000`, `SESSION_SCAN_LIMIT=100_000`) bound every loop.
- [x] Feature flags (if needed) — N/A.

## Findings

| ID | Severity | Finding | Evidence / Location | Mitigation | Re-verify status |
|----|----------|---------|---------------------|------------|------------------|
| OPS-001 | Med | Governance + healthCount audit lines are printed ONLY after **all** projects complete; a failure mid-run (Helix error after N deletions, `--all` failing on project 2 after project 1 was purged, no-progress abort) exits 1 printing only `purge failed: <error>` — the completed deletions never appear in the allowlisted governance stream, and no before/after counts are reported for the partial work. The most incident-relevant path of a destructive script is the one with the weakest audit trail. | `scripts/purge.ts` — plan line at `main()` (l.302) is pre-action, but governance line (l.340) and health lines (l.328–337) sit after the full project loop; `purgeProject` throws (l.261/286) → `main().catch` (l.345) prints `describeError` only, no counts. | Print per-project governance + health lines as each project commits (incremental audit), or include `deleted-so-far` in the failure line; alternatively document the limitation explicitly in the header. Small, in-lane fix. | **FIXED-VERIFIED** (9210208 C2 — evidence in round-2 section) |
| OPS-002 | Low | No operator-facing usage block for the destructive script in README: full flag syntax `--days <N> (--project <name> \| --all) [--dry-run]`, exit codes, and safety semantics live only in the `purge.ts` header comment + CHANGELOG/ROADMAP mentions. README shows only the dry-run/exit-2 line in the verification section. Runbook-grade doc for an operator starts at the README. | `README.md` — grep: only l.109 (scripts list), l.404 (`HELIX_URL` row), l.532–533 (dry-run + exit 2); no `--days`/`--all` usage anywhere. Canonical usage in `scripts/purge.ts` l.47–48 (USAGE). | Add a short README "Purge (TTL)" subsection: usage line, exit codes, dry-run-first recommendation, governance-line semantics. | **NOT FIXED** — Low, backlog (9210208 did not touch this; not a verdict condition) |
| AUT-001 | Low | gitleaks was NOT run locally (2× download timeout, escalated). Assessment: **acceptable accepted-risk for this lane, contingent on the pre-merge condition that CI `secret-scan` is green on head `eb279a6`.** Rationale: the CI job is intact and unchanged by this lane (diff = +3 lines, verify job only), runs on push AND pull_request over full history (`fetch-depth: 0`), pinned binary v8.30.1 with sha256 checksum verification, `--redact`; the lane's new material contains only synthetic canaries explicitly shaped as non-secrets. The gate runs automatically on the pushed commits, so the condition is a confirmation, not a re-run. | `.github/workflows/ci.yml` l.30–51 (unchanged); TEST_MATRIX T-105; new files audited for canary strings only (`verify-capture.ts` l.50–52). | ~~Confirm CI secret-scan check green on `eb279a6` before merge~~ → **condition point updated to `9210208`** (code-touching remediation added since round 1); owner: orchestrator (engineering); expiry: first push after this lane. Updated wording in round-2 section. | **UPDATED** (condition restated for 9210208 — see round-2 section) |
| AUT-002 | Low | `purge.ts` arg parser is last-wins on duplicate flags (`--project a --project b`, `--days 7 --days 30`) instead of fail-closed usage error — inconsistent with the script's otherwise strict mutually-exclusive/unknown-arg handling. | `scripts/purge.ts` `parseArgs` l.63–101 (no duplicate detection; assignment overwrites). | Track a duplicate-flag usage error (`failUsage`) in a follow-up. | **NOT FIXED** — Low, backlog (parseArgs untouched by 9210208; not a verdict condition) |

**No Critical/High findings.**

## CI checklist (HARD surface 1)

- [x] `ci.yml` valid YAML (parsed clean); step order: `npm ci` → `typecheck` → `verify-injection` → `verify-lifecycle` → `verify-capture`.
- [x] `verify-lifecycle.ts` genuinely Helix-free/network-free: imports only `node:crypto` + `src/concepts.js`/`src/lifecycle.js` (pure math, fixed clock `2026-06-15`, no `fetch`, no server, no ports).
- [x] `verify-capture.ts` network scope: ephemeral `listen(0, 127.0.0.1)` + dead `127.0.0.1:1` (tcpmux, unbindable without root) — **no hardcoded collidable host/port on a runner**; explicit never-3111/3112/3113/3151/6969 policy documented in header.
- [x] Timeout sane: job `timeout-minutes: 10`; per-child 15 s (`CHILD_TIMEOUT_MS`) → bounded worst case.
- [x] Actions still pinned (`actions/checkout@v4.4.0`, `actions/setup-node@v4.4.0`), `permissions: contents: read`, `node-version: 20` + npm cache.
- [x] Secret-scan job intact byte-for-byte (lane diff touches verify job only); gitleaks pin + checksum path unchanged → AUT-001 assessment.

## Release checklist (HARD surface 2)

- [x] Version 0.4.0 lockstep verified: `package.json:3` ✓ · `package-lock.json:3` (root) ✓ · `package-lock.json:9` (`packages[""]`) ✓ · `src/mcp.ts:375` `McpServer({name, version:"0.4.0"})` ✓ · plugin `plugins/opencode/plugins/agent-memory.ts:63` `const VERSION = "0.4.0"` ✓ · `README.md:3` badge `version-v0.4.0` ✓.
- [x] CHANGELOG v0.4.0 follows Keep a Changelog (Added/Changed, dated, links to keepachangelog) and references REQs per entry (REQ-P1-3/P1-6/P1-1/P2-1) + version-bump line.
- [x] ROADMAP rows P1.1 / P1.3 / P1.6 / P2.1 ticked `✅ done (2026-09-23)` each with concrete evidence numbers (34 / 131 / 115 / probe3).
- [x] npm scripts: `verify-lifecycle`, `verify-capture`, `purge` — names match file names and README script list; `tsx ^4.19.0` present in devDependencies (installed by `npm ci` before `npx tsx` in CI).

## Ops safety checklist — scripts/purge.ts (HARD surface 3)

- [x] Fail-closed args: `--days` required, `^[1-9][0-9]{0,5}$` (≥1; days=0 explicitly refused with rationale); exactly one of `--project`/`--all` required + mutually exclusive; unknown args refused → exit 2.
- [x] `--dry-run` path performs only `listExpired` (no `forgetMemory`) — never deletes; prints ids + `would-delete` count only.
- [x] Exit codes: 0 success · 1 operational failure (`main().catch`) · 2 usage (`failUsage`).
- [x] Batch/runaway guards: `BATCH_LIMIT=500`, `MAX_BATCHES=10_000`, no-progress abort (`batchDeleted===0` throws), dry-run/project-scan caps (100_000).
- [x] Helix-direct via `HELIX_URL` (default `http://localhost:6969`) — instance never restarted (contract §0 respected).
- [x] Output allowlisted: plan line (stderr, pre-action), ids-only dry-run, health counts only, one governance line; `describeError` never logs query values; no memory content on stdout.
- [x] healthCount before/after reported per project (real run) — but only on the all-success path → OPS-001.
- [x] Idempotence/re-runnability: re-run after completion lists 0 → exit 0 `deleted=0`.
- [x] Helix down: first query rejects before any deletion → exit 1 (fail-closed, no partial write on connect failure).
- [x] Id vanishes mid-purge: `indicatesPresence=false` not counted; all-vanished batch triggers no-progress abort → exit 1 (fail-closed; counts visible only via OPS-001 gap).
- [x] Runbook-quality header: usage, flag semantics, exit codes, output contract, probe prerequisite — present (`purge.ts` l.1–28); README coverage partial → OPS-002.

## verify-capture process hygiene (HARD surface 5)

- [x] Children tracked in `kids[]`; timeout → `SIGKILL`; `finally` block SIGKILLs any still-running child (`exitCode === null`) — no orphan/zombie path survives the parent's `process.exit`.
- [x] Counting server closed in section E **and** `finally` (idempotent guard), `closeAllConnections()` prevents hang on keep-alive sockets → port released before exit.

## 3151/3111 coexistence (HARD surface 6)

- [x] No regression: README conflict procedure intact (l.421–438, `AGENT_MEMORY_PORT=3151 npm run dev` + `AGENT_MEMORY_URL=...3151 npm run verify`); diff context confirms section preserved. verify-capture hard-forbids 3111/3151/6969; verify-lifecycle opens no socket; purge targets `HELIX_URL` only (6969), never the REST ports. Gate evidence ran `verify` on 3151 with upstream iii on 3111 untouched.

## Verdict Rationale

**Round 1 (initial):** CONDITIONAL — the lane is automation-clean: CI additions minimal, pinned, valid, Helix-free; version lockstep holds at all 6 locations; destructive script fail-closed on args, caps, progress, and connection failure, and idempotent. Condition: OPS-001 (audit lines vanish on the partial-failure path).

**Round 2 (re-verification of `9210208`):** PASS — OPS-001 is FIXED-VERIFIED from code and from live cheap runs (mid-run failure now emits the allowlisted `status=partial` governance line before exit 1; exit codes 0/1/2 re-confirmed; stdout allowlist strictly clean; dry-run unaffected). CI untouched by the remediation; version lockstep ×6 intact. The gitleaks accepted-risk condition is restated at the new condition point `9210208` (owner: orchestrator, engineering; expiry: first push after this lane) — a pre-merge confirmation of an intact, unchanged enforcing job, not a re-run. Remaining findings OPS-002 and AUT-002 are Low, tracked to backlog, explicitly not verdict conditions.

**Residual risk (explicit):** (a) until OPS-002 lands, operator-facing purge usage docs live only in the script header; (b) SIGINT/Ctrl-C mid-run bypasses `main().catch`, so the partial governance line is not emitted on interrupt — the per-batch `purge-progress … deleted=N` stderr lines (added in 9210208) are the compensating audit trail and were observed live; (c) RL-002 accepted risk (no SDK timeout) stands with its documented compensating controls.

## Re-verification (round 2 — 2026-09-23)

**Subject:** remediation commit `9210208 fix(gate-p1-p21): clear P1+P2.1 quality-gate conditions` — only the conditions raised by THIS reviewer were re-verified. Read-only on code; all runs were cheap and local (no Helix restart, no 3151 server, upstream iii/3111 untouched).

### OPS-001 (Medium) → **FIXED-VERIFIED**

Code (`git show 9210208 -- scripts/purge.ts`):
- Module-scope `const audit = { scope, days, deleted }` cursor; `audit.scope/days` set in `main()` BEFORE the first query; `audit.deleted += 1` only inside the real-run path on `indicatesPresence(forgetMemory)` confirmation (dry-run never touches it).
- `main().catch` emits `purge project=… days=… deleted=… at=… status=partial` (fixed literal discriminator) to stdout **before** `exit 1` whenever `audit.deleted > 0`; no deletions → no line (correct: nothing to audit); usage errors `process.exit(2)` before any deletion can exist.
- Per-batch `purge-progress project=… batch=… deleted=…` on stderr (also the compensating liveness/audit control for RL-002).

Live runs (this re-verification):

| Scenario | Command | Result | Expected |
|---|---|---|---|
| Mid-run failure after 1 confirmed deletion (local fake Helix on an ephemeral port: call1 health → call2 listExpired → call3 forget → HTTP 500) | `HELIX_URL=http://127.0.0.1:<eph> purge --days 3 --project $'gate reverify\nmulti'` | **exit 1**; stdout: `purge project=gate reverify multi days=3 deleted=1 at=2026-09-23T05:36:02.196Z status=partial`; stderr: plan line → `purge-progress … batch=1 deleted=1` → `purge failed: Remote: …` | Audit trail present on failure ✓ |
| Dead Helix, real-run path (unused port 9) | `HELIX_URL=http://127.0.0.1:9 purge --days 3 --project gate-reverify` | **exit 1**, plan line + `purge failed: Network…`, **NO `status=partial` line** (audit.deleted=0) | No spurious partial line ✓ |
| Dead Helix, dry-run path | same + `--dry-run` | **exit 1**, plan + failure, no partial line, no ids | Dry-run unaffected ✓ |
| Usage guards ×3 (no args / missing scope / `--days 0`) | `purge …` | **exit 2** each, usage text, no partial line | Exit codes 0/1/2 preserved ✓ |
| Live dry-run vs real Helix (6969, read-only path — `listExpired` only, no `forgetMemory` call exists in the branch) | `purge --days 1 --project gate-reverify --dry-run` | **exit 0**, `purge-dry-run … would-delete=0` | Dry-run unaffected ✓ |

Allowlist strictness:
- **stdout in the failure run contained exactly one line** — the 4 allowlisted fields + fixed `status=partial` literal. Zero occurrences of the response canary `CANARY_purge_reverify_17213` in **stdout**; memory content is never in any emitted line.
- Newline-bearing project name rendered single-line in plan/progress/partial lines (the `oneLine()` CWE-117 guard — no forged second line).
- Observation (pre-existing, accepted, unchanged — NOT a new finding): the `purge failed:` **stderr** diagnostic echoes the server's own error text (`describeError` documents "only the error's own message"); purge's queries carry only project/cutoff/memoryId (never memory content), so memory content cannot reach that channel; oneLine() now normalizes it too.

Regression on the remediation itself: `npm run typecheck` exit 0 · `verify-lifecycle` 34/34 · fake server shut down after run.

### Gitleaks accepted-risk — **updated wording for the gate report**

> **Accepted risk (AUT-001):** gitleaks was not run in this environment (2× download timeout, escalated) — documented, owner: orchestrator (engineering). **Enforcing control:** CI P0.2 `secret-scan` job — pinned gitleaks v8.30.1, sha256 checksum-verified, full history (`fetch-depth: 0`), `--redact`, runs on push **and** pull_request — is byte-untouched by this lane (`git diff eb279a6..9210208 -- .github/` = 0 lines). **Pre-merge condition for THIS lane:** the **first CI `secret-scan` green at or after `9210208`** (the code-touching remediation moved the condition point from `eb279a6`; a green run on a pre-remediation commit does NOT satisfy it). **Owner:** orchestrator (engineering). **Expiry:** first push after this lane — once a green secret-scan run is recorded at/after `9210208`, the condition dissolves and only the hygiene item (local re-run when network allows) remains in backlog.

### Quick regression

- [x] CI workflow untouched by `9210208`: `--name-only` = 8 files, no `.github/`; `git diff eb279a6..9210208 -- .github/` = **0 lines**; step order, pins, timeout, secret-scan job all as reviewed in round 1.
- [x] Version lockstep still 0.4.0 ×6: `package.json:3` ✓ · `package-lock.json:3` ✓ · `package-lock.json:9` (`packages[""]`) ✓ · `src/mcp.ts:375` ✓ · plugin `VERSION` l.63 ✓ · README badge l.3 ✓.

### New findings

**None.** The remediation also tightened adjacent surfaces (oneLine print-site guard, `purge-progress` liveness lines, contract §3 audit/accepted-risk documentation) without introducing automation/ops regressions.

## Ops Lens

Covered inline above (ops-review.md checklist + purge/ops-safety sections): deployment/rollback N/A-and-documented, monitoring = plan/health/governance lines (OPS-001 gap), runbook = header ✓ / README partial (OPS-002), on-call = no new ports/env/services, capacity = bounded loops, feature flags N/A.
