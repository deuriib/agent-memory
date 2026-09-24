# Architecture Contract: P4 Ops Control Plane

**Owner:** general(vasquez) — Engineering Owner (R1)
**Version:** v1
**Last Updated:** 2026-09-24
**Domains-Touched:** engineering (R1, owner) · automation/ops (R8 — doctor/migrate operational contract + evidence, consumed by name) · security (R2 — output-hygiene cross-cut)

**Singleton:** canonical for this lane — create-if-missing, UPPER_SNAKE, never suffix; update in
place, never `ARCHITECTURE-*.md`. Interfaces/API shapes live in the tables below (no separate
`API_CONTRACTS.md`).

**Scope & grounding:** P4 ops control plane only (brief P4.1/P4.3/P4.4). Every claim cites
`docs/specs/20_backlog/SPEC-P4-OPS.md` (`REQ-P4-OPS-*` / `NFR-P4-OPS-*`, abbreviated REQ/NFR) or
`docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md` (`REQ-OPS-RUN-*`, abbreviated RUN-REQ). Format per
frame-ship `review-architecture/references/architecture-template.md`.

## Overview

One Node ≥20 ESM binary, `bin/agent-memory.mjs`, with **zero new dependencies** adds
`start|stop|status|doctor` over the existing dev instance and over derived multi-instance slots
(REQ-01). All per-slot variability — REST port, Helix port, data dir, URLs — is derived at the CLI
edge and projected through env/flags only; the frozen server/store code keeps its defaults
(REQ-06, NFR-C). The doctor verdict/exit contract is canonical in the R8 runbook (RUN-REQ-01/02,
§4a) and consumed verbatim by this lane (REQ-05). Two things never move: the frozen source
surfaces (§Invariants, INV-002) and the never-kill scope (NFR-A).

## Components

| Component | Responsibility | Interface |
|-----------|---------------|-----------|
| Arg parser (`bin/agent-memory.mjs`) | Fail-closed parsing of subcommand + flags in the style of `src/server.ts:479-481`; unknown subcommand/flag or invalid `--slot` → usage on stderr, exit 2 | CLI surface — Interfaces §1 (REQ-01, REQ-06, AC-01/06) |
| Slot derivation | Pure function `N → quartet + Helix instance name`, no I/O; projects the quartet into env | Interfaces §2 (slot→port) + §3 (derived env); REQ-06, §4.2/§4.3; quartet formula A1 accepted by orchestrator 2026-09-24 |
| Spawn manager (start/stop lifecycle) | `start`: pre-flight quartet occupancy (refuse + "NEVER kill" hint, no signal, exit 1), spawn slot Helix instance + `npx tsx src/server.ts` with §4.3 env (never `--persist`), readiness gate, record state. `stop`: SIGTERM→SIGKILL **tracked PIDs only** + `helix stop <instance>`, remove state, idempotent | `start`/`stop` rows of Interfaces §1; REQ-02/REQ-03, NFR-A |
| State file | Per-slot record of process ownership; the **sole authority** any signal path may consult | Interfaces §4 (schema); REQ-03/REQ-07, §4.4 |
| Doctor checker | Runs check list C1–C5 on every invocation; prints one `PASS\|FAIL\|INFO <check-id> — <detail>` line per check, then exactly one terminal `VERDICT: <name>` line; read-only — no signal path reachable | Interfaces §5 (verdict/exit contract); REQ-05 + RUN-REQ-01..04 |
| Migrator (`doctor --migrate`) | Dry-run plan by default (zero writes); `--migrate --apply --yes` = pre-flight → backup → copy → verify; fail-closed abort; MinIO volume never destroyed | Interfaces §1 doctor row + Data Flow §4; REQ-08 + RUN-REQ-05..08 |

`status` is a read-only rendering mode of the same binary (no verdicts, no side effects) — its
own 0/1/2 contract lives in Interfaces §1 and REQ-04; it is **not** `doctor` (INV-009).

## Interfaces

### §1 CLI surface (REQ-01, §4.1)

| Subcommand | Flags | Side effects | Exit codes |
|---|---|---|---|
| `start` | `--slot N` (default 1), `--data-dir PATH` | spawn Helix instance + server, readiness gate, write state | 0 started · 1 refused/failed · 2 usage |
| `stop` | `--slot N`, `--data-dir PATH` | SIGTERM→SIGKILL tracked PIDs, `helix stop <instance>`, remove state | 0 stopped/idempotent · 1 own-process failed to die · 2 usage |
| `status` | `--slot N` | none (read-only probes) | 0 healthy · 1 degraded/down · 2 usage |
| `doctor` | `--slot N`, `--data-dir PATH`, `--migrate`, `--apply`, `--yes`, `--backup-dir PATH` | checks only; `--migrate` = dry-run plan; `--migrate --apply --yes` = backup → migrate → verify | 0/1/2/3/4/5 per §5 below |

Shared: `--help` → usage, exit 0; `--apply` without `--migrate` or `--migrate --apply` without
`--yes` → exit 2 (REQ-01, §4.1).

### §2 Slot → port derivation table (REQ-06, §4.2 — A1 accepted by orchestrator 2026-09-24)

| Slot | REST `R(N) = 3111 + 3(N−1)` | Helix `H(N) = 6969 + (N−1)` | Reserved 1 `R+1` | Reserved 2 `R+2` | Helix instance |
|---|---|---|---|---|---|
| 1 | `3111` (default parity, untouched) | `6969` | `3112` | `3113` | `dev` (existing) |
| 2 | `3114` | `6970` | `3115` | `3116` | `slot2` |
| 3 | `3117` | `6971` | `3118` | `3119` | `slot3` |
| N | `3111 + 3(N−1)` | `6969 + (N−1)` | `R+1` | `R+2` | `slotN` (N≥2) |

Invariants: `N` integer ≥ 1 else exit 2; slot N≥2 ⇒ quartet ∩ `{3111,3112,3113,6969}` = ∅;
reserved ports reserve address space only — never bound, never signaled (§4.2).

### §3 Derived env contract, slot N (REQ-06/REQ-07, §4.3)

| Variable | Value for slot N | Slot-1 default (unchanged) |
|---|---|---|
| `AGENT_MEMORY_PORT` | `R(N)` | `3111` |
| `AGENT_MEMORY_URL` | `http://127.0.0.1:R(N)` | `http://127.0.0.1:3111` |
| `HELIX_URL` | `http://127.0.0.1:H(N)` | `http://localhost:6969` |
| `HELIX_DATA_DIR` | resolved data dir | unset for dev until migration/fallback |
| `AGENT_MEMORY_DATA_DIR` | `--data-dir` > env > `~/.local/share/agent-memory/<slot>/` | `…/1/` |
| `AGENT_MEMORY_SECRET` | inherited, passthrough only — never printed | unset = open |
| `AGENT_MEMORY_HOST` | `127.0.0.1` | `127.0.0.1` |

### §4 State file schema (REQ-03/REQ-07, §4.4)

Path: `<parent-of-data-dir>/state/slot-<N>.json` (default
`~/.local/share/agent-memory/state/slot-<N>.json`) — sibling of the data dir, **never inside
`HELIX_DATA_DIR`**. Fields: `slot`, `pids {rest, helix}`, `helixInstance`, `dataDir`,
`startedAt`, `cliVersion`. Never a secret, never memory content, never PII (NFR-B, NFR-F).

### §5 Doctor verdict / exit contract (canonical: RUNBOOK §4a / RUN-REQ-01, RUN-REQ-02; consumed by REQ-05)

| Exit | Verdict | Triggering check(s) | Precedence |
|------|---------|---------------------|------------|
| 0 | `healthy` | all checks PASS (C2 may be `INFO not-running` pre-start) | 5th |
| 1 | `doctor-check-failed` | C5 storage/data-dir FAIL; unexpected internal error | 4th |
| 2 | usage | bad/unknown flags | n/a |
| 3 | `upstream-holds-port` | C3 foreign PID on any slot-quartet port (+ `NEVER kill 3111/3112/3113` + `AGENT_MEMORY_PORT=3151` hint) | 3rd |
| 4 | `helix-down` | C1 healthz refused/non-200; C2 REST 500 (Helix unreachable via server) | 2nd |
| 5 | `secret-missing` | C4 empty `AGENT_MEMORY_SECRET`; C2 REST 401 (bearer mismatch) | 1st (wins) |

Checks (RUN-REQ-01): **C1** `helix-healthz`, **C2** `rest-health` (presence-conditional),
**C3** `ports`, **C4** `secret-presence` (flag only, value never read), **C5**
`storage-data-dir` (table-scoped `helix.toml` parse). All checks run and print before the verdict
is chosen; one terminal `VERDICT: <name>` line; exit code equals this table. The three KR1
verdicts map to `healthy` (0), `upstream-holds-port` (3), `helix-down` (4); `secret-missing` (5)
and `doctor-check-failed` (1) complete the full closed set.

## Data Flow

1. **Start lifecycle (REQ-02):** parse args (usage → exit 2) → derive quartet + §3 env → resolve
   data dir precedence (REQ-07) → pre-flight: any quartet port held by a PID we do not own →
   report occupant + "NEVER kill" hint, exit 1, occupant never signaled → slot 1: `helix start
   dev`; slot N≥2: one-time `helix add local --name slotN --port H(N)` then `helix start slotN`
   (never `--persist`) → spawn `npx tsx src/server.ts` with §3 env → readiness: Helix `/healthz` +
   our `/memory/livez` within a bounded 30 s → write state file → exit 0.
2. **Stop lifecycle (REQ-03):** parse → load state file; absent → "not running", exit 0
   (idempotent) → SIGTERM tracked PIDs (server drains, `src/server.ts:544-549`) → bounded grace →
   SIGKILL → `helix stop <instance>` → remove state file. Foreign quartet holders reported,
   never touched; exit 1 only if one of our own processes refuses to die.
3. **Doctor verdict flow (REQ-05, RUN-REQ-01/02/04):** parse → run C1–C5 (every check prints one
   line) → fold failures through fixed precedence `5 > 4 > 3 > 1 > 0` → exactly one terminal
   `VERDICT: <name>` line → exit per Interfaces §5. Read-only: no stop/signal path is reachable
   from `doctor`.
4. **Migration flow (REQ-08, RUN-REQ-05..08):** `doctor --migrate` = dry-run plan (source label,
   target dir, counts, checksums), zero writes, exit 0 → `--apply --yes`: pre-flight (C1/C4 PASS,
   our slot server stopped, target empty) → inline dry-run re-run → verified backup to
   `--backup-dir` (no verified backup → ABORT) → copy → verify counts + canary round-trip →
   report old MinIO volume retained. Any error → `MIGRATE ABORT: <step>`, exit non-zero, source +
   backup byte-identical, no adoptable partial target.

## Invariants

- INV-001: Zero new dependencies; `package.json` gains only the `bin` entry + `verify-ops`
  script; manifests and lockfile untouched (REQ-01, NFR-E).
- INV-002: Frozen surfaces never modified by any subcommand — see list below (REQ-06, §4.6).
- INV-003: Never-kill — signal only PIDs we spawned and recorded; forbidden: port-scan kill,
  `fuser`, `helix prune|delete`, `docker rm|kill|volume rm`, `--persist`, any write to a holder
  of `3111/3112/3113` (NFR-A, §4.5, RUN-REQ-13/14).
- INV-004: No secret value (or any env value) in any output or in the state file — flags only,
  `bearer: armed|unset` (NFR-B, NFR-F — Ley 172-13; RUN-REQ-03 allowlist).
- INV-005: Defaults untouched — REST `3111`, Helix `6969`, hooks/plugins clients `3111`; slots
  are derivation, not a default change (NFR-C).
- INV-006: Doctor verdicts are the closed set of Interfaces §5 with fixed precedence
  `5 > 4 > 3 > 1 > 0` and exactly one terminal `VERDICT: <name>` line (REQ-05 = RUN-REQ-02
  canonical).
- INV-007: State file lives outside `HELIX_DATA_DIR`; Helix owns its data directory exclusively
  (REQ-07, §4.4).
- INV-008: Migration is fail-closed — dry-run default, verified backup before any move, the old
  MinIO volume never destroyed by any subcommand (REQ-08).
- INV-009: `status` is NOT `doctor` — separate contracts: status exits 0/1/2 (REQ-04), doctor
  exits 0–5 per Interfaces §5 (REQ-05).
- INV-010: Derivation applied only via env/flags — zero `src/**`/`db/**` edits; slot N≥2 quartet
  never intersects `{3111,3112,3113,6969}`; reserved ports never bound, never signaled
  (REQ-06, §4.2).

### Frozen surfaces (INV-002, §4.6; brief §5)

`src/**` · `db/**` · `hooks/**` · `plugins/**` · `mcp_config.json` (MCP stays **stdio** — no new
port) · `helix.toml` `[local.dev]` · all dependency manifests + `package-lock.json`. Additive
`[local.slotN]` tables written by the official `helix add local` are config registration, not
source edits (REQ-06, A5).

## Non-Functional Requirements

- Performance: `start` readiness bounded (30 s precedent, `scripts/verify-env.ts:55`);
  `status`/`doctor` are bounded read-only probes; migration bounded by backup verification
  (REQ-02, REQ-08).
- Availability: `stop` idempotent from the state file; `status`/`doctor` never mutate state;
  slot N≥2 operations leave slot 1 (`3111`/`6969`) serving (AC-02, AC-03, NFR-D).
- Security: Ley 172-13 output allowlist — ports, booleans, counts, HTTP status codes,
  `$HOME`-collapsed paths only; secret presence flags only, value never read into any output
  path; never-kill enforced statically and at runtime (NFR-A/B/F; RUN-REQ-03/04 — R2 co-signs
  the allowlist).
