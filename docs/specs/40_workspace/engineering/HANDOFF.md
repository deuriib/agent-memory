# Handoff: orchestrator (execute-spec → quality-gate → verify-handoff lane)

**Spec Reference:** P3.1 — ROADMAP.md §P3 "MCP tool parity for the useful subset"
**Agent:** orchestrator (frame-ship lane; single = direct verify, no dispatch)
**Date:** 2026-09-22
**Status:** complete
**Domains-Touched:** engineering, security, data lens

## Deliverables

| Artifact | Location / Evidence | Status |
|----------|---------------------|--------|
| REST: `recap`, `handoff`, `lesson`, governance `delete` | `src/server.ts` (`d724f66` + remediation `5df18b6`, `3221b93`, `addc589`) | done |
| MCP: `memory_recap/handoff/lesson/delete` (11 tools total) | `src/mcp.ts` (`fb2e451` + remediation `5df18b6`, `3221b93`, `addc589`); handshake probe = 11 tools, bounds advertised | done |
| Shared digest module with 20s budget | `src/digest.ts` (`3221b93`) | done |
| Contract amendment §3/§4/§5 + governance-log declaration + allowlist/masking | `docs/CONTRACT.md` (`33849ee`, `f2a65d4`, `d7a7628`) | done |
| Tests / Evidence | `scripts/verify.ts` section N + identity guard + membership assertion (`e3abc6e`, `bfc10c5`); **102 passed, 0 failed → VERIFY PASS** against our server; `npm run typecheck` green | done |
| Trace matrix | `TEST_MATRIX.md` — REQ-P31-1..6 + gate remediation rows, every row commit-linked | done |
| Implementation plan | `IMPLEMENTATION_PLAN.md` — steps, rollback points, all quality gates checked | done |
| Docs | `README.md` — route table (12 rows), MCP table (11 tools), lesson/delete example, verification bar, strictness notes (`77f292f`, `fff74ad`, `d7a7628`) | done |
| Quality gate record | `docs/specs/40_workspace/quality-gate/P31/GATE_REPORT.md` — **OPEN**, 8 independent reviews + C3 17/17 (`0fe0b97`) | done |
| Waivers W1–W4 (three-block, signed, expiring 2026-12-21) | `docs/specs/40_workspace/quality-gate/P31/waivers.md` | done |
| Domain artifact | N/A — no filings/contracts/campaigns in scope | N/A |

## Definition of Done Checklist

Common:

- [x] Acceptance criteria satisfied — P3.1 "recap, handoff, lesson,
  governance-style delete; each round-trips against the REST contract":
  full chain asserted in verify §N (lesson → search `origin:"lesson"` →
  recap membership → handoff header/counts → governed delete → receipt →
  gone → second delete 404 → counts); MCP parity proven by handshake.
- [x] Tests/evidence linked per REQ-ID — C4: every REQ-P31-1..6 and every
  COND/C3/W row links a commit or artifact; all 14 cited commits resolve
  (`git cat-file -e` clean), all 11 gate artifacts present; zero
  attestation-only rows.
- [x] C4 FAIL lists residual-risk + owner — no C4 FAILs; C3 residuals (8
  lines) carry explicit owners in `c3-interrogation.md`; waiver residuals
  explicit in `waivers.md`.
- [x] Edge cases / failure modes handled — signals degradation never-500,
  digest budget + signal, identity guard pre-write abort, empty digest
  `count:0`, 400/404/405/413/415 boundary matrix in verify §L+§N.
- [x] Gate OPEN — `GATE_REPORT.md` status OPEN (4 pass + 4 conditional with
  every condition cleared and proof; C3 17/17 PASS after waiver records).
- [x] Load evidence — `skill(frame-ship:quality-gate)` + `skill(frame-ship:verify-handoff)`
  cited with template paths (`references/gate-report.md`, `references/dod-checklist.md`,
  `references/handoff-template.md`); execution_mode `subagents` (9 reviewer
  subagents, 1 per reviewer); packet reference-only throughout.
- [x] Docs/changelog updated for user-facing impact — README + CONTRACT fully
  updated; **CHANGELOG entry: N/A-justified** — repo has no `CHANGELOG.md`
  yet (P0.3, outstanding); README/CONTRACT are the user-facing record for
  this lane. Flagged for ship-release below.

Engineering appendix:

- [x] Lint — **N/A-justified**: repo defines no linter (package.json has
  typecheck only); repo bar = `tsc --noEmit` strict, green, plus no
  `any`/`@ts-ignore`/`TODO`/`FIXME` anywhere in `src/ scripts/ hooks/ db/`
  (grep-clean this session).
- [x] Type checks pass — `TYPECHECK_OK` after every commit.
- [x] Test coverage meets threshold — repo threshold = typecheck + E2E
  `verify` (102/0); every REST surface incl. all 4 new routes has E2E
  assertions; MCP behavioral E2E remains a NAMED LIMITATION (QA F-4),
  mitigated by the shared `src/digest.ts`.
- [x] No TODO/FIXME left in code — verified by grep above.

Security appendix:

- [x] Security review conditions met — SEC-001/002/003 cleared
  (`5df18b6`, `f2a65d4`+`d7a7628`, `fff74ad`+W1); security-reviewer
  conditions closed with proof; C3 security-owned PASS.
- [x] No secrets in code/config/logs/examples — access log
  method/path/status/duration only; governance line field allowlist
  (`d7a7628`); secret never echoed/logged (auth matrix + reviewers).
- [x] Input validation at all boundaries — strict zod unknown-first on all
  12 routes; bounds on both sides of normalize (`addc589`); 1 MiB body cap;
  `_meta.authorization` gate on all 11 MCP tools.

Data lens appendix:

- [x] Lineage/schema/migration — contract §1/§2 hash-identical, zero
  diff in `db/queries.ts`/`helix.toml` (verified by data reviewer);
  no migration/backfill exists or needed.
- [x] PII handling signed — governance log purpose + TTL/deletion + field
  allowlist declared (`docs/CONTRACT.md` §3); waivers carry PII checkpoint;
  zero PII in all gate artifacts (C3-confirmed).

Ops appendix:

- [x] Automation/ops — no new env vars, ports, or deployment surface
  (plan gate checked, `fff74ad`); rollback = deterministic revert of the
  P3.1 commit range, no schema/index change (risk review: ≤15 min).

Finance / Legal / Marketing / People / Revenue appendices: N/A — not touched.

Documentation:

- [x] API docs updated — README route/tool tables + examples; `docs/CONTRACT.md`
  §3 (routes/tools) and §5 (verification bar) amended.
- [x] Changelog — N/A-justified above (P0.3 outstanding); open item routed below.
- [x] ADR — N/A-justified: additive route/tool additions inside the existing
  architecture; no public API shape changed, no data-model/cross-cutting
  change; the sanctioned contract amendment (`33849ee`) is the git-tracked
  record.

## Blockers / Open Questions

1. **Upstream residue:** pre-guard verify run wrote project
   `verify-18637b3b` into the user's upstream `agentmemory` (3111); upstream
   is currently DOWN with a stale pid file. Purge = owner's call (their
   instance): when it's back, enumerate
   `GET /agentmemory/sessions?project=verify-18637b3b` →
   `GET …/memories` → `POST /agentmemory/forget {memoryId}` per row, then
   health → 0. Recurrence prevented by the identity guard (`bfc10c5`).
   Owner: user/deploying operator. Not a P3.1 code defect.
2. **CHANGELOG.md absent** (P0.3) — ship-release needs it or an explicit
   N/A from the owner.
3. **MCP behavioral E2E** still unasserted (QA F-4, accepted W1-adjacent
   residual) — would need a stdio harness; recommend P3.x follow-up.

## Next Agent

`frame-ship:ship-release` — inputs: gate OPEN report
(`docs/specs/40_workspace/quality-gate/P31/GATE_REPORT.md`), this HANDOFF,
commit range `e9fd325..0fe0b97` (14 P3.1 commits). Needs: release-notes entry for
the 4 REST routes + 4 MCP tools (12 routes / 11 tools surface), CHANGELOG
decision (create per P0.3 or explicit N/A), rollback plan = revert range
(no schema change). Owner sign-off on Blocker #1 (upstream purge) preferred
before tagging.
