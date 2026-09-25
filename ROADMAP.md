# Roadmap

Evolutionary roadmap and phased capability plan for **Brainy** (formerly `agent-memory`), transitioning from flat session memory to a comprehensive second brain (CODE/PARA on HelixDB).

**How to read this file.** Every capability below is stated with its development phase, architectural rationale, and acceptance criteria. "Verified" means confirmed against this repository's source and test suites; anything not marked verified reflects target milestones.

> **Relationship to upstream.** Brainy began as an independent implementation of the agent memory REST + MCP contract over HelixDB instead of a legacy SQLite engine. In Brainy v1.0.0, the system elevates into a structured second brain while maintaining a 1-version backward compatibility window for legacy clients. Under no circumstances do we compete destructively with upstream: never kill a running upstream instance, and do not claim external benchmark numbers as ours. See *Deliberate divergences* below.

---

## 1. Where we stand

### 1.1 Surface parity

| Capability | Upstream | This repo | Status |
|---|---|---|---|
| Storage engine | Legacy SQLite engine, 0 external DBs | HelixDB v3 (graph + vector + BM25) in Docker | Divergent by design |
| REST routes | Legacy `/memory/*` routes | Canonical `/v1/*` routes with 1-version `/memory/*` alias | Verified |
| MCP tools | 54 legacy tools | 4 native Brainy tools + 11 legacy aliases + 6 todo tools | Verified |
| Bearer auth | Legacy bearer auth | `BRAINY_SECRET` (with legacy fallback), `livez` exempt, empty = open localhost | Verified |
| Hybrid retrieval | BM25 + vector + graph, RRF | Same fusion in `src/search.ts`, with explicit degradation `signals` | Verified |
| Auto-capture hooks | 12 (Claude Code), 22 (OpenCode), 6 (Codex), 7 (Cursor) | 5 plugin hooks (`prompt`, `context`, `compaction`, `tool.execute.after`, `tool.execute.before`) + `hooks/capture.mjs` for 7 events (`SessionStart`/`PostToolUse`/`Stop`/`PostToolUseFailure`/`PreCompact`/`SessionEnd`/`UserPromptSubmit`) | Partial — breadth improved, still short of upstream |
| Context injection | Hook-driven | Marker-idempotent `[agent-memory v…]`, compaction-safe, TTL+LRU cache, write invalidation | Verified — our strongest area |
| Skills | 17 `SKILL.md` (9 invocable + 8 reference) | 9 `SKILL.md` (8 invocable + 1 index), every route live round-tripped by `verify-skills` | Partial — parity of the useful subset |
| Real-time viewer | Yes, port 3113, incl. Replay timeline | None | Missing |
| Memory lifecycle | 4-tier consolidation + decay + auto-forget | Read-time decay + TTL + `purge.ts` (corte A, opt-in envs) + tier-1 near-duplicate consolidation (v0.5.0, ON by default); tiers 2–4 still missing | Partial |
| Confidence scoring | Yes | Derived: `deriveWriteImportance(origin, concepts)` when the caller omits `importance` (explicit wins) + recall-boost tie-break; no cross-restart recall memory | Partial — parity in shape, simpler model |
| Transcript import | `import-jsonl` (Claude Code JSONL) | None | Missing |
| Multi-agent coordination | MCP + REST + leases + signals | None (single-tenant `project` scope) | Missing |
| CLI | Legacy CLI commands | `bin/brainy.mjs` (start, stop, status, doctor, add, search, context, export) | Verified |
| Agent adapters | Legacy adapter script | OpenCode plugin + generic MCP/REST | Partial |
| Embeddings | Local (`Xenova/all-MiniLM-L6-v2`) or keyless BM25 | `src/embed.ts`, 384-dim, keyed to Helix | Equivalent |
| Eval harness | LongMemEval-S + in-house corpus, published scorecards | In-repo corpus (40 docs / 15 qrels), `npm run eval` → `docs/benchmarks/SCORECARD.md` with our R@5/MRR/nDCG | Partial — our numbers, smaller corpus |
| Tests / CI | 1,674+ vitest, GitHub Actions | `typecheck` + `verify` (243) + `verify-lifecycle` (123) + `verify-skills` (119 + 73 structural in CI) + `verify-capture` (137) + `verify-injection` (73) + `verify-env` (21) + `probe3`/`probe4` + `eval`, plus GitHub Actions CI (typecheck, injection, capture, lifecycle, structural skills, gitleaks) | Verified — CI present; no unit suite |
| Governance docs | LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, MAINTAINERS, CHANGELOG, DESIGN | LICENSE, SECURITY, CONTRIBUTING, CHANGELOG (plus README, AGENTS, CONTRACT); no CODE_OF_CONDUCT / GOVERNANCE / MAINTAINERS / DESIGN | Verified — incomplete (P4.7) |
| Packaging | Legacy published packages | `private: true`, not published | Missing |
| Deployment | `docker-compose.yml`, `deploy/` (k8s) | `helix start dev` only | Missing |
| Persistence | On-disk data dir, survives restart | Helix dev runs `storage = "disk"` (set in `helix.toml`) — data survives restarts; host-reboot availability in README *Durability & recovery* | Verified (fixed by P0.4) |
| i18n | 12 README languages | 1 | Missing |

### 1.2 What we do better today

- **Degradation is explicit.** Every search returns a `signals[]` list naming
  which upstream source failed, so a partial recall is *visible* instead of
  silently thinning results. An all-sources-down search still returns 200.
- **Injection is idempotent and compaction-safe.** A versioned marker plus a
  `compaction` hook means recalled context survives compression without
  stacking duplicates; a bounded TTL+LRU cache keeps it off the hot path.
- **Graph-native storage.** Concepts, memories and their `HAS_CONCEPT` edges are
  first-class nodes, so the graph branch of fusion is a traversal, not a join.

### 1.3 Tracked residuals (gate-accepted, dated)

Accepted at review with owner + expiry; re-review on the expiry trigger.

| ID | Residual | Owner | Accepted | Expiry / trigger | Declared in |
|---|---|---|---|---|---|
| RL-001 / F-02 / RK-001 — **CLOSED** | Concurrent saves of *distinct* near-dup variants LOST one append in-process (the per-key FIFO serialized identical content only) — FIXED by per-survivor FIFO serialization + fresh `getMemoryById` re-read under the survivor lock | engineering | opened 2026-09-23 gate P1R-P32; **CLOSED 2026-09-24 (v1.5)** | **Surviving boundary re-review 2026-12-31 or the start of P4.3 multi-instance work, whichever first** — SAME-PROCESS writers only; cross-process writers to one Helix instance stay out of contract until P4.3 | `docs/CONTRACT.md` §3 tier-1 (a) v1.5 + README *Known limitations* #8 |
| DAT-001 — **CLOSED** | Concept nodes have no drop path — `forget` erases Memory only, so derived concept tokens (now re-linked on every merge) outlive right-to-erasure requests (no PII: tokens only) | engineering | declared 2026-09-23 at the v0.6.0 trigger, gate P1R-P32 (prior expiry "…or v0.5.0" expired unremediated) | **CLOSED 2026-09-23 (v0.6.0 trigger)** — Concept retention + orphan-cleanup procedure declared in `docs/CONTRACT.md` v1.4 §3; procedure verified live (audit → zero-in-edge gate → drop → re-audit; 189→188 Concepts, linked 128 unchanged) | `docs/specs/50_archive/P1R-P32/GATE_REPORT.md` C3 + `docs/CONTRACT.md` v1.4 §3 |
| F-01 — **CLOSED** | `updateMemoryContent` mid-batch atomicity was a blind engine assumption (one `writeBatch`, nothing checked the commit) — FIXED by post-write verify + ONE heal + fail-closed named throw; the substring guard now heals links too | engineering | re-baselined 2026-09-23, gate P1R-P32; **CLOSED 2026-09-24 (v1.5)** | **Carve-outs survive:** re-verify on next Helix engine upgrade or 2026-12-31, whichever first; `embedding` residual CLOSED 2026-09-24 by F-01-EMB lane; crash-window lazy heal → `docs/CONTRACT.md` §3 | `docs/CONTRACT.md` §3 tier-1 (b) v1.5 |
| F-01-EMB — **CLOSED** | The merge batch's `embedding` write escaped the F-01 verify: a partial commit landing content+dedupKey+links but dropping the embedding refresh passes every invariant while the vector index serves the pre-merge embedding — CLOSED by the 4th (`embedding`) invariant in `verifyMergedState`, fed by `getMemoryById`'s verify-only embedding projection | engineering | 2026-09-24, gate RL001-F01 (COND-RF-01, re-scope option (b)); **CLOSED 2026-09-24 (v1.6)** | **CLOSED 2026-09-24 (v1.6)** — evidence: `src/store.ts` `verifyMergedState` + `embeddingsEqual` (4th invariant, f32 element-wise 1e-6 → `retryWrite` heal → re-verify → named throw), `db/queries.ts` `getMemoryById` embedding projection (internal verify only, no new index — bootstrap stays 8), `scripts/verify-lifecycle.ts` §I heal seams (8 sends + `invariants=…embedding` token), `scripts/probe4.ts` f32 round-trip proof | `docs/CONTRACT.md` §3 tier-1 (b) CLOSED-scope declaration v1.6 |
| RL-001-QUEUE | Nested FIFO lock queue has **no cap and no request deadline**; per-send 15 s `withTimeout` × ≤11 sequential sends worst-heal → ≤165 s held in-lock (6 sends happy; in-lock hold grew ~2× happy / ~3–4× worst vs pre-RL-001) | engineering | 2026-09-24, gate RL001-F01 (COND-RS-02, AU-002 envelope) | **P4.3 multi-instance OR first observed retry storm** — code fix (queue cap / request deadline) = separate proposal lane | `docs/CONTRACT.md` §3 lock-queue wait envelope |
| VERIFY-SESSION-NODES | `scripts/verify.ts` leaves **+17 `Session` nodes per run** (fresh uuid test sessions materialize on novel writes; rows self-clean via `forget`, but no Session deletion path exists — measured 490 → 507 → 524, 2026-09-24) | engineering | 2026-09-24, gate RL001-F01 (COND-RK-01, COND-DAT-002-style) | **P4.1 session-deletion work or 2026-12-31**, whichever first — until then operator resets the dev instance / prunes `verify*` sessions when hygiene matters | `docs/CONTRACT.md` §5 session-node run budget |

---

## 2. Phased plan

Each phase has an acceptance criterion. A phase is done when its criterion
passes, not when its tickets are "mostly" closed.

### P0 — Publishable foundations *(blocking: repo is public)*

| # | Item | Acceptance criterion |
|---|---|---|
| P0.1 | Add a license ✅ done (pre-existing at lane start, 2026-09-22) | `LICENSE` present; GitHub reports the correct license |
| P0.2 | CI workflow ✅ done (2026-09-22) | GitHub Actions runs `typecheck` + `verify-injection` + a secret scan on every push; green on `main` — run [35781376642](https://github.com/deuriib/agent-memory/actions/runs/35781376642) (`verify` + `secret-scan` success, merge of PR #1; branch runs 35780360945 / 35781362973 green too) |
| P0.3 | SECURITY.md, CONTRIBUTING.md, CHANGELOG.md ✅ done (2026-09-22) | Three files present, linked from README |
| P0.4 | **Fix persistence** ✅ done (2026-09-22) | `helix start dev --disk` documented *and* the default dev path no longer silently loses data; a save survives a Helix restart |
| P0.5 | **Resolve env migration** ✅ done (2026-09-22) | Legacy environment variable aliases are resolved to canonical names; a restart cannot silently drop the bearer secret or fall back to an upstream-occupied port |
| P0.6 | Resolve the port-ownership conflict — `3111` default / `3151` reroute ✅ done (2026-09-22) | README states definitively which port is ours and how to point the plugin at it |

### P1 — Recall quality & lifecycle

| # | Item | Acceptance criterion |
|---|---|---|
| P1.1 | Memory lifecycle: importance decay, TTL, auto-forget ✅ done (corte A) (2026-09-23) | A memory not recalled in N days loses weight and is eventually removable; nothing grows unbounded — decay `importance·e^(−λ·ageDays)` on the fused tie-break (`AGENT_MEMORY_DECAY_LAMBDA`, default OFF) + TTL hide with `ttl:` signal (`AGENT_MEMORY_TTL_DAYS`) + fail-closed `scripts/purge.ts` (`--days/--project\|--all/--dry-run`); probe3 (e) + verify-lifecycle 39 + verify 152 + purge dry-run/usage-guard green |
| P1.2 | Consolidation tiers ✅ done (tier 1) (2026-09-23) | Near-duplicate memories merge instead of accumulating; merged set still recalls the originals — `Jaccard ≥ AGENT_MEMORY_MERGE_JACCARD` (default 0.9, fail-closed OFF) probe under the dedup lock, survivor id stable, content concatenated (substring guard), `updateMemoryContent` rewrites embedding/dedupKey + re-links concepts; probe4 verdict A (`setProperty` refreshes text+vector indexes); verify.ts §P: 3 variants → 1 row, all 3 queries recall it, healthCount +1 |
| P1.3 | Auto concept extraction ✅ done (2026-09-23) | `remember` derives concepts without an explicit `concepts[]`, so the graph branch fires on plain saves — `extractConcepts` (top-8, deterministic), explicit concepts win verbatim, verify graph-branch fused score == 3/61 |
| P1.4 | Derived confidence ✅ done (2026-09-23) | `importance` is computed from provenance + recall history, not just caller-supplied `0.5` — write-time `deriveWriteImportance(origin, concepts)` replaces the 0.5 default when omitted (explicit wins); ranking-time `confidenceBoost` over an in-process recall ledger (cap 10k) applied after decay on the fused tie-break; plugin no longer pins 0.5 client-side; verify-lifecycle §F (23 goldens) + verify.ts §O (22 checks incl. recall-lift) |
| P1.5 | Eval harness ✅ done (2026-09-23) | An adapter-pluggable harness scores retrieval on a public corpus; a scorecard lands in `docs/benchmarks/` with *our* numbers — `EvalClient` interface (`EVAL_MODE=rest`), deterministic in-repo corpus `eval/corpus.ts` (40 docs / 15 queries + qrels, zero network), R@5/R@10/MRR@10/nDCG@10 for bm25 + hybrid in project `agent-memory-eval`, `npm run eval` writes `docs/benchmarks/SCORECARD.md` (real run, `EVAL PASS`) |
| P1.6 | Dedup on write ✅ done (2026-09-23) | Saving the same fact twice does not create two retrievable rows — `dedupKey` pre-check + per-key lock returns the existing id with `deduped:true`; probe3 proved uniqueness is application-side (the server does not enforce the index) |

### P2 — Capture breadth

| # | Item | Acceptance criterion |
|---|---|---|
| P2.1 | Expand hook coverage ✅ done (2026-09-23) | Add `PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`, `tool.execute.before` — each of the 7 `capture.mjs` events + plugin `execute.before` records an observation on first occurrence (repeats dedup — first-wins, contract §3); `scripts/verify-capture.ts` 115 checks green (payload/origin/exit-0/silence/privacy canary) |
| P2.2 | Capture file edits and failures ✅ done (2026-09-23) | A failed tool call and an edited file both produce an observation — `PostToolUse` with an edit-like tool name stores `file edited via <tool>` (name only; `AGENT_MEMORY_CAPTURE_PATHS=basename` opt-in appends the sanitized basename, default OFF, full paths never stored); `PostToolUseFailure` + plugin `tool.execute.after` non-completed runs store `tool failed: <tool>` (`captureToolFailure`, memory* skipped); Antigravity adapter mirrors the edit marker; `verify-capture` §F 17 checks green (132 total) |
| P2.3 | Transcript import ✅ done (2026-09-23) | Import a persisted session transcript and have it searchable afterwards — script-only `scripts/import-transcript.ts` (`--file/--project/--session-id/--dry-run/--include-prompts`) through the existing `POST /memory/remember` surface (no new route/tool); Claude Code JSONL + generic `{content}` fallback; prompts skipped by default (Ley 172-13); live import → `search` hits proven on project `verify-p2-live` |
| P2.4 | Session summarization / lessons ✅ done (2026-09-23) | A closed session yields a compact summary + mined lessons, retrievable by `session` — deterministic `src/summarize.ts` (top concepts via `extractConcepts`, origin counts, time range, top-5 extractive picks, top-3 lessons; no LLM) + `scripts/summarize-session.ts` saving summary + lessons as `/memory/lesson` rows under the same sessionId; live summarize → `sessionMemories` contains summary + lessons proven |

### P3 — Surfaces

| # | Item | Acceptance criterion |
|---|---|---|
| P3.1 | MCP tool parity for the useful subset ✅ done (v0.2.0, 2026-09-22) | Add `recap`, `handoff`, `lesson`, governance-style delete; each round-trips against the REST contract |
| P3.2 | Ship a skill set ✅ done (2026-09-23) | `SKILL.md` files for `recall`, `remember`, `recap`, `handoff`, `forget`, `lesson`, `commit-context`, `session-history` — all 8 shipped with contract-accurate route/tool tables + examples, indexed by `skills/memory/SKILL.md`; `verify-skills` 119 checks (73 structural + 46 live round-trips of every skill's frozen route) |
| P3.3 | Real-time viewer | A local page streams live memory writes (upstream uses port 3113) |
| P3.4 | Session replay | Scrub a session's prompts / tool calls / results as a timeline |
| P3.5 | Additional agent adapters | Claude Code, Cursor, Gemini CLI wired through the existing REST + MCP surface, no per-agent rewrite |

### P4 — Ops, packaging, scale

| # | Item | Acceptance criterion |
|---|---|---|
| P4.1 | CLI | `start`, `stop`, `status`, `doctor` beyond npm scripts |
| P4.2 | Deployment | `docker-compose.yml`; k8s manifests under `deploy/` |
| P4.3 | Multi-instance | A second instance runs on a non-conflicting port quartet without editing source |
| P4.4 | Data-dir control | An explicit data directory survives restarts and is documented |
| P4.5 | Published package | A public npm package installable without cloning |
| P4.6 | Zero-container mode | If the HelixDB SDK supports embedded execution, a no-Docker path exists — this is our biggest onboarding gap versus upstream |
| P4.7 | Governance docs | CODE_OF_CONDUCT, GOVERNANCE, MAINTAINERS, DESIGN |
| P4.8 | i18n | Translated READMEs |

---

## 3. Deliberate divergences

These are decisions, not gaps. Do not "fix" them by copying upstream.

1. **Engine.** HelixDB gives graph-native concept traversal; legacy SQLite
   gives a simpler install. Trade: we need a container, they don't.
2. **Env prefix.** `BRAINY_*` canonical primary here. Ours follows standard
   environment variable conventions with a 1-version backward compatibility window.
3. **Focused surface.** 11 tools, not 54. We add surface only when a concrete
   retrieval or capture gap is proven, not for parity's own sake.
4. **Explicit degradation over silent thinning.** `signals[]` stays.
5. **Never displace upstream.** Coexistence rule from `README.md` is permanent.

---

## 4. Non-goals

- Competing with upstream on star count, tool count, or adapter count.
- Re-implementing legacy database engines.
- Claiming upstream's benchmark results (`95.2%` R@5, etc.) as ours — P1.5 is
  how we earn our own number.
- Cloud/hosted multi-tenancy. `project` scoping is enough for a self-hosted
  single-user deployment.
