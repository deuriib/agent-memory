# Legal Review: BRAINY-V1 (post-implementation gate)

**Reviewer:** legal-reviewer (legal owner, independent — did not author the artifacts under review)
**Date:** 2026-09-25
**Verdict:** conditional
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-005-brainy-legal.md#REQ-BRAINY-LEG-01..09 / HARD:subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+evidence-allowlist / GATE:pending / DOMAINS:R4 (lead),R2,R1,R8,R5`
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD` (remediation commits `2a6bf20`, `e1c541a`, `5ee1728`, `a79643c`, `2232087`). Read-only methods: `git show/log`, greps, `npm run typecheck` (0 errors), `npx tsx --test tests/ttl.test.ts` (6/6 pass). No containers, no ports touched, no files modified except this artifact.

## Checklist

- [x] Contracts affected identified (`docs/CONTRACT.md` v1.8 amendment)
- [x] IP ownership clear (Apache-2.0 continuity, no new deps)
- [x] Regulatory compliance verified (LEG-01..09 table below)
- [x] Licensing implications reviewed (zero dep delta)
- [x] Liability exposure assessed (S-LEG-001/002 rulings below)
- [x] Terms of service updated (n/a — no ToS surface in v1)

## 1. CDR-01..04 remediation proof

| CDR | Required change (proposal `a289ca0` + R2 `2a6bf20` + R1 `e1c541a`) | File:line / commit | HOLDS/FAILS |
|---|---|---|---|
| CDR-01 (CONTRACT Note declaration + SLA home) | v1.8 amendment quoting SPEC-005 §4.1 verbatim (purpose/TTL/deletion numbers, CDR-01-C1) + ARCO SLA line naming owner `subero` + orchestrator escalation (CDR-01-C2) | `docs/CONTRACT.md:19-25` (6 numbered clauses), commit `a79643c`; SLA at `:24` ("acknowledge within ≤5 business days and resolve within ≤15 business days; owner `subero`; any delay beyond triggers escalation to the orchestrator") | **HOLDS** — `grep -n "Note.content\|Memory.statement" docs/CONTRACT.md` → ≥2 (`:19` declaration + `:762` compat row); `grep -n "BRAINY_TTL_DAYS" docs/CONTRACT.md` → ≥1 (`:22` + `:780` alias table). Both R2 greps pass. |
| CDR-02 (canonical TTL wiring) | `src/lifecycle.ts:117` legacy-only read → canonical-first `BRAINY_TTL_DAYS` → alias fallback + single static warning, mirroring `secretFromEnv` (CDR-02-C1); both-knobs + OFF fixture evidenced (CDR-02-C2) | `src/lifecycle.ts:46-70` (`ttlDaysFromEnv`, module flag `warnedDeprecatedTtl`, static `WARN deprecated use BRAINY_TTL_DAYS` with no values), `:145` call site; `tests/ttl.test.ts` (6 tests); commit `5ee1728`; this lane ran `npx tsx --test tests/ttl.test.ts` → 6 pass, 0 fail | **HOLDS** — `grep -Rn "BRAINY_TTL" src/` → hits (`src/lifecycle.ts:49,57,63,135`); pre-fix 0-hits gap closed. Warning static, no values (no secret exposure; day-count is not a credential). Strict-`>` + unparseable-kept + per-call re-read preserved. |
| CDR-03 (ARCO boundary, option (a)) | Docs-only boundary: erasure/rectification MCP/CLI/store-only in v1; ARCO erasures directed through governed path (`POST /memory/delete` + receipt / `purge` bulk); `POST /memory/forget` declared compat-insufficient (CDR-03-C1); no new HTTP erasure surface built | `docs/CONTRACT.md:25` cl.6 (boundary record, commit `a79643c`); R2 ruling (a) approved `2a6bf20` §2; R1 concurrence `e1c541a` §2; `src/server.ts:689-700` (`/memory/forget`, audit-silent, unchanged) vs `:756-774` (`/memory/delete` + governance line, unchanged); `grep -n "DELETE /v1/notes" src/server.ts` → 0 (no per-note REST delete built, as approved) | **HOLDS** — boundary stated in contract text; code surface matches the approved (a) shape exactly (no option-(b) route). S-LEG-001 accepted residual, see §4. |
| CDR-04 (SPEC REQ-04 prose drift) | Replace `AGENT_MEMORY_CAPTURE off` kill-switch claim with verified objection paths (omit `concepts`/`tags`, `project` isolation, `brainy move`/`moveNote`, `CAPTURE_PATHS=basename` OFF default); orchestrator ack + `ACK-R1-CDR-04` | `docs/specs/20_backlog/SPEC-005-brainy-legal.md:48` (commit `2232087`); ack `e1c541a` §2 ("ACK-R1-CDR-04", second signature; orchestrator ack per dispatch) | **HOLDS** — `grep -Rn "AGENT_MEMORY_CAPTURE" hooks/ src/ bin/ scripts/` excl. `CAPTURE_PATHS` → 0 hits (no switch exists, claim removed); only `AGENT_MEMORY_CAPTURE_PATHS=basename` remains (`hooks/capture.mjs:111-112`, OFF default). Scope locked to REQ-04 objection clause only. |

CDR-02-C2 note: unit-level evidence (both knobs + OFF + boundary + no-content-in-warning, `tests/ttl.test.ts:60-108+`) is executed and passing; the live-canary half of CDR-02-C2 (spawned-server `BRAINY_TTL_DAYS=1` canary + `signals` line) belongs to the Step 11 verification pass (R1+R8, CDR-07) and is carried as the single gate condition in §6, not re-owned here.

## 2. REQ-BRAINY-LEG-01..09 AC verification (post-implementation)

| REQ | AC expectation | Tree evidence | Verdict |
|---|---|---|---|
| LEG-01 store declaration | CONTRACT mirrors ARCH NFR + SPEC §4.1 (purpose+TTL+deletion) | `docs/CONTRACT.md:19-25` + `ARCHITECTURE.md:244` + SPEC §4.1 table; greps pass (§1) | **PASS** |
| LEG-02 purpose limitation/minimization | Hook allowlist + zod bounds + export allowlist | `hooks/capture.mjs:63-92` (fixed strings; `UserPromptSubmit` never reads prompt `:72`; path-smuggle → `null` `:83`); `src/server.ts:38-44,179-181` + `.strict()` schemas; `bin/brainy.mjs:1685` frontmatter allowlist. Unchanged post-remediation (no code delta touched these paths). | **PASS** (static; live 400-matrix owned R1/R8 per CDR-07) |
| LEG-03 TTL + deletion + orphans | Canonical TTL enforced; purge/forget paths; orphan procedure | CDR-02 landed (§1) + `tests/ttl.test.ts` 6/6; `scripts/purge.ts` allowlist output unchanged; `src/store.ts:1950-1956` `forgetNote`; orphan 3-step documented (SPEC §4.2, CONTRACT v1.4). | **PASS** (code+unit; live canary carried as §6 condition) |
| LEG-04 ARCO + SLA | Operations + SLA home + honest boundary | Access/rectify/erase/objection paths verified in LEGAL_REVIEW (unchanged); SLA home now at `docs/CONTRACT.md:24`; drift fixed `2232087`; boundary at `docs/CONTRACT.md:25`. Per-note REST rectification/delete absent by approved ruling (a). | **PASS** subject to §6 live-harness condition |
| LEG-05 cross-border | Binding table + local-only default | R2 `crossborder-v1` table (`SECURITY_REVIEW.md:435-445`, commit `2a6bf20`); `helix.toml:10` `storage=disk`; allowlist unpopulated for provider regions → S-LEG-002, see §4. | **PASS** (default posture; provider use blocked) |
| LEG-06 DPIA | Baseline + sign-off | `DPIA-BRAINY.md` (`dpia-v1`, PASS-with-conditions); R2 co-review signed `2a6bf20` (C-06a discharged); R1 carried `e1c541a`. Accuracy ruling in §3. | **PASS** |
| LEG-07 privacy by design/default | Checkpoint allowlists | Unchanged paths re-verified by ref: `src/server.ts:850` access-log shape, `src/errors.ts:62-73` `logSafeNote`, `src/mcp.ts:220,453,734` stderr discipline. | **PASS** |
| LEG-08 breach 72h | Runbook + ledger + drill | R2 Incident § delivered `2a6bf20` §4 (`SECURITY_REVIEW.md:449-459`: severity mapping, 72h clock, allowlisted evidence, ledger shape); R4 runbook in LEGAL_REVIEW §5. Drill + redacted log owned R1/R8 (CDR-07) → §6 condition. | **PASS** (docs; drill carried) |
| LEG-09 no secrets/PII in logs/evidence | Scans + placeholders | LEGAL_REVIEW §3 scans stand; remediation commits add no secret-shaped strings (verified: `git show 5ee1728/a79643c/2232087` diffs contain no values, warning static); boot flag `src/server.ts:928-930` unchanged; this artifact contains zero PII/secrets/tokens (paths + line refs + `sha256`/`[REDACTED]` convention only). `gitleaks` still not-installed → R8 CI gate (C-09b) ongoing, not legal-owned. | **PASS** (static; live `s3cr3t` grep carried in §6) |

## 3. DPIA accuracy ruling

`DPIA-BRAINY.md` (`dpia-v1`) remains **accurate** post-implementation. Trigger register (T-a..T-d), S/T/R/I/D/E mapping (R-1..R-12), and controls table (§5) all match the tree: every cited file:line was re-read or shown unchanged by the remediation diff-stats (remediation touched only `docs/CONTRACT.md`, `src/lifecycle.ts`, `tests/ttl.test.ts`, SPEC-005 one line, and review docs — none of the DPIA-cited control paths).

Two staleness notes (observations, not findings — the DPIA is a versioned baseline, `dpia-v1`, and history is not rewritten):
- OBS-1: DPIA §5 R-12 control row and DPIA-R7 record the CDR-02 wiring gap as open ("wiring gap filed (CDR-02)", "until CDR-02 lands"). As of `5ee1728` the gap is closed at code+unit level. The text is historically true of `dpia-v1` but now needs a dated amendment note (one line: "CDR-02 executed `5ee1728`, unit-evidenced; live canary pending CDR-07"). Owner `subero`, expiry next DPIA amendment. Not gate-blocking: the residual it guards (canonical TTL unenforced) no longer holds at code level.
- OBS-2: `forgetNote` (store-level, `src/store.ts:1950-1956`) has no REST route — the DPIA lists erasure via "`forgetNote`/`forgetMemory`/`POST /memory/delete`/`DELETE /memory/todos/:id`", which reads as a surface list, not a REST-claim. The CONTRACT v1.8 boundary (`docs/CONTRACT.md:25`) now states the governed-path rule honestly, so the ARCO erasure story is documented without over-claiming. No correction required; the (a)-boundary record governs interpretation.

DPIA status advances: C-06a (`barrera` signature) is discharged by `2a6bf20`. DPIA remains PASS-with-conditions only insofar as DPIA-R1 (live harnesses) and DPIA-R6/R7 execution halves are still carried — both now narrowed to the §6 condition.

## 4. S-LEG-001 / S-LEG-002 rulings (confirm or overturn)

- **S-LEG-001** (`POST /memory/forget` audit-silent, Medium, R2 `2a6bf20` §5): **CONFIRM** the risk reviewer's ruling (risk-review RK-007). Expiry condition CDR-03-C1 is satisfied — the boundary record exists at `docs/CONTRACT.md:25` ("ARCO erasure requests are served via the governed path… `POST /memory/forget` is a compat path and is not sufficient for SLA-bound erasure evidence"), verified by reading. Ruling: accepted residual (compat path retained, SLA-evidence-insufficient by declaration). Re-review owner `subero`; expiry next erasure-surface change or v2, whichever first. Co-owned with the security owner; no divergence from R2.
- **S-LEG-002** (provider-region allowlist unpopulated, Medium→High-scoped, R2 `2a6bf20` §5): **CONFIRM** (risk-review RK-008). `crossborder-v1` (`SECURITY_REVIEW.md:435-445`) lists zero adequate-protection region entries; any `BRAINY_LLM_PROVIDER`-backed `distill`/remote-embedding use before population (allowlist v2 + transfer DPIA PASS + recorded consent + minimization + `subero` written approval) is an unapproved transfer and is **blocked** — provider-backed use only. The default local-only v1 release proceeds with this as accepted residual. Owners `subero` (allowlist v2) + `barrera` (DPIA co-sign); expiry before any provider-backed use; re-review at that event regardless of gate.

## 5. License / IP

- `LICENSE` (Apache License, full text present) + `package.json:7` (`"license": "Apache-2.0"`) — continuity intact; no license change in `7757ac1..HEAD`.
- Dependency delta in range: zero (`@helix-db/helix-db@3.0.4`, `@modelcontextprotocol/sdk`, `zod`, `@opencode/plugin`, dev `tsx`/`typescript`/`@types/node`) — all permissive-compatible; no AGPL/GPL introduced. No new vendored code.
- No copied upstream material with incompatible headers: remediation diffs are original declaration/wiring/prose text (8-line CONTRACT amendment, 33-line TTL function + doc comment, 1-line SPEC fix, review docs). No third-party license conflicts.

## Findings

| ID | Severity | Finding | Mitigation |
|---|---|---|---|
| — | — | No new legal findings. 0 Critical · 0 High · 0 Medium · 0 Low. OBS-1/OBS-2 (§3) are observations with owner + expiry, not findings. | — |

Prior-gate findings disposition: CDR-01 (High) → closed by `a79643c`; CDR-02 (High) → closed at code+unit by `5ee1728` (live-canary half carried in §6); CDR-03 (Medium) → accepted boundary (a) with CDR-03-C1 record at `docs/CONTRACT.md:25`; CDR-04 (Medium) → closed by `2232087` + `ACK-R1-CDR-04`. CDR-05/06 were R2-owned and delivered in `2a6bf20`. CDR-07 (live harnesses) was and remains R1+R8-owned → the single condition below.

## Verdict Rationale

All four R4-remediable CDRs are proven landed with exact file:line/commit evidence; both R2 conditions on legal text (CDR-01-C1/C2, CDR-02-C1, CDR-03-C1) hold in the tree; S-LEG-001/002 confirmations align with R2 and the risk reviewer with no divergence; license/IP clean; DPIA accurate. The verdict is **conditional** (not pass) solely because LEG-04/LEG-08/LEG-09 ACs require live-container evidence (ARCO end-to-end harness, TTL spawned canary, breach drill + `s3cr3t` log grep) that is owned by the R1/R8 Step 11 pass — this lane ran no containers by order. One condition, named owner, bounded expiry.

## Conditions for Opening

- [ ] COND-LEG-01: CDR-07 live evidence produced by R1 (`vasquez`) + R8 (`espinoza`) — ARCO access→rectify→erase→objection harness log (allowlisted IDs), `BRAINY_TTL_DAYS=1` spawned canary + `signals` line, breach drill + redacted log, `s3cr3t` log grep → 0 across REST/MCP/export — or written waiver with remediation deadline. Expiry: Brainy v1 gate.

**Residual risk + owner:** (i) `POST /memory/forget` audit-silent compat path — accepted residual, owner `subero`, expiry next erasure-surface change or v2 (S-LEG-001). (ii) Provider-backed embedding/`distill` blocked until allowlist v2 + transfer DPIA — accepted residual for local-only v1, owners `subero`+`barrera` (S-LEG-002). (iii) DPIA `dpia-v1` CDR-02-gap language needs a dated amendment note — owner `subero`, expiry next DPIA amendment (OBS-1). No silent PASS.

## Cross-domain requests

- To R1+R8 (`vasquez`+`espinoza`): COND-LEG-01 live evidence (CDR-07) — owns gate opening.
- To R4 (`subero`): OBS-1 one-line DPIA amendment note at next DPIA touch; S-LEG-001 re-review ownership accepted.
- To R4+R2 (`subero`+`barrera`): S-LEG-002 allowlist v2 ownership before any provider-backed use.
- No freelance fixes. No new Critical/High to surface.
