# Handoff: Engineering Owner (R1, vasquez) — P4 OPS control plane

**Spec Reference:** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` + companion `docs/specs/20_backlog/SPEC-P4-OPS-RUNBOOK.md#REQ-OPS-RUN-01..15` (operational contract, consumed by name)
**Agent:** general(vasquez) — Engineering Owner (R1), verify-handoff gatekeeper
**Date:** 2026-09-24
**Status:** complete — with 3 explicit `DONE* partial` rows (P4.4 HELIX_DATA_DIR / migrate, A3 FAIL) — by-design abort path, not defect, gate OPEN
**Domains-Touched:** R1 engineering (owner) · R8 automation/ops (runbook evidence) · R2 security (cross-cut output hygiene, secret non-printing, Ley 172-13)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-01..09 / HARD:subagents / GATE:OPEN (GATE_REPORT 8/8 PASS) / DOMAINS:R1,R8,R2`
**Load evidence — stage skill + template + mode + packet:**

| Item | Path / value | Status |
|------|--------------|--------|
| Stage skill | `frame-ship:verify-handoff` — template `/mnt/DATA/GitHub/deu/skills/core/verify-handoff/references/handoff-template.md` + checklist `/mnt/DATA/GitHub/deu/skills/core/verify-handoff/references/dod-checklist.md` | cited |
| Dispatched agent template | Engineering Owner (R1, vasquez) — gatekeeper check, owns DoD, never hands off without OPEN gate | cited |
| Execution mode | `subagents` (frozen at frame-intent, inherited from `SPEC-P4-OPS.md:9`) — max 2 parallel lanes INV-006 | declared |
| Packet intact | `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-01..09 / HARD:subagents / GATE:OPEN (GATE_REPORT 8/8 PASS) / DOMAINS:R1,R8,R2` — no silent rewrite | intact |

## Deliverables

| Artifact | Location / Evidence | Status |
|----------|---------------------|--------|
| **Implementation — CLI binary** | `bin/agent-memory.mjs:1-1378` (Node ≥20 ESM, `node:` builtins only: `child_process, fs, net, os, path, url`; zero new deps) + `package.json:14-15,33` (`"bin":{"agent-memory":"./bin/agent-memory.mjs"}` + `"verify-ops":"tsx scripts/verify-ops.ts"` only) — `package-lock.json` diff empty, `dependencies/devDependencies` unchanged | **done** |
| **Tests / Evidence — harness + matrix + live window** | `scripts/verify-ops.ts:1-300` (§A–§L + header proof, `check()` counters, `finally` reaps) · `TEST_MATRIX.md:97-134` 15-row P4 OPS section `T-P4OPS-01..15` · per-command bar `#1-10` (`TEST_MATRIX.md:119-132`) · live slot-2 window `3114/3115/3116/6970 slot2` (`TEST_MATRIX.md:132`) · `IMPLEMENTATION_PLAN.md:24-44` Step 0 A3 probe FAIL | **done** |
| **Docs — ops closure** | `README.md:601-784` Operations — P4 control plane (slot derivation table `R(N)=3111+3(N-1) H(N)=6969+(N-1)`, data-dir precedence, state `0700/0600` sibling, backup/recovery, Ley 172-13 PII-store declaration `README.md:715-727`, never-kill hint) · `TEST_MATRIX.md` KR1–KR3 rows + per-command bar · `docs/specs/40_workspace/quality-gate/P4-OPS/GATE_REPORT.md` (OPEN) | **done** |
| **Config — helix.toml** | `helix.toml:6-10` `[local.dev] port=6969 storage="disk" tag=v0.0.6` frozen · `helix.toml:12-16` `[local.slot2] port=6970 storage="disk"` additive via official `helix add local --name slot2 --port 6970` (sanctioned, not source edit; revert `git checkout -- helix.toml`) | **done** |
| **Gate — 8 independent reviews** | `docs/specs/40_workspace/quality-gate/P4-OPS/` — `quality-assurance.md` PASS, `security-reviewer.md` PASS (C1..C10 + J/K/I), `automation-reviewer.md` PASS (runbook §4a/4c/4d + CI), `readability.md` PASS, `reliability.md` PASS, `resilience.md` PASS, `risk.md` PASS, `refuter.md` PASS · consolidated `GATE_REPORT.md` **OPEN 8/8 PASS** | **done** |
| **Frozen surfaces** | `src/` (server.ts, store.ts, etc. — default `3111`/`6969` untouched) · `db/` (queries, no drift) · `hooks/` · `plugins/` · `mcp_config.json` — `git diff --stat src/ db/ hooks/ plugins/` empty (QA bar #8) | **done** |

## Definition of Done Checklist

### Common (all 8 domains)

- [x] **Spec frozen** — `docs/specs/20_backlog/SPEC-P4-OPS.md` + `SPEC-P4-OPS-RUNBOOK.md` are reference-only packet inputs; implementation follows approved `PROPOSED_CHANGES.md:88-94` 7 rows without improvisation; spec not mutated in this lane.
- [x] **All acceptance criteria met** — 15/15 rows mapped: 12/15 `DONE` + 3/15 `DONE* partial` by explicit A3 FAIL design (see below). Per-row acceptance `AC-P4-OPS-01..09 + AC-A..F` reconciled in `quality-assurance.md:42-61` would-fail-if-broken checks.
  - `DONE` (12): T-P4OPS-01 (CLI surface §A+git diff), 02 (start §B+live #10), 03 (stop §C+live), 04 (status §D+KR1), 05 (doctor §E+header proof+live), 06 (derivation §F+git diff), 09 (README docs), 10 (never-kill §I+static grep), 11 (secret non-print §J), 12 (port-parity §L+verify-env), 14 (zero deps+suites green), 15 (Ley hygiene §K).
  - `DONE* partial` honest by-design (3): T-P4OPS-07 (REQ-07 data-dir state-path proven, HELIX_DATA_DIR forwarding not claimed), T-P4OPS-08 (REQ-08 migrate abort `MIGRATE ABORT: unsupported-runtime` zero writes, no data moved), T-P4OPS-13 (NFR-D state-path durability proven, HELIX_DATA_DIR restart not claimed). Marked `DONE* partial — A3 FAIL framing 3b pending orchestrator`, not silent PASS — `GATE_REPORT.md:35` conditions none, `quality-assurance.md:63-71` §3.
- [x] **All REQ-IDs have linked evidence — C4 check: link present AND resolves AND relevant (attestation-alone = FAIL, dead/irrelevant = FAIL)** — 15/15 traceability `TEST_MATRIX.md:101-118`:

| REQ-ID | Evidence ID | Evidence link(s) — every link resolves to a real file/section | Relevant? (would fail if broken) | Commit |
|--------|-------------|---------------------------------------------------------------|----------------------------------|--------|
| REQ-P4-OPS-01 | T-P4OPS-01 | `scripts/verify-ops.ts` §A (help lists start\|stop\|status\|doctor exit 0; unknown→exit2) + `package.json:14-15,33` git diff | yes — QA §A would fail | f8e29f1 |
| REQ-P4-OPS-02 | T-P4OPS-02 | `scripts/verify-ops.ts` §B (foreign 3115 blocks start→exit1+NEVER-kill hint) + live bar #10 `TEST_MATRIX.md:132` (start 3114/6970 ready 200/200, remember→search 1 bm25 hit, git diff src/db empty) | yes | f8e29f1, 8d6ae81 |
| REQ-P4-OPS-03 | T-P4OPS-03 | `scripts/verify-ops.ts` §C (idempotent exit0, foreign survives, stale-pid C10) + live bar #10 (stop exit0 + repeat exit0) + `bin/agent-memory.mjs:452-459,1044-1074` verifyOwnedPid×2 | yes | f8e29f1 |
| REQ-P4-OPS-04 | T-P4OPS-04 | `scripts/verify-ops.ts` §D (bearer armed\|unset presence-only, never Authorization) + KR1 session `TEST_MATRIX.md:132` + `bin/agent-memory.mjs:1110-1160` cmdStatus never sends bearer | yes | f8e29f1 |
| REQ-P4-OPS-05 | T-P4OPS-05 | `scripts/verify-ops.ts` §E (tokens 0/1/3/4/5 + precedence 5>4>3>1>0 idx order + exactly one VERDICT) + `scripts/verify-ops.ts:265-287` C1 header proof 0 Authorization to foreign + `bin/agent-memory.mjs:1183-1344` C1→C3→C2→C4→C5 + live bar doctor healthy | yes | f8e29f1 |
| REQ-P4-OPS-06 | T-P4OPS-06 | `scripts/verify-ops.ts` §F (slots 1–3 table R(N)/H(N) exact, --slot 0/abc→2, never 3151 N=1..20, --slot 0, [local.dev] frozen) + `git diff` `helix.toml` additive only | yes | f8e29f1 |
| REQ-P4-OPS-07 | T-P4OPS-07 | `scripts/verify-ops.ts` §G (precedence --data-dir>AGENT_MEMORY_DATA_DIR>default, state sibling outside HELIX_DATA_DIR `state/slot-N.json`, mode 0600/0700, secret-free) — *partial star excludes HELIX_DATA_DIR forwarding* | yes for claimed surface | f8e29f1 |
| REQ-P4-OPS-08 | T-P4OPS-08 | `scripts/verify-ops.ts` §H (dry-run MIGRATE ABORT unsupported-runtime, --migrate --apply without --yes→2, no backup file in repo root) + session log MinIO retained + `bin/agent-memory.mjs:1308-1325` abort-first branch — *partial star: no data moved* | yes — abort contract | f8e29f1 |
| REQ-P4-OPS-09 | T-P4OPS-09 | `README.md:601-784` ops section + `TEST_MATRIX.md` KR1–KR3 rows (this section) linking evidence — doc diff | yes | 974f5c4 `(this commit)` → hash on merge (QA O-01 low) |
| NFR-P4-OPS-A | T-P4OPS-10 | `scripts/verify-ops.ts` §I (foreign on stand-in quartet survives all four subcommands unchanged PIDs) + static grep 0 `helix prune/delete/docker rm|kill/volume rm/fuser/pkill/killall/--persist` (`bin/agent-memory.mjs`) | yes | f8e29f1, bd65360 |
| NFR-P4-OPS-B | T-P4OPS-11 | `scripts/verify-ops.ts` §J synthetic TEST_SECRET 0 occurrences in stdout+stderr of all four subcommands + state file, output `bearer: armed` only | yes | bd65360 |
| NFR-P4-OPS-C | T-P4OPS-12 | `scripts/verify-ops.ts` §L (bin REST_BASE 3111 HELIX_BASE 6969, src/server.ts:478 default 3111 unchanged, helix.toml [local.dev] 6969) + `npm run verify-env` 21 green | yes | bd65360 |
| NFR-P4-OPS-D | T-P4OPS-13 | `scripts/verify-ops.ts` §G state-path durability (same harness as REQ-07) — *partial star excludes HELIX restart with HELIX_DATA_DIR* | yes for claimed | bd65360 |
| NFR-P4-OPS-E | T-P4OPS-14 | Suite logs `TEST_MATRIX.md:119-132` bar #1-7 + `git diff package-lock.json` empty + port guard `NEVER_BIND=[3111,3112,3113,3151,6969]` (`bin/agent-memory.mjs:76`) | yes | bd65360, f8e29f1 |
| NFR-P4-OPS-F | T-P4OPS-15 | `scripts/verify-ops.ts` §K canary `canary-verify-ops-<uuid>` 0 occurrences in doctor/status/migrate outputs | yes | bd65360 |

  - **Resolution proof:** every link above was read in this handoff (SPECs, TEST_MATRIX P4 section + per-command bar, verify-ops harness §A–L+header proof, README ops §601-784, GATE_REPORT, all 8 reviews, IMPLEMENTATION_PLAN Step 0, bin source). No attestation-alone row; no dead/irrelevant link. Demo grilling reference `docs/specs/40_workspace/security/SAMPLE-grilling-C4-deadlink-FAIL.md` correctly fails — this lane passes.
- [x] **C4 FAIL lists `residual-risk + owner` (security lane; silent PASS = FAIL)** — N/A fail-vs-pass: security is PASS, but residuals are explicit with owner+expiry (see Residuals below); no silent PASS — `security-reviewer.md:60-70` 5 residuals + `GATE_REPORT.md:60-72` 8 residuals, all with owner+expiry.
- [x] **Edge cases / failure modes handled** — invalid `--slot 0`/`abc`→exit2, non-integer slot→exit2, port overflow >65535→exit2 (`bin/agent-memory.mjs:258-259`), unknown flag→exit2, `--apply` without `--migrate`→2, `--migrate --apply` without `--yes`→2, quartet occupied by foreign→exit1 NEVER-kill hint no signal, stale-pid→stale-pid note exit1 no signal, non-empty foreign data-dir→refuse, invalid state closed-schema→refuse, bounded timeouts (readiness 30s `bin:67,922-935`, TERM_GRACE 5s TERM/KILL 3s `68-69`, http 2–3s, helix spawn 60–90s, poll 100ms).
- [x] **Gate OPEN (or CONDITIONAL cleared + waiver recorded)** — `docs/specs/40_workspace/quality-gate/P4-OPS/GATE_REPORT.md:8-9` **Verdict: ✅ OPEN — 8/8 PASS, zero Critical/High open, zero ❌, zero conditional.** No waivers sought or granted. Framing 3b pending orchestrator is a carried residual, not a gate block (`GATE_REPORT.md:12`). Gate keeper Montilla consolidating synthesis 2026-09-24; R1+R8+R2 sign-offs per-reviewer.
- [x] **Docs/changelog updated for user-facing impact** — `README.md:601-784` ops section (slot table, CLI usage, exit codes 0/1/2/3/4/5, data-dir/state layout, backup/Ley 172-13 declaration, never-kill rule, port-parity). Per-file CHANGELOG/RELEASE_NOTES are ship-release's lane; README+TEST_MATRIX are the DoD docs for this initiative — done.

### Engineering (R1 — only if engineering-touched) — YES

- [x] **Lint passes with zero warnings** — no lint configured beyond `npm run typecheck`; typecheck is the lint-equivalent gate — clean.
- [x] **Type checks pass** — `npm run typecheck` exit 0 (0 errors) — bin `.mjs` outside TS program (no `any`/`@ts-ignore`/TODO in source) — `TEST_MATRIX.md:123` bar #1.
- [x] **Test coverage — threshold met via AC coverage** — 15/15 REQ→test traced with discriminating harness sections; published bar `TEST_MATRIX.md:119-132`: `verify-ops` **99/0** (`scripts/verify-ops.ts` §A–L + header proof) · `verify-env` **21/0** · `verify-lifecycle` **123/0** (prior 117+6) · `verify-capture` **137/0** · `verify-skills --structural` **73/0** · `verify` **243/0** (`AGENT_MEMORY_URL=http://127.0.0.1:3151`, Helix dev read-only, T-RL-001+F-01 green) — all reconciled in `quality-assurance.md:44-61` (no inconsistency). Live slot-2 window DONE: `start` exit 0 (helix `slot2:6970` + `storage="disk"` patch + ready 200/200), `doctor` PASS C1 200 PASS C3 owned 3114 PASS C2 200/200 PASS C4 present PASS C5 disk → `VERDICT: healthy` exit 0, `remember→search` 1 bm25 hit score 0.86 `signals:[]`, `bootstrap 6970 OK (8 indexes ensured)`, `stop` exit0 + idempotent exit0, `helix status dev` unchanged 6969 up, `git diff --stat src/ db/` empty, `helix.toml` only `[local.slot2]` additive (sanctioned).
- [x] **No TODO/FIXME left in code** — `bin/agent-memory.mjs:1-1378` full read: 0 TODO/FIXME; `scripts/verify-ops.ts:1-300` 0 TODO/FIXME; `readability.md:7` 7/7 checklist PASS (3 Low hygiene RD-P4-001..003 backlog, not gate-blocking).

### Security (R2 — security-touched) — YES — `general(barrera)` conditions landed

- [x] **Security review conditions met — 10/10 C1..C10 implemented as code + evidenced, zero High open** — `security-reviewer.md:19-32` + `GATE_REPORT.md:22` row 2:
  - C1 (S-001 High) ownership-gated bearer — `bin/agent-memory.mjs:1197-1214` C3 restOwned via verifyOwnedPid+isDescendant, `1260-1265` C2 bearer only inside owned branch, foreign → `INFO skipped (NO request sent, no bearer transmitted)`; evidence `scripts/verify-ops.ts:265-287` header proof synthetic server 3135 receives 0 Authorization headers — **PASS**.
  - C2 (S-002 High) backup 0600/0700 Ley 172-13 — A3 FAIL abort supersedes write path (`bin:1308-1325` MIGRATE ABORT unsupported-runtime, no archive, no copy, MinIO retained); future declared in `README.md:715-727` (purpose/TTL/deletion/`~`-collapsed) — **PASS via abort**.
  - C3 (S-003,S-012) state hardening — `bin:303-310` ensureDir0700, `356-364` writeState 0600+0700, `337-354` isValidState closed schema, `452-459` shared verifyOwnedPid, `1026-1039` re-derive helixInstance — `scripts/verify-ops.ts:177-201` §G 0600/0700 secret-free — **PASS**.
  - C4 (S-004) path refusal — `bin:79-100` SYSTEM_ROOTS+HOME, `274-288` resolveDataDir + `727-757` start + `1312-1318` --backup-dir validated — **PASS**.
  - C5 (S-005) start idempotence — `bin:766-785` live-verified → already running exit0 — **PASS**.
  - C6 (S-006) audit lines — `bin:369-391` appendAudit 0600/0700 state/audit.log on every stop + migrate --apply (inc. abort) — **PASS**.
  - C7 (S-007,S-013) one allowlist renderer — `bin:119-147` oneLine+collapse+$HOME→~, `640-656` runHelix pipes and drops child text — `scripts/verify-ops.ts:250-254` canary0+secret0 — **PASS**.
  - C8 (S-008,S-011) env minimization + bin resolution — `bin:598-635` resolveSibling/resolveOnPath/resolveNpx/resolveHelix, `627-635` helixEnv strips secret, `885-893` only server inherits — **PASS**.
  - C9 (S-009,S-014) status never sends bearer + doctor C1→C3→C2 ordering — `bin:1110-1160` status naked 401=armed, `1162-1172` doctor C2 gated on C3 — **PASS**.
  - C10 (S-010) re-verify before SIGKILL — `bin:1044-1074` verifyOwnedPid before SIGTERM, re-verify `1060-1063` before SIGKILL mismatch→stale-pid note exit1 no signal — **PASS**.
  - J/K/I — `scripts/verify-ops.ts` §J secret 0 occurrences, §K canary 0, §I static forbidden primitives 0 `helix prune/delete/docker rm|kill/volume rm/fuser/pkill/killall/--persist` + live foreign 3135 survives — **PASS**.
- [x] **No secrets in code/config/logs/examples** — `bin/agent-memory.mjs:1157,1288` presence-only `bearer: armed|unset` / `secret: present|missing`, never value; `oneLine+collapse` sole renderer; `gitleaks detect --source=. --no-banner --redact` pinned 8.30.1 clean (CI `ci.yml:41-53`, local bar #8 lockfile empty); state file never contains secret (`scripts/verify-ops.ts:193-196`).
- [x] **Input validation at all boundaries** — `--slot` integer ≥1 else exit2 fail-closed (`src/server.ts:479-481` style), closed-schema `isValidState`, path refusal set `/, $HOME, system roots, outside $HOME&&/tmp` (`bin:274-288`), `--migrate` gates fail-closed (`bin:251-253`), `helix.toml` table-scoped parse (not global regex per `docs/specs/50_archive/P0/review-refuter.md` CE-06).

### Domain appendix (only touched domains)

- [x] **Finance (dauhajre):** N/A — local developer tool, no customer surface, no billing/quota change — `PROPOSED_CHANGES.md:92` + `IMPLEMENTATION_PLAN.md:104` N/A.
- [x] **Legal (subero):** N/A — no external send/filing, no contracts — Ley 172-13 cross-cut via output hygiene only (`README.md:715-727` declaration, no customer PII store created while A3 FAIL).
- [x] **Marketing (vera):** N/A — no external launch, README ops is internal developer docs.
- [x] **People (santana):** N/A — no org change; `bin` + `verify-ops` only.
- [x] **Revenue (montero):** N/A — no pipeline/quota/forecast surface.
- [x] **Automation/ops (espinoza + vasquez):** **PASS — workflow tested, rollback/runbook/monitoring/flags checked** — `automation-reviewer.md:9-17` 6/6 checklist PASS + `GATE_REPORT.md:23` row 3:
  - Runbook §4a closed set 0/1/2/3/4/5 precedence `5>4>3>1>0` single VERDICT C1→C3→C2 landed (`bin:1327-1344` if/else chain, `1343` single VERDICT, all 5 emits, `1189→1195→1259` C1→C3→C2 gating) — harness §E precedence idx order + `VERDICT:/g ===1`.
  - §4c migrate ABORT fail-closed (`bin:1308-1325` MIGRATE ABORT unsupported-runtime, never a write, `--apply --yes` only write path also aborts while A3 FAIL) — harness §H.
  - §4d stop ownership tracked-PID-only with re-verify per signal (`bin:452-459` verifyOwnedPid, `:1049` pre-SIGTERM, `:1060` pre-SIGKILL) + named instance `helix stop <name>` only + forbidden primitives 0 — harness §C/I live proofs.
  - CI unchanged & green (`ci.yml:21-30,41-53` diff empty, four CI jobs typecheck+injection+lifecycle+capture+skills + gitleaks, verify-ops 99 + verify 243 local-only not added to CI per RUNBOOK REQ-12) — bar #1-10 pasted.
  - Evidence wiring TEST_MATRIX singleton + per-command bar #1-10 + exclusive live window `3114/6970 slot2` vs `dev 6969 read-only` no dev restart (`helix status dev` unchanged) + session-node budget +17/run declared (`docs/CONTRACT.md §5`, ROADMAP).
  - Config frozen `[local.dev]` frozen port 6969 storage disk tag v0.0.6, `[local.slot2]` additive only, no `--persist` as arg.
- [x] **Data lens (vasquez):** lineage/schema/migration/backfill + PII handling signed — `README.md:715-727` backup PII-store declaration (purpose=DR, location `~`-collapsed, TTL=deleted after verified migration+operator confirmation, deletion `rm -rf <backup>`, 0600/0700 umask-independent, never-logged content) — abort path proves never-a-write while A3 FAIL; `helix.toml` storage disk ensures 8 indexes `bootstrap OK (8 indexes ensured)` before remember.

### Documentation

- [x] **API docs updated** — `README.md:601-784` ops section is the API doc for this control plane (slot table, CLI usage, exit-code matrix `0/1/2/3/4/5`, state layout, backup declaration, never-kill hint, port-parity).
- [x] **Changelog entry** — N/A for this handoff lane with justification: CHANGELOG.md / RELEASE_NOTES.md are owned by `ship-release` (orchestrator Montilla) — this handoff delivers README+TEST_MATRIX lane singleton, changelog is next lane's commit.
- [x] **ADR written if architecture contract changed** — N/A — `docs/specs/10_design/ARCHITECTURE.md` v1 consumed as written (components/interfaces/invariants INV-001..010), no delta — `ARCHITECTURE_REVIEW.md` Approved-with-conditions C1–C3 discharged at gate; ADRs remain in `docs/specs/40_workspace/decision-records/`.

## Code Built + No Scope Creep

- **Built:** `bin/agent-memory.mjs` exists 49.1K 1,378 lines — `package.json` bin registered, `bin/agent-memory --help` lists start|stop|status|doctor exit 0, unknown→exit2 (AC-01) — `scripts/verify-ops.ts:94-122` §B/C live.
- **No scope creep — `src/db` empty:** `git diff --stat HEAD -- src/ db/` 0 files; `git diff HEAD -- src/ db/ hooks/ plugins/` empty (QA bar #8 `quality-assurance.md:55`, automation §5); `git diff HEAD -- package-lock.json` empty (bar #9); `helix.toml` delta limited to additive `[local.slot2]` sanctioned.
- **Docs updated:** `README.md:601-784` diff present; `TEST_MATRIX.md:97-134` P4 OPS rows + bar #1-10 present.
- **Gate OPEN:** `GATE_REPORT.md:8` OPEN 8/8 PASS; zero Critical/High; conditions none.

## Residuals — 8 carried, all explicit owner+expiry (GATE_REPORT.md:60-72 consolidated)

| # | Carries | Risk | Likelihood × Impact | Owner | Expiry / re-review |
|---|---------|------|---------------------|-------|--------------------|
| 1 | R2/A3 FAIL | `HELIX_DATA_DIR` forwarding unsupported on Helix CLI 3.3.0 — `doctor --migrate` abort-only (`MIGRATE ABORT: unsupported-runtime`, `bin/agent-memory.mjs:1308-1325`), `HELIX_DATA_DIR` never set (`:892`), KR3 not claimed; framing 3b pending orchestrator | Medium × High | R1 `general(vasquez)` + R8 `general(espinoza)`, escalated to **orchestrator** | **2026-12-31 or framing-3b decision, whichever first** |
| 2 | R3 | Helix bind-mount `0700`/`0600` not exercised in vivo — state-file `0700`/`0600` proven (`scripts/verify-ops.ts:177-201` §G), Helix `HELIX_DATA_DIR` bind-mount for uid 65532 deferred while A3 FAIL | Medium × Medium | R1 `general(vasquez)` | Re-verify `stat 0600`/`0700` on first live Helix data-dir mount after A3 enablement |
| 3 | R5/R6/RL-001 | RL-001 surviving boundary — single-process writers only; cross-process writers to one Helix instance out of contract until P4.3 | Low × High | R1 `general(vasquez)` | **2026-12-31 or start of P4.3, whichever first** — `ROADMAP.md:68` |
| 4 | PID-reuse TOCTOU | PID-reuse TOCTOU between `verifyOwnedPid` (`bin/agent-memory.mjs:452-459`) and SIGTERM/SIGKILL (`:1049,1060-1063`) — narrowed to ms by cmdline re-verification + C10 re-verify before SIGKILL; inherent without `pidfd`/`start-time` | Low × High | R1 `general(vasquez)` | Re-review if PID namespace changes or C10 weakened |
| 5 | A5 | Additive `[local.slot2]` remains in `helix.toml:12-16` until `git checkout -- helix.toml` — inert without CLI | Low × Low | R8 `general(espinoza)` | Re-verify on next P4 lane that touches slots |
| 6 | RL-001-QUEUE | Nested FIFO lock queue no cap/no deadline — ≤165 s held in-lock (`ROADMAP.md:72`) | Medium × Medium | R1 `general(vasquez)` | P4.3 or first retry storm, whichever first; also **2026-12-31** heartbeat |
| 7 | VERIFY-SESSION-NODES | `scripts/verify.ts` leaves +17 Session nodes per run (490→507→524, `TEST_MATRIX.md:77-89`), unbounded until reset | Medium × Low | R1 `general(vasquez)` | P4.1 or **2026-12-31**, whichever first |
| 8 | R1 latent | Wrong-slot operator `--apply --yes` — dry-run prints per-slot target, `--yes` gates real move | Low × High | R1+R8 | Permanent for this CLI; re-review if second confirmation added |

No residual carries Critical; all with owner+expiry; all declared in `ROADMAP.md:71-73` + `TEST_MATRIX.md:134` `*Notes:` + `security-reviewer.md:60-70` + `resilience.md` + `automation-reviewer.md` + `risk.md`. Low observations (QA O-01 `T-P4OPS-09 "(this commit)"` → hash on merge; RD-P4-001..003; REL-OBS-01) are hygiene, not DoD-blocking.

**Additional observation (this gatekeeper):** none beyond the 3 Low hygiene already carried — no new Medium/High.

## Blockers / Open Questions

- **None blocking handoff.** Gate is OPEN 8/8 PASS (`GATE_REPORT.md:90-94` sign-off).
- **A3 framing 3b pending orchestrator** — not a blocker, is the declared reversible call per `SPEC-P4-OPS.md:305-311` A3 + `IMPLEMENTATION_PLAN.md:39-44` → escalated, not improvised; any future migration write path requires new probe + new J/K/I + backup-mode evidence before claiming KR3 (`GATE_REPORT.md:35`).
- **T-P4OPS-09 commit column `(this commit)`** — placeholder for lane-closing docs merge commit `974f5c4` → hash resolves on merge (QA O-01, automation R8-OBS-01 Low).

## Next Agent

**`ship-release` (orchestrator Montilla, CEO) — per `GATE_REPORT.md:93` and packet.**

Ships the verified work:

1. Create CHANGELOG.md / `docs/specs/30_delivery/RELEASE_NOTES.md` entry for `bin/agent-memory` + `scripts/verify-ops.ts` lane.
2. Tag `v0.7.x` release per `CHANGELOG.md` + `CONTRIBUTING.md` Conventional Commits (prior lane tags `f8e29f1..974f5c4`).
3. Decide framing 3b (data-dir for new instances only) vs Helix CLI upgrade for HELIX_DATA_DIR — consult `IMPLEMENTATION_PLAN.md:24-44` Step 0 + `PROPOSED_CHANGES.md:135-142` implementation notes.
4. No additional code — handoff is DoD-complete; security post-hearing note: no DPIA needed (local tool, no customer surface, Ley 172-13 via output allowlist only).

---

**Gatekeeper verdict:** ✅ **DoD PASS — OPEN gate, full trace 15 rows with resolving relevant links, code built, suites green 99/21/123/137/73/243, src/db frozen, docs updated, R1+R8+R2 conditions landed (C1..C10), 8 residuals explicit owner+expiry, A3 framing 3b carried not blocking.**

*Engineering Owner (R1, vasquez) — verify-handoff gatekeeper. Touched only this file `docs/specs/40_workspace/engineering/HANDOFF.md`.*

