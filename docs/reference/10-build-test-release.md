# 10 — Build, Test & Release

## 10.1 Toolchain

| Piece | Version / tool |
|---|---|
| Runtime | Node.js 20+ (CI uses 20) |
| App shell | Electron 41 |
| Bundler | electron-vite 5 (Vite 7) |
| UI | React 19, TypeScript 7 (strict) |
| Extension bundler | esbuild 0.25 |
| Unit/integration tests | Vitest 4 |
| E2E | Playwright 1.62 (`_electron.launch`) |
| Packager | electron-builder 26 |
| Sidecar | Go (`sidecars/meow-cliproxy`) |

## 10.2 npm scripts

| Script | What it does |
|---|---|
| `dev` | `electron-vite dev` — `predev` builds the Chrome extension first |
| `build` | `electron-vite build` — `prebuild` builds the extension first |
| `start` | `electron-vite preview` (run the built app) |
| `test` | `vitest run --passWithNoTests` — unit + integration |
| `test:watch` | `vitest` |
| `typecheck` | `tsc --noEmit` for node + web + extension, then `typecheck:server` |
| `typecheck:server` | `tsc --noEmit -p server/tsconfig.json` |
| `e2e` | `playwright test` — **requires `npm run build` first** |
| `build:extension` | esbuild → `out/browser-extension` |
| `build:cliproxy` | Go build → `out/cliproxy/<os>-<arch>/meow-cliproxy[.exe]` |
| `regen:models` | Regenerate `src/main/models-snapshot.json` from models.dev |
| `dist` / `dist:dir` | Package Windows (NSIS + portable) / unpacked dir |
| `dist:linux` / `dist:linux:dir` | Package Linux (AppImage + deb) |
| `dist:mac` / `dist:mac:dir` | Package macOS (dmg + zip) — must run on macOS |

The `pre*` hooks matter: `predist*` runs both `build:extension` **and** `build:cliproxy`, so
packaging never ships a stale extension or a missing sidecar.

## 10.3 Build configuration

### `electron.vite.config.ts`

| Target | Config |
|---|---|
| `main` | `externalizeDepsPlugin()`, alias `@shared` |
| `preload` | `externalizeDepsPlugin()` |
| `renderer` | `@vitejs/plugin-react`, alias `@shared`, dev server on port **1305** (`strictPort: true`), plus a `dev-csp-relax` plugin that adds `'unsafe-inline'` to `script-src` **only when a dev server is present** |

Output goes to `out/{main,preload,renderer}`; `package.json` `main` points at `./out/main/index.js`.

### TypeScript projects

`tsconfig.json` is a solution file referencing three composite projects. All are `strict: true`,
`ES2022`, `moduleResolution: Bundler`, `noEmit: true`.

| Project | Includes | `types` |
|---|---|---|
| `tsconfig.node.json` | `src/main`, `src/preload`, `src/shared`, `electron.vite.config.ts`, `electron-builder.ts` | `node` |
| `tsconfig.web.json` | `src/renderer/src`, `src/shared` | (default) + `jsx: react-jsx` |
| `tsconfig.extension.json` | `src/browser-extension`, `src/shared/browser-types.ts` | `chrome`, lib `ES2022` + `DOM` |
| `server/tsconfig.json` | The relay | — |

`@shared/*` → `./src/shared/*` is configured in the node and web projects, in
`electron.vite.config.ts`, and in `vitest.config.ts`.

### `electron-builder.ts`

| Setting | Value |
|---|---|
| `appId` | `com.meow.coding` |
| `productName` | `Meow Coding` |
| `publish` | GitHub — `stardust-bytes/meow-coding` |
| `directories.output` | `release/` |
| `files` | `out/**/*`, `package.json` |
| `asar` | `true` |

`extraResources`:

| From | To (inside `resourcesPath`) |
|---|---|
| `resources/skills` | `skills` |
| `out/browser-extension` | `browser-extension` |
| `resources/tray-icon.png` | `tray-icon.png` |
| `out/cliproxy/<CLIPROXY_PLATFORM>-<CLIPROXY_ARCH>/meow-cliproxy*` | `cliproxy` |
| `resources/third-party/CLIProxyAPI-LICENSE` | `third-party/CLIProxyAPI-LICENSE` |

Targets:

| Platform | Targets | Artifact names |
|---|---|---|
| Windows | `nsis` (x64), `portable` (x64) | `Meow.Coding.Setup.${version}.exe`, `Meow.Coding.${version}.exe` |
| Linux | `AppImage` (x64), `deb` (x64) | category Development, icons from `build/icons` |
| macOS | `dmg`, `zip` (x64 + arm64) | category `public.app-category.developer-tools` |

NSIS is not one-click: the user may change the install directory, and desktop + Start Menu shortcuts
are created.

Note that packaged builds resolve bundled assets from `process.resourcesPath` while dev builds
resolve them from `app.getAppPath()` — see `builtinSkillsDir`, the cliproxy `binaryPath`, and
`extSource` in `src/main/index.ts`.

## 10.4 Testing

### Layout

```
tests/
  unit/          Vitest, node environment, one file per module (~100 files)
  integration/   real PTY spawn, agent stream overlap, browser bridge flow, relay flow
  e2e/           Playwright against the built Electron app
  fixtures/      echo-agent.js (fake CLI), mock-lsp-server.js
```

`vitest.config.ts`: `include: ['tests/**/*.test.ts']`, `environment: 'node'`,
`testTimeout: 15000`, alias `@shared`.

`playwright.config.ts`: `testDir: 'tests/e2e'`, `timeout: 60000`, `workers: 1`, `retries: 0`.

### Rules

- **Never call a real LLM API.** Agent tests use a stub `LlmClient` (`makeManager` in
  `meow-agent-manager.test.ts`) or a scripted `partsQueue`.
- **Never depend on a real CLI agent** (opencode/claude/aider). Use `tests/fixtures/echo-agent.js`
  or a plain `node` command.
- **Integration tests spawn real PTYs** — always stop and clean up in `afterEach`/`finally` so no
  orphan processes are left behind (`tests/integration/pty-manager.test.ts` is the model).
- **Keep tests hermetic**: temp dirs via `mkdtempSync(tmpdir())`, cleaned up afterwards.
- **Prefer observable behavior** (events emitted, store contents) over internals.
- **`tests/unit/ipc-contract.test.ts` guards the IPC contract.** Every `AgentApi` method must exist
  and every channel string is asserted. Update it whenever the contract changes.

### E2E specifics

Each e2e test launches the real app with `_electron.launch({ args: ['.'] })` and an isolated temp
`MEOW_USER_DATA` plus a temp project, writing `workspaces.json` directly. Use locator auto-wait
(`toHaveText` / `toContainText`) for anything asynchronous (IPC round-trips, streaming).

| Spec | Covers |
|---|---|
| `smoke.spec.ts` | App launch, sidebar/status bar (incl. version), native chat sends a message, settings connects a provider + syncs models |
| `prompt.spec.ts` | Permission prompt: click allow, keyboard `1`, prompt spans the pane width |
| `context-footer.spec.ts` | Real token usage, persistence across reload, reset on new session, danger state past the auto-compact threshold |
| `chat-scrollbar.spec.ts` | Scrollbar reflects the full transcript (no content-visibility collapse) |
| `trace-panel.spec.ts` | Trace panel shows agent trace events |

`MEOW_E2E_MOCK_CONNECTIONS=1` swaps the connections backend for `E2EConnectionFixtures` so OAuth is
never exercised in tests.

### Required before claiming completion

```bash
npm run typecheck        # must pass
npm test                 # must pass
npm run build && npm run e2e   # only when the change touches e2e-covered surface
```

## 10.5 Development setup

```bash
npm install
npx @electron/rebuild -f -w @lydell/node-pty   # Windows: rebuild the native binding if missing
npm run dev
```

Notes:

- node-pty ships prebuilds; **do not modify node-pty source**. If the binding is missing after
  install, rebuild it with the command above.
- The dev server runs on a strict port (1305). A stale Electron window from a previous run can hold
  it — close old windows if `npm run dev` fails to bind.
- If `window.api` is missing at runtime, preload did not load; the renderer shows a fallback saying
  exactly that.

## 10.6 CI (`.github/workflows/build.yml`)

Trigger: **`push` on tags matching `v*`**.

```
test (ubuntu-latest)
  npm ci
  npx @electron/rebuild -f -w @lydell/node-pty
  npm run typecheck
  npm test
    │
    ▼
build (matrix: windows-latest→win, macos-latest→mac, ubuntu-latest→linux)
  npm ci
  npx @electron/rebuild -f -w @lydell/node-pty
  npm run build
  [win only] azure/login for Trusted Signing
  npx electron-builder --<target> --publish never
  [win only] verify every release/*.exe has a Valid Authenticode signature (fails the job otherwise)
  upload-artifact: *.exe *.dmg *.zip *.AppImage *.deb *.blockmap *.yml  (if-no-files-found: error)
    │
    ▼
publish (ubuntu-latest, on tags)
  download all artifacts (merge-multiple)
  read docs/changelogs/changelog-<version>.md (strips the leading "v" from the
    tag to locate the file; falls back to a generic body when the file is missing)
  softprops/action-gh-release@v2 → GitHub Release (body = the changelog)
```

`fail-fast: false` on the matrix, so one platform failing still produces the others.

## 10.7 Windows code signing

`electron-builder.ts` hooks `win.signtoolOptions.sign` to `signWindows`, which runs
`scripts/sign-windows.ps1` via `pwsh`, falling back to `powershell.exe` (Windows PowerShell 5.1) when
PowerShell 7 is not installed — the script uses no PS7-only syntax.

The script **exits successfully without signing** when:

- `GITHUB_ACTIONS !== 'true'` (local builds are never signed), or
- any of `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`,
  `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE` is missing.

Otherwise it installs/imports the `TrustedSigning` PowerShell module (pinned `0.5.8`) and runs
`Invoke-TrustedSigning` against Azure Trusted Signing. Required repository secrets:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, plus the three
`AZURE_TRUSTED_SIGNING_*` values. Full setup guide: `docs/guides/windows-code-signing.md`.

## 10.8 Auto-update

`src/main/updater.ts` wraps `electron-updater` against the GitHub `publish` target.

- `autoDownload = false`, `autoInstallOnAppQuit = false` — the user decides.
- **Unsupported** (reported as `not-supported`, only surfaced on a manual check) when the app is not
  packaged, is a Windows **portable** build (`PORTABLE_EXECUTABLE_FILE`), or is a Linux **AppImage**
  (`APPIMAGE`).
- Status is pushed as `UpdaterStatusEvent`: `checking`, `update-available`, `up-to-date`,
  `download-progress`, `downloaded`, `error`, `not-supported`.
- The startup check runs 1.5s after ready and only for packaged builds. When a download completes,
  main shows a native notification — clicking it installs and restarts.

## 10.9 Release checklist

### Versioning (SemVer)

Versions follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`). While the project
is still pre-1.0 (`0.x`), the `MINOR` position is treated as the breaking/new-feature slot:

| Change | Bump | Example |
|---|---|---|
| Bug fix only (no behavior change) | `PATCH +1` | `0.28.0 → 0.28.1` |
| New feature (no breaking change) | `MINOR +1`, reset `PATCH` | `0.28.1 → 0.29.0` |
| Breaking change / pre-1.0 behavior with no backwards-compat | `MINOR +1` (or `MAJOR +1` at 1.0) | `0.29.0 → 0.30.0` |

Rules that apply to every release:

- **`package.json` version = git tag = changelog filename.** Bump `version` in `package.json` first,
  tag `v<version>`, and write `docs/changelogs/changelog-<version>.md` for the same range.
- **One version = one coherent change set.** Don't mix an unrelated feature with bug fixes in a
  single bump; keep the changelog groupable (see `changelog-format.md`).
- **Bump the version when releasing, not after.** The tag must land on the commit whose
  `package.json` already carries the new version.
- **Pre-1.0 caveat:** a `0.x.y → 0.x+1.0` is a "breaking" bump in spirit (e.g. config/API/behavior
  with no backwards-compat). This is fine while pre-1.0; the project only commits to `1.x`
  backwards-compatibility once it reaches `1.0.0`.

### Checklist

1. Land the work; `npm run typecheck` and `npm test` green.
2. Update the relevant `AGENTS.md` files (see [11](11-conventions-and-pitfalls.md#113-documentation-sync-rule)).
3. Write `docs/changelogs/changelog-<version>.md` following `docs/changelogs/changelog-format.md`.
4. Bump `version` in `package.json`.
5. Commit, tag `v<version>`, push the tag → CI builds, signs, and publishes the GitHub Release.
6. Installers appear on the [Releases](https://github.com/stardust-bytes/meow-coding/releases) page
   and reach existing users through the auto-updater.
