# C3 Conditional/Waiver Interrogation — Quality Gate P3.1

**Lane:** C3 (security-owned) — interrogates every CONDITIONAL justification and
accepted-risk waiver against the normative three-block bar only (no re-review, no
re-dispatch, no code changes).
**Date:** 2026-09-22 (round 2 — surgical re-interrogation of the 7 FAIL rows only;
PASS rows R1, R3, R4, R5, R7, R8, R9, R10, R11, R12 carried forward unchanged from
round 1 with their proof refs intact)
**HARD bar:** `frame-ship/skills/quality-gate/references/waiver-template.md:14-31` —
`Accepted-risk` + `Compensating-controls + owner` + `Expiry/Re-review date-or-condition +
owner`; missing block = FAIL; vacuous box-tick = FAIL; expiry default 90 days or next
release whichever first, re-review owner mandatory; claimed-cleared conditions are
proof-checked (diff/line/log) instead; residual-risk must be explicit (`risk + owner`
or `none + owner`), silent approve = FAIL.

**Row-type rule (stated once):** rows covering a **claimed-cleared** condition are
judged by proof (three-block cells = n/a-fixed); rows covering an **accepted/waived**
residual must carry all three blocks with substance. Sample-of-one never satisfies —
every CONDITIONAL and every accepted residual from the packet gets its own row.

**Round-2 inputs (reference-only packet):** remediation `d7a7628` (R13 masking/allowlist
declaration), remediation `addc589` (R17 schema bounds), waiver record
`docs/specs/40_workspace/quality-gate/P31/waivers.md` (W1–W4 covering R2, R14, R6, R15,
R16).

## Row table

| # | Row (source finding / residual) | Accepted-risk | Compensating-controls + owner | Expiry + re-review owner | verdict |
|---|---|---|---|---|---|
| R1 | refuter **CE-001** newline governance-log forgery (review-refuter.md:38) | n/a — claimed **cleared**, not waived | Proof: `transform(\s+→" ")` before bounds on both lanes — `src/server.ts:53-66`, `src/mcp.ts:92-112`, applied in `deleteBodySchema` and `deleteInput`; commits **5df18b6** + **addc589** (bounds now on both sides, comment `mcp.ts:86-94`); zod-v3 probe (re-run round 2): forged `"ok\n[agentmemory] delete governance…"` → one normalized line (1 line), whitespace-only → reject. Owner: P3.1 implementer (fixed) | n/a (fixed) | **PASS** (carried; sub-residual ESC/NUL → residual line 1) |
| R2 | refuter **CE-002** / security **SEC-003**: MCP unknown keys *stripped*, not rejected (review-refuter.md:39, security-review.md:34) — behavioral acceptance | **Present, substantive (W1)**: SDK-mediated strip vs REST 400; why-accept stated — reject requires custom MCP middleware outside P3.1's approved file list; `origin` server-forced both lanes so stripping cannot spoof provenance; difference documented, not hidden (`waivers.md:34-40`) | **Present, named owner (W1)**: 4 evidence-ref'd controls — verify N2 extra `origin` → 400 (`scripts/verify.ts`), `origin` forced (`src/mcp.ts:330`), README strip-vs-reject paragraph (`README.md:111-116`, commit `fff74ad`), `_meta.authorization` gate on all 11 tools (`mcp.ts:136`); **Owner: engineering owner (implementation), security owner (acceptance)** (`waivers.md:47-50`) | **Present (W1)**: 2026-12-21 (90d) or next MCP input-layer/tool-surface change, whichever first; **re-review owner: security owner** (`waivers.md:52-53`); sign-off engineering + orchestrator + **security owner** (`waivers.md:55`, `:158`) | **PASS** (flipped — W1 all three blocks substantive) |
| R3 | refuter **CE-003** recap session-membership assertion gap (review-refuter.md:40) | n/a — claimed **cleared** | Proof: membership check — `scripts/verify.ts:566-574` ("every bullet line belongs to the requested session"), commit **bfc10c5**; census = 77 `check(` sites + 25 `shape(` = **102** (`README.md:418`) | n/a (fixed) | **PASS** (carried) |
| R4 | refuter **RF-002 residual** — `counts.memories` deref outside try (review-refuter.md:19) | Clearance claim, not a waiver: argued unreachable | Proof-checked: `counts` pre-initialized to safe defaults (`src/server.ts:356`), header build cannot throw (`:363`); `HelixStore.healthCounts` throws instead (`src/store.ts:498-511`) | n/a (clearance) | **PASS** (carried) |
| R5 | risk **RK-P31-1** (High) log forgery via verbatim `reason` (review-risk.md:24) | n/a — claimed **cleared** | Proof: same as R1 — commits **5df18b6** + **addc589**, both lanes, probe re-verified round 2 (newline collapsed, whitespace-only rejected) | n/a (fixed) | **PASS** (carried) |
| R6 | risk **RK-P31-2** waiver — receipt omits `reason` (review-risk.md:25) | **Present, substantive (W2)**: accepted as by-design — reason has exactly ONE durable place (governance line); duplicating into receipt creates a second copy with no retention policy; contract §3 documents omission (`waivers.md:64-69`) | **Present, named owner (W2)**: (1) single-line governance line emitted only after confirmed delete (both lanes, `5df18b6`), (2) contract §3 purpose/store/retention/deletion + receipt semantics (`f2a65d4`, `d7a7628`), (3) field allowlist + no-PII rule (`d7a7628`); **Owner: engineering owner**; evidence-ref CONTRACT §3 + `src/server.ts` delete handler (`waivers.md:71-77`) | **Present (W2)**: 2026-12-21 (90d) or next contract revision touching the delete route, whichever first; **re-review owner: engineering owner** (`waivers.md:79-81`); sign-off engineering + orchestrator | **PASS** (flipped — W2 all three blocks substantive) |
| R7 | risk **RK-P31-3** (Medium) duplicated digest → dual-lane drift (review-risk.md:26) | n/a — claimed **cleared** (mitigation option "extract shared helper" taken) | Proof: single definition `src/digest.ts:45`; both lanes import (`server.ts:19`, `mcp.ts:18`); commit **3221b93** — drift impossible by construction | n/a (fixed) | **PASS** (carried; coverage residual line 5) |
| R8 | risk **RK-P31-7** (High) verify wrote into upstream; evidence not reproducible (review-risk.md:30) | n/a — claimed **cleared** | Proof: read-only identity guard **before first write** — probe `scripts/verify.ts:259`, abort exit 1 + "No data was written." (`:253-279`), first write only at `:304`, commit **bfc10c5**; README 3151 procedure (`README.md:374-375`, `:427-428`); packet evidence 102/0 on 3151 (live run reference-only; static census corroborates 102; neither round-2 commit touches `verify.ts`) | n/a (fixed) | **PASS** (carried; capability-probe residual line 4) |
| R9 | data **DAT-001** control chars/newlines in `reason` (review-data.md:21) | n/a — claimed **cleared** | Proof: same as R1/R5 — commits **5df18b6** + **addc589**, probe re-verified round 2 | n/a (fixed) | **PASS** (carried) |
| R10 | data **DAT-002** governance log = new PII-capable store, no TTL/deletion (review-data.md:22) | n/a — **declaration claimed**, proof-checked | Proof: `docs/CONTRACT.md:150-159` (commits **f2a65d4** + **d7a7628**) declares **purpose** = operational audit of destructive deletes (only permitted use of `reason`); **store** = process stdout/stderr, no durable repo store; **retention** = host log rotation; **deletion** = rotation or process exit; mirrored `README.md:327-341` | n/a (declaration) — TTL quality tracked as residual line 2 | **PASS** (carried) with residual: purpose ✓, deletion ✓, TTL declared as *host-delegation* — no numeric window |
| R11 | data **DAT-003** `deletedAt` = ack time, not store commit time (review-data.md:23) | n/a — **documentation claimed**, proof-checked | Proof: `docs/CONTRACT.md:156-158` — "`deletedAt` is the server time captured immediately after the store confirms the delete" (commit **f2a65d4**); mirrored `README.md:333-336` | n/a (documented) | **PASS** (carried) |
| R12 | security **SEC-001** (Medium) log injection via `reason` (security-review.md:32) | n/a — claimed **cleared** | Proof: same as R1/R5/R9 — commits **5df18b6** + **addc589**; line emitted only post-confirmed-delete, hand-rendered from 3 fields (`server.ts:404`, `mcp.ts:355`) | n/a (fixed) | **PASS** (carried; sub-residual → residual line 1) |
| R13 | security **SEC-002** (Medium) undeclared PII store — checkpoint requires masking/minimization **and** TTL/deletion "declared **and enforced**" (security-review.md:33, :42-45) | n/a — **declaration claimed**, proof-checked against commit **d7a7628** | Proof: `docs/CONTRACT.md:154-161` declares **Masking/minimization (SEC-002 control 1)**: strict field **ALLOWLIST** — only `memoryId`, normalized `reason` (single line, ≤1000), `at`; no memory content/embedding/header ever on the line ("rendered by hand from those three values on both lanes, never by stringifying a stored object" — mechanically true at `server.ts:404` / `mcp.ts:355`); operator/caller **no-PII-in-reason** rule (bearer-gated, length-bounded); **host log masking/retention** instruction; mirrored `README.md:338-341`. Substance backstop: non-vacuous — exact fields, exact bound, responsibility assignment, host masking directive. Owner: P3.1 implementer (declared), deploying operator (host masking) | n/a (declaration, not a waiver) — carried gaps restated as residual lines 2 and 3 | **PASS** (flipped — checkpoint controls now both declared with artifact; PII checkpoint closes. The no-PII rule is advisory, not machine-enforced — honestly characterized and recorded as residual 3, not silently approved) |
| R14 | security **SEC-003** (Low) MCP strip-vs-reject parity (security-review.md:34) | Same acceptance record as R2 — **W1** substance present (Low, origin forced) | Same as R2 — W1 controls + named owners (engineering implementation, security acceptance) | **Present (W1)**: same 2026-12-21/condition expiry; re-review owner security owner; security co-sign present | **PASS** (flipped — same W1 record, security-domain co-sign verified `waivers.md:158`) |
| R15 | accepted residual: **project newline** → handoff header/bullet text only, no log sink (CE-001 location note; security-review.md:25 §6) | **Present, substantive (W3)**: `project` interpolated into handoff header without newline normalization could visually split returned digest text; why-accept — **no log/export sink exists**, text returns only to the same authenticated caller who supplied `project`, memory content legitimately contains newlines, tenant key bounded 1..200 (`waivers.md:92-98`) | **Present, named owner (W3)**: (1) digest text never reaches any log — access log method/path/status/duration only (`server.ts:455-456`), MCP stdout protocol-only, (2) bearer guard precedes routes, (3) `project` bound 1..200 (`server.ts:37`); **Owner: engineering owner**; evidence-ref access-log + digest call sites (`waivers.md:100-105`) | **Present (W3)**: 2026-12-21 (90d) **or immediately upon ANY change giving recap/handoff output a log/export sink** (re-triggers security review); **re-review owner: engineering owner; security owner co-reviews if a sink is added** (`waivers.md:107-110`) | **PASS** (flipped — W3 all three blocks substantive; explicit `none + engineering owner` residual allowed by bar) |
| R16 | accepted residual: **digest budget best-effort** — partial digest + worst ≈35s (20s between-call check + one in-flight 15s store call; commit 3221b93) | **Present, substantive (W4)**: `DIGEST_BUDGET_MS=20_000` checked BETWEEN calls; in-flight call may run full 15s → worst ≈35s not a hard 20s kill; why-accept — hard-kill mid-call would silently lose the in-flight row instead of reporting it in `signals[]`, and batched `sessionMemories` needs a `db/queries.ts` change outside P3.1's frozen file list (`waivers.md:121-127`) | **Present, named owner (W4)**: (1) budget stop + `digest: budget exceeded` signal (`3221b93`, `digest.ts:75`) — bounded visible degradation vs prior ~25min theoretical fan-out, (2) per-call 15s `QUERY_TIMEOUT_MS` (`store.ts:36`), (3) `limit` bound 1..100 caps call count (`server.ts:42`); **Owner: engineering owner**; evidence-ref `src/digest.ts`, verify 102/0 (`waivers.md:129-134`) | **Present (W4)**: 2026-12-21 (90d) or next digest/performance change, whichever first; **re-review owner: engineering owner** (`waivers.md:136-137`); sign-off engineering + orchestrator | **PASS** (flipped — W4 all three blocks substantive) |
| R17 | accepted residual: **MCP `tools/list` no longer advertised min/max** for `memory_delete` (regression from 5df18b6) | n/a — claimed **cleared**, not waived | Proof: commit **addc589** re-applies bounds on BOTH sides of normalize in both lanes (`src/mcp.ts:96-112`, `src/server.ts:56-66`); **probe re-run by C3 (round 2)**: `tools/list` schema again emits `memoryId minLength:1/maxLength:200` and `reason minLength:1/maxLength:1000`; COND-001 re-proven — newline reason → one normalized line, whitespace-only → reject, empty → reject, 1001 raw → reject, 1000 raw → accept. Owner: P3.1 implementer (fixed) | n/a (fixed) | **PASS** (flipped — proof above) |

**Final tally: 17 rows — 17 PASS, 0 FAIL.** (Round 1 was 10 PASS / 7 FAIL; rows R2, R6,
R13, R14, R15, R16, R17 flipped on proof: R13 → commit `d7a7628`, R17 → commit `addc589`,
R2+R14 → waiver W1, R6 → W2, R15 → W3, R16 → W4.)

## Waiver interrogation detail (W1–W4 vs three-block bar)

| Waiver | Block 1 Accepted-risk | Block 2 Compensating + owner | Block 3 Expiry + re-review owner | Residual-risk explicit | verdict |
|---|---|---|---|---|---|
| **W1** (R2+R14, security domain) | ✓ risk + why, non-vacuous | ✓ 4 evidence-ref'd controls, named owners (engineering impl / security acceptance) | ✓ 2026-12-21 or MCP-layer change; re-review: **security owner** | ✓ "non-origin unknown keys dropped — Low — owner: engineering" | **PASS** — **security-owner co-sign confirmed** (`waivers.md:55`, `:158` "W1 only") |
| **W2** (R6, engineering) | ✓ risk + why (single durable place) | ✓ 3 commit-ref'd controls, owner: engineering | ✓ 2026-12-21 or next delete-route contract rev; re-review: engineering owner | ✓ "receipt↔reason link lost if logs discarded — Low — owner: deploying operator" | **PASS** |
| **W3** (R15, engineering) | ✓ risk + why (no sink, same caller) | ✓ 3 line-ref'd controls, owner: engineering | ✓ date **and** condition (any log/export sink re-triggers security review); re-review: engineering + security co-review on sink | ✓ "none while no sink — `none + engineering owner`" (allowed form) | **PASS** |
| **W4** (R16, engineering) | ✓ risk + why (≈35s worst case, hard-kill breaks signals model) | ✓ 3 controls w/ refs, owner: engineering | ✓ 2026-12-21 or next digest/perf change; re-review: engineering owner | ✓ "worst ≈35s latency — Medium — owner: engineering" | **PASS** |

Reviewer-judgment reasons (substance backstop): none of the four is a box-tick — each
states risk *and* the reason for accepting it, each control carries a commit/file/line
evidence-ref, each expiry is a concrete date (2026-09-22 + 90 days = 2026-12-21, default
confirmed at `waivers.md:12-13`) plus a whichever-first condition, and each re-review
owner is a named role. Sign-off recorded (`waivers.md:156-158`); the single-maintainer
delegation assumption behind engineering-owner+orchestrator dual role is stated
explicitly in the header (`waivers.md:3-6`) — assumption surfaced, not hidden.

## Explicit residual-risk lines (risk + owner — no silent approves)

1. **Control chars beyond whitespace survive sanitize** — probe re-confirmed round 2:
   ESC (`\u001b`) passes `replace(/\s+/g," ")` (`server.ts:57-66`, `mcp.ts:96-112`);
   single-line invariant holds, terminal-escape/CWE-117 residue remains. **Low.
   Owner: P3.1 implementer** (fix at next rev); security owner re-verifies at W1 expiry.
2. **Governance-log TTL is host-delegated, no numeric window** (`docs/CONTRACT.md:152-153`)
   — unbounded if host logs never rotate; security-review.md:44 recommended ≤90d /
   memory-retention. **Medium (privacy). Owner: security owner** to pin the window at
   re-review; engineering owner records it in CONTRACT §3.
3. **No-PII-in-reason rule is advisory (caller responsibility), host masking delegated**
   (`d7a7628`, CONTRACT §3:158-161) — not machine-enforced at write time. **Low-Medium.
   Owner: deploying operator** (host masking/retention); engineering owner may replace
   free text with a reason-code allowlist at W2 re-review.
4. **Identity guard is capability-based, not version-pinned** (`verify.ts:259` — any
   server answering 200 on `POST /agentmemory/recap` passes). **Low. Owner: P3.1
   implementer.**
5. **MCP mirrors still behaviorally unasserted** (`scripts/verify.ts:500`) — drift
   eliminated by single digest module; lane-wiring divergence uncovered. **Low. Owner:
   P3.1 implementer** (test lane).
6. **Partial digest under budget** — `digest: budget exceeded` truncates fan-out, worst
   ≈35s — **Medium (latency only). Owner: engineering owner** (waiver W4 residual of
   record, `waivers.md:141-142`).
7. **Doc hygiene:** `IMPLEMENTATION_PLAN.md:39` still claims "101 passed" while
   `README.md:418` and the census say 102. **Low. Owner: P3.1 implementer.**
8. **Waiver-record residuals of record:** W1 — non-`origin` unknown keys dropped on MCP
   lane (Low, engineering); W2 — receipt↔reason link lost if host discards logs (Low,
   deploying operator); W3 — `none` while no digest log/export sink exists (engineering
   owner; converts to a security finding the moment a sink is added).

## PII checkpoint statement

**Zero PII/secrets/tokens/credentials/sessions in this artifact, questions/answers, or
the waiver text.** All evidence is allowlisted: commit hashes (5df18b6, bfc10c5, 3221b93,
f2a65d4, fff74ad, d7a7628, addc589), file:line references, finding/waiver IDs, and
synthetic probe payloads (fake `memoryId=FAKE-ID`, synthetic newline/ESC strings) — no
bearer values, no memory content, no customer data, no raw log excerpts. The governance
log line is now a fully **declared** PII checkpoint: field allowlist + no-content rule +
no-PII operator rule + masking directive (`docs/CONTRACT.md:154-161`, `d7a7628`) with
purpose ✓, deletion ✓, TTL declared-but-host-delegated (residual 2). Ley 172-13
minimization: purpose + TTL + deletion declared; remaining gap is bounded-window pinning,
recorded above with owner.

## Overall C3 verdict: **PASS**

All 6 claimed-cleared conditions from round 1 remain proof-verified (no regressions:
neither round-2 commit touches frozen routes, `verify.ts`, or prior proofs). The two
substantive round-1 failures are fixed with proof — R13 by `d7a7628` (declaration is
substantive, field allowlist mechanically true, PII checkpoint closes) and R17 by
`addc589` (probe-verified bounds restored on both surfaces with COND-001 behavior
re-proven). The four record-gap waivers W1–W4 all carry the three blocks verbatim with
named owners, concrete 90-day expiry + whichever-first conditions, and explicit
residual-risk lines; W1 carries the required security-owner co-sign. **Zero FAIL rows
remain out of 17 → C3 PASS.** All 8 residual lines above stay explicit with owners
(silent-approve rule satisfied); GATE closure itself remains the orchestrator's call.

**Sign-off status:** security owner (C3) — PASS verdict recorded 2026-09-22;
domain-owners + orchestrator sign-off recorded in `waivers.md:156-158`.
