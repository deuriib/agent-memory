# Automation/Ops Review: SPEC-P4-OPS-RUNBOOK — P4 OPS

**Reviewer:** espinoza (R8, `general(espinoza)` — Automation/Ops Owner, quality-gate)
**Date:** 2026-09-24
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md#REQ-OPS-RUN-01..15 / HARD:subagents / GATE:implementation done / DOMAINS:R8`
**Inputs read:** `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md` (§4a–4e), `bin/agent-memory.mjs` (1,378 lines — full read), `scripts/verify-ops.ts` (300 lines — full read, §§A–L + headerProof), `TEST_MATRIX.md` (P4 OPS section + per-command bar #1–10), `IMPLEMENTATION_PLAN.md` (Step 0 probe A3 + Step 5 live window), `.github/workflows/ci.yml` (53 lines), `helix.toml` (18 lines), `package.json` (47 lines)
**Verdict:** **PASS** — all runbook contracts landed as code, CI unchanged, evidence wiring complete, no forbidden primitives, no dev restart. Zero Critical/High open.

## Checklist (per `frame-ship/skills/quality-gate/references/domains/automation-review.md` — runbook/flags/capacity, CI gates, evidence wiring)

- [x] Runbook §4a doctor verdict/exit contract — closed set 0/1/2/3/4/5, precedence 5>4>3>1>0, single VERDICT line, C1..C5 all run, C1→C3→C2 order
- [x] Runbook §4c migration — `--migrate` ABORT fail-closed (A3 unsupported-runtime), dry-run default zero writes, --apply --yes only write path
- [x] Runbook §4d stop ownership + forbidden primitives — tracked-PID only, re-verify per signal, named instance only, no pkill/fuser/killall/port-kill/docker kill/--persist
- [x] CI gates green & unchanged — typecheck + verify-injection + lifecycle + capture + skills still green, verify-ops 99 + verify 243 pasted, helix.toml slot2 additive only
- [x] Evidence wiring — TEST_MATRIX per-command bar #1–10 pasted, live window declared exclusive ports/instances, no dev restart
- [x] Config frozen — `helix.toml` `[local.dev]` frozen, slot2 `storage="disk"` additive patch, no `--persist` as arg

## 1. Runbook §4a — doctor 0/1/2/3/4/5 precedence 5>4>3>1>0, single VERDICT, C1..C5 all run, C1→C3→C2 order

| Contract (SPEC-P4-OPS-RUNBOOK §4a) | Landed code (`bin/agent-memory.mjs`) | Evidence (`scripts/verify-ops.ts` + `TEST_MATRIX.md`) | Result |
|---|---|---|---|
| Exit 0 `healthy`, 1 `doctor-check-failed`, 2 usage, 3 `upstream-holds-port`, 4 `helix-down`, 5 `secret-missing` — closed set | `bin/agent-memory.mjs:182-184` USAGE table `0 healthy · 1 doctor-check-failed · 2 usage · 3 upstream-holds-port · 4 helix-down · 5 secret-missing`; `bin/agent-memory.mjs:1327-1344` fixed precedence block `if secretMissing →5 else if helixDown →4 else if upstreamPort →3 else if checkFailed →1 else 0 healthy` | `scripts/verify-ops.ts:142-162` §E asserts all 5 tokens present + precedence idx order `secretMissing>helixDown>upstreamPort>checkFailed` + `closed set 0/1/3/4/5` + `exactly one VERDICT`; `TEST_MATRIX.md:122-124` bar `99 passed` includes §E green | **PASS** |
| Fixed precedence `5>4>3>1>0` chooses final verdict (not execution order) | `bin/agent-memory.mjs:1327-1330` comment `fixed precedence 5 > 4 > 3 > 1 > 0` + `if/else if` chain in that exact order; `bin/agent-memory.mjs:1165-1166` `fixed precedence 5 > 4 > 3 > 1 > 0, one VERDICT line` | `scripts/verify-ops.ts:146-149` `order = ["secretMissing","helixDown","upstreamPort","checkFailed"]` + idx ordering check `check("precedence 5>4>3>1>0 encoded", ordered)` | **PASS** |
| Exactly one terminal `VERDICT: <name>` line | `bin/agent-memory.mjs:1343` `out("VERDICT: ${verdict}")` single site; fallback `bin/agent-memory.mjs:1376` `VERDICT: doctor-check-failed` only on uncaught internal error (exit 1 path) — normal doctor path emits once; `bin/agent-memory.mjs:184` `(fixed precedence 5 > 4 > 3 > 1 > 0, one VERDICT line)` | `scripts/verify-ops.ts:152-153` `check("doctor prints exactly one VERDICT line", verdictMatches === 1)` counts `/VERDICT:/g`; live `TEST_MATRIX.md:132` `VERDICT: healthy exit 0` single | **PASS** |
| C1..C5 all run every invocation, one `PASS|FAIL|INFO <check-id>` line per check | `bin/agent-memory.mjs:1183` `failures = {secretMissing,helixDown,upstreamPort,checkFailed}`; `bin/agent-memory.mjs:1193` C1 emit, `:1252-1257` C3 emit, `:1260-1285` C2 emit (INFO when not owned, FAIL/PASS when owned), `:1289` C4 emit, `:1306` C5 emit — all 5 emits unconditional before verdict; `bin/agent-memory.mjs:1185-1187` `emit` helper | `scripts/verify-ops.ts:154` `check("doctor prints PASS|FAIL|INFO <check-id>", /PASS|FAIL|INFO\s+C[1-5]/)`; harness §E verifies all lines printed even under induced failures (secretMissing + helixDown) | **PASS** |
| Execution order `C1 → C3 → C2 → C4 → C5` — C3 port-ownership before C2 authenticated probe (security C1) | `bin/agent-memory.mjs:1189-1193` C1 helix-healthz first; `:1195-1257` C3 ports second (computes `restOwned` via `verifyOwnedPid`+`isDescendant` at `:1207-1211`); `:1259-1285` C2 gated `if (!restOwned) { INFO no request sent } else { headers = secret?Bearer:{}; httpStatus(/memory/livez + /memory/health) }` — bearer construction inside owned branch only | `scripts/verify-ops.ts:265-287` headerProof synthetic HTTP server on `SLOT_FOREIGN` REST `3135` receives `0 Authorization headers` + `INFO skipped / NO request sent`; `bin/agent-memory.mjs:1259` comment `C2 rest-health: gated on C3 (security C1)` | **PASS** |

No deviation from §4a. Precedence is deterministic, verdict is single, all checks run, C1→C3→C2 landed.

## 2. Runbook §4c — `--migrate` ABORT (fail-closed)

| Contract (SPEC-P4-OPS-RUNBOOK §4c/REQ-05..08) | Landed code | Evidence | Result |
|---|---|---|---|
| `doctor --slot N --migrate` dry-run default — zero writes, prints plan, exit 0; no `--dry-run` flag | `bin/agent-memory.mjs:164-171` USAGE shows `--migrate [--apply --yes] [--backup-dir]` — no `--dry-run`; `bin/agent-memory.mjs:251-253` `--apply requires --migrate`, `--migrate --apply requires --yes`, `--backup-dir requires --migrate` else exit 2 | `scripts/verify-ops.ts:202-216` §H `doctor --migrate` → `MIGRATE ABORT` + `unsupported-runtime` + `no backup/MinIO` + `no backup file in repo root` | **PASS** |
| Only write path `doctor --slot N --migrate --apply --yes`; any other form → exit 2 usage | `bin/agent-memory.mjs:251-253` enforcement above; `bin/agent-memory.mjs:1312-1318` `--backup-dir` validated `SYSTEM_ROOTS` / outside `$HOME&&/tmp` / parent missing → `path-refused` | `scripts/verify-ops.ts:208-214` `check("--migrate --apply without --yes -> exit2", code===2)` + `check("--apply without --migrate -> exit2", code===2)` | **PASS** |
| A3 FAIL → any `--migrate` fails closed `MIGRATE ABORT: unsupported-runtime` — never a write, no backup, no copy, MinIO volume retained | `bin/agent-memory.mjs:1-37` header probe A3 FAIL narrative; `bin/agent-memory.mjs:892` `HELIX_DATA_DIR deliberately absent — probe A3 failed`; `bin/agent-memory.mjs:1308-1325` any `flags.migrate` sets `checkFailed=true`, `reason = "unsupported-runtime — probe A3 failed: helix CLI 3.3.0 does not forward HELIX_DATA_DIR (framing 3b decision pending orchestrator)"`, prints `MIGRATE ABORT: <reason>` + `HINT: no source was read, no backup was written, no target was touched; MinIO volume retained`, appends audit on `--apply` | `scripts/verify-ops.ts:205-212` §H `MIGRATE ABORT + unsupported-runtime` + `no backup/MinIO` + `also aborts` for `--apply --yes` + `no backup file in repo root`; `TEST_MATRIX.md:109` T-P4OPS-08 `DONE* partial — abort path proven; no data moved per A3`; `IMPLEMENTATION_PLAN.md:24-44` Step 0 probe FAIL table (binary 0 hits, `docker inspect` no HELIX_DATA_DIR, skill docs direct-Docker mode) | **PASS** |

Mismatch risk R4 handled exactly as mandated: ABORT, never partial migration, orchestrator frames 3b.

## 3. Runbook §4d — stop ownership + forbidden primitives

| Contract (SPEC-P4-OPS-RUNBOOK §4d/REQ-13..14) | Landed code | Evidence | Result |
|---|---|---|---|
| `stop --slot N` signals exactly two target kinds: (a) slot-owned REST PID from state file after cmdline re-verification, (b) slot-bound Helix instance `helix stop <name>` | `bin/agent-memory.mjs:998-1108` `cmdStop`: resolves `statePathOf(data.path,slot)` → `readState` → config-derived `instanceBinding(slot)` (`:1026`) prints `instance: ${binding.name}`; refuses if unregistered (`:1028-1032`) or `state.helixInstance !== binding.name` (`:1033-1039`); REST: `:1044-1074` | `scripts/verify-ops.ts:109-122` §C stop idempotent exit 0, foreign `3135` survives two stops; `TEST_MATRIX.md:132` live `stop --slot 2` exit 0 + second `stop` exit 0 idempotent, `helix status dev` unchanged | **PASS** |
| Each signal individually re-verified: `verifyOwnedPid` before SIGTERM and again immediately before SIGKILL (C10); mismatch → `stale-pid` note, no signal, exit 1 | `bin/agent-memory.mjs:452-459` shared `verifyOwnedPid` (alive + `src/server.ts` in cmdline + cwd==ROOT); `:1049` `if (!verifyOwnedPid(pid)) → stale-pid … signal skipped return 1`; `:1056` `SIGTERM` → `waitUntilDead 5s`; `:1060-1063` `if (!verifyOwnedPid(pid)) → stale-pid identity changed during grace — SIGKILL skipped return 1` → `:1066` `SIGKILL` | Same as above + `scripts/verify-ops.ts:217-232` §I foreign `r1=3115` survives all four subcommands | **PASS** |
| Helix is named-instance only (`helix stop <that-name>`), never bare, never foreign | `bin/agent-memory.mjs:1077-1094` `runHelix(["stop", binding.name])` with `binding.name` printed; `bin/agent-memory.mjs:640-656` `runHelix` captures child text and drops it (no raw passthrough) | Live bar `helix: stop slot2 (exit 0)` then idempotent; `helix status dev` `6969 up` unchanged | **PASS** |
| Forbidden primitives absent: no `pkill`/`fuser`/`killall`/port-pattern kill/blanket `docker kill/rm`/`docker volume rm`/bare `helix stop`/`helix prune`/`helix delete`/`--persist` as arg | `bin/agent-memory.mjs` grep 0 hits for `pkill|fuser|killall|docker kill|docker rm|helix prune|helix delete|--persist` outside comments; USAGE comment `helix start [INSTANCE]` is docs only, impl always passes instance arg; `NEVER_BIND = [3111,3112,3113,3151,6969]` at `:76` + derivation defense-in-depth `:797-802` | `scripts/verify-ops.ts:225-230` §I static grep 7 needles absent + `persistCalls <=2` doc-only; `TEST_MATRIX.md:112` T-P4OPS-10 static+live green; this review `grep -c` 0 persist as arg | **PASS** |

Stop is provably restricted to slot-owned processes (state-file PID + `helix.toml` instance name + cmdline re-verification). Never-kill upstream holds.

## 4. CI gates — typecheck + verify-env + lifecycle + capture + skills still green, verify-ops 99, verify 243, no CI weaken

| Gate | CI (` .github/workflows/ci.yml:21-30,41-53`) | Pasted evidence (`TEST_MATRIX.md` per-command bar) | This review recomputation | Result |
|---|---|---|---|---|
| `npm run typecheck` | `:22` `run: npm run typecheck` — unchanged | `#1` `exit 0 (0 errors) — bin .mjs outside TS program` | bin `.mjs` outside TS program (no `src/` diff) — consistent | **PASS** |
| `npx tsx scripts/verify-injection.ts` | `:25` | structural injection (Helix-free) | ci.yml line intact | **PASS** |
| `npx tsx scripts/verify-lifecycle.ts` | `:27` `run: npx tsx scripts/verify-lifecycle.ts` | `#4` `123 passed, 0 failed / VERIFY PASS` (prior 117+6) | ci.yml line intact | **PASS** |
| `npx tsx scripts/verify-capture.ts` | `:28` | `#5` `137 passed, 0 failed` | ci.yml line intact | **PASS** |
| `npx tsx scripts/verify-skills.ts --structural` | `:30` | `#6` `73 passed, 0 failed / VERIFY SKILLS PASS` | ci.yml line intact | **PASS** |
| pinned gitleaks `detect --source=. --no-banner --redact` | `:41-53` pinned `8.30.1` checksum-verified | `#8` `package-lock.json empty`, `#9` `git diff --stat src/ db/ hooks/ plugins/` empty | ci.yml secret-scan job intact | **PASS** |
| `npm run verify-ops` (HARD: not added to CI unless Helix-free) | **not in ci.yml** — correct per `SPEC-P4-OPS-RUNBOOK.md:198-200` (CI Helix-free discipline) | `#2` `99 passed, 0 failed / VERIFY PASS (C1 header proof: synthetic server 0 Authorization headers; §A–§L)` | `grep verify-ops ci.yml` → 0 hits; harness Helix-free except gated live checks (DEFER not FAIL) | **PASS** |
| `npm run verify` | deliberately NOT in CI (`ci.yml:23-25` comment `needs live server + Helix, NOT run here`) | `#7` `AGENT_MEMORY_URL=http://127.0.0.1:3151 … npm run verify` `243 passed, 0 failed` | ci.yml comment intact | **PASS** |
| `npm run verify-env` (local port-guard, TEST_PORT 3199) | local — not in CI | `#3` `21 passed, 0 failed` | `scripts/verify-env.ts:29-35` discipline preserved | **PASS** |
| `.github/workflows/ci.yml` unchanged | AC-09 `git diff .github/` empty | `git diff HEAD -- .github/workflows/ci.yml` empty (this review) | **PASS** |

Per-command bar #1–10 is fully pasted and reconciled: harness section counts `A7+B6+C5+D9+E12+F14+G8+H6+I11+J8+K3+L5+headerProof5 ≈ 99` matches bar #2 `99 passed`. No suite weakened or skipped.

## 5. Evidence wiring — TEST_MATRIX per-command bar #1-10, live window exclusive ports/instances, no dev restart

| Wiring item (SPEC-P4-OPS-RUNBOOK §4e/REQ-10..11) | Evidence | Result |
|---|---|---|
| TEST_MATRIX `## P4 OPS` is the lane singleton, in-place update, never a second matrix file | `TEST_MATRIX.md:97-134` — section exists, rows `T-P4OPS-01..15` shape `REQ-ID | Evidence ID | Description | Type | Status | Commit` per `TEST_MATRIX.md:10-13` | **PASS** |
| Per-command result bar #1-10 pasted verbatim | `TEST_MATRIX.md:119-132` `#1 typecheck 0` / `#2 verify-ops 99` / `#3 verify-env 21` / `#4 lifecycle 123` / `#5 capture 137` / `#6 skills 73` / `#7 verify 243 on 3151` / `#8 git diff src/ db/ empty` / `#9 package-lock empty` / `#10 live slot-2 window DONE` | **PASS** |
| Declared exclusive live window — ports + instances touched, no collision with parallel lane | `TEST_MATRIX.md:119` `Per-command bar (live evidence, server :3151 + slot2 window 3114/6970, instance slot2, dev read-only)`; `#10` `start --slot 2` → `doctor healthy` → `remember→search 3114` → `stop --slot 2` → idempotent; `IMPLEMENTATION_PLAN.md:54` `Ports touched: 3114/3115/3116/6970; instances: slot2 (started+stopped), dev read-only probes only`; `:75` `Config undo: git checkout -- helix.toml` | **PASS** |
| `dev` never restarted — `helix status dev` uptime/PID identical after slot-2 stop | `TEST_MATRIX.md:132` `helix status dev unchanged (6969 up)`; `IMPLEMENTATION_PLAN.md:54` `dev read-only probes only`; `bin/agent-memory.mjs:787-811` start probes helix `200` then claims `already serving` without restart | **PASS** |
| Session-node budget declared (+17/run, budget 25) | `TEST_MATRIX.md:77-89` RK-01 `+17 per verify run, 490→507→524` + `docs/CONTRACT.md §5` declaration; bar `243 green` post-declaration | **PASS** |

## 6. Config frozen — `helix.toml` [local.dev] frozen, slot2 `storage="disk"` additive only, no `--persist`

| Check | Spec HARD | Landed | Result |
|---|---|---|---|
| `[local.dev]` frozen (port 6969, storage disk, image/tag) | REQ-OPS-RUN-09 + A3 | `helix.toml:6-10` `[local.dev] port=6969 image=ghcr.io/helixdb/helixdb tag=v0.0.6 storage="disk"` — identical to prior lane; `git diff HEAD -- helix.toml` shows only additive block below | **PASS** |
| slot2 additive only — `[local.slot2]` written by `helix add local --name slot2 --port 6970` plus `storage="disk"` patch (sanctioned config, not source) | REQ-OPS-RUN-13 binding config-derived | `helix.toml:12-16` `[local.slot2] port=6970 storage="disk"` ; `bin/agent-memory.mjs:838-862` slot≥2 registration via `helix add local --name slotN --port H(N)` then `storage="disk"` patch if missing; `TEST_MATRIX.md:132` `helix.toml only [local.slot2] additive (sanctioned)`; `git diff --stat src/ db/` empty | **PASS** |
| No `--persist` as arg (only doc) | NFR-A + §4d | `bin/agent-memory.mjs` grep `--persist` 0 hits as arg (only USAGE comment lists allowed `helix start` flags without using it); `scripts/verify-ops.ts:229-230` `persistCalls <=2 doc-only` | **PASS** |
| No new deps | HARD `no new deps` | `package.json:14-15` `bin` + `verify-ops` script only; `dependencies`/`devDependencies` unchanged (`@helix-db/helix-db 3.0.4`, `zod`, `tsx`, `typescript` only); `git diff HEAD -- package-lock.json` empty | **PASS** |
| `src/ db/ hooks/ plugins/` frozen | REQ-OPS-RUN-10 KR2 `git diff empty` | `git diff HEAD -- src/ db/ hooks/ plugins/` empty (this review) | **PASS** |

## Findings

| ID | Severity | Finding | Evidence | Owner | Remediation |
|---|---|---|---|---|---|
| — | — | **No Medium/High/Critical.** All 6 checklist items landed as code with harness + live evidence and exact line citations above. | cited in §§1–6 | — | — |
| R8-OBS-01 | Low (observation) | T-P4OPS-09 Commit column shows `"(this commit)"` not a hash — expected for the lane-closing docs merge commit; hash resolves on merge (same as QA O-01). Not a gate-blocking trace gap. | `TEST_MATRIX.md:109` T-P4OPS-09 `Commit` `(this commit)`; QA `quality-assurance.md:86` O-01 | orchestrator (merge owner) | merge resolves hash; no in-lane fix |
| R8-OBS-02 | Low (accepted residual) | `helix.toml` additive `[local.slot2]` is the one allowed config delta (official `helix add local` + `storage="disk"` patch). Revert is single-command `git checkout -- helix.toml`. | `IMPLEMENTATION_PLAN.md:75` rollback + `helix.toml:12-16` | R1 `general(vasquez)` | no action this lane |

No findings block the gate. Security C1 (bearer gating) and QA traceability are owned by their respective reviewers; this automation review does not duplicate those verdicts.

## Verdict Rationale

- **Runbook §4a** is byte-exact: the closed `0/1/2/3/4/5` contract and `5>4>3>1>0` precedence are an `if/else if` chain (`bin/agent-memory.mjs:1327-1344`), one `VERDICT:` line (`:1343`), all five `emit` sites run (`:1193/:1252/:1260/:1289/:1306`), and `C1→C3→C2` order is enforced with `restOwned` gating the bearer (`:1189→:1195→:1259`) — proven by the synthetic server `0 Authorization` proof (`scripts/verify-ops.ts:265-287`).
- **Runbook §4c** is fail-closed: any `--migrate` prints `MIGRATE ABORT: unsupported-runtime` (`:1320`) with `HINT: no source … MinIO volume retained` and never reaches a write; `--migrate --apply --yes` is the only write path and also aborts while A3 is FAIL.
- **Runbook §4d** is enforced: stop re-verifies `verifyOwnedPid` before SIGTERM (`:1049`) and again before SIGKILL (`:1060`), `helix stop <name>` is always named (`:1077`), and forbidden primitives/`--persist` are statically absent.
- **CI** is unchanged and green per the bar: the four CI jobs remain `typecheck:0 rely: injection+lifecycle+capture+skills` plus pinned `gitleaks`, `verify-ops 99` and `verify 243` are local-only evidence (not added to CI), `ci.yml` diff empty.
- **Evidence wiring** is complete: TEST_MATRIX per-command bar #1–10 pasted with counts, live window declares `3114/6970` + `slot2` vs `dev 6969 read-only`, no dev restart (`helix status dev` unchanged).
- **Config** is frozen except the sanctioned `[local.slot2] storage="disk"` additive patch; no `--persist`, no `src/db` edits, no lockfile drift.

## Residual Risk (accepted, owner + expiry)

| # | Risk | Owner | Expiry / re-review |
|---|---|---|---|
| 1 | **PID-reuse TOCTOU between `verifyOwnedPid` and signal** — narrowed to ms by cmdline re-verification + C10 re-verify before SIGKILL; inherent without `pidfd` pinning. | R1 `general(vasquez)` | Re-review if PID namespace changes (see `security-reviewer.md` #1) |
| 2 | **A3 FAIL — HELIX_DATA_DIR forwarding unsupported** — `--migrate` is abort-only; if A3 flips to PASS, migration write path needs new probe + backup-mode evidence before claiming KR3. | R1+R8 escalated to orchestrator | 2026-12-31 or framing-3b decision (whichever first) — same as `security-reviewer.md` #4 |
| 3 | **Slot-2 config additive** — `[local.slot2]` remains after lane (`helix add local` registration). Revert is `git checkout -- helix.toml` + `helix stop slot2` if desired. | R8 `general(espinoza)` | Re-verify on next P4 lane that touches slots |

## Sign-off

- [x] **automation/ops owner (R8) — `general(espinoza)`:** **PASS**. Runbook check list C1..C5, verdict/exit contract §4a, stop ownership §4d and forbidden primitives §4d consumed as written; CI gates unchanged with per-command bar #1-10 pasted (typecheck 0, verify-ops 99, verify-env 21, lifecycle 123, capture 137, skills 73, verify 243, slot2 live window DONE); live window declared exclusive `3114/6970` + `slot2` with `dev 6969` read-only and never restarted; `helix.toml` `[local.dev]` frozen, `[local.slot2] storage="disk"` additive only, no `--persist`. No High open, residual risks explicit with owner+expiry. This review touched only this file — no implementation file modified.
