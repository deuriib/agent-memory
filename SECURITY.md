# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `v1.x` (current line) | ✅ yes |
| `< v1.0` | ❌ no |

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

This policy covers what this repository ships — every surface a report can
target:

- the **REST server** (`npm run dev`, default port `3111`),
- the **stdio MCP server** (`src/mcp.ts`),
- the **capture hooks** (`hooks/capture.mjs`),
- the **Antigravity plugin hooks** (`plugins/antigravity/scripts/capture.mjs`
  and `recall.mjs`): stdout carries only their fixed host contract (capture's
  decision JSON; recall's injection block), stderr is never written, and the
  secret is never printed — that contract is part of the covered surface,
- the **OpenCode plugin** (auto-recall, context injection, and the plugin
  hooks/options it reads from `opencode.json`).

Not covered here (report upstream instead): upstream third-party projects,
the HelixDB engine, and third-party dependencies — unless you can show
a concrete impact on this project. We welcome reports about those impacts.

## Secrets policy

- The bearer secret comes from the environment: **`BRAINY_SECRET`** (with
  deprecated fallback to `AGENT_MEMORY_SECRET`). The REST and MCP servers read the
  **environment only**. The one exception is the **OpenCode plugin**, which also
  accepts a `secret` plugin option; for the plugin the precedence is `secret`
  option (from `opencode.json`) → `BRAINY_SECRET` → `AGENT_MEMORY_SECRET`.
  **Prefer the environment variable**; if you use the `secret` option, treat
  `opencode.json` as a credential-bearing file and never commit a real secret in it.
- **Guard-open is a documented default, not an accident:** with
  `BRAINY_SECRET` unset the server runs
  **unauthenticated** — every route except `livez` answers without a bearer.
  That is the dev posture, matching the open-localhost default; the
  compensating control is the default bind address **`127.0.0.1`**. An open
  guard is acceptable only while the server stays loopback-bound.
- **`BRAINY_HOST` removes that control silently:** binding anywhere but
  loopback (e.g. `BRAINY_HOST=0.0.0.0`) while the secret is unset
  exposes an unauthenticated server on every interface, and the boot log still
  only shows `auth: open` — nothing warns that the loopback protection is
  gone. Never combine an open guard with a non-loopback host: set a non-empty
  `BRAINY_SECRET` first.
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
