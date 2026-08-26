# Setup Katalon Studio automation with Meow Coding

Guide for **new users** who want to use the native Meow agent to write and run
automated test scripts on Katalon Studio (Web UI, API, Mobile) via MCP.

## Minimum requirements

| Item | Requirement |
|---|---|
| Meow Coding | Installed, configured **LLM provider + API key** (Settings → Providers) |
| Katalon Studio | **≥ 11.1.0** (version with MCP server; Free license is sufficient) |
| Katalon Project | A real project (Test Cases, Object Repository, ...) |

## Setup steps

### 1. Install & open Katalon Studio

Install Katalon Studio ≥ 11.1.0, open the project you want to test. Keep the
Studio window open while using the Meow agent (or host MCP standalone via CLI
if you want to close the GUI).

### 2. Enable MCP server in Katalon Studio

1. **Preferences → Katalon → AI Configuration → Katalon Studio MCP**.
2. Ensure status is **Running** (default port `33699`, no auth, all tools enabled).
3. Click **Copy** to get the connection config JSON (in the form
   `{"url": "http://localhost:33699/..."}`) — this is the only accurate source,
   the endpoint path may differ between versions.

### 3. Add MCP server to Meow Coding

1. Meow Coding → **Settings → MCP tab**.
2. Add server:
   - Name: `katalon-studio`
   - URL: the value from the **Copy** button in step 2 (default `http://localhost:33699/mcp`)
3. (Recommended) Add the `katalon-docs` server with URL `https://mcp.katalon.com/mcp`
   so the agent can look up Katalon documentation when needed.
4. **Save**. Go back to Settings → MCP tab: `katalon-studio` should show **connected**
   and the list of tools should appear.

> No need to install the skill manually — `katalon-studio` is already a builtin skill
> of the app, the agent knows how to use it when you mention Katalon.

### 4. Test run

Ask the agent (native Meow agent):

- "List the available Katalon tools" — confirm MCP is connected.
- "Create a login test case for the Katalon project and run it" — check the
  create → run → analyze results flow.

## Important notes

- **MCP server is tied to a single Katalon project.** Switching projects → restart
  the server (reopen Studio or re-run the standalone CLI).
- Studio must be open (or standalone MCP host) for the agent to call tools; if a tool
  returns "Not connected", open Studio and check the MCP server status.
- Don't paste passwords/API tokens into chat; use Profiles + GlobalVariable in
  Katalon.

## References

- Katalon Docs: *Connect to Katalon Studio MCP Server* (Studio ≥ 11.1.0)
  — docs.katalon.com → Katalon Studio → StudioAssist → MCP Servers.
- Design spec: `docs/superpowers/specs/2026-08-21-katalon-mcp-skill-design.md`.