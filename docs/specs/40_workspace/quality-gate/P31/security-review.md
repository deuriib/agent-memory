# Security Review: P3.1 (recap/handoff/lesson/delete)

**Reviewer:** security-reviewer (security owner, quality gate P3.1)
**Date:** 2026-09-22
**Verdict:** CONDITIONAL
**Scope:** `git diff e9fd325..HEAD` — 6 commits (33849ee, d724f66, fb2e451, e3abc6e, 77f292f, 3013621), 7 files, +659/-16. Additive-only respected: `hooks/`, `db/queries.ts`, `helix.toml`, `package.json`/lock untouched (`git diff --stat` → no rows).

## Checklist

- [x] Threat model complete (STRIDE) — table below
- [x] AuthN/AuthZ verified — proof in "Auth inheritance" below
- [x] Input validation at all boundaries — strict zod, unknown-first; one Low deviation (SEC-003)
- [x] Secrets not in code — no literal in diff; `secretFromEnv()` only; startup log prints guard state, never the value (`src/server.ts:526-529`)
- [x] Dependencies scanned — zero dependency changes in range → no new supply-chain surface
- [ ] Data handling compliant (PII, Ley 172-13) — OPEN: governance-line TTL/masking not declared (SEC-002, checkpoint below)
- [x] Audit logging in place — governance line on confirmed delete (`src/server.ts:445-447`, `src/mcp.ts:399-401`); access log still method/path/status/duration only (`src/server.ts:497-498`, `pathnameOf` strips query at `:191-195`)

## Verified-clean controls (evidence-backed, no finding)

1. **Trust boundary on every new body** — `recapBodySchema`/`lessonBodySchema`/`deleteBodySchema` are `.strict()` (`src/server.ts:77-102`); content ≤200k (`:35`), reason 1..1000 (`:44`), memoryId ≤200 (`:43`); `readJsonBody` enforces 415 non-JSON + 1 MiB cap (`:154-176`, `:164`); unknown-first then zod-narrow via `parseOr400` (`:137-146`). Extra-key rejection proven live: `scripts/verify.ts` N2 asserts lesson body with `origin` → 400.
2. **Auth inheritance** — REST: guard at `src/server.ts:272-277` runs before *every* route block (new routes dispatched later at `:380-450`); only `/agentmemory/livez` exempt. MCP: `handle()` checks `isMetaAuthorized(meta, secret)` first (`src/mcp.ts:168-175`) and all 4 new tools wrap it (`:322, :342, :371, :393`); `_meta.authorization = Bearer <secret>` gate unchanged (T-002, TEST_MATRIX.md:10). Comparison is constant-time (`src/auth.ts:19-38`).
3. **Destructive annotation** — `memory_delete` declares `readOnlyHint:false, destructiveHint:true, idempotentHint:true` (`src/mcp.ts:397`) — correct for a hard delete; repeat-delete no-op state-wise, so `idempotentHint` holds.
4. **Receipt forgery — REFUTED** — 200 `{deleted:true}` only after `store.forget()` → `indicatesPresence(response)` (`src/store.ts:491-495`, `:291-309`; `{}`/`[]`/`null`/`0`/`false` → false → 404). Live proof on real backend: second delete of same id → 404 and unknown-id → 404 (`scripts/verify.ts:598-614`); receipt fields are server-built (caller supplies neither `deletedAt` nor outcome). Governance line is emitted only *after* a confirmed delete (`src/server.ts:437-447`) — no log entry without an actual deletion.
5. **No secret/content echo in errors or recap** — 500 body is fixed `{error:"internal_error"}` (`src/server.ts:470`); MCP failures fixed `{error:"internal_error"}` (`src/mcp.ts:180`); `failureSignal`/`logSafeNote` never see the bearer (`src/errors.ts:15-16`), signals are single-line and truncated (`:20-22`). Recap/handoff return memory content only to an authenticated caller — by design, authorized.
6. **Digest injection — no sink** — digest strings leave only via `JSON.stringify` (`src/server.ts:127`, `src/mcp.ts:92`), which escapes control chars; grep for `html|innerHTML|execSync|spawn|eval(` finds only a test fixture (`scripts/verify-injection.ts:289`); digest content is never logged (access log excludes bodies). No downstream HTML/command execution path exists.
7. **Least privilege** — no new exemption beyond `livez`; default bind 127.0.0.1 (`src/server.ts:517`); `lesson` origin forced to constant `LESSON_ORIGIN` server-side (`src/server.ts:426`, `src/mcp.ts:377`) — caller cannot spoof origin on either surface.

## Findings (STRIDE-mapped)

| ID | STRIDE | Severity | Finding | Location | Evidence | Owner |
|----|--------|----------|---------|----------|----------|-------|
| SEC-001 | Tampering / Repudiation (CWE-117, log injection) | Medium | `reason` allows embedded newlines/control chars (`.trim()` strips only ends, no pattern) and is interpolated verbatim into the governance log line — a caller can inject forged `[agentmemory] delete governance …` lines (e.g. `reason="x\n[agentmemory] delete governance memoryId=FORGED reason=y at=…"`), corrupting the audit trail of a compliance control | `src/server.ts:44` + `:445-447`; `src/mcp.ts:88` + `:399-400` | Both `reasonSchema`s are `z.string().trim().min(1).max(1000)` with no control-char exclusion; both log templates interpolate `reason` raw; reachable on every *confirmed* delete (auth-guarded when secret set, unauthenticated when guard disarmed) | P3.1 implementer |
| SEC-002 | Information Disclosure / Privacy (Ley 172-13) | Medium | Governance log line stores caller free text (up to 1000 chars) verbatim with no masking and no declared TTL/deletion procedure — a caller can paste customer PII into `reason`, creating an unbounded PII store; contract §3 declares "reason is metadata" but no retention or masking rule | `src/server.ts:445-447`; `src/mcp.ts:399-400`; `docs/CONTRACT.md` §3 P3.1 paragraph | Diff shows raw `reason=${body.reason}` / `reason=${args.reason}`; grep of contract/README/plan shows no TTL, retention, or masking declaration for governance lines (PII checkpoint below stays OPEN) | P3.1 implementer |
| SEC-003 | Tampering (input-validation depth) | Low | MCP tool inputs are raw zod shapes; SDK builds a plain `z.object(shape)` — unknown keys are silently *stripped*, not rejected (REST rejects with 400). Parity gap only: no exploit, because `memory_lesson` forces `origin` server-side and `memory_delete` extra keys are dropped without effect | `src/mcp.ts:70-89`; `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js:14-24` (`objectFromShape` → `z.object(shape)`, no `.strict()`); mitigation `src/mcp.ts:377` | SDK `objectFromShape` returns non-strict `z3.object/z4mini.object` (Zod default = strip); origin spoof neutralized by `LESSON_ORIGIN` constant; verify N2 proves REST-side 400 (`scripts/verify.ts` N2) | P3.1 implementer |

No Critical or High findings. Per severity policy, Critical/High would block here; Mediums are scheduled within sprint — hence CONDITIONAL, not PASS.

## PII checkpoint — governance log line (explicit)

- **Purpose:** accountability record for governed deletions under Ley 172-13 — *who deleted which `memoryId`, when, and why*. This is the only lawful basis to retain `reason`; nothing else may consume it.
- **PII risk:** `reason` is unstructured caller free text (≤1000 chars) that can carry personal data (names, customer records, tickets).
- **Required controls (checkpoint OPEN until both are declared and enforced — tracked as SEC-002):**
  1. **Masking/minimization at write:** prefer structured reason codes (allowlist) over free text; if free text stays, strip or hash direct identifiers before interpolation — never log raw PII.
  2. **TTL + deletion:** declare a retention window for governance lines with automated deletion — default recommendation: **90 days, or the retention of the project's memory data, whichever is shorter** (audit log must not outlive the data it justifies). Until declared, no governance line may be shipped to long-term log storage.
- **Status:** purpose declared (this statement); TTL/deletion + masking NOT yet implemented → SEC-002 open.

## Verdict Rationale

CONDITIONAL: deny-by-default boundaries, pre-dispatch auth inheritance on both surfaces, correct destructive annotation, no receipt forgery, and no secret/PII sinks in responses are all proven with line-level evidence — but the new governance log line is injectable via `reason` newlines (SEC-001) and is an undeclared PII store with no TTL/masking (SEC-002), both Medium and schedulable within sprint; SEC-003 (Low) is a non-exploitable parity gap. Gate can pass once the owner accepts or remediates SEC-001/SEC-002 in the same sprint and closes the PII checkpoint; no Critical/High blocks this session.
