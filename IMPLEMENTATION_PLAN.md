# Implementation Plan: SPEC-P4-OPS (P4 ops control plane — CLI + slots + data dir)

**Agent:** vasquez (Engineering Owner R1, execute-spec lane)
**Date:** 2026-09-24
**Approved By:** orchestrator reference-only packet
(`SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` /
`HARD:subagents+<zero new deps (node: builtins only), frozen src/**,db/**,hooks/**,plugins/**,
default REST 3111 untouched, package.json only gains bin+verify-ops, never kill upstream,
no secret/PII in any output>` /
`GATE:security-Conditional-C1+C2-applied-in-spec+architecture-Approved-with-conditions` /
`DOMAINS:R1 (cross R8 runbook, R2 security conditions)`):
implement the approved change rows of `PROPOSED_CHANGES.md` ONLY — one new CLI binary, one new
evidence harness, two `package.json` rows, lane-singleton doc rows. Scope is EXACTLY the approved
proposal; any delta is a cross-domain request to the orchestrator, never in-lane improvisation.
**Domains-Touched:** engineering (R1, owner) · automation/ops (R8 — runbook contract consumed by
name, evidence rows) · security (R2 — C1..C10 conditions implemented as code behavior).

**Prior plan content:** the REQ-RL-001 + REQ-F-01 residual-closure plan (2026-09-23, gate
RL001-F01 remediation 2026-09-24) is replaced in place per the lane-singleton rule; its full
text and evidence log are preserved in git history (`git log -p -- IMPLEMENTATION_PLAN.md`).
Prior lanes: P0 closed, P1.1/P1.3/P1.6 + P2.1 closed at v0.4.0, P1-remainder + P3.2 at v0.5.0,
P2-completion at v0.6.0, RL-001/F-01 at v0.7.1.

## Step 0 — falsifiable probe A3 (before any code) — **DONE, verdict FAIL**

Question: does `helix start` forward `HELIX_DATA_DIR` into the container?

| Probe | Result |
|-------|--------|
| `helix status` | `dev (local): http://localhost:6969 - Up - storage: disk` (baseline confirmed) |
| installed CLI | `/home/deuriib/.local/bin/helix`, ELF, Helix CLI **3.3.0** |
| binary scan | `HELIX_DATA_DIR` = **0 occurrences**; `data_dir`/`datadir`/`DATA_DIR` case-insensitive = **0** |
| env names the CLI does read | `HELIX_HOME`, `HELIX_CACHE_DIR`, `HELIX_URL`, `HELIX_TELEMETRY_*`, `S3_BUCKET`, `S3_REGION`, `DB_PATH`, `AWS_*` — no data-dir variable |
| `helix start --help` | no `--data-dir` flag (`--port --disk --storage-uri --s3-* --image-version --pull --persist` only) |
| `docker inspect helix-agent-memory-dev` | env = `DB_PATH=db/`, `S3_BUCKET=helix-db`, `AWS_ENDPOINT=...minio:9000`, … — **no `HELIX_DATA_DIR`**; `Mounts: []`; **no generic env passthrough** (no `HOME`/`USER`/`LANG`/`SHELL`) |
| volumes | only `helix-agent-memory-dev-minio-data` (MinIO named volume) |
| skill grounding | `helix-cli/SKILL.md:29-32` + `EXAMPLES.md:34-54`: `HELIX_DATA_DIR` is **direct-Docker** mode, mutually exclusive with `S3_BUCKET`, managed with `docker`, not the CLI |

**Verdict: A3 FAILS.** `helix start` on CLI 3.3.0 does not forward `HELIX_DATA_DIR`.
Consequence (per packet, reversible call): **P4.4 data-dir forwarding + migration is STOPPED**;
`--migrate` fails closed with `MIGRATE ABORT: unsupported-runtime`; `--data-dir` survives only as
the state-path input (REQ-07 precedence) and `HELIX_DATA_DIR` is never set. P4.1 (CLI) +
P4.3 (slots) implement in full. KR3 is NOT claimed — "A3 failed → brief framing 3b" reported to
the orchestrator for decision.

## Steps

| Step | Description | Target / Files | Evidence Location | Est. Effort |
|------|-------------|----------------|-------------------|-------------|
| 1 | Probe A3 (above) — recorded before any code | read-only: `helix status`, binary scan, `docker inspect`, skill docs | this plan §Step 0 + return report | S |
| 2 | `bin/agent-memory.mjs` — Node ≥20 ESM, `node:` builtins only. Fail-closed arg parsing (unknown subcommand/flag, invalid `--slot`, flag not allowed for the subcommand → usage on stderr, exit 2; `--help` → stdout, exit 0). Slot math `R(N)=3111+3(N−1)`, `H(N)=6969+(N−1)`, reserved `R+1`/`R+2` never bound, derived ports ≤65535 else exit 2. Subcommands: `start` (pre-flight quartet refuse + NEVER-kill hint + exit 1 no signal; idempotent already-running exit 0 (**C5**); `helix add local --name slotN --port H(N)` once for N≥2 then `helix start <instance>` never the config-rewriting flag; spawn absolute `npx tsx src/server.ts` with §4.3 env, secret only to that child (**C8**); 30 s readiness gate = Helix `/healthz` + our `/memory/livez`; write state 0600 in 0700 `state/`), `stop` (schema validate → re-derive `helixInstance` from `helix.toml [local.*]` → `verifyOwnedPid()` pre-SIGTERM **and again pre-SIGKILL** (**C3/C10**) → bounded grace → `helix stop <instance>` → remove state → audit line (**C6**); idempotent exit 0; stale/mismatch = `stale-pid` note + exit 1, no signal), `status` (read-only quartet/probes/data-dir/`bearer: armed|unset`, never an `Authorization` header, 401 = armed not degraded (**E-3**), exits 0/1/2), `doctor` (checks in order **C1→C3→C2→C4→C5**, one `PASS\|FAIL\|INFO <check-id>` line each + exactly one `VERDICT: <name>`, precedence `5>4>3>1>0`, exits 0/1/2/3/4/5; C2 runs only after C3 verifies slot-owned — foreign listener receives **zero** requests (**C1**); C4 presence-only; C5 table-scoped `helix.toml` parse; `--migrate` = `MIGRATE ABORT: unsupported-runtime` (A3) with audit line on `--apply`, never a write). Shared: one allowlist renderer for all child/error text (oneLine + `$HOME`→`~`, exit codes + static hints only) (**C7**), `verifyOwnedPid()` shared by stop/doctor, path refusal set for `--data-dir`/`--backup-dir` (`/`, system roots, `$HOME` itself; explicit paths under `$HOME` or `/tmp` only) (**C4**), forbidden primitives absent from source (NFR-A) | `bin/agent-memory.mjs` | `scripts/verify-ops.ts` §A–§L + session output | L |
| 3 | `scripts/verify-ops.ts` — evidence harness in `verify-env.ts` house style (sections, `check()`, counters, `VERIFY PASS/FAIL`, exit 0 only on all-pass, children reaped in `finally`, synthetic-secret leak assertion). Sections A–L per SPEC §3; never binds `3111/3112/3113/3151/6969`, never restarts Helix dev; live-slot checks gated on a running slot and reported `DEFER` with a declared window instead of a silent downgrade; foreign-listener header capture proves C1 (zero requests + zero `authorization`); `stat` mode checks prove 0600/0700 | `scripts/verify-ops.ts` | harness output (counts pasted to TEST_MATRIX) | M |
| 4 | `package.json` — add ONLY `"bin": {"agent-memory": "./bin/agent-memory.mjs"}` and `"verify-ops": "tsx scripts/verify-ops.ts"`; `package-lock.json` untouched | `package.json` | `git diff package.json` (§A asserts the diff shape) | S |
| 5 | Declared slot-2 live window (no dev restart): `start --slot 2` → `doctor` healthy → `remember`/`search` round-trip on 3114 → synthetic-secret + induced-C5 runs → `stop --slot 2` → idempotent → ports free → `helix status dev` unchanged. Ports touched: 3114/3115/3116/6970; instances: `slot2` (started+stopped), `dev` read-only probes only | session (containers `helix-agent-memory-slot2*`) | TEST_MATRIX KR1/KR2 rows (verbatim outputs) | M |
| 6 | Quality bar: `npm run typecheck` · `npx tsx scripts/verify-ops.ts` · `npm run verify-env` (21) · `verify-capture` (137) · `verify-lifecycle` (117) · `verify-skills -- --structural` (73) · `npm run verify` (243) against our server on **3151** (never 3111) | repo root | TEST_MATRIX `## P4 OPS` count bar | M |
| 7 | Lane singletons + proposal appendix: `TEST_MATRIX.md` gains the `## P4 OPS` section (REQ-ID \| Evidence ID \| Description \| Type \| Status \| Commit, rows `pending-evidence` until commit), `PROPOSED_CHANGES.md` gains an **Implementation notes** appendix row for the A3 deviation, README ops section stays with the docs lane (report its required content verbatim) | `TEST_MATRIX.md`, `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` | git diff | S |
| 8 | Three Conventional Commits: (1) `bin/` + `package.json`, (2) `scripts/verify-ops.ts`, (3) plan/matrix/appendix rows — each body links REQ-ID → test → artifact | git | `git log` | S |

## Order of Operations

Step 1 (already done) gates step 2: an A3 PASS would have added `HELIX_DATA_DIR` forwarding +
the migrate write path; the FAIL stops both, so step 2 lands P4.1+P4.3 with a fail-closed
migrate stub. Step 3 needs the CLI from step 2. Step 4 must land with step 2 (the `bin` entry
is part of REQ-01). Step 5 (live window) runs after 3 so the harness's deferred live checks go
green in the recorded run, and it never restarts `helix dev`. Step 6 runs before each commit;
step 7/8 land the doc rows last (README/TEST_MATRIX prose owned by the docs lane is reported,
never written here).

## Rollback Points

- **Code revert (reversible, same session, owner R1):** delete `bin/agent-memory.mjs` +
  `scripts/verify-ops.ts`, revert the two `package.json` rows. Nothing in `src/**`, `db/**`,
  `hooks/**`, `plugins/**` references the CLI, so `npm run typecheck` + the five suites are the
  post-revert proof (NFR-E). ETA: immediate.
- **Config undo:** `git checkout -- helix.toml` removes the additive `[local.slot2]` table
  written by the official `helix add local` (config registration, A5); `[local.dev]` is never
  modified, so slot-1 operation needs no restore.
- **Live window undo:** `agent-memory stop --slot 2` stops our server and `helix stop slot2`
  stops only the slot-2 containers; volumes are retained (no prune/delete/volume-rm is reachable
  from this CLI). Upstream `3111/3112/3113` and `helix dev` are never signaled at any point.
- **A3/deferred scope:** no data is moved, no volume is created for migration — the stopped
  P4.4 portion has zero residue by construction.
- **Singleton docs:** plan/TEST_MATRIX revert with their commit; prior plan text recoverable
  from git history.

## Quality Gates

Domain checks (delete non-touched, keep evidence path):

- [ ] Engineering: `npm run typecheck` clean (0 errors) — bin is `.mjs`, outside the TS program
- [ ] Engineering: `npx tsx scripts/verify-ops.ts` — counts pasted in TEST_MATRIX `## P4 OPS`
- [ ] Engineering: regression suites green — `verify-env` (21), `verify-capture` (137),
  `verify-lifecycle` (117), `verify-skills -- --structural` (73), `verify` (243, server :3151)
- [ ] Engineering: `git diff` shows ZERO changes under `src/`, `db/`, `hooks/`, `plugins/`
  and zero `package-lock.json` change
- [ ] Security (R2 conditions as code): C1 ownership-gated bearer · C2 backup posture (migrate
  path stopped by A3 — refusal only) · C3 state 0600/0700 + closed schema + re-derived
  instance + shared `verifyOwnedPid()` · C4 path refusal set · C5 start idempotence ·
  C6 audit lines (stop + migrate-apply) · C7 single allowlist renderer · C8 secret strip +
  absolute child paths · C9 `status` never sends a bearer (E-3) · C10 re-verify before SIGKILL
- [ ] Automation/ops (R8): runbook check list C1..C5, verdict/exit contract §4a, stop ownership
  §4d and forbidden primitives §4d consumed as written; evidence rows ready for R8 sign-off
- [ ] Finance / Legal / Marketing / People / Revenue: N/A — local developer tool, no customer
  surface, no external send/filing, no billing/quota change (PROPOSED_CHANGES blast radius)
- [ ] Docs (docs lane): README ops section + Ley 172-13 backup declaration + KR1/KR2/KR3
  verbatim session evidence — reported verbatim by this lane, never written here

## Evidence Log (updated in place before each commit)

- **Probe A3:** FAIL — see §Step 0 (binary scan + `docker inspect` + `--help` + skill docs).
  Consequence: P4.4 data-dir forwarding + migration STOPPED; `--migrate` fails closed with
  `MIGRATE ABORT: unsupported-runtime`; framing-3b decision escalated to the orchestrator.
