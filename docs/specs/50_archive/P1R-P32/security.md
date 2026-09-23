# Security Review: P1 remainder + P3.2

**Reviewer:** security-reviewer (security owner, independent — did not write this code)
**Date:** 2026-09-23
**Scope:** `d17294b..HEAD` — `591c79c` (REQ-P1-4), `39fec28` (REQ-P1-2), `df39d7d` (REQ-P1-5), `c69636d` (REQ-P3.2), `2deda68` (docs/v0.5.0)
**Verdict:** ✅ pass

## Checklist

- [x] Threat model complete (STRIDE) — §STRIDE below
- [x] AuthN/AuthZ verified — no auth hunks in the diff; livez-only exemption intact
- [x] Input validation at all boundaries — zod envelopes, URL/searchParams, structured Helix params
- [x] Secrets not in code — 3 grep scans (§Evidence), zero hits
- [x] Dependencies scanned — no new dependencies (package.json diff = version + 2 script entries)
- [x] Data handling compliant (PII, retention, Ley 172-13) — synthetic corpus; every skill carries the no-secrets/PII rule
- [x] Audit logging in place — server access log unchanged (metadata-only, `src/server.ts:413`)

## STRIDE

**S — Spoofing.** New outbound clients (eval `RestClient`, verify-skills `call()`) identify their
target with a read-only identity guard (`POST /memory/recap {}` must 200) BEFORE the first write
(`scripts/eval.ts:498-522`, `scripts/verify-skills.ts:348-384`); 401 / non-200 / unreachable aborts
with "No data was written". Same heuristic as the pre-existing `scripts/verify.ts:266` — see
RES-001 (accepted residual). Bearer auth on the server side unchanged: `src/server.ts:238`
`path !== "/memory/livez" && !isBearerAuthorized(...)` — the only exemption is still livez, and the
`src/server.ts` diff contains ONLY the `DEFAULT_IMPORTANCE` removal + raw-optional passthrough
(2 hunks); no route, guard, or header check was modified. No new route was added — consolidation
runs inside the already-authenticated `POST /memory/remember`.

**T — Tampering.** Two new write paths, both bounded:
(1) Tier-1 merge (`39fec28`) — the survivor probe is project-scoped
(`searchByText({q, project: input.project, k: 20})`, `src/store.ts` rememberLocked step 2), so a
caller can only ever mutate rows in its OWN project; `updateMemoryContent` anchors by `memoryId`
from that scoped probe (`db/queries.ts`, `Predicate.eqParam` + `defineParams` — structured, no
string-built Cypher; grep `MATCH |RETURN |cypher` in `db/queries.ts` → exit 1, no hits). Merge is
concat-only (`mergedContent`, `src/consolidate.ts:74-79`) — no content can be destroyed even under
a pathological threshold. Fail-closed asserts throw rather than report a silent no-op merge.
(2) eval seeding / verify-skills round-trips — writes only to dedicated projects
`agent-memory-eval` / `verify-skills`, cleanup forgets only ids this run created
(`scripts/verify-skills.ts:569-587`). A foreign target can only receive writes if it answers 200
on `POST /memory/recap` (RES-001, operator-controlled env).

**R — Repudiation.** Server access log unchanged (metadata only, never content/secret —
`src/server.ts:413`). probe4 stdout discipline: response keys + array lengths only, never content
or embedding values (`summarizeResponse`, `scripts/probe4.ts:200-210`) — EXCEPT the raw
`helix.details` path, SEC-001.

**I — Information disclosure.**
- `AGENT_MEMORY_SECRET` is read once (`scripts/eval.ts:66`, `scripts/verify-skills.ts:36`) and used
  ONLY inside `authHeaders()` (`eval.ts:112-118`, `verify-skills.ts:225-231`).
  Evidence: `grep -rEn 'console\.(log|error|warn).*SECRET' scripts/eval.ts scripts/verify-skills.ts scripts/probe4.ts` → exit 1 (no hits). The abort/fail messages print status codes, `brief()`-truncated bodies (JSON.stringify → newlines escaped) or `logSafeNote()` (whitespace-collapsed single line, `src/errors.ts:20-22`).
- Scorecard/stdout carry no secrets or PII (scans in §Evidence; corpus is invented dev/ops facts).
- Skills reference the secret only as `-H "authorization: Bearer $AGENT_MEMORY_SECRET"` (env
  indirection, 8 skill files) — no literal value anywhere.
- Residual: base-URL echo (SEC-002).

**D — Denial of service.** New knob cannot be forced into a dangerous state (§Env knob). Recall
ledger bounded (cap 10k, clear-on-overflow, `src/confidence.ts:86-99`). Eval HTTP timeout 10 s,
body cap 1 MiB pre-existing. No unbounded queue or loop added; near-dup probe is fixed k=20.

**E — Elevation of privilege.** No auth change (above). Consolidation cannot cross project
boundaries (project-scoped probe). MCP/server/plugin now pass raw optional `importance`
(`src/mcp.ts`, `src/server.ts`, plugin `fraction()` still validates 0..1 client-side) — value
ranges enforced by zod/`fraction()`; `deriveWriteImportance` clamps to 0..1
(`src/confidence.ts:19-25,47-53`).

### Lens answers (1)-(6)

1. **Boundaries.** eval `RestClient` validates every response with zod (`healthEnvelopeSchema`,
   `rememberResultSchema`, `searchEnvelopeSchema`) + expected status + expected `mode` —
   fail-closed `parseOrFail` (`eval.ts:153-175`). SSRF via `AGENT_MEMORY_URL`: NOT exploitable by
   untrusted input — env-operator-controlled, default `http://127.0.0.1:3111`, identity-guarded
   before any write, non-http schemes fail at `fetch` (status -1 → abort). Residual =
   RES-001. verify-skills identity guard (above) runs before the first write; PART 1 is local file
   reads over a hardcoded `SKILL_CONTRACTS` table (no path built from external input).
2. **Injection.** No shell/exec/`eval(`/`new Function` in any new file —
   `grep -rEn 'child_process|execSync|spawn|exec\(|eval\(|new Function|process.binding' scripts/eval.ts scripts/verify-skills.ts scripts/probe4.ts eval/ src/confidence.ts src/consolidate.ts` → exit 1 (no hits).
   HTTP paths/queries built via `new URL` + `searchParams.set` (`eval.ts:103-109`,
   `verify-skills.ts:217-223`); session path segment uses `encodeURIComponent`
   (`verify-skills.ts:503`). Helix writes fully parameterized (`defineParams`/`param.*`/
   `Predicate.eqParam`/`PropertyInput.param` — `db/queries.ts` `updateMemoryContentParams`).
   **CWE-117:** eval summary prints only static text + numbers + const project + `EVAL_MODE` env;
   query text goes to SCORECARD.md (in-repo corpus, pipe-escaped, not a log); failure paths use
   `brief()` (JSON.stringify escapes `\n`) or `logSafeNote` (single-line). verify-skills PASS/FAIL
   names are static/local-generated; details are `brief()`/`JSON.stringify`/single-line frontmatter
   values. probe4 prints keys/lengths. One deviation: raw `helix.details` in probe4 → SEC-001.
3. **Secrets.** Scans recorded in §Evidence — zero real hits (SCAN 2 hits are the scanner's own
   regex literals inside verify-skills, self-referential).
4. **Env knob `AGENT_MEMORY_MERGE_JACCARD`.** Fail-closed OFF verified in code:
   `mergeThreshold()` (`src/consolidate.ts:47-53`): absent → 0.9; `!Number.isFinite || ≤0 || ≥1`
   → `undefined` → consolidation OFF (`""`→0→OFF, `abc`→NaN→OFF, `1e999`→Infinity→OFF,
   `0.5x`→NaN→OFF). A garbage value can never invent a threshold; an in-range value still cannot
   lose text (concat-only merge). Documented consistently (README:416, CONTRACT:238, CHANGELOG:20).
5. **Auth unchanged.** Confirmed — §STRIDE-S: no route bypass added, livez-only exemption intact.
6. **Skills docs.** No insecure instructions: secret only via env-var header, all 9 files carry the
   "Never store secrets or PII (Ley 172-13)" rule (grep evidence), examples use invented content,
   `forget` even warns the `reason` lands in a log line (`skills/forget/SKILL.md:64`).

## Findings

| ID | Severity | Finding | Evidence | Owner | Remediation |
|----|----------|---------|----------|-------|-------------|
| SEC-001 | Low | `probe4.ts describeError()` prints raw `helix.details` to stdout, deviating from the repo's own `logSafeNote` discipline — `src/errors.ts:9-16` documents that REMOTE diagnostics can embed query parameters (memory content), which is exactly why `logSafeNote` reduces them to a stable code. probe4 does not import `logSafeNote`. Impact bounded: dev-only script, probe content is synthetic nonce text, no PII/secret can reach these errors. | `scripts/probe4.ts:141-149` vs `src/errors.ts:9-16,63-73`; probe4 import list `:51-81` (no `errors.js`) | engineering (execute-spec lane) | Route HelixError-Remote details through `logSafeNote` in probe4 (hygiene; probe already shipped VERDICT A — backlog, Low) |
| SEC-002 | Low | The target base URL is echoed to stdout AND persisted into the committed `docs/benchmarks/SCORECARD.md` — if an operator ever put URL-borne credentials/query tokens into `AGENT_MEMORY_URL`, they would land in logs and a repo artifact. Precondition is operator misuse (auth-by-design is the bearer header, never the URL); no default value contains credentials. | `scripts/eval.ts:495` (`target=${...href}`), `scripts/eval.ts:415` (scorecard `| Server | ${...href}`), `scripts/verify-skills.ts:358,372,388` (abort prints href) | ops (eval/verify-skills owners) | Strip `username/password/search` when displaying or persisting the base URL (one-line helper); Low — backlog |
| RES-001 | Info (accepted residual) | Identity guard is heuristic: any target that answers 200 to `POST /memory/recap {}` passes and receives writes. Identical to the pre-existing `verify.ts:266` pattern; target comes from operator env with localhost defaults, so an attacker-controlled base URL requires operator misconfiguration. Accepted with owner + expiry: expires when server auth gains a stronger fingerprint (e.g., challenge endpoint), then both guards should upgrade together. | `scripts/eval.ts:499-521`, `scripts/verify-skills.ts:353-383`, `scripts/verify.ts:266-286` (pre-existing) | ops (operator must point `AGENT_MEMORY_URL` at our server) | Documented acceptance; upgrade guard when auth surface evolves |

**Findings count: 2 (Low) + 1 accepted residual (Info).** No Critical, no High, no Medium.

## Evidence (scan commands + results)

```
# SCAN 1 — classic token patterns (eval/, skills/, docs/benchmarks/, src/confidence.ts,
#          src/consolidate.ts, scripts/{eval,verify-skills,probe4}.ts)
grep -rEn 'ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}' <targets>
→ exit 1 (no matches)  ✅

# SCAN 2 — secret env with a value
grep -rEn 'AGENT_MEMORY_SECRET=[^$[:space:]"]+' <same targets>
→ 2 hits, both the scanner's OWN regex literal inside scripts/verify-skills.ts:9,120 (self-referential;
  that pattern exists to SCAN skill files) — no real secret  ✅

# SCAN 3 — hardcoded bearer values
grep -rEn 'Bearer [A-Za-z0-9_./+-]{8,}' <same targets>
→ exit 1 (no matches; skill examples use `Bearer $AGENT_MEMORY_SECRET`)  ✅

# shell/exec/eval primitives in new code → exit 1 (no matches)  ✅
# raw Cypher string-building in db/queries.ts → exit 1 (no matches)  ✅
# console output of SECRET in new scripts → exit 1 (no matches)  ✅
# password/private-key terms in eval corpus + SCORECARD → exit 1 (no matches)  ✅
# git status --porcelain → clean (review-only; no edits outside this artifact)  ✅
```

Not run (by role boundary): no write-path suites (`verify`, `eval`, `verify-skills`), no
Helix dev restart, no touch of port 3111.

## Verdict Rationale

✅ **pass.** Every one of the six lens areas was checked against code, not claims: the new outbound
clients validate responses with zod and refuse to write before a read-only identity guard; the only
new write path (tier-1 merge) is project-scoped and parameterized, concat-only (no content loss),
and fail-closed on both bad config and silent no-op; `AGENT_MEMORY_MERGE_JACCARD` garbage values
provably collapse to OFF (`src/consolidate.ts:51`); the server's auth diff contains zero auth
hunks with the livez-only exemption intact; `AGENT_MEMORY_SECRET` is provably never echoed
(grep exit 1) and never enters the scorecard; three secret-pattern scans across every new surface
returned no real hits; and all nine skills instruct bearer-via-env plus a Ley 172-13 no-secrets
rule. The two Low findings (probe4 raw remote diagnostics, base-URL echo into stdout/scorecard) are
hygiene items on local dev tooling with operator-controlled preconditions — backlog, non-blocking —
and the one accepted residual (heuristic identity guard) is pre-existing, documented, and owned.
