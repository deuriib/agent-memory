# Implementation Plan: P0 (Publishable foundations)

**Agent:** orchestrator (execute-spec lane)
**Date:** 2026-09-22
**Approved By:** user ("continue with p0 completely" → "Go"; defaults adopted:
3111 stays our parity default with reroute procedure, legacy `AGENTMEMORY_*`
names get a deprecation fallback, persistence = `helix start dev --disk
--persist`)
**Domains-Touched:** engineering (code + CI), docs/security (governance files),
ops (helix storage migration)
**Prior lane:** P3.1 closed at v0.2.0 (commits `d724f66`…`1d465b9`); its
evidence stays in git history and `docs/specs/30_delivery/RELEASE_NOTES.md`.

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | CI workflow: push/PR → `npm ci` + `typecheck` + `verify-injection` + pinned gitleaks secret scan | `.github/workflows/ci.yml` (new) | workflow file + local equivalent run | S |
| 2 | Governance docs: `SECURITY.md`, `CONTRIBUTING.md` (new); link both + `CHANGELOG.md` from README | `SECURITY.md`, `CONTRIBUTING.md`, `README.md` | file presence + README links resolve | S |
| 3 | Persistence: `helix start dev --disk --persist` (settings land in `helix.toml`); bootstrap warns when `helix.toml` lacks `storage = "disk"` (config-based advisory — `helix status` reads config too); README quick start becomes the durable path | `helix.toml`, `scripts/bootstrap.ts`, `README.md` | save → `helix restart dev` → save still searchable | M |
| 4 | Env migration: legacy `AGENTMEMORY_*` fallback (new name wins) with name-only stderr warning in server/MCP/bootstrap; SILENT fallback in hooks/plugin (zero-output guarantee); `EADDRINUSE` prints the `3151` reroute + never-kill-upstream note | `src/env.ts` (new), `src/auth.ts`, `src/server.ts`, `scripts/verify.ts`, `hooks/capture.mjs`, `plugins/antigravity/scripts/*.mjs`, `.opencode/plugins/agent-memory.ts` | `scripts/verify-env.ts` (new): legacy-secret guard armed + port-conflict hint — **VERIFY PASS, 21/21 (2026-09-22)**; MCP covered via `secretFromEnv` (no `mcp.ts` edit needed) | M |
| 5 | README: definitive port ownership statement (ours = 3111 by parity; upstream `iii` may hold 3111/3112/3113 → `AGENT_MEMORY_PORT=3151`, point plugin/hooks via `AGENT_MEMORY_URL`); legacy-env + persistence notes in Configuration | `README.md` | diff vs Known-limitations #1/#2 | S |
| 6 | Quality checks: `typecheck`, `verify-injection`, `verify` vs our server on **3151**, `verify-env`, gitleaks locally | repo root | CI-equivalent local run + TEST_MATRIX | S |
| 7 | ROADMAP: tick P0 rows ✅ with evidence pointers; fill TEST_MATRIX | `ROADMAP.md`, `TEST_MATRIX.md` | diff | S |

## Order of Operations

1 (CI scaffolding) ∥ 2 (docs) ∥ 4 (code) in parallel subagent lanes — disjoint
file sets, no lane touches another's files. 3 (helix storage migration)
runs concurrently on the orchestrator side (touches `helix.toml` only via the
helix CLI). 5 after 4's behavior is final (README documents shipped code).
6 last, then 7.

## Rollback Points

- After step 2: revert the two new `.md` files + README links — no code touched.
- After step 4: revert the seven touched sources; `verify-env.ts` is additive.
- After step 3: `helix start dev` without `--disk` restores memory mode; the
  `helix.toml` `--persist` diff reverts cleanly. Assumption stated: current
  in-memory dev data is disposable seed/verify data — any restart loses it
  regardless, which is the defect P0.4 fixes.
- After step 6: full revert to pre-lane state.

## Quality Gates

- [x] Engineering: `npm run typecheck` clean (no `any`, no `@ts-ignore`, no TODO) — exit 0, 2026-09-22 (re-run after bootstrap advisory landed)
- [x] Engineering: `npx tsx scripts/verify-injection.ts` green — ALL PASS, 73 assertions, 2026-09-22 (count corrected from an earlier mis-citation of 70; independently reproduced by all gate reviewers)
- [x] Engineering: `npm run verify` green against **our** server (`AGENT_MEMORY_URL=http://127.0.0.1:3151`); upstream `iii` on 3111 untouched (identity guard proves it) — 102/102 VERIFY PASS, 2026-09-22
- [x] Engineering: `npx tsx scripts/verify-env.ts` green (legacy env arms guard; EADDRINUSE prints reroute hint) — 21/21, 2026-09-22
- [x] Ops/persistence: save → `helix restart dev` → same memory still searchable (P0.4 acceptance) — original canary `228cdf69` BM25 0.863 post-restart, storage stayed `disk`; **artifact-backed rerun** 2026-09-22: token `p04canary1790108269` found on the first post-restart attempt, full log `docs/specs/50_archive/P0/evidence/p0-4-restart-canary.log` (closes QA-04 single-source)
- [x] Security: gitleaks scan clean locally and pinned in CI (P0.2 acceptance) — full history `no leaks found` (v8.30.1; QA re-run: 25 commits scanned of 26 in history), CI job pinned by sha256, **green on `main`**: run [35781376642](https://github.com/deuriib/agent-memory/actions/runs/35781376642) (`verify` + `secret-scan` success, merge of PR #1), 2026-09-22
- [x] Docs: `LICENSE` (P0.1, pre-existing) + `SECURITY.md` + `CONTRIBUTING.md` + `CHANGELOG.md` all present and linked from README (P0.3) — verified by review, 2026-09-22
- [x] Automation/ops: no new required env vars; legacy names are read-only fallbacks; `AGENTMEMORY_*` warning never prints values — enforced by `scripts/verify-env.ts` (warn-name-never-value + hook-silence checks, 2026-09-22)
- N/A: finance / legal / marketing / people / revenue (engineering + docs change)
