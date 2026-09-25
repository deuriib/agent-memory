# Risk Review: Brainy v1

**Reviewer:** review-risk (independent; did not write the code under review)
**Date:** 2026-09-25
**Verdict:** conditional
**Scope:** working dir `/mnt/DATA/GitHub/agent-memory`, commits `7757ac1..HEAD` (HEAD `de518b7`)
**Role prompt:** `/mnt/DATA/GitHub/dotfiles/dot_config/opencode/prompts/review-risk.md`
**Checklist:** `/mnt/DATA/GitHub/frame-ship/skills/quality-gate/references/engineering/risk-review.md`

## Checklist

- [x] Blast radius analysis bounded and verified
- [x] Backward compatibility preserved (breaking rename shipped with ADR + 1-version window + BREAKING CHANGE entry)
- [x] Dependencies pinned; zero new runtime deps; zero `package-lock.json` delta
- [x] Rollback determinism proven (reverse-order whole-commit revert, ≤15 min code revert)
- [x] Architectural contract invariants intact (`ARCHITECTURE.md` + ADR-0003 carried)
- [ ] Zero unmitigated regression risk across touched systems (Mediums conditioned below — hence conditional)

## Open conditions from sibling reviewers (scored as risk)

| ID | Source | Risk | Sev × Likelihood | Evidence | Owner | Disposition |
|----|--------|------|------------------|----------|-------|-------------|
| RK-001 | RL-001 | `GET /v1/context/:project` quiet failure: search error → `memories=[]` with no signal, `memoriesCount: 0` reported as fact | Med × Med | `src/server.ts:549-553` vs signals-degradation siblings `src/search.ts:241-249`, `src/server.ts:721-734` | R1 | condition-before-release (carry signal or document) |
| RK-002 | RL-002 | Env misdirection: `HelixStore` reads `HELIX_URL` only, not `BRAINY_URL`-canonical-first; canonical-only operator silently targets shared dev `:6969` (loud `invalid_vector_dimension`, not corruptive; workaround: set `HELIX_URL`) | Med × Med | `src/store.ts:848` vs `scripts/bootstrap.ts:25`, SPEC-003 REQ-OPS-02 | R1 | condition-before-release (canonical-first read before next release; workaround documented meanwhile) |
| RK-003 | RL-003 | NFR-01 scale gap: p95 proven only at N=40 (8.68ms); 10k-node leg not run, no headroom argument | Med × Med | `docs/benchmarks/SCORECARD.md:29-44`; `scripts/eval.ts` has no scale knob | R1/R8 | condition-before-release (scale harness before NFR-01 PASS) |
| RK-004 | RD-001/002/003 | Readability drifts (doc-only, zero behavior change): misplaced tie-order contract block; terse locals; stale capture header vs todo auto-extract | Low × High | `src/search.ts:136-164`; `src/store.ts:1598-1622`; `hooks/capture.mjs:27-29` vs `:236-286` | R1 (+R2 co-sign RD-003) | condition-before-release (doc-only fixes) or recorded accept |
| RK-005 | RD-004/005 | Module-cohesion note (`embedWithProvider` in keyless module); single-file scale (`brainy.mjs` 1817 lines, `store.ts` 2086 lines, mitigated by banners) | Info × — | `src/embed.ts:114-142`; file sizes | R1 | accepted-residual (info notes, no action) |

## Standing residuals (scored)

| ID | Risk | Sev × Likelihood | Evidence | Owner | Disposition |
|----|------|------------------|----------|-------|-------------|
| RK-006 | `scripts/verify.ts` 5 legacy 384-dim goldens failing (expectation drift in off-limits harness; deterministic across 2 runs; 238/243 pass; zero product-code signal) | Med × Low | Reliability review ruling #2; `embed length 384` + golden snapshot + 2 RRF goldens | R1 (harness owner) | condition-before-release (update goldens to 1536-dim per INV-014; non-blocking for release logic) |
| RK-007 | S-LEG-001 expiry ruling: `POST /memory/forget` audit-silent erasure path — **condition SATISFIED, converts to accepted residual.** CDR-03-C1 boundary record is present in code-adjacent contract text. | Med × Low | `docs/CONTRACT.md:25` (CDR-03-C1 erasure-evidence boundary: ARCO via governed `POST /memory/delete` + receipt, `/memory/forget` compat-insufficient); `src/server.ts:630-643` vs `:691-709`; SECURITY_REVIEW §5/S-LEG-001 | R4 `subero` (record text, done) | **accepted-residual-with-expiry** — expiry: next erasure-surface change or v2, whichever first; re-review owner `subero` |
| RK-008 | S-LEG-002: provider-region allowlist unpopulated → any `BRAINY_LLM_PROVIDER`-backed `distill`/embedding use before population is unapproved-transfer risk | High × Low (default local-only; no provider configured) | LEGAL_REVIEW §3/`crossborder-v1` local-only; `crossborder-v1` table §4; zero-hit R2 cross-border grep pre-review; DPIA M-6 | R4 `subero` (allowlist v2) + R2 `barrera` (DPIA co-sign) | **blocked-until-conditions for provider-backed use only** (allowlist v2 + transfer DPIA PASS + consent + minimization); local-only v1 release proceeds with this as accepted residual, expiry: before any provider-backed use; review at this gate done |
| RK-009 | Brand AC-01/AC-06 literal-grep-0 variances (frozen SPECs/history untouched by rule; allowed-set documented) | Low × Low | `BRAND_SIGNOFF.md` scope note + AC-01/AC-06 VARIANCE rows | R5 `vera` (accepted) | accepted-residual-with-expiry (expiry: v2 rename-sunset review) |
| RK-010 | `gitleaks` not-installed → grep fallback only (`ghp_/sk-/AKIA` 0 hits; `BRAINY_SECRET=` only `s3cr3t` test-value docs); pre-push CI gate pending | Med × Low | LEGAL_REVIEW §3/C-09; TEST_MATRIX #11 + C2 rows; SECURITY_REVIEW §8 | R8 `espinoza` (C-09b CI gate) + R1 (C-09a live log-capture grep) | condition-before-release (C-09a live grep by R1/R8 lane; C-09b CI gate ongoing) |
| RK-011 | `agent-memory-eval` fixture namespace remnants (eval project data in dev instance) | Low × Low | `SCORECARD.md:22,31,74,131` (dedicated project `agent-memory-eval`) | R8 | backlog (purge or document fixture TTL; no prod impact — eval project only) |
| RK-012 | Single self-reported probe POST to protected `:3111` (fixed PII-free string, no prompt text, no secret, not repeated) | Low × Low | TEST_MATRIX incident #2; reliability ruling #5 | executing lane (closed) | accepted-residual (closed, no recurrence) |
| RK-013 | RD-003 privacy half: `collectBody` fallback stringifies whole hook payload when no long-text field found | Low × Low | `hooks/capture.mjs:280-282`; readability cross-domain request to security | R2 (co-sign) | condition-before-release (security co-sign allowlist posture or file finding; expiry: gate sign-off) |

## Migration / compat risks

| ID | Risk | Sev × Likelihood | Evidence | Owner | Disposition |
|----|------|------------------|----------|-------|-------------|
| RK-014 | Alias 1-version sunset at v2.0.0: `bin/agent-memory.mjs` shim, `/memory/*` + `/agentmemory/*` routes, `memory_*` MCP aliases, `AGENT_MEMORY_*` env fallbacks all removed at next major | Med × Low (planned, documented, warned-once-on-stderr + `X-Deprecated` header) | `policies/brand-deprecation-policy.md:26,79-80`; `CHANGELOG.md:13,22,25`; `bin/brainy.mjs:435-460`; `src/server.ts:278-286` | R1/R5 | accepted-residual-with-expiry (expiry: v2.0.0 sunset; re-review owner R5) |
| RK-015 | `--migrate` fail-closed `MIGRATE ABORT: unsupported-runtime` (helix 3.3.0 does not forward `HELIX_DATA_DIR`, probe A3 FAIL); no data migration claimed in v1; framing 3b pending orchestrator | Med × Low (fail-closed, documented, zero writes by construction) | `bin/brainy.mjs:22-35,1075-1077,1175,1503-1512`; TEST_MATRIX #REQ-P4-OPS-07/08/NFR-D partial rows | R8 + orchestrator (framing 3b decision) | accepted-residual-with-expiry (scope: v1 claims no data-dir migration; release notes must state abort behavior; expiry: framing-3b decision) |

## Release blast radius

| ID | Dimension | Assessment | Evidence |
|----|-----------|------------|----------|
| RK-016 | Breaking change entry | Present and explicit: atomic rename + 1-version window + sunset documented under `### Changed / BREAKING CHANGE` | `CHANGELOG.md:8-25` |
| RK-017 | Rollback path | Deterministic: reverse-order whole-commit revert (code ≤15 min); data rollback + manifest revert levels defined; zero-new-deps makes post-revert `typecheck`+`verify` conclusive | `IMPLEMENTATION_PLAN.md:241-261`; `CHANGELOG.md:160-162` |
| RK-018 | Dependency policy | **Verified this review:** zero new runtime deps; no `package-lock.json` delta (`git diff 7757ac1..HEAD --stat -- package-lock.json` → empty); `package.json` delta is scripts (`test`, `migrate-embeddings`) + `brainy` bin + rename only; runtime set unchanged (`@helix-db/helix-db 3.0.4`, `@opencode/plugin`, `@modelcontextprotocol/sdk`, `zod`) | `git diff 7757ac1..HEAD -- package.json`; `package.json:39-44`; empty lockfile stat |
| RK-019 | Independently re-verified (read-only, this review) | `npm run typecheck` exit 0; `npm test` 80 passed / 0 failed | executed 2026-09-25 |

## Risk Assessment Matrix (summary)

| ID | Risk Dimension | Impact | Likelihood | Mitigation | Residual |
|----|----------------|--------|------------|------------|----------|
| RK-001 | Context-route quiet failure | Med | Med | Carry `signals` on the route or document | Med until fixed |
| RK-002 | Env misdirection (`HELIX_URL`-only) | Med | Med | Canonical-first read; interim `HELIX_URL` workaround documented | Med until fixed |
| RK-003 | NFR-01 scale evidence gap | Med | Med | 10k-node scale harness (R@5/MRR/nDCG + p95) | Med until run |
| RK-006 | Legacy 384-dim goldens drift | Med | Low | Update goldens to 1536-dim (INV-014) | Low |
| RK-008 | Unapproved provider transfer (S-LEG-002) | High | Low | Local-only default; allowlist v2 + DPIA before any provider use | Low (scoped block on provider use) |
| RK-010 | Secret-scan CI gap (no gitleaks) | Med | Low | Live log-capture grep (C-09a); R8 CI gate (C-09b) | Low |
| RK-014 | v2 alias sunset | Med | Low | Deprecation warnings + policy + sunset date | Low |
| RK-015 | Migration abort path | Med | Low | Fail-closed + documented scope + framing-3b decision | Low |

## S-LEG-001 expiry ruling (explicit)

S-LEG-001 (`POST /memory/forget` audit-silent, Medium, owners `barrera`+`subero`, expiry at v1 gate — this IS the v1 gate): the expiry condition CDR-03-C1 is **satisfied** — the CONTRACT boundary record directing ARCO erasures through the governed path exists at `docs/CONTRACT.md:25`. Ruling: **condition met → accepted residual** (compat path, not sufficient for SLA-bound erasure evidence). Expiry of the residual: next erasure-surface change or v2, whichever first. Re-review owner: `subero`. No third retry, no re-litigation.

## Verdict Rationale

No Critical risk. One High (RK-008/S-LEG-002) is scoped-blocked to provider-backed use only and does not block the default local-only v1 release. Blast radius is bounded (breaking change declared, rollback deterministic, zero dep delta verified). The remaining Mediums (RK-001/002/003/006/010/014/015) all have named owners and bounded remediation — hence **conditional**, not fail and not pass.

## Residual risk + owner

- Context route may under-report until RK-001 carries a signal. Owner: R1.
- Canonical-only configs target the wrong instance until RK-002 fixed (loud failure). Owner: R1.
- p95 at 10k-node scale unknown until RK-003 harness exists. Owner: R1/R8.
- Provider-backed use forbidden until RK-008 conditions met. Owners: `subero`+`barrera`.
- Alias sunset lands at v2.0.0 (RK-014). Owners: R1/R5.
- Data-dir migration unsupported pending framing-3b (RK-015). Owner: R8 + orchestrator.

## Cross-domain requests (for orchestrator)

- To R2 (`barrera`): co-sign RK-013 (`collectBody` fallback allowlist posture) — requested via readability COND-RD-003; carried here by reference.
- To R8 (`espinoza`): C-09b pre-push `gitleaks`/CI gate (RK-010); framing-3b data-dir decision (RK-015).
- To R4 (`subero`): S-LEG-001 residual re-review ownership accepted (expiry above); S-LEG-002 allowlist v2 ownership (RK-008).
