# Automation Review — SPEC-020-todos

**Reviewer:** automation-reviewer (R8) — single reviewer per packet HARD:subagents  
**Spec:** `docs/specs/20_backlog/SPEC-020-todos.md#REQ-TODO-07` + `NFR-TODO-C`  
**Gate:** `arch+sec-Approved` (reference-only)  
**Verdict:** **PASS**

## Scope (R8)

Hooks/capture extract ≤3, timeout 1.5s, always exit 0, bootstrap 12, pipeline not weakened, capture exit 0 on dead server. One reviewer only — this file is the sole automation gate artifact.

## Checks

### 1. extract ≤3 — PASS

- `hooks/capture.mjs:225` — `for (const t of todos.slice(0, 3))` fire-and-forget.
- `hooks/capture.mjs:243-251` — `hits.length >=5 break` + dedup → caller caps at 3 regardless of hits; extract collects at most 5 then caller slices to 3.
- Live probe: 3900-byte body with 50+ `TODO` lines produced exactly 3 `POST /memory/todos` (plus 1 `POST /memory/remember` for Stop), verified via ephemeral `http.createServer` on `127.0.0.1:0`. No unbounded fan-out.

### 2. timeout 1.5s — PASS

- `hooks/capture.mjs:230` — `signal: AbortSignal.timeout(1500)` for each todo POST.
- `hooks/capture.mjs:204` — `AbortSignal.timeout(2000)` retained for `memory/remember` (hot-path vs capture contract difference intentional, not a regression).
- REQ-TODO-07 requires 1500 per todo; code matches spec verbatim. Each future `await fetch(...).catch(()=>undefined)` bounded, never throws.

### 3. always exit 0 — PASS

- `hooks/capture.mjs:50-51` — `process.on("uncaughtException", () => process.exit(0))` + `unhandledRejection` → exit 0 belt-and-braces.
- `hooks/capture.mjs:288-290` — `main().catch(()=>undefined).finally(()=>process.exit(0))` — all rejections swallowed, final exit is 0 unconditionally.
- Verified: 137 checks in `scripts/verify-capture.ts` all assert `exit 0` and `stdout/stderr EMPTY` across positives, negatives, malformed JSON, empty stdin, unsupported event, and dead-server paths.
- Never logs prompt text or secret: `observationFor` for `UserPromptSubmit` returns fixed string, never `hook.prompt`; `verify-capture.ts:348-358,416-419` privacy canaries assert absence from body/stdout/stderr.

### 4. bootstrap 12 — PASS

- `db/queries.ts:127-193` — `bootstrapIndexes()` creates 12 indexes: 8 existing (memory/session/concept/dedup/vector/text) + 4 Todo (`todo_id` uniqueEquality todoId, `todo_project` equality project, `todo_status` equality status, `todo_title` nodeText title with tenant project).
- `db/queries.ts:179-192` — `.returning([...12 vars])` matches 12 vars; internal count via `createIndexIfNotExists` in bootstrap body = 12 (global 13 includes non-bootstrap line, not relevant).
- `scripts/bootstrap.ts:57` prints `bootstrapIndexes: OK (12 indexes ensured)` on success; spec §3 AC-TODO-01 expects 8→12 without regression. No new deps, `helix.toml` unchanged except via bootstrapper.

### 5. pipeline not weakened — PASS

- `.github/workflows/ci.yml:15-30` — `verify` job still runs: `npm ci` → `typecheck` → `verify-injection` → `verify-lifecycle` → `verify-capture` → `verify-skills --structural`; `secret-scan` job still runs pinned `gitleaks 8.30.1` with checksum + full-history scan.
- No gate removed, no timeout reduction, no `continue-on-error`, no secret scan downgraded. `verify-capture` remains required (137 checks, exit non-zero on any FAIL).
- `NFR-TODO-C` intact: `src/server.ts:641-661` `REROUTE_PORT=3151` + `portInUseHint` still prints never-kill hint for `3111/3112/3113`; no `kill`/`pkill` added.

### 6. capture exit 0 on dead server — PASS

- Live proof (this review): `AGENT_MEMORY_URL=http://127.0.0.1:1` (tcpmux, nothing bound) with 3900-byte TODO body → hook exited `0`, `stdout ""`, `stderr ""`, no unhandled rejection.
- `scripts/verify-capture.ts:620-631` Section E — `closeServer()` then `runHook(["Stop"],...)` asserts `down: 0 requests`, `down: exit 0`, both outputs EMPTY — `npx tsx scripts/verify-capture.ts` → `137 checks, 0 failed — ALL PASS` on this run.
- Root cause: every `fetch(...).catch(()=>undefined)` + top-level `main().catch(()=>undefined).finally(exit 0)` ensures `ECONNREFUSED` is swallowed.

## Evidence

| Artifact | Location | Observation |
|---|---|---|
| hook todo fan-out cap | `hooks/capture.mjs:225,250` | `slice(0,3)`, `hits>=5 break` |
| todo timeout | `hooks/capture.mjs:230` | `AbortSignal.timeout(1500)` |
| always-exit-0 | `hooks/capture.mjs:50,51,288-290` | uncaught + unhandled + finally |
| bootstrap 12 | `db/queries.ts:127-193` | 12 `createIndexIfNotExists` in bootstrap |
| CI gates | `.github/workflows/ci.yml:22-30,38-53` | typecheck + 3 verify scripts + gitleaks pinned |
| dead-server | `scripts/verify-capture.ts:620-631` + live spawn | exit 0, empty output, 0 requests |
| privacy canaries | `hooks/capture.mjs:63-73` + `scripts/verify-capture.ts:343-362` | UserPromptSubmit never reads `hook.prompt` |

## Residual Risk

None. All five automation invariants hold with test + live proof. No waiver needed.

## Recommendation

Gate CLOSED PASS for R8. Do not block ship-release on automation grounds.
