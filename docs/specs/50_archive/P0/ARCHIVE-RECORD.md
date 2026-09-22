# ARCHIVE-RECORD: P0

**Spec:** P0 — Publishable foundations. Spec of record = `ROADMAP.md` §2
"P0 — Publishable foundations" (root, retained). There is NO
`docs/specs/20_backlog/` directory and no backlog spec-file for P0 — the
spec-file `git mv` (ship-release step 6.1) is therefore N/A.
**Date:** 2026-09-22
**Gate verdict:** OPEN — trail: CLOSED (first record) → CONDITIONAL (W1..W6
approved + COND-02..09 remediated) → OPEN (COND-01 closure chain complete;
all 15 conditions closed; both ❌ verdicts cleared on scoped recheck) — see
`GATE_REPORT.md` in this directory.
**Commit(s):** P0 delivery shas `44914e0 7caa14d c551774 bb335e2 1af2cde
5687135 6e5e153 f9c4e8d 1cb79c8 e4ca3ce da285a6 34471ba 97e17c2` + release
commit = the commit carrying this record (PR #6; merge sha cited in the PR).
**Tag:** v0.3.0 (applied by orchestrator AFTER merge).
**Ship type:** deploy.

## Promoted (survive in 50_archive/P0/)

All of the following were **moved via git mv (R rename)** — zero copies, zero
duplicates:

- [x] GATE_REPORT.md — moved via git mv (R rename)
- [x] HANDOFF.md — moved via git mv (R rename)
- [x] WAIVERS-P0.md — moved via git mv (R rename)
- [x] automation-reviewer.md — moved via git mv (R rename)
- [x] legal-reviewer.md — moved via git mv (R rename)
- [x] quality-assurance.md — moved via git mv (R rename)
- [x] review-readability.md — moved via git mv (R rename)
- [x] review-refuter.md — moved via git mv (R rename)
- [x] review-reliability.md — moved via git mv (R rename)
- [x] review-resilience.md — moved via git mv (R rename)
- [x] review-risk.md — moved via git mv (R rename)
- [x] security-reviewer.md — moved via git mv (R rename)
- [x] evidence/actionlint.log — moved via git mv (R rename)
- [x] evidence/p0-4-restart-canary.log — moved via git mv (R rename)
- [ ] ADR-###-… — N/A: P0 created/amended no ADR (`docs/CONTRACT.md`
  untouched by design; no public API, data-model, or cross-cutting change).

**Superset rationale (disclosed deviation from the template minimum):** the
template requires promoting `GATE_REPORT.md` + `HANDOFF.md` only. This
archive promotes the whole lane deliberately — the nine reviewer artifacts
and the waivers are cross-referenced by both promoted files and by the root
docs, so moving them keeps every cross-link alive, and the `evidence/*.log`
artifacts are the REQ-P0-2/REQ-P0-4 proofs that must survive the purge
(evidence loss would break C4 traceability for the shipped release).

## Purged (allowlist only, this spec)

- 40_workspace/quality-gate/P0/ + 40_workspace/quality-gate/HANDOFF.md — the
  exact purge allowlist for this spec (ship-release SKILL step 6.4); the
  whole `P0/` directory (nine reviewer artifacts, `GATE_REPORT.md` and
  `WAIVERS-P0.md` promoted first, `evidence/` included) plus the lane-level
  `HANDOFF.md`, all via git mv rename — `docs/specs/40_workspace/` now holds
  no `quality-gate` directory.

Note on the other three lane singletons: `PROPOSED_CHANGES.md`,
`IMPLEMENTATION_PLAN.md`, and `TEST_MATRIX.md` are **absent here** because
those documents live at repo root, OUTSIDE the purge allowlist, and were
retained by mandate — only their path citations to this lane were repointed
to `docs/specs/50_archive/P0/`.

## Rollback plan

Verbatim from `docs/specs/30_delivery/RELEASE_NOTES.md` v0.3.0:

- **Code:** `git revert` of the P0 delivery + release merge range, or check
  out tag `v0.2.0` for a full code undo — no schema, index, or migration
  change; version markers return to 0.2.0.
- **Archive undo:** reverse `git mv` restoring `50_archive/P0/` to its
  pre-archive lane under `docs/specs/40_workspace/` — exact source paths
  recorded in `docs/specs/50_archive/P0/ARCHIVE-RECORD.md`.
- Owner: engineering owner + orchestrator. ETA: immediate.

## Notes

- Other SPEC lanes active during this archive: **none** — `quality-gate/P0`
  was the only lane under `docs/specs/40_workspace/`; purge safe (no
  cross-lane purge possible).
- **Pointer-relocation disclosure (paths only):** after the move, all repo
  `.md` files were swept path-only: every citation of the former lane under
  `docs/specs/40_workspace/` (the `quality-gate` spec directory and its
  `HANDOFF.md`) was rewritten to its destination under
  `docs/specs/50_archive/P0/`, plus `TEST_MATRIX.md`'s "(same directory)"
  phrasing and bare `evidence/…` refs made explicit. No verdict, finding,
  evidence line, or historical statement was altered — path tokens only,
  including inside the quoted `.gitleaksignore` fingerprint in
  `quality-assurance.md` (the `.gitleaksignore` file itself is non-`.md`,
  untouched, and its commit-anchored fingerprint remains valid against the
  history where the artifact was at the original path).
- Root `ROADMAP.md`, `IMPLEMENTATION_PLAN.md`, `TEST_MATRIX.md` retained —
  outside the purge allowlist; only their path citations repointed.
- `scripts/bump-version.mjs` gap → **backlog**: referenced by
  ship-release's `documentation-checklist.md` but absent in this repo;
  version sync done manually via marker parity. Creating the script = code =
  proposal lane; not created here.
- Residual risk / open conditions: waivers **W1..W6** active until
  **2026-12-21** or the named milestone (re-review owners per
  `WAIVERS-P0.md`) + ~50 Low findings to roadmap backlog (owner:
  orchestrator triage).
- No PII/secrets/tokens in this record (Ley 172-13): owners by role,
  evidence by path.
- Orchestrator ruling (2026-09-22): the archive-record naming the purged
  allowlist is the sole intended exception to the "zero
  `40_workspace/quality-gate` pointers" acceptance — it is purge
  accounting mandated by `archive-record.md`, not a stale pointer;
  living-doc sweep = zero (verified).
