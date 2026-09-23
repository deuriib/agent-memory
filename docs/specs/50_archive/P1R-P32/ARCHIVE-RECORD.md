# ARCHIVE-RECORD: P1R-P32

**Spec:** ROADMAP.md §P1 rows (P1.4, P1.2, P1.5) + §P3 row (P3.2) — this repo
keeps no `docs/specs/20_backlog/` spec files; the in-repo ROADMAP rows are the
spec-of-record (ticked at `2deda68`), so the step-6.1 `git mv` from
`20_backlog/` is N/A by construction, not skipped.
**Date:** 2026-09-23
**Gate verdict:** OPEN — 9 reviewers (3 pass / 6 conditional / 0 closed),
16/16 conditions closed (13 fixed with evidence + 6 three-block C3 waivers
W-1…W-6), report at `50_archive/P1R-P32/GATE_REPORT.md`
**Commit(s):** `df39d7d` (P1.5), `591c79c` (P1.4), `39fec28` (P1.2),
`c69636d` (P3.2), `2deda68` (docs integration), `5920acc` (gate remediation),
`cd4a596` (gate record), `be7e445` (handoff) + this release commit
**Tag:** v0.5.0 (annotated, created on this commit)
**Ship type:** deploy — local library/server artifact, additive API, no
external deployment target

## Promoted (survive in 50_archive/P1R-P32/)

- [x] GATE_REPORT.md — moved via git mv (R rename) from
  `40_workspace/quality-gate/P1R-P32/`
- [x] HANDOFF.md — moved via git mv (R rename) from
  `40_workspace/P1R-P32/`
- [x] 9 reviewer artifacts (`readability.md`, `reliability.md`,
  `refuter.md`, `resilience.md`, `risk.md`, `quality-assurance.md`,
  `data.md`, `security.md`, `automation.md`) — moved via git mv together
  with the gate dir so reviewer evidence survives the purge (flat layout =
  P0 / P1-P21 archive precedent)
- [ ] ADR-### — none: the architecture contract amendment shipped as a
  versioned contract revision (`docs/CONTRACT.md` v1.1 → v1.2) recorded in
  CHANGELOG + RELEASE_NOTES "Contract" sections and gate-reviewed (risk
  verdict pass); no separate ADR created or amended

## Purged (allowlist only, this spec-id)

- `40_workspace/P1R-P32/PROPOSED_CHANGES.md` — N/A (never existed at this
  path in this repo)
- `40_workspace/P1R-P32/IMPLEMENTATION_PLAN.md` — N/A at this path; the
  repo-root `IMPLEMENTATION_PLAN.md` is a root lane singleton OUTSIDE the
  allowlist → **preserved** (not touched)
- `40_workspace/P1R-P32/TEST_MATRIX.md` — N/A at this path; repo-root
  `TEST_MATRIX.md` likewise OUTSIDE the allowlist → **preserved**
- `40_workspace/P1R-P32/HANDOFF.md` — promoted (git mv) then dir removed;
  source path verified gone
- `40_workspace/quality-gate/P1R-P32/` — all 9 reviewer `.md` + gate dir
  emptied by git mv (GATE_REPORT promoted first) then rmdir; source path
  verified gone

No path outside this allowlist was purged or modified by archival.

## Rollback plan

Release-level: revert this release commit (restores `40_workspace/`
layout + notes edits) — owner: orchestrator, ETA immediate.
Code-level to v0.4.0: revert lane commits in reverse order
(`be7e445` → `cd4a596` → `5920acc` → `2deda68` → `c69636d` → `39fec28` →
`591c79c` → `df39d7d`) to land on pre-lane base `d17294b` (tag v0.4.0
content); owner: engineering, ETA immediate.
Non-code undo: delete tag `v0.5.0` (retract), drop the RELEASE_NOTES
v0.5.0 section (revert of the same commit); dev-instance rows are
seed/verify data only — no data migration to reverse (derived-importance
change never rewrote stored rows).
Full story: `docs/specs/30_delivery/RELEASE_NOTES.md` §v0.5.0
"Rollback / Undo".

## Notes

- Other SPEC lanes active during this archive: **none** — `40_workspace/`
  held only this lane (P0 and P1-P21 already archived); purge ran, nothing
  crossed lanes.
- Residual risk / open conditions: no outstanding COND; accepted residuals
  W-1…W-6 each carry owner + expiry in `GATE_REPORT.md` C3 (W-1…W-3 also
  in `ROADMAP.md` §1.3).
- Documentation audit (ship-release checklist): RELEASE_NOTES v0.5.0
  conforming (Highlights/Changes/Breaking/Known Issues/Rollback-Undo) ✓ ·
  CHANGELOG `[v0.5.0] — 2026-09-23` Keep-a-Changelog block ✓ · README badge
  + counts current ✓ · INSTALL/MIGRATION cited, not required (no breaking
  change; neither file exists in this repo) · `bump-version.mjs --check`
  exit 0 (frame-ship carriers, canonical v0.10.0) · agent-memory lockstep
  ×5 = 0.5.0 verified per carrier (`package.json`, `package-lock.json`,
  `src/mcp.ts`, plugin `VERSION`, README badge) · `typecheck` exit 0 ·
  zero PII/secrets/tokens in this record (Ley 172-13; owners by role).
