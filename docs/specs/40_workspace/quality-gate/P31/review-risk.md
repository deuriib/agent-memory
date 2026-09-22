# Risk Review: P3.1

**Reviewer:** review-risk
**Date:** 2026-09-22
**Verdict:** CONDITIONAL

Scope: `git diff e9fd325..HEAD` (6 commits), reviewed against
`frame-ship/skills/quality-gate/references/engineering/risk-review.md`.
Domain: operational / compatibility / change risk only.

## Checklist

- [x] Blast radius analysis bounded and verified — 7 files, +659/−16; `git diff --name-only` shows `hooks/`, `db/queries.ts`, `helix.toml` untouched (additive-only holds).
- [~] Backward compatibility preserved — 8 REST routes and 7 MCP tools byte-unchanged (diff only appends after them; exact-path match, no shadowing); no renames. Residual: external clients asserting "exactly 7 tools" see 11 (in-repo assertions updated).
- [x] Dependencies pinned; zero new CVE surface — `package.json` not in the diff.
- [x] Rollback determinism — pure revert of 6 commits, no schema/index/migration change; `origin:"lesson"` rows persist as inert data. ≤15 min.
- [~] Architectural contract invariants intact — header rules (no renaming exports/routes) respected; §4 "do not build lessons/recap/handoff" clause removed via sanctioned REQ-P31-3 commit (see RK-P31-4).
- [ ] Zero unmitigated regression risk — 1 High + 2 Medium open (RK-P31-1, RK-P31-3, RK-P31-7).

## Risk Assessment Matrix

| ID | Risk Dimension | Sev | Location | Evidence | Mitigation | Residual |
|----|----------------|-----|----------|----------|------------|----------|
| RK-P31-1 | Log forgery via verbatim caller `reason` | **High** | `src/server.ts:446` (console.log), `src/mcp.ts:400` (console.error); `reasonSchema` at `src/server.ts:44` = `z.string().trim().min(1).max(1000)` | `trim()` strips only ends — embedded `\n` passes. A caller can POST `"ok\n[agentmemory] delete governance memoryId=fake …"` and inject forged governance lines into the very audit log that justifies deletions. Repo already has a whitespace-collapsing helper (`trimmed()`, `src/errors.ts:20-23`) that was not reused. Bounded at 1000 chars (entropy capped, secret never involved). | One-line sanitize (collapse `\s+` / reuse `trimmed`) before interpolation, both lanes. | Low after sanitize |
| RK-P31-2 | Governance receipt omits `reason` | Low | `src/server.ts:447-451`, `src/mcp.ts:402-404` — receipt = `{memoryId, deletedAt}` | Deliberate per contract §3 ("reason … logged as one governance line; access log stays method/path/status"). But the caller's durable receipt carries no justification — if the process log rotates/is lost, no receipt↔reason link survives. MCP lane writes to stderr, REST to stdout: log shipping must collect both streams. | Accept as documented design, or thread `reason` into receipt in a future contract rev. | Low (accepted, documented) |
| RK-P31-3 | Digest logic duplicated → dual-lane drift | **Medium** | `buildDigestLines` + `DigestInput`/`DigestLines` verbatim in `src/server.ts:197-253` and `src/mcp.ts:99-159` | Implementer's own comment: "kept in-file because only server.ts and mcp.ts are in scope" — drift is assumed, not prevented. Aggravating: `scripts/verify.ts:469-470` explicitly states the MCP mirrors (`memory_recap/handoff/lesson/delete`) are **NOT asserted** — T-002 checks registration + schema shape only. A behavioral divergence between REST and MCP digests would pass every gate check. | Extract shared helper (out of P3.1 scope) OR add MCP `tools/call` behavior assertions to verify. | Medium until tested |
| RK-P31-4 | "Frozen" contract §3/§4 amendment (two-lane discipline) | Low | `docs/CONTRACT.md` — 4 rows added to §3, "lessons/recap/handoff routes" removed from §4 out-of-scope list | Header contract: source of truth for both build lanes, "do not rename exports or routes". Amendment renames nothing, removes no existing construct — purely additive, sanctioned via REQ-P31-3 (`TEST_MATRIX.md:11`, commit 33849ee). ROADMAP.md:104 is the proven gap that authorizes it. Residual: any second lane must re-sync to the amended contract. | Git-history-tracked contract change (done). | Low |
| RK-P31-5 | Frozen MCP surface 7→11 vs "focused surface" principle | Info | `src/mcp.ts` registerTools +4; `docs/CONTRACT.md` §3 | ROADMAP.md:104 (`P3.1`) names exactly these 4 tools as the roadmap item — this *is* the proven gap. §4 still excludes the upstream 54-tool surface; exactly 4 tools added, none speculative. Principle intact. | n/a | None |
| RK-P31-6 | Backward compat of 8 routes / 7 tools / clients | Info | diff of `routeRequest` + `registerTools` | Existing route branches and tool registrations byte-identical (only header comment + `failureSignal` import changed in mcp.ts). No deps added. MCP protocol addition is additive; only an external client hard-asserting `tools.length === 7` would notice — in-repo assertions updated to 11. | n/a | None |
| RK-P31-7 | Gate evidence not reproducible as stated; verify writes into upstream | **High** | `scripts/verify.ts:22` (`AGENT_MEMORY_URL ?? http://127.0.0.1:3111`, no server-identity check); CONTRACT port-conflict note (lines 189-193) | Independent reviewer run of `npm run verify` today: **FAIL, not 101/0** — port 3111 is held by upstream `agentmemory` (pid 2901, `iii`), the documented *normal* state ("never kill the user's upstream instance"). verify hit upstream, got 201s on `remember`, then failed on body-shape — i.e., it **wrote test rows (project `verify-18637b3b`) into the user's non-owned upstream service** before failing. Gate evidence (101 passed) is therefore only reproducible with the undocumented-in-the-bar `AGENT_MEMORY_URL=http://127.0.0.1:3151` override. Root cause pre-existing, but the P3.1 gate's headline evidence depends on this path. | Server-identity guard in verify (health banner/version check before first write) + README verify entry showing the 3151 invocation. | Medium after guard |

## Findings count

7 findings: 2 High (RK-P31-1, RK-P31-7), 2 Medium (RK-P31-3; RK-P31-2 Low, RK-P31-4 Low, RK-P31-5/6 Info).

## Verdict Rationale

CONDITIONAL: the change itself is disciplined — additive-only verified, rollback deterministic, backward compat intact, frozen-surface expansion explicitly authorized by ROADMAP P3.1, contract amendment sanctioned and additive. But three items need mitigation or explicit owner acceptance before GATE closure: verbatim caller `reason` in the governance log enables log forgery (High, one-line fix, both lanes), the gate's own evidence does not reproduce as stated and a plain `npm run verify` writes into the user's upstream instance (High, pre-existing root cause), and the duplicated digest has zero behavioral test coverage on the MCP lane, so drift is undetected by construction (Medium). No Critical. No code was modified by this reviewer; disclosure: my `npm run verify` reproduction wrote `verify-*` test rows into upstream `agentmemory` on 127.0.0.1:3111 as a side effect of RK-P31-7 (this repo's files untouched).
