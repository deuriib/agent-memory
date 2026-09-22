# Readability Review: P3.1

**Reviewer:** review-readability
**Date:** 2026-09-22
**Verdict:** PASS

## Checklist

- [x] Naming is intention-revealing (no `data`, `tmp`, `x`)
- [x] Functions have single responsibility
- [x] Nesting depth <= 3
- [x] Comments explain WHY, not WHAT
- [x] Public APIs documented
- [x] No dead code or commented-out blocks
- [ ] Consistent style with surrounding code — see RD-001 (cross-file duplication) and RD-003 (README row style)

## Findings

| ID | Severity | Location | Finding |
|----|----------|---------|---------|
| RD-001 | Medium | `src/server.ts:197-255` vs `src/mcp.ts:99-158` (also header lines `src/server.ts:407` / `src/mcp.ts:352`) | The digest assembly (`DigestInput`, `DigestLines`, `buildDigestLines`, ~60 lines) and the handoff `counts`+header composition are duplicated verbatim in both files. The in-file comment documents the WHY (scope limited to server.ts/mcp.ts), so intent is clear — but contract §3 freezes "the four P3.1 tools mirror the REST bodies/response shapes", and `scripts/verify.ts:469-470` states the MCP mirrors are NOT asserted (REST-only script). Parity is therefore by convention across two copies with no test catching drift: a future edit to one copy silently breaks the frozen mirror. Readability cost: a reader must diff two 60-line blocks to confirm they still match. Recommendation (implementer/orchestrator, not this reviewer): extract a shared `digest.ts` module or file an explicit follow-up ticket referencing this line. |
| RD-002 | Low | `IMPLEMENTATION_PLAN.md:46` | Quality-gates list ends with an unchecked `- [ ] Automation/ops: no new env vars, ports, or deployment surface…` while every other line is `[x]` or explicitly `- N/A:`. A reader can't tell "pending" from "not applicable"; mark it N/A or check it with evidence. |
| RD-003 | Low | `README.md:105-108` (route table) | New P3.1 rows list `400` outcomes (`… / 400 / 404`, `… / 400`) while all pre-existing rows omit 400 even though the same zod validation applies to them. Harmless but slightly inconsistent — a reader may infer 400 applies only to the new routes. |

## What reads well (evidence for the passing items)

- Comments explain WHY: governance-log rationale (`src/server.ts:443-444`, `src/mcp.ts:397-398` — "reason is caller-supplied metadata — never memory content, never the secret"; stderr-vs-stdout for MCP), and the catch-scope note `src/server.ts:249` / `src/mcp.ts:150` ("appendSession never throws… this catch is listSessions only") — no WHAT-comments added.
- Style matches surrounding code: module-level strict zod schemas follow the existing `*BodySchema` pattern (`recapBodySchema`, `lessonBodySchema`, `deleteBodySchema`), section banners match server.ts's frozen-table banner style, MCP tools reuse the existing `handle()` gate + `ok()`/`failed()` helpers, const naming (`LESSON_ORIGIN`, `reasonSchema`) is intention-revealing.
- Public surfaces documented and mutually consistent: `docs/CONTRACT.md` §3 rows + composition-rule paragraph, README route/MCP tables (`11 tools` in README, contract, and the `src/mcp.ts` header comment), TEST_MATRIX REQ→evidence→commit trace, and the implemented `RememberResult` shape (`{id, sessionId, project, concepts}`, `src/store.ts:104-109`) all agree.
- No dead code, no commented-out blocks, no `any`/`@ts-ignore`/`TODO` in the diff; `npm run typecheck` green on review.

## Verdict Rationale

Naming, single-responsibility, why-comments, and doc consistency are all clean, and typecheck is green; the one Medium (RD-001) is an acknowledged, documented trade-off with a scheduled-fix profile (drift risk, not immediate defect), and the two Lows are hygiene — none block the gate, so PASS with findings recorded for the gate report.
