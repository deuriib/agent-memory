# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `v0.2.x` (current line) | ✅ yes |
| `< v0.2` | ❌ no |

Only the current release line is supported. Older versions receive no security
fixes — upgrade first, then re-check whether the issue still reproduces.
Release history lives in [`CHANGELOG.md`](CHANGELOG.md).

## Reporting a vulnerability

Report **privately** through **GitHub Security Advisories** on this
repository: open the **Security** tab → **Report a vulnerability** (or
**Security advisories** → **New draft advisory**).

- **Do not open a public issue, discussion, or pull request** for a suspected
  vulnerability. Public disclosure before a fix ships puts every user at risk.
- Include: affected component and version, reproduction steps (or a proof of
  concept), the impact you see, and any fix you suggest.
- If you cannot reach the advisory channel, contact a maintainer privately via
  their GitHub profile and say plainly that it is a security report. Never
  include a live secret or credential in the message.

## Scope

This policy covers what this repository ships:

- the **REST server** (`npm run dev`, default port `3111`),
- the **stdio MCP server** (`src/mcp.ts`),
- the **capture hooks** (`hooks/capture.mjs`),
- the **OpenCode plugin** (auto-recall and context injection).

Not covered here (report upstream instead): the `rohitg00/agentmemory` project
itself, the HelixDB engine, and third-party dependencies — unless you can show
a concrete impact on this project. We welcome reports about those impacts.

## Secrets policy

- The bearer secret is supplied **only** through the `AGENT_MEMORY_SECRET`
  environment variable (the legacy `AGENTMEMORY_SECRET` name is accepted as a
  deprecated fallback — see the README *Configuration* section).
- **Never** commit a secret, place one in code, config, docs, examples, logs,
  events, or issue/PR text, or echo/print it.
- The guarantees are documented in the README
  [Authentication](README.md#authentication) section: the secret value is
  never logged, echoed, or included in error text; the access log records
  method, path, status, and duration only. The capture hooks hold a
  zero-output guarantee and never print the secret.
- If a secret is ever exposed, treat it as compromised: set a fresh value in
  the environment, restart the servers, and revoke the old one wherever it was
  used.

## Response expectations

- We read and acknowledge the report.
- We triage it, work on a fix, and coordinate timing with the reporter.
- **Disclosure happens after a fix is available** (coordinated disclosure) —
  not before.
- Credit goes to the reporter unless they prefer to stay anonymous.

We are honest about capacity: this is a self-hosted, single-maintainer-style
project, so we promise acknowledgment and a fix-before-disclosure path, not a
fixed deadline.
