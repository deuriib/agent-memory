# Test / Evidence Matrix: P3.1

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Domains-Touched:** engineering

| REQ-ID | Evidence ID | Description | Type | Status | Commit |
|--------|-------------|-------------|------|--------|--------|
| REQ-P31-1 | T-001 | 4 REST routes (`recap`, `handoff`, `lesson`, `delete`) round-trip per contract §3: 201/200 shapes, 404 on unknown delete, 400 on bad bodies | Integration | pass | d724f66 |
| REQ-P31-2 | T-002 | 4 MCP tools (`memory_recap`, `memory_handoff`, `memory_lesson`, `memory_delete`) registered; input schemas mirror REST; `_meta.authorization` gate unchanged | Integration | pass | fb2e451 |
| REQ-P31-3 | T-003 | `docs/CONTRACT.md` §3 lists 4 new rows, §4 no longer excludes lessons/recap/handoff, §5 verification bar extended | Review | pass | 33849ee |
| REQ-P31-4 | T-004 | `scripts/verify.ts` P3.1 section: lesson → bm25 search hits it → recap contains content → handoff contains content → governed delete removes it → second delete 404 → health count reflects it | E2E | pass | e3abc6e |
| REQ-P31-5 | T-005 | README route table, MCP tool table, and examples updated for the 4 additions | Review | pass | 77f292f |
| REQ-P31-6 | T-006 | `npm run typecheck` clean after the change (no `any`, no `@ts-ignore`, no TODO) — green after every lane commit and after `verify.ts` changes | Unit | pass | fb2e451 |

## Coverage Summary

- Unit coverage: N/A (no unit framework in repo — repo bar is `typecheck` + E2E `verify`)
- Integration coverage: 4/4 new surfaces exercised by `scripts/verify.ts`
- Evidence coverage: 6/6 REQ-IDs with linked artifact
- Acceptance criteria covered: P3.1 ("each round-trips against the REST
  contract") → T-001 + T-004; MCP parity → T-002
