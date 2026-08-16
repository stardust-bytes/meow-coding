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

$missing = @($vars.GetEnumerator() | Where-Object { [string]::IsNullOrWhiteSpace($_.Value) } | ForEach-Object { $_.Key })

if ($missing.Count -gt 0) {
  Write-Host "Skipping Windows signing: Azure Trusted Signing is not configured (missing: $($missing -join ', '))"
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
