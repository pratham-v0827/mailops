<#
.SYNOPSIS
  Sets the MailOps dashboard's environment variables on the linked Vercel project.

.DESCRIPTION
  Run this yourself: it handles your Firebase service-account key, which should never be
  pasted into chat or committed. It reads the four public NEXT_PUBLIC_FIREBASE_* values from
  apps/web/.env.local, the service-account JSON from the file you point at, and writes
  everything to Vercel (production and preview). The key is stored as a sensitive variable.

.EXAMPLE
  .\scripts\set-vercel-env.ps1 -ServiceAccountJson "$HOME\Downloads\mailops-key.json" -AllowedEmails "you@gmail.com"
#>
param(
  [Parameter(Mandatory = $true)][string]$ServiceAccountJson,
  [Parameter(Mandatory = $true)][string]$AllowedEmails,
  [string]$VercelVersion = '65.2.0'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'apps\web\.env.local'

if (-not (Test-Path $envFile)) { throw "Missing $envFile (run firebase apps:sdkconfig first; see docs/self-hosting.md)." }
if (-not (Test-Path $ServiceAccountJson)) { throw "Service-account file not found: $ServiceAccountJson" }

$public = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^(NEXT_PUBLIC_FIREBASE_[A-Z_]+)=(.+)$') { $public[$Matches[1]] = $Matches[2].Trim() }
}
foreach ($name in 'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID') {
  if (-not $public.ContainsKey($name)) { throw "$name is missing from $envFile" }
}

# Validate and compact the key to one line.
$account = Get-Content -Raw $ServiceAccountJson | ConvertFrom-Json
if (-not $account.private_key -or -not $account.client_email) { throw 'That file does not look like a service-account key.' }
if ($account.project_id -ne $public['NEXT_PUBLIC_FIREBASE_PROJECT_ID']) {
  throw "Key is for project '$($account.project_id)' but the web config is for '$($public['NEXT_PUBLIC_FIREBASE_PROJECT_ID'])'."
}
$keyOneLine = $account | ConvertTo-Json -Compress -Depth 5

function Set-VercelEnv([string]$Name, [string]$Value, [switch]$Sensitive) {
  $common = @('--yes', "vercel@$VercelVersion", 'env', 'add', $Name, '--environment', 'production,preview', '--force')
  if ($Sensitive) {
    # Secrets go through stdin so they never appear on a command line or in the process list.
    $Value | npx @common --sensitive | Out-Null
  } else {
    npx @common --no-sensitive --value $Value | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "vercel env add $Name failed" }
  Write-Host "  set $Name"
}

Push-Location $root
try {
  Write-Host 'Setting Vercel environment variables (production, preview)...'
  foreach ($name in $public.Keys) { Set-VercelEnv $name $public[$name] }
  Set-VercelEnv 'ALLOWED_EMAILS' $AllowedEmails
  Set-VercelEnv 'FIREBASE_SERVICE_ACCOUNT_JSON' $keyOneLine -Sensitive
  Write-Host 'Done. Tell Claude, or run: npx vercel deploy --prod'
} finally {
  Pop-Location
}
