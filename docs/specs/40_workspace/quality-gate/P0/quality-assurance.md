# Quality Assurance Review: P0 (REQ-P0-1..6) — quality-gate

**Reviewer:** quality-assurance (independent — ran the real suite, did not author this work)
**Date:** 2026-09-22
**Verdict:** ❌ **fail** (trace/evidence lane: one High verdict-overclaim + three unreproducible evidence numbers; mechanisms themselves are green)

Scope note: this review covers **traceability, evidence integrity, and test coverage** only.
Findings from readability/reliability/refuter/resilience/risk/security/legal/automation reviews
are context and are cross-referenced, not re-litigated. No code changes, no fixes, no process
signals; ports 3111/3112/3113 untouched; `scripts/verify-env.ts` not executed (forbidden — port
3199; statically reconciled instead); actionlint not executed (not installed, not in allowed ops).

## Checklist (per `references/engineering/quality-assurance-review.md`)

- [x] All acceptance criteria have tests — **partially**: 6/6 REQ-IDs cite evidence, but 4 P0
      behaviors have no automated test (see Coverage Gaps G-1..G-4); T-004's bootstrap-advisory
      sub-claim has no test and no cited artifact.
- [x] All REQ-IDs traceable to test IDs — 6/6 rows exist, all six cited commits exist and each
      contains its claimed artifact (Trace table below).
- [~] Unit + integration + e2e coverage as appropriate — repo bar is `typecheck` + E2E; unit
      coverage N/A is declared honestly (`TEST_MATRIX.md:18`); the E2E suite misses the
      new-wins precedence, bootstrap advisory, antigravity silence (G-1..G-4).
- [~] Regression suite updated — `verify-env.ts` added (21 assertions static), but it runs in
      **neither CI nor the CONTRIBUTING PR bar** → P0.5/P0.6 regressions are ungated (G-8,
      cross-ref CE-08/AUT-001).
- [x] No flaky tests introduced — `verify-injection` runs deterministic (local test server,
      port 0, no env/network); re-ran twice green. No sleep/poll flake patterns observed in
      `verify-env` source (bounded waits with explicit timeouts).
- [N/A] Coverage threshold — no coverage tooling in repo bar; acceptance-criteria coverage
  6/6 by citation, **4/6 by re-runnable artifact** (see Trace verdicts).
- [~] Manual exploratory testing — canary restart + gitleaks + livez recorded/reproduced;
      canary number itself has no committed artifact (QA-04).

## Findings

| ID | Severity | Finding | Location | Evidence |
|---|---|---|---|---|
| QA-01 | **High** | **ROADMAP P0.2 tick + TEST_MATRIX T-0-0-2 "pass" overclaim CI that has never run.** Acceptance says "green on `main`"; the workflow exists only in unpushed local commits. `git ls-remote origin main` → `069e1cf` (the commit *before* the P0 lane); `git log origin/main..HEAD --oneline` → **6 commits** (`4cf0f6a…8aba7b9`); `git cat-file -e 069e1cf:.github/workflows/ci.yml` → **ABSENT at origin/main**. Therefore no push to `main` could have triggered or green-lit this workflow — the row records `pass` for an acceptance criterion that is false today. Not a code defect: the local equivalents (typecheck, verify-injection, gitleaks) *are* green — I reproduced all three. | `ROADMAP.md:74`, `TEST_MATRIX.md:10`, `.github/workflows/ci.yml` (local-only) | the three git commands above, run this session |
| QA-02 | Medium | **"70 assertions" is false — actual is 73.** `IMPLEMENTATION_PLAN.md:47` gate checkbox and `ROADMAP.md:44` both cite 70. Reproduced: `npx tsx scripts/verify-injection.ts` → exit 0, `ALL PASS`, **73 `ok` lines** (A9+B14+C25+D10+E5+F7+G3 = 73), 0 FAIL. Static: 74 `check(` = 73 calls + 1 definition. `git log --oneline -- scripts/verify-injection.ts` → single commit `44914e0` (initial release): the script never changed, so **70 never matched any state of the repo**. Green verdict true; cited number wrong. | `ROADMAP.md:44`, `IMPLEMENTATION_PLAN.md:47` | rerun + history above |
| QA-03 | Medium | **"full history 24 commits" is unreproducible — actual 25 scanned / 26 in history.** Gate checkbox `IMPLEMENTATION_PLAN.md:51`. My run of the exact allowed docker command (gitleaks v8.30.1) → `25 commits scanned … no leaks found`, exit 0. `git rev-list --count HEAD` = **26** (0 merges). "24" matches neither. Substance (clean scan) reproduced; the number is stale. (±1 gitleaks-vs-rev-list delta itself unexplained — worth a note, not a defect.) | `IMPLEMENTATION_PLAN.md:51` | docker gitleaks run + `rev-list` this session |
| QA-04 | Medium | **T-0-0-4's canary numbers (`228cdf69`, BM25 `0.863`) have no artifact.** The identifiers appear **only in gate documents** (`TEST_MATRIX.md:12`, `IMPLEMENTATION_PLAN.md:50`, fellow reviews) — no committed log, no output file, nothing re-runnable within allowed ops (restart round-trip forbidden here). This is a single-source self-cited number backing an E2E `pass` verdict. The other half of T-0-0-4 *is* corroborated: `helix.toml` `storage = "disk"` exists (added by `c551774`, verified) and the automation reviewer's live `helix status` showed `storage: disk`. | `TEST_MATRIX.md:12`, `IMPLEMENTATION_PLAN.md:50` | repo-wide grep `228cdf69\|0.863` → only gate docs; `cat helix.toml` |
| QA-05 | Medium | **"actionlint 0 errors" (T-0-0-2) is an evidence-less number.** `command -v actionlint` → **NOT INSTALLED**; no actionlint log/artifact exists anywhere in the repo; and since the workflow was never pushed (QA-01), GitHub has never validated the YAML either. The row's `pass` therefore partly rests on a number nobody can reproduce and no artifact records. (Cross-ref automation-reviewer's identical Low note.) | `TEST_MATRIX.md:10` | `command -v actionlint`; repo grep for actionlint artifacts |
| QA-06 | Medium | **P0.5's core rule "new name wins" (both spellings set) has zero automated assertions.** `verify-env` has exactly three sections — A legacy-only, B hook-silence, C EADDRINUSE (`verify-env.ts:272,357,393`); A explicitly *strips* the new names "so the new name can never win this run" (`:235`). No test anywhere exercises new+legacy set simultaneously (`grep new name\|both\|wins` in verify-env → nothing runtime). A precedence regression could ship green. (The empty-new-name divergence itself is owned by reliability RL-001/refuter CE-04 — my finding is the missing test only.) | `scripts/verify-env.ts` (absence of a section D), `TEST_MATRIX.md:13` | section grep above |
| QA-07 | Low | T-0-0-6's evidence cites "verify-env **sections A/C** green" — section A is the *legacy-env* section (T-0-0-5's evidence); the relevant section for the reroute hint is **C only**. Harmless imprecision in an otherwise-supported row. | `TEST_MATRIX.md:14` | `verify-env.ts:272,393` section titles |
| QA-08 | Low (observation) | Commit-scoping note (lane (e)): `bb335e2` also touches `README.md` (+7) and `package.json` (+1), which plan step 4's target-file list doesn't name — justifiable (legacy-env note + `verify-env` script registration) and **not REQ cross-contamination**; all six REQ artifacts landed in their own cited commits (mapping table below). Plan step 4 lists the EADDRINUSE hint under "env migration", yet the hint (`portInUseHint`, `git log -S`) landed in `1af2cde` — which is exactly what T-0-0-6 cites, so the REQ→commit trace is correct; only the plan's step wording is loose. | `bb335e2`, `IMPLEMENTATION_PLAN.md:21` | `git show --stat`, `git log -S portInUseHint` |

## Evidence numbers — independently reproduced vs unreproducible

| Claim | Cited at | My result |
|---|---|---|
| `npm run typecheck` exit 0 | `IMPLEMENTATION_PLAN.md:46` | ✅ **exit 0** reproduced; also `grep -rE "@ts-ignore\|: *any\|TODO"` over `src/ scripts/ hooks/ plugins/ .opencode/` → **0 matches** (sub-claim holds) |
| `verify-injection` ALL PASS, **70** assertions | `:47`, `ROADMAP.md:44` | ⚠️ ALL PASS reproduced, **actual 73** (`70` false — QA-02) |
| `verify` **102/102** | `:48` | ✅ **statically reconciles**: 78 `check(` − 1 definition = 77 calls, + 25 `shape(` calls (def is `shape<T>(`, uncounted), both increment `passed` → **102**; consistent with `README.md:441` and `RELEASE_NOTES.md`. Runtime not re-run (not in my allowed ops) — recorded + statically exact. |
| `verify-env` **21/21** | `:49`, `TEST_MATRIX.md:13` | ✅ **statically reconciles**: 21 `check(` lines − 1 comment (`:4`) − 1 definition (`:70`) = **19 call sites**; one sits inside `for (LEGACY_VARS)` and `LEGACY_VARS` has **3 entries** → 18 + 3 = **21**. Runtime forbidden to me — recorded + statically exact. |
| canary `228cdf69`, BM25 **0.863** | `:50`, `TEST_MATRIX.md:12` | ❌ **unreproducible** — no artifact anywhere outside gate docs (QA-04) |
| gitleaks clean, **24 commits** | `:51` | ⚠️ `no leaks found` reproduced; **25 scanned / 26 rev-list** → "24" false (QA-03) |
| actionlint **0 errors** | `TEST_MATRIX.md:10` | ❌ **unreproducible** — binary absent, no artifact (QA-05) |
| CI **green on `main`** | `ROADMAP.md:74`, `TEST_MATRIX.md:10` | ❌ **refuted** — workflow not on origin, 6 commits unpushed (QA-01) |
| `storage=disk` (persisted) | `:50`, `TEST_MATRIX.md:12` | ✅ `helix.toml` `storage = "disk"` under `[local.dev]` (added `c551774`); live status `storage: disk` corroborated by automation reviewer |
| gitleaks `no leaks found` (v8.30.1), pinned job | `:51` | ✅ docker v8.30.1 run exit 0; `ci.yml` pins version + sha256 check as claimed |
| server healthy on 3151 | step 6 evidence | ✅ `curl http://127.0.0.1:3151/agentmemory/livez` → `{"status":"ok"}` |

## Gate-checkbox honesty — all eight `[x]` in `IMPLEMENTATION_PLAN.md:46-53`

| # | Checkbox | Verdict | Basis |
|---|---|---|---|
| 1 | typecheck clean, exit 0 | ✅ supported | reproduced exit 0; no `any`/`@ts-ignore`/`TODO` greps clean |
| 2 | verify-injection ALL PASS, **70** | ⚠️ verdict supported, **number false (73)** | QA-02 |
| 3 | verify **102/102** on 3151, upstream untouched | ✅ supported (static) | 77+25=102 reconciles; livez 3151 ok; runtime recorded-only for me |
| 4 | verify-env **21/21** | ✅ supported (static) | 19 sites + loop×3 = 21 reconciles exactly |
| 5 | persistence canary **0.863**, storage stayed disk | ⚠️ **half-supported** | storage=disk ✅ (file + live status); canary number has no artifact (QA-04) |
| 6 | gitleaks clean, **24 commits**, pinned in CI | ⚠️ half-supported | clean scan ✅ reproduced; "24" false (QA-03); "pinned in CI" true of the file but the CI job is not on origin (QA-01) |
| 7 | LICENSE + SECURITY + CONTRIBUTING + CHANGELOG present & linked | ✅ supported | all four present; `README.md:469-477` links resolve; `LICENSE` exists at `44914e0`; `package.json` `license: "Apache-2.0"` matches |
| 8 | no new required env vars; warn-name-never-value; hook silence — enforced by verify-env | ✅ supported | `verify-env.ts:324-347` name-only warning + `never contains the secret VALUE` assertions; `:373-387` hook stdout/stderr EMPTY — scope caveat: silence asserted for `hooks/capture.mjs` only (G-4) |

## ROADMAP tick honesty — six P0 rows

| Row | Tick | Honest? | Basis |
|---|---|---|---|
| P0.1 | ✅ done | ✅ yes | LICENSE at `44914e0`, license field matches — reproduced |
| P0.2 | ✅ done … "green on `main`" | ❌ **no — High (QA-01)** | workflow never pushed; zero runs possible; acceptance verbatim unmet while tick says done |
| P0.3 | ✅ done | ✅ yes | files + README links reproduced |
| P0.4 | ✅ done | ⚠️ mostly | documented + `storage="disk"` landed; restart canary is recorded-only (QA-04) |
| P0.5 | ✅ done | ⚠️ mostly | fallback/warning/silence code + 21-assertion suite recorded + statically exact; precedence rule untested (QA-06); empty-new-name edge owned by RL-001/CE-04 (context) |
| P0.6 | ✅ done | ✅ yes | `portInUseHint` introduced in cited commit `1af2cde`; README ownership statement present; verify-env C assertions exist |

## Commit-per-REQ mapping (lane e) — no cross-contamination

| REQ | Cited commit | `git show --stat` contents | Verdict |
|---|---|---|---|
| REQ-P0-1 | `44914e0` (pre-existing) | `LICENSE` exists at that commit; `package.json` license field | ✅ artifact present at cited commit |
| REQ-P0-2 | `4cf0f6a` | `.github/workflows/ci.yml` **only** (48 lines) | ✅ clean, single-purpose |
| REQ-P0-3 | `7caa14d` | `CONTRIBUTING.md` +, `SECURITY.md` +, `README.md` +10 (adds the `## Contributing & security` block incl. the `CHANGELOG.md` link) | ✅ exactly the claimed artifacts |
| REQ-P0-4 | `c551774` | `helix.toml` +1 (`storage = "disk"`), `scripts/bootstrap.ts` +22, `README.md` +14 | ✅ matches plan step 3 file list exactly |
| REQ-P0-5 | `bb335e2` | `src/env.ts` (new; `readLegacyEnv` **introduced here**), `src/auth.ts`, `src/server.ts` (legacy reads), `scripts/verify-env.ts` (new), hooks/antigravity/plugin edits, `scripts/verify.ts`, + README/package.json extras (QA-08) | ✅ env migration landed in its own commit; **`portInUseHint` NOT here** |
| REQ-P0-6 | `1af2cde` | `src/server.ts` +40 (`portInUseHint` **introduced here** per `git log -S`), `README.md` port-ownership #1 | ✅ hint landed in its own commit; **no legacy-env code smuggled in** |
| (step 7) | `8aba7b9` | `ROADMAP.md`, `IMPLEMENTATION_PLAN.md`, `TEST_MATRIX.md` only | ✅ docs-tick commit separated from code |

## Coverage gaps (lane f) — P0 behavior

| ID | Severity | Gap | Type | Evidence |
|---|---|---|---|---|
| G-1 | **Medium** | **Bootstrap storage advisory has zero tests.** `scripts/bootstrap.ts` warning is cited inside T-0-0-4's `pass` row, but no test invokes bootstrap or the advisory regex, and no evidence artifact covers it — the row's evidence cites only the restart canary. (Regex FN risk = reliability RL-002, context; my finding: the sub-claim is an **untested claim inside a passing row**.) | untested claim | `grep -r bootstrap scripts/ .github/` → only implementation files, no test |
| G-2 | **Medium** | **"New name wins" precedence untested** (QA-06): no both-set scenario in any suite; only legacy-only (A), hook silence (B), EADDRINUSE (C). | untested claim | `verify-env.ts:272,357,393` |
| G-3 | **Medium** | **Empty-new-name × legacy triangle untested** — the RL-001/CE-04 divergence (hooks `??` vs server `nonEmpty`) has no assertion pinning either behavior, so a fix can silently regress the other direction. Defect owned by reliability/refuter; gap is mine. | untested claim (cross-ref RL-001, CE-04) | no both-set test (G-2 evidence) |
| G-4 | **Medium-Low** | **Antigravity (and OpenCode-plugin) zero-output rests on review only.** `verify-env` B spawns `hooks/capture.mjs` alone; `grep -rln antigravity scripts/ .github/` → **0 matches**. SEC-007 (security) states the same — corroborated, not re-litigated. | evidence is manual/review, **not** untested-by-claim: the docs don't assert an automated check here | `verify-env.ts:356-390`; grep |
| G-5 | Low | **No negative test that a non-`EADDRINUSE` error prints no hint.** Gate is strict `=== "EADDRINUSE"` (static, refuter RF-g1 holds) but nothing asserts hint-absence + exit-1 on, say, `EACCES`. | untested claim (static evidence exists) | `src/server.ts:526-532`; `verify-env` section C is presence-only |
| G-6 | Low | **Whitespace-only env values untested.** `nonEmpty` checks `length` only (`src/env.ts:28-30`, garbled comment = RL-004 context); `" "`-valued new secret wins over a real legacy secret — no suite covers whitespace anywhere (`grep trim/whitespace` in verify suites → only an unrelated text-normalizer). | untested claim | `src/env.ts:28-30`; grep |
| G-7 | Low | **Legacy `HOST` value path only indirectly covered.** Section A sets `AGENTMEMORY_HOST` and asserts boot + name-only warning (LEGACY_VARS includes HOST), but no assertion pins the host *value* reaching the listen line (refuter N-1). | mostly covered; value-path manual/static | `verify-env.ts:57-61,226,324-330` |
| G-8 | Medium | **P0.5/P0.6 evidence suite is ungated:** CI runs only `typecheck` + `verify-injection` (`ci.yml:21-25`); CONTRIBUTING's PR bar lists `verify` + `verify-injection` but **not `verify-env`** (`CONTRIBUTING.md:40-57`). A green future `main` cannot detect legacy-migration or reroute-hint regressions. (Cross-ref CE-08/AUT-001 — previously raised; recorded here as coverage-of-suite.) | regression-detection gap | `ci.yml`, `CONTRIBUTING.md` greps |

## Trace table — REQ → test → artifact → verdict (lane a)

| REQ-ID | Test ID | Cited commit | Cited artifact exists? | Commit contains claimed artifact? | My re-run result | Trace verdict |
|---|---|---|---|---|---|---|
| REQ-P0-1 | T-001 | `44914e0` | ✅ `LICENSE`, `package.json` `license` | ✅ (`git cat-file -e 44914e0:LICENSE`) | reproduced both | ✅ |
| REQ-P0-2 | T-002 | `4cf0f6a` | ⚠️ workflow file exists locally; actionlint number **no artifact**; "green on `main`" **no run exists** | ✅ commit contains `ci.yml` (only file) | typecheck 0 ✅, verify-injection ALL PASS ✅, gitleaks `no leaks found` ✅, actionlint ❌ unreproducible, green-on-main ❌ refuted | ❌ (row says `pass`; acceptance unmet — QA-01/QA-05) |
| REQ-P0-3 | T-003 | `7caa14d` | ✅ three files + README block | ✅ (`git show --stat`: SECURITY +, CONTRIBUTING +, README +10 incl. CHANGELOG link) | files & links reproduced | ✅ |
| REQ-P0-4 | T-004 | `c551774` | ⚠️ canary `228cdf69`/`0.863` **no artifact**; bootstrap-warn sub-claim **no artifact, no test** | ✅ commit adds `storage = "disk"` + advisory code + README | `helix.toml` verified; canary unreproducible; restart forbidden to me | ⚠️ (documented + config landed; E2E number single-source — QA-04, G-1) |
| REQ-P0-5 | T-005 | `bb335e2` | ✅ `verify-env.ts` exists with the cited assertions | ✅ (`env.ts`, `verify-env.ts`, hook edits all in this commit) | 21/21 statically reconciled exactly (runtime forbidden) | ⚠️ (evidence sound but precedence untested, suite ungated — QA-06, G-2/G-8) |
| REQ-P0-6 | T-006 | `1af2cde` | ✅ hint code + README #1; verify-env section C assertions present | ✅ (`portInUseHint` introduced here) | static trace confirms hint gate; runtime recorded | ⚠️ (supported; negative-path gap G-5, section-citation nit QA-07) |

Coverage summary: **acceptance-criteria coverage 6/6 by citation; 4/6 by re-runnable or
statically-exact evidence; 2/6 (P0-2, P0-4) carry unreproducible numbers.** Unit coverage N/A
is honestly declared. Line/branch coverage: N/A (no coverage tooling in repo bar — declared).

## Verdict Rationale

- **❌ fail** on the evidence lane, not the mechanisms: every code artifact traced to its
  cited commit, the two big suite numbers (102, 21) reconcile *exactly* under static count,
  typecheck/injection/gitleaks/livez all reproduce green — but **QA-01 is a High**: a P0
  acceptance criterion ("green on `main`") is verbatim unmet while ROADMAP and TEST_MATRIX
  both record done/pass, and **QA-02/03/04/05** put four wrong or artifact-less numbers in
  the evidence matrix (70→73, 24→25/26, 0.863 canary single-source, actionlint unverifiable).
- Gate can move to ⚠️ conditional on: (1) push the lane, confirm a green run, re-cite T-0-0-2;
  (2) correct the two stale counts (`70`→73, `24`→reproducible phrasing); (3) attach or soften
  the canary/actionlint numbers. G-1..G-8 route to engineering/ops owners as follow-ups, not
  blockers, except G-2 (untested core precedence rule) which should ride any P0.5 fix.
- Reviewer made **no changes to anything** — findings only, per lane rules.
