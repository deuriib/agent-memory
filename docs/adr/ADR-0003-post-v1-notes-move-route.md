# ADR-0003: Additive REST move route `POST /v1/notes/:id/move` (REQ-BRAINY-ENG-06 gap closure)

**Date:** 2026-09-25
**Deciders:** general(vasquez) — Engineering Owner (R1, author of verdict); concurring gates required: general(barrera) — Security Owner (R2), general(subero) — Legal Owner (R4, consumed as-is)
**Status:** accepted with conditions (see § Conditions; implementation blocked until R2 `review-security` Approves)
**Packet (reference-only):** `SPEC:docs/specs/20_backlog/SPEC-001-brainy-engineering.md#REQ-BRAINY-ENG-06 + AC-06 + §4.3 / HARD:subagents+zero-impl-edits+no-secrets+alias1version / GATE:proposal-addendum=a88f0a4 pending-architecture / DOMAINS:R1,R8,R2,R4,R5`
**Proposal under review:** commit `a88f0a4`, `docs/specs/40_workspace/engineering/PROPOSED_CHANGES.md` `## Addendum — REQ-BRAINY-ENG-06: REST move route` (§1–§7)

## Context

`REQ-BRAINY-ENG-06` (`docs/specs/20_backlog/SPEC-001-brainy-engineering.md:41`) requires CLI `brainy move <noteId> --to <project|area|resource|archive>` to rewrite the edge (drop old `BELONGS_TO` + add new); `AC-06` (`SPEC-001:76`) asserts it end-to-end. The store/query layers for the move already exist and were shipped in approved steps 2/4 (`db/queries.ts:147` `moveNoteParams`, `db/queries.ts:834` `export function moveNote(...)` drop+add; `src/store.ts:1887` `async moveNote(input: MoveNoteInput)`). The HTTP layer has no move route: `grep -n "move" src/server.ts` returns 0 matches; route inventory over `src/server.ts` returns only `POST /v1/notes` (`:382`), `POST /v1/notes/:id/distill` (`:402`), `GET /v1/notes/:id` (`:419`), `POST /v1/search` (`:436`), `POST /v1/memory` (`:452`), `GET /v1/context/:project` (`:475`), `POST /v1/link` (`:498`). The frozen REST tables confirm the gap: `SPEC-001 §4.3` lists 6 routes with no move row; `ARCHITECTURE.md §7` REST table (`ARCHITECTURE.md:139-144`) lists the same 6 routes with no move row, and its CLI table (`ARCHITECTURE.md:49`) maps `brainy move` only to "rewrite `BELONGS_TO` edge" with no HTTP binding. Lane R8 worked around the gap in `bin/brainy.mjs:1582-1606` (`cmdMove`: `GET /v1/notes/:id` + `POST /v1/link {fromId, toId, type: BELONGS_TO}`), with an inline comment (`bin/brainy.mjs:1594-1596`) admitting "the server has no dedicated move route" and that PARA-category targets surface as `400 invalid_tenant_link`.

Because this addendum adds exactly one row to the frozen REST surface (`SPEC-001 §4.3` + `ARCHITECTURE.md §7`), an ADR is mandatory under `review-architecture` governance (contract change → ADR). This ADR records the delta; it does NOT apply it — `ARCHITECTURE.md` and `SPEC-001` stay untouched in this stage (execute stage applies the rows on approval).

## Decision

Accept the additive route `POST /v1/notes/:id/move` with the normative contract shape from the addendum §3, subject to the Conditions below:

- **Method/route:** `POST /v1/notes/:id/move` (`:id` URL-decoded via existing `decodeSegment`), placed after the `GET /v1/notes/:id` block (`src/server.ts:419-435`), before `POST /v1/search` (`:436`).
- **Body (strict zod, unknown keys rejected):** `{ to: "project" | "area" | "resource" | "archive", name: string(trimmed, 1..500), project?: string }` as `moveNoteBodySchema` beside `linkNodesBodySchema` (`src/server.ts:236-243`); tenant precedence: body `project` ?? query `?project=` ?? `"default"`.
- **Auth:** existing dual bearer — `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`, constant-time compare, `401 unauthorized` + `WWW-Authenticate: Bearer` on mismatch; only `livez` exempt (`src/server.ts:364-380` pattern). No new auth scheme.
- **Tenant isolation (Security C8):** note and PARA target must belong to the same `project` tenant; mismatch → `400 invalid_tenant_link`, enforced server-side before any edge write (same code the CLI workaround already surfaces).
- **Semantics:** delegate to the already-approved `HelixStore.moveNote` (`src/store.ts:1887-1909`) → `moveNote` query (`db/queries.ts:834-874`): drop previous `BELONGS_TO`, anchor-or-create target, add new edge. No new HelixQL.
- **Responses:** `200 { id, para: { label, name } }` (`label` = `Project|Area|Resource|Archive`); `404 note_not_found`; `404 para_target_not_found`; `400 invalid_request` (zod) / `400 invalid_tenant_link` (cross-tenant); `401 unauthorized`; existing `{ error, details? }` envelope.

## Frozen contract delta (to be applied at execute time — quoted here, NOT applied here)

Exactly two one-row doc deltas, no other contract text changes, no REQ/AC prose edits:

1. `docs/specs/10_design/ARCHITECTURE.md` §7 Brainy v1 table — insert after the `GET /v1/notes/:id` row (`ARCHITECTURE.md:140`):

   `| POST | \`/v1/notes/:id/move\` | \`{to: project\|area\|resource\|archive, name: 1..500, project?}\` strict | 200 \`{id, para:{label,name}}\` | yes | drop+add \`BELONGS_TO\` via \`HelixStore.moveNote\`; 404 note/target; 400 tenant |`

2. `docs/specs/20_backlog/SPEC-001-brainy-engineering.md` §4.3 table — insert after the `GET /v1/notes/:id` row (`SPEC-001:128`):

   `| POST | \`/v1/notes/:id/move\` | \`{to, name 1..500, project?}\` strict | 200 \`{id,para}\` | drop+add \`BELONGS_TO\`; 404/400 |`

Owner of application: execute lane (R1) on `Approved-with-conditions` clearance. This ADR stage makes zero edits to `ARCHITECTURE.md` or `SPEC-001`.

## Consequences

### Positive

- **Closes the REQ-06/AC-06 HTTP gap:** CLI `brainy move` (R8) gains a first-class drop+add binding instead of the link-add-only workaround that accumulates `BELONGS_TO` edges and fails PARA-category tenant checks.
- **Truly additive:** one route + two one-row doc deltas; no schema change, no existing route behavior change, no MCP/bin change in this lane, no new index, no dimension change, no perf-harness impact (single scoped write).
- **Reuse, not reinvention:** handler reuses `projectSchema`, `decodeSegment`, `parseOr400`, `HttpError`, bearer guard, `sendJson`, and the approved `store.moveNote` → `moveNote` query chain; parametric invariants (CONTRACT §0: `defineParams`/`toQueryRequest`, no string concatenation) preserved.

### Negative / Trade-offs

- **Frozen surface grows by one row:** every future reader of §7/§4.3 must account for the move route; the 1-version alias posture now covers 7 canonical `/v1/*` routes instead of 6.
- **Strict-body breaking sharp edge:** the R8 workaround payload shape (`{fromId,toId,type}`) is rejected by design on the new route; R8 must repoint CLI `move` to `{to,name}` in its own lane (coordinated, not done here).
- **Target auto-create retained:** anchor-or-create (`db/queries.ts:857-867`) stays; empty/unknown target maps to `404`, never to silent garbage-node creation — relies on unchanged `MoveNoteInput` semantics.

## Alternatives considered

| Alternative | Reason rejected |
|-------------|-----------------|
| **Reuse `POST /v1/link` with `BELONGS_TO` for moves (status quo workaround)** | `linkNotes` (`db/queries.ts:925-938`) is add-only (`addE`, no drop); repeated moves accumulate edges and PARA-category targets fail tenant checks (`bin/brainy.mjs:1594-1603`). Verified: `store.linkNodes` (`src/store.ts:1962-1983`) never drops. Insufficient for AC-06 edge-rewrite semantics. |
| **Extend `POST /v1/link` with a `mode: move` flag** | Overloads an add-only contract with destructive semantics behind a flag; widens blast radius to all existing link callers and weakens the strict-enum C4 posture. A dedicated route keeps the destructive path explicit and auditable. |
| **New `PATCH /v1/notes/:id` generic update covering move** | Generic PATCH invites scope creep (content+para+tags in one body) and a larger zod surface; the minimal AC-06 fix is a single-purpose move route reusing the approved query. |
| **Do nothing (leave gap to R8 client-side: GET + delete-edge + link)** | No delete-edge primitive exists server-side; client-side multi-call moves are non-atomic and race-prone. The approved `moveNote` batch already provides atomic drop+add — it only lacks HTTP exposure. |

## Security / privacy implications

- **C4 caps (input boundaries):** `to` closed enum, `name` trimmed 1..500, `.strict()` rejects unknown keys (`replace`, empty `name`, unknown `to`, oversize `name` → `400 invalid_request` with zod details). Caps inherited from the existing `linkNodesBodySchema`/`distillNoteBodySchema` family (`src/server.ts:236-252`). No new bypass.
- **C8 tenant isolation:** same-tenant check on note + PARA target before any edge write; mismatch → `400 invalid_tenant_link` with no edge write. Mirrors the existing `/v1/link` C8 block (`src/server.ts:502-510`) and `store.linkNodes` tenant throw (`src/store.ts:1968-1972`).
- **Auth:** dual bearer `BRAINY_SECRET ?? AGENT_MEMORY_SECRET`, constant-time compare, `livez`-only exemption — reuse of the audited guard (`src/server.ts:364-380`). No secret in code/logs/examples; error envelope unchanged.
- **PII:** none-new. No new PII store (note content/tenant unchanged, Ley 172-13 purpose/TTL/deletion posture from ADR-0002 carries over); no new port, no new dependency, no new log/export surface; test placeholders only (`<note-id>`, `<area-name>`), no raw PII or secrets in evidence (paths, line numbers, grep counts only).
- **Residual:** a separate `review-security` pass by R2 remains REQUIRED (see Conditions C1) because the route touches auth + PII-adjacent graph writes; this architecture verdict does not substitute for the security verdict.

## Conditions with owners

- **C1 (owner: R2 `general(barrera)`; deadline: before `execute-spec` starts):** separate `frame-ship:review-security` pass on this route REQUIRED — auth reuse, C4 caps, C8 tenant enforcement, PII-adjacent graph write. Implementation lane blocked until R2 records `Approved` (or `Approved-with-conditions` with its own conditions discharged).
- **C2 (owner: R1 execute lane; deadline: at `execute-spec`):** apply exactly the two quoted one-row deltas (§ Frozen contract delta) and nothing else — no REQ/AC prose edits, no other §7/§4.3 text changes, no schema/dependency/port/MCP/bin/store/query changes.
- **C3 (owner: R8 `general(espinoza)`; deadline: own lane, coordinated):** repoint CLI `move` (`bin/brainy.mjs:1582-1606`) from the `GET` + `POST /v1/link` workaround to `POST /v1/notes/:id/move {to,name}`; remove/refresh the "no dedicated move route" comment on landing.
- **C4 (owner: R1 execute lane; deadline: `quality-gate`):** implement the test plan with REQ→test→artifact traceability (AC-06 edge rewrite + 404s, AC-12 route registration, C4 strict-body probes, C8 cross-tenant `400 invalid_tenant_link`, 401 without bearer) following the `tests/step6.test.ts:183-213,371-414` harness pattern; no HelixDB container required (fake store).

## Supersedes / Superseded By

- **Extends ADR-0002** (`docs/adr/ADR-0002-brainy-code-para-helixdb.md`): adds the 7th canonical `/v1/*` route to the Brainy v1 surface accepted there. No invariant broken or created (INV-012 atomic drop+add under lock already covers `moveNote`); no other ADR-0002 decision altered.
