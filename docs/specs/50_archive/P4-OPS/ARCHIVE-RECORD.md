# ARCHIVE-RECORD — P4-OPS (P4 ops control plane — CLI + slots + data-dir, v0.8.0)

**Date:** 2026-09-24 · **Spec:** `SPEC-P4-OPS` (`docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F`) + companion `SPEC-P4-OPS-RUNBOOK` (`docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md#REQ-OPS-RUN-01..15`) — operational contract consumed by name
**Gate verdict:** ✅ OPEN — 8/8 PASS, zero Critical/High open, zero ❌, zero conditional — see `GATE_REPORT.md` in this directory (consolidated gate keeper Montilla 2026-09-24; R1+R8+R2 sign-offs)
**Commits:** `f8e29f1` (feat CLI binary `bin/agent-memory.mjs` slot derivation + lifecycle REQ-01..07) · `bd65360` (test harness `scripts/verify-ops.ts` §A–§L never-kill+secret proofs) · `9212a70` (docs plan A3 FAIL + matrix P4 OPS rows + proposal appendix) · `8d6ae81` (fix slot `storage="disk"` patch for doctor C5) · `974f5c4` (docs README ops section + live slot2 window bar #10) · `615d06e` (gate OPEN 8 reviews) · `2a7bc18` (handoff DoD PASS) · this `chore(release-0.8.0)` commit
**Tag:** v0.8.0 (after commit)
**Promoted (survive the purge, copied/moved to 50_archive/P4-OPS/):**
- `SPEC-P4-OPS.md` — moved via `git mv` from `docs/specs/20_backlog/` (R rename)
- `SPEC-P4-OPS-RUNBOOK.md` — moved via `git mv` from `docs/specs/20_backlog/` (R rename)
- `GATE_REPORT.md` — copied from `docs/specs/40_workspace/quality-gate/P4-OPS/` (consolidated)
- `HANDOFF.md` — copied from `docs/specs/40_workspace/engineering/` (DoD PASS, 15/15 trace)
- `ARCHIVE-RECORD.md` — this file (audit trail, purge accounting)
**Purged (allowlist only, this spec — ships after promotion):**
- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` — lane singleton (proposal phase)
- `docs/specs/40_workspace/engineering/HANDOFF.md` — promoted copy above is the audit trail (original removed)
- `docs/specs/40_workspace/engineering/IMPLEMENTATION_PLAN.md` — N/A under this path (lives at repo root `IMPLEMENTATION_PLAN.md`, retained — outside allowlist, not purged)
- `docs/specs/40_workspace/engineering/TEST_MATRIX.md` — N/A under this path (lives at repo root `TEST_MATRIX.md`, retained — outside allowlist, not purged)
- `docs/specs/40_workspace/quality-gate/P4-OPS/` — 8 reviewer artifacts + `GATE_REPORT.md` (promoted copy above is the audit trail): `quality-assurance.md`, `security-reviewer.md`, `automation-reviewer.md`, `readability.md`, `reliability.md`, `resilience.md`, `risk.md`, `refuter.md`
**Not purged (retained per allowlist):**
- `docs/specs/40_workspace/engineering/ARCHITECTURE_REVIEW.md` — not in purge allowlist, retained
- `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` — not in purge allowlist, retained
- `IMPLEMENTATION_PLAN.md` (repo root) — lane plan singleton, retained (outside allowlist)
- `TEST_MATRIX.md` (repo root) — lane evidence singleton, retained (outside allowlist)
- `docs/specs/40_workspace/quality-gate/` — directory retained (now empty after P4-OPS purge; other lanes untouched — verified no other lane dirs present at purge time)
**ADR link:** none (no `docs/CONTRACT.md` or data-model change — `ARCHITECTURE_REVIEW.md` Approved-with-conditions C1–C3 discharged at gate; ADRs remain in `docs/specs/40_workspace/decision-records/` none required)
**Release notes:** `docs/specs/30_delivery/RELEASE_NOTES.md` v0.8.0 section (ship type deploy, highlights CLI/slot2/data-dir/A3 FAIL C1..C10 verify-ops 99, rollback plan delete bin+verify-ops revert 2 rows helix.toml slot2 stop slot2)
**Rollback:** reverse-order whole-commit revert of `f8e29f1..2a7bc18` + this release commit; full undo at tag **v0.7.1** (`rm bin/agent-memory.mjs && rm scripts/verify-ops.ts && git checkout -- package.json package-lock.json helix.toml && bin/agent-memory stop --slot 2` if running). No schema/index/migration. Owner: engineering + orchestrator. ETA: immediate.
**PII checkpoint (Ley 172-13):** Zero PII/secrets/tokens in this record — allowlisted evidence only (ports, counts, PIDs, verdicts, `~`-collapsed paths, owners by role).
