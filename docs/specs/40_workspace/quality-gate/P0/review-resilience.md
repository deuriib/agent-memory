# Resilience Review: P0

**Reviewer:** review-resilience (independent subagent — did not author this work)
**Date:** 2026-09-22
**Checklist:** `frame-ship/skills/quality-gate/references/engineering/resilience-review.md`
**Scope:** commits `4cf0f6a` · `7caa14d` · `c551774` · `bb335e2` · `1af2cde` · `8aba7b9` (diff `069e1cf..8aba7b9`) through the failure-mode lens: paths (a)–(h) from the dispatch packet
**Verdict:** ⚠️ conditional

## Checklist

- [x] Graceful degradation under partial failure — hooks swallow + exit 0 (`hooks/capture.mjs:34-35,143-145`), plugin fail-soft to `null` + `lastError` (`.opencode/plugins/agent-memory.ts:545-581`), handoff degrades counts into `signals` (`src/server.ts:369-373`)
- [~] Circuit breakers / retries with backoff — plugin negative-cache = TTL breaker (retried once per TTL, `agent-memory.ts:566`); bootstrap retry covers **only** `index_not_found`, connection-refused exits immediately (`scripts/bootstrap.ts:76-79`) → RS-001 finding
- [x] Resource limits — 1 MiB body cap (`src/server.ts:35`), LRU+TTL recall cache (`agent-memory.ts:532-534,579`), bounded signals/content clips (`scripts/verify-injection.ts:161-169,225-229`)
- [~] Recovery from crash / restart — `helix restart dev` proven (T-004 canary `228cdf69`); **host reboot undocumented and silent** → RS-011 finding
- [x] No single point of failure introduced — upstream 3111/3112/3113 never touched; port reroute instead of displacement; hooks/server/plugin each fail independently
- [x] Observability — access log (method/path/status/ms only), `logSafeNote` reduces remote errors to stable codes (`src/errors.ts:63-73`), plugin `lastError` diagnostic (`agent-memory.ts:567,833`); hooks stay silent **by contract**, not by accident
- [~] Chaos scenarios tested — dead backend, HTTP 500, garbage body, EADDRINUSE, Helix-down preflight all covered by tests; **minio-down and host-reboot are untested** (no infra mutation allowed in this review; flagged below)

## Findings

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| RS-011 | **Medium** | repo-wide (docs) — no match for `restart policy` / `restart=` / `unless-stopped` / `systemd` / `reboot` in `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `helix.toml` | **(h) Host reboot is a documented nowhere.** P0.4 proves save survives `helix restart dev` (T-004), but nothing states what a HOST reboot does: `helix.toml:4` sets `container_runtime = "docker"` with no `--restart` policy recorded, and `AGENTS.md:42` only shows `sudo systemctl start docker` (manual start, not enable-on-boot). Data survives on the docker volume (assumption, below); **service availability does not** — and the degradation is symptom-free: hook exits 0 silently, `autoRecall` negative-caches → `null` → injection skipped, `lastError` is the only breadcrumb. The memory system goes dark with zero symptoms until a human runs `helix start`. The README's "durable default" claim (line 401) is honest about *data* but silent about *availability after reboot*. |
| RS-008 | Low | `scripts/bootstrap.ts:46-48`, `:40` | **(f) Advisory fails open on read error, and the regex can mask a volatile config.** Any `readFileSync` failure (EACCES/EIO) or missing file → silent skip → an actually in-memory instance goes unwarned, defeating the advisory's data-loss purpose. Worse, the check is `/storage\s*=\s*"disk"/` over raw text: a *commented-out* `# storage = "disk"` line MATCHES and suppresses the warning while live config is volatile; conversely valid TOML `storage = 'disk'` (single quotes) does NOT match → false alarm. Design is deliberate ("never blocks bootstrap", plan step 3 declares config-based), so severity is Low — but a read *failure* and a read *absence* are not the same as "config known good". |
| RS-001 | Low | `scripts/bootstrap.ts:58-61,76-79` | **(a) Helix down at bootstrap: loud, but no remedy line and no connection retry.** First failed query → `FAILED — bootstrapIndexes rejected by <url>: <err>` → exit 1 ✓ loud, zero silent-success paths. However: (1) no `run: helix start dev --disk --persist` remedy, which `verify-env` DOES print (`scripts/verify-env.ts:286`); (2) the contract §3 headline "Bootstrap retry" retries only `index_not_found` — a Helix mid-restart (connection refused) exits immediately with no backoff. Failing fast on a manual step is safe, hence Low, but the two Helix-down surfaces give inconsistent operator guidance. |
| RS-004 | Low | `src/server.ts:526-531` vs `scripts/verify-env.ts:392-437` | **(c) Hint gating is correct in code but only half-tested.** `server.on("error")` is attached at line 526 **before** `server.listen` at 533, and the request handler exists from `createServer` (line 459) — no unhandled-window if listen fails first ✓. Non-EADDRINUSE → `server error: <logSafeNote>` → exit 1, hint strictly gated by `systemErrorCode(err) === "EADDRINUSE"` ✓. **Gap:** verify-env section C asserts the hint is PRESENT on EADDRINUSE but never asserts it is ABSENT for another error code — the REQ-P0-6 "hint must NOT print otherwise" claim rests on code reading alone. Adjacent: invalid `AGENT_MEMORY_PORT` throws from `parsePort` inside un-wrapped `main()` (`src/server.ts:477-482,550`) → raw Node stack instead of a clean `[agentmemory]` line (still exit 1, no value leaked). |
| RS-006 | Low | `src/env.ts:28-30` → `src/auth.ts:22-47` | **(e) Whitespace-only env var is treated as SET — guard stays armed (fail-closed), but surfaces drift.** Trace: `nonEmpty(" ")` → `length > 0` → `readLegacyEnv` returns `" "` → `secretFromEnv` returns `" "` → guard **ARMED**, not disarmed (`auth.ts:43` only opens on `undefined`). Consequences: expected header `Bearer  ` (double space) — on REST, HTTP stacks trim trailing header whitespace → length mismatch in `bearerMatches` → **permanent 401 (lockout, fail-closed)**; on stdio MCP (`isMetaAuthorized`, exact compare, no HTTP normalization) `"Bearer  "` matches → **accepted**. Neither branch opens the REST guard — and note any "fix" that returned `undefined` for whitespace would **DISARM** the server (the dangerous direction). Comment/code mismatch at `env.ts:27` overlaps readability RD-004; this lens adds the guard-state trace: armed-with-whitespace = availability quirk + REST/MCP drift, **no auth bypass**. No test covers whitespace-only values (verify-env uses a UUID secret). |
| RS-009 | Low | `scripts/verify-env.ts:274-280,443-469` | **(g) Port-3199 preflight and exception reaping are clean.** Occupied → `FAIL preflight: test port 3199 is free — occupied — free 3199 (never touch 3111/3112/3113/3151), then re-run` → sections B/C skipped → summary + exit 1: explicit remedy, names the forbidden ports ✓. Exception path: `try { sections } finally { await cleanup() }` (`runAll`, lines 461-469) → ANY throw inside a section still reaps every live child (SIGTERM→SIGKILL) and closes the blocker before `runAll().catch` prints `verify-env crashed: <logSafeNote>` + exit 1 ✓. Residual edges (informational): an exception thrown *inside* `cleanup()` itself would abort remaining reaping (its internals are throw-resistant in practice); no SIGINT/SIGTERM handler → Ctrl-C orphans children on 3199 — self-healing, since the next run's preflight detects the orphan and prints the clean remedy. |

### What passed (evidence, not assertion)

- **(b) Storage failure → LOUD, no silent proceed.** Code walk: `bootstrap.ts` has no path to `READY` without both a successful `bootstrapIndexes` and a successful `searchByText`; every catch exits 1 (`:58-61,:73-87`), and `main().catch` backstops (`:91-94`). `store.remember` catches nothing — write failures propagate to `respondToError` → 500 `{error:"internal_error"}` + `logSafeNote` (remote reduced to stable code, no content) (`src/server.ts:439-447`). Plus the contract §2 assertion at `src/store.ts:414-418`: *"a silent no-op write can never masquerade as success"* — the explicit anti-silent-proceed guard. The `helix.toml` advisory is config-text only and cannot see a runtime minio failure (declared design: "config-based advisory — `helix status` reads config too", plan step 3).
- **(d) Negative-cache: BOTH first-call and repeat-call, for BOTH failure classes.** Implementation `agent-memory.ts:545-581`: failure → `block: null` cached at `:578`, repeat within TTL returns from cache with no request (`:548-553`), "Never throws" documented at `:543`, retry bounded to once per TTL (`:566`). Tests: HTTP 500 first call + repeat at `verify-injection.ts:358-361` (`hits===3` held); connection-refused first call + repeat + speed proof at `:431-440` (`<50ms` = negative cached). Hook side: `capture.mjs` never blocks/prints under a dead backend (`:34-35,:143-145`), proven by verify-env section B (exit 0, empty stdout+stderr with nothing listening — recorded 21/21).
- **(a) verify-env Helix health check remedy present:** `verify-env.ts:286` "REAL FAILURE — Helix down or mid-restart; run: helix start dev --disk --persist" and `:317` explains health→500 as Helix-down, not an auth defect.
- **(g) abort-if-occupied message quality and finally-on-exception** — traced above, both hold.

## Stress Scenarios

| ID | Scenario | Expected | Observed | Pass? |
|----|----------|----------|----------|-------|
| RS-001 | Helix down at `bootstrap.ts` | loud fail + remedy | `FAILED — …rejected by <url>` + exit 1; **no remedy line**, no connection retry | yes* (Low: remedy missing) |
| RS-002 | Helix down at verify-env preflight | loud fail + remedy | `REAL FAILURE … run: helix start dev --disk --persist` (`verify-env.ts:286`) — static confirm; script not executed (forbidden) | yes |
| RS-003 | disk storage failure (minio down) | fail loudly, never silent READY | code walk: no silent-success path; write → 500 + `logSafeNote`; no-op-write assertion (`store.ts:416-418`) | yes (static, assumption) |
| RS-004 | listen error, non-EADDRINUSE | `logSafeNote` + exit 1, **no hint** | code confirms gate at `server.ts:528`; **no negative test** | yes (static) |
| RS-005 | EADDRINUSE | hint + exit 1 | verify-env section C assertions match `portInUseHint` verbatim (recorded 21/21) | yes |
| RS-006 | hook/backend down, first + repeat call | never throws, negative-cached | verify-injection E + G, **re-run by me: ALL PASS** | yes |
| RS-007 | `AGENT_MEMORY_SECRET=" "` | guard state defined | guard ARMED; REST fail-closed 401 (lockout), MCP accepts; no bypass; no test | yes* (Low: drift) |
| RS-008 | unreadable `helix.toml` | advisory must not mask volatile config | catch → silent skip; regex can also mask a commented-out key | **no** (Low, fail-open advisory) |
| RS-009 | port 3199 occupied at verify-env | clean abort message, exit 1 | FAIL + remedy naming forbidden ports, B/C skipped, exit 1 | yes |
| RS-010 | exception mid-verify-env | children reaped in `finally` | `try/finally` at `:461-469` covers section throws; `catch` prints logSafeNote | yes |
| RS-011 | host reboot | documented recovery + no silent dark mode | data survives (assumed); service not auto-started; **zero documentation**; degradation symptom-free | **no** (Medium gap) |

\* passes its core expectation with a Low finding attached.

## Evidence personally gathered

| Claim | How I checked | Result |
|---|---|---|
| typecheck clean | `npm run typecheck` | exit 0 |
| negative-cache first+repeat, 500+refused | `npx tsx scripts/verify-injection.ts` | `ALL PASS` (sections E + G visible in my own run) |
| our server alive on 3151 | `curl http://127.0.0.1:3151/agentmemory/livez` | HTTP 200 |
| commits exist / touch expected scope | `git show --stat` ×6 | all six present, scope matches plan steps 1–7 |
| Helix-down remedy present (verify-env) | read `scripts/verify-env.ts:282-287,310-319` | remedy string confirmed; **script NOT executed** (forbidden) |
| hint gating / listener ordering | read `src/server.ts:456-538` | `on("error")` before `listen`; gate `=== "EADDRINUSE"` |
| whitespace trace | read `src/env.ts:28-30` + `src/auth.ts:22-47` | `" "` → armed; REST fail-closed, MCP match; no bypass |
| host-reboot doc gap | grep `restart policy\|restart=\|unless-stopped\|systemd\|docker restart\|reboot` | zero matches repo-wide |
| upstream untouched | reads + curl **3151** only; no kill/start/helix; no `verify-env` run | 3111/3112/3113 never interacted with |

## Verdict Rationale

⚠️ **conditional.** Every in-scope failure path either passes on evidence or
carries only a Low finding: Helix-down is loud (a), storage failures cannot
succeed silently (b), the EADDRINUSE gate and listener ordering are correct (c),
the negative-cache covers first and repeat calls for both failure classes under
my own re-run (d), whitespace-only secrets fail closed with no bypass (e), and
the verify-env preflight + finally-reaping are clean (g). No Critical or High
exists. The condition is RS-011 (Medium): P0.4's close-out advertises a
"durable default" while host-reboot behavior is documented nowhere and the
down-time failure mode is symptom-free — a persistence claim readers will
reasonably extend to "survives my laptop restarting", which is exactly what
nothing here supports. It is docs-only (README Known-limitations/Configuration
line stating: data survives on the docker volume; the container does NOT
auto-start — no restart policy is set; run `helix start dev --disk --persist`
after reboot), or an explicit ROADMAP row deferring it. Low findings
RS-001/004/006/008/009 can ride a later pass.

## Risks

- **Silent dark mode after host reboot** (RS-011): hooks silent by contract + plugin negative-cache means nobody is alerted when the whole memory stack is down; recall quality degrades to "no memories exist" with no signal to the operator.
- **Advisory fail-open** (RS-008): the one mechanism meant to prevent silent data loss is itself silently skippable; a read error or a commented-out TOML key removes the warning without removing the risk.
- **Whitespace secret lockout** (RS-006): an operator exporting `AGENT_MEMORY_SECRET=" "` gets a REST server that 401s its own clients forever while MCP still accepts — the divergence will read as "auth is flaky" rather than "env var has a stray space". Any future trim-fix MUST return the trimmed value, never `undefined` (which would disarm the guard).
- **Untested negative assertion** (RS-004): REQ-P0-6's "hint must NOT print on other errors" survives only as long as nobody refactors the gate — a one-line regression would ship green.

## Assumptions

- Minio/storage-backend-down behavior (RS-003) is inferred from the code walk (no catch-and-continue in `store.remember`, no READY path without two successful queries); no container or process was stopped to prove it — infra mutation is out of bounds for this review.
- Host-reboot data survival assumes the docker volume backing `storage = "disk"` is host-disk (not tmpfs); I verified `helix.toml:10` says `storage = "disk"` but did not inspect the volume driver.
- Recorded evidence I could not re-run (`verify-env` 21/21, verify 102/102, canary restart, gitleaks) is taken as recorded; I statically cross-checked the verify-env assertion strings against `portInUseHint` instead of executing the script (forbidden — port conflict).
- REST trailing-whitespace trimming for `Authorization` (RS-006) follows common HTTP-stack behavior (fetch spec strips trailing OWS); if a specific client passes it through byte-exact, that client is *authorized* with the whitespace secret instead — still no bypass of an *armed* guard, just a weaker one. Labelled an assumption, not an observed fact.
- Verdict scale follows the guardrail severity table: Medium = conditional impact → conditional verdict; Critical/High would have blocked. None exist here.
