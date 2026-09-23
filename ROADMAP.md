# Roadmap

Gap analysis and phased plan against the reference implementation,
[`rohitg00/agentmemory`](https://github.com/rohitg00/agentmemory) (28.7k★,
Apache-2.0, built on the [iii engine](https://github.com/iii-hq/iii) + SQLite).

**How to read this file.** Every gap below is stated as *upstream has X, we have
Y*, with a phase and an acceptance criterion. "Verified" means confirmed against
this repository's source during the audit that produced this document; anything
not marked verified is inherited from `README.md` / `docs/CONTRACT.md`.

> **Relationship to upstream.** This is an independent implementation of the
> same REST + MCP contract on a different storage engine (HelixDB, not iii). We
> intentionally mirror upstream's route shapes and tool names so clients can
> switch between them, and we deliberately do **not** compete with it: never
> kill a running upstream instance, and do not claim its benchmark numbers as
> ours. See *Deliberate divergences* below.

---

## 1. Where we stand

### 1.1 Surface parity

| Capability | Upstream | This repo | Status |
|---|---|---|---|
| Storage engine | iii engine + SQLite, 0 external DBs | HelixDB v3 (graph + vector + BM25) in Docker | Divergent by design |
| REST routes | `/agentmemory/*` | 12 routes under `/memory/*`: `livez`, `health`, `remember`, `search`, `smart-search`, `sessions`, `sessions/:id/memories`, `forget`, `recap`, `handoff`, `lesson`, `delete` | Verified |
| MCP tools | 54 | 11: `memory_save`, `memory_search`, `memory_smart_search`, `memory_forget`, `memory_health`, `memory_sessions`, `memory_session_memories`, `memory_recap`, `memory_handoff`, `memory_lesson`, `memory_delete` | Verified — 43 short |
| Bearer auth | `AGENTMEMORY_SECRET` | `AGENT_MEMORY_SECRET`, `livez` exempt, empty = open localhost | Verified |
| Hybrid retrieval | BM25 + vector + graph, RRF | Same fusion in `src/search.ts`, with explicit degradation `signals` | Verified |
| Auto-capture hooks | 12 (Claude Code), 22 (OpenCode), 6 (Codex), 7 (Cursor) | 5 plugin hooks (`prompt`, `context`, `compaction`, `tool.execute.after`, `tool.execute.before`) + `hooks/capture.mjs` for 7 events (`SessionStart`/`PostToolUse`/`Stop`/`PostToolUseFailure`/`PreCompact`/`SessionEnd`/`UserPromptSubmit`) | Partial — breadth improved, still short of upstream |
| Context injection | Hook-driven | Marker-idempotent `[agent-memory v…]`, compaction-safe, TTL+LRU cache, write invalidation | Verified — our strongest area |
| Skills | 17 `SKILL.md` (9 invocable + 8 reference) | 0 | Missing |
| Real-time viewer | Yes, port 3113, incl. Replay timeline | None | Missing |
| Memory lifecycle | 4-tier consolidation + decay + auto-forget | Read-time decay + TTL + `purge.ts` (corte A, opt-in envs); consolidation tiers still missing | Partial |
| Confidence scoring | Yes | `importance` 0..1 supplied by caller, defaults `0.5` | Partial |
| Transcript import | `import-jsonl` (Claude Code JSONL) | None | Missing |
| Multi-agent coordination | MCP + REST + leases + signals | None (single-tenant `project` scope) | Missing |
| CLI | `agentmemory`, `stop`, `connect`, `doctor`, `remove`, `upgrade`, `status`, `demo` | npm scripts only | Missing |
| Agent adapters | 20 via `agentmemory connect` | OpenCode plugin + generic MCP/REST | Partial |
| Embeddings | Local (`Xenova/all-MiniLM-L6-v2`) or keyless BM25 | `src/embed.ts`, 384-dim, keyed to Helix | Equivalent |
| Eval harness | LongMemEval-S + in-house corpus, published scorecards | None | Missing |
| Tests / CI | 1,674+ vitest, GitHub Actions | `typecheck` + `verify` (131) + `verify-lifecycle` (34) + `verify-capture` (115) + `verify-injection` (73) + `verify-env` (21), plus GitHub Actions CI (typecheck, injection, capture, lifecycle, gitleaks) | Verified — CI present; no unit suite |
| Governance docs | LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, MAINTAINERS, CHANGELOG, DESIGN | LICENSE, SECURITY, CONTRIBUTING, CHANGELOG (plus README, AGENTS, CONTRACT); no CODE_OF_CONDUCT / GOVERNANCE / MAINTAINERS / DESIGN | Verified — incomplete (P4.7) |
| Packaging | `@agentmemory/agentmemory`, `@agentmemory/mcp` published | `private: true`, not published | Missing |
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
| P0.5 | **Resolve env migration** ✅ done (2026-09-22) | Servers started under the old `AGENTMEMORY_*` names are migrated to `AGENT_MEMORY_*`; a restart cannot silently drop the bearer secret or fall back to the upstream-occupied port |
| P0.6 | Resolve the port-ownership conflict — `3111` default / `3151` reroute ✅ done (2026-09-22) | README states definitively which port is ours and how to point the plugin at it |

### P1 — Recall quality & lifecycle

| # | Item | Acceptance criterion |
|---|---|---|
| P1.1 | Memory lifecycle: importance decay, TTL, auto-forget ✅ done (corte A) (2026-09-23) | A memory not recalled in N days loses weight and is eventually removable; nothing grows unbounded — decay `importance·e^(−λ·ageDays)` on the fused tie-break (`AGENT_MEMORY_DECAY_LAMBDA`, default OFF) + TTL hide with `ttl:` signal (`AGENT_MEMORY_TTL_DAYS`) + fail-closed `scripts/purge.ts` (`--days/--project\|--all/--dry-run`); probe3 (e) + verify-lifecycle 34 + verify 131 + purge dry-run/usage-guard green |
| P1.2 | Consolidation tiers | Near-duplicate memories merge instead of accumulating; merged set still recalls the originals |
| P1.3 | Auto concept extraction ✅ done (2026-09-23) | `remember` derives concepts without an explicit `concepts[]`, so the graph branch fires on plain saves — `extractConcepts` (top-8, deterministic), explicit concepts win verbatim, verify graph-branch fused score == 3/61 |
| P1.4 | Derived confidence | `importance` is computed from provenance + recall history, not just caller-supplied `0.5` |
| P1.5 | Eval harness | An adapter-pluggable harness scores retrieval on a public corpus; a scorecard lands in `docs/benchmarks/` with *our* numbers |
| P1.6 | Dedup on write ✅ done (2026-09-23) | Saving the same fact twice does not create two retrievable rows — `dedupKey` pre-check + per-key lock returns the existing id with `deduped:true`; probe3 proved uniqueness is application-side (the server does not enforce the index) |

### P2 — Capture breadth

| # | Item | Acceptance criterion |
|---|---|---|
| P2.1 | Expand hook coverage ✅ done (2026-09-23) | Add `PostToolUseFailure`, `PreCompact`, `SessionEnd`, `UserPromptSubmit`, `tool.execute.before` — all 7 `capture.mjs` events + plugin `execute.before` land an observation; `scripts/verify-capture.ts` 115 checks green (payload/origin/exit-0/silence/privacy canary) |
| P2.2 | Capture file edits and failures | A failed tool call and an edited file both produce an observation |
| P2.3 | Transcript import | Import a persisted session transcript and have it searchable afterwards |
| P2.4 | Session summarization / lessons | A closed session yields a compact summary + mined lessons, retrievable by `session` |

### P3 — Surfaces

| # | Item | Acceptance criterion |
|---|---|---|
| P3.1 | MCP tool parity for the useful subset ✅ done (v0.2.0, 2026-09-22) | Add `recap`, `handoff`, `lesson`, governance-style delete; each round-trips against the REST contract |
| P3.2 | Ship a skill set | `SKILL.md` files for `recall`, `remember`, `recap`, `handoff`, `forget`, `lesson`, `commit-context`, `session-history` |
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

1. **Engine.** HelixDB gives graph-native concept traversal; upstream's
   SQLite + iii gives a simpler install. Trade: we need a container, they don't.
2. **Env prefix.** `AGENT_MEMORY_*` here, `AGENTMEMORY_*` upstream. Ours follows
   a consistent `WORD_WORD_*` convention; it means our env vars are **not**
   drop-in compatible with upstream's, by choice.
3. **Focused surface.** 11 tools, not 54. We add surface only when a concrete
   retrieval or capture gap is proven, not for parity's own sake.
4. **Explicit degradation over silent thinning.** `signals[]` stays.
5. **Never displace upstream.** Coexistence rule from `README.md` is permanent.

---

## 4. Non-goals

- Competing with upstream on star count, tool count, or adapter count.
- Re-implementing the iii engine.
- Claiming upstream's benchmark results (`95.2%` R@5, etc.) as ours — P1.5 is
  how we earn our own number.
- Cloud/hosted multi-tenancy. `project` scoping is enough for a self-hosted
  single-user deployment.
