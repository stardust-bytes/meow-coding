# Windows Installer Code Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Windows Authenticode signing (via Azure Trusted Signing) into the build so `Meow.Coding.Setup.*.exe` and the portable `.exe` stop showing Windows SmartScreen's "Unknown publisher" warning — without breaking local/unsigned builds before Azure is configured.

**Architecture:** Move the electron-builder config out of `package.json`'s `build` field (which is JSON, so it cannot hold a signing *function*) into `electron-builder.ts`, matching how the reference project opencode does it (opencode's own file happens to be named `electron-builder.config.ts`, but that name is NOT what electron-builder actually auto-discovers — see Global Constraints; they likely invoke it with an explicit `--config` flag we don't have visibility into, or it doesn't matter for their build. Ours must use electron-builder's real auto-discovered name, `electron-builder.ts`, or the config is silently ignored). Add a `win.signtoolOptions.sign` hook that shells out to a new `scripts/sign-windows.ps1`, itself modeled on opencode's `script/sign-windows.ps1`: it self-guards to a clean no-op unless it's running in GitHub Actions with Azure Trusted Signing credentials present, so `npm run dist`/`dist:dir` locally and any CI run before Azure is set up keep producing unsigned builds exactly as today. CI (`.github/workflows/build.yml`) gets an `azure/login` step (OIDC, no long-lived secret) before packaging and a post-package signature verification step, both gated on the same secrets being present.

**Tech Stack:** electron-builder (programmatic TS config via its built-in `jiti` loader), PowerShell (`pwsh` in CI, with a `powershell.exe` fallback for local dev machines that don't have PowerShell 7 installed), Azure Trusted Signing (`TrustedSigning` PowerShell module / `azure/login` GitHub Action).

## Global Constraints

- Local builds (`npm run dist`, `dist:dir`, etc.) and CI builds without Azure secrets configured must keep succeeding and keep producing the same unsigned artifacts as today — no developer-visible regression while Azure Trusted Signing is not yet set up.
- electron-builder loads config from `package.json`'s `build` field **if it exists at all**, and only falls back to a standalone config file when that field is absent (verified by reading `app-builder-lib`'s `loadConfig` in `node_modules/app-builder-lib/out/util/config/load.js:73-81`) — so the `build` field must be fully removed from `package.json`, not just left empty, or the new config file will silently be ignored.
- **The standalone config file must be named exactly `electron-builder.ts`, not `electron-builder.config.ts`.** electron-builder's config loader resolves a fixed filename prefix (`configFilename: "electron-builder"`, `node_modules/app-builder-lib/out/util/config/config.js:37`) against a fixed extension list (`node_modules/app-builder-lib/out/util/config/load.js:52-61`: `.yml`, `.yaml`, `.json`, `.json5`, `.toml`, `.js`, `.cjs`, `.ts`) — there is no `.config.` infix and no cosmiconfig-style search. A file named `electron-builder.config.ts` is silently never discovered: electron-builder falls back to bare defaults (output dir `dist` instead of `release`, package-name-derived filename instead of `productName`, no custom `win`/`mac`/`linux`/`nsis`/signing config at all) and still exits 0, so this failure mode is silent, not a build error. This was caught empirically during Task 1's first implementation attempt — confirmed by renaming to `electron-builder.ts` and observing the `loaded configuration` log line appear with the correct `appOutDir=release` only after the rename.
- `signWindows`'s shell-out must try `pwsh` first and fall back to `powershell.exe` (Windows PowerShell 5.1, present on every Windows machine including local dev machines without PowerShell 7 installed) if `pwsh` isn't found — GitHub Actions' `windows-latest` runners ship `pwsh` preinstalled, but a contributor's local Windows machine may not have it, and `sign-windows.ps1` itself uses no PowerShell-7-only syntax (verified during planning: its guard clauses were run successfully under Windows PowerShell 5.1), so the fallback is safe.
- No paid/long-lived secret keys checked into the repo. CI Azure auth uses OIDC federated credentials (`azure/login`), matching the constraint opencode's own workflow follows.
- Signing a package does not, by itself, eliminate SmartScreen's warning instantly — reputation still accrues over downloads (this is a Microsoft platform behavior, not something fixable in this repo). Document this clearly so it isn't mistaken for an incomplete fix.

---

### Task 1: Move electron-builder config to a `.ts` file with a self-guarding Windows signing hook

**Files:**
- Create: `electron-builder.ts` (NOT `electron-builder.config.ts` — see Global Constraints; that name is silently never discovered by electron-builder)
- Create: `scripts/sign-windows.ps1`
- Modify: `package.json` (remove the top-level `"build"` field, lines 71–110 in the current file)

**Interfaces:**
- Produces: `electron-builder.ts` default-exports an `electron-builder` `Configuration` object equivalent to the current `package.json` `build` field, plus `win.signtoolOptions.sign`.
- `scripts/sign-windows.ps1` takes one positional argument (the file path to sign) and always exits 0 when it skips signing (missing `GITHUB_ACTIONS` or missing Azure env vars), so it never fails a build it isn't meant to touch.

- [ ] **Step 1: Record the current packaged config for the regression check**

Run: `npx electron-builder --dir --publish never 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(s.includes('package.json') ? 'CONFIG_SOURCE: package.json' : 'CONFIG_SOURCE: other'))"`

Expected: prints `CONFIG_SOURCE: package.json` (electron-builder logs `loaded configuration` naming `package.json ("build" field)` when it's the source — this confirms today's baseline before the move, so Step 6 below has something to diff against).

- [ ] **Step 2: Create `scripts/sign-windows.ps1`**

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string] $Path
)

$ErrorActionPreference = "Stop"

if ($env:GITHUB_ACTIONS -ne "true") {
  Write-Host "Skipping Windows signing: not running in GitHub Actions"
  exit 0
}

$vars = @{
  endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
  account  = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
  profile  = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
}

if ($vars.Values | Where-Object { -not $_ }) {
  Write-Host "Skipping Windows signing: Azure Trusted Signing is not configured"
  exit 0
}

$moduleVersion = "0.5.8"
$module = Get-Module -ListAvailable -Name TrustedSigning | Where-Object { $_.Version -eq [version] $moduleVersion }

if (-not $module) {
  Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  Install-Module -Name TrustedSigning -RequiredVersion $moduleVersion -Force -Repository PSGallery -Scope CurrentUser
}

Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force

$resolved = Resolve-Path $Path -ErrorAction Stop

Invoke-TrustedSigning `
  -Endpoint $vars.endpoint `
  -CodeSigningAccountName $vars.account `
  -CertificateProfileName $vars.profile `
  -Files $resolved.Path `
  -FileDigest SHA256 `
  -TimestampDigest SHA256 `
  -TimestampRfc3161 "http://timestamp.acs.microsoft.com" `
  -ExcludeEnvironmentCredential `
  -ExcludeWorkloadIdentityCredential `
  -ExcludeManagedIdentityCredential `
  -ExcludeSharedTokenCacheCredential `
  -ExcludeVisualStudioCredential `
  -ExcludeVisualStudioCodeCredential `
  -ExcludeAzurePowerShellCredential `
  -ExcludeAzureDeveloperCliCredential `
  -ExcludeInteractiveBrowserCredential
```

This mirrors `AZURE_*` env var names and the `TrustedSigning` module call opencode uses in its own `script/sign-windows.ps1`, adapted to a single-product project (no dev/beta/prod channel).

- [ ] **Step 3: Verify the script no-ops cleanly without CI env (first guard)**

Run (PowerShell):
```powershell
$env:GITHUB_ACTIONS = $null
powershell -File scripts/sign-windows.ps1 -Path "C:\fake\app.exe"
echo "EXIT CODE: $LASTEXITCODE"
```
Expected: prints `Skipping Windows signing: not running in GitHub Actions` and `EXIT CODE: 0`.

- [ ] **Step 4: Verify the script no-ops cleanly with CI env but no Azure vars (second guard)**

Run (PowerShell):
```powershell
$env:GITHUB_ACTIONS = "true"
Remove-Item Env:\AZURE_TRUSTED_SIGNING_ENDPOINT -ErrorAction SilentlyContinue
Remove-Item Env:\AZURE_TRUSTED_SIGNING_ACCOUNT_NAME -ErrorAction SilentlyContinue
Remove-Item Env:\AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE -ErrorAction SilentlyContinue
powershell -File scripts/sign-windows.ps1 -Path "C:\fake\app.exe"
echo "EXIT CODE: $LASTEXITCODE"
Remove-Item Env:\GITHUB_ACTIONS -ErrorAction SilentlyContinue
```
Expected: prints `Skipping Windows signing: Azure Trusted Signing is not configured` and `EXIT CODE: 0`.

- [ ] **Step 5: Create `electron-builder.ts`**

```ts
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Configuration } from 'electron-builder'

const execFileAsync = promisify(execFile)
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const signScript = path.join(rootDir, 'scripts', 'sign-windows.ps1')

async function runPowerShell(args: string[]): Promise<void> {
  try {
    await execFileAsync('pwsh', args, { cwd: rootDir })
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
    // pwsh (PowerShell 7) isn't installed — fall back to the Windows
    // PowerShell 5.1 that ships on every Windows machine. sign-windows.ps1
    // uses no PS7-only syntax, so this fallback is safe.
    await execFileAsync('powershell.exe', args, { cwd: rootDir })
  }
}

async function signWindows(configuration: { path: string }): Promise<void> {
  if (process.platform !== 'win32') return
  await runPowerShell(
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', signScript, configuration.path]
  )
}

const config: Configuration = {
  appId: 'com.meow.coding',
  productName: 'Meow Coding',
  icon: 'moew-coding-logo.png',
  directories: {
    output: 'release'
  },
  files: [
    'out/**/*',
    'package.json'
  ],
  extraResources: [
    { from: 'resources/skills', to: 'skills' },
    { from: 'out/browser-extension', to: 'browser-extension' }
  ],
  asar: true,
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    signtoolOptions: {
      sign: signWindows
    }
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    icon: 'build/icons',
    category: 'Development',
    maintainer: 'Meow Coding'
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    category: 'public.app-category.developer-tools',
    icon: 'moew-coding-logo.png'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  }
}

export default config
```

This is a field-for-field copy of the current `package.json` `build` object (confirmed via `node -e "console.log(JSON.stringify(require('./package.json').build, null, 2))"` during investigation), with only `win.signtoolOptions.sign` added — every other target/option is unchanged, so packaging output shouldn't otherwise differ.

- [ ] **Step 6: Remove the `build` field from `package.json`**

Delete the entire top-level `"build": { ... }` object (currently `package.json:71-110`, everything from `"build": {` through its matching closing `},` right before the top-level closing `}`). Leave `scripts`, `dependencies`, `devDependencies` untouched.

- [ ] **Step 7: Verify the new config file is actually picked up**

Run: `npx electron-builder --dir --publish never`

Expected: build succeeds (exit 0), and the log's `loaded configuration` line now names `electron-builder.ts` instead of `package.json ("build" field)` — confirming Step 1's baseline changed and the `build` field removal in Step 6 didn't leave the old config silently in charge (per the Global Constraints note on `loadConfig`'s precedence).

- [ ] **Step 8: Verify a local dir build still produces an unpacked app**

Run (PowerShell): `Test-Path "release/win-unpacked/Meow Coding.exe"`

Expected: `True`. Since `GITHUB_ACTIONS` is not set locally, `signWindows` invoked `sign-windows.ps1`, which no-op'd per Step 3's guard — confirming the sign hook doesn't block or break an ordinary local build.

- [ ] **Step 9: Commit**

```bash
git add electron-builder.ts scripts/sign-windows.ps1 package.json
git commit -m "build: move electron-builder config to .ts with a Windows signing hook"
```

---

### Task 2: Wire Azure Trusted Signing into CI, gated on secrets being present

**Files:**
- Modify: `.github/workflows/build.yml`
- Create: `docs/windows-code-signing.md`

**Interfaces:**
- Consumes: repo secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE` (documented, not created by this task — see Step 4).

- [ ] **Step 1: Write a YAML-validity check to run before and after editing (this is the only automatable test for a CI workflow file — GitHub Actions itself can't be executed locally)**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/build.yml', 'utf8')); console.log('YAML OK')"`
Expected: prints `YAML OK` (baseline, before edits).

- [ ] **Step 2: Edit `.github/workflows/build.yml`**

Replace the `build:` job with:

```yaml
  build:
    needs: test
    permissions:
      contents: read
      id-token: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            target: win
          - os: macos-latest
            target: mac
          - os: ubuntu-latest
            target: linux
    runs-on: ${{ matrix.os }}
    env:
      AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      AZURE_TRUSTED_SIGNING_ENDPOINT: ${{ secrets.AZURE_TRUSTED_SIGNING_ENDPOINT }}
      AZURE_TRUSTED_SIGNING_ACCOUNT_NAME: ${{ secrets.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME }}
      AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE: ${{ secrets.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx @electron/rebuild -f -w @lydell/node-pty
      - run: npm run build
      - name: Azure login for Windows code signing
        if: matrix.target == 'win' && env.AZURE_CLIENT_ID != ''
        uses: azure/login@v2
        with:
          client-id: ${{ env.AZURE_CLIENT_ID }}
          tenant-id: ${{ env.AZURE_TENANT_ID }}
          subscription-id: ${{ env.AZURE_SUBSCRIPTION_ID }}
      - name: Package
        run: npx electron-builder --${{ matrix.target }} --publish never
      - name: Verify Windows code signature
        if: matrix.target == 'win' && env.AZURE_CLIENT_ID != ''
        shell: pwsh
        run: |
          $files = Get-ChildItem -Path release -Filter *.exe
          if ($files.Count -eq 0) { throw "No .exe artifacts found to verify" }
          foreach ($file in $files) {
            $sig = Get-AuthenticodeSignature $file.FullName
            if ($sig.Status -ne "Valid") {
              throw "Invalid signature for $($file.FullName): $($sig.Status)"
            }
            Write-Host "Signature OK: $($file.Name)"
          }
      - uses: actions/upload-artifact@v4
        with:
          name: meow-${{ matrix.os }}
          path: |
            release/*.exe
            release/*.dmg
            release/*.zip
            release/*.AppImage
            release/*.deb
            release/*.blockmap
            release/*.yml
          if-no-files-found: error
```

Leave the `test:` and `publish:` jobs exactly as they are today.

Both new steps are gated on `env.AZURE_CLIENT_ID != ''`, so with no secrets configured this job behaves identically to today: no Azure login attempt, no signature check, just an unsigned `Package` step — matching the Global Constraints requirement that CI keeps working before Azure is set up. Once the secrets from Step 4 below exist, both steps activate automatically without any further workflow edit.

- [ ] **Step 3: Re-run the YAML-validity check**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/build.yml', 'utf8')); console.log('YAML OK')"`
Expected: prints `YAML OK`.

- [ ] **Step 4: Write `docs/windows-code-signing.md`**

```markdown
# Windows Code Signing

`Meow.Coding.Setup.*.exe` and the portable build are signed in CI using
[Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/overview),
the same approach the reference project ([opencode](https://github.com/anomalyco/opencode))
uses for its desktop app. Signing is what stops Windows SmartScreen from
showing "Unknown publisher" — see `electron-builder.ts` (the
`win.signtoolOptions.sign` hook) and `scripts/sign-windows.ps1` for the
implementation, and `.github/workflows/build.yml` for how CI invokes it.

## What signing does and doesn't fix

- Signing removes the "Unknown publisher" line from the SmartScreen prompt
  and lets users verify the file wasn't tampered with after it was built.
- It does **not** instantly stop SmartScreen from showing a warning at all.
  SmartScreen also tracks download *reputation*, which builds up over time
  as more people download and run a given file without reporting problems.
  A brand-new signed build can still show a (less alarming) warning for a
  short window after each release; this is a Microsoft platform behavior,
  not something a repo config can turn off. Only Extended Validation (EV)
  certificates — far more expensive, and requiring a physical hardware
  token — get instant reputation.
- Until the Azure resources below are created and their secrets added to
  this repo, CI keeps producing **unsigned** builds exactly as it does
  today; nothing breaks in the meantime.

## One-time setup (do this outside of code, in the Azure/GitHub UI)

1. **Azure subscription**: you need one (pay-as-you-go is fine — Trusted
   Signing costs about $10/month per signing identity).
2. **Create a Trusted Signing account and certificate profile**
   (Azure Portal → "Trusted Signing" → Create). Choose a "Public Trust"
   certificate profile type for a publicly distributed app like this one.
   This requires identity verification (individual or business) through
   Microsoft, which can take a few business days the first time.
3. **Create an Azure AD App Registration** for GitHub OIDC login (no
   client secret needed):
   - Azure Portal → "App registrations" → New registration.
   - Under "Certificates & secrets" → "Federated credentials", add one
     for GitHub Actions: entity type "Branch", org `stardust-bytes`,
     repo `meow-coding`, branch matching your release trigger (e.g. the
     branch tags are cut from).
   - Grant this app "Trusted Signing Certificate Profile Signer" role on
     the certificate profile from step 2.
4. **Add these repo secrets** (Settings → Secrets and variables →
   Actions) in `stardust-bytes/meow-coding`:
   - `AZURE_CLIENT_ID` — the App Registration's Application (client) ID.
   - `AZURE_TENANT_ID` — your Azure AD tenant ID.
   - `AZURE_SUBSCRIPTION_ID` — the subscription containing the Trusted
     Signing account.
   - `AZURE_TRUSTED_SIGNING_ENDPOINT` — the region endpoint shown on the
     Trusted Signing account overview page (e.g.
     `https://eus.codesigning.azure.net`).
   - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` — the Trusted Signing account
     name you chose in step 2.
   - `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE` — the certificate
     profile name you chose in step 2.

Once all six secrets exist, the next tagged build automatically signs and
verifies the Windows artifacts — no further workflow changes needed.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build.yml docs/windows-code-signing.md
git commit -m "ci: sign Windows builds with Azure Trusted Signing when configured"
```

---

## Manual verification (after both tasks, and after the user completes the one-time Azure setup in `docs/windows-code-signing.md`)

1. Push a `v*` tag to trigger `build.yml`.
2. In the Actions run, confirm the `windows-latest` leg's "Azure login for Windows code signing" and "Verify Windows code signature" steps both ran and succeeded (not skipped).
3. Download the released `Meow.Coding.Setup.*.exe`, right-click → Properties → Digital Signatures tab, and confirm a valid signature with a real publisher name is present (not "Unknown publisher").
4. Run the installer on a clean Windows machine/VM that has never downloaded this app before, and note whether SmartScreen still appears — if it does, that's expected reputation-building behavior (see `docs/windows-code-signing.md`), not a bug in this implementation.
