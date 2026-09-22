# Refuter Review: P0 (REQ-P0-1..6) — quality-gate

**Reviewer:** review-refuter (adversarial, independent)
**Date:** 2026-09-22
**Verdict:** initial: ❌ → recheck: ✅ (all refutations failed — claims hold now; see `## Recheck`)

## Mission

Attempt to **falsify** the P0 acceptance claims. Success = a counterexample with
severity + location + evidence. No code changes, no fixes, no process signals;
ports 3111/3112/3113 untouched; `scripts/verify-env.ts` and server starts
forbidden to this reviewer (static reconciliation used instead).

## Per-REQ verdict

| REQ | Claim (ROADMAP P0 table) | Refuter verdict |
|---|---|---|
| REQ-P0-1 | LICENSE present, GitHub reports correct license | ✅ refutation failed — `package.json` `license: "Apache-2.0"` matches `LICENSE`; GitHub API `license.spdx_id: "Apache-2.0"` (fetched) |
| REQ-P0-2 | CI runs typecheck + verify-injection + secret scan **on every push; green on `main`** | ❌ **counterexample** — zero workflow runs exist; workflow file has never been pushed |
| REQ-P0-3 | SECURITY/CONTRIBUTING/CHANGELOG present + linked | ✅ refutation failed — three files present; README links resolve (commit 7caa14d) |
| REQ-P0-4 | `--disk --persist` documented **and** a save survives a Helix restart | ⚠️ basis verified from official Helix docs; README self-contradicts the wording; the `0.863` canary could not be reproduced (restart round-trip outside allowed ops) |
| REQ-P0-5 | restart cannot silently drop bearer secret or fall back to upstream-held port | ✅ refutation failed for server/MCP surfaces — every read site pairs new+legacy; no silent-bind path; two edge findings (CE-04, CE-07) |
| REQ-P0-6 | EADDRINUSE prints 3151 reroute + never-kill note; README states ownership | ✅ refutation failed — `port` in scope, listener before `listen`, strict `=== "EADDRINUSE"` gate, single call site |

## Attack Vectors Tried

| ID | Hypothesis | Attempt | Result |
|----|-----------|---------|--------|
| RF-a1 | every `AGENTMEMORY_*` read site is covered by new-wins + fallback | repo-wide grep inventory of all `AGENT_MEMORY_`/`AGENTMEMORY_` readers (`src/`, `db/`, `hooks/`, `plugins/`, `.opencode/`, `scripts/`) | **Holds** for server (`server.ts:521-523`), MCP (`auth.ts:23` via `secretFromEnv`), hooks (`capture.mjs:59,117,130`), antigravity (`capture.mjs:80,144,157`), recall (`env() 107-112`), plugin (`env() 163-168`), verify (`verify.ts:28-30`); `db/`, `demo.ts`, `bootstrap.ts` read no `AGENT_*` var; `mcp.ts` comment-only. **Counterexample found only for set-but-empty new name** → CE-04 |
| RF-b1 | server can silently bind/end up on an upstream-occupied port | traced every bind path: one `server.listen(port, host)`, no retry loop, no `SO_REUSEPORT`, EADDRINUSE → hint → `exit 1` (`server.ts:526-532`) | **Holds** for the server (subject of the claim). Residual: client defaults point at 3111 → CE-07 (scope argument in CE) |
| RF-c1 | the VALUE of a legacy var can reach a stream on the warning path | read `src/env.ts` fully; every `console/stderr` write on legacy path (`server.ts:445,472,527,535`, `bootstrap.ts`, `errors.ts`, `auth.ts`) | **Secret value: no path found** — warning is names-only (`env.ts:46-51`), `parsePort` throws a **fixed message** (`server.ts:477-483`), `logSafeNote` reduces remote errors to code and the bearer never reaches it. Non-secret `HOST` (listen line) and `PROJECT` (recall stdout) do reach streams by design → note N-1 |
| RF-d1 | any reachable console/stderr/stdout on the legacy path in hooks/plugins | full read of `hooks/capture.mjs`, both `plugins/antigravity/scripts/*.mjs`, `.opencode/plugins/agent-memory.ts` + grep of every write | `hooks/capture.mjs`: **zero writes anywhere** (uncaughtException → exit 0). `.opencode` plugin: no console/stdout/stderr at all. antigravity `capture.mjs`: stdout carries **only fixed** `{}` / `{"decision":"stop"}` (`contractOutput`) — documented host contract, no env content; **stderr never written**. `recall.mjs`: stdout carries contract `injectSteps` by design (includes project/content), stderr never. **No secret/value leak; "zero-output" holds for stderr + secrets; literal zero-stdout does NOT hold for antigravity/recall** → note N-2 |
| RF-e1 | `verify-injection` can run green in CI's environment | read script (no env/files/network needs; binds port 0; deps all in `package.json`) + **ran it** | **Holds** — `exit=0`, `ALL PASS`, 73 ok / 0 FAIL locally after `npm ci`-equivalent deps; action tags `actions/checkout@v4.4.0` (`11d5960…`) and `actions/setup-node@v4.4.0` (`49933ea…`) **exist** (`git ls-remote`) → workflow is resolvable |
| RF-e2 | CI is green on `main` (P0.2 acceptance) | `git ls-remote origin` + GitHub Actions API | **FALSIFIED** → CE-01 |
| RF-e3 | gitleaks sha256 line correct for v8.30.1 linux x86_64 | read `ci.yml:36-46`; ran the allowed docker scan | Construct **correct** (grep→`sha256sum --check -`, fails closed under Actions `bash -e`; artifact name `gitleaks_8.30.1_linux_x64.tar.gz` is the standard goreleaser name; v8.30.1 image pulled and ran). **Same-origin checksum file** = trust circular → CE-09 (offline verification method stated there) |
| RF-e4 | "actions pinned" claims are true | exact refs in `ci.yml:16-17,31` | Claims in plan/T-002 say **"pinned gitleaks"** (true — version + sha256). Actions are pinned by **mutable tag, not SHA** — no doc claims otherwise; residual noted as CE-09 (cross-ref SEC-004/RK-006/AUT-004) |
| RF-f1 | plain `helix start dev` keeps data after `--disk --persist` (README basis) | `helix start --help` + official HelixDB docs | **Basis found**: `--persist` … "Write the resolved port, storage … back to `[local.<instance>]` in `helix.toml`, **so future runs reuse them**" (docs `cli/command-reference/start`); `helix add local --disk` → `helix start <name>` (no flag) example; `helix restart` doc: "Disk-mode instances preserve data in their local MinIO volume". **Claim basis verified**; README wording contradicts itself → CE-05; canary `0.863` not reproduced → ⚠️ |
| RF-f2 | bootstrap advisory regex gives false negatives | read `scripts/bootstrap.ts:37-49`, regex `/storage\s*=\s*"disk"/` | **FALSIFIED (false negatives exist)** → CE-06 |
| RF-g1 | `portInUseHint(port)` correct; no other error prints the hint | read `server.ts:500-538`; grep all `portInUseHint` uses | **Holds** — `port` is `main()`'s const in scope; `on("error")` attached at 526 **before** `listen` at 533; gate strict `systemErrorCode(err) === "EADDRINUSE"`; only call site is 529; hint text is conditional ("if the upstream … holds") so it is not misleading for a non-upstream conflict. Residual: no negative runtime test (static-only; cross-ref RS-004) |
| RF-h1 | citable numbers reproduce | reran typecheck, verify-injection, docker gitleaks, `git rev-list`; statically reconciled the rest | **FALSIFIED for "70" and "24"** → CE-02, CE-03; 102 and 21 reconcile exactly (see Proofs); `0.863`, `verify-env 21/21` runtime, `verify 102/102` runtime, `actionlint 0` not reproducible here → ⚠️ |

## Counterexamples Found

| ID | Counterexample | Severity | Location | Reproduction / evidence |
|----|---------------|----------|----------|-------------------------|
| CE-01 | **P0.2 "green on `main`" is false: GitHub has ZERO workflow runs — the CI workflow has never been pushed.** Local HEAD `8aba7b9`; `origin/main = 069e1cf` (the commit *before* the P0 lane); `git cat-file -e 069e1cf:.github/workflows/ci.yml` → **ABSENT**; all six P0 commits are in `origin/main..HEAD`. `GET api.github.com/repos/deuriib/agent-memory/actions/runs` → `{"total_count":0,"workflow_runs":[]}`. Every push to `main` currently triggers **no** workflow (file not there), so the acceptance "runs … on every push; green on `main`" cannot hold. TEST_MATRIX T-002 says "pass". | **High** (acceptance unmet + evidence matrix claims pass; not a code defect — local equivalents *are* green) | `.github/workflows/ci.yml` (local-only, from `4cf0f6a`); `TEST_MATRIX.md:10`; `ROADMAP.md:74` | commands above; remediation owner: orchestrator — push the lane, confirm a green run, then re-cite T-002 |
| CE-02 | **"70 assertions" is factually wrong — actual is 73.** Reproduced: `npx tsx scripts/verify-injection.ts` → `exit=0`, **73 `ok` lines, 0 FAIL, ALL PASS**. Static: 74 `check(` = 73 calls + 1 definition. `git log -- scripts/verify-injection.ts` → unchanged since `44914e0` (initial release, also 73) — the number never equaled 70 at any commit. | Medium (evidence-matrix honesty; script itself green) | `ROADMAP.md:44`, `IMPLEMENTATION_PLAN.md:47`, `review-readability.md:46` | rerun cited above; file history cited |
| CE-03 | **"full history 24 commits" is stale.** Current history: `git rev-list HEAD` = **26** (0 merges). My allowed run of the exact docker gitleaks command reported **`25 commits scanned … no leaks found`** (25-vs-26 ±1 unexplained by merge/topology → also flag the count discrepancy itself). "24" matched the state at `bb335e2` only; two commits (`1af2cde`, `8aba7b9`) landed after and were never in the cited scan. Substance (clean scan) **reproduced**, number wrong. | Low-Medium (stale number; scan genuinely clean on 25/26 commits) | `IMPLEMENTATION_PLAN.md:51`; `review-reliability.md:97` | docker gitleaks run this session; `git rev-list --count HEAD` |
| CE-04 | **Set-but-empty new name blocks the legacy fallback in hooks/plugin (silent capture loss).** `AGENT_MEMORY_SECRET=""` + `AGENTMEMORY_SECRET=x`: server/MCP treat empty as unset (`env.ts:28-30` nonEmpty) → guard **armed** from legacy; hooks use `??` (`capture.mjs:130`, antigravity `capture.mjs:157`, `verify.ts:28-30`) → `""` wins → **no bearer sent** → every capture 401s and is swallowed → silent loss. recall/plugin *do* fall back (length-check) → surfaces disagree. README:375-376 "when both spellings are set, the `AGENT_MEMORY_*` name wins" is false for the server in this config. **This weakens REQ-P0-5's "cannot silently drop the bearer secret" on the hook side** (server-side secret is never dropped). Cross-ref: reliability RL-001 already owns this; refuter confirms it as a genuine edge counterexample, undocumented. | Medium (silent failure in a narrow but legal config) | `hooks/capture.mjs:59,117,130`; `plugins/antigravity/scripts/capture.mjs:80,144,157`; `scripts/verify.ts:28-30` vs `src/env.ts:42-45` | code trace above (no run — hooks spawn outside allowed ops) |
| CE-05 | **README contradicts itself on P0.4's exact claim.** L88-89: "a plain `helix start dev` afterwards **keeps data** across restarts. **Without `--disk` the instance is in-memory and every restart wipes it.**" — L401-405 repeats both halves: "a plain `helix start dev` keeps data… An instance started *without* `--disk` still runs `storage: memory` and loses everything." A plain start **is** a start without `--disk`; as written the same command both keeps and loses data. The real determinant is the `helix.toml` key (basis **verified**: Helix docs, `--persist` … "future runs reuse them"), not the flag — the sentences attribute the outcome to the flag. | Medium (docs: the acceptance criterion is "documented"; the doc self-negates without the toml-key qualifier) | `README.md:88-90` and `README.md:401-405` | text quoted; basis docs cited in RF-f1 |
| CE-06 | **Bootstrap advisory regex false negatives.** `/storage\s*=\s*"disk"/` over raw file text: (1) `# storage = "disk"` commented out → matches → **no warning though volatile**; (2) `storage = "disk"` in the **wrong table** (e.g. `[project]`, not `[local.dev]`) → matches → no warning; (3) toml says disk but the **running container is still memory** (instance created before the key / restarted in place — `helix restart` docs: "using its current … container settings", never recreates) → advisory silent while every restart still wipes. Safe-direction false positives exist too (`'disk'`, `Disk` → spurious warning). T-004's literal wording ("warns when helix.toml lacks `storage = "disk"`") remains true; the advisory's *reliability* does not. | Medium (advisory is the P0.4 backstop for the config path it claims to cover) | `scripts/bootstrap.ts:40` | regex demonstrated against the stated inputs |
| CE-07 | **After the documented reroute, clients silently default to upstream-held 3111.** If upstream occupies 3111 and ours is started on 3151 (`AGENT_MEMORY_PORT=3151`) **without** `AGENT_MEMORY_URL`, hooks/plugin/verify still default to `http://127.0.0.1:3111` (`capture.mjs:117`, plugin `DEFAULT_BASE`, `verify.ts:28`) → captures POST toward the upstream instance (or 401), both swallowed silently. Scope argument: the REQ-P0-5 subject is the restarted **server** (which never silently binds — RF-b1 holds), and README:388-390 instructs pointing every client at 3151; but nothing *enforces* the client half of the reroute. | Low-Medium (documented mitigation exists; default is unguarded) | `hooks/capture.mjs:117`; `.opencode/plugins/agent-memory.ts:69`; `scripts/verify.ts:28` | code trace; README:388-390 |
| CE-08 | **T-005/T-006 evidence (`verify-env` 21/21) is gated nowhere** — not in CI (`ci.yml` runs only typecheck + verify-injection) and not in `CONTRIBUTING.md`'s PR bar. A green `main` after push cannot detect regression of legacy migration or the hint. | Medium (matches automation AUT-001; refuter re-confirms) | `TEST_MATRIX.md:13-14`; `.github/workflows/ci.yml:21-25` | file reads |
| CE-09 | **Supply-chain residuals on the secret-scan claim:** (i) gitleaks checksums file is fetched from the **same release URL** as the artifact — protects against corruption, not a compromised release; **offline verification impossible as wired**; correct offline fix = pin the literal sha256 in the workflow (or cross-check an independent source: brew/nix hash). (ii) `actionlint 0 errors` **unreproducible here** (binary not installed; `command -v actionlint` empty) — and actionlint would not catch CE-01 anyway. (iii) actions pinned by **mutable tag** not SHA (`checkout@v4.4.0`, `setup-node@v4.4.0` — tags verified to exist). No doc falsely claims action SHA-pinning. | Low (cross-ref RK-003/RK-006/SEC-004/AUT-004) | `.github/workflows/ci.yml:16-17,36-46` | reads + `git ls-remote` + `command -v` |

### Notes (not findings)

- **N-1:** non-secret legacy *values* do reach streams by design: `AGENTMEMORY_HOST` → listen line (`server.ts:536`), `AGENTMEMORY_PROJECT` → recall `injectSteps` header (`recall.mjs:272`). `env.ts:16`'s blanket "The value itself must never reach any stream" is true only when read as scoped to the **warning/secret**; contract §3 (no *secret* on logs) holds. Wording nit, no leak.
- **N-2:** "hooks stay silent" is literally true only for `hooks/capture.mjs` + **stderr** of the antigravity hooks; antigravity `capture.mjs` writes fixed contract JSON to stdout on every path (host requirement, documented) and `recall.mjs` writes its injection block by design. The deprecation-warning silence holds everywhere.
- `IMPLEMENTATION_PLAN.md:21` lists "server/**MCP**/**bootstrap**" warning surfaces — `bootstrap.ts` reads no `AGENT_*` var at all (no migration surface); MCP covers only the secret via `secretFromEnv`. Wording overstates scope; behavior is correct.

## Claims I could NOT reproduce (⚠️ — accepted as recorded, with static corroboration)

| Claim | Why not re-run | Static corroboration |
|---|---|---|
| `verify-env` **21/21** | execution forbidden (port 3199 / rule) | **Reconciles exactly:** 19 call sites, one inside `for (LEGACY_VARS)` (×3) → 19+2 = **21** runtime assertions; assertion strings match `portInUseHint` verbatim |
| `verify` **102/102** | server start / verify not in allowed ops (server on 3151 is live — `curl livez` → **HTTP 200**) | **Reconciles exactly:** 77 `check()` calls + 25 `shape()` calls (the def is `shape<T>…`, uncounted) = **102**; matches `RELEASE_NOTES.md` "102 passed" |
| canary **BM25 0.863 post-restart** | restart round-trip not in allowed ops | recorded only; Helix docs confirm disk-mode survives restart |
| **actionlint 0** | binary not installed | workflow YAML read as well-formed by 3 reviewers; GitHub validates on push — but see CE-01: it was never pushed |
| CI **green on `main`** | — | **not merely unverifiable: refuted** (CE-01) |

## Proofs that held (refutations failed)

1. **Env coverage (a):** complete reader inventory paired new+legacy at every runtime site; `db/`, `demo.ts`, `bootstrap.ts` read none; MCP comment-only + `secretFromEnv`. Only the empty-string semantics diverge (CE-04).
2. **No silent bind (b):** one `listen`, strict `EADDRINUSE` → hint → `exit 1`, no retry/`SO_REUSEPORT`; Linux wildcard-vs-specific overlaps all raise `EADDRINUSE`. (Theoretical residual: upstream bound to a *specific non-loopback* IP:3111 while we bind `127.0.0.1:3111` would not conflict — assumption stated: upstream binds loopback, as README's own reroute docs presume.)
3. **Warning value-freedom (c):** `env.ts:46-51` interpolates names only (guard comment at :48); `parsePort` throws a fixed string; `logSafeNote` never receives the bearer; reproduced at runtime by `verify-injection` section F (secret absent from every failure note, part of the 73 ok).
4. **Hook zero-output (d):** `hooks/capture.mjs` and the OpenCode plugin contain **no** stream writes at all; antigravity stderr never written; every error branch routes through `finish()` with fixed strings only.
5. **Hint correctness (g):** in-scope `port`, listener attached pre-`listen`, single gated call site, conditional wording.
6. **Persistence basis (f):** official HelixDB docs state `--persist` writes settings "so future runs reuse them" + `helix add local --disk` → plain `helix start` example + restart-doc volume guarantee — README's *mechanism* claim is grounded (wording defect = CE-05).
7. **CI mechanics (e):** action tags exist; `verify-injection` runs green locally with zero extra env; gitleaks construct fails closed; docker v8.30.1 full-history scan → `no leaks found`.

## Verdict Rationale

- **❌ (counterexample found)** because CE-01 falsifies a P0 acceptance criterion verbatim ("green on `main`") while TEST_MATRIX records T-002 as *pass*, and CE-02 falsifies a citable evidence number (70 → actual 73, never 70).
- CE-04..CE-06 are Medium counterexamples to the *robustness* wording of REQ-P0-5/P0.4, with the core mechanisms otherwise proven.
- REQ-P0-1/3/5/6 core claims withstood falsification; REQ-P0-4's basis is externally verified but its canary number and README wording carry the ⚠️.
- Gate condition: **CLOSED** for REQ-P0-2 until the lane is pushed and a green run exists (owner: orchestrator); remediation of CE-02/CE-03 is number correction in `ROADMAP`/`IMPLEMENTATION_PLAN`/`TEST_MATRIX`; CE-04/05/06 route to their respective owners (engineering/docs) — refuter made **no changes** (rules).

---

## Recheck (post-remediation, 2026-09-22)

**Reviewer:** review-refuter (same reviewer as the initial ❌; scoped re-run of
CE-01..CE-09 only — no full re-review, no routing-table re-run)
**State rechecked:** local `HEAD` = `origin/main` = **`e4ca3ce`** (verified by
`git fetch` + `rev-parse` both sides); PR #1 (`1cb79c8`) and PR #2 (`e4ca3ce`)
merged; all verdicts below re-derived from evidence gathered in this session.

**FINAL VERDICT: ✅ — all refutations failed; the claims hold now.**
Five counterexamples were remediated in live claims (CE-01/02/03/05/07); four
are properly superseded by normative three-block waivers whose compensating
controls demonstrably landed (CE-04/06/08/09); the process deviation is proven
**process-only** (zero red runs, ever).

### Per-CE table

| CE | Original counterexample | Status | Evidence (this session) |
|----|------------------------|--------|--------------------------|
| CE-01 | zero workflow runs / workflow never pushed; "green on `main`" false | **refuted (remediated)** | Workflow now on `origin/main` (`e4ca3ce`). Citations landed: `ROADMAP.md:74` + `TEST_MATRIX.md:10` cite run **35781376642**. `gh run list` → **8 runs ever, `[{success ×8}]`, zero red**: main runs `35781376642` (PR #1 merge) and `35781958949` (PR #2 merge) both `completed success`, job detail `verify: success` + `secret-scan: success` on **both**; branch runs `35780360945`, `35781362973`, `35780527756`, `35781367274`, `35781900198`, `35781906623` all success. Acceptance "runs on every push; green on `main`" now holds with run-ID proof. |
| CE-02 | "70 assertions" never true (actual 73) | **refuted (remediated)** — 1 residual nit | Live claims fixed: `ROADMAP.md:44` → "`verify-injection` (73)"; `IMPLEMENTATION_PLAN.md:47` → "73 assertions, … count corrected from an earlier mis-citation of 70" (commit `5687135`); `TEST_MATRIX.md:25` records the correction. Re-ran `npx tsx scripts/verify-injection.ts` at `e4ca3ce` → **exit 0, 73 ok, 0 FAIL, ALL PASS**. *Nit:* literal "70 assertions" survives only inside historical gate artifacts (`quality-assurance.md:39` = the finding text; `review-readability.md:46` = that reviewer's evidence cell; this file's CE-02 row) — no live claim carries it. |
| CE-03 | "24 commits" stale | **refuted (remediated)** | Basis corrected to "**25 commits scanned of 26 in history**" at `TEST_MATRIX.md:10,:27` + `IMPLEMENTATION_PLAN.md:51` — exactly matching my original run. Counting rule resolved: gitleaks excludes root + merge commits (26−1root=25 ✓). Fresh re-run at `e4ca3ce` (allowed docker command): **31 commits scanned / 34 in history, `no leaks found`** — covers all newly merged gate artifacts too. |
| CE-04 | empty-new-name hooks diverge; README "name wins" overstated | **superseded-by-waiver (W6)** + doc overstatement removed | Overstatement fixed: `README.md:377-378` now "When both spellings are set **to non-empty values**, the `AGENT_MEMORY_*` name wins" (carve-out matches `env.ts` nonEmpty vs hooks `??`). `README.md:382-393` "Two migration traps" documents split-brain **and** the empty-string trap verbatim (server falls back; hooks `""` → no bearer → 401 swallowed). `WAIVERS-P0.md` **W6** carries the full three-block (accepted-risk — incl. "server-side secret is never dropped — REQ-P0-5's server claim holds"; controls; expiry 2026-12-21 or P1-unify via proposal lane) + sign-off + residual. Code divergence accepted by design (behavior change = own proposal); **no claim overstates it anymore** → refutation fails. |
| CE-05 | README self-contradiction on flag-vs-key (quick-start + limitation #2) | **refuted (remediated)** | Commit `f9c4e8d` (docs-only, `git show --stat`: CONTRIBUTING/README/ROADMAP/SECURITY/TEST_MATRIX). Quick-start `README.md:88-92`: "that **key — not the flag** — is what decides persistence… A project whose `helix.toml` has no `storage = \"disk\"` key runs memory storage". Limitation #2 `README.md:422-427`: same key-not-flag framing. Both former contradictions gone; wording now matches the official Helix `--persist` basis I verified in the initial review. |
| CE-06 | bootstrap advisory regex false negatives | **superseded-by-waiver (W3)** + control landed | `WAIVERS-P0.md` **W3** names all three FN cases verbatim (commented-out key, wrong table, container-created-before-key), states advisory is non-blocking by design, and lists controls with owner/expiry/sign-off/residual. Control landed: `README.md:429-435` **Durability & recovery** (restart-volume survival, host-reboot runbook, symptom-free-failure warning, "check `helix status` first") + artifact `evidence/p0-4-restart-canary.log` exists (full pre/restart/post log, `storage: disk` pre+post, canary found attempt 1, `RESULT: PASS` — this also clears my original P0-4 ⚠️). |
| CE-07 | clients default to 3111 after server reroute | **refuted (remediated)** | `README.md:413-417`: "Starting ours on `3151` does **not** move the clients: hooks, the plugin, and `verify` still default to `http://127.0.0.1:3111` … **every client process must set `AGENT_MEMORY_URL=…3151` explicitly**. Skip it and captures and recalls are silently aimed at whatever occupies `3111`." Matches my traced code exactly (`hooks/capture.mjs:117`, plugin `DEFAULT_BASE` `:69`, `verify.ts:28`, `recall.mjs:35` all default 3111; config table `README.md:362` states it too). Text ↔ code aligned. |
| CE-08 | verify-env ungated in CI and PR bar | **superseded-by-waiver (W2)** + control landed | Bar text landed: `CONTRIBUTING.md:67-69` — "The per-PR bar is the three commands above; **also run `npm run verify-env` when your change touches env reading, the legacy fallback, or the port hint**" (script inventory also names its 21 assertions). `WAIVERS-P0.md` **W2** three-block honest ("gated in neither CI nor the PR bar"), controls = recorded 21/21 + that CONTRIBUTING line, expiry with the explicit decision (gate in CI or formally out-scope), owner/sign-off/residual. |
| CE-09 | gitleaks same-origin checksum; tag-not-SHA actions; actionlint unverifiable | **superseded-by-waiver (W4)** + artifact landed | `evidence/actionlint.log` **exists**: records the exact cmd (docker `rhysd/actionlint`) + `exit=0` — actionlint is silent-on-success, so exit 0 = "0 errors" as claimed (QA-05 half). `WAIVERS-P0.md` **W4** three-block substance is complete: limitation restated verbatim (same-origin = corruption guard only, offline verification impossible as wired; mutable `v4.4.0` tags), honest rationale (no doc claims SHA-pinning; workflow editor already owns CI), controls (sha256 step + exact `8.30.1` + tags verified via `git ls-remote` + independent docker scans), concrete fix condition ("pin literal sha256 + action commit SHAs"), expiry 2026-12-21/P1, security sign-off, residual with likelihood/blast-radius. My fresh docker scan at `e4ca3ce` independently corroborates clean (31/34, no leaks). |

**None of CE-01..CE-09 still holds.**

### Process-deviation audit (PR #1 merged on `pending` checks)

- `gh run list --limit 50 --json conclusion` → **`[{c: success, n: 8}]`** — every
  run this repo has ever executed succeeded; **no run of this tree ever went
  red** (no failure/cancelled/timed-out, ever).
- The branch run pending at merge time, `gh run view 35781362973` →
  `completed success` (created `2026-09-22T20:36:15Z`, branch
  `feat/p0-publishable-foundations`).
- The merge's main run `35781376642` → `completed success`, jobs
  `verify: success` + `secret-scan: success`; PR #2's branch runs
  (`35781900198`, `35781906623`) and main run (`35781958949`, both jobs
  success) all green.
- **Conclusion: the gate's "grepped FAIL instead of requiring green" slip is
  process-only** — the tree it merged went green on the branch before/after
  merge and green on `main`; no technical debt from the slip, but the check
  discipline should require `success`, not absence-of-FAIL (observation only —
  no process signal issued by this reviewer).

### Fresh re-runs this session (allowed set)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 ✓ |
| `npx tsx scripts/verify-injection.ts` | exit 0, **73 ok / 0 FAIL / ALL PASS** ✓ (re-confirms CE-02 fix) |
| docker `zricethezav/gitleaks:v8.30.1 detect` @ `e4ca3ce` | **31 commits scanned (of 34), `no leaks found`** ✓ |
| `git fetch` + `rev-parse` HEAD/origin/main | both `e4ca3ce` ✓ (state claim verified, not trusted) |
| `gh run list` / `gh run view` (7 runs + jobs) | 8/8 success ever ✓ |

### Residual nits (explicitly non-blocking, no counterexample)

1. `review-readability.md:46` still cites "(70 assertions)" inside that
   reviewer's historical evidence cell — artifact-of-record, not a live claim
   (all live claims corrected, `TEST_MATRIX.md:25` documents the fix).
2. Waived residuals with dated expiries remain by design: W2 (verify-env
   ungated), W3 (regex FNs), W4 (same-origin checksum / tag-pinned actions),
   W6 (empty-new-name code divergence) — all expire 2026-12-21 or their named
   milestone, with re-review owners.
3. gitleaks raw count ≠ `rev-list` count is inherent (root + merge commits
   excluded); current honest basis: 31 scanned / 34 in history, no leaks.

### Recheck verdict rationale

- ✅ = "all refutations failed — claims hold now": every original
  counterexample is either **killed by landed remediation with verifiable
  evidence** (CE-01/02/03/05/07) or **legitimately superseded by a
  normative three-block waiver whose compensating controls are present on disk
  and accurate to the code** (CE-04/06/08/09). The one process deviation is
  evidenced as never-red.
- This reviewer issues **no fixes, no commits, no process signals**; the
  deliverable append + verdict-line update are the only writes (rules).
