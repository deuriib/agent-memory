# Readability Review: P0

**Reviewer:** review-readability (independent subagent — did not author this work)
**Date:** 2026-09-22
**Checklist:** `frame-ship/skills/quality-gate/references/engineering/readability-review.md`
**Scope:** commits `4cf0f6a` · `7caa14d` · `c551774` · `bb335e2` · `1af2cde` · `8aba7b9` (diff `069e1cf..8aba7b9`) + the README/ROADMAP/governance docs they touch
**Verdict:** ⚠️ conditional

## Checklist

- [x] Naming is intention-revealing (no `data`, `tmp`, `x`)
- [x] Functions have single responsibility
- [x] Nesting depth <= 3
- [x] Comments explain WHY, not WHAT
- [x] Public APIs documented
- [x] No dead code or commented-out blocks
- [x] Consistent style with surrounding code

Code-side checklist: all seven pass. The conditional verdict comes from
doc-coherence findings (README/ROADMAP vs shipped behavior), which are part of
this lane's own deliverables (plan steps 5 and 7).

## Findings

| ID | Severity | Location | Finding |
|----|----------|----------|---------|
| RD-001 | Medium | `ROADMAP.md:44-48` (§1.1 parity table) | §1.1 still asserts pre-P0 reality that this lane's own close-out commit (`8aba7b9`, which ticked the P0 rows ✅) now contradicts two sections below: row "Governance docs … **no LICENSE**" vs P0.1 "✅ LICENSE present"; row "Persistence … Helix dev runs `storage: memory` — **data lost on restart** — Verified defect" vs P0.4 ✅ and `helix.toml` containing `storage = "disk"` (verified by reading the file); row "Tests / CI … `typecheck` + `verify-injection`" predates P0.2's GitHub Actions workflow. A reader hitting §1.1 first concludes persistence is still broken. |
| RD-002 | Medium | `README.md:424-427` (Known limitations #6) | "`demo` appends on every run … Restart Helix (**data is in-memory anyway**) or seed into a fresh `project`" contradicts Known limitations #2 and the Quick start in the same document: after `c551774` the default is `helix start dev --disk --persist`, so restarting does **not** clear the seeded demo rows. The first half of the stated remedy no longer achieves its stated purpose. `c551774` rewrote #2 but left #6 untouched. |
| RD-003 | Low | `README.md:398`, `CONTRIBUTING.md:43` vs `src/server.ts:508-516` | Both docs say "The server prints **this exact reroute hint** on `EADDRINUSE`" directly above a bash block ending in `AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify`. The actual hint (`portInUseHint`) contains `AGENT_MEMORY_PORT=3151 npm run dev` verbatim but renders the URL line as `…:3151 (example)` — it never prints `npm run verify`, and adds prefix/suffix text. Commands and ports match; the word "exact" overstates verbatim fidelity and invites a false comparison. |
| RD-004 | Low | `src/env.ts:27` | Comment on `nonEmpty` reads "unset, empty and whitespace-only-free empty all -> undefined" — garbled phrasing, and the code checks only `value.length > 0`, so a whitespace-only value (e.g. `AGENT_MEMORY_SECRET=" "`) is returned as usable. Comment either misdescribes the code or encodes an unimplemented intent; as written it explains neither. |
| RD-005 | Low | `CONTRIBUTING.md:73-78` | "Types in use: `feat`, `fix`, `docs`, `chore` … match what `git log` already shows" is stale against the log it points at: `4cf0f6a` uses type `ci`, and five P0 commits use scope `p0-00X` (a lane id, not an affected area) — neither appears in the guidance or its examples. |
| RD-006 | Low | `ROADMAP.md:78` | P0.6 row says "Resolve the 3111/**3121** ownership conflict" — `3121` appears nowhere else; the upstream quartet everywhere else (README #1, `portInUseHint`, `verify-env`) is `3111/3112/3113`. Typo in an acceptance line. |

### What passed (evidence, not assertion)

- **Naming (lens a):** `readLegacyEnv` (states legacy-vs-new direction), `portInUseHint` (verb + noun + trigger), `systemErrorCode` (narrows one specific concern), `warnIfVolatileStorage` (condition → action). All intention-revealing; no `d`/`tmp`/`x` anywhere in the changed sources.
- **Comment quality (lens b):** `src/env.ts:1-22` header explains the *rules and the WHY* (contract §3 "no secret value ever logged", why hooks must not import the module) — not a restatement of code. `scripts/bootstrap.ts:31-36` on `warnIfVolatileStorage` explains why the advisory exists ("say so loudly instead of losing data silently") and why failure is tolerated. `src/server.ts:1-17` header states invariants and their reasons (never-kill-upstream, no values in logs). Inline `src/server.ts:48` "NEVER interpolate `legacy` here — it may be the secret" is a textbook WHY comment on a footgun.
- **Governance docs (lens e):** `SECURITY.md` and `CONTRIBUTING.md` are short, table- and heading-navigable, links resolve (`README.md#authentication` anchor exists; `SECURITY.md`, `TEST_MATRIX.md`, `CHANGELOG.md`, `docs/CONTRACT.md` all present on disk — `ls` verified). SECURITY.md explicitly refuses invented SLAs ("no fixed deadline" + reason) — plain and honest.
- **Structure:** max nesting depth 3 (`routeRequest` → path branch → `segments` branch); `routeRequest` is long but one responsibility with a uniform flat route chain matching the frozen contract table; no dead code / commented-out blocks / TODOs (grep across `*.ts,*.mjs,*.js`: zero matches).

## Evidence personally gathered

| Claim | How I checked | Result |
|---|---|---|
| typecheck clean | `npm run typecheck` | exit 0 |
| injection green | `npx tsx scripts/verify-injection.ts` | `ALL PASS` (73 assertions — erratum: originally recorded here as 70; corrected 2026-09-22 per QA-02, output reproduced as 73 by all reviewers) |
| our server alive on 3151 | `curl http://127.0.0.1:3151/agentmemory/livez` | `{"status":"ok"}` / HTTP 200 |
| EADDRINUSE hint exists + matches docs | read `src/server.ts:508-516`; statically cross-checked `scripts/verify-env.ts:393-431` assertions (`port N is already in use`, `NEVER kill`, `3111/3112/3113`, `AGENT_MEMORY_PORT=3151 npm run dev`) | code and assertions agree; `verify-env` not executed (forbidden — port conflict with parallel reviewers) |
| legacy warning is name-only | read `src/env.ts:46-50` | `[agentmemory] deprecated <NAME> in use; rename to <NEW>` — variables only, once per var |
| `storage = "disk"` persisted | `cat helix.toml` | `[local.dev] storage = "disk"` present (contradicts ROADMAP §1.1 → RD-001) |
| governance files linked exist | `ls` on all README/CONTRIBUTING/SECURITY link targets | all present |
| upstream untouched | only read files + curl **3151**; no kill/start/helix commands issued | no interaction with 3111/3112/3113 |

## Verdict Rationale

⚠️ **conditional.** Every code-side checklist box passes: the four named
functions are intention-revealing, the three file headers explain WHY, public
APIs are documented, there is no dead code, style is consistent, and typecheck /
verify-injection / livez all green under my own hands. The condition is
documentation coherence, and it is not cosmetic: RD-001 and RD-002 are Medium
findings where this lane's own shipped docs contradict each other and the code
the lane just changed (persistence now `disk` — §1.1 and limitation #6 still
describe the old in-memory world). Both are README/ROADMAP text reconciliations,
zero code changes. Low findings RD-003..RD-006 can ride in a later docs pass.

## Risks

- A new user reading ROADMAP §1.1 before §2 concludes persistence and licensing are still broken → wrong first impression of a "publishable" repo (RD-001).
- A user following limitation #6's "Restart Helix" remedy under the new disk default gets duplicate demo rows again and loses trust in the doc (RD-002).
- RD-004 has a behavior shadow: if whitespace-only `AGENT_MEMORY_SECRET` was meant to be rejected, that is a guard-semantics question outside this reviewer's lens — flagged for the security/auth reviewer, not asserted here.

## Assumptions

- "Exact reroute hint" in README/CONTRIBUTING is read by a newcomer as referring to the immediately preceding bash block (RD-003); if the intended antecedent was only the `AGENT_MEMORY_PORT=3151` command, the finding downgrades to wording.
- ROADMAP §1.1 is a *current-state* table per its own "How to read this file" preamble, not a frozen audit snapshot — hence stale rows count as findings rather than history.
- Recorded evidence I could not re-run myself (`verify-env` 21/21, gitleaks, actionlint, 102/102 verify, canary restart) is taken as recorded; I statically confirmed the `verify-env` assertion strings against `portInUseHint` instead of executing it.
- No code was changed, no commits made, no server started, killed, or restarted; 3111/3112/3113 never touched.
