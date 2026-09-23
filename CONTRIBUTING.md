# Contributing

Thanks for helping. This file is the contract for how changes land in this
repository.

## Prerequisites

- **Node 20+** (`node --version`) — required by `tsx` and the `helix query -e`
  TypeScript DSL path.
- **Docker or Podman** — the HelixDB dev instance runs in a container.
- **`helix` CLI** — if it is missing:

  ```bash
  curl -sSL "https://install.helix-db.com" | bash
  ```

## Development setup

Exactly the README Quick start:

```bash
helix start dev --disk --persist   # durable default: persists storage mode into helix.toml

npm install
npm run bootstrap               # create the 7 indexes, poll until ready
npm run dev                     # REST server on http://127.0.0.1:3111
```

Persistence is decided by the `storage = "disk"` key in `helix.toml`, not by
the flag: `--disk --persist` writes that key (this repo's `helix.toml` already
has it), so a plain `helix start dev` keeps data across restarts. A project
whose `helix.toml` lacks the key runs `storage: memory` and **restarts wipe
it**.

### When port 3111 is held by the real upstream `agentmemory`

Ports `3111/3112/3113` may belong to the real upstream `agentmemory` (verified
live on this machine). Start ours on `3151` and point every HTTP client at it:

```bash
AGENT_MEMORY_PORT=3151 npm run dev
AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify
```

The REST server prints this exact reroute hint on `EADDRINUSE`. The MCP server
needs no port change (stdio; it talks to HelixDB directly via `HELIX_URL`).

**Never kill or displace a running upstream `agentmemory` instance** — if our
port is taken, *we* reroute, never them. This coexistence rule is permanent.

## Verification bar (run before every PR)

```bash
npm run typecheck                                 # tsc --noEmit — zero errors
AGENT_MEMORY_URL=http://127.0.0.1:3151 npm run verify   # E2E against our server
npx tsx scripts/verify-injection.ts               # injection assertions
```

`npm run verify` targets the rerouted URL above so it exercises **our** server,
not the upstream instance that may hold `3111` (its identity guard aborts
read-only before any write against a non-agent-memory target).

Full `package.json` script inventory: `typecheck`, `verify` (102-assertion
E2E), `verify-env` (env boot, hook zero-output, `EADDRINUSE` reroute hint,
legacy-ignored), plus `bootstrap`, `dev`, `demo`
for setup/seeding — `verify-injection` has no npm alias and runs as
`npx tsx scripts/verify-injection.ts` (73 assertions). The per-PR bar is the
three commands above; also run `npm run verify-env` when your change touches
env reading or the port hint.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/) — match what
`git log` already shows:

```
feat(memory): add recap/handoff/lesson/delete REST routes
fix(verify): upstream identity guard and recap membership assertion
docs(readme): document P3.1 routes/tools
chore(skills): rename .skills/ to skills/ at repo root
```

- Types in use: `feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor` —
  `git log` already shows all of them (e.g. `ci(p0-002): …`).
- Scope = the affected area (`memory`, `mcp`, `verify`, `readme`, `contract`,
  …); roadmap-lane ids (`p0-004`, `p0-006`, …) are used when the change
  belongs to a whole lane.
- Imperative subject, lowercase, no trailing period. Append the requirement id
  in parentheses when the change closes one: `… (REQ-P0-3)`.
- One commit = one purpose. No mixing refactors with features.

## Pull request expectations

- **Small** and single-purpose; no drive-by refactors in a feature PR.
- **Verified**: the verification bar above is green, and the PR body records
  the evidence.
- **Evidence per REQ-ID**: when the PR closes a plan item, state the
  `REQ-ID → test/evidence → artifact` trace (see `TEST_MATRIX.md`).
- **No self-merge without review** — every change needs at least one reviewer.
- Touch only the files your change owns.

## Strict TypeScript rules

- No `any` — use `unknown` and narrow.
- No `@ts-ignore` (or `@ts-expect-error` used as a workaround).
- No `TODO` comments — do it now or file it as an issue.
- `npm run typecheck` must stay clean; these rules are enforced, not advisory.

## Security

Report vulnerabilities through [SECURITY.md](SECURITY.md) — **never** as a
public issue.
