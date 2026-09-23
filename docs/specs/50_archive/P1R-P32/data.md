# Data Review: P1R-P32

**Reviewer:** review-data (engineering — data lens: schema/lineage/PII-store)
**Date:** 2026-09-23
**Verdict:** ⚠️ conditional (COND-DAT-001 … COND-DAT-004)

Scope: `d17294b..HEAD` (5 commits: `591c79c`, `39fec28`, `df39d7d`,
`c69636d`, `2deda68`). Data lens only — schema/versioning, data lineage of the
new mutation path, purpose/TTL/deletion of the three new stores, PII scan of
the new datasets. Engineering/security criteria belong to their reviewers;
cross-domain items appear as referrals, not verdicts. Review-only: no fixes, no
write-path suites run, no Helix restart, port 3111 untouched.

## Checklist

- [x] **Schema changes versioned** — the `Memory` property set did NOT grow;
  `updateMemoryContent` rewrites only the three EXISTING indexed properties
  (content #7, embedding #6, dedupKey #8), and the 8-index bootstrap is
  unchanged. CONTRACT v1.2 §1 carries the amendment note ("v1.2 tier-1
  consolidation REWRITES [dedupKey] on the survivor to the hash of the merged
  content" — matches `src/store.ts` `contentHash(input.project,
  normalizeContent(nextContent))`) and §2 line 87 declares the exact shipped
  signature: 6 params (`memoryId, content, embedding, dedupKey, concepts,
  project`) + `returning(["updated","memory"])` — byte-matches
  `db/queries.ts` (`updateMemoryContentParams` + batch body). No drift.
- [ ] **Data lineage documented** — traced end-to-end in the table below; the
  survivor's text lineage holds (concatenation never drops a fragment), but
  the durable record of WHICH fragments merged is absent and undeclared —
  DAT-004.
- [x] **Quality checks (nulls, types, ranges)** — fail-closed response-shape +
  empty-anchor + empty-`updated` asserts before a merge is ever reported
  (`src/store.ts` `consolidateInto`); `mergeThreshold()` fail-closed OFF on
  bad env; `jaccard` union-0 → 0 (never merges empties); `pickSurvivor`
  skips id-less rows; `EMBED_DIM` re-asserted on re-embed; `clamp01` bounds
  derived importance; `noteRecall` ignores empty id; ledger capped 10k.
- [x] **PII handling compliant (privacy-engineer consulted)** — pattern scans
  (secret classes: `ghp_`/`sk-`/`AKIA`/`Bearer …`/`BEGIN * PRIVATE KEY`/
  `client_secret`; PII classes: e-mail regex) over `eval/`, `skills/`,
  `docs/benchmarks/`, `scripts/eval.ts`, `scripts/verify-skills.ts` →
  **0 matches** (grep exit 1). Corpus read in full: 40 invented dev/ops facts,
  no persons, no credentials, no contact data. `verify-skills` additionally
  asserts secret-pattern absence structurally (73-check part 1). Secret-scan
  CI gate remains the security lens's referral (see below).
- [x] **Migration path defined** — N/A: no schema/property/index change;
  additive query + additive response field (`consolidated`) only.
- [x] **Backfill strategy (if applicable)** — N/A: legacy `dedupKey`-less rows
  keep the v1.1 documented-gap posture (CONTRACT §0 probe3 a3-2); a merge
  opportunistically (re)writes the survivor's `dedupKey`, declared §1.
- [x] **Analytics impact assessed** — recall boost reorders TIES only, after
  RRF score, order-only, stored `importance` never rewritten (CONTRACT §3);
  eval runs in the isolated tenant `agent-memory-eval` (never `default`);
  `purge --all` discovers the two new tenants via the Session walk
  (`listProjects`), so bulk deletion reaches them.

## Lineage table (new/changed store → purpose → TTL/retention → deletion → evidence)

| Store / field | Purpose | TTL / retention | Deletion procedure | Evidence |
|---|---|---|---|---|
| **Recall ledger** (NEW in-process `Map<memoryId, count>`, cap 10 000) | Ranking input: `confidenceBoost(decayedImportance, recallCount)` in the fused tie-break; purpose DECLARED | **DECLARED** — per-process, resets on restart, clear-on-overflow (new key at cap), not shared across writers | Restart (drop) or overflow eviction — same declaration | compute `src/confidence.ts:86-105`; write `src/search.ts` (`noteRecall` on kept rows, both paths); declaration CONTRACT §3 (v1.2 bullet, lines 242-249) + CHANGELOG v0.5.0 ("per-process"); stores memoryId+count ONLY — no content |
| **Survivor `Memory` row rewritten in place** (content ↑ concat, embedding, dedupKey — `updateMemoryContent`) | Tier-1 merge target; text lineage = concatenation: survivor prefix + every incoming fragment preserved (substring guard blocks re-append) | Same as any Memory row: TTL filter + `purge.ts --days` + forget/delete | `forget`/`delete`/`purge` drop the survivor WITH all merged fragments (node-level); fragments are not individually addressable | write `db/queries.ts:517-561`, `src/store.ts` `consolidateInto`; declaration CONTRACT §1 (dedupKey note) + §3 tier-1 bullet |
| **Merge provenance** (incoming variant's sessionId/origin/importance + which variants merged) | Response-only (`consolidated:true` is transient); NOT persisted anywhere | **Undeclared as absent** — no durable record exists; fragments inside the survivor render under the SURVIVIVOR's first session/origin in `recap`/`handoff` | N/A (never stored) — but the gap itself is undeclared → DAT-004 | incoming never inserted (`src/store.ts` rememberLocked step 2 → `consolidateInto`, no `saveMemory` call); grep lane docs for `lineage\|mergedFrom\|provenance` → 0 lane hits |
| **Eval corpus rows** (NEW tenant `agent-memory-eval`: 40 Memory + 1 stable Session) | Benchmarking — **purpose DECLARED** (SCORECARD header, CONTRACT §5, README, CHANGELOG) | **Undeclared** — no TTL; rows persist indefinitely after a run | Exists but **undeclared**: `purge --project agent-memory-eval --days N` (generic) + a fail-path hint "clear the stale rows (POST /memory/forget per id)"; neither named as the retention policy → DAT-003 | seed `scripts/eval.ts:60-64`; SCORECARD.md:11,13 (`sessions=1` bounded — fixed `eval-seed` id); hint `scripts/eval.ts:586-590` |
| **verify-skills residue** (rows cleaned 4/4; +4 UNIQUE Session nodes/run + derived Concept orphans persist) | Test round-trip fixture; purpose DECLARED (script header, cleanup PASS line) | **Undeclared** — sessions grow +4/run forever (3 random sids + 1 auto-UUID); the cited "~25 runs before purge" budget has **NO in-repo artifact** (grep `25 runs\|runs before\|residue` → no match) → DAT-002 | **None exists** — `forgetMemory` drops the Memory node only; repo-wide grep for a Session deletion path → 0 matches; sessions carry sessionId/project/timestamps only (no content) | sids `scripts/verify-skills.ts:393-395`, auto-UUID `:544-548`; cleanup `:576-586` (rows only); `db/queries.ts` `forgetMemory` body = `.drop()` on Memory label only |
| **Concept store (carry-forward)** | Graph labels — prior P1-P21 DAT-001 | **Undeclared**, unchanged this lane | None — `updateMemoryContent` ADDS a concept re-link path (amplifies) | prior `50_archive/P1-P21/GATE_REPORT.md:77` (Medium, expiry "2026-10-31 **or v0.5.0**, whichever first — bundle with P1.2 consolidation, which touches concepts"); this lane = P1.2 + v0.5.0, diff has no Concept drop → DAT-001 |

## PII / minimization evidence (scan summary, allowlisted)

- Secret-pattern classes + e-mail regex over `eval/`, `skills/`,
  `docs/benchmarks/`, `scripts/eval.ts`, `scripts/verify-skills.ts` →
  **0 matches**; corpus = synthetic dev/ops facts (read in full, 40 docs).
- `updateMemoryContent` writes a strict SUBSET of `saveMemory`'s properties
  (drops sessionId/origin/importance/createdAt — it never rewrites them):
  **no new data stored** beyond what a plain save already stores.
- Eval stdout/scorecard: config + counts + metric cells only; secrets env
  forwarded as header, never logged (declared `scripts/eval.ts` header).
  Fail-path `brief()` truncates a response body to 300 chars — synthetic
  corpus, identity-guarded to our server; no PII at risk (info, no finding).
- Recall ledger: memoryId + integer only; never persisted, never in responses.
- Session residue (test tenant): sessionId/project/timestamps — **no content,
  no PII** (why DAT-002 is Medium, not High).

## Findings

| ID | Severity | Finding | Mitigation |
|----|----------|---------|------------|
| DAT-001 | Medium | **Prior-lane tracked risk expired unremediated in THIS lane, and was amplified by it.** P1-P21 `GATE_REPORT.md:77` set Concept-orphan expiry at "2026-10-31 **or v0.5.0**, whichever first", explicitly "*bundle with P1.2 consolidation, which touches concepts*". This lane shipped P1.2 AND v0.5.0 with no Concept drop/delete path (grep `drop\|delete` over Concept → 0; diff adds none), and `updateMemoryContent` adds a NEW concept re-link write (`db/queries.ts` `forEachParam("concepts", conceptBody())`) so merges link MORE content-derived tokens that `forget` can never erase — right-to-erasure still does not propagate to the derived store (Ley 172-13). Location: `db/queries.ts:546-560` (re-link), `forgetMemory` (Memory-only drop). Evidence: prior GATE_REPORT:77 + this diff. Owner: engineering/orchestrator. | COND-DAT-001: re-baseline the expiry with a dated decision (declare Concept retention + orphan-cleanup procedure, or explicitly re-track with new expiry). Not release-blocking (conditional impact, no PII — tokens only), but an expired tracked risk must not pass silently. |
| DAT-002 | Medium | **`verify-skills` Session residue is undeclared and has no deletion path.** Rows clean 4/4 best-effort (`scripts/verify-skills.ts:576-586`), but each run materializes **4 unique Session nodes** (3 random sids `:393-395` + auto-UUID governance save `:544`) that persist forever: `forgetMemory` drops Memory only, and a repo-wide grep finds **no Session deletion path anywhere** (0 matches). The acceptance "~25 runs before residue needs purge" cited in the packet has **NO in-repo artifact** (grep `25 runs\|residue` in `*.md`/`*.ts` → only an unrelated RELEASE_NOTES line), so the budget is an oral claim, not a declaration. Sessions carry no content/PII (metadata only) → hygiene + retention-declaration gap, conditional impact. Location: `scripts/verify-skills.ts:393-395,444,544,576-586`; `db/queries.ts` `forgetMemory`. Evidence: greps above. Owner: engineering (Session deletion/purge support) + orchestrator (declare the run budget). | COND-DAT-002: land the residue declaration (run budget + purge/`listProjects`-scoped cleanup path for Sessions) in CONTRACT §3 or the script header, with the ~25-run figure sourced to an artifact. |
| DAT-003 | Low | **New persistent tenant `agent-memory-eval` declares purpose but no TTL/deletion policy.** 40 Memory + 1 bounded Session persist indefinitely after benchmarking; the only deletion traces are a generic fail-path hint (`scripts/eval.ts:586-590` "POST /memory/forget per id") and the undeclared generic `purge --project … --days N` — neither is named as THE procedure. Corpus is non-PII synthetic (scan 0/0), so this is hygiene, not a Ley breach. Location: `scripts/eval.ts:60-64`, `docs/benchmarks/SCORECARD.md:11`. Evidence: grep — no `purge`+`eval` co-occurrence anywhere. Owner: orchestrator/docs. | COND-DAT-003: one line in CONTRACT §5 or SCORECARD: purpose=benchmarking, retention=indefinite-by-design (or TTL), deletion=`purge --project agent-memory-eval --days N`. |
| DAT-004 | Low | **Merged-row lineage: no durable record of which fragments merged; fragment attribution blends — partially covered by the first-wins declaration, not fully declared.** The incoming variant is never written as a row; its sessionId/origin/importance vanish when `consolidateInto` concatenates text into the survivor, so `recap`/`handoff` render ALL fragments under the SURVIVIVOR's first sessionId/origin, and post-hoc merge history is unreconstructable beyond reading the concatenated text. Text itself is safe (concatenation never discards; substring guard closes re-merge — CONTRACT §3 tier-1 + `mergedContent`), and the first-wins family DOES declare survivor-keeps-original + no-Session-on-merge; what is NOT declared anywhere is "merge provenance is not persisted" (grep lane docs: `lineage\|mergedFrom\|provenance` → 0 lane hits). Location: `src/store.ts` `consolidateInto` (response-only `consolidated:true`), CONTRACT §3 tier-1 bullet (lines 224-241, silent on provenance). Evidence: greps + full §3 read. Owner: orchestrator/docs. | COND-DAT-004: add one sentence to CONTRACT §3 tier-1 declaring per-row merge provenance non-persistent (first-wins family: fragments inherit the survivor's session/origin; `consolidated` is response-only). No code change required. |

**Referrals (not this lens's verdicts):**

- **Secret scan → security lens / CI.** Local gitleaks remains unavailable
  (declared in the plan); CI P0.2 `secret-scan` enforces on push. My pattern
  scan over every new dataset found 0 matches, so no data finding additionally
  gates on it — the standing rule applies: no ship with a red/unknown CI scan.
- **Session deletion path (DAT-002 code half) → engineering.** Adding Session
  drop is a schema/behavior decision beyond a doc condition; if deferred, the
  declaration must carry the accepted risk with an expiry (previous gate's
  format).

## Conditions (verdict = ⚠️ conditional)

- **COND-DAT-001** — dated re-baseline of the expired Concept-orphan tracking
  (owner: engineering/orchestrator; doc decision or cleanup procedure).
- **COND-DAT-002** — declare `verify-skills` Session-residue retention + the
  ~25-run budget with an in-repo artifact (owner: orchestrator).
- **COND-DAT-003** — declare `agent-memory-eval` retention/deletion (owner:
  orchestrator).
- **COND-DAT-004** — declare merge-provenance non-persistence in CONTRACT §3
  (owner: orchestrator).

All four are documentation/declaration actions on orchestrator-owned files —
no runtime change, no write-path suite required to close them.

## Verdict Rationale

**⚠️ CONDITIONAL.** The schema lens is clean: zero property/index drift, the
v1.2 §1/§2 amendments byte-match the shipped `updateMemoryContent`, quality
guards are fail-closed, and every new dataset scans free of secrets and PII
(0 pattern matches across eval/skills/benchmarks/scripts) with the recall
ledger holding memoryId+count only — declared purpose, cap, and restart
deletion all present in CONTRACT §3. What blocks a plain pass is declaration
debt on new retention surfaces, not data harm: (1) the prior gate's
Concept-orphan risk expired at v0.5.0 in the very lane told to bundle it, and
this lane's merge re-link amplifies it (DAT-001, Medium); (2) `verify-skills`
grows +4 undeletable Session nodes per run while its "~25-run" purge budget
has no artifact in the repo — an acceptance I was asked to verify and could
not find (DAT-002, Medium); (3-4) two Low declaration gaps (eval tenant
retention, merge-provenance non-persistence). Per severity policy none is
release-blocking — Medium = fix-in-sprint, Low = backlog — but a data lens
exists precisely to catch undeclared stores, and an expired tracked risk plus
an unevidenced budget cannot ride silently into pass. Four doc-only conditions
close every finding.
