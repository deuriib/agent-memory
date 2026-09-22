# Antigravity plugin — agent-memory

Native Google Antigravity packaging for this repo's memory backend. The plugin
root is the **repository root**:

```
./plugin.json            # manifest (required)
./mcp_config.json        # MCP server -> src/mcp.ts (7 tools)
./hooks.json             # PostToolUse + Stop capture, PreInvocation recall
./.skills/memory/SKILL.md
./agents/recall.md           # recall subagent template
./rules/persistence.md       # behavioral rule
./plugins/antigravity/
├── scripts/capture.mjs      # capture hook (Antigravity stdin contract)
├── scripts/recall.mjs       # PreInvocation auto-recall -> injectSteps
└── README.md                # this file
```

## Install

**Workspace level** — copy the four root surfaces into `.agents/plugins/agent-memory/`:

```bash
mkdir -p .agents/plugins/agent-memory/plugins/antigravity
cp plugin.json mcp_config.json hooks.json .agents/plugins/agent-memory/
cp -r .skills .agents/plugins/agent-memory/
cp -r agents .agents/plugins/agent-memory/
cp -r rules .agents/plugins/agent-memory/
cp -r plugins/antigravity/* .agents/plugins/agent-memory/plugins/antigravity/
```

**Global level** — same layout under `~/.gemini/config/plugins/agent-memory/`.

## Configure

1. `mcp_config.json` → `cwd` must point at **this repo** (absolute path) so
   `npx tsx src/mcp.ts` resolves. Adjust it for your machine.
2. Optional environment, honored by every surface:

   | Variable | Default | Purpose |
   |---|---|---|
   | `HELIX_URL` | `http://localhost:6969` | HelixDB instance (MCP server) |
   | `AGENT_MEMORY_URL` | `http://127.0.0.1:3111` | REST service (hooks) |
   | `AGENT_MEMORY_SECRET` | *(unset = open)* | Bearer secret — set it in your shell, never in these files |
   | `AGENT_MEMORY_PROJECT` | workspace dir name | Tenant/scope key |
   | `AGENT_MEMORY_INJECT` | `true` | `false` disables PreInvocation recall |

3. Hooks run `node plugins/antigravity/scripts/...` relative to the workspace
   root. When installing globally, rewrite those commands as absolute paths.

## Behavior

- **PostToolUse** stores only `tool used: <toolName>` (`origin=hook:PostToolUse`).
  Tool args and outputs are deliberately never captured.
- **Stop** stores `agent session stopped` and prints
  `{"decision":"stop"}` so the execution loop ends normally.
- **PreInvocation** reads the last user message from `transcriptPath`, runs
  hybrid search (1.5s cap), and injects one `ephemeralMessage` — or `{}` on
  empty results, failure, or a query already injected within the TTL
  (`AGENT_MEMORY_INJECT_TTL_MS`, default 45000).

All hooks always exit 0: a dead or slow memory service never blocks the agent.

## Known deviation from plugin discovery

Antigravity docs describe `plugins/<name>/` with the manifest inside. This
repo places `plugin.json`, `mcp_config.json`, `hooks.json`, and `.skills/` at
the root per project convention — the install step above re-creates the
documented layout under `.agents/plugins/<name>/`. If skills are not
discovered, mirror `.skills/` to `skills/` inside the installed plugin folder.
