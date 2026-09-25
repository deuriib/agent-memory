# Automation/Ops Review: Brainy v1 (SPEC-003-brainy-ops)

**Reviewer:** automation-reviewer (automation owner, R8 lead) with ops lens
**Date:** 2026-09-25
**Verdict:** conditional
**Findings:** 4 (1 Medium, 3 Low)
**Scope:** REQ-BRAINY-OPS-01..06 + NFR-BRAINY-OPS-01 (+ NFR-01 ops co-sign); commits `7757ac1..HEAD` (HEAD `2211b95`); workdir `/mnt/DATA/GitHub/agent-memory`

## Load Evidence (gate-report HARD STOP)

- [x] Stage skill loaded: `frame-ship:quality-gate` (trigger: implementation ready for review)
- [x] Domain owner/specialist role understood: automation-reviewer per `prompts/automation-reviewer.md` (R8 lead, ops lens); independent — did not write code under review
- [x] Execution mode declared: `subagents` (single-lane review task)
- [x] Reviewer independence verified: automation/ops lens only; no bundled cross-domain verdicts
- [x] Packet intact: `SPEC:docs/specs/20_backlog/SPEC-003-brainy-ops.md#REQ-BRAINY-OPS-01..06+NFR-01 / HARD:subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+never-kill-3111/3112/3113+evidence-allowlist / GATE:pending / DOMAINS:R8 (lead),R1,R2,R5,R4`

## Checklist (automation-review.md)

- [x] Workflow/port/adapter/event boundary mapped (slot quartet R/R+1/R+2/H; NEVER_BIND; state sibling of data-dir)
- [x] Least-privilege scopes verified (bearer only to slot-owned listeners; C2 gated; secret never printed)
- [x] Idempotence + retry budget defined (stop idempotent; start `already running` exit 0; no retry loops in CLI)
- [x] Deployment plan + rollback tested (start readiness 30s + rollback only tracked child; stop SIGTERM→re-verify→SIGKILL)
- [x] Monitoring/alerting + runbook updated (status/doctor read-only probes; SCORECARD reproduce runbook)
- [x] Capacity/scaling reviewed — with condition (see NFR-01 ruling; scale leg not-run)
- [x] No freelance fixes (review-only; zero code changes made)

## Checklist (ops-review.md lens)

- [x] Deployment plan defined (slot-derived `helix start <instance>` + detached server spawn)
- [x] Rollback tested (readiness-fail rolls back tracked child only; stop removes state, `helix stop <named>` only)
- [x] Monitoring/alerting updated (doctor C1–C5 + single VERDICT line; status `helix:up|down/rest:up|down`)
- [x] Runbook updated (`docs/benchmarks/SCORECARD.md` reproduce block; `--help` usage)
- [x] On-call impact assessed (never-kill hint with `BRAINY_PORT=3151` example; fail-closed REFUSE paths)
- [x] Capacity/scaling reviewed — conditioned (NFR-01)
- [x] Feature flags: n/a (single-host slot derivation; no flags needed)

## Actual verification numbers (no carry-over; this lane executed)

| Harness | Result | Exit |
|---|---|---|
| `npx tsx scripts/verify-ops.ts` | **124 passed, 0 failed / VERIFY PASS** | 0 |
| `npx tsx scripts/verify-lifecycle.ts` | **123 passed, 0 failed / VERIFY PASS** | 0 |

Both match the expected bars (124/0 and 123/123). Full-section output observed, including §I never-kill, §J secret non-printing, §L port-parity, C1 header proof (0 Authorization headers to foreign listener), and doctor `C1→C3→C2→C4→C5` order + exactly-one-VERDICT checks.

## OPS-01..06 / NFR AC table

| Req | AC | Result | Evidence |
|---|---|---|---|
| REQ-OPS-01 bin rename + derive | AC-01 | PASS | `bin/brainy.mjs` canonical (68.5K); `bin/agent-memory.mjs` shim (878B) emits `WARN deprecated use brainy` on stderr, exit 0 (executed this lane). Slot math spot-checked live: slot2 → `rest=3114 helix=6970 reserved=3115,3116`; slot9 → `rest=3135 helix=6977 reserved=3136,3137` (= 3111+3·8 / 6969+8 ✓). Slots 2..20 disjointness + slot-30000 exit-2 covered by verify-ops § (124/124). |
| REQ-OPS-02 derived env alias 1 versión | AC-02 | PASS | verify-ops §G: `AGENT_MEMORY_DATA_DIR` reflected + `WARN deprecated use BRAINY_DATA_DIR`; `BRAINY_DATA_DIR` wins over alias with no spurious warning (in 124/124). Known deviation filed elsewhere, not re-litigated here: `src/store.ts:848` reads `HELIX_URL` only (TEST_MATRIX bar #10, cross-domain request to R1). |
| REQ-OPS-03 state file | AC-03 | PASS | verify-ops §G: sibling-of-data-dir, `.../state/slot-N.json`, 0700/0600, secret-free (in 124/124). |
| REQ-OPS-04 start/stop/status | AC-04 | PASS | verify-ops §B/C: foreign-occupant start REFUSE exit 1 + NEVER-kill hint + listener survives; stop idempotent (in 124/124). |
| REQ-OPS-05 doctor 0–5 precedence | AC-05 | PASS | verify-ops doctor matrix (in 124/124). Live spot-check this lane: `doctor --slot 1` emits `C1→C3→C2→C4→C5` in order with exactly one `VERDICT:` line; precedence `5>4>3>1>0` per SPEC §4.5. Port-parity defaults 3111/6969 unchanged. |
| REQ-OPS-06 migration + CI/CD | AC-06 | PASS (fail-closed leg) | verify-ops §: `--migrate --apply --yes still aborts unsupported-runtime`, zero files touched (in 124/124). `MIGRATE ABORT` path present (`bin/brainy.mjs:30,1512`). CI pins gitleaks (see AUT-003). |
| NFR-BRAINY-OPS-01 never-kill + no-secrets | AC-NFR01 | PASS | verify-ops §I (foreign survives all 4 subcommands + static grep: no `helix prune/delete`, `docker rm/volume rm`, `fuser/pkill/killall`, `--persist` ≤2 doc-only) + §J (synthetic secret 0 occurrences, `bearer: armed` flag) + §L (port parity) + C1 header proof (in 124/124). |

## Never-kill before/after proof (3111/3112/3113 — observed, never signaled)

Before verify runs (`ss -ltnp`):

- `127.0.0.1:3111` LISTEN — `iii` pid=952
- `127.0.0.1:3112` LISTEN — `iii` pid=952
- `127.0.0.1:3113` LISTEN — `node` pid=888

After `verify-ops` + `verify-lifecycle` (both executed this lane, both manage their own slot-9 surface; no `helix start/stop` run by reviewer; no HTTP calls to 3111/3112/3113):

- `127.0.0.1:3111` LISTEN — `iii` pid=952 (unchanged)
- `127.0.0.1:3112` LISTEN — `iii` pid=952 (unchanged)
- `127.0.0.1:3113` LISTEN — `node` pid=888 (unchanged)

Same PIDs before and after. Invariant holds. Live doctor spot-check independently corroborates: C3 reports `rest=3111 foreign pid=952 … (report-only)` with the NEVER-kill hint.

## Finding AUT-001 (Medium): `verify-ops` dirties tracked `helix.toml` on every run

- **Severity:** Medium (process/toil — not prod impact; no data loss; no secret exposure)
- **Location:** `scripts/verify-ops.ts:28` (`SLOT_FOREIGN = 9`) → `bin/brainy.mjs` `cmdStart` helix-add path (`bin/brainy.mjs:1010-1035`: `helix add local --name slot9 --port 6977` + `storage="disk"` patch)
- **Proof (this lane):** after the canonical `npx tsx scripts/verify-ops.ts` run (124/0), `git status --short` showed `M helix.toml`; `git diff -- helix.toml` showed exactly `+6` lines (`[local.slot9] storage=disk port=6977 image/tag`). Tree restored with `git checkout -- helix.toml` → clean (`git status --short` empty). Nothing staged at any point.
- **Owner:** R8 (Automation/Ops — harness + CLI owner)
- **Recommended disposition:** record a **stage-nothing policy** for verification runs (verify-then-restore, as done here) as the accepted standing procedure; do NOT gate Brainy v1 on it. Optional follow-up (proposal, not freelance fix): make `cmdStart` skip `helix add` when a matching `[local.slotN]` stanza already exists, or move the verify slot stanza to a gitignored overlay — to be proposed via `propose-changes`, never patched in gate.
- **Why not higher:** the write is additive, idempotent, fail-closed-adjacent (official `helix add local` registration + `storage="disk"` enforcement per SPEC REQ-OPS-04), and fully reversible; mistaken-for-residue risk is procedural, mitigated by the restore step.

## NFR-01 ruling (ops co-sign)

- **Fact:** `docs/benchmarks/SCORECARD.md:29-44` — p95 **8.68ms < 10ms measured only at N=40**; the `@10k nodes` leg is **not-run** (`scripts/eval.ts` has no scale knob). No waiver is claimed in SCORECARD. Root `TEST_MATRIX.md:207` assigns the FAIL-or-waiver decision to quality-gate.
- **Ruling as ops owner:** **accept the scale proof-or-waiver condition as written** — do not escalate beyond the gate. Rationale: R8's own NFR (NFR-BRAINY-OPS-01) is fully proven (124/124); the 10k-node scale leg is an R1 retrieval guarantee, already conditioned by other reviewers (RL-003/C-QA-02). Ops adds no independent block; the condition rides with the gate's C3 waiver bar (accepted-risk + compensating-controls + expiry, owned at gate level). Recorded here as residual, owned by the gate — not by R8 alone.

## Ops runbook / NFR-OPS-01 / storage / bootstrap notes

- **NFR-OPS-01:** PASS (see AC table; §I/J/L + C1 header proof, all in the 124/124 run).
- **`storage=disk` declarations:** PASS — live `doctor --slot 1` C5 reports `storage: disk`; verify-ops § checks `[local.dev] port 6969`.
- **Bootstrap idempotency / shared-dev `index_definition_conflict vector_dimension`:** SCORECARD documents the lane used a fresh slot9 instance and left shared `dev` :6969 untouched. **Confirm (not contest)** the reliability reviewer's fail-closed accepted-residual: the conflict is pre-existing 384-dim index state, the lane did not touch it, and this reviewer's runs likewise never touched `dev` (slot 9 only). Residual owner: R1 (index lifecycle); R8 concurs fail-closed.
- **TEST_MATRIX path note:** the packet cites `docs/benchmarks/TEST_MATRIX.md`; the file lives at repo root `./TEST_MATRIX.md` (`docs/benchmarks/` holds only `SCORECARD.md`). Minor doc-path drift, no gate impact — NFR rows read from `./TEST_MATRIX.md:99-134,142-216`.

## CLI contract

- **Canonical `brainy`:** `bin/brainy.mjs` + `package.json bin {brainy, agent-memory}` dual entry (commit `53f5588`, `a1e2e89`).
- **Legacy shim 1-version alias:** `bin/agent-memory.mjs` delegates with single-line deprecation on stderr + exit 0 — executed and confirmed this lane.
- **`cmdMove` repoint (ADR-0003-C3, `201b1ee`):** confirmed — `bin/brainy.mjs:1629-1660` `cmdMove` calls `POST /v1/notes/:id/move` with strict body `{to, name, project}` and fail-closed mapping (404 → REFUSE note-not-found; non-200 → apiError; `-1` → apiRefused).
- **`verify-ops.ts` integrity:** `git log 339c511..HEAD -- scripts/verify-ops.ts` is **empty** — untouched since Lane B's expansion (`339c511`); no byte drift to adjudicate.

## Cross-domain queue items (R8)

| # | Item | Status this review |
|---|---|---|
| AUT-002 (Low) | Rename `agent-memory-eval` fixture namespace (`scripts/eval.ts:16,69` + `docs/CONTRACT.md:698,703`; SCORECARD corpus card also uses it) | Open — queued for R8 (with R1/R5 co-sign on copy). Not fixed (review-only). Carried as a gate condition. |
| AUT-003 (info→Low) | Pin `gitleaks` in CI | **Confirmed already satisfied:** `.github/workflows/ci.yml:38-45` pins `gitleaks v8.30.1` binary download (deliberate, with license note). `not-installed` applies only to this sandbox → grep-fallback honesty stands for local runs; CI evidence is the pin. No action. |
| AUT-004 (Low) | `--migrate` still `MIGRATE ABORT: unsupported-runtime` (probe A3, HELIX_DATA_DIR not forwarded; framing-3b decision pending from the user) | Open — recorded as known accepted behavior (fail-closed, zero files touched, proven in-run). Decision owner: user/orchestrator (framing-3b). Not fixed. |

## Findings table

| ID | Severity | Finding | Mitigation / Owner |
|----|----------|---------|-------------------|
| AUT-001 | Med | Canonical `verify-ops` run registers `[local.slot9]` in tracked `helix.toml` (+6 lines), leaving tree dirty every run | Stage-nothing policy (verify-then-`checkout -- helix.toml`); owner R8; optional proposal via `propose-changes` |
| AUT-002 | Low | `agent-memory-eval` fixture namespace not yet renamed (`scripts/eval.ts`, `docs/CONTRACT.md:698,703`) | Gate condition; owner R8 (+R1/R5 co-sign) |
| AUT-003 | Low (info) | `gitleaks` binary `not-installed` in sandbox | Already pinned v8.30.1 in CI (`ci.yml:41`); no action; owner R8 |
| AUT-004 | Low | `--migrate --apply` stays ABORT `unsupported-runtime`; framing-3b pending user | Tracked open item; owner user/orchestrator; fail-closed proven |

## Verdict rationale

All R8-owned ACs (OPS-01..06 + NFR-OPS-01) verify green on actual re-execution (124/0, 123/123), never-kill proven by identical before/after listeners, and the CLI contract holds. **Conditional** (not pass) because: (1) AUT-001 needs the stage-nothing disposition recorded at gate level so future runs are not misread as residue; (2) AUT-002 namespace rename is R8's own queued hygiene; (3) NFR-01 scale proof-or-waiver must clear the gate C3 bar (accepted here, owned at gate). No CLOSED criterion is met (no manual deployment, no hardcoded secret, rollback present, automation deterministic).

## Conditions for opening

- [ ] COND-AUT-01: Record AUT-001 stage-nothing disposition (verify-then-restore `helix.toml`) in GATE_REPORT.
- [ ] COND-AUT-02: Rename `agent-memory-eval` fixture namespace (`scripts/eval.ts` + `docs/CONTRACT.md:698,703`) or file a dated waiver with owner.
- [ ] COND-AUT-03: NFR-01 `@10k nodes` scale proof-or-waiver clears the gate C3 bar (R8 accepts condition as written; gate owns it).

## Residual risk + owner

- NFR-01 unproven at ~10k scale (p95 8.68ms at N=40 only) — owner: gate (R1 proof or waiver with expiry).
- `--migrate` ABORT until Helix forwards HELIX_DATA_DIR (framing-3b) — owner: user/orchestrator.
- Shared-dev 384-dim index conflict (fail-closed, untouched) — owner: R1; R8 concurs.
- No silent PASS: all of the above are explicit.

## Cross-domain requests (formal, via orchestrator)

1. To R1: scale harness (seed ~10k notes, report R@5/MRR/nDCG + p95) or own the NFR-01 waiver (SCORECARD already requests this; R8 co-signs the need, claims no waiver itself).
2. To R1: `src/store.ts:848` `HELIX_URL`-only read vs SPEC-003 REQ-OPS-02 `BRAINY_URL` canonical-first (TEST_MATRIX bar #10) — R8 notes, does not patch.
3. To user/orchestrator: framing-3b `--migrate` decision (AUT-004).

## Evidence allowlist (no secrets, no raw PII)

Exit codes, pass/fail counts, port numbers, PIDs (952/888), `$HOME`-collapsed paths, stanza diff (`[local.slot9]` +6), deprecation stderr line, VERDICT/doctor lines, commit hashes (`339c511`, `201b1ee`, `2211b95`), file:line citations. Zero secret values (synthetic TEST_SECRET used only inside harness; never printed here).
