# Implementation Plan: P3.1 (MCP tool parity for the useful subset)

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Approved By:** user (proposal accepted with "Go"; defaults adopted: lesson =
remember-with-origin, governance delete = new `/agentmemory/delete` route)
**Domains-Touched:** engineering (code + contract docs only)

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | Amend frozen contract: add 4 §3 rows (recap/handoff/lesson/delete), move them out of §4, extend §5 verification bar | `docs/CONTRACT.md` | diff + typecheck | S |
| 2 | Add 4 REST routes: `POST /agentmemory/recap`, `/handoff`, `/lesson`, `/delete` — composed from existing `MemoryStore` methods, strict zod, same auth/log/error rules | `src/server.ts` | `scripts/verify.ts` section N round-trip | M |
| 3 | Add 4 MCP tools: `memory_recap`, `memory_handoff`, `memory_lesson`, `memory_delete` — same store, `_meta.authorization` gate unchanged | `src/mcp.ts` | MCP handshake/tool-call check | M |
| 4 | Extend end-to-end verification: lesson → search hits → recap contains → handoff contains → governed delete → gone → second delete 404 → health count reflects it | `scripts/verify.ts` | `npm run verify` output | M |
| 5 | Update README route + MCP tool tables and examples for the 4 additions | `README.md` | diff | S |
| 6 | Quality checks: `npm run typecheck`, `npm run verify` against running instance | repo root | CI-equivalent local run | S |

Each step maps to one commit (REQ-ID trace, see `TEST_MATRIX.md`).

## Order of Operations

1 → contract first (§3 freezes the shapes) → 2/3 can proceed in parallel
(server and MCP are independent files over the same store) → 4 depends on 2
(verify hits REST) → 5 after shapes final → 6 last.

## Rollback Points

- After step 1: revert `docs/CONTRACT.md` — no code touched yet.
- After step 3: revert `src/server.ts` + `src/mcp.ts` + contract; `db/queries.ts`
  is untouched by design, so no schema rollback exists or is needed.
- After step 6: full revert to pre-lane state; data written by verify uses a
  unique throwaway `project`, no cleanup required.

## Quality Gates

- [x] Engineering: `npm run typecheck` clean (no `any`, no `@ts-ignore`, no TODO) — green after every commit, final run `TYPECHECK_OK`
- [x] Engineering: `npm run verify` green including the new P3.1 section — `102 passed, 0 failed → VERIFY PASS` (run on `AGENT_MEMORY_PORT=3151`; `3111` held by upstream `iii`, untouched; post-remediation count includes the identity-guard probe + recap membership assertion)
- [x] Engineering/security: 4 new routes behind the same bearer guard (`livez`
  remains the only exemption); no secret or memory content in logs — inherited
  guard by path prefix; governance line logs caller-supplied `reason` + id only
- [x] Contract: `docs/CONTRACT.md` §3/§4/§5 consistent with shipped routes —
  MCP handshake probe lists exactly 11 tools incl. the 4 new
- N/A: finance / legal / marketing / people / revenue (engineering-only change)
- [x] Automation/ops: no new env vars, ports, or deployment surface introduced —
      satisfied: P3.1 adds none (`package.json`, `helix.toml`, hooks untouched;
      only the pre-existing `AGENT_MEMORY_URL`/`AGENT_MEMORY_PORT` overrides are
      used)
