# ARCHIVE-RECORD — SPEC-020-todos (Todos follow-ups para agentes, v0.9.0)

**Date:** 2026-09-25 · **Spec:** `SPEC-020-todos` (`docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-01..07` + security addendum `SPEC-020-todos-security.md#REQ-SEC-TODO-01..08`) — bounded-initiative, BRIEF-todos approved 2026-09-25
**Gate verdict:** ✅ OPEN — 5/5 PASS, zero Critical/High/Medium open, zero ❌, zero conditional — see `GATE_REPORT.md` in this directory (consolidated QA PASS + security-reviewer PASS + automation-reviewer PASS; arch Approved no ADR §6 + sec Approved STRIDE 0 High/3 Low; R1+R2+R8 sign-offs, R8 countersignature pending non-blocking)
**Commits:** lane touching 7 files `db/queries.ts` (LABELS.Todo + 12 indexes + 6 builders), `src/store.ts` (TodoRow + filterTodos sort + parentId fail-closed), `src/server.ts` (zod schemas + alias rewriter + 6 routes + frontier), `src/mcp.ts` (6 tools via handle), `plugins/opencode/plugins/agent-memory.ts` (6 tools total 11), `hooks/capture.mjs` (extractTodos 3×1.5s), `scripts/bootstrap.ts` (12 indexes) — plus docs `docs/specs/10_design/ARCHITECTURE.md` v2 canonical §6-§10 + `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` 7 rows, `ARCHITECTURE_REVIEW.md` Approved, `SECURITY_REVIEW.md` Approved; this `chore(release-0.9.0)` commit
**Tag:** v0.9.0 (after commit)
**Promoted (survive the purge, copied/moved to 50_archive/SPEC-020-todos/):**
- `SPEC-020-todos.md` — moved via `mv` from `docs/specs/20_backlog/` (R rename, untracked → tracked)
- `SPEC-020-todos-security.md` — moved via `mv` from `docs/specs/20_backlog/` (security addendum, R rename)
- `GATE_REPORT.md` — copied from `docs/specs/40_workspace/quality-gate/SPEC-020-todos/quality-assurance.md` (consolidated QA PASS, 4 suites + bootstrap 12 + 8 E2E flows)
- `HANDOFF.md` — copied from `docs/specs/40_workspace/engineering/HANDOFF.md` (DoD PASS, 10/10 REQ→test traces, 6 Low residuals)
- `security-reviewer.md` — copied from `docs/specs/40_workspace/quality-gate/SPEC-020-todos/security-reviewer.md` (STRIDE re-check PASS)
- `automation-reviewer.md` — copied from `docs/specs/40_workspace/quality-gate/SPEC-020-todos/automation-reviewer.md` (R8 6/6 checks PASS)
- `ARCHIVE-RECORD.md` — this file (audit trail, purge accounting)
**Purged (allowlist only, this spec — ships after promotion):**
- `docs/specs/40_workspace/quality-gate/SPEC-020-todos/` — 3 reviewer artifacts + `GATE_REPORT.md` (promoted copy above is the audit trail): `quality-assurance.md`, `security-reviewer.md`, `automation-reviewer.md` (directory removed after copy)
- `docs/specs/40_workspace/engineering/HANDOFF.md` — promoted copy above is the audit trail (original removed if present; retained only as archive copy)
- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` — lane singleton (proposal phase, 7 rows) — **not purged** (singleton contains prior lanes Lane 1-2; retained per allowlist exception — only 20_backlog spec moved)
**Not purged (retained per allowlist):**
- `docs/specs/40_workspace/engineering/ARCHITECTURE_REVIEW.md` — not in purge allowlist, retained (Lane 1-3 singleton, 42K)
- `docs/specs/40_workspace/engineering/SECURITY_REVIEW.md` — not in purge allowlist, retained (Lane 3 22K)
- `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` — retained as above (singleton, not lane-exclusive)
- `docs/briefs/BRIEF-todos.md` + `docs/briefs/OKR-todos.md` — briefs, retained (outside allowlist)
- `docs/specs/10_design/ARCHITECTURE.md` v2 — canonical, retained (already merged in translate-to-spec)
- `IMPLEMENTATION_PLAN.md` (repo root) — lane plan singleton, retained (outside allowlist)
- `TEST_MATRIX.md` (repo root) — lane evidence singleton, retained (outside allowlist)
- `docs/specs/40_workspace/quality-gate/` — directory retained (empty after SPEC-020-todos purge; other lanes untouched — verified no other lane dirs present at purge time)
**ADR link:** none (no `docs/CONTRACT.md` change — `ARCHITECTURE_REVIEW.md` Approved no ADR (§6) — triggers reserved: PARENT_OF edge, dedicated parentId/todo_description index, new label/component beyond Todo, invariant/cross-domain delta → mint `docs/specs/12_adr/ADR-012-todos.md` proposed)
**Release notes:** `docs/specs/30_delivery/RELEASE_NOTES.md` v0.9.0 section (ship type deploy, highlights 12 indexes CRUD+frontier alias search priority parentId MCP 6 plugin 6 hooks 3×1.5s, rollback plan revert 7 files bootstrap 8, tag v0.9.0)
**Rollback:** reverse-order whole-commit revert of lane 7 files + this release commit; full undo at tag **v0.8.0** (`git checkout v0.8.0 -- db/queries.ts src/store.ts src/server.ts src/mcp.ts plugins/opencode/plugins/agent-memory.ts hooks/capture.mjs scripts/bootstrap.ts package.json package-lock.json README.md` + delete `Todo` label data via `deleteTodo` per `todoId` or Helix label drop, bootstrap 12→8). No `helix.toml` shape change beyond `bootstrapIndexes` expectation; no migration. Owner: engineering + orchestrator. ETA: immediate.
**PII checkpoint (Ley 172-13):** Zero PII/secrets/tokens in this record — allowlisted evidence only (ports, counts, PIDs, verdicts, `~`-collapsed paths, owners by role); `AGENT_MEMORY_SECRET` presence-only; hook titles `clean 0..120` never prompt text.
