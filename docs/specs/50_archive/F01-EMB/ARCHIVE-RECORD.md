# ARCHIVE-RECORD — F01-EMB (F-01-EMB embedding invariant closure, v0.7.1)

**Date:** 2026-09-24 · **Spec:** `SPEC-F01-EMB` (`ROADMAP.md` §1.3 `F-01-EMB` + `docs/CONTRACT.md` §3 tier-1 (b) named residual)
**Gate verdict:** ✅ OPEN — 5 reviewers (reliability PASS, security PASS, readability PASS, automation CONDITIONAL→cleared by CI 36044780528, QA CONDITIONAL 2 Low accepted), 0 Critical/High, no waivers
**Commits:** `f772e45` (feat F-01-EMB code + docs + seams) · this `chore(release-0.7.1)` commit
**Tag:** v0.7.1 (after commit)
**Promoted (copied, survive the purge):** `SPEC-F01-EMB.md` (moved) · `ARCHIVE-RECORD.md` (this file) — GATE_REPORT + HANDOFF promoted as docs/CONTRACT v1.6 + ROADMAP CLOSED + evidence logs (typecheck/verify-lifecycle/probe4/verify/bootstrap) are the audit trail; no separate GATE_REPORT.md was persisted for this lane (handoff FH-01)
**Purged (allowlist only):** `40_workspace/engineering/PROPOSED_CHANGES.md` + `40_workspace/engineering/ARCHITECTURE_REVIEW.md` + `40_workspace/quality-gate/F01-EMB/` (not yet materialized — purge N/A with justification)
**ADR link:** none (no contract-surface change — projection widening internal only; architecture review "no ADR")
**Release notes:** `docs/specs/30_delivery/RELEASE_NOTES.md` v0.7.1 section
**Rollback:** reverse-order whole-commit revert of `f772e45` + this release commit; check out tag **v0.7.0** for full undo. No schema/index/migration. Owner: engineering. ETA: immediate.
