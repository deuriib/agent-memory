# Data Review: Brainy v1 (SPEC-001 + SPEC-005)

**Reviewer:** review-data (data lens, R1+R4 co-owned)
**Date:** 2026-09-25
**Verdict:** conditional
**Scope:** commits `7757ac1..HEAD` (HEAD `2211b95`), working dir `/mnt/DATA/GitHub/agent-memory`
**Packet:** `SPEC: docs/specs/20_backlog/SPEC-001-brainy-engineering.md + SPEC-005-brainy-legal.md / HARD: subagents+review-only+single-file-whitelist+no-code-changes+no-secrets+alias1version+evidence-allowlist / GATE: pending / DOMAINS: data-lens (R1+R4 co-owned), R2, R8`

## Checklist

- [x] Schema changes versioned
- [x] Data lineage documented
- [x] Quality checks (nulls, types, ranges)
- [x] PII handling compliant (privacy-engineer consulted — see §PII declaration)
- [ ] Migration path defined (see DAT-005: 384→1536 migration exists, verify harness drifted)
- [ ] Backfill strategy (see DAT-005)
- [x] Analytics impact assessed

## 1. Data-flow / lineage map (field → store → TTL → erasure, with file:line)

### Capture → store

| Step | What lands in storage | Evidence |
|------|----------------------|----------|
| Hook capture, fixed strings only | `content` ∈ {`agent session started`, `agent session stopped`, `context compaction requested`, `agent session ended`, `user prompt submitted`, `tool used: <name>`, `tool failed: <name>`, `file edited via <tool>[: <basename>]`} — tool NAME only, never paths/content by default; prompt text never read | `hooks/capture.mjs:63-92`, `hooks/capture.mjs:18-25` |
| Basename opt-in (sole exception) | sanitized basename ≤80 chars, only when `AGENT_MEMORY_CAPTURE_PATHS=basename` | `hooks/capture.mjs:111-130` |
| Todo auto-extract | `title` ≤120 chars sliced from session-body lines, `description` fixed string `auto-extracted from session`, `priority` low/medium — posted to `/memory/todos` (≤3/event, events Stop/SessionEnd/PreCompact/PostToolUse, body ≥400 chars) | `hooks/capture.mjs:236-260`, `hooks/capture.mjs:210-234` |
| Memory write | `Memory{memoryId, content, project, sessionId, embedding[1536], origin, importance, createdAt (ISO string), concepts[], dedupKey=sha256(project + "\n" + normalize(content))}` | `src/store.ts:920-1059`, `src/store.ts:1013-1042`, `src/lifecycle.ts:108-110` |
| Note write | `Note{id, title, content, project, paraCategory, paraTarget, origin, createdAt (epoch-ms number), updatedAt (epoch-ms number), status, embedding[1536], dedupKey, relatedNotes[], concepts[]}` | `src/store.ts:1699-1777` (notably `src/store.ts:1717`, `src/store.ts:1758-1759`) |
| Contract frozen field sets | `Note{noteId,title,content,project,embedding[1536],created_at,updated_at,status,paraType}`; compat `Memory.statement` alias of `content` | `docs/CONTRACT.md:21` (v1.8 block, commit `a79643c`) |

### Search / embed

| Step | Behavior | Evidence |
|------|----------|----------|
| Embed | deterministic keyless 1536-dim, FNV-1a bucket + sign bit + `1/(1+ln(tf))`, L2-normalized; `BRAINY_EMBED_DIM` override (legacy alias `AGENT_MEMORY_EMBED_DIM`), default 1536 | `src/embed.ts:16-29`, `src/embed.ts:79-108` |
| Vector/text indexes | `Memory.embedding` vector index + `Memory.content`/`Memory.statement` text indexes; `Note.embedding` vector index + `Note.content`/`Note.title` text indexes; all project-partitioned | `db/queries.ts:260-279`, `db/queries.ts:300-322` |
| Index bootstrap | all indexes via `createIndexIfNotExists` — idempotent re-runs | `db/queries.ts:245`, `db/queries.ts:261-266` (pattern throughout `db/queries.ts:238-322`) |
| Hybrid search | vector + text (+ graph when concepts present), RRF k=60, TTL filter pre-return with `ttl: hidden N expired rows` signal | `src/search.ts:191-320`, `src/search.ts:306-309` |
| BM25 search | text-only, TTL filter pre-return with same signal | `src/search.ts:93-116` |
| Consolidation guard | TTL-expired candidates excluded pre-merge; survivor re-checked under lock | `src/store.ts:994-1010`, `src/store.ts:1124-1130` |

### Export / read surfaces (TTL NOT applied — see DAT-003)

| Surface | Path | TTL filter? |
|---------|------|-------------|
| Context export | `GET /v1/context/:project` → `listNotes` + `searchByText(q="*")`, raw | No — `src/server.ts:541-562` |
| Recap / handoff export | `POST /memory/recap`, `POST /memory/handoff` → `buildDigestLines` → `sessionMemories` per session | No — `src/server.ts:702-737`, `src/digest.ts:45-84` |
| Session listing | `GET /memory/sessions`, `GET /memory/sessions/:id/memories` → `listSessions`/`sessionMemories` | No — `src/server.ts:660-687`, `src/store.ts:1505-1517` |
| Note reads | `GET /v1/notes/:id`, `listNotes` | No — `src/server.ts:485-539`, `src/store.ts:1779-1823` |
| MCP grounding | `brainy_context` → `listNotes` + counts + sessions | No — `src/mcp.ts:683-711` |
| Todo reads | `listTodos` (incl. substring fallback over raw rows) | No — `src/store.ts:1595-1616` |

### Erasure surfaces

| Surface | Target | Evidence |
|---------|--------|----------|
| `POST /memory/forget {memoryId}` (compat) | Memory rows only (`store.forget` → `forgetMemory`) | `src/server.ts:689-700`, `src/store.ts:1519-1524` |
| `POST /memory/delete {memoryId,reason}` (governance, receipt `{memoryId,deletedAt}`, ARCO evidence path) | Memory rows only (same `store.forget` underneath) | `src/server.ts:756-776`, `src/mcp.ts:435-455` |
| MCP `memory_forget` / `memory_delete` | Memory rows only | `src/mcp.ts:330-340`, `src/mcp.ts:435-455` |
| `scripts/purge.ts` (batches of 500 `listExpired` + `forgetMemory` per id) | Memory rows only — no Note branch | `scripts/purge.ts:46-51`, `scripts/purge.ts:268-303` |
| `forgetNote(id, project?)` | store layer ONLY — zero references in `src/server.ts`, `src/mcp.ts`, `scripts/purge.ts` (grep-verified) | `src/store.ts:1950-1960` |
| `DELETE /memory/todos/:id` | Todo rows | `docs/CONTRACT.md:24`, `src/server.ts:826-865` |
| Session nodes | NO deletion path exists (declared) | `docs/CONTRACT.md:673` |

## 2. PII-declaration proof (CDR-01, commit `a79643c`)

`docs/CONTRACT.md` v1.8 amendment (2026-09-25, commit `a79643c`, 8 insertions, docs-only) declares for `Note.content` in Ley 172-13 shape: purpose + legal basis + minimization (text-only MVP, zod bounds `title 1..500` `content 1..200k` `tags string[64] 1..200`, `concepts/tags ≤8`, frozen field set, derived-vs-caller concept posture) + TTL (`BRAINY_TTL_DAYS` default 365, alias + warning, absent/invalid/≤0 → OFF declared, strict-greater expiry, unparseable kept, ttl signal) + two-half deletion procedure + ARCO SLA home (acknowledge ≤5 business days, resolve ≤15, owner `subero`) + erasure-evidence boundary (`POST /memory/delete` governs; `POST /memory/forget` is compat-only, not SLA evidence). Evidence: `docs/CONTRACT.md:19-25`, `git show a79643c --stat` (docs-only, 1 file). Canonical source SPEC-005 §4.1 quoted verbatim (CDR-01-C1). **Declaration itself: PASS.**

TTL enforcement unit: canonical-first `BRAINY_TTL_DAYS` with alias fallback + single static warning, `src/lifecycle.ts:48-68` (commit `5ee1728`); `filterExpired` strict-greater + fail-toward-keep, `src/lifecycle.ts:144-161`; unit coverage `tests/ttl.test.ts` **6/6 pass** (verified this session: `npx tsx --test tests/ttl.test.ts` → pass 6 fail 0); `npm run typecheck` (`tsc --noEmit`) clean. **Unit layer: PASS. System layer: CONDITIONAL (DAT-001..DAT-004).**

Expiry drops data vs hides it: `filterExpired` only HIDES at read time; actual DROP exists only via `scripts/purge.ts`, which covers **Memory rows only**. For the declared `Note.content` PII store, expiry neither hides everywhere (DAT-003) nor drops anywhere (DAT-001/002). The declaration's "TTL + deletion" posture is therefore only half-true for Notes.

## 3. Erasure-completeness ruling

**Ruling: CONDITIONAL — the erasure story is honest in declaration but incomplete in wiring for the Note PII store.**

- Memory rows: erase story complete and proven — `forgetMemory` store path + compat `POST /memory/forget` + governance `POST /memory/delete` with receipt + `scripts/purge.ts` bulk path; ARCO flow proven live. PASS for Memory.
- Note rows: `forgetNote` exists at store layer (`src/store.ts:1950-1960`, project-guarded) but is UNEXPOSED over REST and MCP and absent from `purge.ts` (grep over `src/server.ts`, `src/mcp.ts`, `scripts/purge.ts` returns zero references — C-QA-03, R1+R4 decision pending). The v1.8 declaration lists `forgetNote` inside deletion half (a) (`docs/CONTRACT.md:24`) as though it were an available procedure; for Notes it is currently caller-unreachable in production wiring. The declaration does not misstate the mechanism's existence, but its availability implication overstates. CONDITION: expose `forgetNote` (or record an explicit R1+R4 decision that Note erasure rides the Memory-governed path, with owner + expiry) — see DAT-001.
- Slot9 canary Note rows: **TTL is NOT a valid mitigation** — (a) `filterExpired` hides only, never deletes; (b) the only deleter (`purge.ts`) iterates `listExpired` + `forgetMemory`, i.e. Memory rows exclusively; (c) Note `createdAt` is produced as epoch-ms (`src/store.ts:1717-1759`) against a `dateTime` param while `filterExpired` parses ISO strings and keeps unparseable rows, so Note rows risk fail-toward-keep indefinitely (DAT-004). Net: canary Note rows persist with no delete surface and no reliable hide. Residual risk stands — see DAT-002.

## Findings

| ID | Severity | Finding | Location + evidence | Owner |
|----|----------|---------|---------------------|-------|
| DAT-001 | High | Note-row erasure has no exposed surface: `forgetNote` is store-layer only (no REST route, no MCP tool, no purge branch), while the v1.8 declaration lists it in deletion half (a). A data-subject erasure request against a Note row has no reachable procedure. | `src/store.ts:1950-1960`; zero refs in `src/server.ts`/`src/mcp.ts`/`scripts/purge.ts` (grep-verified this session); `docs/CONTRACT.md:24` | engineering (expose or R1+R4 decision) + `subero` (ARCO) |
| DAT-002 | High | Slot9 canary Note rows: TTL does not collect them — hide-only filter, Memory-only purger, Note `createdAt` producer-type risk. Rows persist indefinitely with no delete surface. | `src/search.ts:306-309` (hide-only); `scripts/purge.ts:268-303` (Memory-only); `src/store.ts:1717-1759` (epoch-ms vs ISO) | engineering |
| DAT-003 | Medium | TTL hide bypassed on non-search read/export paths: `GET /v1/context/:project`, recap/handoff digest, session listings, `listNotes`/`getNoteById`, MCP `brainy_context`, `listTodos`. Expired rows leak through every export surface. | `src/server.ts:541-562`, `src/server.ts:702-737`, `src/digest.ts:45-84`, `src/store.ts:1505-1517`, `src/store.ts:1779-1823`, `src/mcp.ts:683-711` | engineering |
| DAT-004 | Medium | `createdAt` producer-type inconsistency: Memory writes ISO string (`src/store.ts:1018`), Note writes epoch-ms number (`src/store.ts:1717-1759`, `distillNote` `src/store.ts:1920`, `moveNote` `updatedAt` `src/store.ts:1904`) into `param.dateTime()` fields. If reads surface numerics, `filterExpired`'s `Date.parse` fails → fail-toward-keep forever; also incompatible with `listExpired`-style purge for Notes. | `src/store.ts:1018` vs `src/store.ts:1717-1759`; `db/queries.ts:123`, `db/queries.ts:161`; `src/lifecycle.ts:152-160` | engineering |
| DAT-005 | Medium | Embed-dimension drift: `scripts/verify.ts` asserts 384-dim (`scripts/verify.ts:249-257`) while canonical is 1536 (`src/embed.ts:16`, `db/queries.ts:55-56`); golden snapshot guards the stale space. Migration script exists (`scripts/migrate-embeddings.ts`, 384→1536) but the harness still gates the old dimension (known C-QA-01). Vector-recall quality for mixed-dimension rows is unverified at gate. | `scripts/verify.ts:249-262`; `src/embed.ts:16-29`; `db/queries.ts:55-56`; `scripts/migrate-embeddings.ts:2-5` | engineering + QA |
| DAT-006 | Low | Todo auto-extract stores ≤120-char body slices as `Todo.title` with no TTL filter on `listTodos`; Todo store has no retention declaration. Concur with R2 accepted-residual (sanitized, bounded, fixed-description), but the Todo PII-adjacent store should inherit the TTL/deletion declaration or an explicit waiver. | `hooks/capture.mjs:236-260`; `src/store.ts:1595-1616`; `docs/CONTRACT.md:19-25` (no Todo retention line) | engineering + `subero` |

## 4. Lineage / quality notes

- Cross-tenant isolation (C8): enforced at three layers — `contentHash` folds `project` into the dedup key (`src/lifecycle.ts:108-110`); `getNoteById` returns `undefined` on project mismatch (`src/store.ts:1831-1836`); `linkNodes` and `POST /v1/link` reject cross-project edges (`src/store.ts:1969-1973`, `src/server.ts:569-576`); all search/vector/text params are project-scoped (`db/queries.ts:87-103`). PASS.
- Index bootstrap idempotent via `createIndexIfNotExists` throughout (`db/queries.ts:238-322`). PASS.
- Minimization: CONFIRM R2 ruling from the data path — hook capture stores fixed strings + tool name only (`hooks/capture.mjs:63-92`); the sole payload-derived write is todo auto-extract titles ≤120 chars (`hooks/capture.mjs:236-260`); prompt text never read (`hooks/capture.mjs:69-72`); hostile `tool_name` with path separators fails closed to nothing stored (`hooks/capture.mjs:79-83`). R2 accepted-residual stands; DAT-006 records the Todo-retention tail.
- `verify.ts` 384-dim drift acknowledged as known C-QA-01; recorded as DAT-005 rather than re-litigated.

## Verdict rationale

Declaration (CDR-01) and TTL unit wiring (CDR-02, 6/6 + typecheck clean) pass on evidence. The CONDITIONAL rests on the Note PII store's system-level gap: no reachable erasure (DAT-001), TTL-as-mitigation invalid for canaries (DAT-002), hide bypassed on exports (DAT-003), producer-type risk (DAT-004). None is a silent-pass situation; all carry severity + location + evidence + owner above. No freelance fixes applied (review-only).

## Residual risk + owner

- Slot9 canary Note rows persist with no delete surface and no reliable TTL hide — owner **engineering** (purge/expose `forgetNote` + normalize `createdAt`), co-owner **`subero`** (ARCO exposure) — open until DAT-001 + DAT-002 close.
- Expired-row leakage through context/recap/session/list paths — owner **engineering** — open until DAT-003 closes.
- Mixed-dimension vector recall quality unverified — owner **engineering + QA** — open until DAT-005 closes.
