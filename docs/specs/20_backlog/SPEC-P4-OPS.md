# Spec: P4 ops control plane — CLI binary, multi-instance port slots, explicit data dir

**ID:** SPEC-P4-OPS
**Owner:** general(vasquez) — Engineering Owner (R1)
**Domains-Touched:** engineering (R1, owner) | automation/ops (R8, cross-domain: runbook + CI evidence) | security (R2, cross-cut: `doctor`/`status`/`--migrate` output — secret non-printing, Ley 172-13 no-PII)
**Brief Reference:** BRIEF-p4-ops-control-plane
**Status:** draft
**Priority:** P2
**Execution_Mode:** subagents (inherited from brief, frozen at frame-intent)

**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-p4-ops-control-plane.md#OKRs / HARD:subagents+no-new-deps+typecheck-and-existing-suites-green+never-kill-upstream-3111-3112-3113+default-REST-port-3111-untouched+Ley-172-13-no-PII-no-secrets-in-outputs / GATE:none-yet / DOMAINS:R1 (cross-cut R8, R2)`

## 1. Context

The repo is operated through loose npm scripts only — there is no `start/stop/status/doctor`
surface (`package.json:17-31` has no `bin` entry). A second instance today would require source
edits: the REST default port is hard-coded in `src/server.ts:477-483` (`parsePort` defaults to
`3111`, fail-closed validation) and `helix.toml:6-10` defines exactly one instance (`[local.dev]`,
port `6969`, image tag `v0.0.6`, `storage = "disk"` = MinIO). Ports `3111/3112/3113` may already be
held by the real upstream `agentmemory`; the contract says never kill it (`docs/CONTRACT.md:560-564`,
`src/server.ts:502-522` never-kill reroute hint, `README.md:471-492`). Persistence lives in an
opaque MinIO volume: durable across restarts, but there is no elegant, backup-able directory.

`BRIEF-p4-ops-control-plane` §3 scopes three items under one gate: **P4.1** the CLI binary,
**P4.3** 4-port slot multi-instance derivation with zero source edits, **P4.4** an explicit data dir
(`AGENT_MEMORY_DATA_DIR` → `HELIX_DATA_DIR`) with fail-closed MinIO migration. Outcome (KR1–KR3):
`agent-memory start|stop|status|doctor` over the existing dev instance; a second instance round-trips
on its own quartet with no code diff; an explicit data dir survives restart with verifiable
dry-run + backup migration and documented recovery.

## 2. Requirements

Functional:

- **REQ-P4-OPS-01 (CLI surface → AC-01):** new `bin/agent-memory.mjs` (Node ≥20 ESM, **zero new
  dependencies** — `node:` builtins only), registered as `"bin": {"agent-memory": "./bin/agent-memory.mjs"}`
  in `package.json`. Subcommands: `start`, `stop`, `status`, `doctor`, plus `--help`. Fail-closed arg
  parsing in the style of `src/server.ts:479-481`: unknown subcommand/flag or invalid `--slot` →
  usage on stderr, exit 2. `package.json` may gain ONLY the `bin` entry and a `verify-ops` script
  entry; `dependencies`/`devDependencies` and `package-lock.json` stay untouched.
- **REQ-P4-OPS-02 (start → AC-02):** `start --slot N` spawns (a) the slot's Helix instance —
  slot 1 → `helix start dev`; slot N≥2 → one-time `helix add local --name slotN --port H(N)` then
  `helix start slotN` — and (b) `npx tsx src/server.ts` (spawn precedent `scripts/verify-env.ts:216-227`)
  with the derived env of §4.3, **never** `--persist` (it rewrites tracked `helix.toml`, see
  `helix start --help` / `CONTRIBUTING.md:22`). `start` exits 0 only after readiness: Helix
  `/healthz` + our `/memory/livez` (route `src/server.ts:244-250`) answer within a bounded timeout
  (30 s precedent, `scripts/verify-env.ts:55`). PIDs are recorded in the state file (§4.4).
  Pre-flight: any quartet port held by a process we do not own → refuse, report the occupant with
  the "NEVER kill" hint (`src/server.ts:514-522`), exit 1 — the occupant is never signaled.
- **REQ-P4-OPS-03 (stop → AC-03):** `stop --slot N` sends SIGTERM (server drains via
  `src/server.ts:544-549`), escalates to SIGKILL after a grace period, to **tracked PIDs only** from
  the state file, then runs `helix stop <instance>`; removes the state file. Idempotent: no state
  file → "not running", exit 0. Exit 1 only if one of our own processes refuses to die.
  Foreign holders of quartet ports are reported, never touched.
- **REQ-P4-OPS-04 (status → AC-04):** read-only per-slot report: derived quartet (§4.2), REST probe
  (`/memory/livez`, `/memory/health`), Helix `/healthz` TCP/HTTP probe, tracked PIDs, data-dir path
  + existence, `bearer: armed|unset` boolean. Exit 0 = healthy, 1 = degraded (REST or Helix down),
  2 = usage error.
- **REQ-P4-OPS-05 (doctor → AC-05):** superset diagnostics for slot N running the closed check
  list **C1–C5** on every invocation (`SPEC-P4-OPS-RUNBOOK` REQ-OPS-RUN-01 / §4a — canonical):
  **C1** `helix-healthz` — read-only HTTP probe of the slot's `HELIX_URL` health endpoint;
  **C2** `rest-health` — presence-conditional `GET /memory/livez` (bearer-exempt) plus
  `GET /memory/health` with `Bearer <AGENT_MEMORY_SECRET>` read from the operator's env (401 →
  `secret-missing`, 500 → `helix-down`, no listener + free port → `INFO not-running`, foreign
  holder → via C3); **C3** `ports` — occupancy of the slot's quartet **and** of upstream
  `3111/3112/3113`, foreign PID fails with the "NEVER kill" hint (`src/server.ts:514-522`);
  **C4** `secret-presence` — bearer secret **presence** flag only, never the value (style of
  `src/server.ts:538-541`); **C5** `storage-data-dir` — `helix.toml` `storage = "disk"` vs
  `HELIX_DATA_DIR` set (table-scoped parse). Output: one `PASS|FAIL|INFO <check-id> — <detail>`
  line per check, then exactly one terminal `VERDICT: <name>` line; all checks run and print
  before the verdict is chosen. Closed verdict/exit contract with fixed precedence
  `5 > 4 > 3 > 1 > 0`: `0 = healthy`, `1 = doctor-check-failed`, `2 = usage`,
  `3 = upstream-holds-port`, `4 = helix-down`, `5 = secret-missing`. The three KR1 verdicts map
  to the canonical tokens `healthy` (0), `upstream-holds-port` (3), `helix-down` (4);
  `secret-missing` (5) and `doctor-check-failed` (1) complete the full set.
- **REQ-P4-OPS-06 (slot derivation → AC-06):** quartet math of §4.2, derived **exclusively** through
  env/flags — `AGENT_MEMORY_PORT`, `helix start|add --port`, `HELIX_URL`, `AGENT_MEMORY_URL` —
  **zero edits to `src/**`, `db/**`** and no modification of `helix.toml`'s `[local.dev]` block.
  `--slot N` accepts integers ≥ 1 only; anything else exits 2. Slot N≥2 never intersects
  `{3111, 3112, 3113, 6969}`. The official `helix add local` appending `[local.slotN]` to
  `helix.toml` is config registration (sanctioned by brief §3.2), not a source edit.
- **REQ-P4-OPS-07 (data dir → AC-07):** data dir precedence `--data-dir PATH` > env
  `AGENT_MEMORY_DATA_DIR` > default `~/.local/share/agent-memory/<slot>/` (brief §3.3). Passed to
  Helix as `HELIX_DATA_DIR`; created if missing; `start` fails closed with an actionable permission
  error if the dir is unusable (container uid note, risk R3). CLI state lives in a sibling
  `state/` dir — **never inside `HELIX_DATA_DIR`** (Helix owns that directory exclusively).
- **REQ-P4-OPS-08 (migration → AC-08; precondition P, see §6):** `doctor --migrate` is **dry-run by
  default**: it prints a plan (source MinIO volume label, target dir, row/item counts, checksums)
  with zero writes. A real migration requires `doctor --migrate --apply --yes` and must, in order:
  (1) create a verified backup of the source (archive + checksum) under `--backup-dir`,
  (2) migrate, (3) verify counts, (4) on ANY error abort leaving the source intact (fail closed).
  The old MinIO volume is **never destroyed** by any subcommand — no `helix prune`, no
  `helix delete`, no `docker volume rm` (`dot_agents/skills/helix-cli/EXAMPLES.md:19` — prune
  deletes persisted data). Output carries counts + allowlisted paths only — never memory content.
- **REQ-P4-OPS-09 (docs closure → AC-09):** README gains an ops section (slot derivation table,
  data-dir default, backup + recovery procedure, never-kill rule); `TEST_MATRIX.md` gains KR1–KR3
  rows pointing at evidence.

Non-functional:

- **NFR-P4-OPS-A (never-kill-upstream → AC-A):** no code path in the CLI may signal a PID it did
  not spawn and record; forbidden: kill-by-port scan, `fuser`, `helix prune`, `helix delete`,
  `docker rm|kill|volume rm`, `--persist`. Occupied upstream `3111/3112/3113` (and any foreign
  quartet holder) is reported with "NEVER kill", never displaced.
- **NFR-P4-OPS-B (secret non-printing → AC-B):** no subcommand prints the `AGENT_MEMORY_SECRET`
  value (or any env value); output is `bearer: armed|unset` only; the state file never contains it.
- **NFR-P4-OPS-C (port-parity default → AC-C):** defaults are untouched: bare `npm run dev` still
  listens on `3111` (`src/server.ts:478`), `HELIX_URL` default stays `http://localhost:6969`
  (`src/store.ts:524`), hooks/plugin clients still default to `http://127.0.0.1:3111`
  (`README.md:449-452`). Slots are derivation, not a default change.
- **NFR-P4-OPS-D (durability across restart → AC-D):** data written under an explicit data dir
  survives `helix restart <instance>` AND a full CLI `stop`/`start` cycle of that slot.
- **NFR-P4-OPS-E (zero new deps + suites green → AC-E):** dependency manifests unchanged;
  `npm run typecheck` clean; `verify`, `verify-env`, `verify-lifecycle`, `verify-capture`,
  `verify-skills` all PASS; tests obey the port guard (`scripts/verify-env.ts:29-31,47-48`: never
  bind `3111/3112/3113/3151/6969`) — integration sections use slot ≥ 2 or read-only probes.
- **NFR-P4-OPS-F (Ley 172-13 output hygiene → AC-F):** `doctor`/`status`/`--migrate` output
  contains no memory content, no prompt text, no raw PII, no secrets — only ports, booleans,
  counts, and allowlisted paths (consistent with the hook privacy contract,
  `docs/CONTRACT.md:566-571`).

## 3. Acceptance Criteria

- [ ] **AC-P4-OPS-01:** `node bin/agent-memory.mjs --help` lists the 4 subcommands (exit 0); unknown
      subcommand/flag → exit 2 + usage on stderr; `npm run typecheck` clean; `git diff package.json`
      shows only the `bin` entry + `verify-ops` script; `package-lock.json` untouched.
      *Evidence: `scripts/verify-ops.ts` §A + session output.*
- [ ] **AC-P4-OPS-02:** `agent-memory start --slot 2` → REST `/memory/livez` 200 on `3114`, Helix
      `/healthz` 200 on `6970`, `remember` → `search` round-trip green, slot 1 (`3111`/`6969`)
      still serving, `git diff --stat src/ db/` empty; a foreign occupant of `3115` makes `start`
      refuse with the NEVER-kill hint and leaves that PID alive.
      *Evidence: `scripts/verify-ops.ts` §B + `TEST_MATRIX.md` KR2 row.*
- [ ] **AC-P4-OPS-03:** after `stop --slot 2` ports `3114/6970` are free, slot 1 untouched, foreign
      quartet PIDs unchanged (same PID before/after), repeat `stop` exits 0 (idempotent).
      *Evidence: `scripts/verify-ops.ts` §C.*
- [ ] **AC-P4-OPS-04:** `status` prints quartet + REST/Helix probe results + data-dir + `bearer:
      armed|unset`; exit 0 healthy, exit 1 with Helix stopped (distinct from the doctor verdict
      `upstream-holds-port`).
      *Evidence: `scripts/verify-ops.ts` §D + KR1 session output (all 4 commands).*
- [ ] **AC-P4-OPS-05:** `doctor` prints one `PASS|FAIL|INFO <check-id>` line per C1–C5 check and
      exactly one terminal `VERDICT: <name>` line, and yields the KR1 verdicts at their canonical
      exits — `healthy` (0, test slot up), `helix-down` (4, Helix stopped), `upstream-holds-port`
      (3) for a foreign occupant on `3111/3112/3113` or the quartet with "NEVER kill" (observed
      read-only when upstream runs; synthetic foreign occupant on a slot-reserved port otherwise)
      — with `secret-missing` (5) and `doctor-check-failed` (1) documented as the rest of the
      closed set, fixed precedence `5 > 4 > 3 > 1 > 0` proven on a multi-failure run, usage
      errors exit 2, and no secret value anywhere in output. *Evidence: `scripts/verify-ops.ts`
      §E + KR1 session output (verdict/precedence rows shared with `SPEC-P4-OPS-RUNBOOK`
      AC-OPS-RUN-01/02).*
- [ ] **AC-P4-OPS-06:** derivation unit table for slots 1–3 matches §4.2 exactly; `--slot 0` and
      `--slot abc` → exit 2; slot 2 runs with `git diff --stat src/ db/ helix.toml` showing no
      `[local.dev]` change. *Evidence: `scripts/verify-ops.ts` §F + `git diff --stat`.*
- [ ] **AC-P4-OPS-07:** memory saved under `--data-dir` (slot 2) is returned by `search` after
      `helix restart slot2`; the state file exists OUTSIDE the data dir, inside it only Helix data;
      state file contains no secret. *Evidence: `scripts/verify-ops.ts` §G + KR3 session output.*
- [ ] **AC-P4-OPS-08:** dry-run leaves source volume and target dir byte-identical (checksums
      before/after) and prints counts+paths only; `--apply --yes` writes and verifies the backup
      BEFORE moving, an induced failure aborts with the source intact, and `docker volume ls` is
      unchanged (MinIO volume never destroyed). *Evidence: migration session log +
      `scripts/verify-ops.ts` §H (dry-run/idempotence) + README recovery section.*
- [ ] **AC-P4-OPS-09:** README ops section contains the derivation table, data-dir default and
      backup/recovery steps; `TEST_MATRIX.md` has KR1–KR3 rows linking evidence.
      *Evidence: README + `TEST_MATRIX.md` diffs.*
- [ ] **AC-P4-OPS-A:** foreign listeners on a stand-in quartet survive
      `start|stop|status|doctor` with unchanged PIDs (no signal delivered), and a static check of
      `bin/agent-memory.mjs` finds no `prune`, no `docker … rm`, no port-based kill.
      *Evidence: `scripts/verify-ops.ts` §I.*
- [ ] **AC-P4-OPS-B:** with a synthetic `AGENT_MEMORY_SECRET`, its value appears 0 times in the
      stdout+stderr of all four subcommands AND in the state file; output shows `bearer: armed`.
      *Evidence: `scripts/verify-ops.ts` §J (pattern of `scripts/verify-env.ts:312-323`).*
- [ ] **AC-P4-OPS-C:** `git diff` shows `AGENT_MEMORY_PORT` default `3111`, `HELIX_URL` default
      `6969` and the README config-table rows unchanged; `npm run verify-env` PASS;
      slot-1 `status` reports `3111/6969`. *Evidence: `scripts/verify-ops.ts` §L + verify-env PASS log.*
- [ ] **AC-P4-OPS-D:** save → `helix restart <instance>` → `search` returns the row, and save →
      `agent-memory stop --slot N` → `start --slot N` → `search` returns the row.
      *Evidence: `scripts/verify-ops.ts` §G + KR3 session output.*
- [ ] **AC-P4-OPS-E:** `npm run typecheck` clean; `verify`, `verify-env`, `verify-lifecycle`,
      `verify-capture`, `verify-skills` all PASS; `git diff package.json package-lock.json` limited
      as in AC-01. *Evidence: suite logs + git diff.*
- [ ] **AC-P4-OPS-F:** a canary memory string written to the test slot appears 0 times in
      `doctor`, `status`, `--migrate` dry-run and `--apply` outputs; migration report = counts +
      allowlisted paths only. *Evidence: `scripts/verify-ops.ts` §K.*

## 4. Contracts & Interfaces

### 4.1 CLI command surface

| Subcommand | Flags | Env read | Side effects | Exit codes |
|---|---|---|---|---|
| `agent-memory start` | `--slot N` (default 1), `--data-dir PATH` | `AGENT_MEMORY_DATA_DIR`, `AGENT_MEMORY_HOST`, `AGENT_MEMORY_SECRET` (passthrough, never printed) | spawn `helix start` instance + `npx tsx src/server.ts` with §4.3 env; write state file; wait for readiness | 0 started · 1 refused/failed · 2 usage |
| `agent-memory stop` | `--slot N`, `--data-dir PATH` | `AGENT_MEMORY_DATA_DIR` | SIGTERM→SIGKILL tracked PIDs only; `helix stop <instance>`; remove state file | 0 stopped/idempotent · 1 own-process failed to die · 2 usage |
| `agent-memory status` | `--slot N` | `AGENT_MEMORY_DATA_DIR` | none (read-only probes) | 0 healthy · 1 degraded/down · 2 usage |
| `agent-memory doctor` | `--slot N`, `--data-dir PATH`, `--migrate`, `--apply`, `--yes`, `--backup-dir PATH` | `AGENT_MEMORY_DATA_DIR`, `AGENT_MEMORY_SECRET` (presence only) | checks only; `--migrate` = dry-run plan; `--migrate --apply --yes` = backup → migrate → verify | 0 healthy · 1 doctor-check-failed · 2 usage · 3 upstream-holds-port · 4 helix-down · 5 secret-missing (fixed precedence 5>4>3>1>0; one terminal `VERDICT: <name>` line) |

Shared: `--help` on any subcommand → usage, exit 0. `--apply` without `--migrate`, or `--migrate
--apply` without `--yes`, → exit 2 (fail-closed confirmation). Doctor's verdict/exit contract is
the closed set of `SPEC-P4-OPS-RUNBOOK` §4a (canonical — exits 0/1/2/3/4/5, precedence
`5>4>3>1>0`, C1–C5 checks); `status` is NOT `doctor` and keeps its own 0/1/2 contract.

### 4.2 Slot → port derivation table

| Slot | REST `R(N) = 3111 + 3(N−1)` | Helix `H(N) = 6969 + (N−1)` | Reserved 1 `R+1` | Reserved 2 `R+2` | Helix instance |
|---|---|---|---|---|---|
| 1 | `3111` (default parity, untouched) | `6969` | `3112` | `3113` | `dev` (existing) |
| 2 | `3114` | `6970` | `3115` | `3116` | `slot2` (`helix add local --name slot2 --port 6970`) |
| 3 | `3117` | `6971` | `3118` | `3119` | `slot3` |
| N | `3111 + 3(N−1)` | `6969 + (N−1)` | `R+1` | `R+2` | `slotN` (N≥2) |

Invariants (tested):

- `N` integer ≥ 1, else exit 2 (same fail-closed style as `src/server.ts:479-481`).
- Slot 1 reproduces the brief §3.2 enumeration exactly (`3111 REST + 6969 Helix + 2 reservados`);
  N ≥ 2 ⇒ quartet ∩ `{3111, 3112, 3113, 6969}` = ∅.
- The REST and Helix roles never derive `3151` (the documented reroute example,
  `src/server.ts:503`) — a deterministic check, defense in depth.
- Reserved ports reserve address space only (P3.3 viewer): never bound, never signaled; read-only
  occupancy probes allowed, reported as `reserved`.
- Derivation is applied only via env/flags (`AGENT_MEMORY_PORT`, `helix start|add --port`,
  `HELIX_URL`, `AGENT_MEMORY_URL`) — zero `src/**`/`db/**` edits.

### 4.3 Derived env contract (slot N)

| Variable | Value for slot N | Slot-1 default (unchanged) | Grounding |
|---|---|---|---|
| `AGENT_MEMORY_PORT` | `R(N)` | `3111` | `src/server.ts:478,525` |
| `AGENT_MEMORY_URL` | `http://127.0.0.1:R(N)` | `http://127.0.0.1:3111` | `README.md:449-452` (hooks/plugin/verify) |
| `HELIX_URL` | `http://127.0.0.1:H(N)` | `http://localhost:6969` | `src/store.ts:524` |
| `HELIX_DATA_DIR` | resolved data dir | *unset for dev until migration/fallback* | helix-cli skill `SKILL.md:29-32` |
| `AGENT_MEMORY_DATA_DIR` | `--data-dir` > env > `~/.local/share/agent-memory/<slot>/` | `…/1/` | brief §3.3 |
| `AGENT_MEMORY_SECRET` | inherited, passthrough only | unset = open | `src/auth.ts:15`, `src/server.ts:538-541` |
| `AGENT_MEMORY_HOST` | `127.0.0.1` | `127.0.0.1` | `src/server.ts:526` |

### 4.4 State file

Path: sibling of the data dir — `<parent-of-data-dir>/state/slot-<N>.json` (default
`~/.local/share/agent-memory/state/slot-<N>.json`). Fields: `slot`, `pids {rest, helix}`,
`helixInstance`, `dataDir`, `startedAt`, `cliVersion`. **Never inside `HELIX_DATA_DIR`**; never a
secret, never memory content, never PII.

### 4.5 Forbidden operations (hard)

`kill` by port scan / `fuser` / any untracked PID · `helix prune` · `helix delete` ·
`docker rm|kill|volume rm` · `helix start|add --persist` (rewrites tracked `helix.toml`) · any
write to a process holding `3111/3112/3113` · printing `AGENT_MEMORY_SECRET` or any env value.

### 4.6 Files

- **New:** `bin/agent-memory.mjs`, `scripts/verify-ops.ts` (evidence harness, §3 sections A–L).
- **Changed:** `package.json` (`bin` + `verify-ops` script ONLY), `README.md` (ops section),
  `TEST_MATRIX.md` (KR rows), `helix.toml` (official `helix add local` appends `[local.slotN]` only).
- **Frozen:** `src/**`, `db/**`, `hooks/**`, `plugins/**`, `mcp_config.json`, `helix.toml`
  `[local.dev]`, all dependency manifests/lockfile. MCP stays stdio — no new port (brief §5).

## 5. Out of Scope

P4.2 (`docker-compose.yml` / k8s manifests) · P4.5 (npm publish) · P4.6 (zero-container mode) ·
P3.3 viewer (the 2 reserved ports only reserve address space) · MCP-HTTP (stdio untouched) ·
automation runbook (`SPEC-P4-OPS-RUNBOOK`, R8, separate spec) · RL-001-QUEUE cap and
VERIFY-SESSION-NODES deletion (tracked in `ROADMAP.md:72-73`) · automating the manual `3151`
reroute path · any change to hook/plugin client defaults.

## 6. Dependencies

Upstream: `BRIEF-p4-ops-control-plane` (approved 2026-09-24); `ROADMAP.md` P4.1/P4.3/P4.4
(`ROADMAP.md:127-130`); installed `helix` CLI 3.3.0 (verified `--help` this session:
`helix start [INSTANCE] --port|--disk|--persist|--storage-uri`, `helix add local --name --port`
(gateway port default 6969), `helix stop|status [INSTANCE]`, `helix prune` = destroys persisted
data) + image tag `v0.0.6` (`helix.toml:9`).
Downstream: `SPEC-P4-OPS-RUNBOOK` (R8), README ops section, `TEST_MATRIX.md` KR1–KR3 rows,
`PROPOSED_CHANGES.md` (next stage, singleton).
Domain sign-offs: R1 (owner) · R8 (ops evidence) · R2 (cross-cut output hygiene) · orchestrator gate.

### Risks & Assumptions

- **A1 (interpretation):** the quartet formula (§4.2) is the only reading of brief §3.2 that
  reproduces its slot-1 enumeration literally (`3111 + 6969 + 2 reservados` = 4 ports). The
  alternative — 4 *consecutive REST* ports per slot with Helix out-of-band — would give slot 1 three
  reserved ports, contradicting the brief. Accepted by orchestrator 2026-09-24.
- **A2 (verified, not assumption):** `helix start --port`, `helix add local --name/--port`,
  `helix stop/status [INSTANCE]` confirmed against CLI 3.3.0 `--help` this session.
- **A3 (falsifiable, must be probed in execute-spec step 0):** `helix start` forwards
  `HELIX_DATA_DIR` into the container. There is **no** `--data-dir` flag in CLI 3.3.0 and the
  helix-cli skill documents native `HELIX_DATA_DIR` persistence as a *direct Docker* mode
  (`EXAMPLES.md:34-54`), while `HELIX_DATA_DIR`/`S3_BUCKET` are mutually exclusive
  (`SKILL.md:32`). If the probe fails → brief §7 fallback **framing 3b** (data-dir for new
  instances only, no dev migration) — escalate to orchestrator; declared reversible call.
- **A4:** instance naming `slotN`; slot 1 reuses the existing `dev` instance.
- **A5:** `helix add local` appending `[local.slotN]` to tracked `helix.toml` is config
  registration sanctioned by brief §3.2 ("cero edición de código"), not a source edit.
- **A6:** CLI binary name `agent-memory` (hyphen) deliberately differs from upstream `agentmemory`
  (`docs/CONTRACT.md:561`) to avoid PATH confusion.
- **R1 (High, irreversible):** MinIO→native migration moves live data — loss risk. Mitigation:
  dry-run default, mandatory verified backup before any move, fail-closed abort, MinIO volume never
  destroyed (kept for manual rollback). Residual risk: operator runs `--apply` against the wrong
  slot — bounded by `--yes` + per-slot target printed in the dry-run plan.
- **R2 (High):** `HELIX_DATA_DIR` not honored by `helix start` on image `v0.0.6` (A3) → P4.4
  degrades to framing 3b; KR3 evidence path changes accordingly.
- **R3 (Medium):** the Helix image runs as uid `65532` (`EXAMPLES.md:49`) — a bind-mounted
  `--data-dir` must be writable by that uid; exact permission mode decided by probe A3; `start`
  fails closed with an actionable message rather than starting data-less.
- **R4 (Medium):** `--persist` would rewrite tracked `helix.toml` (port/storage/tag —
  `CONTRIBUTING.md:22`, `README.md:94`); the CLI never passes it (§4.5).
- **R5 (Medium, cross-domain):** `ROADMAP.md:68` requires the RL-001 concurrent-writer boundary
  re-review "at the start of P4.3 multi-instance work, whichever first", and `ROADMAP.md:72` gates
  RL-001-QUEUE on P4.3. Engineering owner must schedule both alongside this lane — flagged, not
  waived by this spec.
- **R6 (Low):** two REST processes pointed at one `HELIX_URL` would be cross-process writers to one
  Helix instance (out of contract per RL-001). Slots keep one Helix per slot by construction;
  `doctor` reports `HELIX_URL` ↔ quartet mismatches.
- **R7 (Low):** slot 14's reserved port is `3151`, the documented reroute example; reserved ports
  are never bound, so there is no functional conflict — `doctor` labels `3151` occupancy as
  "documented reroute port".

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change | Evidence |
|-------------|---------------------|-----------------|----------|
| REQ-P4-OPS-01 | AC-01 | PROPOSED_CHANGES.md — `bin/agent-memory.mjs`, `package.json` `bin` | `verify-ops` §A + session output |
| REQ-P4-OPS-02 | AC-02 | PROPOSED_CHANGES.md — CLI `start` (spawn + state file) | `verify-ops` §B, TEST_MATRIX KR2 |
| REQ-P4-OPS-03 | AC-03 | PROPOSED_CHANGES.md — CLI `stop` (tracked-PID kill) | `verify-ops` §C |
| REQ-P4-OPS-04 | AC-04 | PROPOSED_CHANGES.md — CLI `status` | `verify-ops` §D + KR1 session output |
| REQ-P4-OPS-05 | AC-05 | PROPOSED_CHANGES.md — CLI `doctor` | `verify-ops` §E + KR1 session output |
| REQ-P4-OPS-06 | AC-06 | PROPOSED_CHANGES.md — derivation module + `helix add local` wiring | `verify-ops` §F + `git diff --stat` |
| REQ-P4-OPS-07 | AC-07 | PROPOSED_CHANGES.md — data-dir resolution + state path | `verify-ops` §G + KR3 session output |
| REQ-P4-OPS-08 | AC-08 | PROPOSED_CHANGES.md — `doctor --migrate` (dry-run/backup/apply) | migration log + `verify-ops` §H |
| REQ-P4-OPS-09 | AC-09 | PROPOSED_CHANGES.md — README + TEST_MATRIX | README/TEST_MATRIX diffs |
| NFR-P4-OPS-A | AC-A | PROPOSED_CHANGES.md — kill-scope guard | `verify-ops` §I |
| NFR-P4-OPS-B | AC-B | PROPOSED_CHANGES.md — redacted output | `verify-ops` §J |
| NFR-P4-OPS-C | AC-C | PROPOSED_CHANGES.md — parity check | `verify-ops` §L + verify-env PASS |
| NFR-P4-OPS-D | AC-D | PROPOSED_CHANGES.md — restart survival test | `verify-ops` §G |
| NFR-P4-OPS-E | AC-E | PROPOSED_CHANGES.md — manifests untouched | suite logs + git diff |
| NFR-P4-OPS-F | AC-F | PROPOSED_CHANGES.md — output allowlist | `verify-ops` §K |
