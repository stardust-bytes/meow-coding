---
name: katalon-studio
description: Create, edit, run and debug Katalon Studio test scripts (Web UI, API, Mobile) through the local Katalon Studio MCP server. Use when the user asks to write automated tests in Katalon, analyze a requirement into test cases, run a test case or suite, read results/logs, or fix a failing Katalon test.
---

# Katalon Studio Automation (via MCP)

Work with the user's local Katalon Studio project through the `katalon-studio` MCP
server. The server exposes tools that read/write the open Katalon project, run tests,
and return results — operate the real project instead of guessing at files.

## Availability Boundary

State the boundary before promising writes:

- Available (through the MCP): list/inspect the open project's test cases, test
  suites, object repository, test data; create/update test case scripts; run test
  cases/suites; read execution results and logs.
- Not available: inspect the live AUT (application under test) UI beyond what the
  runner reports, manage Katalon licensing, or run the server itself.

## Prerequisites (check before working)

1. Katalon Studio is open with the target project loaded, and the MCP server status
   is **Running** (Preferences → Katalon → AI Configuration → Katalon Studio MCP,
   default port `33699`). If the server is not configured yet, point the user at the
   Katalon setup doc (docs/guides/katalon-setup.md in this repo).
2. The MCP server is bound to the user's project. **Each server instance is tied to
   a single project** — switching projects requires restarting the server (GUI mode
   or standalone CLI mode).
3. If a tool call returns "server not connected" / "Not connected", do NOT retry
   blindly: tell the user to open Katalon Studio and confirm the MCP server is
   Running, then try again.

## Using the MCP Tools

- First action: list the available Katalon MCP tools and their input schemas so the
  calls below use the real tool names (they can change between Katalon versions).
- Pass arguments exactly per the tool schema (project path, test case id/name,
  suite id/name, script content, report path...).
- Read tool output carefully: results come back as text (JSON or log lines). Errors
  are returned as tool errors — extract the failure reason before editing anything.

## Katalon Studio Concepts (ground truth)

- **Test Case**: a Groovy script using keywords. Stored under
  `Test Cases/<folder>/<name>`.
- **Test Suite**: an ordered collection of test cases; can run in parallel, with
  retries, and bind to a profile.
- **Object Repository**: reusable UI objects (`Test Objects/<folder>/<name>`), each
  with selector strategy (XPath, CSS, ID, name, ...) and a name. **Prefer object
  repository over hard-coded selectors in scripts.**
- **Test Data**: CSV/Excel files bound to a test case via `findTestData(...)`; used
  for data-driven tests (iterate rows).
- **Custom Keywords**: Groovy classes in `Keywords/` that wrap reusable logic.
- **Profiles**: global (`default` + custom) execution configurations (base URLs,
  credentials, device...), read with `GlobalVariable.*`.
- **Execution**: run a test case or suite; results land in `Reports/` and logs under
  `Logs/`. Console output shows step-by-step keyword execution.

## Guidance by Test Type

### Web UI
- Use `WebUI.openBrowser('')`, `WebUI.navigateToUrl(...)`, then interact:
  `WebUI.click`, `WebUI.setText`, `WebUI.verifyElementVisible`, `WebUI.verifyElementText`.
- Prefer spied/recorded objects from Object Repository; when a selector is needed,
  use robust XPath/CSS and `TestObject` + `WebUI.waitForElementPresent` /
  `waitForElementVisible` before interacting. Avoid fixed `Thread.sleep` — use waits.
- Handle dialogs (`WebUI.acceptAlert`), frames (`WebUI.switchToFrame`), new windows.

### API / Web Service
- Build `RequestObject` (RESTful via `WS.sendRequest`) with method, URL, headers,
  body (JSON/XML/form). Assert with `WS.verifyResponseStatusCode`,
  `WS.verifyElementPropertyValue` (JSON path), `WS.verifyBodyContaining`, etc.
- Use test data (CSV/Excel) for parameterized API tests; store base URLs in profiles.
- Handle auth headers (Bearer tokens) via GlobalVariables, never hard-code secrets.

### Mobile
- Use `Mobile.*` keywords (e.g. `Mobile.tap`, `Mobile.setText`, `Mobile.verifyElementExist`).
- Ensure a device/emulator is running and the device profile in Preferences matches;
  Appium capabilities come from the mobile execution configuration.

## Standard Workflow

1. **Clarify**: requirement, target project, test type (Web/API/Mobile), scope.
2. **Plan**: list test cases (happy path, negative cases, boundaries); check existing
   coverage in the project to avoid duplicates; reuse objects/data where possible.
3. **Create/Update**: create or modify test case scripts; use Object Repository and
   Test Data; follow project naming conventions (e.g. `TC_Login_01`).
4. **Run**: execute the test case or suite via MCP tools.
5. **Analyze**: read the result/log; identify the first failing step and its reason.
6. **Fix → Re-run** until green; then summarize results (passed/failed, coverage,
   remaining risks) in a short report.

## Best Practices

- One logical scenario per test case; clear names; group by folder.
- Data-driven: keep test data in CSV/Excel, not inline in scripts.
- Reuse: Object Repository objects, custom keywords for repeated flows (login, logout).
- Idempotent setup/teardown so tests can run repeatedly.
- Keep scripts readable: small helper methods, no copy-pasted blocks.
- Never commit credentials/tokens into scripts; use profiles + GlobalVariables.
- After any edit, run the affected case to verify before claiming success.

## Boundaries & Escalation

- If the MCP server is not Running, or the project is not the one the user means,
  stop and ask — do not guess a different project path.
- If a tool is missing (e.g. requirement management, report upload), say it is not
  available on the local Studio MCP and propose the file-level alternative (read/write
  project files directly) or True Platform if the user has it.
