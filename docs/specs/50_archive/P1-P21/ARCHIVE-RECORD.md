# ARCHIVE-RECORD: P1-P21

**Spec:** P1-P21 — P1 (P1.1 memory lifecycle corte A + P1.3 auto concepts +
P1.6 write-side dedup) + P2.1 hook breadth. Spec of record = `ROADMAP.md` §P1
"Recall quality & lifecycle" + §P2 "Capture breadth" (root, retained). There
is NO `docs/specs/20_backlog/` directory and no backlog spec-file for this
lane — the spec-file `git mv` (ship-release step 6.1) is therefore N/A.
**Date:** 2026-09-23
**Gate verdict:** OPEN — trail: round 1 = 4 pass + 5 conditional →
remediation `9210208` (COND-001..006 cleared; reliability + automation
re-verified PASS) → remediation `83e2f3a` (COND-007..009; security + QA
re-verified PASS) → orchestrator doc-truth cells (COND-010, class sweep) →
refuter round 5 PASS (class extinct N=0) — **9/9 pass, 10/10 conditions
cleared, waivers W1/W2 three-block PASS** — see `GATE_REPORT.md` in this
directory.
**Commit(s):** lane shas `b27364b 101e063 45380b5 8fbd795 6f7f708 eb279a6
9210208 83e2f3a d59d23a 97e9d9b` + release commit = the commit carrying this
record.
**Tag:** v0.4.0 (applied by orchestrator AFTER the release commit).
**Ship type:** deploy (local library/server release; no breaking changes →
README/INSTALL/MIGRATION templates cited, not required).

## Promoted (survive in 50_archive/P1-P21/)

All of the following were **moved via git mv (R rename)** — zero copies, zero
duplicates:

- [x] GATE_REPORT.md — moved via git mv (R rename)
- [x] HANDOFF.md — moved via git mv (R rename)
- [x] automation-reviewer.md — moved via git mv (R rename)
- [x] quality-assurance.md — moved via git mv (R rename)
- [x] review-data.md — moved via git mv (R rename)
- [x] review-readability.md — moved via git mv (R rename)
- [x] review-refuter.md — moved via git mv (R rename)
- [x] review-reliability.md — moved via git mv (R rename)
- [x] review-resilience.md — moved via git mv (R rename)
- [x] review-risk.md — moved via git mv (R rename)
- [x] security-reviewer.md — moved via git mv (R rename)
- [x] ADR-0001-application-side-dedup-uniqueness.md — created by this spec
  (link, NOT copied): lives at `docs/adr/` per repo convention (the
  template's `12_adr/` does not exist here); required by CONTRACT v1 → v1.1.

**Superset rationale (disclosed deviation from the template minimum):** the
template requires promoting `GATE_REPORT.md` + `HANDOFF.md` only. This
archive promotes the whole lane deliberately — the nine reviewer artifacts
are cross-referenced as sibling paths by both promoted files (the
Reviewer Verdicts table cites each `review-*.md`/domain artifact), so moving
them keeps every cross-link alive; purging them would dead-link the audit
trail of the shipped release (same rationale and precedent as the P0
archive).

## Purged (allowlist only, this spec)

- 40_workspace/quality-gate/P1-P21/ — the exact purge allowlist for this
  spec (ship-release SKILL step 6.4): the whole directory (GATE_REPORT,
  HANDOFF and the nine reviewer artifacts, all promoted first via the SAME
  git mv rename — net zero artifact loss). Source verified gone (`ls` → no
  such directory); `40_workspace/` holds no files after this purge (the next
  lane recreates it).

Note on the lane singletons: `PROPOSED_CHANGES.md`, `IMPLEMENTATION_PLAN.md`
and `TEST_MATRIX.md` are absent from the allowlist because those documents
live at repo root (or do not exist here), OUTSIDE the purge allowlist, and
were retained by mandate — root `IMPLEMENTATION_PLAN.md`, `TEST_MATRIX.md`,
`CHANGELOG.md`, `README.md`, `ROADMAP.md`, `AGENTS.md` and
`docs/CONTRACT.md` remain the living record, with path citations repointed
below. This lane's HANDOFF lived inside the quality-gate directory (unlike
P0's lane-level HANDOFF) and was therefore absorbed by this purge — promoted
first, per the promote-before-purge rule.

## Rollback plan

Verbatim from `docs/specs/30_delivery/RELEASE_NOTES.md` v0.4.0:

- **Code:** revert the feature range `1c410ee..97e9d9b` — 10 commits:
  `b27364b` (REQ-P1-3) → `101e063` (REQ-P1-6) → `45380b5` (REQ-P1-1) →
  `8fbd795` (REQ-P2-1) → `6f7f708` (v0.4.0 lockstep + CI) → `eb279a6`
  (contract v1.1) → `9210208` + `83e2f3a` (gate remediation) → `d59d23a`
  (gate OPEN) → `97e9d9b` (handoff + ADR) — plus the release commit appended
  at ship; or check out tag **`v0.3.0`** for a full undo. Version markers
  return to 0.3.0 (README badge, `package-lock.json`, `src/mcp.ts`, plugin
  `VERSION`, `package.json`).
- **Additive-inert by design:** old code ignores `dedupKey` + index #8 (no
  index-drop exists; the orphaned unique index is inert per probe3); both
  env knobs default OFF ⇒ revert is behavior-neutral; no destructive
  backfill ran. Per-step points: `IMPLEMENTATION_PLAN.md` "Rollback Points"
  (steps 1–4).
- **Data:** none needed — dev-instance data is seed/verify data (probe
  writes isolated to `probe-p1-*` projects); no production data risk.
- **Archive undo:** reverse `git mv` restoring `50_archive/P1-P21/` to its
  pre-archive lane under `docs/specs/40_workspace/quality-gate/P1-P21/` —
  exact source paths recorded in this file.
- Owner: engineering owner + orchestrator. ETA: immediate.

## Notes

- Other SPEC lanes active during this archive: **none** —
  `quality-gate/P1-P21` was the only lane under `docs/specs/40_workspace/`;
  purge safe (no cross-lane purge possible).
- **Pointer-relocation disclosure (paths only):** after the move, live path
  citations of the former lane
  (`docs/specs/40_workspace/quality-gate/P1-P21/`) were rewritten to
  `docs/specs/50_archive/P1-P21/` in exactly **6 lines of 3 files**:
  `docs/adr/ADR-0001-application-side-dedup-uniqueness.md:48`,
  `GATE_REPORT.md:27`, `HANDOFF.md:19,87,106,107`. No verdict, finding,
  evidence line or historical statement was altered — path tokens only.
  Historical `40_workspace` mentions inside the archived v0.2.0/v0.3.0
  RELEASE_NOTES blocks (`RELEASE_NOTES.md:284,355,415`) were deliberately
  untouched (history is the record).
- `scripts/bump-version.mjs` gap → **backlog (carried from the P0 archive
  record):** referenced by ship-release's `documentation-checklist.md` but
  absent in this repo; version sync done manually — lockstep grep ×6 all
  `0.4.0`, zero stray `0.3.0` markers (evidence: ship audit, this release).
  Creating the script = code = proposal lane; not created here.
- **Residual risk / open conditions:** waiver **W1** pre-merge condition —
  first sha256-pinned CI `secret-scan` run green at/after `9210208` before
  merge (owner: orchestrator; expiry: first push after this lane); waiver
  **W2** (purge has no Helix SDK timeout — accepted risk, compensating
  controls documented) until v0.5.0 / 2026-12-22 (owner: engineering);
  tracked findings table in `GATE_REPORT.md` (DAT-001 Concept orphans Med,
  T-107/T-108 route-level TTL/decay E2E gaps Med, SEC-03/04 Low,
  RL-004/RL-007 + hygiene rows — owner/expiry per row, expiries
  2026-10-31 / v0.5.0 unless the row says otherwise); single-writer-process
  dedup assumption (CONTRACT §3, owner: engineering; multi-instance =
  ROADMAP P4.3).
- Doc-audit gaps closed pre-commit (ship-release step 4): root `CHANGELOG.md`
  gained the `### Fixed` block (gate-remediation fixes) + the version-entry
  tag corrected to `P1+P2.1`; root `AGENTS.md` stale `helix stop dev`
  comment aligned with `helix.toml storage = "disk"` (P0 REQ-P0-4 reality).
- PII checkpoint (Ley 172-13): no PII/secrets/tokens in this record — owners
  by role, evidence by path/SHA/count; wide disclosure: none.
