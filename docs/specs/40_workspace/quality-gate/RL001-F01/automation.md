# Automation + Ops Review: REQ-RL-001 + REQ-F-01 (residual-closure lane)

**Reviewer:** automation-reviewer (independent gate reviewer, Automation Owner espinoza's R8 lens) + ops mechanics lens
**Date:** 2026-09-24
**Scope (commits, main, unpushed):** `01224cc` (REQ-RL-001 — per-survivor FIFO lock + fresh `getMemoryById` re-read), `a0257d6` (REQ-F-01 — post-write verify + ONE heal + fail-closed named throw), `fb8e661` (docs: CONTRACT v1.5 + README + CHANGELOG). Diff range: `a9ef417..HEAD` (11 files, all `M`).
**Packet (accepted by reference):** SPEC:ROADMAP.md#1.3-rows-RL-001,F-01 + docs/CONTRACT.md#v1.5-amendment (§2+§3-tier-1+§5) / HARD:subagents+review-only+no-code-edits+no-push / GATE:execution-evidence-commits-01224cc,a0257d6,fb8e661-bar-green / DOMAINS:R8-automation-ops-lens
**Checklists applied:** `frame-ship/skills/quality-gate/references/domains/automation-review.md` AND `domains/ops-review.md` (both, per packet).
**Verdict:** ⚠️ **conditional** — findings: **Critical 0 · High 0 · Medium 3 · Low 2**; condition issued: **COND-AU-01**; inherited conditions gating my findings (not re-issued): **COND-RS-02, COND-RK-02, COND-RK-03**.

## Rules honored (evidence environment)

Review-only: this report is the ONLY file written — no code/script/test/doc edit; no Helix restart/stop/upgrade (`:6969` observed via `helix status`/`helix logs dev` only); upstream `:3111` untouched; live evidence read-only against `http://127.0.0.1:3151` (`livez` 200; `health?project=review-automation` → `memories:0, sessions:0`); **zero write probes created** by this review → no `forget` cleanup needed; no secrets, no PII, no memory content, no concept names, no embeddings reproduced — statuses/counts/file:line only; no push.

## Checklist — automation-review.md

- [x] **Workflow/adapter/event boundary mapped** — every new Helix call flows through the single `send()` seam (`src/store.ts:477-479`) under `QUERY_TIMEOUT_MS=15_000` (`src/store.ts:50`); no new route, MCP tool, hook, or event; no new PII surface (link-only heal writes Concept names under the existing DAT-001 caller-label posture; `hooks/capture.mjs` untouched).
- [x] **Least-privilege scopes** — zero keys/roles/credentials in the diff; CI permissions unchanged (`contents: read`, `.github/workflows/ci.yml:8-9`); pinned+checksummed gitleaks job untouched (`ci.yml:41-53`).
- [x] **Idempotency + retry budget** — heal is exactly ONE (retry within a single call: `src/store.ts:1029-1033`), then fail-closed throw → 500 = escalate. Conforms to retry-N=2-then-escalate; no third loop, no sideways. Heal re-sends are idempotent (`setProperty` + concept upsert, `src/store.ts:889-916`, `:959-992`).
- [~] **Deployment plan + rollback tested** — deployment = ordinary app restart, NO migration (8 indexes unchanged, see lens 3); reverse-order full revert proven safe read-only via sibling `git merge-tree` probes (risk.md evidence log, probes 2/3 exit 0) — but the documented per-commit rollback is wrong → **AU-005 / inherited COND-RK-03**.
- [ ] **Monitoring/alerting + runbook updated** — NOT updated: no runbook anywhere (grep README/CONTRACT "runbook/troubleshoot" → none); successful heals emit no log/counter (`grep -c "console\." src/store.ts` → 0) → **AU-004 / inherited COND-RK-02**.
- [x] **Capacity/scaling + feature flags** — no new flag needed (merge gate env `AGENT_MEMORY_MERGE_JACCARD` pre-existing; fail-closed default is the contract); capacity/latency envelope quantified in lens 4 → **AU-002 / inherited COND-RS-02**.
- [x] **No freelance fixes** — reviewer performed zero mutations; review-only honored.

## Checklist — ops-review.md

- [x] **Deployment plan defined** — no schema/index/route change; bootstrap unchanged; restart-only.
- [~] **Rollback tested** — safe path proven (tree-equal to green parents, no data backout); documented path conflicts → AU-005 / COND-RK-03.
- [ ] **Monitoring/alerting updated** — no; failures greppable, successes silent → AU-004.
- [ ] **Runbook updated** — no → AU-004 / COND-RK-02.
- [x] **On-call impact assessed** — see lens 5: bounce behavior availability-only; hooks can never block the agent (`hooks/capture.mjs:50-51,215` exit 0 always; plugin fire-and-forget 1.5s) → Low residual, documented below.
- [x] **Capacity/scaling reviewed** — lens 4 numbers; single-process local-Helix deployment bounds the impact.
- [x] **Feature flags (if needed)** — none needed; correctness fix must not be flag-gated (a disable flag would weaken the §5 gate).

## Lens findings (the 7 packet areas)

### 1) CI coverage of the new code — gap assessment → AU-001 (Low)

CI exists (`.github/workflows/ci.yml`, on every push/PR, `ci.yml:4-6`) and runs: `typecheck` (`:22`), `verify-injection` (`:25`), **`verify-lifecycle` (`:27`) — which INCLUDES the new §G `missingConcepts` goldens (`scripts/verify-lifecycle.ts:695-722`) and the §I guard-path heal seam + fresh-read control (TEST_MATRIX.md:50)**, `verify-capture` (`:28`), `verify-skills --structural` (`:30`), gitleaks (`:53`). So the new **pure/offline** tests DO run in Actions.

The new **E2E** tests — §P `rl-001:` 13 checks (`scripts/verify.ts:1491-1568`) and §P `f-01:` block (~14 checks, `scripts/verify.ts:1619-1717`) — live in `npm run verify`, which needs a live server + Helix and is **local-only by explicit design**: `ci.yml:23-24` comment "npm run verify is deliberately NOT run here: it requires a live server + Helix." There is no CI-gated live job (no `workflow_dispatch`/service-container path). Gap assessment: **acceptable** — the split is declared in the pipeline file itself, the live half is compensated by the §5 manual bar (243) re-run independently today by sibling reviewers (refuter.md:15, risk.md evidence log), and the test is protected by a read-only identity guard aborting before the first write (`scripts/verify.ts:332-351`). Residual: **these 3 commits are unpushed → Actions has never executed this lane**; local runs of every CI command are green (TEST_MATRIX.md:48-61), so first-run risk is environment drift only → **COND-AU-01**. Future option (not a condition): a manual-dispatch live-verify job with a Helix service container.

### 2) Pipeline impact — NONE → confirmed (feeds explicit lines below)

`git diff --name-only a9ef417..HEAD` = exactly: `CHANGELOG.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `TEST_MATRIX.md`, `db/index.ts`, `db/queries.ts`, `docs/CONTRACT.md`, `scripts/verify-lifecycle.ts`, `scripts/verify.ts`, `src/consolidate.ts`, `src/store.ts`. **`package.json` and `package-lock.json` untouched** (diff empty → zero dependency change, zero new/changed top-level scripts — `verify`/`verify-lifecycle` pre-existed at `package.json:21,23`). **No pipeline files changed**: `.github/workflows/ci.yml`, `helix.toml`, `hooks/capture.mjs` not in the diff. No new script files added (all `M`, no `A`).

### 3) Bootstrap/index posture — STAYS 8, no migration → confirmed

Exactly **8** `createIndexIfNotExists` calls (`db/queries.ts:127,131,135,139,143,147,153,157`; comment `:115`); `db/index.ts` diff is +6 re-export lines only (`getMemoryById`/`memoryConcepts`/`linkMemoryConcepts` + their params, `db/index.ts:19-39`); no `IndexSpec` added anywhere in the diff; live bar: `bootstrapIndexes: OK (8 indexes ensured)` + "no index added by either REQ" (TEST_MATRIX.md:49, CONTRACT §5 `docs/CONTRACT.md:547`). **No migration, no re-bootstrap required on deploy.**

### 4) Deployment/operability — round-trips, latency, worst case → AU-002 (Medium)

Sequential Helix sends per `remember` (default threshold ON; every send ≤15s via `withTimeout`, `src/store.ts:410-424` — rejects, does NOT abort the in-flight SDK fetch: no AbortController):

| Path | Sends | Pre-lane | Worst-case duration (all sends at 15s cap) |
|---|---|---|---|
| Exact-dedup hit | 1 (`:561`) | 1 | 15s |
| Plain insert | 3 (`:561`, `:614`, `:655`) | 3 | 45s — **unchanged** |
| Merge, happy (verify clean) | **6** (+`:835` fresh, `:897` write, `:1018-1019` verify reads) | 3 | **90s = 2×** (matches packet's "~2×") |
| Merge + content/dedupKey heal | 9 (+`:1030` retry + 2 re-verify) | — | 135s |
| Merge + link heal (worst) | **11** (+`:965`,`:968`,`:985` ensure + 2 re-verify) | — | **165s** |
| Substring-guard path | ≤6 (fresh + ensure: `:744`,`:928`,`:968`,`:985`; §I seam records 5 sends, no insert) | 2 | ≤90s |

Ops assessment: **acceptable for the documented deployment** (single process, local Helix; healthy-RTT happy merge = 6 ms-scale round-trips, proven by the §P concurrent block passing in-suite), BUT: all in-lock work now runs under **nested FIFO locks** (`src/store.ts:545-548` outer dedupKey → `:734` inner survivor) with **no queue cap and no server-side request deadline** — tail latency = queue depth × hold (worst hold 165s), unbounded in depth. Hooks/plugin are insulated (1.5s detached / exit 0 — agent never blocks), so blast radius = REST/MCP callers only. This envelope is currently **undeclared in ops terms** → gated by **inherited COND-RS-02** (resilience.md — document queue-wait + these numbers; trigger = P4.3 multi-instance or first observed retry storm). Amplitude note for the ledger: happy-path in-lock hold grew ~2×, worst-path ~3–4× vs pre-lane; `withTimeout` leak-on-timeout (no abort) is pre-existing Low (sibling F6).

### 5) The REAL incident — Helix container restarts mid-lane → behavior ACCEPTABLE → AU-003 (Low)

Evidence: lane incident note `TEST_MATRIX.md:62` (first commit-2 `verify` returned `internal_error` on `health`/`remember` during the container restart window; SDK `fetch failed … Cannot reach Helix`; re-run green **with no code change**); corroborated by sibling reliability FM-006 and resilience findings (real incident → fast 500s, no lockup, green re-run); live: `helix status` → "Up 25 minutes" (uptime reset observed) and current container log start marker "HTTP server listening … 13:47:28" (`helix logs dev`, read-only).

Behavior assessment — **all three ops criteria met**:
- **Fail-closed 500s:** transport/shape errors propagate out of `send()` → generic handler → `500 {"error":"internal_error"}` + log line (`src/server.ts:440-446`); no catch converts failure to 201 (sibling refuter RF-011 confirmed); dedup probe errors propagate so a bounce can never let a duplicate or unverified merge through (`src/store.ts:552-560`, `:601-611`).
- **No lies:** a failed write returns 500, never `consolidated:true`/201; verify-before-response ordering means a bounce between write and verify throws rather than returning unverified success (`src/store.ts:802-809`).
- **Recovery automatic:** FIFO tails settle resolved on every outcome → no queue poisoning (`src/store.ts:517-533`); in-process Maps cannot hold stale locks across the app's own lifetime; next request succeeds when Helix returns — no restart of the REST/MCP service needed. Hooks stay non-blocking throughout (`hooks/capture.mjs:50-51,215`).

Evidence persistence nit (Low, no condition): the app-side 500 log lines from the incident window are stdout-only (destination not captured/documented), and the pre-restart container logs are gone (buffer resets per container start) — the durable record is the in-repo TEST_MATRIX note. Post-restart index-visibility caveat is pre-existing (resilience.md:105), not introduced by this lane.

### 6) Runbook/observability for the named-invariant throws → AU-004 (Medium), gated by inherited COND-RK-02

Ops opinion (my own, aligned with risk RK-004): **failures are greppable, successes are invisible, nobody is told what to do.** The named throws (`REQ-F-01:` at `src/store.ts:989,1037`, `REQ-RL-001:` at `:852,858,866`, `contract §2 fail-closed` elsewhere) sit at message start, survive `logSafeNote`'s 200-char trim (`src/errors.ts:71`), and reach both REST (`src/server.ts:445` → `-> 500: Error: REQ-F-01: …`) and MCP (`src/mcp.ts:144`) logs while the client body stays detail-free `internal_error` (correct). But: `grep -c "console\." src/store.ts` → **0** — detect+heal emits nothing, so an operator cannot see the heal *trend* (the exact signal F-01 exists to surface), and no README/CONTRACT line says what to do on such a 500 (grep runbook/troubleshoot → none). On-call framing: worst case is availability (500), never corruption; retry is safe (converges via substring guard + `ensureConceptLinks`). **This must be documented before ship** — docs-only operator line + accepted-silence declaration = **COND-RK-02 (inherited, not re-issued)**; a one-line allowlisted heal log is a follow-up proposal lane, NOT a hotfix.

### 7) Rollback — reverse-order revert SAFE incl. data plane → AU-005 (Medium), gated by inherited COND-RK-03

Ops verdict on the packet's reasoning — **verified, reasoning holds**:
- Procedure: full reverse-order revert `fb8e661` → `a0257d6` → `01224cc`; each step lands tree-equal to a historically green parent (`a0257d6` bar 243/113, `01224cc` bar 227/104, `a9ef417` pre-lane green); sibling merge-tree probes exit 0 for both code reverts (risk.md evidence log probes 2–3); docs-only revert trivially safe.
- **Data-plane effects of reverting: none.** The diff adds **zero node properties** (`git diff … -- db/queries.ts | grep "addN(\|setProperty(\|PropertyInput"` → empty) and zero indexes/labels/edges → merges already written by the new code are plain `Memory` nodes with the pre-existing property set + ordinary `HAS_CONConcept` edges, immediately valid under old code. The hash algorithm feeding `dedupKey` (`contentHash`/`normalizeContent` in `src/lifecycle.ts`) is untouched by the diff, so merged rows' rewritten keys remain byte-compatible with old-code dedup; old code's `updateMemoryContent` (v1.2) predates the lane and still exists post-revert → old code can read AND further-write every merged row. **No schema change ⇒ no migration, no data backout.** The three new queries become dead code and disappear with their commits; reverse order guarantees no revert step references a removed query.
- The safety defect is documentation, not git: `IMPLEMENTATION_PLAN.md:41-49` still instructs per-commit hunk-level partial rollback, and reverting `01224cc` alone CONFLICTS (sibling merge-tree: exit 1, 5 files) while reverting `a0257d6` with `fb8e661` kept leaves docs claiming CLOSED for reopened behavior → **AU-005, gated by inherited COND-RK-03** (risk RK-005).

## Explicit pipeline / gate-strength lines (required by packet)

- **Pipeline change: NONE.** `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `helix.toml`, and `hooks/` are untouched by `a9ef417..HEAD` (11-file diff enumerated in lens 2). The **Cross-Domain Interface Engineering↔Automation ("pipeline change → security + platform review; gates cannot be weakened without approval") is therefore NOT triggered** — no security/platform review required on pipeline grounds, and no gate weakening occurred, so no approval is owed.
- **Gate strength: RAISED, not weakened.** `docs/CONTRACT.md` §5 bar moved from pre-lane (`a9ef417`) **verify 214 → 243** (+29: `rl-001:` 13 + `f-01:` block) and **verify-lifecycle 104 → 113** (+9: §G `missingConcepts` goldens + §I guard-path heal seam); `verify-capture` 137, `verify-skills` 119, bootstrap **8 indexes**, CI job contents all unchanged (`docs/CONTRACT.md:547-586` vs `git show a9ef417:docs/CONTRACT.md` §5; TEST_MATRIX.md:46-61). The verification bar is strictly stronger than the commit it lands on.

## Findings

| ID | Severity | Finding | Evidence | Mitigation / Condition |
|----|----------|---------|----------|------------------------|
| AU-001 | **Low** | New offline tests (§G/§I) run in Actions, but the RL-001/F-01 E2E acceptance (§P) is local-only by design — and these 3 unpushed commits have **never executed in CI**; first Actions run happens at push | `.github/workflows/ci.yml:22-30` + deliberate exclusion comment `:23-24`; live-only checks `scripts/verify.ts:1491-1568,1619-1717`; local CI-command parity green `TEST_MATRIX.md:48-61` | **COND-AU-01** (confirm first Actions run green at push); E2E gap itself accepted (identity-guarded `scripts/verify.ts:332-351`, §5 bar + reviewer re-runs compensate) |
| AU-002 | **Medium** | Merge path amplifies round-trips up to 2× happy (3→6 sends) / up to 11 sequential sends worst-heal (≤165s at the 15s per-send cap) held under nested FIFO locks with **no queue cap and no request deadline**; `withTimeout` rejects without aborting the in-flight fetch | counts: `src/store.ts:561,614,655,835,897,1018-1019,1030,965,968,985`; cap `:50,410-424`; locks `:517-533,545-548,734`; hooks insulated `hooks/capture.mjs:50-51,215` | **Inherited COND-RS-02** (document envelope + queue depth in ops terms; this table feeds the wording). Acceptable for current single-process/local-Helix deployment; escalate at P4.3 or first retry storm |
| AU-003 | **Low** | Helix-bounce behavior **assessed ACCEPTABLE** (fail-closed 500s, no false success, automatic recovery, no lock poisoning, hooks exit-0) — but incident forensics are weak: app 500 lines are stdout-only (destination undocumented) and pre-restart container logs are lost | incident `TEST_MATRIX.md:62`; 500 path `src/server.ts:440-446`; queue safety `src/store.ts:517-533`; live `helix status` "Up 25 minutes" + log marker "HTTP server listening … 13:47:28"; sibling reliability FM-006 | No condition (backlog): record REST stdout capture destination in the runbook line delivered under COND-RK-02 |
| AU-004 | **Medium** | No runbook/monitoring update for the new named-invariant failure modes: failures greppable by prefix, **successful heals 100% silent**, zero operator guidance | throws `src/store.ts:989,1037,852`; log reach `src/server.ts:445`, `src/mcp.ts:144`, trim-survival `src/errors.ts:71`; `grep -c "console\." src/store.ts` → 0; no runbook (grep README/CONTRACT → none) | **Inherited COND-RK-02** (docs-only operator line + accepted-silence declaration before ship; heal-log code = separate proposal lane) |
| AU-005 | **Medium** | Rollback doc is operationally wrong: documented per-commit partial revert conflicts mid-incident; only the unproven-in-docs reverse-order full revert is safe — while the data plane itself reverts cleanly | `IMPLEMENTATION_PLAN.md:41-49`; sibling merge-tree exit 1 in 5 files (risk.md probe 1); safe-path probes exit 0 (risk.md probes 2-3); no schema change (diff grep empty; 8 indexes `db/queries.ts:127-157`) | **Inherited COND-RK-03** (replace Rollback Points with the proven reverse-order procedure + conflict warning) |

## Conditions

**Issued:**

- **COND-AU-01** (AU-001) — **First-CI-run evidence for this lane.** At ship-release push, confirm the `CI` workflow run is green on the pushed head: job `verify` (typecheck, verify-injection, verify-lifecycle **113**, verify-capture 137, verify-skills --structural 73) + job `secret-scan` (gitleaks). Local re-runs of the identical commands are already green (TEST_MATRIX.md:48-61), so this is a confirm-step, not remediation. If red → investigate, retry N=2 differently, then escalate — no third loop. Verifiable as: Actions run URL + head SHA recorded in the ship-release notes by this role.

**Inherited (gate my findings, not re-issued):** **COND-RS-02** (→AU-002: declare queue-wait/latency envelope — use the AU-002 table), **COND-RK-02** (→AU-004: operator runbook line + silent-heal posture; may also carry AU-003's stdout-capture note), **COND-RK-03** (→AU-005: correct the Rollback Points to reverse-order full revert).

## Verdict rationale

- **pass not met** — ops checklist has two unchecked items (monitoring/alerting, runbook), the documented rollback procedure conflicts under incident pressure, the amplified latency envelope is undeclared, and CI has no execution record for these commits.
- **fail not met** — pipeline/dependency/index surfaces are byte-identical; the §5 bar was raised; the real Helix-bounce incident proved fail-closed + automatic recovery with a green re-run and no code change; full reverse-order rollback is proven fast with **zero data-plane backout** (no schema/index/property change, hash algorithm untouched, merged rows valid under old code); every gap is availability-capped (throw → 500, hooks exit-0) with a cheap owned mitigation.
- **conditional** = residual ops risks real, each with an available mitigation and an owner ⇒ ⚠️, gated by **COND-AU-01** + inherited **COND-RS-02 / COND-RK-02 / COND-RK-03**.

## Evidence log (allowlisted — statuses/counts only)

| Run / probe | Target | Result |
|-------------|--------|--------|
| `git diff --name-status a9ef417..HEAD` | repo | 11 files, all `M`; no `package.json`/`package-lock`/`.github`/`helix.toml`/`hooks` |
| `git diff a9ef417..HEAD -- db/index.ts` | re-exports | +6 lines, query re-exports only — no index |
| `createIndexIfNotExists` count | `db/queries.ts` | **8** (`:127-157`) — migration not needed |
| `git diff … -- db/queries.ts \| grep addN/\|setProperty/\|PropertyInput` | schema | empty — no new node property/edge/index |
| §5 old vs new counts | `git show a9ef417:docs/CONTRACT.md` vs HEAD | verify 214→**243**, lifecycle 104→**113**, capture 137=, skills 119= — **RAISED** |
| `GET /memory/livez`, `GET /memory/health?project=review-automation` | live `:3151` | 200 ok; `memories:0, sessions:0` (zero write probes by this review — nothing to forget) |
| `helix status` / `helix logs dev` | `:6969` read-only | Up 25 minutes, storage disk; current-container start marker "HTTP server listening 13:47:28"; never restarted/stopped |
| Incident evidence | in-repo | `TEST_MATRIX.md:62` restart-window note → re-run green, no code change |
| Rollback analysis | sibling read-only `git merge-tree` (risk.md log) | partial `01224cc` revert exit 1 (5 files); full reverse-order steps exit 0/0 |
| Upstream `:3111` | — | untouched |
| Files modified by this review | repo | **only this report** |

## Findings summary

Critical: 0 · High: 0 · Medium: 3 (AU-002, AU-004, AU-005) · Low: 2 (AU-001, AU-003) · Conditions issued: **COND-AU-01** (inherited: COND-RS-02, COND-RK-02, COND-RK-03)

**Overall verdict: ⚠️ conditional.**
