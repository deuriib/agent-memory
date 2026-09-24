# Spec: P4 OPS RUNBOOK — doctor/migrate/stop operational contract + verification wiring

**ID:** SPEC-P4-OPS-RUNBOOK
**Owner:** general(espinoza) — Automation/Ops Owner (R8)
**Domains-Touched:** automation/ops (R8) | engineering (R1, consumes SPEC-P4-OPS interfaces by name only)
**Brief Reference:** BRIEF-p4-ops-control-plane (bounded-initiative, approved 2026-09-24)
**Status:** draft
**Priority:** P1
**Execution_Mode:** subagents (inherited from brief, frozen at frame-intent; max 2 parallel lanes — INV-006)

**Packet (reference-only):** `SPEC:docs/briefs/BRIEF-p4-ops-control-plane.md#OKRs / HARD:subagents+<no new deps, typecheck + existing suites green, never kill upstream 3111/3112/3113, Ley 172-13 no-PII/no-secrets in outputs or logs> / GATE:none-yet / DOMAINS:R8 automation/ops`

## 1. Context

BRIEF-p4-ops-control-plane adds `bin/agent-memory.mjs` (`start|stop|status|doctor`), slot-based
multi-instance operation, and an explicit data directory (P4.1/P4.3/P4.4). The engineering
lane owns the implementation spec **SPEC-P4-OPS** (written in parallel — referenced by name
only, never awaited, never created by this lane). This spec owns the **operational contract**
the implementation must satisfy and the evidence machinery that proves it:

1. **`doctor` as a verification surface** — an exact, testable check list with a closed set of
   verdicts and exit codes, whose output is allowlist-clean under Ley 172-13 (flags only —
   never a secret value, never memory content, never a raw env dump).
2. **The P4.4 migration runbook** — `doctor --migrate` moves live MinIO-era dev data into
   `HELIX_DATA_DIR`. That is the one irreversible call in this initiative (brief §7
   "Falsifiable bet"), so it is specified fail-closed: dry-run first, mandatory backup,
   old volume retained, abort-with-zero-loss on any failure.
3. **Verification wiring** — which existing suites must stay green, and exactly what NEW
   evidence (KR1/KR2/KR3) the P4 lane records in the `TEST_MATRIX.md` lane singleton.
4. **The never-kill-upstream operational guard** — `stop` must be provably restricted to
   slot-owned processes (own Helix instance name + own recorded server PID/port), never
   upstream `3111/3112/3113`, never the upstream instance.

Grounding facts (verified in-repo, cited in §7): CI runs `typecheck` + Helix-free suites +
pinned gitleaks (`.github/workflows/ci.yml:21-30,41-53`) and deliberately does NOT run
`npm run verify` (`.github/workflows/ci.yml:23-25`); `verify-env` is the existing port-guard
suite with TEST_PORT discipline `3199` — "never 3111/3112/3113/3151/6969"
(`scripts/verify-env.ts:29-35,47-48`); the reroute/NEVER-kill hint wording is already
contractually asserted (`scripts/verify-env.ts:391-393`, `README.md:471-492`,
`docs/CONTRACT.md:560-564`); evidence format is the `REQ-ID | Evidence ID | Description |
Type | Status | Commit` table plus per-command count bars (`TEST_MATRIX.md:10-13,68-77`).

## 2. Requirements

### Block A — `doctor` semantics as verification (KR1)

- **REQ-OPS-RUN-01 (exact check list):** `doctor [INSTANCE|--slot N]` runs ALL of the
  following checks every invocation, prints one `PASS|FAIL|INFO <check-id> — <flag-only detail>`
  line per check, then exactly one terminal `VERDICT: <name>` line. Checks, in order:
  - **C1 `helix-healthz`** — HTTP probe of the slot's `HELIX_URL` health endpoint
    (read-only; 6969 convention: probe read-only, never write — `scripts/verify-env.ts:31`).
    200 → PASS; refused/timeout/non-200 → FAIL (contributes `helix-down`).
  - **C2 `rest-health`** — presence-conditional probe of the slot REST port (see Assumption
    A2): if a listener is detected, `GET /memory/livez` (expect 200, bearer-exempt) and
    `GET /memory/health` with `Bearer <AGENT_MEMORY_SECRET>` read from the operator's env
    (expect 200). 401 → FAIL (contributes `secret-missing` — our bearer does not arm the
    slot's guard); 500 → FAIL (contributes `helix-down` — server up, Helix unreachable
    through it; same distinction already encoded at `scripts/verify-env.ts:306-310`).
    No listener + port free → `INFO rest: not-running (start the slot)` (does not flip the
    verdict — pre-flight mode). No listener + port held by a foreign PID → FAIL via C3.
  - **C3 `ports`** — for each port in the slot's quartet (quartet derivation belongs to
    SPEC-P4-OPS; this runbook only consumes it): free → PASS; bound by the slot-owned PID
    recorded at `start` → PASS `owned`; bound by any other PID → FAIL (contributes
    `upstream-holds-port`) and the line MUST carry the static hint containing
    `NEVER kill` and `3111/3112/3113` plus the `AGENT_MEMORY_PORT=3151` reroute example —
    exact wording class already asserted at `scripts/verify-env.ts:391-399` and
    `README.md:491-492`.
  - **C4 `secret-presence`** — slot `AGENT_MEMORY_SECRET` non-empty → PASS with flag
    `secret: present`; empty → FAIL with flag `secret: missing` (contributes
    `secret-missing`). The VALUE is never read into any output path (flag only —
    brief §3.1 "flag, nunca el valor"; leak-check pattern from
    `scripts/verify-env.ts:314-323`).
  - **C5 `storage-data-dir`** — parse `helix.toml` TABLE-SCOPED to the target
    `[local.<instance>]` (a global regex is a known false-negative source —
    `docs/specs/50_archive/P0/review-refuter.md` CE-06) and report flags
    `storage: disk|memory` + `data-dir: present|missing|not-writable`. Any FAIL →
    contributes `doctor-check-failed` (exit 1). C5 never flips to the four KR1 verdicts.
- **REQ-OPS-RUN-02 (closed verdict/exit contract):** Terminal verdicts and exit codes are
  closed and machine-testable: `healthy` = **0**, `doctor-check-failed` = **1** (C5 failures
  and unexpected internal errors), usage/bad-flags = **2** (matches the repo usage-guard
  convention, `scripts/purge.ts` exit 2 per `docs/CONTRACT.md` §5), `upstream-holds-port` =
  **3**, `helix-down` = **4**, `secret-missing` = **5**. All checks still run and print;
  the terminal verdict is chosen by FIXED PRECEDENCE: `secret-missing` (5) >
  `helix-down` (4) > `upstream-holds-port` (3) > `doctor-check-failed` (1) > `healthy` (0).
  Rationale (default, stated): our own config first, then dependency, then environment
  conflict — every scenario has exactly one deterministic exit code.
- **REQ-OPS-RUN-03 (allowlist-clean output — Ley 172-13):** `doctor` stdout/stderr is
  rendered from a STRICT FIELD ALLOWLIST (§4b): verdict token, check id, PASS/FAIL/INFO,
  port numbers, Helix instance name, PID numbers, presence/state flags, HTTP status codes,
  `$HOME`-collapsed paths (home prefix printed as `~` — never a username), and static hint
  text. FORBIDDEN: secret values, `Authorization` headers, raw env dumps, HTTP response
  bodies, memory content, project/session identifiers, container env. Same posture as the
  governance-log allowlist (`docs/CONTRACT.md` §3, SEC-002 masking) and the zero-leak
  assertions in `scripts/verify-env.ts:314-323`.
- **REQ-OPS-RUN-04 (port-conflict verdict is non-blocking for upstream):**
  `upstream-holds-port` reports and EXITS 3 without killing, displacing, or writing to any
  foreign process or volume. No `stop`/signal path is reachable from `doctor`.

### Block B — Migration runbook P4.4 (`doctor --migrate`) (KR3)

- **REQ-OPS-RUN-05 (dry-run first):** `doctor --migrate` REQUIRES `--dry-run` on the first
  meaningful invocation: `doctor --migrate --dry-run` performs zero writes — it prints the
  plan (source: MinIO-era dev data location; target: resolved `AGENT_MEMORY_DATA_DIR` that
  is passed as `HELIX_DATA_DIR`; backup destination; file/byte counts) and exits 0. A real
  (non-dry-run) `--migrate` run MUST refuse to proceed if a dry-run for the same
  source/target pair has not succeeded in that invocation chain (re-run dry-run inline,
  then proceed) — dry-run is a step of the procedure, not an optional flag.
- **REQ-OPS-RUN-06 (mandatory backup, pre-flight):** Pre-flight before any copy:
  (a) `doctor` environment checks (C1/C4) PASS for the target instance; (b) the slot server
  is NOT running (stop our own slot-owned server first — never anything else); (c) target
  data-dir is empty or absent; (d) a full backup of the source is taken to
  `<target>.backup-<UTC-timestamp>` and verified non-empty. No verified backup → abort,
  no copy (brief §3.4 "backup obligatorio").
- **REQ-OPS-RUN-07 (copy + verify + volume retained):** Copy MinIO-era data → target
  `HELIX_DATA_DIR`, then verify with the round-trip: `remember` canary → restart the target
  instance (`helix restart <instance>`) → `search` returns the canary. The old MinIO-era
  volume is RETAINED and untouched (evidenced by `docker volume ls` / `helix status`
  before+after; brief §3.4 "el volumen MinIO viejo nunca se destruye").
- **REQ-OPS-RUN-08 (fail-closed abort, zero data loss):** Any failure at any step →
  print `MIGRATE ABORT: <step> — <flag-only reason>`, exit non-zero, leave source + backup
  byte-identical and untouched, leave no half-written target in a state a subsequent start
  would silently adopt (remove partial target or mark it `INCOMPLETE` and refuse to start
  against it). The source is READ-ONLY for the entire procedure; no step ever writes to or
  stops the upstream instance. This is the fail-closed posture the brief mandates for the
  irreversible call (§7 Falsifiable bet); if `HELIX_DATA_DIR` proves unsupported by Helix
  v0.0.6 at runtime, the outcome is ABORT — never partial migration.

### Block C — Verification wiring (KR1/KR2/KR3 evidence)

- **REQ-OPS-RUN-09 (existing suites stay green, CI unchanged):** The P4 lane must keep
  green, without weakening or skipping: `npm run typecheck` (CI `ci.yml:22`);
  `npx tsx scripts/verify-injection.ts` (CI `ci.yml:25`); `npx tsx scripts/verify-lifecycle.ts`
  (CI `ci.yml:27`); `npx tsx scripts/verify-capture.ts` (CI `ci.yml:28`);
  `npx tsx scripts/verify-skills.ts --structural` (CI `ci.yml:30`); pinned gitleaks
  `detect --source=. --no-banner --redact` (CI secret-scan `ci.yml:41-53`); locally —
  `npm run verify-env` (port-guard suite, 21-check bar, TEST_PORT 3199 discipline per
  `scripts/verify-env.ts:47-48`), `npm run verify` (243-check bar; CI deliberately skips it —
  `ci.yml:23-25`), `npm run verify-skills` (live round-trips). No new dependencies (HARD).
  Default: `.github/workflows/ci.yml` is UNCHANGED by this spec (Assumption A1).
- **REQ-OPS-RUN-10 (NEW evidence — TEST_MATRIX P4 section, KR1/KR2/KR3):** Evidence lands
  as a new **"P4 OPS" section in `TEST_MATRIX.md`** (the lane evidence singleton — create
  section, update in place, never a second matrix file), one row per REQ in the existing
  `REQ-ID | Evidence ID | Description | Type | Status | Commit` shape (`TEST_MATRIX.md:10-13`)
  plus a per-command result bar like `TEST_MATRIX.md:68-77`. Required contents:
  - **KR1:** verbatim stdout + exit code of all four commands on the dev instance —
    `agent-memory start`, `status`, `doctor`, `stop` — and doctor exercised through the
    closed verdict set: `healthy` (exit 0), `doctor-check-failed` (exit 1, induced C5
    storage/data-dir inconsistency), `upstream-holds-port` (exit 3, foreign listener on a
    slot port), `helix-down` (exit 4, Helix stopped then restored in a declared window),
    `secret-missing` (exit 5, env without `AGENT_MEMORY_SECRET`) — exit 2 = usage,
    asserted by AC-01 (bad flag).
  - **KR2:** second-slot round-trip — `start --slot 2` → `remember` → `search` hit on the
    slot-2 quartet; instance 1 still healthy afterward (`status` + its own round-trip);
    **zero source edits**: `git diff` over `src/ db/ hooks/ plugins/ scripts/` empty, with
    any `helix.toml` delta limited to the additive `[local.<name>]` table written by
    `helix add local` (config, not source — brief §2 "cero edición de código fuente").
  - **KR3:** data-dir survival — save → `helix restart <instance>` → `search` finds it;
    migration evidence — recorded `--dry-run` output artifact, backup path existence +
    non-zero size, copy→verify log, old MinIO volume still listed; README runbook section
    (data path, backup, recovery) cited by section heading + line anchor.
  - **Stop guard proof (Block D):** before/after process snapshots + foreign-listener
    survival, as required by REQ-OPS-RUN-14.
- **REQ-OPS-RUN-11 (port/instance discipline + two-lane windows):** Every evidence run
  declares the ports and Helix instances it touched. Absolute rules: never write to or kill
  `3111/3112/3113`; 6969 probed read-only except in the explicitly declared KR3 dev-restart
  window; TEST_PORT discipline of `scripts/verify-env.ts:29-35` preserved for any new test
  ports. The lane runs under the 2-parallel-lane rule (INV-006 — this spec is one lane):
  live evidence requiring the shared dev Helix (KR1 `helix-down`, KR3 restart, `npm run
  verify`) runs in a DECLARED exclusive window so it cannot collide with the parallel
  engineering lane's live runs (known failure mode: mid-restart `internal_error` incident,
  `TEST_MATRIX.md:62`). Session-node run budget consumed by new `verify` runs (+17/run,
  budget 25 runs — `docs/CONTRACT.md` §5) must be declared in the evidence section.
- **REQ-OPS-RUN-12 (optional mechanization — `verify-ops`):** If the evidence is
  mechanized, it lands as an additive `scripts/verify-ops.ts` + `npm run verify-ops`
  script entry (no new deps), following the `verify-env.ts` house style (sections, `check()`,
  counters, `VERIFY PASS/FAIL`, exit 0 only on all-pass, children cleaned in `finally`).
  It MUST include the secret-leak assertion pattern (run doctor with a synthetic secret,
  assert 0 occurrences in stdout/stderr — pattern `scripts/verify-env.ts:54,314-323`) and
  must NOT be added to the CI `verify` job unless it is Helix-free (CI's Helix-free
  discipline, `ci.yml:23-30`). The TEST_MATRIX section (REQ-OPS-RUN-10) is mandatory
  regardless; `verify-ops` is the preferred, not required, vehicle (Assumption A5).

### Block D — Never-kill-upstream operational guard (`stop`) (KR1/KR2)

- **REQ-OPS-RUN-13 (stop ownership contract):** `stop` may signal EXACTLY two kinds of
  targets, nothing else: **(a)** the slot-owned REST server — the PID recorded in the
  slot's PID file at `start`, SIGTERM only after re-verifying that PID's current command
  line still matches our `src/server.ts` launch (PID-reuse guard), escalating to SIGKILL
  after a bounded timeout; **(b)** the slot's Helix instance — only the instance name the
  slot is bound to (slot 1 → existing `[local.dev]`; slot N ≥ 2 → `[local.slotN]` created
  by `helix add local --name slotN`; names come from `helix.toml` `[local.*]` tables —
  `helix.toml:9-14`, brief §3.3), invoked as `helix stop <that-name>` with the name printed
  in the output. Binding is resolved from config/PID-file state, never guessed (Risk R1).
- **REQ-OPS-RUN-14 (forbidden primitives — static + runtime proof):** The implementation
  contains NO `pkill`, `fuser`, `killall`, port-pattern kill, blanket `docker kill/rm`, or
  bare `helix stop` without an instance argument; it never sends a signal to any PID
  listening on `3111/3112/3113` and never stops an instance name it does not own. Proof
  recorded in TEST_MATRIX: **(i)** before/after `ss -ltnp` (or `lsof -i`) snapshots showing
  `3111/3112/3113` listeners identical after `stop`; **(ii)** a foreign listener on a
  non-owned test port survives `stop`; **(iii)** `helix status dev` (uptime/PID) unchanged
  after `stop` of slot 2; **(iv)** static grep of the implementation for the forbidden
  primitives returns empty.
- **REQ-OPS-RUN-15 (README runbook section — KR3 doc closure):** README gains a P4
  operations section covering: slot/port table + quartet derivation (by reference to
  SPEC-P4-OPS), data-dir default path (`~/.local/share/agent-memory/<instance>/`),
  backup procedure, recovery procedure (`helix status` first — symptom-free dark-stack
  warning already at `README.md:501-507`), migration steps (linking this runbook), and the
  NEVER-kill-upstream rule with the reroute example (`README.md:471-492` wording class).
  Evidence = section heading + line anchor in the TEST_MATRIX P4 section.

## 3. Acceptance Criteria

- [ ] **AC-OPS-RUN-01:** TEST_MATRIX "P4 OPS" section records verbatim outputs + exit codes
  of `start|status|doctor|stop` on the dev instance, and doctor observed at all four
  verdicts with exits 0 / 3 / 4 / 5. (REQ-01, REQ-02 → KR1)
- [ ] **AC-OPS-RUN-02:** Precedence proven: a run with ≥2 simultaneous failures (e.g.
  secret missing AND Helix down) exits with the fixed-precedence code (5), all check lines
  still printed. (REQ-02 → KR1)
- [ ] **AC-OPS-RUN-03:** Allowlist proof — doctor output scanned for a synthetic secret value
  yields 0 occurrences, contains no env dump / response body / username (home collapsed to
  `~`), and `doctor` on a held port emits `NEVER kill` + `3111/3112/3113` + the reroute
  example. Evidence: verify-ops output or scripted grep pasted in TEST_MATRIX.
  (REQ-03, REQ-04 → KR1 + Ley 172-13 HARD)
- [ ] **AC-OPS-RUN-04:** `doctor --migrate --dry-run` artifact recorded; source listing and
  byte counts identical before/after the dry-run (zero writes proven). (REQ-05 → KR3)
- [ ] **AC-OPS-RUN-05:** Migration log shows pre-flight → dry-run → backup (path exists,
  size > 0) → copy → verify in that order; the backup timestamp precedes the first copy
  byte. (REQ-06, REQ-07 → KR3)
- [ ] **AC-OPS-RUN-06:** save → `helix restart <instance>` → `search` round-trip green
  against the migrated data-dir, and the old MinIO volume still present in
  `docker volume ls` / `helix status` before+after. (REQ-07 → KR3)
- [ ] **AC-OPS-RUN-07:** Induced failure (e.g. source absent or target non-empty) →
  `MIGRATE ABORT` line, non-zero exit, source + backup byte-identical, no adoptable
  half-written target. (REQ-08 → KR3 fail-closed)
- [ ] **AC-OPS-RUN-08:** Full suite bar green in the evidence run: `typecheck` (0 errors),
  `verify-env` (21), `verify-lifecycle` (123), `verify` (243), `verify-capture` (137),
  `verify-skills --structural` (73) + live, `verify-injection` (73), gitleaks clean; counts
  pasted as a per-command bar. (REQ-09 → HARD)
- [ ] **AC-OPS-RUN-09:** `.github/workflows/ci.yml` diff is empty (or, if a step is added,
  it is declared in TEST_MATRIX and is Helix-free); `package.json` gains no dependency
  entries. (REQ-09, A1 → HARD)
- [ ] **AC-OPS-RUN-10:** KR2 row: slot-2 `remember→search` round-trip output, instance-1
  post-check output, and empty `git diff` over `src/ db/ hooks/ plugins/ scripts/`
  (helix.toml delta limited to `[local.<name>]`), all pasted. (REQ-10 → KR2)
- [ ] **AC-OPS-RUN-11:** KR3 row: data-dir save→`helix restart`→search output + README
  section anchor (heading + line number) recorded. (REQ-10, REQ-15 → KR3)
- [ ] **AC-OPS-RUN-12:** Evidence section declares ports/instances touched, the exclusive
  live-Helix window used, and the Session-node budget delta consumed by new `verify` runs.
  (REQ-11 → INV-006 + CONTRACT §5)
- [ ] **AC-OPS-RUN-13:** Stop-guard proofs (i)–(iv) from REQ-14 pasted: identical
  `3111/3112/3113` snapshots, foreign test listener alive, `helix status dev` unchanged
  after slot-2 stop, empty forbidden-primitive grep. (REQ-13, REQ-14 → never-kill HARD)
- [ ] **AC-OPS-RUN-14:** If `verify-ops` exists: it exits 0 on a healthy slot, red FAILs on
  an induced leak, and its child processes are reaped (`finally` cleanup) — output pasted.
  (REQ-12 → KR1 mechanization)
- [ ] **AC-OPS-RUN-15:** Every REQ-OPS-RUN-* has a row in the TEST_MATRIX "P4 OPS"
  section mapping REQ → evidence ID → artifact path (no orphan REQ, no orphan evidence).
  (REQ-10 → traceability)

## 4. Contracts & Interfaces

### 4a. Doctor verdict / exit-code contract (REQ-01, REQ-02)

| Exit | Verdict | Triggering check(s) | Precedence |
|------|---------|---------------------|------------|
| 0 | `healthy` | all checks PASS (C2 may be `INFO not-running` pre-start) | 5th |
| 1 | `doctor-check-failed` | C5 storage/data-dir FAIL; unexpected internal error | 4th |
| 2 | usage error | bad/unknown flags (repo convention: `purge` usage exit 2) | n/a |
| 3 | `upstream-holds-port` | C3 foreign PID on any slot-quartet port (+ `NEVER kill 3111/3112/3113` + `AGENT_MEMORY_PORT=3151` hint) | 3rd |
| 4 | `helix-down` | C1 healthz non-200/refused; C2 REST 500 (Helix unreachable via server) | 2nd |
| 5 | `secret-missing` | C4 empty `AGENT_MEMORY_SECRET`; C2 REST 401 (bearer mismatch) | 1st (wins) |

Output shape: one line per check (`PASS|FAIL|INFO <check-id> — <detail>`), then exactly one
`VERDICT: <name>` line; process exit code equals the verdict table. All checks run before
the verdict is chosen.

### 4b. Doctor output allowlist (REQ-03)

| Allowed (rendered) | Forbidden (never rendered) |
|---|---|
| verdict token, check id, PASS/FAIL/INFO | secret values (any env var value that is a secret) |
| port numbers, instance name, PID numbers | `Authorization` headers, cookies, tokens |
| presence/state flags (`secret: present`, `storage: disk`, `data-dir: present`) | raw env dumps, HTTP response bodies |
| HTTP status codes (200/401/500) | memory content, project/session identifiers |
| paths with `$HOME` collapsed to `~` | usernames / absolute home paths, PII |
| static hint text (`NEVER kill 3111/3112/3113`, reroute example) | anything stringified from a stored object |

Enforcement pattern = `logSafeNote` posture + the `verify-env` synthetic-secret leak asserts
(`scripts/verify-env.ts:314-323`); migration output prints counts and paths only — never
memory content (brief §5, Ley 172-13).

### 4c. Migration procedure contract (REQ-05..08)

```text
doctor --migrate --dry-run   → plan (source/target/backup/counts), ZERO writes, exit 0
doctor --migrate             → 1 pre-flight (doctor C1/C4 PASS, our slot server stopped, target empty)
                               2 dry-run (re-run inline, must pass)
                               3 backup source → <target>.backup-<UTC-ts> (verify non-empty; NO backup → ABORT)
                               4 copy MinIO-era data → HELIX_DATA_DIR target
                               5 verify: remember canary → helix restart <instance> → search finds canary
                               6 report: old MinIO volume retained (untouched), verdict line
Any failure → MIGRATE ABORT: <step>, exit non-zero, source+backup byte-identical,
no adoptable partial target. Upstream instance/ports never written or stopped.
```

### 4d. Stop ownership contract (REQ-13, REQ-14)

```text
stop [--slot N | INSTANCE]
  a. resolve binding: slot → [local.<name>] in helix.toml (slot1→dev; slotN≥2→slotN); print instance name
  b. REST server: PID from slot PID file → verify PID cmdline matches our server → SIGTERM → bounded wait → SIGKILL (ours only)
  c. Helix: `helix stop <name>` (named instance only, never bare/never foreign)
  d. never: pkill | fuser | killall | port-pattern kill | docker kill/rm foreign | signal to any PID on 3111/3112/3113
```

### 4e. Evidence contract (REQ-10..12)

Section `## P4 OPS` in `TEST_MATRIX.md` (singleton, in-place updates): rows
`REQ-ID | Evidence ID (T-P4OPS-nn) | Description | Type | Status | Commit` + a per-command
count bar + a declared ports/instances/live-window/session-budget block. Optional
`scripts/verify-ops.ts` (`npm run verify-ops`) in `verify-env.ts` house style; not added to
CI unless Helix-free.

## 5. Out of Scope

- **SPEC-P4-OPS itself** — CLI implementation, port-quartet derivation formula, PID-file
  format, `status` rendering, route/flag surface: engineering owner (R1), parallel lane.
  This spec consumes those interfaces by name only; no code is written by this lane.
- P4.2 (docker-compose/k8s), P4.5 (npm publish), P4.6 (zero-container), P3.3 viewer,
  MCP-HTTP (brief §6).
- The two reserved ports of each quartet (they reserve space only — brief §3.2).
- Session-node deletion path (existing residual, owner engineering — `docs/CONTRACT.md` §5).
- CI restructuring, new dependencies, any weakening/skipping of an existing suite (HARD).
- Approving this spec (GATE: none-yet — orchestrator routes it; security R2 reviews the
  doctor-output allowlist before implementation).

## 6. Dependencies

- **Upstream:** `docs/briefs/BRIEF-p4-ops-control-plane.md` (KR1/KR2/KR3, §3.1/§3.4, §7).
- **Parallel, by name only:** `SPEC-P4-OPS` (engineering owner R1 — never created or
  awaited by this lane; divergence resolved by the orchestrator, see Risk R2).
- **Existing surfaces this spec wires (read-only):** `.github/workflows/ci.yml`,
  `scripts/verify-env.ts`, `scripts/verify.ts` / `verify-lifecycle.ts` / `verify-capture.ts`
  / `verify-skills.ts` / `verify-injection.ts`, `TEST_MATRIX.md`, `docs/CONTRACT.md` §5,
  `README.md` (Known limitations #1/#2, Durability & recovery), `helix.toml` `[local.dev]`,
  Helix CLI v0.0.6 (`helix start|stop|status|restart [INSTANCE]`, `helix add local --name N`).
- **Domain sign-offs:** R8 automation owns this spec; R2 security co-signs the §4b
  allowlist (doctor is a secret-adjacent surface — brief §5 cross-cutting R2);
  orchestrator owns the final gate.

## 7. Traceability

| Requirement | Acceptance Criterion | Proposed Change | Evidence |
|-------------|---------------------|-----------------|----------|
| REQ-OPS-RUN-01 | AC-01, AC-02, AC-03 | PROPOSED_CHANGES.md — `bin/agent-memory.mjs` `doctor` check loop (impl. lane, SPEC-P4-OPS) | TEST_MATRIX `T-P4OPS-01..04` — 4 verdict outputs + precedence run |
| REQ-OPS-RUN-02 | AC-01, AC-02 | PROPOSED_CHANGES.md — verdict table + precedence in `doctor` | TEST_MATRIX — exit codes 0/3/4/5 pasted |
| REQ-OPS-RUN-03 | AC-03 | PROPOSED_CHANGES.md — allowlist renderer for doctor output | `verify-ops`/scripted grep — 0 secret hits, `~`-collapsed paths |
| REQ-OPS-RUN-04 | AC-03 | PROPOSED_CHANGES.md — C3 report-only path (no signal reachable) | doctor on held port — exit 3, hint text, listener still alive |
| REQ-OPS-RUN-05 | AC-04 | PROPOSED_CHANGES.md — `--migrate --dry-run` plan mode | dry-run artifact + source byte-count before/after |
| REQ-OPS-RUN-06 | AC-05 | PROPOSED_CHANGES.md — backup step gate | migration log order + backup path/size |
| REQ-OPS-RUN-07 | AC-05, AC-06 | PROPOSED_CHANGES.md — copy + canary round-trip + volume retain | save→restart→search output; `docker volume ls` before/after |
| REQ-OPS-RUN-08 | AC-07 | PROPOSED_CHANGES.md — abort/rollback handling | induced-failure run — `MIGRATE ABORT`, unchanged source |
| REQ-OPS-RUN-09 | AC-08, AC-09 | PROPOSED_CHANGES.md — no suite/CI change (or declared Helix-free step) | per-command bar; `git diff .github/` empty; gitleaks run |
| REQ-OPS-RUN-10 | AC-10, AC-11, AC-15 | PROPOSED_CHANGES.md — `TEST_MATRIX.md` new `## P4 OPS` section | rows T-P4OPS-* per REQ + KR1/KR2/KR3 blocks |
| REQ-OPS-RUN-11 | AC-12 | PROPOSED_CHANGES.md — evidence discipline declaration block | ports/instances/window/session-budget block in TEST_MATRIX |
| REQ-OPS-RUN-12 | AC-14 | PROPOSED_CHANGES.md — optional `scripts/verify-ops.ts` + script entry | verify-ops PASS/FAIL outputs pasted |
| REQ-OPS-RUN-13 | AC-13 | PROPOSED_CHANGES.md — stop ownership resolution (PID file + toml name) | stop log naming PID + instance; `helix status dev` unchanged |
| REQ-OPS-RUN-14 | AC-13 | PROPOSED_CHANGES.md — forbidden-kill static guard + snapshots | proofs (i)–(iv) in TEST_MATRIX |
| REQ-OPS-RUN-15 | AC-11 | PROPOSED_CHANGES.md — README P4 operations section | README heading + line anchor in TEST_MATRIX |

## 8. Risks & Assumptions

**Risks**

- **R1 — Helix instance name vs slot mapping ambiguity (Medium).** Slot 1 rides the existing
  `dev` instance (`helix.toml [local.dev]`, port 6969); slots N ≥ 2 depend on
  `helix add local --name slotN` writing `[local.slotN]`. If the mapping is guessed instead
  of read from `helix.toml`/PID-file state, `stop` could target the wrong instance —
  precisely the never-kill failure. Mitigation: REQ-13 binding is config-derived, name
  printed before any signal; ambiguity → fail closed, no signal.
- **R2 — Parallel-lane contract divergence (Medium).** SPEC-P4-OPS (engineering, same
  brief) may define different `doctor` exit codes/precedence or a stricter REST check.
  Default: this spec's §4a is the operational contract; any divergence is escalated to the
  orchestrator for reconciliation BEFORE implementation — never silently merged.
- **R3 — Shared-instance evidence collision (Medium).** KR1 `helix-down` (exit 4) and KR3
  restart evidence require stopping/restarting Helix, which would break the parallel
  lane's live runs (real incident class: `TEST_MATRIX.md:62`). Mitigation: declared
  exclusive live windows (REQ-11), max 2 lanes (INV-006).
- **R4 — `HELIX_DATA_DIR` unsupported by Helix v0.0.6 (High, declared by brief §7).**
  If the CLI ignores the variable, migration cannot complete losslessly. Fail-closed
  abort (REQ-08) is the mitigation; the fallback framing 3b (data-dir for new instances
  only) is an orchestrator decision, not an in-lane improvisation.
- **R5 — PID-reuse TOCTOU in `stop` (Low).** Cmdline re-verification narrows but cannot
  fully eliminate the race between check and signal. Accepted residual: window is
  milliseconds, target PIDs are freshly spawned children; documented, not silently passed.
- **R6 — Evidence run hygiene (Low).** `verify-env` requires live Helix at 6969
  (`scripts/verify-env.ts:33-35`); running it inside a restart window yields a REAL
  failure. Also each `verify` run consumes +17 Session nodes (budget 25 —
  `docs/CONTRACT.md` §5). Both declared in the evidence section (REQ-11).

**Assumptions**

- **A1 — CI unchanged except possibly an added evidence section/step.** Default: zero
  `.github/workflows/ci.yml` changes (HARD: no new deps, suites green). An added step must
  be Helix-free and declared (AC-09).
- **A2 — doctor's REST check is presence-conditional** (pre-flight reading of brief §3.1
  "healthz de Helix y REST del slot": nothing listening on a free slot port = pre-start
  INFO, not a failing verdict). Invalidated if SPEC-P4-OPS defines the REST check as
  unconditional — then the orchestrator reconciles and a `server-down`-equivalent mapping
  must be decided (not invented in-lane).
- **A3 — slot 1 = existing `dev` instance; slot N ≥ 2 = `slotN`** via
  `helix add local --name slotN` (brief §3.3); quartet port math is SPEC-P4-OPS's, consumed
  here only as "the slot's four ports".
- **A4 — "upstream" = any foreign PID on a slot port** (typically the real `agentmemory`
  on `3111/3112/3113` — `README.md:471-474`); never-kill applies regardless of identity,
  so the runbook does not need to fingerprint the holder.
- **A5 — TEST_MATRIX "P4 OPS" section is mandatory; `verify-ops` script is optional**
  (preferred mechanization, never a substitute for the evidence rows).
- **A6 — README P4 section (REQ-15) is written by the implementation lane** during
  execute-spec; this spec only fixes its required content and evidence anchor.
