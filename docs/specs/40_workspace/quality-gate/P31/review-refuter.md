# Refuter Review: P3.1 (recap / handoff / lesson / delete)

**Reviewer:** review-refuter (adversarial)
**Date:** 2026-09-22
**Verdict:** conditional

## Mission

Attempt to **falsify** the P3.1 implementation (range `e9fd325..HEAD`, 6 commits).
Success = a counterexample with evidence. Read-only: no servers started; live
`npm run verify` / live MCP handshake were **not** re-executed — claims about them
were attacked statically (code paths, assertion/tool counts, typecheck, zod probes).

## Attack Vectors Tried

| ID | Hypothesis | Attempt | Result |
|----|-----------|---------|--------|
| RF-001 | No new route can bypass the bearer guard | Read `src/server.ts:271-277`: guard runs after `startsWith("/agentmemory/")` and before any route dispatch, exempting only the exact string `/agentmemory/livez`. Probed URL normalization: `/agentmemory/livez/../recap` → `/agentmemory/recap` (guarded: true), `/agentmemory//recap` (guarded: true), `/AGENTMEMORY/recap` → fails `startsWith` → 404 at line 272 before routing (case-sensitive route matches too). Encoded traversal (`livez%2f..`) stays guarded. | Confirmed (SURVIVED) |
| RF-002 | recap/handoff **never** 500 on store failure (even sync throws) | Traced every store call in `buildDigestLines` (`src/server.ts:221-255`, `src/mcp.ts:125-159`): `sessionMemories`/`listSessions` awaited **inside** try/catch (sync throws caught by the same block); non-array/`undefined` resolutions also throw inside the loop → caught. Handoff's `healthCounts` awaited inside try (`server.ts:401-405`). Residual: `counts.memories` deref at `server.ts:407` sits **outside** the try — only reachable if `healthCounts` resolves malformed; `HelixStore.healthCounts` (`src/store.ts:498-511`) throws instead (`isRecord` + missing-counts checks), and the `MemoryStore` type forbids it → unreachable with the real store. Client-abort mid-body yields a 500 *attempt* to a vanished socket (pre-existing pattern for all routes, not a store failure). | Confirmed (SURVIVED), residual noted |
| RF-003 | delete returns a receipt even when forget actually failed | `src/server.ts:437-441`: `if (!deleted)` → 404 **before** receipt; receipt only after `deleted === true`. `HelixStore.forget` (`src/store.ts:296-308`) returns `false` for `{}`/`[]`/`null`/`0`/`false`; remote errors throw `HelixError` from `send` (`store.ts:387-389`) → 500, no receipt. MCP mirror `src/mcp.ts:394-395` returns `failed({error:"not_found"})` before any receipt/log. | Confirmed (SURVIVED) |
| RF-004 | A `reason` with embedded newlines cannot break the governance log | `reasonSchema = z.string().trim().min(1).max(1000)` (`server.ts:44`) — `trim()` only strips ends. **Probe (zod in repo node_modules):** `reason = "ok\n[agentmemory] delete governance memoryId=FAKE-ID reason=forged at=…"` → `safeParse` accepted, raw `0x0A` survives → one `console.log` template (`server.ts:445-447`; MCP `console.error` `mcp.ts:399-401`) emits **2 lines**, line 2 = forged `[agentmemory] delete governance memoryId=FAKE-ID reason=forged at=… at=T`. Same trim-only validation on `project` (`server.ts:36`) lets a crafted project value inject lines into handoff's header text. | **Falsified → CE-001 (Medium)** |
| RF-005 | lesson rejects an extra `origin` key on every surface | REST: `lessonBodySchema` is `.strict()` (`server.ts:86-94`); zod probe: `{content, origin}` strict parse → rejected (verify N2 asserts 400, `verify.ts:500-509`). MCP: `lessonInput` is a **raw shape**; SDK builds a default (non-strict) object (`zod-compat.js:14-27` → `z4mini.object(shape)`/`z3rt.object(shape)`), and default zod strips unknown keys — probe: non-strict parse of `{content, origin:"evil"}` → **accepted**, `origin` silently dropped. `origin` itself stays forced (`mcp.ts:377`, `server.ts:426`) so **no spoofing**, but MCP does not *reject* the key while README's MCP table claims `memory_lesson` "(strict body)" (`README.md`, MCP tools table). | Partially falsified → **CE-002 (Low)**; origin-forcing claim SURVIVED |
| RF-006 | Verify section N can pass while recap returns the wrong session's content | N4 (`verify.ts:527-534`) asserts `sessionId` echo (which is just `body.sessionId ?? null`, `server.ts:387` — proves nothing about store scoping), `count >= 1`, and `recap.includes(p31content)`. Content **absence** would fail the run (content only exists under `p31sid`/`p31project`). But **over-inclusion** passes: a store returning all project memories for any sessionId still yields the lesson bullet + `count>=1`. Contrast section H (`verify.ts:389-393`) which does assert `every(row => row.sessionId === sidA)` — N4 has no per-bullet membership assertion. Round-trip core claim (lesson → present in recap) holds; the session-scoping invariant is untested. | Partially falsified → **CE-003 (Low, test-coverage gap)** |
| RF-007 | Governance MCP tool's `console.error` leaks content | `mcp.ts:399-401` logs only `memoryId` (server-generated UUID, `store.ts:396` — caller cannot set it) + caller `reason` (contract-defined metadata) + timestamp, to **stderr** (stdout stays protocol-only). Unexpected failures log via `logSafeNote` (`mcp.ts:179`), which reduces remote errors to the stable code (`errors.ts:63-73`). | Confirmed (SURVIVED) |
| RF-008 | Nothing mutates the 8 frozen routes | `git diff e9fd325..HEAD -- src/server.ts src/mcp.ts` deletions: exactly 3 lines — one comment (`7 frozen core tools`→`11`) and two `import { logSafeNote }` → `import { failureSignal, logSafeNote }`. Zero deletions in `scripts/verify.ts` (0 matches `^-[^-]`). No frozen route body touched; additions only before the terminal 404. | Confirmed (SURVIVED) |
| RF-009 | MCP handshake exposes exactly 11 tools | `grep -c 'registerTool(' src/mcp.ts` = 11 (7 frozen + `memory_recap`, `memory_handoff`, `memory_lesson`, `memory_delete`), all gated by the shared `handle()` auth-first wrapper (`mcp.ts:168-182`). Live handshake not re-run (no-server constraint). | Confirmed statically (SURVIVED) |
| RF-010 | `npm run verify` = 101 passed 0 failed | Static assertion-site census: `check(` occurrences 77 − 1 definition (`verify.ts:53`) = 76 call sites; `shape(` = 25 call sites (definition is `shape<T>(`, non-matching) → **101** total. In a fully-passing run every guarded block executes (guards open only when the preceding shape succeeded, else a FAIL is already recorded). Live run not re-executed per no-server rule. | Confirmed statically (SURVIVED) |
| RF-011 | delete reason is strictly required | `deleteBodySchema` `.strict()` with `reason: z.string().trim().min(1).max(1000)` (`server.ts:97-102`); verify del3 missing-reason → 400 (`verify.ts:606-607`); MCP `deleteInput` requires `reason` (SDK parse rejects absence with `InvalidParams`). Note: RF-004 shows "strictly required" ≠ "safe to interpolate". | Confirmed (SURVIVED) |
| RF-012 | lesson origin strictly forced | REST passes literal `LESSON_ORIGIN = "lesson"` (`server.ts:426`) — caller `origin` unreachable (strict schema); MCP passes `LESSON_ORIGIN` (`mcp.ts:377`) after SDK strips any extra key; verify N3 asserts stored row `origin === "lesson"` (`verify.ts:522`). | Confirmed (SURVIVED) |
| RF-013 | No secret/memory content in logs | Access log = method/path/status/duration only (`server.ts:498`); governance line = `memoryId`/`reason`/`at` (metadata by contract §3); all error logging via `logSafeNote` (remote → stable code only, `errors.ts:62-73`); startup log prints `auth: open|bearer-required`, never the value (`server.ts:527-529`). | Confirmed (SURVIVED) |
| RF-014 | Strict TS / no `any` / no `@ts-ignore` after the change | `npm run typecheck` (`tsc --noEmit`) executed this review: exit 0, zero output. `grep` shows no `@ts-ignore`/`any` casts added in the diff. | Confirmed (SURVIVED) |
| RF-015 | Additive-only: `db/queries.ts`, `helix.toml`, hooks untouched | `git diff --name-only e9fd325..HEAD` → only `IMPLEMENTATION_PLAN.md`, `README.md`, `TEST_MATRIX.md`, `docs/CONTRACT.md`, `scripts/verify.ts`, `src/mcp.ts`, `src/server.ts`. | Confirmed (SURVIVED) |

## Counterexamples Found

| ID | Counterexample | Impact | Reproduction |
|----|---------------|--------|--------------|
| CE-001 | `reason` (and `project`) pass `.trim()` validation with **embedded newlines/control chars**, so the delete governance entry is emitted as multiple stdout/stderr lines — the second line can perfectly forge `[agentmemory] delete governance memoryId=… reason=… at=…`, violating CONTRACT §3's "logged as **one governance line**" and defeating line-based audit parsing. | **Medium** — audit-log integrity of the governance trail is breakable by any caller that can authenticate (bearer, when armed). Also mis-splits logs on legit multi-line reasons. No secret/memory-content leak (reason is contract-defined metadata) — security reviewer owns any escalation. Location: `src/server.ts:44` + `:445-447`; `src/mcp.ts:88` + `:399-401`; `src/server.ts:36` (project → handoff header text). | `node --input-type=module -e` zod probe: `z.string().trim().min(1).max(1000).safeParse("ok\n[agentmemory] delete governance memoryId=FAKE-ID …")` → accepted, `0x0A` survives → `console.log` template splits into 2 lines, line 2 = forged governance entry. |
| CE-002 | MCP `memory_lesson` with an extra `origin` arg is **silently accepted and stripped** (SDK raw-shape → non-strict `z.object`, probe confirmed) instead of rejected like REST's `.strict()` 400 — while README's MCP table documents `memory_lesson` as "(strict body)" and TEST_MATRIX T-002 says input schemas "mirror REST". | **Low** — no origin spoofing (forced at `mcp.ts:377`), but a documented behavior (400 on extra key) does not exist on the MCP surface; callers get silent success where docs promise rejection. | zod probe: non-strict `z.object({content}).safeParse({content:"x", origin:"evil"})` → success, `{"content":"x"}`; SDK `zod-compat.js:14-27` builds exactly that non-strict object from raw shapes. |
| CE-003 | Verify N4 would pass a recap that echoes the requested `sessionId` yet contains **other sessions' bullets**, as long as the lesson content is also present: no per-bullet `[sessionId]` membership assertion (unlike section H's `every(...)`). The `sessionId` echo itself is `body.sessionId ?? null` — a request echo, not store evidence. | **Low** — round-trip presence claims hold; the session-scoping invariant of recap is untested, so a store scoping regression would ship green. | `scripts/verify.ts:527-534` (echo + `count>=1` + `includes(p31content)` only) vs `:389-393` (membership pattern exists elsewhere but not applied in N). |

## Verdict Rationale

**conditional** = counterexamples found, mitigations available. The core P3.1
claims were attacked and **survived**: bearer guard covers all new routes with
`livez` the sole exact-path exemption (RF-001), recap/handoff degrade on every
real store failure path including sync throws (RF-002, one unreachable residual
at `server.ts:407`), receipts never precede a successful forget (RF-003), origin
is forced and reason required on both surfaces (RF-011/012), no secret or memory
content reaches any log (RF-007/013), 11 tools and the 101-assertion bar check
out statically (RF-009/010), typecheck clean (RF-014), and the diff is strictly
additive over frozen code (RF-008/015). But CE-001 falsifies the frozen
contract's "one governance line" invariant with a two-line payload — Medium,
fix path is neutralizing `\r`/`\n`/control chars in `reason` (and `project`)
before interpolation or rejecting them in the schema. CE-002/CE-003 are Low:
doc/parity overstatement and a test-coverage gap respectively. Gate should hold
at CONDITIONAL until CE-001 is remediated or waived by domain owners.

**Rationale (one line):** Every load-bearing P3.1 claim withstood adversarial
probing, but newline-bearing `reason` breaks the contract's single-line
governance log (forgable audit entry) — Medium — with two Low findings
alongside.
