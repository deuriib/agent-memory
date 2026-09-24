# Quality Gate Report — P4 OPS control plane (SPEC-P4-OPS)

**Date:** 2026-09-24 · **Gate keeper:** Orchestrator (Montilla, CEO) — consolidating synthesis · **Execution:** subagents, max 2 parallel lanes (INV-006)
**Spec (reference-only packet):** `SPEC:docs/specs/20_backlog/SPEC-P4-OPS.md#REQ-P4-OPS-01..09+NFR-A..F` / `HARD:subagents+<zero new deps, frozen src/db, port guard 3111/3112/3113/3151/6969>` / `GATE:reviews done` / `DOMAINS:R1,R8,R2`
**Scope:** lane `f8e29f1..974f5c4` — `bin/agent-memory.mjs:1-1378` + `scripts/verify-ops.ts:1-300` + `package.json:14-15,33` + `helix.toml:12-16` + `README.md:601-784` + `TEST_MATRIX.md:97-134`
**Inputs consolidated:** 8 independent reviewer artifacts in `docs/specs/40_workspace/quality-gate/P4-OPS/` + `TEST_MATRIX.md` per-command bar #1-10 + `IMPLEMENTATION_PLAN.md:24-44` Step 0 A3

## Verdict: ✅ OPEN

Zero Critical/High open across all 8 reviews. Zero ❌. Zero conditional. P4.4 partial (T-P4OPS-07/08/13 DONE* partial) is by design per A3 FAIL — not a gate condition — fail-closed `MIGRATE ABORT: unsupported-runtime` with zero writes satisfies the contract.

No waivers sought or granted. Framing 3b pending orchestrator is a carried residual, not a gate block.

## Reviewer verdicts

All 8 reviews PASS. Strictly 1 dedicated subagent per reviewer, zero bundled reviews, reviewer independence preserved (no reviewer fixed its own findings).

| # | Reviewer (domain) | Verdict | One-line summary | Artifact |
|---|---|---|---|---|
| 1 | quality-assurance (R1 engineering — REQ→test→artifact) | ✅ PASS | 15/15 REQ→T-P4OPS mapped, 12 DONE + 3 DONE* partial honest, 99/0 + 243/0 counts reconciled, no orphan REQ/evidence, forbidden primitives absent | `quality-assurance.md` |
| 2 | security-reviewer (R2 `general(barrera)` — C1..C10 + J/K/I) | ✅ PASS | C1..C10 landed as code (`bin/agent-memory.mjs:119-1372`) with header proof 0 Authorization to foreign (`scripts/verify-ops.ts:265-287`), J/K 0 secret/canary, I static grep clean | `security-reviewer.md` |
| 3 | automation-reviewer (R8 `general(espinoza)` — runbook §4a/4c/4d + CI) | ✅ PASS | Runbook §4a closed set 0/1/2/3/4/5 precedence `5>4>3>1>0` + single VERDICT + C1→C3→C2 order landed (`bin/agent-memory.mjs:1327-1344`), CI unchanged (`.github/workflows/ci.yml:21-53` diff empty), per-command bar #1-10 pasted | `automation-reviewer.md` |
| 4 | readability (R1 engineering) | ✅ PASS | 7/7 checklist holds; 3 Low hygiene only: RD-P4-001 dead no-op `bin/agent-memory.mjs:842-844`, RD-P4-002 depth-4 `bin/agent-memory.mjs:786-822`, RD-P4-003 `r1/r2` terse | `readability.md` |
| 5 | reliability (R1 engineering — timeouts/durability) | ✅ PASS | Bounded 30s readiness (`bin/agent-memory.mjs:67,922-935`) + 5s TERM_GRACE + 3s KILL_WAIT (`:68-69,1057,1067`) with `waitUntilDead:471-478`; no unbounded retry; fail-closed on storage; `verify 243` green | `reliability.md` |
| 6 | resilience (R1 engineering — blast radius/rollback) | ✅ PASS | Blast radius = approved proposal (`PROPOSED_CHANGES.md:88-94`); rollback delete bin+verify-ops + `git checkout -- helix.toml` immediate; MinIO retained; slot2 window exclusive 3114/6970 vs dev 3111/6969 read-only | `resilience.md` |
| 7 | risk (R1 engineering — R1..R7 + A1..A6 + 8 residuals) | ✅ PASS | 7 spec risks R1..R7 mitigated or carried with owner+expiry; 0 unmitigated High/Critical; A3 probed before code → FAIL → framing 3b escalated | `risk.md` |
| 8 | refuter (R1 adversarial — 6 claims) | ✅ PASS | 6 headline claims survived falsification: slot-math N=1..99999 disjoint + 3151 never derived, never-kill tracked-PID-only, secret non-printing, A3 revert, port-parity, zero deps — 0 Medium/High counterexample | `refuter.md` |

Cross-domain sign-offs: Engineering↔Security ✅ PASS (`security-reviewer.md` C1 bearer gate); Engineering↔Automation ✅ PASS (`automation-reviewer.md` runbook + CI); Engineering↔Legal/Privacy ✅ N/A local tool (no customer surface, Ley 172-13 output hygiene only via `README.md:715-727` + §J/K). No contradictions across reviewers; QA reconciled all counts.

## Conditions for Opening

**None.** All 8 reviews are PASS with zero High/Critical. No CONDITIONAL to clear, no waiver to record.

P4.4 rows T-P4OPS-07 `DONE* partial`, T-P4OPS-08 `DONE* partial`, T-P4OPS-13 `DONE* partial` are explicitly marked partial per `IMPLEMENTATION_PLAN.md:39-44` Step 0 A3 FAIL (`helix start` 3.3.0 `HELIX_DATA_DIR` 0 hits, `docker inspect` no passthrough, skill direct-Docker mode) and proven fail-closed (`bin/agent-memory.mjs:1308-1325` `MIGRATE ABORT: unsupported-runtime` + `MinIO volume retained`, abort before any write, `scripts/verify-ops.ts:202-216` §H). This is the correct evidence for the reversible call framing 3b — not a defect, not a gate condition. Any future migration write path requires a new probe + new J/K/I + backup-mode evidence before claiming KR3.

| COND | Demand | Status |
|---|---|---|
| — | No gate-blocking condition raised by any reviewer | ✅ N/A — gate OPEN unconditional |

## Evidence bar (TEST_MATRIX #1-10 — live slot2 window)

Per-command bar `TEST_MATRIX.md:119-132` — single run, each command pasted with its own counts, server :3151 + slot2 window 3114/6970 instance slot2 dev 6969 read-only:

| # | Command | Result |
|---|---|---|
| 1 | `npm run typecheck` | exit 0 (0 errors) — bin `.mjs` outside TS program |
| 2 | `npx tsx scripts/verify-ops.ts` | **99 passed, 0 failed** / VERIFY PASS — C1 header proof synthetic server on 3135 receives 0 Authorization headers; §A–§L + never-kill + secret + canary + port-parity all green |
| 3 | `npm run verify-env` | **21 passed, 0 failed** / VERIFY PASS |
| 4 | `npm run verify-lifecycle` | **123 passed, 0 failed** / VERIFY PASS |
| 5 | `npm run verify-capture` | **137 passed, 0 failed** / ALL PASS |
| 6 | `npm run verify-skills -- --structural` | **73 passed, 0 failed** / VERIFY SKILLS PASS |
| 7 | `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify` | **243 passed, 0 failed** / VERIFY PASS (server on 3151 never 3111; T-RL-001 + T-F-01 green) |
| 8 | `git diff --stat src/ db/ hooks/ plugins/` | empty (0 files) |
| 9 | `git diff package-lock.json` | empty (0 lines) |
| 10 | Live slot-2 window `bin/agent-memory start --slot 2` → `doctor healthy` → `remember→search` 3114 → `stop --slot 2` → idempotent | **DONE**: `start` exit 0 (helix `slot2:6970` + `storage="disk"` patch + ready 200/200); `doctor --slot 2` → PASS C1 200, PASS C3 owned 3114, PASS C2 200/200, PASS C4 present, PASS C5 disk → `VERDICT: healthy` exit 0; `POST /memory/remember` → `deduped:false`; `POST /memory/search` → 1 result `bm25` 0.86 `signals:[]`; bootstrap 6970 `OK (8 indexes ensured)` before remember; `stop --slot 2` exit 0 + second `stop` exit 0 idempotent; `helix status dev` unchanged (6969 up); `helix.toml` only `[local.slot2]` additive (sanctioned) |

Traceability: `TEST_MATRIX.md:101-118` maps `REQ-P4-OPS-01..09+NFR-A..F` → `T-P4OPS-01..15` → `scripts/verify-ops.ts` §A–L + header proof + live window #10 + doc diff. No orphan REQ, no orphan evidence (`quality-assurance.md:42`). `IMPLEMENTATION_PLAN.md:24-44` Step 0 A3 FAIL recorded before any code with binary scan + `helix start --help` + `docker inspect` + skill docs. Hard constraints hold: `package.json:14-15,33` only `bin` + `verify-ops` additive, `dependencies`/`devDependencies` unchanged, `helix.toml:6-10` `[local.dev]` frozen `port 6969 storage="disk" tag v0.0.6`, `bin/agent-memory.mjs:76` `NEVER_BIND=[3111,3112,3113,3151,6969]` intact, `src/` diff empty.

## Residual risks (explicit — no silent PASS; 8 carried)

| # | Carries | Risk | Likelihood × Impact | Owner | Expiry / re-review |
|---|---|---|---|---|---|
| 1 | R2/A3 FAIL | `HELIX_DATA_DIR` forwarding unsupported on Helix CLI 3.3.0 — `doctor --migrate` abort-only (`MIGRATE ABORT: unsupported-runtime`, `bin/agent-memory.mjs:1308-1325`), `HELIX_DATA_DIR` never set (`:892`), KR3 not claimed; framing 3b pending orchestrator | Medium × High | R1 `general(vasquez)` + R8 `general(espinoza)`, escalated to **orchestrator** | **2026-12-31 or framing-3b decision, whichever first** |
| 2 | R3 | Helix bind-mount `0700`/`0600` not exercised in vivo — state-file `0700`/`0600` proven (`scripts/verify-ops.ts:177-201` §G), Helix `HELIX_DATA_DIR` bind-mount for uid 65532 deferred while A3 FAIL | Medium × Medium | R1 `general(vasquez)` | Re-verify `stat 0600`/`0700` on first live Helix data-dir mount after A3 enablement |
| 3 | R5/R6/RL-001 | RL-001 surviving boundary — single-process writers only; cross-process writers to one Helix instance out of contract until P4.3 | Low × High | R1 `general(vasquez)` | **2026-12-31 or start of P4.3, whichever first** — `ROADMAP.md:68` |
| 4 | PID-reuse TOCTOU | PID-reuse TOCTOU between `verifyOwnedPid` (`bin/agent-memory.mjs:452-459`) and `SIGTERM`/`SIGKILL` (`:1049,1060-1063`) — narrowed to ms by cmdline re-verification + C10 re-verify before SIGKILL; inherent without `pidfd`/`start-time` pinning | Low × High | R1 `general(vasquez)` | Re-review if PID namespace changes or C10 weakened |
| 5 | A5 | Additive `[local.slot2]` remains in `helix.toml:12-16` until `git checkout -- helix.toml` — inert without CLI | Low × Low | R8 `general(espinoza)` | Re-verify on next P4 lane that touches slots |
| 6 | RL-001-QUEUE | Nested FIFO lock queue no cap/no deadline — ≤165 s held in-lock (`ROADMAP.md:72`) | Medium × Medium | R1 `general(vasquez)` | P4.3 or first retry storm, whichever first; also **2026-12-31** heartbeat |
| 7 | VERIFY-SESSION-NODES | `scripts/verify.ts` leaves +17 Session nodes per run (490→507→524, `TEST_MATRIX.md:77-89`), unbounded until reset | Medium × Low | R1 `general(vasquez)` | P4.1 or **2026-12-31**, whichever first |
| 8 | R1 latent | Wrong-slot operator `--apply --yes` — dry-run prints per-slot target, `--yes` gates real move | Low × High | R1+R8 | Permanent for this CLI; re-review if second confirmation added |

No residual carries Critical; all with owner+expiry; all declared in `ROADMAP.md:71-73` + `TEST_MATRIX.md:134` `*Notes:` + reviewer reports (`security-reviewer.md` #1-5, `resilience.md` #1-3, `automation-reviewer.md` #1-3). Low observations (QA O-01 `T-P4OPS-09` `(this commit)` → hash on merge; RD-P4-001..003; REL-OBS-01 `2s` vs `5s/3s` grace; RISK-OBS-01/02) are hygiene, not gate-blocking.

## PII checkpoint (Ley 172-13)

Zero PII/secrets in every gate artifact, prompt, log, export: evidence is allowlisted (counts, SHAs, ports, verdicts, `~`-collapsed paths); `AGENT_MEMORY_SECRET` presence-only (`armed|unset` / `present|missing`, `bin/agent-memory.mjs:1157,1288`); state file `0600` in `0700` dir contains no secret (`scripts/verify-ops.ts:193-196`); synthetic `TEST_SECRET` 0 occurrences (`scripts/verify-ops.ts:233-249` §J); canary 0 occurrences (`:250-254` §K); backup PII-store declared in `README.md:715-727` (purpose/TTL/deletion/`~`-collapsed) but no archive created while A3 FAIL — abort path proves never-a-write.

## Process notes

- **Conflicting verdicts requiring arbitration: none.** All 8 reviews converge to PASS independently.
- A3 framing 3b is the declared reversible call per `SPEC-P4-OPS.md:305-311` A3 + `IMPLEMENTATION_PLAN.md:39-44` → escalated, not improvised; `bin/agent-memory.mjs:1-37` header narrates the probe.
- `helix.toml` `[local.slot2]` is sanctioned config registration (`SPEC-P4-OPS.md:98` A5), not a source edit; revert is `git checkout -- helix.toml` (`IMPLEMENTATION_PLAN.md:75`).
- Helix dev never restarted in harness (`helix.toml` port 6969, storage disk); live window touches only slot2 6970 + 3114/3115/3116 per `IMPLEMENTATION_PLAN.md:54-56`.

## Final evidence (as of this commit)

`typecheck` 0 · `verify-ops` **99/0** (`scripts/verify-ops.ts` §A–L + header proof) · `verify-env` **21/0** · `verify-lifecycle` **123/0** · `verify-capture` **137/0** · `verify-skills` **73/0** · `verify` **243/0** (server :3151 never 3111) · `git diff src/db/hooks/plugins` empty · `package-lock.json` empty · `helix.toml` `[local.dev]` frozen + `[local.slot2]` additive only · `bootstrap 6970 OK (8 indexes ensured)` before remember · live slot2 window DONE (remember→search 1 bm25 hit, doctor healthy, stop idempotent, dev untouched).

## Sign-off

- [x] All reviewers PASS — **8/8 ✅, 0 Critical/High open, 0 conditions**. Gate OPEN unconditional.
- [x] Gate keeper (Orchestrator Montilla, CEO — consolidating synthesis): **OPEN**. No third retry loop, no sideways fix. P4.4 partial is by-design abort (A3 FAIL, framing 3b pending orchestrator — carried as Residual #1). Next: `frame-ship:verify-handoff` → `frame-ship:ship-release`.
- [x] Domain owners: R1 `general(vasquez)` (engineering) + R8 `general(espinoza)` (automation/ops) + R2 `general(barrera)` (security) — per-reviewer PASS above; cross-domain sign-offs recorded.
