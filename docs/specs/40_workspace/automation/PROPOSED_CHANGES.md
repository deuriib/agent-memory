# Proposed Changes: general(espinoza) — Automation & Ops Owner

**Spec Reference:** SPEC-003-brainy-ops — `docs/specs/20_backlog/SPEC-003-brainy-ops.md#REQ-BRAINY-OPS-01..06+NFR-BRAINY-OPS-01`
**Brief Reference:** `docs/briefs/BRIEF-brainy.md` (architectural-initiative, approved 2026-09-25) + `docs/briefs/OKR-brainy.md` (O1 KR1.1 atomic rename & 1-version alias, O3 KR3.1-3.2 ops control plane & slots)
**Contract Reference:** `docs/specs/10_design/ARCHITECTURE.md` §1 CLI surface, §2 Slot derivation, §3 Derived env, §4 State file, §5 Doctor verdicts (singleton canonical v3)
**Agent:** general(espinoza) — Automation & Ops Owner (R8)
**Date:** 2026-09-25
**Execution_Mode:** subagents (inherited from spec; max 2 parallel lanes INV-006 — this lane is R8)
**Domains-Touched:** [automation/ops (R8, owner) · engineering (R1, interface) · marketing/brand (R5, interface) · security (R2, interface) · legal/privacy (R4, interface)]
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-003-brainy-ops.md#REQ-BRAINY-OPS-01..06+NFR-BRAINY-OPS-01 / HARD:subagents+max2lanes+no-secrets+alias1version+never-kill-3111+zero-impl-edits / GATE:none-yet / DOMAINS:R8,R1,R5,R2,R4`

---

## Summary

This proposal establishes the operational and automation changes required to implement **Brainy Ops** under `SPEC-003-brainy-ops`. The changes rebrand the ops control plane CLI from `agent-memory` to `brainy` by introducing `bin/brainy.mjs` as the canonical standalone executable (Node >=20 ESM, `node:` builtins only, zero external dependencies) while providing a 1-version backwards-compatible shim in `bin/agent-memory.mjs` that emits a single-line stderr deprecation notice (`WARN deprecated use brainy — agent-memory alias will be removed in next major`). 

The proposal preserves deterministic quartet slot derivation `R(N)=3111+3(N-1)` and `H(N)=6969+(N-1)` with reserved address space `R+1/R+2` never bound and never signaled. It enforces strict process identity checks (`verifyOwnedPid` via `/proc/<pid>/cmdline` and `cwd === ROOT`) prior to both SIGTERM and SIGKILL, preserves the non-negotiable **never-kill** invariant protecting upstream ports 3111/3112/3113 (iii/agentmemory), implements secure state management (`~/.local/share/brainy/state/slot-<N>.json` with mode `0700` dir and `0600` file outside `HELIX_DATA_DIR`), supports `BRAINY_*` canonical environment variables with `AGENT_MEMORY_*` fallbacks and warning emission, provides a 5-check read-only `doctor` command with strict precedence `5 > 4 > 3 > 1 > 0`, enforces fail-closed migration (`MIGRATE ABORT: unsupported-runtime` per probe A3), and expands `scripts/verify-ops.ts` into a complete verification harness. Under the Frame→Ship methodology, zero implementation files are edited during this proposal phase.

---

## Changes

| Target | Change Type | Description |
|--------|-------------|-------------|
| `bin/brainy.mjs` | `file-create` | Author the canonical operational control plane CLI for Brainy (Node >=20 ESM, `node:` builtins only, zero external dependencies per INV-001). Implements pure slot derivation `R(N)=3111+3(N-1)`, `H(N)=6969+(N-1)`, reserved `R+1/R+2` never-bind/never-signal, and `NEVER_BIND=[3111,3112,3113,3151,6969]`. Implements fail-closed argument parser for subcommands `start`, `stop`, `status`, `doctor` (+ `--help`, exit 2 on unknown flag/cmd). Implements secure state file management at `<parent-of-data-dir>/state/slot-<N>.json` (`0700` directory, `0600` file) with closed JSON schema `{ slot, pids: { rest, helix }, helixInstance, dataDir, startedAt, cliVersion }` and audit logging (`state/audit.log` `0600`). Implements `start` lifecycle with path safety checks (rejecting system roots and `$HOME` itself per C4), preflight port inspection (refusing foreign port occupants with exit 1 and two-line `neverKillHint()`), Helix instance startup, detached server child spawn with derived environment (`BRAINY_PORT`, `BRAINY_URL`, `HELIX_URL`, `BRAINY_DATA_DIR`, stripped secrets for Helix), 30s readiness polling over `HELIX_URL/healthz` + `BRAINY_URL/memory/livez` and `/v1/livez`, and rollback terminating only current invocation's tracked child. Implements `stop` with `instanceBinding` lookup from `helix.toml`, `verifyOwnedPid` before SIGTERM and re-verified immediately before SIGKILL (`security C10/S-010`), named `helix stop <instance>`, state removal, and idempotent exit 0. Implements read-only `status` reporting health, collapsed `$HOME` paths, and bearer flags (`armed|unset`) without ever printing secret values (INV-004/INV-009). Implements read-only `doctor` executing checks C1..C5 with precedence `5 > 4 > 3 > 1 > 0`, single `VERDICT:` line, and C2 foreign-listener authorization protection. Implements `--migrate` fail-closed abort (`MIGRATE ABORT: unsupported-runtime`) per probe A3. Grounded: `docs/specs/20_backlog/SPEC-003-brainy-ops.md:25-50,69-129` and `docs/specs/10_design/ARCHITECTURE.md:40-105`. |
| `bin/agent-memory.mjs` | `file-modify` | Transform the existing 1379-line monolith into a 1-version backwards-compatible deprecation shim delegating to `bin/brainy.mjs`. Emits a single deprecation notice to stderr on every invocation (`WARN deprecated use brainy — agent-memory alias will be removed in next major`), passes all arguments through to `bin/brainy.mjs` synchronously or via child process execution, and mirrors exit codes (0, 1, 2, 3, 4, 5). Ensures zero feature divergence between binaries while establishing the deprecation window required by HARD constraint `alias1version`. Grounded: `bin/agent-memory.mjs:1-1379`, `SPEC-003-brainy-ops.md:27-28`, `ARCHITECTURE.md:54`. |
| `package.json` | `file-modify` | Update the package executable declaration in the `"bin"` map (lines 14–16) to register `"brainy": "./bin/brainy.mjs"` as canonical primary alongside backwards-compatible `"agent-memory": "./bin/agent-memory.mjs"` alias for 1 version. Coordinate with Engineering (R1) and Brand (R5) package metadata updates (`"name": "brainy"`). Grounded: `package.json:14-16`, `SPEC-003-brainy-ops.md:27-28`. |
| `scripts/verify-ops.ts` | `file-modify` | Update and expand ops verification test suite (lines 1–301) to validate Brainy control plane: (1) target `bin/brainy.mjs` as primary executable under test; (2) add Section A2 validating `bin/agent-memory.mjs` stderr deprecation warning emission; (3) test slot derivation `R(N)=3111+3(N-1)` and `H(N)=6969+(N-1)` for slots 1..20, verifying reserved ports `R+1/R+2` are never bound and 3151 is never derived as primary; (4) verify preflight refusal on foreign port occupant with exit 1 and `neverKillHint()` output; (5) prove foreign processes holding ports survive `start`, `stop`, `status`, and `doctor` intact; (6) verify state file creation under `~/.local/share/brainy/state/slot-<N>.json` with mode `0700` directory and `0600` file outside data directory; (7) verify doctor checks C1..C5 and strict verdict precedence `5 > 4 > 3 > 1 > 0` with exactly one `VERDICT:` line; (8) verify synthetic secret masking across stdout, stderr, and state files for both `BRAINY_SECRET` and `AGENT_MEMORY_SECRET`; (9) verify `--migrate` fail-closed abort (`MIGRATE ABORT: unsupported-runtime`) without data mutation or backup file creation; (10) prove C1 foreign-listener authorization gating sends zero Authorization headers to foreign HTTP endpoints. Grounded: `scripts/verify-ops.ts:1-301`, `SPEC-003-brainy-ops.md:41-49,59-66`. |
| `helix.toml` | `config-update` | Additive slot configuration: preserve container runtime (`docker`), image (`ghcr.io/helixdb/helixdb:v0.0.6`), storage (`disk`), and dev port `6969` under `[local.dev]`; declare additive stanza `[local.slot2]` with `port = 6970` and `storage = "disk"` to enable multi-slot testing and verification without manual Docker commands or runtime edits. Coordinated with R1 project renaming (`[project] name = "brainy"`). Grounded: `helix.toml:1-17`, `SPEC-003-brainy-ops.md:37,180`. |
| `src/server.ts` | `file-modify` | Operational coordination (R1 interface): update `portInUseHint(port)` (lines 653–661) to reference canonical `BRAINY_PORT` primary alongside legacy `AGENT_MEMORY_PORT` example: `"BRAINY_PORT=3151 npm run dev"` and `"BRAINY_URL=http://127.0.0.1:3151 (example)"` while strictly preserving the non-negotiable instruction: `"if the upstream agentmemory (iii) holds 3111/3112/3113, NEVER kill it"`. Grounded: `src/server.ts:653-661`, `SPEC-003-brainy-ops.md:37,179`. |

---

## Rationale

Each proposed modification traces directly to the requirements and non-functional invariants in `SPEC-003-brainy-ops.md`:

- **REQ-BRAINY-OPS-01 (Bin rename + slot derivation + quartet + reserved never-bind):** Addressed by authoring `bin/brainy.mjs` as the canonical ESM CLI and transforming `bin/agent-memory.mjs` into a deprecation shim emitting the exact warning: `WARN deprecated use brainy — agent-memory alias will be removed in next major`. The pure derivation formula $R(N) = 3111 + 3(N-1)$ and $H(N) = 6969 + (N-1)$ guarantees deterministic non-overlapping port assignments, while $R+1$ and $R+2$ are strictly reserved and never bound or signaled. `NEVER_BIND = [3111, 3112, 3113, 3151, 6969]` provides defense-in-depth against accidental collisions. `package.json` bin mappings provide immediate usability for both binary names.
- **REQ-BRAINY-OPS-02 (Derived env BRAINY_* canonical + AGENT_MEMORY_* alias fallback 1 versión + HELIX_URL quartet):** Addressed by deriving process environment variables without modifying source files. Canonical variables `BRAINY_PORT`, `BRAINY_URL`, `BRAINY_DATA_DIR`, `BRAINY_SECRET`, `BRAINY_TTL_DAYS`, `BRAINY_HOST`, `BRAINY_EMBED_DIM`, and `BRAINY_LLM_PROVIDER` take precedence. Any access to legacy `AGENT_MEMORY_*` variables emits a single-line warning on stderr (`WARN deprecated use BRAINY_*`). Child process spawns isolate sensitive credentials: Helix child spawn strips secrets, and REST server spawn receives derived ports and URLs without `HELIX_DATA_DIR` (fail-closed per probe A3).
- **REQ-BRAINY-OPS-03 (State file sibling of data-dir, 0700/0600, outside HELIX_DATA_DIR, closed schema, never secret/PII):** Addressed in `bin/brainy.mjs` by locating state files at `<parent-of-data-dir>/state/slot-<N>.json` (default `~/.local/share/brainy/state/slot-<N>.json`). Directories are enforced at mode `0700` and files at mode `0600`. The schema is closed to `{ cliVersion, dataDir, helixInstance, pids, slot, startedAt }`; any extraneous keys cause fail-closed invalidation. State files never contain secrets, memory text, or PII (INV-004, INV-007).
- **REQ-BRAINY-OPS-04 (Lifecycle start/stop/status with pre-flight, never-kill, readiness 30s, idempotence):** Addressed in `bin/brainy.mjs` by enforcing rigorous preflight safety checks. System roots and `$HOME` itself are rejected for data directories. The quartet ports ($R, R+1, R+2, H$) are probed; any foreign listener triggers start refusal with exit 1 and the canonical `neverKillHint()`. Process termination in `stop` requires `verifyOwnedPid` (cmdline containing `src/server.ts` and `cwd === ROOT`) both before SIGTERM and again immediately before SIGKILL (`security C10/S-010`). Readiness gates poll `HELIX_URL/healthz` and REST endpoints `/memory/livez` and `/v1/livez` for up to 30 seconds before committing state. Status reporting is strictly read-only, collapsible, and secret-masked.
- **REQ-BRAINY-OPS-05 (Doctor 5 checks + VERDICT precedence 5>4>3>1>0 + one VERDICT line + read-only):** Addressed by implementing `cmdDoctor` in `bin/brainy.mjs` executing checks in the canonical order: `C1 helix-healthz → C3 ports → C2 rest-health → C4 secret-presence → C5 storage-data-dir`. C2 is gated behind proven port ownership in C3, ensuring that zero Authorization headers are ever transmitted to foreign or unverified listeners. Doctor emits exactly one `VERDICT:` line with deterministic precedence `5 > 4 > 3 > 1 > 0` and exits with matching code (0, 1, 3, 4, 5).
- **REQ-BRAINY-OPS-06 (Migration backup 0600 fail-closed + data-dir precedence + CI/CD gates no-secrets never-kill):** Addressed by implementing fail-closed `--migrate` aborts in `bin/brainy.mjs`. Because probe A3 confirmed Helix CLI 3.3.0 does not forward `HELIX_DATA_DIR`, all migration paths abort with `MIGRATE ABORT: unsupported-runtime` without writing backups or modifying disks. CI/CD integration in `scripts/verify-ops.ts` validates that no secrets leak, never-kill guarantees hold, and all gate criteria pass.
- **NFR-BRAINY-OPS-01 (Never-kill 3111/3112/3113 + never-bind + no secret printing):** Enforced across `bin/brainy.mjs` and `scripts/verify-ops.ts`. Upstream ports 3111, 3112, and 3113 are never signaled under any circumstances. No CLI subcommand ever outputs secret values; presence is indicated exclusively via boolean flags (`bearer: armed|unset`). Output strings are constrained to single-line sanitized text (CWE-117 protection).

---

## Alternatives Considered

| Alternative | Reason Rejected |
|-------------|-----------------|
| **Hard breaking cut: immediate removal of `bin/agent-memory.mjs` and `AGENT_MEMORY_*` env vars** | Violates HARD rule `alias1version` and BREAKS existing operational workflows, CI jobs, and developer scripts; 1-version dual-bin deprecation provides a clean migration path. |
| **Direct bash/shell script wrapper for `bin/brainy.mjs`** | Violates cross-platform portability across Linux, macOS, and Windows environments; Node.js ESM builtins provide deterministic execution without external shell dependencies. |
| **Adding external CLI libraries (e.g. `commander`, `yargs`, `chalk`)** | Violates INV-001 (`zero new dependencies`); builtin Node.js modules (`node:child_process`, `node:fs`, `node:net`, `node:os`, `node:path`) are sufficient for robust, secure, and fail-closed argument parsing. |
| **In-place destructive migration of legacy data directories** | Probe A3 proved that Helix CLI 3.3.0 does not bind or forward `HELIX_DATA_DIR`; attempting data migration without runtime support risks silent data loss or database corruption. Fail-closed abort is mandatory. |
| **Killing foreign port holders via `fuser -k` or `pkill` to reclaim ports** | Strictly violates HARD constraint `never-kill-3111` and INV-003; killing foreign processes could terminate upstream production instances of `agentmemory` (`iii`) or other vital system services. Preflight refusal with `neverKillHint()` is required. |
| **Sending bearer tokens unconditionally during `doctor` REST health checks** | Exposes secrets to rogue foreign listeners bound on the REST port; gating C2 health checks behind C3 process ownership verification (`verifyOwnedPid`) prevents credential theft. |

---

## Approval Required From

- [ ] **Owning Domain Owner:** general(espinoza) — Automation & Ops Owner (R8) *(mandatory, operational standards, runbook integrity, slot governance, toil elimination)*
- [ ] **Engineering Owner:** general(vasquez) — Engineering Owner (R1) *(mandatory, architecture contract alignment, REST/Helix interfaces, package.json entrypoints)*
- [ ] **Security Owner:** general(barrera) — Security Owner (R2) *(mandatory, never-kill invariants, secret masking, C1 authorization header proof, 0700/0600 permission model)*
- [ ] *Coordinating Review (non-blocking for proposal authoring):* general(vera) — Marketing Owner (R5) *(CLI rename and deprecation copy consistency)*; general(subero) — Legal Owner (R4) *(Ley 172-13 privacy invariants, data minimization in audit logs)*

> **Rule:** No repository file modifications during proposal phase. For non-code domains, no external sends/filings/launches during proposal phase either. This proposal authors documentation only; zero implementation files are modified.

---

## Risk Assessment — SPEC-003-brainy-ops

**Proposer:** general(espinoza) — Automation & Ops Owner (R8)  
**Date:** 2026-09-25  
**Domains-Touched:** automation/ops (R8, owner) · engineering (R1) · marketing/brand (R5) · security (R2) · legal/privacy (R4)

### Risk Matrix

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R-001** | Port collision on slot derivation ($R(N)$ or $H(N)$ occupied by foreign non-Brainy process) | Medium | High | Fail-closed preflight port probe refusing startup with exit 1; display actionable `neverKillHint()` with reroute port example `BRAINY_PORT=3151`; never signal or kill foreign processes. |
| **R-002** | Accidental termination of upstream production services (`agentmemory`/`iii` on 3111/3112/3113) | Low | Critical | Strict `verifyOwnedPid` check validating `/proc/<pid>/cmdline` contains `src/server.ts` and `cwd === ROOT` before SIGTERM and re-verified immediately before SIGKILL; absolute prohibition on scanning/killing by port. |
| **R-003** | Data loss or corruption during migration attempt under unsupported runtime | Medium | Critical | Fail-closed abort (`MIGRATE ABORT: unsupported-runtime`) triggered immediately on `--migrate`; zero disk writes or directory moves; MinIO/disk volume retained untouched. |
| **R-004** | Divergence or functional discrepancy between `bin/brainy.mjs` and legacy `bin/agent-memory.mjs` shim | Low | High | `bin/agent-memory.mjs` acts purely as an argument pass-through wrapper delegating directly to `bin/brainy.mjs`; verified by automated parity tests in `scripts/verify-ops.ts`. |
| **R-005** | Credential leakage (`BRAINY_SECRET` / `AGENT_MEMORY_SECRET`) via CLI logs, stdout/stderr, or HTTP probes | Low | Critical | Strict secret hygiene: CLI outputs `bearer: armed|unset` flag only, never token values; foreign listeners receive 0 HTTP requests and 0 Authorization headers; secrets stripped from Helix child spawn. |
| **R-006** | State file tampering or unauthorized read of PID metadata | Low | Medium | Strict permission enforcement: state directory created with mode `0700`, state file written with mode `0600`; closed JSON schema rejecting unauthorized or extraneous fields. |
| **R-007** | Orphaned child processes following abrupt terminal disconnect or SIGINT | Medium | Low | Detached child process logging to dedicated slot log file `state/slot-<N>.log`; tracked PID recorded in state file allowing clean idempotent recovery via `brainy stop --slot N`. |

### Blast Radius

- **Systems:** Local host networking and port space (ports 3111–3170, 6969–6988); local filesystem directories (`~/.local/share/brainy/` and `/tmp/`); local HelixDB container instances spawned via Docker. Upstream systems on 3111/3112/3113 are completely shielded and isolated by never-kill guarantees.
- **Teams:** 
  - **Automation/Ops (R8):** Maintains CLI lifecycle scripts, slot allocation policies, runbooks, and CI/CD verification harnesses.
  - **Engineering (R1):** Consumes derived environment variables (`BRAINY_PORT`, `HELIX_URL`, `BRAINY_DATA_DIR`) and provides REST endpoints (`/livez`, `/memory/health`).
  - **Security (R2):** Audits token handling, process signal boundaries, and verification test proofs.
  - **Brand/Marketing (R5):** Manages external deprecation communication and documentation references.
  - **Legal/Privacy (R4):** Ensures audit logs and state files adhere to Ley 172-13 data minimization standards.
- **Customers / Users / Agents:** AI coding agents (Claude Code, OpenCode, Cursor) and human developers executing local workflows. Backwards-compatible `agent-memory` shim and `AGENT_MEMORY_*` environment fallbacks prevent any workflow interruption during the 1-version deprecation window.
- **Regulators / Legal:** Ley 172-13 privacy standards are preserved: state files and audit logs record only execution metadata (slot, timestamp, status, PID), never memory content, user prompts, or PII.
- **Revenue / Commercial:** Internal developer tooling infrastructure. No direct revenue impact; protects developer velocity and prevents costly accidental outages on co-located services.

### Rollback Plan

- **Code Revert:** Revert implementation commits via `git revert <commit-hashes>` (owner: general(espinoza), execution time < 10 minutes).
- **Binary Fallback:** Restore `bin/agent-memory.mjs` as primary executable and point `package.json` `"bin"` map to `bin/agent-memory.mjs`.
- **State File Cleanup:** Existing state files under `~/.local/share/brainy/state/` can be safely removed or migrated back to `~/.local/share/agent-memory/state/` if necessary. State schema is backward-compatible.
- **Process & Port Release:** If a rolled-back process remains active, run `node bin/agent-memory.mjs stop --slot <N>` to cleanly shut down tracked REST and Helix processes without touching foreign ports.
- **Verification After Rollback:** Execute `npm run verify-ops` and `npm run typecheck` to confirm system returns to green baseline.

### Security Considerations

- **Non-Negotiable Never-Kill Invariant:** To prevent operational catastrophes, no process is ever signaled unless its PID is tracked in the slot state file and verified via `verifyOwnedPid` (`/proc/<pid>/cmdline` contains `src/server.ts` and `cwd === ROOT`). Signals to ports 3111, 3112, 3113 are prohibited unconditionally.
- **Secret Masking & Sanitization:** Neither `BRAINY_SECRET` nor `AGENT_MEMORY_SECRET` is ever printed, echoed, or logged. Status and doctor subcommands report boolean presence flags (`bearer: armed|unset`). Output lines are sanitized to single-line bounded strings (max 400 chars) to prevent CWE-117 log injection.
- **Credential Protection in Probes (Security C1 / S-001):** The `doctor` command never sends an HTTP `Authorization` header to an unverified or foreign listener. C2 REST health checks execute only if C3 port probes prove the listener PID is owned by the current slot.
- **Child Spawn Secret Stripping:** The Helix child process spawn environment explicitly strips authentication secrets, passing only necessary configuration.
- **Filesystem Permissions (Security C3 / S-012):** State directories are created mode `0700` (`rwx------`) and state files are written mode `0600` (`rw-------`) to prevent unauthorized local user inspection.
- **Path Refusal Set (Security C4 / S-004):** Data directories pointing to system roots (`/`, `/etc`, `/usr`, `/var`, etc.) or `$HOME` itself are strictly rejected during startup and migration.

### Domain Considerations

- **Automation/Ops (R8):** Guarantee deterministic CLI behavior, zero unhandled exceptions, zero external dependencies, robust preflight error messaging, and automated CI test execution.
- **Engineering (R1):** Ensure complete alignment with `ARCHITECTURE.md` §1–§5, verify child server receives required derived environment, and maintain dual-endpoint readiness polling (`/memory/livez` and `/v1/livez`).
- **Security (R2):** Enforce constant vigilance regarding secret masking, process ownership verification before signaling, and strict adherence to the never-kill policy.
- **Brand/Marketing (R5):** Ensure deprecation notices on stderr provide clear, helpful, and non-disruptive guidance for developers transitioning to `brainy`.
- **Legal/Privacy (R4):** Maintain strict data minimization in state and audit logs, ensuring compliance with Ley 172-13.

---

## C2 Challenge Hook Trigger Analysis (REQ-002)

### Trigger Checklist

| Trigger Condition | Triggered? | Evidence / Reason |
|-------------------|------------|-------------------|
| **Auth / data / API / PII surface touched** | **YES** | Manages `BRAINY_SECRET` and `AGENT_MEMORY_SECRET` resolution, child environment injection, bearer presence reporting, HTTP health probes, and filesystem state storage. |
| **Multi-domain scope** | **YES** | Touches 5 domains: Automation/Ops (R8, owner), Engineering (R1), Marketing/Brand (R5), Security (R2), and Legal/Privacy (R4). |
| **Blast radius mentions customers / regulators / revenue** | **YES** | Blast radius explicitly evaluates impact on developers/agents (customers/users), Ley 172-13 privacy standards (regulators), and engineering productivity (commercial impact). |
| **Approver request** | Pending | Owning domain owner or peer reviewers may explicitly request a challenge pass. |

**Verdict:** The C2 Pre-Approval Challenge Round is **TRIGGERED** on multiple independent criteria.

### One-Pass Challenge Budget & Rules

- **Budget:** Exactly one budgeted challenge round per trigger pass consisting of **≤ 3 questions**. Asking a 4th question (N+1) is an explicit methodology violation and will result in an immediate automated **FAIL**.
- **Re-challenge Cap:** An approver may request at most one additional challenge round (total ≤ 2 passes). If unresolved issues remain after 2 passes, the decision is escalated directly to Orchestrator (`Montilla`).
- **Masking Reminder:** All challenge interactions, logs, and evidence exports must strictly adhere to the people SPEC §4 privacy clause:  
  > *"Por tu privacidad: no compartas PII/secretos/tokens en esta ronda; enmascaramos todo export (Ley 172-13)."*
- **Terminal Decision:** Following the challenge round, the proposal receives a terminal **Approve** or **Reject**. If an exit is initiated prior to a decision, the proposal is recorded as `grill: exited` and remains unapproved (no silent promotion).
- **Untouched Invariant:** All repository implementation files remain completely untouched throughout the proposal and challenge process.
