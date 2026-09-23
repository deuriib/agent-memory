# Release Notes: v0.5.0

**Date:** 2026-09-23
**Release Manager:** orchestrator (frame-ship lane; ship mechanics by the
operations function per ship-release role binding — role assumption stated
for this lane)
**Specs Included:** P1 remainder (P1.4 derived confidence + P1.2 tier-1
consolidation + P1.5 eval harness) + P3.2 skill set — `ROADMAP.md` §P1 + §P3
**Domains-Touched:** engineering, automation/ops, data lens, docs
(finance / legal / marketing / people / revenue: **N/A** — code+docs lane)
**Ship Type:** deploy (local library/server release; no external deployment
target; additive API — one behavior change: omitted `importance` is derived)

## Highlights

- **Derived confidence (P1.4)** — `importance` omitted by the caller is
  computed from provenance + structure (lesson 0.75 / `hook:*` 0.55 / else
  0.5 base + 0.025·min(concepts,8), clamp01) instead of defaulting to `0.5`;
  the fused tie-break applies a recall boost AFTER decay over an in-process
  ledger (per-process, cap 10k); explicit caller values always win; the
  OpenCode plugin no longer pins a client-side `0.5`.
- **Tier-1 consolidation (P1.2)** — near-duplicates (Jaccard ≥
  `AGENT_MEMORY_MERGE_JACCARD`, default 0.9, fail-closed OFF on bad config)
  merge into ONE survivor: content concatenated (substring guard closes the
  re-merge loop), `embedding`/`dedupKey` rewritten in place, survivor
  `memoryId` stable, response gains `consolidated:true`; TTL-expired
  survivors are excluded from the probe. probe4 proved the in-place rewrite
  refreshes both text and vector indexes (VERDICT A, 12 checks).
- **Eval harness (P1.5)** — adapter-pluggable `EvalClient` (`EVAL_MODE`),
  deterministic in-repo corpus (40 docs / 15 queries + qrels, zero network),
  R@5/R@10/MRR@10/nDCG@10 for bm25 + hybrid, our own numbers in
  `docs/benchmarks/SCORECARD.md` (corpus-specific, disclaimed on its face;
  metric math regression-tested by `verify-lifecycle` §H goldens).
- **Skill set (P3.2)** — 8 invocable skills (`recall`, `remember`, `recap`,
  `handoff`, `forget`, `lesson`, `commit-context`, `session-history`),
  contract-accurate tables + examples, indexed by `skills/memory/SKILL.md`;
  `verify-skills` structurally validates all 8 (server-free `--structural`
  mode, CI-wired) and live round-trips every frozen route (119 checks).

## Changes

### Features

- Derived confidence — provenance-derived `importance` + recall-boost
  tie-break (P1.4 / REQ-P1-4, engineering)
- Tier-1 consolidation — near-dup merge into one survivor with in-place
  index-fresh rewrite (P1.2 / REQ-P1-2, engineering)
- Adapter-pluggable eval harness + in-repo corpus scorecard (P1.5 /
  REQ-P1-5, automation/ops)
- Eight invocable skills + structural/live skill gate (P3.2 / REQ-P3-2,
  docs/automation)

### Fixes

- **Gate P1R-P32 remediation — 16/16 conditions closed:** hand-computed
  eval-metric goldens (`verify-lifecycle` §H), decay-THEN-boost order golden
  (§F-bis), induced probe-failure fail-closed test (§I), MCP adapter
  pass-through test + plugin no-default source check, TTL×expired-survivor
  guard on the merge probe, `probe4` log-line hardening (CWE-117),
  corpus-specific scorecard disclaimer + actual-URL reproduce block,
  `verify-skills --structural` server-free mode wired into CI, and the full
  declaration set (concurrency exception, atomicity assumption, TTL×merge,
  merge provenance, index dependency, session run budget, eval retention)
  (engineering, docs, automation/ops — evidence: `50_archive/P1R-P32/GATE_REPORT.md`)

### Domain Ships

- Automation/ops: CI gains `verify-skills --structural` (73 checks, no
  server) — `.github/workflows/ci.yml`
- Data lens: retention/deletion declared for `agent-memory-eval` and
  `verify-skills` sessions (CONTRACT §5) + Concept-orphan re-baselined
  (`ROADMAP.md` §1.3)
- Finance / Legal / Marketing / People / Revenue: N/A (code + docs lane,
  no external surface touched)

### Breaking Changes

- **None breaking** — no route or MCP tool renames; `RememberResult
  .consolidated` is additive; README/INSTALL/MIGRATION templates are
  conditional on breaking changes → cited, not required (no `INSTALL.md` /
  `MIGRATION.md` exists in this repo).
- Behavior-change compat note (not breaking): an OMITTED `importance` is now
  derived from provenance instead of defaulting to `0.5`. Callers wanting
  the legacy value must send `importance: 0.5` explicitly; undo = send the
  explicit value, **no data migration** (stored rows are never rewritten by
  this change).

## Known Issues

- Six accepted residuals from gate P1R-P32, each with owner + expiry:
  W-1 concurrent distinct-variant lost append (engineering, 2026-12-31 or
  P4.3), W-2 merge mid-batch atomicity assumption (engineering, Helix
  upgrade or 2026-12-31), W-3 Concept-orphan (engineering, 2026-12-31 or
  v0.6.0), W-4 `verify-skills` Session residue (engineering, P4.1 or
  2026-12-31), W-5 write-path probe coupling (engineering, 2026-12-31),
  W-6 base-URL echo into logs/scorecard (ops, next eval touch) — full
  three-block waivers in `docs/specs/50_archive/P1R-P32/GATE_REPORT.md` C3;
  W-1…W-3 also tracked in `ROADMAP.md` §1.3. Workarounds: single-writer
  local contract, `bootstrap` before first write, localhost-only
  `AGENT_MEMORY_URL`.

## Contract

`docs/CONTRACT.md` v1.1 → **v1.2**: derived-importance default replaces
`importance=0.5`, `RememberResult.consolidated`, tier-1 merge semantics +
gate P1R-P32 declarations (concurrency exception, atomicity assumption,
TTL×merge guard, merge provenance, index dependency), recall-boost tie-break
order, `updateMemoryContent` in §2, probe4 fact in §0. Backward compatible:
additive response fields, no route/tool renames.

## Verification

`typecheck` 0 · `verify-lifecycle` **104/104** · `verify` **214/214** (3151) ·
`verify-skills` **119/119** (+ `--structural` 73/73) · `probe4` 12 (VERDICT A)
· `eval` EVAL PASS · `verify-capture` 115 · `verify-injection` 73 ·
`verify-env` 21 · `purge` usage guard exit 2 · counts in `TEST_MATRIX.md`.

## Quality gate

9 independent reviewers → 3 pass / 6 conditional / 0 closed; all conditions
fixed or waived with owner + expiry → gate **OPEN**:
`docs/specs/40_workspace/quality-gate/P1R-P32/GATE_REPORT.md`.

## Rollback / Undo

Six separable commits (`df39d7d`, `591c79c`, `39fec28`, `c69636d`,
`2deda68` + gate remediation) — revert to `d17294b` restores v0.4.0
behavior; merged rows in the dev instance are seed/verify data only.

---

# Release Notes: v0.4.0 (previous)

**Date:** 2026-09-23
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the operations function per ship-release role binding — stated as the role
assumption for this lane)
**Specs Included:** P1 (P1.1 + P1.3 + P1.6) + P2.1 — `ROADMAP.md` §P1
"Recall quality & lifecycle" + §P2 "Capture breadth"
**Domains-Touched:** engineering, security, automation/ops, data lens
(finance / legal / marketing / people / revenue: **N/A** — code+docs lane, no
such surface in the diff)
**Ship Type:** deploy (local library/server release; no external deployment
target; no breaking changes → README/INSTALL/MIGRATION templates cited, not
required)

## Highlights

- **Recall quality** — explicit `concepts` win verbatim, and a save without
  them now derives a deterministic top-8 concept set, so plain saves feed the
  concept-graph branch of hybrid search — proven live: the derived-concepts
  graph branch contributes fused score == **3/61** (`scripts/verify.ts`
  D-section).
- **Write-side dedup, first-wins** — saving the same fact twice returns the
  existing id with `deduped:true` and creates one retrievable row; Helix does
  not enforce unique indexes, so uniqueness is application-side under a
  per-key FIFO lock — decision record:
  `docs/adr/ADR-0001-application-side-dedup-uniqueness.md`.
- **Memory lifecycle (corte A, opt-in)** — TTL hides expired rows from both
  searches with an explicit `ttl: hidden N expired rows` signal; read-time
  decay (`importance · e^(−λ·ageDays)`) is a fused tie-break only — stored
  `importance` never mutates; `scripts/purge.ts` is the fail-closed governance
  CLI (`--days/--project|all/--dry-run`). Both env knobs default **OFF**.
- **Hook breadth** — all 7 `capture.mjs` events plus the OpenCode plugin's
  `tool.execute.before` observe; prompt text is **never** stored (privacy
  canary asserted non-stored, `verify-capture` 115/115).
- **Quality gate OPEN** — 9/9 dedicated reviewers pass after 3 remediation
  rounds, 10/10 conditions cleared, waivers W1/W2 recorded with the
  three-block bar; final evidence: typecheck 0 · verify **152/152** ·
  lifecycle **39/39** · capture **115/115** · injection **73** · env **21/21** ·
  probe3 GREEN · bootstrap 8 indexes · purge dry-run + usage guards exit 2 ·
  demo OK.

## Changes

### Features

- Auto concept extraction: `src/concepts.ts` (deterministic top-8, tf → lex
  tie-break, stopwords dropped) + `src/embed.ts` `tokenize` export; derivation
  only when `concepts` is absent (explicit wins verbatim) (P1.3 / REQ-P1-3,
  engineering)
- Write-side dedup: `dedupKey = sha256(project + "\n" + normalize(content))`
  property + index #8 + `findMemoryByDedupKey` + `remember()` pre-check under
  the per-key in-process FIFO lock; a hit returns the existing row with the
  additive `deduped:true` field (P1.6 / REQ-P1-6, engineering)
- Memory lifecycle: `src/lifecycle.ts` decay/TTL pure functions + fused
  tie-break integration in `src/search.ts` + `scripts/purge.ts` governance
  CLI (`AGENT_MEMORY_TTL_DAYS` / `AGENT_MEMORY_DECAY_LAMBDA`, default OFF)  (P1.1 / REQ-P1-1, engineering/ops)
- Hook coverage: `capture.mjs` 3 → 7 events (`PostToolUseFailure`,
  `PreCompact`, `SessionEnd`, `UserPromptSubmit`) + OpenCode plugin
  `tool.execute.before` observe (fire-and-forget, own `memory*` tools
  skipped) (P2.1 / REQ-P2-1, engineering/security)
- `docs/CONTRACT.md` v1 → v1.1: §0 probe3 facts, §1 `dedupKey` + index #8,
  §2 new exports, §3 dedup/decay/TTL/hook semantics + single-writer
  assumption, §4 decay removed from do-not-build, §5 verification bar
  (REQ-P1-1/P1-3/P1-6/P2-1, engineering)
- `docs/adr/ADR-0001-application-side-dedup-uniqueness.md` — first ADR of the
  repo, required by the contract change v1 → v1.1 (engineering)
- Version 0.4.0 lockstep across all 6 carriers: `package.json`,
  `package-lock.json` root + `packages[""]`, `src/mcp.ts`, plugin `VERSION`,
  README badge (engineering, this release)
- Docs sync: CHANGELOG v0.4.0 entry, README (env knobs, purge, 7 events,
  verification counts, badge), ROADMAP P1.1/P1.3/P1.6/P2.1 ticks, TEST_MATRIX
  T-101..T-108 (engineering)
- CI gains `verify-lifecycle` + `verify-capture` jobs in
  `.github/workflows/ci.yml` alongside typecheck / verify-injection /
  sha256-pinned gitleaks secret-scan (automation/ops)

### Fixes

- CWE-117 newline forgery in purge governance/audit lines — print-side
  `oneLine()` normalizer extracted to `src/logline.ts` + 5 CI assertions in
  `verify-lifecycle` section E (gate COND-004 / COND-007, security)
- Store dedup pre-check now fails **closed** on shape drift — a transport
  error or a response missing the frozen `memory` return throws instead of
  being read as a miss (gate resilience F1, engineering)
- Purge failure paths write an allowlisted single-line `status=partial` audit
  record before exit 1 whenever deletions happened, plus per-batch
  `purge-progress` (gate COND-006, automation/ops)
- Doc-truth corrections: falsified `contentHash` docstring + nonexistent-test
  citations, plan/README false-pointer cells, `dedayImportance` →
  `decayedImportance` typo — class swept to 0 instances across all six docs
  (gate COND-005 / COND-008 / COND-010, engineering)

### Domain Ships

- **Security:** SEC-01 (CWE-117) + SEC-02 both FIXED-VERIFIED by the
  independent security reviewer — path:
  `docs/specs/50_archive/P1-P21/security-reviewer.md`; SEC-03/SEC-04 (Low)
  tracked with owner + expiry (P1-P21)
- **Automation/ops:** `verify-lifecycle` + `verify-capture` wired into CI and
  green; waiver **W1** pre-merge condition stands — first sha256-pinned CI
  `secret-scan` run green at/after `9210208`, owner: orchestrator (P1-P21)
- **Data:** `dedupKey` lineage documented (CONTRACT §1 — hash never leaves
  store projections), no backfill by design (probe3 a3-2: legacy nodes  missing the property are harmless), Concept-orphan finding DAT-001 tracked
  with owner + expiry (P1-P21)
- **Engineering:** gate record
  `docs/specs/50_archive/P1-P21/GATE_REPORT.md` (**OPEN** — 9/9 pass,
  COND-001..010 cleared, W1/W2 three-block) +
  `docs/specs/50_archive/P1-P21/HANDOFF.md` (Status: complete) + ADR-0001 for
  the contract change (P1-P21)

### Breaking Changes

- **None — additive; no behavior removed or renamed.** Behavioral notes:
  - Repeat saves return the **first** row (first-wins): a dedup hit creates no
    second row and no `Session` node — sessions materialize on novel writes
    only; tests asserting "one new row per save" must expect the first id.
  - `remember` / `lesson` responses gain the additive `deduped` boolean field
    (201 bodies now carry it).
  - Two new env knobs exist — `AGENT_MEMORY_TTL_DAYS` and
    `AGENT_MEMORY_DECAY_LAMBDA` — both default **OFF**: unset ⇒ behavior
    identical to v0.3.0 (opt-in, no ranking/hide surprises).
  - `capture.mjs` now accepts **7** events (was 3): hosts wired to
    `PostToolUseFailure` / `PreCompact` / `SessionEnd` / `UserPromptSubmit`
    start capturing — teams asserting event **silence** for those names must
    update expectations (in-repo suite asserts all 7 already).
  - Migration guide **N/A**: README/INSTALL/MIGRATION templates cited, not
    required (ship-type `deploy` without breaking changes). Undo path:
    rollback plan below.

## Known Issues

- **W1 — pre-merge condition (owner: orchestrator):** local gitleaks was
  unavailable this session (2× download timeout, escalated); do not merge
  until the first CI `secret-scan` run green at/after `9210208`.
  Compensating control: the sha256-pinned gitleaks job was untouched by this
  lane (`.github/` diff `eb279a6..83e2f3a` = 0 lines).
  **RESOLVED (2026-09-23):** first green run = `35830679212` (commit
  `69a9a8d`, job success); the 2 first-run findings were reviewed
  fingerprint-scoped false positives — dedup golden test vectors, recomputation
  proof in the `69a9a8d` commit body.
- **W2 — purge has no Helix request timeout** (accepted risk; the SDK exposes
  none): compensating controls = fail-closed arg guard, `BATCH_LIMIT` /
  `MAX_BATCHES` bounds, per-batch `purge-progress`, operator Ctrl-C;
  re-review at v0.5.0 or 2026-12-22, whichever first — owner: engineering.
- **Tracked findings (owner + expiry each)** → table in
  `docs/specs/50_archive/P1-P21/GATE_REPORT.md`: DAT-001 (Concept orphans on
  forget, Medium), T-107/T-108 (route-level TTL / λ-on E2E coverage gaps,
  Medium), SEC-03/SEC-04 (Low), plus RL-004/RL-007 and hygiene rows —
  expiries 2026-10-31 / v0.5.0 unless the row says otherwise.
- **Single-writer-process assumption** — application-side dedup is sound only
  within ONE writer process; cross-process writers to one Helix instance are
  out of contract (CONTRACT §3 "Single-writer assumption"; multi-instance =
  ROADMAP P4.3) — owner: engineering.

## Rollback / Undo

- **Code:** revert the feature range `1c410ee..97e9d9b` — 10 commits:
  `b27364b` (REQ-P1-3) → `101e063` (REQ-P1-6) → `45380b5` (REQ-P1-1) →
  `8fbd795` (REQ-P2-1) → `6f7f708` (v0.4.0 lockstep + CI) → `eb279a6`
  (contract v1.1) → `9210208` + `83e2f3a` (gate remediation) → `d59d23a`
  (gate OPEN) → `97e9d9b` (handoff + ADR) — plus the release commit appended
  at ship; or check out tag **`v0.3.0`** for a full undo. Version markers
  return to 0.3.0 (README badge, `package-lock.json`, `src/mcp.ts`, plugin
  `VERSION`, `package.json`).
- **Additive-inert by design:** old code ignores the `dedupKey` property and
  index #8 — the repo has no index-drop (`bootstrapIndexes` only creates), so
  a bootstrapped instance keeps an orphaned, unused unique index, which
  probe3 proved is inert; both env knobs are OFF by default, so a revert is
  behavior-neutral; **no destructive backfill ran** — legacy rows were never
  rewritten. Per-step points (`IMPLEMENTATION_PLAN.md` "Rollback Points"):
  step 1 revert `src/concepts.ts` + store/embed hunks (no schema touched);
  step 2 revert `db/queries.ts` + store dedup hunks (index orphaned, not
  dropped; `deduped` removal is additive-reversible); step 3 revert
  `src/search.ts` + `src/lifecycle.ts` + `scripts/purge.ts` (defaults OFF ⇒
  no live behavior change); step 4 revert `capture.mjs` + plugin registration
  + `verify-capture.ts` (per-event exit-0 guarantee preserved).
- **Data:** none needed — dev-instance data is seed/verify data (probe writes
  isolated to `probe-p1-*` projects); no production data risk.
- Owner: engineering owner + orchestrator. ETA: immediate.

## PII checkpoint (Ley 172-13)

Zero PII/secrets/tokens in this release or these notes — allowlisted evidence
only (suite counts, commit SHAs, paths, verdicts, owners by role); prompt-text
canary asserted non-stored (`verify-capture` 115/115); hook observations are
fixed-string/tool-name only; wide disclosure: none.

---

# Release Notes: v0.3.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the owning domain owner / operations function per ship-release role binding —
stated as the role assumption for this lane)
**Specs Included:** P0 — `ROADMAP.md` §2 "Publishable foundations"
(REQ-P0-1..6)
**Domains-Touched:** engineering, security, legal, automation/ops
**Ship Type:** deploy (no breaking changes → README/INSTALL/MIGRATION
templates cited, not required)

## Highlights

- **Publishable foundations** — Apache-2.0 `LICENSE` + matching `package.json`
  `"license"` field, plus a CI gate (typecheck + verify-injection + pinned
  gitleaks v8.30.1 secret scan) green on `main` across 5 runs
  (35781376642, 35781958949, 35784838135, 35786040704, 35787110447).
- **Durable persistence default** — `storage = "disk"` in `helix.toml`, so a
  plain `helix start dev` survives restarts; proven by the restart canary
  artifact (`docs/specs/50_archive/P0/evidence/p0-4-restart-canary.log`:
  BM25 hit on attempt 1 post-restart, `RESULT: PASS`).
- **Legacy env acceptance** — servers started under old `AGENTMEMORY_*` names
  keep working: name-only warning on server/MCP/bootstrap (never prints
  values), bearer guard armed, hooks stay silent.
- **Port ownership settled** — `EADDRINUSE` prints the reroute hint
  (`AGENT_MEMORY_PORT=3151`, never kill the upstream); README states
  definitively which port is ours.
- **Quality gate OPEN** — 9 dedicated reviewers; trail CLOSED → CONDITIONAL →
  OPEN with all 15 conditions closed and both ❌ verdicts cleared on scoped
  recheck; waivers W1..W6 recorded with owners, compensating controls, and
  expiries.

## Changes

### Features

- `LICENSE` (Apache-2.0) + `package.json` `"license": "Apache-2.0"` as the
  license of record (P0 / REQ-P0-1, legal)
- `.github/workflows/ci.yml` — typecheck + verify-injection + pinned gitleaks
  v8.30.1 secret scan on every push/PR (P0 / REQ-P0-2, automation/ops)
- `SECURITY.md` + `CONTRIBUTING.md` governance docs, linked from README
  alongside `CHANGELOG.md` (P0 / REQ-P0-3, security)
- Durable persistence default `storage = "disk"` in `helix.toml` + bootstrap
  advisory warning when the key is missing (P0 / REQ-P0-4, engineering)
- Legacy `AGENTMEMORY_*` acceptance: name-only warning + armed guard, with
  `scripts/verify-env.ts` as the proof harness (P0 / REQ-P0-5, engineering)

### Fixes

- `EADDRINUSE` dead end → actionable reroute hint (`AGENT_MEMORY_PORT=3151`,
  never-kill-upstream note) + README `## Known limitations` port-ownership
  statement (P0 / REQ-P0-6, engineering)

### Domain Ships

- **Legal:** `LICENSE` (Apache-2.0) shipped + 248-package manual license scan
  with zero copyleft hits — path: `docs/specs/50_archive/P0/legal-reviewer.md`
  (LGL-004; residual under waiver W1) (P0 / REQ-P0-1)
- **Automation/ops:** CI on `main` all green — runs 35781376642, 35781958949,
  35784838135, 35786040704, 35787110447 all `conclusion=success`
  (P0 / REQ-P0-2)
- **Security:** gitleaks pinned at v8.30.1 (sha256-verified, fingerprint-scoped
  `.gitleaksignore`) + governance docs `SECURITY.md` / `CONTRIBUTING.md` —
  path: `docs/specs/50_archive/P0/security-reviewer.md`
  (P0 / REQ-P0-2, REQ-P0-3)
- **Engineering:** gate record `docs/specs/50_archive/P0/GATE_REPORT.md`
  (**OPEN**), waivers `docs/specs/50_archive/P0/WAIVERS-P0.md` (W1..W6), and
  handoff `docs/specs/50_archive/P0/HANDOFF.md` (Status: complete) archived
  together with the nine reviewer artifacts (P0)

### Breaking Changes

- **None — no behavior removed or renamed.** Migration guide **N/A**:
  README/INSTALL/MIGRATION templates cited, not required (ship-type `deploy`
  without breaking changes). Undo path: rollback plan below.

## Known Issues

- **Waivers W1..W6 active** — W1: no license/CVE scan in CI; W2: `verify-env`
  not gated in CI/PR bar; W3: no backup/DR automation + advisory false
  negatives; W4: gitleaks same-origin checksum + tag-pinned actions; W5:
  precedence/backstop tests deferred; W6: empty-new-name divergence across
  surfaces. Expiry: **2026-12-21** or the named milestone (P1..P4), whichever
  first; re-review owners per waiver — full text:
  `docs/specs/50_archive/P0/WAIVERS-P0.md`. Compensating controls documented
  in README (durability & recovery, never-empty, split-brain guidance).
  Owner: domain owners + orchestrator.
- **~50 Low findings** → roadmap backlog — non-blocking per severity
  guardrail; owner: orchestrator (triage).

## Rollback / Undo

- **Code:** `git revert` of the P0 delivery + release merge range, or check
  out tag `v0.2.0` for a full code undo — no schema, index, or migration
  change; version markers return to 0.2.0.
- **Archive undo:** reverse `git mv` restoring `50_archive/P0/` to its
  pre-archive lane under `docs/specs/40_workspace/` — exact source paths
  recorded in `docs/specs/50_archive/P0/ARCHIVE-RECORD.md`.
- Owner: engineering owner + orchestrator. ETA: immediate.

---

# Release Notes: v0.2.0

**Date:** 2026-09-22
**Release Manager:** orchestrator (frame-ship lane; ship mechanics executed by
the engineering-specialist function, per `agents/orchestrator.md` +
`agents/vasquez.md` delegation — stated as the role assumption for this lane)
**Specs Included:** P3.1 — ROADMAP.md §P3 "MCP tool parity for the useful subset"
**Domains-Touched:** engineering, security, data lens
**Ship Type:** deploy (local library/server release; no external deployment target)

## Highlights

- **MCP/REST parity for the useful subset** — `recap`, `handoff`, `lesson`,
  and governance-style `delete` now exist on both surfaces over the same
  `MemoryStore`: 12 REST routes, 11 MCP tools, one contract.
- **Every feature round-trips** — `npm run verify` proves the full chain
  (lesson → search with `origin:"lesson"` → recap membership → handoff
  header/counts → governed delete with receipt → gone → second delete 404 →
  counts) at **102 passed, 0 failed → VERIFY PASS**.
- **Gate-hardened before ship** — 8 independent reviews + a 17-row C3
  interrogation produced real fixes: log-forgery sanitize, an upstream identity
  guard in `verify`, a shared digest module with a 20s fan-out budget, and a
  declared PII allowlist/masking rule for the governance log.

## Changes

### Features

- `POST /agentmemory/recap` — deterministic session/project digest, per-source
  `signals[]` degradation, never 500 (P3.1, engineering)
- `POST /agentmemory/handoff` — recap + `healthCounts` as next-agent context
  block (P3.1, engineering)
- `POST /agentmemory/lesson` — remember with server-forced
  `origin="lesson"`, strict body (extra `origin` → 400) (P3.1, engineering)
- `POST /agentmemory/delete` — governance delete: required single-line
  `reason` (1..1000), receipt `{memoryId, deletedAt}`, 404 `{error:"not_found"}` (P3.1, engineering)
- MCP tools `memory_recap`, `memory_handoff`, `memory_lesson`,
  `memory_delete` — same envelopes behind the unchanged
  `_meta.authorization` gate; surface 7 → 11 (P3.1, engineering)
- `src/digest.ts` — shared digest builder for both lanes with
  `DIGEST_BUDGET_MS = 20_000` + `digest: budget exceeded` signal (P3.1 gate
  COND-005, engineering)
- `CHANGELOG.md` — Keep-a-Changelog history created (ship-release step 3;
  resolves the changelog open item routed from verify-handoff)

### Fixes

- Governance log forgery via embedded newlines in `reason`/`memoryId` —
  normalized to one line before logging, both lanes (P3.1 gate COND-001,
  security; findings RK-P31-1 / CE-001 / SEC-001 / DAT-001)
- `npm run verify` no longer writes test rows into a foreign instance —
  read-only identity probe before the first write aborts with the
  `AGENT_MEMORY_URL` instruction (P3.1 gate COND-002, engineering; finding
  RK-P31-7, High)
- MCP delete input schemas advertise `minLength`/`maxLength` again
  (bounds on both sides of normalize) (P3.1 gate C3-R17, engineering)
- Recap asserts per-bullet session membership, not just an echoed id
  (P3.1 gate COND-004, engineering; finding CE-003)

### Domain Ships

- **Quality gate: OPEN** — 4 pass + 4 conditional-with-conditions-cleared,
  C3 17/17 PASS, waivers W1–W4 (three-block bar, expiring 2026-12-21).
  Record: commits `0fe0b97` (gate report, 8 reviews, C3) and `e9b0504`
  (handoff) — paths at those commits: the P31 quality-gate lane under
  `docs/specs/40_workspace/` (workspace purged at archive
  per ship-release hygiene; history is the record).
- **Security:** governance log declares purpose, store, retention/deletion,
  field allowlist + masking rule (P3.1 gate COND-003 + C3-R13,
  `f2a65d4` + `d7a7628`); zero secrets/content in logs verified by review.
- **Data:** contract §1/§2 and `db/queries.ts` byte-untouched — no new
  labels, edges, indexes, or migration (data review, PASS).

### Breaking Changes

- **None — additive.** Behavioral note: clients asserting *exactly 7* MCP
  tools now see 11; update count assertions (in-repo assertions already
  updated). Migration path: none required. Undo path: revert range below.

## Known Issues

- **MCP behavioral round-trip unasserted in E2E** (QA F-4, accepted with
  shared-digest mitigation) — workaround: handshake probe covers registration;
  recommend a stdio harness in P3.x — owner: engineering.
- **Upstream residue:** a pre-guard verify run wrote project
  `verify-18637b3b` into the user's upstream `agentmemory` (port 3111); the
  upstream instance is currently down. Purge when it's back: enumerate
  `GET /agentmemory/sessions?project=verify-18637b3b` → per-session
  memories → `POST /agentmemory/forget {memoryId}` each → health 0.
  Recurrence prevented by the identity guard — owner: user/deploying
  operator.
- **ESC/NUL advisory gap:** sanitize collapses whitespace but not
  `ESC`/`NUL` control chars in `reason` (no forgery primitive — no ANSI
  decoding in the log path) — owner: engineering, re-review with W1 expiry.
- **MCP lane strips unknown keys** instead of 400-rejecting (SDK-mediated;
  REST strict-rejects; `origin` server-forced both lanes) — accepted, waiver
  W1 — owner: security re-review 2026-12-21.

## Rollback / Undo

- **Code:** `git revert` of the release commit reverts docs/version; the
  feature range is `e9fd325..` (14 P3.1 commits) + release commit. Pure
  revert — no schema, index, or migration change; `origin:"lesson"` rows
  persist as inert data; version markers return to 0.1.0. Owner:
  engineering owner. ETA: ≤15 min (risk review, RK rollback analysis).
- **Data undo:** none needed — no backfill; delete receipts are audit-only.
- **Non-code undo:** restore prior README/CONTRACT wording via the same
  revert; no comms/filings/launches exist for this ship.

## Documentation audit (ship-release step 4)

- `README.md` — version badge v0.2.0, CHANGELOG/release-notes links,
  P3.1 route/tool tables + examples already synced (verified this release).
- `CHANGELOG.md` — created; `[v0.2.0] — 2026-09-22` entry.
- `INSTALL.md` — **N/A-justified:** README Quick start is the install guide;
  every command in it (helix/bootstrap/dev/verify) executed successfully this
  session. Owner: engineering.
- `MIGRATION.md` — **N/A-justified:** no breaking changes (additive release).
- Version lockstep — manual 3-marker sync (this repo has no
  `scripts/bump-version.mjs`; N/A script): `package.json`,
  `.opencode/plugins/agent-memory.ts` `VERSION`, `src/mcp.ts` `McpServer`
  version → all `0.2.0`. Zero remaining `0.1.0` markers (grep-verified).
- `docs/specs/` lifecycle — **no backlog spec to archive (N/A-justified):**
  P3.1 originated in ROADMAP.md, not a `20_backlog/SPEC-*.md`; the lane
  record is ROADMAP (marked done) + history (`33849ee..e9b0504`).
  `40_workspace/` purged at release per ship-release hygiene.

## Verification (pre-ship, this release)

- `npm run typecheck` → clean (no `any`, no `@ts-ignore`, no TODO/FIXME).
- `npm run verify` (target: our server, `AGENT_MEMORY_URL=…:3151`) →
  **102 passed, 0 failed → VERIFY PASS**.
- MCP handshake → exactly 11 tools, delete schemas advertise bounds.
- Plain `npm run verify` (no `AGENT_MEMORY_URL`) → identity-guard abort,
  exit 1, zero writes.
