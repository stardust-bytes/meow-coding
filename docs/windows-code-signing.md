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
