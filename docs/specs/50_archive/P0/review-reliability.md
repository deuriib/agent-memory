# Reliability Review: P0 (quality-gate)

**Reviewer:** review-reliability (independent subagent — did NOT author this work)
**Date:** 2026-09-22
**Checklist:** `frame-ship/skills/quality-gate/references/engineering/reliability-review.md`
**Lens:** (a) `readLegacyEnv` caller semantics · (b) warning dedupe · (c) warn-only-when-used ·
(d) hooks/plugin `??` divergence · (e) verify.ts silent fallback · (f) exit codes + reaping ·
(g) script wiring · (h) bootstrap advisory false negatives
**Verdict:** ⚠️ **conditional** — all recorded gates green, no Critical/High; two Medium
edge-config findings must be scheduled (not merged-blocking).

## Checklist

- [x] Error paths handled explicitly — `EADDRINUSE` → hint + exit 1 (`src/server.ts:526-532`);
      invalid boot port → explicit throw + message (`src/server.ts:477-483`); hooks fail-soft by
      contract (documented, always exit 0).
- [x] No swallowed exceptions — every swallow is deliberate and documented at the swallow site
      (hook zero-output contract; `bootstrap.ts:46-48` advisory-only catch; 500s logged via
      `logSafeNote` in `respondToError`).
- [x] Input validation at boundaries — every route body/query `unknown` → zod `.strict()`
      (`src/server.ts:41-137`).
- [x] Deterministic behavior (no hidden state) — the `warnedLegacy` Set (`src/env.ts:25`) is
      hidden state but documented, keyed per variable, and per-process by contract.
- [ ] Edge cases tested (empty, null, max, boundary) — **gap**: no test covers the
      *set-but-empty new name* + legacy-set combination; that exact config is RL-001.
      (Empty body, unknown id, wrong method, oversize, 415 etc. are covered: verify 102/102.)
- [x] Idempotency where required — marker-guarded injection re-verified green (verify-injection
      ALL PASS, re-run by this reviewer).
- [x] Timeout on external calls — `AbortSignal.timeout` everywhere: hooks 2s (capture) / 1.5s
      (recall), plugin 2s/1.5s, verify 10s, verify-env 5s/1.5s, bootstrap 30s cap.

## Failure Modes Analyzed

| ID | Failure Mode | Expected Behavior | Handled? |
|----|--------------|-------------------|----------|
| FM-001 | Server boots with only legacy `AGENTMEMORY_*` names | Value used, ONE name-only stderr warning per var, guard armed | yes — `src/env.ts:42-51`; verify-env A, recorded 21/21 |
| FM-002 | New name **set-but-empty** + legacy non-empty | Should normalize to the same behavior on every surface | **no** — server falls back+warns, `??` hook surfaces ignore legacy → silent 401/no-op (RL-001) |
| FM-003 | Port already in use (upstream holds 3111) | Reroute hint + never-kill note + exit 1 | yes — `src/server.ts:508-531`; verify-env C, exit 1 asserted |
| FM-004 | `helix.toml` lacks effective `storage = "disk"` | Bootstrap warns loudly (advisory) | partial — comment-out / section-blind match → silent FN (RL-002) |
| FM-005 | Memory server dead/slow during a hook | Exit 0, zero output, 2s bounded | yes — `hooks/capture.mjs:139,143-145`; verify-env B |
| FM-006 | Repeated `readLegacyEnv` calls for one var | Warn at most once per process | yes — `warnedLegacy` Set; no fork/cluster anywhere in runtime code |
| FM-007 | verify-env children survive SIGTERM | SIGTERM → wait → SIGKILL ladder, `finally` cleanup | yes — `scripts/verify-env.ts:443-458`; see RL-006 residual note |
| FM-008 | Invalid `AGENT_MEMORY_PORT`/legacy port at boot | Explicit message, non-zero exit, no secret | yes — `src/server.ts:477-483` (throw in `main()` → exit 1) |

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RL-001 | **Med** | `hooks/capture.mjs:117,130`; `plugins/antigravity/scripts/capture.mjs:144,157` vs `src/env.ts:42-45`, `plugins/antigravity/scripts/recall.mjs:107-112`, `.opencode/plugins/agent-memory.ts:163-168` | **Empty-new-name semantics diverge across surfaces (undocumented).** `??` reads treat a set-but-**empty** `AGENT_MEMORY_*` as authoritative: (1) `AGENT_MEMORY_SECRET=""` + `AGENTMEMORY_SECRET=x` → server/MCP arm the guard from legacy (fallback + warning) while both capture hooks send **no bearer** → every capture 401s and is swallowed → silent capture loss; recall/plugin (length-check `env()`) *do* fall back → surfaces disagree with each other. (2) `AGENT_MEMORY_URL=""` + legacy URL set → `??` yields `""` → `new URL(..., "/")` throws → `capture.mjs` silently no-ops instead of using the legacy URL. README:375-376 ("when both spellings are set, the `AGENT_MEMORY_*` name wins") is false for the server in this config and vacuous for the hooks; hook comments contradict each other (`capture.mjs` "new name wins when set" vs `recall.mjs:100-103` "falls back when unset/empty"). The documented divergence is *warning vs silence* (env.ts:19-21, README:377-378) — the **empty-vs-unset** divergence is documented nowhere. |
| RL-002 | **Med** | `scripts/bootstrap.ts:40` | **Advisory regex can false-negative (silent when instance is memory).** `/storage\s*=\s*"disk"/` is neither comment- nor section-aware: a `# storage = "disk"` comment-out, or a `storage = "disk"` under any *other* table (e.g. `[enterprise]`) while `[local.dev]` lacks it, satisfies the regex → no warning while the dev instance is volatile → exactly the silent-on-restart data loss P0.4 exists to prevent. Unreadable/partial file → `catch` → skip (documented deliberate, but also the silent direction). Currently correct: `helix.toml:10` sits under `[local.dev]`. Mitigant: advisory-only, non-blocking, bootstrap is manual. |
| RL-003 | Low | `scripts/verify.ts:26-30,264-280` | Under RL-001's config, a 401 from the identity guard is reported as "upstream most likely holds this port" — the real cause (armed guard + empty-new/legacy bearer mismatch) is misdiagnosed. Also, a set-but-empty `AGENT_MEMORY_URL` makes `new URL(BASE_RAW + "/")` throw **at module top level** → raw `Invalid URL` stack instead of the curated guidance (pre-existing `??` shape, not a P0 regression; exit code is still non-zero). |
| RL-004 | Low | `src/env.ts:27` | Comment "unset, empty and whitespace-only-free empty all → undefined" is garbled and implies whitespace normalization the code does not do (`nonEmpty` checks `length` only, no trim): `AGENT_MEMORY_SPACE=" "`-style values pass through — e.g. whitespace-only port reaches `parsePort` (`Number(" ") === 0` → clear error, exit 1) and a whitespace-only secret arms the guard. Behavior matches the "non-empty arms" contract; the **comment** is the defect. |
| RL-005 | Info | `src/env.ts:24-25,46-50` | Dedupe sound: module-level `Set` keyed by legacy name, checked-and-set before `console.error`; repeated calls in one process warn once. Repo-wide grep: no `cluster` / `worker_threads` / `fork(` in runtime code — only `verify-env.ts` spawns (test harness, fresh process per assertion, which is *why* the exactly-once check works). REST, MCP and bootstrap are separate processes → one warning each, exactly the documented "per variable per process" contract (env.ts:15, auth.ts:10). Warning fires **iff** the legacy value is returned — `current !== undefined` returns first (env.ts:43), warning precedes `return legacy` (env.ts:46-51). Confirmed for `secretFromEnv` (auth.ts:22-24 → guards treat `undefined`=open, non-empty=armed — no drift), `server.ts:521` port (`undefined`→3111) and `:522` host (`??` default only after `nonEmpty` normalizes empty→undefined). |
| RL-006 | Low | `scripts/verify-env.ts:222,443-458` | Reaping ladders are correct (`finally` → SIGTERM → 5s → SIGKILL → 2s, every kid; section A pre-frees 3199), but `spawnServer()` spawns the **`npx` wrapper**, so the grandchild tsx/node dies only if npm exec forwards SIGTERM. Observed clean in the recorded run (21/21: section C's blocker *bound* 3199 after A's kill — an orphan would have failed that check). Residual risk confined to interrupted runs; the 3199 preflight then fails with an explicit "free 3199" message — fail-loud, acceptable. |

**Script wiring (g):** `package.json:22` `"verify-env": "tsx scripts/verify-env.ts"` → file exists,
482 lines; `bootstrap` script wired for the advisory; CI (4cf0f6a) runs exactly the
CI-able trio (typecheck + verify-injection + pinned gitleaks) — verify-env correctly *not* in CI
(needs a live server + Helix). ✅

**verify.ts rationale (e):** header lines 14-18 document the silent legacy fallback and *why*
(machine-clean CLI output; the server carries the visible warning), added in bb335e2 diff. ✅

## Verdict Rationale

Every recorded gate was re-checked where my lens allows: `npm run typecheck` → exit 0,
`npx tsx scripts/verify-injection.ts` → ALL PASS, `curl :3151/agentmemory/livez` →
`{"status":"ok"}` — all green under this reviewer, on 3151 only (3111/3112/3113 untouched).
Core contracts hold under literal reading: warn-iff-used ✅, once-per-var-per-process ✅ (no
fork/cluster exists to break it), EADDRINUSE → hint + exit 1 ✅, reaping ladder in `finally` ✅,
script wiring ✅, verify.ts rationale documented ✅.

The two Mediums are conditional-impact edge configs (guardrails: "schedule within sprint"),
not release blockers: RL-001 needs a set-but-**empty** new var alongside a legacy var — unusual,
but it produces a *silent* data-plane failure precisely because the fail-soft surfaces swallow
the 401; RL-002 needs the user to comment out or relocate the storage key — plausible, and the
failure is the data-loss defect the lane set out to kill. Neither invalidates the recorded
evidence; both deserve a remediation ticket with the empty-name semantics decided *once*
(trim/empty ⇒ unset, everywhere) and the advisory regex anchored to the `[local.dev]` table with
comment stripping.

## Risks

- **Silent capture loss in mixed configs (RL-001):** fail-soft design means the divergence
  surfaces as "memories just don't appear", never as an error — the hardest class to debug.
- **Advisory false negative (RL-002):** the P0.4 guarantee degrades to "correct as long as
  nobody edits the comment/section" — verify only covers the happy file.
- **No regression test for empty-new-name (checklist gap):** verify-env's 21 assertions cover
  legacy-only and both-set-non-empty paths; the RL-001 triangle is untested, so a fix could
  silently regress the other direction.
- **verify-env orphan on interrupted runs (RL-006):** bounded by the loud 3199 preflight;
  no path ever touches 3111/3112/3113.

## Assumptions

- Recorded evidence (typecheck 0, verify-injection ALL PASS, verify 102/102 :3151, verify-env
  21/21, canary post-restart, gitleaks 24 commits) taken as authentic; I re-ran only the three
  commands allowed to me and they corroborate.
- `verify-env.ts` was **read, never executed** (3199 forbidden to this reviewer); its 21/21
  claim rests on the packet plus my static reading of sections A/B/C.
- "Set-but-empty env var" treated as a reachable config (shell exports and `.env` files produce
  it routinely) — this is the judgment call behind rating RL-001 Med rather than Low.
- Advisory-only bootstrap behavior (non-blocking catch) is a deliberate P0.4 scope decision per
  IMPLEMENTATION_PLAN step 3 — RL-002 questions the regex, not that decision.
