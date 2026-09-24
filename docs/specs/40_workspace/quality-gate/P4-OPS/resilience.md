# Resilience Review: SPEC-P4-OPS — P4 ops control plane

**Reviewer:** resilience reviewer (R1, engineering — blast radius / rollback / incident handling)
**Date:** 2026-09-24
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F / HARD:subagents+<zero new deps, frozen src/db/hooks/plugins, never kill upstream, default 3111 untouched> / GATE:implementation done / DOMAINS:R1`
**Inputs read:** `bin/agent-memory.mjs` (1,378 lines — full read), `IMPLEMENTATION_PLAN.md` Rollback Points + Step 0 A3 FAIL + Steps 5–6, `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` Blast Radius + Rollback Plan + Risk Matrix, `package.json` (47 lines), `helix.toml` (18 lines), `docs/specs/20_backlog/SPEC-P4-OPS.md` §4.5 + §6 A3–A5
**Verdict:** **PASS** — blast radius matches approved proposal, rollback is immediate and complete, no data-loss path reachable, incident window was exclusive and left `dev` untouched. Zero Critical/High open.

## Checklist (per task packet + `IMPLEMENTATION_PLAN.md` Rollback Points)

- [x] Rollback is delete `bin` + revert `package.json` + stop slot2 (immediate) — `IMPLEMENTATION_PLAN.md:71-74,78-80`
- [x] Config revert is `git checkout -- helix.toml` — additive `[local.slot2]` only, `[local.dev]` frozen
- [x] No data loss — MinIO volume retained, no `prune`/`delete`/`volume rm` reachable, `--migrate` abort-only while A3 FAIL
- [x] Incident handling — live slot2 window exclusive (3114/6970), `dev` read-only probes only, no Helix dev restart
- [x] Blast radius matches `PROPOSED_CHANGES.md:88-94` — local-machine only, src/db/hooks/plugins frozen, no customer/regulator/revenue surface

## 1. Blast Radius

| Domain (PROPOSED_CHANGES.md:90-93) | Claimed radius | Landed evidence (`bin/agent-memory.mjs` + `helix.toml` + `package.json`) | Result |
|---|---|---|---|
| Engineering R1 — services/data | No runtime default change; `src/**`, `db/**`, `hooks/**`, `plugins/**` frozen; REST 3111 / Helix 6969 defaults untouched (NFR-C). New surface = one binary + one harness. Data at risk = dev MinIO dataset (migration only) + per-slot `~/.local/share/agent-memory/<slot>/` | `bin/agent-memory.mjs:1-24` hard-rules header (defaults untouched / state sibling not inside data dir); `bin/agent-memory.mjs:61-72` `REST_BASE=3111 HELIX_BASE=6969` — derivation only, no default overwrite; `bin/agent-memory.mjs:885-892` `serverEnv` derives `AGENT_MEMORY_PORT=R(N)` + `HELIX_URL=H(N)` via env/flags, `HELIX_DATA_DIR` deliberately absent (A3 FAIL) — zero `src/**` edit; `package.json:14-15,33` only `bin` + `verify-ops` additive | **PASS** |
| Automation/ops R8 — runbooks/capacity/evidence | README ops + `TEST_MATRIX.md ## P4 OPS` added; `.github/workflows/ci.yml` unchanged (A1, AC-OPS-RUN-09); dev Helix lifecycle touched only inside exclusive windows (R-010); session-node budget +17 per `verify` run (R-012) | `IMPLEMENTATION_PLAN.md:54-56` live window ports `3114/3115/3116/6970` instance `slot2` declared; `helix.toml:6-10` `[local.dev] port 6969 storage=disk tag v0.0.6` frozen; `helix.toml:12-16` `[local.slot2] port 6970 storage=disk` additive sanctioned config | **PASS** |
| Security R2 — secret surface + output hygiene | `AGENT_MEMORY_SECRET` presence flag only (`bearer: armed\|unset`), value never rendered, never in state file; output allowlisted (ports/PIDs/codes/`~` paths) | `bin/agent-memory.mjs:15-19,1157-1158,1288-1289` presence-only; `bin/agent-memory.mjs:627-635,640-656` `helixEnv()` strip + `runHelix` drop child text; `bin/agent-memory.mjs:119-130,132-146` `oneLine`+`collapse` sole renderer; `bin/agent-memory.mjs:356-364` state `0600` in `0700` dir — no secret field | **PASS** |
| Customers / regulators / revenue | **NOT touched** — single-user local tool, no multi-tenant data, no external send/filing, no billing/quota, no new PII store; Ley 172-13 limited to output hygiene allowlist | No `src/db` data-store change, no network-exposed surface beyond loopback `127.0.0.1:R(N)/H(N)` (`bin/agent-memory.mjs:888-890`); migration backup PII-store declared in README but never created while A3 FAIL | **PASS** |

No radius expansion beyond the approved proposal. Slot derivation is derivation-through-env only, not a default rewrite.

## 2. Rollback — Code Revert (immediate, owner R1)

| Claim (IMPLEMENTATION_PLAN.md:71-74) | Landed code — why rollback is clean | Result |
|---|---|---|
| Delete `bin/agent-memory.mjs` + `scripts/verify-ops.ts` | Both are new files with no inbound import from `src/**`, `db/**`, `hooks/**`, `plugins/**` (grep `bin/agent-memory` in src → 0 hits; `package.json:8-12` `files` still `plugins/opencode/...` only). No coupling. | **PASS** |
| Revert two `package.json` rows | `package.json:14-15` `"bin": {"agent-memory": "./bin/agent-memory.mjs"}` and `package.json:33` `"verify-ops": "tsx scripts/verify-ops.ts"` — only two additive rows. `package-lock.json` diff empty. No `dependencies`/`devDependencies` delta (`@helix-db/helix-db 3.0.4`, `zod`, `tsx`, `typescript` unchanged) | **PASS** |
| Zero residual coupling proof = `npm run typecheck` + five suites | `bin/agent-memory.mjs` is `.mjs` outside TS program — `npm run typecheck` unaffected; suites `verify`/`verify-env`/`verify-lifecycle`/`verify-capture`/`verify-skills` never import the binary (only spawn it in `verify-ops` which is also deleted) | **PASS** |
| ETA immediate | Revert is two `rm` + `git checkout -- package.json` — no build, no migration to undo, no data to reconcile (A3 FAIL → P4.4 has zero residue) | **PASS** |

## 3. Rollback — Config Undo (helix.toml)

| Claim (IMPLEMENTATION_PLAN.md:75-76) | Landed evidence | Result |
|---|---|---|
| `git checkout -- helix.toml` removes additive `[local.slot2]` | `helix.toml:6-10` `[local.dev]` frozen (`port 6969 image ghcr.io/helixdb/helixdb tag v0.0.6 storage=disk`) identical to pre-lane baseline; `helix.toml:12-16` `[local.slot2] port 6970 storage=disk` is the sole additive block written by `helix add local --name slot2 --port 6970` (`bin/agent-memory.mjs:838-862`) plus `storage="disk"` patch — sanctioned config registration (SPEC A5) not a source edit | **PASS** |
| `[local.dev]` needs no restore | No code path writes `[local.dev]` — `bin/agent-memory.mjs:845-861` scopes patch to `idx = lines.indexOf("[local.slotN]")` and splices `storage="disk"` under that header only; grep `local.dev` in bin → 0 hits beyond read path `instanceBinding` | **PASS** |

## 4. Rollback — Live Window Undo (slot2 only, volumes retained)

| Claim (IMPLEMENTATION_PLAN.md:78-80) | Landed code | Result |
|---|---|---|
| `agent-memory stop --slot 2` stops our server + `helix stop slot2` stops only slot2 containers | `bin/agent-memory.mjs:998-1108` `cmdStop`: `statePathOf(data.path,slot)` → `readState` → `instanceBinding(slot)` derives `slot2` from `helix.toml [local.slot2]` → `verifyOwnedPid(rest)` before SIGTERM (`:1049`) and again before SIGKILL (`:1060` C10) → `runHelix(["stop", binding.name])` (`:1077`) named instance only, `state` file `unlinkSync` (`:1098`), audit `appendAudit` (`:1106`). No bare `helix stop`, no port-scan signal, no `docker kill/rm` | **PASS** |
| Upstream `3111/3112/3113` and `helix dev` never signaled | `bin/agent-memory.mjs:76` `NEVER_BIND=[3111,3112,3113,3151,6969]` defense-in-depth refuse at `:797-802`; `bin/agent-memory.mjs:814-822` foreign quartet → `REFUSE exit 1 neverKillHint` no signal; `bin/agent-memory.mjs:803-811` helix-up probe → `already serving` without restart. Hints use `AGENT_MEMORY_PORT=3151` reroute (`bin/agent-memory.mjs:153-157`) | **PASS** |
| Volumes retained — no `prune`/`delete`/`volume rm` reachable | Static grep `bin/agent-memory.mjs` for `prune|delete|volume rm|docker rm|docker kill|pkill|fuser|killall|--persist` as arg → 0 hits (only doc strings/USAGE). `bin/agent-memory.mjs:92-93,1320-1322` abort hint `no source was read, no backup was written, no target was touched; MinIO volume retained`; `helix.toml` bind-mount list never lists a volume rm | **PASS** |

## 5. No Data Loss (MinIO retained, migration abort-only)

| Claim | Landed code — why loss is not reachable | Result |
|---|---|---|
| A3 FAIL → P4.4 data-dir/migration STOPPED, zero residue | `bin/agent-memory.mjs:25-37` file header probe A3 FAIL narrative; `IMPLEMENATION_PLAN.md:24-44` Step 0 table (binary 0 hits HELIX_DATA_DIR, `docker inspect` no passthrough/mounts, skill docs direct-Docker mode). `bin/agent-memory.mjs:892` comment `HELIX_DATA_DIR deliberately absent — probe A3 failed` — never set for any child | **PASS** |
| `doctor --migrate` aborts fail-closed, never a write | `bin/agent-memory.mjs:1308-1325` any `flags.migrate` → `failures.checkFailed=true`, `reason=unsupported-runtime — probe A3 failed…framing 3b decision pending orchestrator`, `err("MIGRATE ABORT: "+reason)` + `HINT: no source … MinIO volume retained`, abort is first branch — no backup/copy/verify before it. `--backup-dir` validated `SYSTEM_ROOTS` / outside `$HOME&&/tmp` / parent missing → `path-refused` before any write | **PASS** |
| Old MinIO volume never destroyed by any subcommand | `SPEC-P4-OPS.md:92-93 INV-008` + `PROPOSED_CHANGES.md:99` invariant preserved: no `helix prune`, no `helix delete`, no `docker volume rm` primitive in `bin/agent-memory.mjs` (static grep 0). `bin/agent-memory.mjs:1320-1322` second hint line `MinIO volume retained`; volumes `helix-agent-memory-dev-minio-data` untouched by `helix stop slot2` | **PASS** |
| State file never inside HELIX_DATA_DIR | `bin/agent-memory.mjs:22,294-301` `stateDirOf(dataDir)=dirname(dataDir)/state` — sibling, never child; `bin/agent-memory.mjs:356-364` `writeState` `0600` in `0700` dir, closed schema `isValidState` (`:337-354`). Retro-grade `HELIX_DATA_DIR` unset has no state-file side effect | **PASS** |

## 6. Incident Handling — Exclusive Live Window, Dev Read-Only, No Helix Dev Restart

| Claim (IMPLEMENTATION_PLAN.md:54-55 + §4 quality bar) | Landed evidence | Result |
|---|---|---|
| Declared exclusive window: slot2 `3114/3115/3116/6970` instance `slot2` vs `dev` `3111/6969` | `IMPLEMENTATION_PLAN.md:54` `Ports touched: 3114/3115/3116/6970; instances: slot2 (started+stopped), dev read-only probes only`; `bin/agent-memory.mjs:65-72,102-113` `derive(2) → rest 3114 r1 3115 r2 3116 helix 6970 instanceName slot2` — quartet ∩ `{3111,3112,3113,6969}` = ∅ by §4.2 invariant | **PASS** |
| `dev` read-only probes only — never started/stopped/restarted | `bin/agent-memory.mjs:805-811` helix probe `httpStatus /healthz 200` → `already serving on port` `continue` without `helix start dev`; `bin/agent-memory.mjs:787-811` pre-flight claims owned helix without restart; `bin/agent-memory.mjs:1110-1160` `cmdStatus` and `bin/agent-memory.mjs:1189-1193` `cmdDoctor` C1 use `httpStatus` read-only fetch with 2–3 s timeout, no spawn | **PASS** |
| No Helix dev restart at any point — including readiness, stop, doctor, harness | Readiness gate `bin/agent-memory.mjs:922-935` polls `HELIX_URL/healthz` + `/memory/livez` with `Promise.all(httpStatus…)` polling — no `helix restart`; `bin/agent-memory.mjs:1084-1094` `helix stop <name>` is named `slot2` only; `scripts/verify-ops.ts` not executed here but `IMPLEMENTATION_PLAN.md:54` declares `helix status dev` unchanged after slot2 stop — consistent with no dev restart code path | **PASS** |
| Live window idempotent and self-cleaning | `bin/agent-memory.mjs:771-785` `cmdStart` idempotence `already running exit 0` when `verifyOwnedPid(rest)` holds; `bin/agent-memory.mjs:1011-1014` `cmdStop` absent state → `not running exit 0` idempotent; rollback of live window is one `stop --slot 2` (SIGTERM 5 s + SIGKILL 3 s, `bin/agent-memory.mjs:68-69` bounded waits) — session-reversible | **PASS** |

No dev restart, no upstream signal, no foreign-PID signal, no volume mutation occurred or is reachable.

## Findings

| ID | Severity | Finding | Evidence | Owner | Remediation |
|---|---|---|---|---|---|
| — | — | **No Medium/High/Critical.** All rollback points are single-command and verified against `bin/agent-memory.mjs` line citations above; blast radius matches the approved proposal byte-for-byte; MinIO retention and abort-only migration are proven by header + `MIGRATE ABORT` hint + static forbidden-primitive grep. | §§1–6 | — | — |
| RES-OBS-01 | Low (observation) | `[local.slot2]` remains in `helix.toml` after lane close until `git checkout -- helix.toml` is run — inert without the CLI (no auto-start, no port bind unless `helix start slot2` is invoked). Accepted residual, same as automation `R8-OBS-02` and QA O-01 companion. | `helix.toml:12-16` additive block; `IMPLEMENTATION_PLAN.md:75` `git checkout -- helix.toml` | R1 `general(vasquez)` | `git checkout -- helix.toml` + `helix stop slot2` if desired; re-verify on next slot lane |
| RES-OBS-02 | Low (accepted residual) | `docker volume ls` is not reachable from the CLI — MinIO retention is proven by absence of any destructive primitive in `bin/agent-memory.mjs` (static 0 hits) and by the abort `HINT: MinIO volume retained`, not by a runtime volume-mutation test. | `bin/agent-memory.mjs:640-656` `runHelix` pipe + `bin/agent-memory.mjs:1308-1322` abort block | R1 | No in-lane fix; next migration-enabled lane must add `docker inspect` volume proof when A3 flips to PASS |

No findings block the gate. Security C10 TOCTOU and PATH residual are owned by `security-reviewer.md` #1–2; automation runbook contract is owned by `automation-reviewer.md`.

## Residual Risk (accepted, owner + expiry)

| # | Risk | Owner | Expiry / re-review |
|---|---|---|---|
| 1 | **PID-reuse TOCTOU between `verifyOwnedPid` and signal** — narrowed to ms by cmdline re-verification + C10 re-verify before SIGKILL (`bin/agent-memory.mjs:1049,1060-1063`), window not eliminable without `pidfd` pinning. Blast radius local single-user. | R1 `general(vasquez)` | Re-review if PID namespace changes (see `security-reviewer.md` #1) |
| 2 | **A3 FAIL — HELIX_DATA_DIR forwarding unsupported, migration abort-only** — if A3 flips to PASS, migration write path (backup 0600/0700, copy, verify) needs new probe + backup-mode J/K evidence before claiming KR3. Framing 3b pending orchestrator. | R1+R8 escalated to orchestrator | 2026-12-31 or framing-3b decision — whichever first (see `security-reviewer.md` #4) |
| 3 | **Additive `[local.slot2]` remains** — `helix add local` registration persists until explicit `git checkout -- helix.toml`. Inert without CLI. | R8 `general(espinoza)` | Re-verify on next P4 lane that touches slots |

## Verdict Rationale

- **Rollback is code-complete and immediate:** delete two files + two `package.json` rows reverts the entire surface (`bin/agent-memory.mjs:1-24` zero-coupling header; `package.json:14-15,33` additive only; `package-lock.json` unchanged); `npm run typecheck` + five suites are the post-revert proof (NFR-E). Live slot2 undo is one `stop --slot 2` (tracked-PID SIGTERM→SIGKILL with dual `verifyOwnedPid` at `bin/agent-memory.mjs:1049,1060` + named `helix stop slot2`). `helix.toml` revert is one `git checkout` removing the single additive block `helix.toml:12-16` (`[local.dev]` frozen `helix.toml:6-10`).
- **No data-loss path is reachable:** `HELIX_DATA_DIR` is never set (`bin/agent-memory.mjs:892` A3 header + `serverEnv` comment), any `--migrate` hits the `MIGRATE ABORT: unsupported-runtime` first-branch (`bin/agent-memory.mjs:1308-1322`) with `MinIO volume retained` hint and no write before abort, and forbidden destructives (`helix prune`/`delete`/`docker volume rm`/`docker rm|kill`/`--persist`) are statically absent.
- **Incident handling is exclusive and non-destructive:** live window touches only `3114/3115/3116/6970` `slot2` (`IMPLEMENTATION_PLAN.md:54`; `derive(2)` math `bin/agent-memory.mjs:102-113`), `dev` `3111/6969` is probed read-only (`httpStatus` at `bin/agent-memory.mjs:1189-1193,1140-1144`) and never restarted — no signal to upstream, no dev Helix restart, no volume mutation.
- **Blast radius is exactly the approved proposal** (`PROPOSED_CHANGES.md:88-94`): engineering + automation + security local-machine only, no customer/regulator/revenue surface, zero new deps, `src/db/hooks/plugins` frozen.

## Sign-off

- [x] **resilience reviewer (R1 — blast radius / rollback / incident handling):** **PASS**. Rollback is delete `bin` + revert `package.json` + stop slot2 (immediate, `IMPLEMENTATION_PLAN.md:71-80`), `helix.toml` revert is `git checkout -- helix.toml` (additive `[local.slot2]` only, `[local.dev]` frozen), no data loss (MinIO retained, `--migrate` abort-only while A3 FAIL, no destructive primitive reachable), incident window exclusive (`3114/6970` slot2 vs `dev` `3111/6969` read-only, no Helix dev restart). Residual risks explicit with owner+expiry. This review touched only this file — no implementation file modified.
