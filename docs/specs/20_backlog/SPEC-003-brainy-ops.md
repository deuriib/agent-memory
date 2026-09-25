# Spec: Brainy Ops — Automation/Ops Control Plane (bin/brainy slots, state, doctor, migration, never-kill)

**ID:** SPEC-003-brainy-ops
**Owner:** general(espinoza) — Automation/Ops Owner (R8)
**Domains-Touched:** automation/ops (R8, owner) · engineering (R1, interface — REST/Helix/migrate) · marketing/brand (R5, interface — rename alias 1 versión) · security (R2, interface — secrets/PII/scan) · legal/privacy (R4, interface — TTL/breach)
**Brief Reference:** docs/briefs/BRIEF-brainy.md (architectural-initiative, approved 2026-09-25) + BRIEF-brainy.md#OKRs Scope In-Scope bullet "Ops: `bin/brainy` slots `BRAINY_PORT`/`HELIX_URL`/`BRAINY_URL`, `helix.toml` storagedisk intacto, never-kill upstream 3111/3112/3113 preservado"
**OKR Reference:** docs/briefs/OKR-brainy.md O1 KR1.1 (rename atómico `bin/brainy.mjs` + env alias 1 versión) + O3 (MCP/compat integration via stable ops surface) + O3 Gate links `SPEC-brainy-ops (R8)` + NFR p95/AVAIL
**PRD Reference:** ../brainy/docs/PRD.md §4.2 Out-of-Scope (docker-compose/k8s deferred) + §11 Roadmap F4 (MCP+compat) F1 (Fundación ops slots)
**Contract Reference:** docs/specs/10_design/ARCHITECTURE.md §1 CLI surface, §2 Slot derivation, §3 Derived env, §4 State file, §5 Doctor verdicts — singleton canonical v3 (reference only)
**Architecture Reference:** docs/specs/10_design/ARCHITECTURE.md v3 (2026-09-25, `general(vasquez)` R1 owner) — R8 §1-§5 already populated (see §4 verification below)
**Status:** draft
**Priority:** P0
**Execution_Mode:** subagents (frozen at frame-intent per BRIEF-brainy; max 2 parallel lanes INV-006 — this lane is R8)
**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-brainy.md#OKRs / HARD:subagents+max2lanes+no-secrets+alias1version+never-kill-3111 / GATE:none-yet / DOMAINS:R1,R5,R8,R2,R4`
**Skill:** `frame-ship:translate-to-spec` (`skills/translate-to-spec/SKILL.md` Process 0-7, `references/spec-template.md` — subagents only, reference-only packet, full-wave)

## 1. Context

`agent-memory` P4 ops control plane (`bin/agent-memory.mjs` 1378 LOC, `src/server.ts:653-661` never-kill hint, `helix.toml [local.dev] 6969 storage=disk`) provides `start|stop|status|doctor` with slot-derived quartet ports, state file, doctor verdicts 0-5, and blocked migration (probe A3: Helix CLI 3.3.0 does not forward `HELIX_DATA_DIR` — `MIGRATE ABORT: unsupported-runtime`). Brainy rebrands the surface to `bin/brainy.mjs` (canonical) with `BRAINY_*` env primaries and `AGENT_MEMORY_*` alias fallback + single-line `WARN deprecated use BRAINY_*` (ARCH §3, REQ-BRAINY-ENG-01 alias 1 versión), preserves the quartet derivation `R(N)=3111+3(N-1) / H(N)=6969+(N-1)` + reserved `R+1/R+2` never-bound, keeps the state-file invariant (0700 dir / 0600 file outside `HELIX_DATA_DIR`), keeps never-kill 3111/3112/3113 (upstream agentmemory/`iii` must never be signaled — `src/server.ts:653-661` + `bin/agent-memory.mjs:8-15,152-158`), and keeps CI/CD gates (typecheck/bootstrap/verify-ops/gitleaks). Data-dir/migration portion is gated by runtime support; until Helix forwards `HELIX_DATA_DIR`, `--migrate` aborts fail-closed and `HELIX_DATA_DIR` is never set for children (file header `bin/agent-memory.mjs:25-37`). This SPEC owns R8; R1 owns schema/queries/SDK/MCP, R5 owns brand copy, R2/R4 own STRIDE/TTL.

Reference-only evidence (never paste full context): `bin/agent-memory.mjs:64-77 derive/NEVER_BIND`, `bin/agent-memory.mjs:270-307 stateDirOf/statePathOf/ensureDir0700`, `bin/agent-memory.mjs:714-991 cmdStart pre-flight+never-kill hint`, `bin/agent-memory.mjs:1174-1345 doctor C1-C5 + precedence 5>4>3>1>0 + VERDICT`, `src/server.ts:653-661 portInUseHint`, `helix.toml [local.dev]`, `docs/specs/10_design/ARCHITECTURE.md:40-104` §1-§5.

## 2. Requirements

### Functional — Bin, Slots, Env (O1 KR1.1, ARCH §1-§3)

- **REQ-BRAINY-OPS-01 — Bin rename + slot derivation + quartet + reserved never-bind (O1 KR1.1, ARCH §1-§2):** Create `bin/brainy.mjs` as canonical entry point (Node≥20 ESM, `node:` builtins only — zero new dependencies, INV-001 preserved) and provide compat `bin/agent-memory.mjs` symlink or dual-bin wrapper that emits single-line deprecation warning on stderr (`WARN deprecated use brainy — agent-memory alias will be removed in next major`) and delegates to `bin/brainy.mjs` (alias 1 versión, HARD alias1version). `package.json:14-16 bin` maps `brainy → ./bin/brainy.mjs` with compat entry `agent-memory → ./bin/brainy.mjs` or shim. Slot derivation is pure, no I/O: `R(N)=3111+3(N-1)` REST, `H(N)=6969+(N-1)` Helix, `R+1/R+2` reserved address space only — never bound, never signaled (ARCH §2). `instanceName = N==1 ? "dev" : "slotN"` (brainy) with `[local.dev]` for slot 1 and `[local.slotN]` for N≥2 (helix.toml additive, never edits `src/**`). Invariants: `N≥1` integer else exit 2 (usage); `N≥2` quartet ∩ `{3111,3112,3113,6969}=∅` enforced; `NEVER_BIND=[3111,3112,3113,3151,6969]` defense-in-depth refuse if derived port hits it (INV-010); fail-closed arg parse `subcommand+flags` (unknown subcommand/flag/value → usage stderr exit 2). Evidence: `bin/brainy.mjs` derive + `package.json:bin` diff + `helix.toml` slot2 stanza + `grep -R agent-memory bin/` alias shim.

- **REQ-BRAINY-OPS-02 — Derived env BRAINY_* canonical + AGENT_MEMORY_* alias fallback 1 versión + HELIX_URL quartet (O1 KR1.1, ARCH §3):** Derive env projection only (no `src/**` edit): `BRAINY_PORT=R(N)` (fallback `AGENT_MEMORY_PORT`), `BRAINY_URL=http://127.0.0.1:R(N)` (fallback `AGENT_MEMORY_URL`), `HELIX_URL=http://127.0.0.1:H(N)` (no rename), `BRAINY_DATA_DIR= --data-dir flag > BRAINY_DATA_DIR env > AGENT_MEMORY_DATA_DIR alias fallback > ~/.local/share/brainy/<slot>/` (default per assumption), `BRAINY_SECRET` passthrough never printed (fallback `AGENT_MEMORY_SECRET`), `BRAINY_TTL_DAYS` default 365 (alias `AGENT_MEMORY_TTL_DAYS`), `BRAINY_HOST` default `127.0.0.1` (alias `AGENT_MEMORY_HOST`), plus passthrough `BRAINY_EMBED_DIM=1536`/`BRAINY_LLM_PROVIDER`. Every `AGENT_MEMORY_*` read emits exactly one `WARN deprecated use BRAINY_*` on stderr (ARCH §3). Child spawn `helix` strips secret; child `npx tsx src/server.ts` receives derived `BRAINY_*` + `HELIX_URL` + `BRAINY_DATA_DIR` (and `AGENT_MEMORY_*` aliases for compat) but never `HELIX_DATA_DIR` until runtime supports it (probe A3 fail-closed). `BRAINY_SECRET`/`BRAINY_DATA_DIR` precedence documented in `--help`. Evidence: `bin/brainy.mjs:880-893 serverEnv` + `src/server.ts:616-622 parsePort/nonEmptyEnv` + `ARCHITECTURE.md:72-88` table + stderr warning grep.

### Functional — State File (ARCH §4, INV-007)

- **REQ-BRAINY-OPS-03 — State file sibling of data-dir, 0700/0600, outside HELIX_DATA_DIR, closed schema, never secret/PII (ARCH §4):** State path = `<parent-of-data-dir>/state/slot-<N>.json` (ARCH §4; `bin/agent-memory.mjs:295-301 statePathOf`). With default `BRAINY_DATA_DIR=~/.local/share/brainy/<slot>/` → state `~/.local/share/brainy/state/slot-<N>.json` (legacy `~/.local/share/agent-memory/state/slot-<N>.json` aliased via `AGENT_MEMORY_DATA_DIR` fallback during migration). `stateDirOf = dirname(dataDir)/state` (sibling, never inside `HELIX_DATA_DIR`; Helix owns data dir exclusive, INV-007). Directory created `mkdir -p mode 0700` + `chmod 0700`; file written `0600` + `chmod 0600` (`bin/agent-memory.mjs:303-365`). Closed schema `{ slot:number, pids:{rest:number|null, helix:number|null}, helixInstance:string, dataDir:string, startedAt:ISO, cliVersion:string }` exactly — extra keys → invalid (fail-closed refuse, no signal on stop). Never a secret, memory content, or PII (INV-004). `start` records after readiness; `stop` removes idempotently; `doctor`/`status` read-only. Evidence: `bin/agent-memory.mjs:322-365 writeState/readState/isValidState` + `stat -c %a` 700/600 + `cat state/slot-1.json` fixture.

### Functional — Lifecycle start/stop/status (ARCH §1, O3)

- **REQ-BRAINY-OPS-04 — Lifecycle start/stop/status with pre-flight, never-kill, readiness 30s, idempotence (O3, ARCH §1, INV-003/005):** `brainy start --slot N [--data-dir PATH]` pre-flights: refuse if explicit data-dir is system root/`$HOME` itself/outside `$HOME`+`/tmp` or exists non-empty non-dir (security C4, `bin/agent-memory.mjs:274-288`), refuse if state invalid (fail-closed, no signal), exit 0 `already running` if state `pids.rest` owned (`bin/agent-memory.mjs:770-785`), probe quartet `R,R+1,R+2,H` — any foreign occupant (port held by non-owned PID or unresolved owner) → `REFUSE` with `neverKillHint()` (`AGENT_MEMORY_PORT=3151` example, `src/server.ts:653-661`) exit 1, never signal upstream 3111/3112/3113. Then `helix start <instance>` (register `[local.slotN]` via `helix add local --name slotN --port H(N)` + patch `storage="disk"` if missing, `bin/agent-memory.mjs:825-865`), spawn `npx tsx src/server.ts` detached with derived env, readiness gate polls `HELIX_URL/healthz` + `BRAINY_URL/memory/livez` (and `/v1/livez` after Brainy alias — `bin/agent-memory.mjs:922-936` — updated to probe both) for 30s (`READINESS_MS`), rollback only tracked child on fail, record state. `brainy stop --slot N [--data-dir PATH]` config-derived instance binding (`instanceBinding` table-scoped parse of `helix.toml` `[local.*]` only, `bin/agent-memory.mjs:663-703`), mismatch → refuse no signal, `verifyOwnedPid` before SIGTERM and again immediately before SIGKILL (C10/S-010, `bin/agent-memory.mjs:452-469`), then `helix stop <instance>` (named only, never bare), remove state, append audit line. `brainy status --slot N` read-only `0 healthy /1 degraded /2 usage` (INV-009) — probes helix `healthz` + rest `livez`+`health` without Authorization (401=armed not degraded), prints `slot/instance/quartet/state/pids/helix:up|down/rest:up|down/data-dir/bearer:armed|unset` with collapsed `$HOME` paths, never secret (ARCH §1). Defaults untouched: REST 3111, Helix 6969 (INV-005/NFR-C). Evidence: `bin/brainy.mjs` cmdStart/cmdStop/cmdStatus + `src/server.ts:653-661` hint snapshot + `scripts/verify-ops.ts` harness.

### Functional — Doctor Verdicts (ARCH §5, RUNBOOK §4a)

- **REQ-BRAINY-OPS-05 — Doctor 5 checks + VERDICT precedence 5>4>3>1>0 + one VERDICT line + read-only (ARCH §5):** `brainy doctor --slot N [--data-dir PATH] [--migrate [--apply --yes] [--backup-dir PATH]]` runs checks **in order** `C1 helix-healthz → C3 ports → C2 rest-health → C4 secret-presence → C5 storage-data-dir` on every invocation, one line per check `PASS|FAIL|INFO <CId> — <detail oneLine 400>` (`bin/agent-memory.mjs:1174-1345`). C1: `GET HELIX_URL/healthz` 200 else `helixDown`. C3: quartet probes via `/proc/net/tcp` + fd scan (`bin/agent-memory.mjs:484-570`), classifies `free|owned|foreign` with `verifyOwnedPid` (reads `/proc/<pid>/cmdline` contains `src/server.ts` + `cwd===ROOT`), upstream `3111/3112/3113` report-only but `foreign` on any quartet port → `upstreamPort` fail; `reserved R+1/R+2` foreign always fail. C2: gated on C3 `restOwned` else `INFO not-running/skipped NO request sent no bearer transmitted` (security C1/S-001, `bin/agent-memory.mjs:1259-1285`); when owned, `GET /memory/livez` (and `/v1/livez` after Brainy) + `GET /memory/health` with `Authorization: Bearer <secret>` only after ownership proven — `livez≠200 || health==500 → helixDown`, `health==401 → secretMissing`, else PASS. C4: `nonEmpty(BRAINY_SECRET ?? AGENT_MEMORY_SECRET)` flag only `present|missing` → `secretMissing` if missing, never value. C5: table-scoped `helix.toml` `[local.dev|slotN]` storage + data-dir `present|missing|invalid|not-writable` → `checkFailed` if `storage===undefined || dirFlag invalid/not-writable`. Exactly one `VERDICT: <healthy|doctor-check-failed|upstream-holds-port|helix-down|secret-missing>` line. Exits `0 healthy /1 doctor-check-failed /2 usage /3 upstream-holds-port /4 helix-down /5 secret-missing` with fixed precedence `5>4>3>1>0` (`bin/agent-memory.mjs:1327-1344`). Read-only: never mutates state, never signals, never sends bearer to foreign listener. Evidence: `bin/brainy.mjs cmdDoctor` + `ARCHITECTURE.md:94-105` table + `scripts/verify-ops.ts` doctor matrix.

### Functional — Migration & CI/CD (ARCH §4, BRIEF Constraints)

- **REQ-BRAINY-OPS-06 — Migration backup 0600 fail-closed + data-dir precedence + CI/CD gates no-secrets never-kill (ARCH §4, O1 KR1.1):** Data-dir resolution precedence `--data-dir flag > BRAINY_DATA_DIR env > AGENT_MEMORY_DATA_DIR alias > ~/.local/share/brainy/<slot>/` (assumption, ARCH §3). `--data-dir` explicit non-existent parent → `mkdir -p 0700` on start; existing non-empty dir → refuse never adopt foreign dir (`bin/agent-memory.mjs:737-757`). `doctor --migrate` dry-run default — never write/copy; `--migrate --apply` requires `--yes` else usage exit 2 (`bin/agent-memory.mjs:251-253`). Apply path (runtime-gated): pre-flight system-root/`$HOME`/outside check on `--backup-dir` (allow `$HOME/**`|`/tmp/**`), abort `MIGRATE ABORT: unsupported-runtime` if Helix CLI lacks `HELIX_DATA_DIR` forward (probe A3: `bin/agent-memory.mjs:25-37` + `helixEnv` strips secret), else `backup → copy → verify` with backup dir `0700` and backup file `0600` (`bin/agent-memory.mjs:303-310` pattern reused), audit `0600` in `state/audit.log` (`bin/agent-memory.mjs:375-391`), MinIO/S3 volume never destroyed (`helix.toml storage=disk` intact, no `docker rm/volume rm/--persist` outside tracked PIDs). CI/CD gates on every PR: `npm run typecheck` green, `npm run bootstrap` 8+4+≥6 Brainy indexes async poll until `index_not_found` clears (30s), `npm run verify-ops` (derive, state 0700/0600, quartet, doctor 0-5, never-kill, migrate ABORT) green, `gitleaks`/`trufflehog` scan `0 findings` (HARD no-secrets) with `BRAINY_SECRET` placeholder `***` only, never value in code/logs/examples. Evidence: `bin/brainy.mjs --migrate` branch + `state/audit.log` + `helix.toml` + CI log.

### Non-Functional — Never-kill + No-secrets (HARD never-kill-3111, no-secrets, INV-003/004)

- **NFR-BRAINY-OPS-01 — Never-kill 3111/3112/3113 + never-bind + no secret printing (HARD never-kill-3111, no-secrets, INV-003/004):** No code path signals a PID holding 3111/3112/3113 or any quartet port not proven slot-owned via `verifyOwnedPid` (cmdline `src/server.ts` + `cwd===ROOT`) — `bin/agent-memory.mjs:8-15,452-469`. Reserved `R+1/R+2` never bound. No `fuser/helix prune/docker rm/volume rm/--persist` on 3111-3113. Secret hygiene: no subcommand prints `BRAINY_SECRET`/`AGENT_MEMORY_SECRET` value — presence flags `bearer: armed|unset` + `secret: present|missing` only (`bin/agent-memory.mjs:1155-1157,1289`). Output allowlist = ports, booleans, counts, HTTP codes, PIDs, `$HOME`-collapsed paths (`bin/agent-memory.mjs:125-131`), `oneLine` CWE-117 bounded 400. Governance audit line timestamp/slot/action/status/exit only, `0600`. Evidence: `src/server.ts:653-661` hint + `bin/brainy.mjs:452-469 verifyOwnedPid` + `grep -R BRAINY_SECRET` placeholder only + `gitleaks` 0.

## 3. Acceptance Criteria

- [ ] **AC-01 (REQ-01 — bin rename + derive smoke):** `ls bin/brainy.mjs` exists + `bin/agent-memory.mjs` is symlink or shim that `stderr` contains `deprecated` and `brainy` on `--help`; `package.json bin {brainy, agent-memory}` diff shows `brainy` primary; `node bin/brainy.mjs --help` → usage exit 0 on `stdout`, `node bin/agent-memory.mjs --help` delegates (same usage) with deprecation on `stderr`; `node -e "import('./bin/brainy.mjs')"` not required — pure derive tested via `node bin/brainy.mjs status --slot 2` showing `quartet: rest=3114 helix=6970 reserved=3115,3116`; `derive(1)=3111/6969`, `derive(2)=3114/6970`, `derive(7000)` → usage out-of-range. Evidence: `git diff --stat` + terminal captures.

- [ ] **AC-02 (REQ-02 — env alias 1 versión):** `BRAINY_PORT=3111 AGENT_MEMORY_PORT=3151 node bin/brainy.mjs status --slot 1` uses `BRAINY_PORT` (R precedence) and `WARN deprecated` not emitted for unused alias; `AGENT_MEMORY_PORT=3151 node bin/brainy.mjs status --slot 1` without `BRAINY_*` uses alias and stderr contains single `WARN deprecated use BRAINY_*` per `AGENT_MEMORY_*` var read; `HELIX_URL=http://127.0.0.1:6969` passthrough; `grep -n "AGENT_MEMORY_" bin/brainy.mjs` only in alias fallback lines with adjacent warning emit. Evidence: stderr snapshots + `ARCHITECTURE.md:72-88`.

- [ ] **AC-03 (REQ-03 — state file):** After `brainy start --slot 1`, `stat -c %a ~/.local/share/brainy/state` → `700` and `stat -c %a ~/.local/share/brainy/state/slot-1.json` → `600`; `cat` shows closed schema `{slot:1,pids:{rest:<pid>,helix:null},helixInstance:"dev",dataDir,startedAt,cliVersion}` — no secret/PII/content; `dirname stateDir` is parent of `dirname dataDir` (sibling, not inside); `ls ~/.local/share/brainy/state/slot-1.json` path never under `helix` container bind. With `--data-dir /tmp/brainy-test-$$` → state ` /tmp/state/slot-1.json` sibling of data dir. `brainy start --slot 1` again → `already running` exit 0. Evidence: `stat` + `cat` + `ls -R`.

- [ ] **AC-04 (REQ-04 — start/stop/status):** `brainy start --slot 1` from clean state → `instance: dev`, `quartet: rest=3111 helix=6969 reserved=3112,3113`, `helix: started dev on 6969`, `server: started pid=…`, `ready: helix=200 rest=200`, `state: ~/.local/share/brainy/state/slot-1.json`, exit 0; with foreign holder `nc -l 3111 &` then `brainy start --slot 1` → `REFUSE start — rest port 3111 held by pid=… (not slot-owned, never signaled)` + `neverKillHint` (3151 example) exit 1 and `ps <foreign-pid>` still alive (never killed); `brainy stop --slot 1` → `stopping: rest pid=… (SIGTERM)` + `helix: stop dev (exit 0)` + `state removed` exit 0 and second `stop` → `not running` exit 0 (idempotent); `brainy status --slot 1` when up → `helix: up` + `rest: up` + `bearer: armed|unset` (flag only) exit 0, when down → `helix: down`/`rest: down` exit 1, `--slot bad` → usage exit 2; `EADDRINUSE` from `src/server.ts:653-661` path prints two-line hint with `AGENT_MEMORY_PORT=3151` wording (updated to `BRAINY_PORT` example in Brainy lane). Evidence: `scripts/verify-ops.ts` + manual `nc` foreign-host harness log.

- [ ] **AC-05 (REQ-05 — doctor 0-5 precedence):** Matrix with controlled fixtures: unset `BRAINY_SECRET` → `FAIL C4 secret-presence` → `VERDICT: secret-missing` exit 5 wins over any other FAIL; kill Helix (`helix stop dev`) with secret set → `FAIL C1 helix-healthz` → `VERDICT: helix-down` exit 4 (wins over C3); hold `3112` foreign → `FAIL C3 ports` → `VERDICT: upstream-holds-port` exit 3 when 4/5 pass; `storage` missing in `helix.toml` stub (remove line under `[local.dev]`) → `FAIL C5 storage-data-dir` → `VERDICT: doctor-check-failed` exit 1 when higher checks pass; all PASS (C2 may be `INFO not-running` when rest free) → `VERDICT: healthy` exit 0; every invocation prints exactly one `VERDICT:` line and 5 `C[1-5]` lines in order C1→C3→C2→C4→C5; C2 when `restOwned==false` emits `INFO` and sends no Authorization header (capture `tcpdump` or proxy log shows 0 bearer bytes). Evidence: `ARCHITECTURE.md:94-105` + `scripts/verify-ops.ts` doctor matrix log.

- [ ] **AC-06 (REQ-06 — migration + CI/CD):** `brainy doctor --slot 1 --migrate` (no apply) → `MIGRATE ABORT: unsupported-runtime — probe A3 failed: helix CLI 3.3.0 does not forward HELIX_DATA_DIR (framing 3b decision pending orchestrator)` on `stderr` + `HINT: no source was read, no backup was written, no target was touched; MinIO volume retained` + exit 1 (mapped to `doctor-check-failed` precedence after 5/4/3) and no file under `--backup-dir` was touched; `brainy doctor --slot 1 --migrate --apply --yes --backup-dir /tmp/brainy-backup` same ABORT with `path-refused` if under system root; `npm run typecheck` green; `npm run bootstrap` creates ≥18 indexes (8 legacy+4 Todo+≥6 Brainy) and `helix query dev -e 'readBatch().varAs("users",g().nWithLabel("Todo"))'` no `index_not_found` after 30s poll; `gitleaks detect --no-git -v` 0 findings and `grep -R "BRAINY_SECRET"` shows only `??` fallback + `***` placeholder. Evidence: `bin/brainy.mjs:1309-1325` + CI log + `stat` 600/700 on future backup fixture.

- [ ] **AC-NFR01 (NFR-01 — never-kill + no secrets scan):** `grep -n "verifyOwnedPid\|signalOwned\|NEVER_BIND\|neverKillHint" bin/brainy.mjs` present and code path audit shows no `kill(pid, ...)` outside `signalOwned` guarded by `verifyOwnedPid`; `grep -R "BRAINY_SECRET" --exclude-dir=.helix --exclude-dir=node_modules` shows only fallback read + `bearer: armed|unset` flag + docs `***`; `grep -R "3111.*kill\|kill.*3111"` → 0; manual foreign-holder test above proves no signal. Evidence: `bin/agent-memory.mjs:452-469,714-991` + `src/server.ts:653-661`.

## 4. Contracts & Interfaces

### 4.1 CLI surface — Brainy ops (ARCH §1)

| Subcommand | Flags / Args | Side effects | Exit | Notes (BRAINY_* primary) |
|---|---|---|---|---|
| `brainy start` | `--slot N [--data-dir PATH]` | spawn Helix+server, readiness gate 30s, record state | 0 ok · 1 refused/failed · 2 usage | never-kill preflight, never `--persist`, derived env `BRAINY_PORT`/`BRAINY_URL`/`HELIX_URL`/`BRAINY_DATA_DIR` |
| `brainy stop` | `--slot N [--data-dir PATH]` | SIGTERM→SIGKILL tracked PIDs + `helix stop <instance>`, remove state | 0/1/2 | idempotent, audit `0600`, re-verify before SIGKILL |
| `brainy status` | `--slot N` | none (probes) | 0 healthy · 1 degraded · 2 usage | read-only, no bearer header (401=armed), INV-009 |
| `brainy doctor` | `--slot N [--data-dir PATH] [--migrate [--apply --yes] [--backup-dir PATH]]` | checks; migrate abort fail-closed | 0-5 (see §4.3) | §5 verdicts, exactly one `VERDICT:` |
| `agent-memory ...` | same (symlink/shim) | proxy to `brainy` + `WARN deprecated` stderr | 0/1/2/0-5 | alias 1 versión, HARD alias1version |
| `--help` | — | none | 0 | usage on stdout, collapsed `$HOME` |

Shared: `--apply` without `--migrate` or `--migrate --apply` without `--yes` or `--backup-dir` without `--migrate` → usage exit 2 (`bin/agent-memory.mjs:251-253`).

### 4.2 Slot → port derivation (ARCH §2, REQ-P4-OPS-06)

| Slot | REST `R(N)=3111+3(N-1)` | Helix `H(N)=6969+(N-1)` | R+1 | R+2 | Instance |
|---|---|---|---|---|---|
| 1 | `3111` | `6969` | `3112` | `3113` | `dev` (brainy) |
| 2 | `3114` | `6970` | `3115` | `3116` | `slot2` |
| N | `3111+3(N-1)` | `6969+(N-1)` | R+1 | R+2 | `slotN` |

Inv: `N≥1` int else 2; `N≥2` quartet ∩ `{3111,3112,3113,6969}=∅`; `port>65535` → usage; reserves never bound/signaled.

### 4.3 Derived env — Brainy (ARCH §3 RECONCILED, REQ-02)

| Variable | Slot N | Default slot 1 | Legacy alias (1 versión) + warning |
|---|---|---|---|
| `BRAINY_PORT` | `R(N)` | `3111` | `AGENT_MEMORY_PORT` fallback + `WARN deprecated use BRAINY_PORT` |
| `BRAINY_URL` | `http://127.0.0.1:R(N)` | `http://127.0.0.1:3111` | `AGENT_MEMORY_URL` fallback + warning |
| `HELIX_URL` | `http://127.0.0.1:H(N)` | `http://localhost:6969` | — (no rename) |
| `HELIX_DATA_DIR` | resolved `--data-dir` (future) | unset until runtime supports | — (never set until probe A3 passes) |
| `BRAINY_DATA_DIR` | `--data-dir` flag > env `BRAINY_DATA_DIR` > `AGENT_MEMORY_DATA_DIR` fallback > `~/.local/share/brainy/<slot>/` | `~/.local/share/brainy/1/` | `AGENT_MEMORY_DATA_DIR` fallback + warning |
| `BRAINY_SECRET` | inherited passthrough never printed | unset=open (dev only) | `AGENT_MEMORY_SECRET` fallback + warning |
| `BRAINY_TTL_DAYS` | TTL Note/Archive default 365 | `365` | `AGENT_MEMORY_TTL_DAYS` fallback |
| `BRAINY_EMBED_DIM` | `1536` default / `384` fallback 1 versión | `1536` | — |
| `BRAINY_LLM_PROVIDER` | `openai|gemini|anthropic` | `openai` | — |
| `BRAINY_HOST` | `127.0.0.1` | `127.0.0.1` | `AGENT_MEMORY_HOST` fallback |

Every `AGENT_MEMORY_*` read emits single-line `WARN deprecated use BRAINY_*` on stderr (REQ-01).

### 4.4 State file (ARCH §4, REQ-03)

Path `<parent-of-data-dir>/state/slot-<N>.json` (default `~/.local/share/brainy/state/slot-<N>.json`; legacy alias `~/.local/share/agent-memory/state/slot-<N>.json` consumed only via `AGENT_MEMORY_DATA_DIR` fallback). Sibling of `dataDir`, never inside `HELIX_DATA_DIR`. Fields `slot, pids{rest:number|null, helix:null}, helixInstance, dataDir, startedAt, cliVersion`. Dir `0700`, file `0600`, audit `state/audit.log` `0600`. Never secret/content/PII. Invalid → `REFUSE` no signal.

### 4.5 Doctor verdict / exit (ARCH §5 canonical, REQ-05)

| Exit | Verdict | Trigger | Prec |
|------|---------|---------|------|
| 0 | `healthy` | all PASS (C2 may be INFO not-running) | 5th |
| 1 | `doctor-check-failed` | C5 FAIL or `--migrate` ABORT without higher fail | 4th |
| 2 | usage | bad/unknown flags (`--apply` without `--migrate`, etc.) | — |
| 3 | `upstream-holds-port` | C3 foreign PID on quartet (rest/reserved/helix) + NEVER kill hint `BRAINY_PORT=3151` | 3rd |
| 4 | `helix-down` | C1 healthz refused/non-200; C2 `livez≠200` or `health==500` | 2nd |
| 5 | `secret-missing` | C4 empty `BRAINY_SECRET`/`AGENT_MEMORY_SECRET`; C2 `health==401` | 1st wins |

Checks `C1 helix-healthz, C2 rest-health (only if listener verified slot-owned), C3 ports, C4 secret-presence flag only, C5 storage-data-dir`. Precedence `5>4>3>1>0`, exactly one `VERDICT:` line, `C1→C3→C2→C4→C5` emission order.

### 4.6 Migration & audit (ARCH §4, REQ-06)

Dry-run default (`--migrate` without `--apply --yes` → ABORT with hint, no write). Apply requires `--migrate --apply --yes` (+ optional `--backup-dir` under `$HOME/**` or `/tmp/**`, else `path-refused`). Until Helix forwards `HELIX_DATA_DIR`, every `--migrate` path fails `MIGRATE ABORT: unsupported-runtime` fail-closed, never a write, never a partial copy, audit `migrate-apply abort` line `0600` if `--apply`. Future apply (when runtime supports): `pre-flight → backup 0600 in 0700 dir → copy → verify` with MinIO volume never destroyed. `--data-dir` refusal set: system roots/`$HOME` itself/outside `$HOME`+`/tmp` → `REFUSE` no signal.

## 5. Out of Scope

- docker-compose / k8s manifests, Helm, multi-host orchestration (BRIEF-brainy Out-of-Scope P4.2, PRD §4.2 — this SPEC is single-host slot derivation only)
- npm publish / registry packaging / versioning beyond `package.json:bin` mapping (BRIEF-brainy Out-of-Scope P4.5, owner finance/people)
- HelixQL schema `N::Note/Project/Area/Resource/Archive` + edges + 1536-dim embeddings + hybrid RRF + `brainy add|move|distill|context|export` (R1 — SPEC-001 owns; R8 only preserves slots/never-kill)
- Brand copy/positioning/README rewrite beyond slot/env table hygiene (R5 — SPEC-002 owns)
- Secrets rotation schedule beyond `bearer: armed|unset` flag + placeholder `***` contract (R2 — SPEC-004 owns STRIDE + PII; R8 enforces no printing)
- Multi-writer P4.3, viewer UI / session replay, 54-tool MCP full (BRIEF Out-of-Scope)
- Re-writing git history for rename; migration is forward-only with MinIO volume never destroyed (INV-008)

## 6. Dependencies

- **Upstream:** `docs/briefs/BRIEF-brainy.md` + `docs/briefs/OKR-brainy.md` (O1 KR1.1 + O3), `helix.toml [local.dev] storage=disk + [local.slotN]` additive, `@helix-db/helix-db@3.0.4` SDK, `Node≥20`, Helix CLI `ghcr.io/helixdb/helixdb:v0.0.6` (probe A3), `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` (R1 — REST `/v1/*` route table dispatch, `ARCHITECTURE.md` §6-§10 frozen), `docs/CONTRACT.md` §0 facts (forEachParam empty safe, createIndexIfNotExists async, scoped search, `setProperty` refresh)
- **Parallel lanes:** `SPEC-001-brainy-engineering` (R1) — schema/search/MCP owns `src/server.ts:26-31` prefix + `embed` dim; `SPEC-002-brainy-brand` (R5) — README/CONTRACT/CHANGELOG copy + `package.json:bin` alias co-sign; `SPEC-004-brainy-security` (R2) — STRIDE + bearer + PII scan gate; `SPEC-brainy-legal` (R4) — DPIA/TTL `BRAINY_TTL_DAYS` cross-check. Max 2 parallel lanes INV-006.
- **External / Tooling:** `helix` CLI (`helix start/stop/status`, `helix query`), `npx tsx src/server.ts`, `net tcp /proc/net` probes, `gitleaks`/`trufflehog` pre-push, `scripts/verify-ops.ts` (derive+state+doctor matrix + never-kill), `scripts/bootstrap.ts` (index async poll)
- **Downstream:** `frame-ship:propose-changes` → `PROPOSED_CHANGES.md` (diff `bin/brainy.mjs` + `package.json:bin` + `helix.toml` additive + CI scan) → `review-security` (R2 `barrera` never-kill + secrets) / `review-architecture` (R1 `vasquez` ARCH singleton) → `execute-spec` (max 2 lanes) → `quality-gate` (this SPEC's AC as gate evidence) → `verify-handoff`/`ship-release`
- **Sign-offs:** Automation/Ops Owner `espinoza` (R8) — slot/state/doctor/migration; Engineering Owner `vasquez` — frozen-file exception `helix.toml`/`package.json:bin`; Security Owner `barrera` — never-kill + no-secrets

## 7. Traceability

| Requirement | AC | OKR | ARCH | Proposed Change | Evidence |
|---|---|---|---|---|---|
| REQ-BRAINY-OPS-01 | AC-01 | O1 KR1.1 | §1 CLI Legacy+slots, §2 Derive | `bin/brainy.mjs` + `package.json:bin` dual + helix.toml slotN | `bin/brainy.mjs` derive code + `package.json:bin` diff + `ls -l bin/` |
| REQ-BRAINY-OPS-02 | AC-02 | O1 KR1.1 | §3 Derived env | `bin/brainy.mjs serverEnv` + `src/server.ts parsePort` alias | stderr WARN grep + `BRAINY_*` table + `HELIX_URL` quartet probe |
| REQ-BRAINY-OPS-03 | AC-03 | O1 KR1.1 | §4 State file | `bin/brainy.mjs writeState/readState` + `stateDirOf` | `stat 0700/0600` + `cat state/slot-N.json` schema |
| REQ-BRAINY-OPS-04 | AC-04 | O3 KR3.1-3.2 | §1 start/stop/status | `cmdStart/cmdStop/cmdStatus` + never-kill hint | `scripts/verify-ops.ts` + `nc` foreign-host + hint `3151` snapshot |
| REQ-BRAINY-OPS-05 | AC-05 | O3 | §5 Doctor verdict | `cmdDoctor C1-C5 + VERDICT 5>4>3>1>0` | `ARCHITECTURE.md:94-105` + doctor matrix log (0-5) |
| REQ-BRAINY-OPS-06 | AC-06 | O1 KR1.1 | §4 Data-dir + migration | `doctor --migrate ABORT fail-closed` + backup 0600 + CI | CI log `typecheck/bootstrap/verify-ops/gitleaks 0` + `helix.toml` + audit.log |
| NFR-BRAINY-OPS-01 | AC-NFR01 | O1+O3 | INV-003/004/010 NFR Security/Storage | `verifyOwnedPid/signalOwned/NEVER_BIND` + `logSafeNote` + allowlist | `bin/brainy.mjs:452-469` + `src/server.ts:653-661` + `grep secret 0` + `gitleaks 0` |

**Handoff packet (next stage):** `SPEC:docs/specs/20_backlog/SPEC-003-brainy-ops.md#REQ-BRAINY-OPS-01..06+NFR-01 / HARD:subagents+max2lanes+no-secrets+alias1version+never-kill-3111 / GATE:none-yet / DOMAINS:R8,R1,R5,R2,R4` → `frame-ship:propose-changes` (PROPOSED_CHANGES.md, untouched repo) → `review-security`/`review-architecture` → `execute-spec` (max 2 lanes) → `quality-gate` (this SPEC's AC) → `verify-handoff`/`ship-release`.

---

## Assumptions

1. **Symlink vs dual bin:** preferred is real `bin/brainy.mjs` file + `bin/agent-memory.mjs` symlink → `brainy.mjs` (one source of truth, alias warning emitted on the shim path). Accepted alternative is Node `package.json:bin` dual entry both pointing at `bin/brainy.mjs` with the wrapper detecting `argv[0]`/`process.argv[1]` basename `agent-memory` to emit warning — both satisfy alias 1 versión; executable choice is `execute-spec` detail, not contract. No double maintenance.
2. **BRAINY_DATA_DIR default `~/.local/share/brainy`:** Brainy canonical data parent is `~/.local/share/brainy/<slot>/` (state sibling `~/.local/share/brainy/state/slot-<N>.json`). Rationale: preserve `$HOME` containment (security C4) and `stateDirOf = dirname(dataDir)/state` invariant while renaming namespace; legacy `AGENT_MEMORY_DATA_DIR → ~/.local/share/agent-memory/<slot>/` remains readable via alias fallback until next major. Confirmed by `ARCHITECTURE.md:89-92` (`BRAINY_DATA_DIR` row) + `bin/agent-memory.mjs:278-279` default pattern with name substitution.
3. **ARCH §1 readiness probe dual livez:** `start` readiness polls both `GET /memory/livez` (legacy) and `GET /v1/livez` (Brainy alias) — either 200 satisfies rest-up, matching `SPEC-004` REQ-SEC-01 livez exempt matrix and `ARCHITECTURE.md:192` helix readiness line `Readiness probes /v1/livez added beside /memory/livez`. No new route required for verification; probes are read-only.

## Risks

- **Medium — stuck migration until Helix forwards HELIX_DATA_DIR:** `HELIX_DATA_DIR` env is direct-Docker per `helix-cli` SKILL.md:29-32 and probe A3 (0 occurrences in installed binary, no `--data-dir` flag, `bin/agent-memory.mjs:25-37`). Until Orchestrator ratifies framing 3b (brief §7) and Helix adds forwarding, `--migrate --apply` stays ABORT. Mitigation: fail-closed ABORT with audit + MinIO volume retained; `BRAINY_DATA_DIR` still locates state sibling. Owner `espinoza`, escalate to `vasquez`/`Montilla` if operator demands data-dir move.
- **High — alias drift / double-bin divergence:** if shim and canonical diverge (fix in one not the other) the deprecation warning may mask a functional gap. Mitigation: shim is symlink or one-line delegator (`exec brainy "$@"`) — zero logic; `quality-gate` checks `diff bin/brainy.mjs bin/agent-memory.mjs` or `readlink` proves identity.
- **High — CI gate missing verify-ops:** without `verify-ops` harness the never-kill and doctor-precedence regressions are invisible until production. Mitigation: CI runs `npm run verify-ops` on every PR before `quality-gate`; gate CLOSED if harness absent, waiver requires `espinoza` + `barrera` + Orchestrator.

## Evidence (allowlisted only — no secrets, no raw PII)

- `bin/agent-memory.mjs:25-37` probe A3 header + `bin/agent-memory.mjs:64-113` derive/NEVER_BIND/SYSTEM_ROOTS + `bin/agent-memory.mjs:274-307` resolveDataDir/stateDirOf + `bin/agent-memory.mjs:452-469` verifyOwnedPid + `bin/agent-memory.mjs:714-991` cmdStart + `bin/agent-memory.mjs:1174-1345` cmdDoctor precedence — to be mirrored in `bin/brainy.mjs`
- `src/server.ts:653-661` `portInUseHint()` never-kill hint snapshot (two-line 3151 example) — reused by Brainy with `BRAINY_PORT` wording
- `helix.toml:2` project `agent-memory→brainy` + `[local.dev] storage=disk 6969` + future `[local.slot2] 6970 storage=disk`
- `package.json:14-16` `bin {brainy, agent-memory}` diff + `typecheck` green
- `docs/specs/10_design/ARCHITECTURE.md:40-104` §1 CLI surface + §2 Slot derivation + §3 Derived env + §4 State file + §5 Doctor verdicts (see §4 verification delta below)
- `scripts/verify-ops.ts` + `scripts/bootstrap.ts` + `scripts/verify-env.ts` harness logs (no secret values, `bearer: armed|unset` only)
- `gitleaks`/`grep -R BRAINY_SECRET` scan log `0 findings`

## Verification — ARCHITECTURE.md Singleton Delta (reference only, no duplicate)

`docs/specs/10_design/ARCHITECTURE.md` v3 (owned by `general(vasquez)` R1) already contains the full R8 contract required by this SPEC — verified by line citations:

- §1 CLI surface `40-58` rows `start/stop/status/doctor` + legacy alias row `agent-memory→brainy` + exit codes ✓ (matches REQ-04/05)
- §2 Slot derivation `63-70` table `3111+3(N-1)/6969+(N-1)` + `R+1/R+2` reserved + `NEVER_BIND` invariant ✓ (REQ-01)
- §3 Derived env `72-88` table `BRAINY_PORT/BRAINY_URL/HELIX_URL/BRAINY_DATA_DIR/BRAINY_SECRET` + `AGENT_MEMORY_*` fallback + `WARN deprecated` line ✓ (REQ-02, assumption 2)
- §4 State file `89-92` path `<parent-of-data-dir>/state/slot-<N>.json` + `0700/0600` + sibling-not-inside `HELIX_DATA_DIR` ✓ (REQ-03)
- §5 Doctor verdicts `94-105` table `0 healthy/1 doctor-check-failed/2 usage/3 upstream-holds-port/4 helix-down/5 secret-missing` + precedence `5>4>3>1>0` + one `VERDICT:` line ✓ (REQ-05)
- §6-§10 Preserved P4 foundation + Brainy §6 DB / §7 REST / §8 MCP rows are owned by R1; R8 does not duplicate them (INV-002 frozen surfaces).

**Delta proposed: none.** Singleton is complete; executing this SPEC must not create `ARCHITECTURE-*.md` or rewrite §1-§5 tables — it only implements `bin/brainy.mjs` to satisfy them and, if gaps are found during `propose-changes` verification, raises a formal Cross-Domain Request to `general(vasquez)` (R1) to patch the singleton in place — never a freelance fix.

## Cross-Domain Escalations

No freelance cross-domain fix. Any need touching R1 frozen surfaces (`src/**`, `db/**`, `helix.toml [local.dev]`), R5 brand copy beyond slot/env table, or R2/R4 secrets/PII beyond the allowlist is escalated as a formal **Cross-domain request** brief to Orchestrator (`Montilla`), who delegates or resolves — per `../AGENTS.md` Hard Rules §5.

## Skill path

`frame-ship:translate-to-spec` Process 0-7 (subagents only, reference-only packet, full-wave). Execution_Mode `subagents` frozen at frame-intent; trivial <15 lines → CEO fast-path checkpoint-only outside methodology (never a chain branch).

