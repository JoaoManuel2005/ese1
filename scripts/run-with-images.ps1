#Requires -Version 5.1
<#
.SYNOPSIS
  Run the app using pre-built Docker images (same behavior as run-with-images.sh).

.DESCRIPTION
  Run from repo root or from extracted CI artifact root. The script expects to find
  docker-compose.images.yml in that directory. Image tars (dotnet-backend.tar,
  documentation_generator.tar, pac_cli.tar) are loaded from the SAME directory when present.
  Secrets are fetched from Azure Key Vault "docgenvault".
#>

$ErrorActionPreference = 'Stop'

# ROOT = directory containing docker-compose.images.yml (parent of scripts/)
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ROOT

$COMPOSE_FILE = 'docker-compose.images.yml'
if (-not (Test-Path -LiteralPath $COMPOSE_FILE -PathType Leaf)) {
  Write-Error "$COMPOSE_FILE not found in $ROOT. Run this script from the repo or from the extracted CI artifact."
}

# Load image tars if present in ROOT (same directory as docker-compose.images.yml)
$tars = @('dotnet-backend.tar', 'documentation_generator.tar', 'pac_cli.tar')
$allTarsPresent = ($tars | ForEach-Object { Test-Path -LiteralPath $_ -PathType Leaf }) -notcontains $false
if ($allTarsPresent) {
  Write-Host "Loading Docker images from $ROOT ..."
  docker load -i dotnet-backend.tar
  docker load -i documentation_generator.tar
  docker load -i pac_cli.tar
  New-Item -ItemType Directory -Force -Path pac-workspace, documentation_generator/runtime-data | Out-Null
}

$VAULT = 'docgenvault'

function Get-Secret {
  param([string]$Name)
  try {
    $value = az keyvault secret show --vault-name $VAULT --name $Name --query value -o tsv 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Failed to fetch secret '$Name' from Key Vault '$VAULT'."
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
      Write-Error "Secret '$Name' in Key Vault '$VAULT' is empty."
    }
    return $value.Trim()
  } catch {
    Write-Error "Failed to fetch secret '$Name' from Key Vault '$VAULT'. $_"
  }
}

function Get-MaskedSecret {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return 'EMPTY' }
  if ($Value.Length -le 4) { return "$Value****" }
  return $Value.Substring(0, 4) + '****'
}

Write-Host "Fetching secrets from Azure Key Vault '$VAULT'..."
$openai_key       = Get-Secret 'AI-API-KEY'
$azure_endpoint   = Get-Secret 'AZURE-OPENAI-ENDPOINT'
$nextauth_secret  = Get-Secret 'NEXTAUTH-SECRET'
$azure_client_id  = Get-Secret 'AZURE-AD-CLIENT-ID'
$azure_client_secret = Get-Secret 'AZURE-AD-CLIENT-SECRET'
$azure_tenant_id  = Get-Secret 'AZURE-AD-TENANT-ID'

# Strip /openai/v1/ suffix if present (SDK adds its own path)
$azure_endpoint = $azure_endpoint.TrimEnd('/').Replace('/openai/v1/', '').Replace('/openai/v1', '')

$envContent = @"
OPENAI_API_KEY=$openai_key
AZURE_OPENAI_API_KEY=$openai_key
AZURE_OPENAI_ENDPOINT=$azure_endpoint
OPENAI_MODEL=gpt4.1
LLM_PROVIDER=cloud
FEATURE_SHAREPOINT_ENRICHMENT=false
NEXTAUTH_SECRET=$nextauth_secret
AZURE_AD_CLIENT_ID=$azure_client_id
AZURE_AD_CLIENT_SECRET=$azure_client_secret
AZURE_AD_TENANT_ID=$azure_tenant_id
"@
Set-Content -Path '.env.generated' -Value $envContent -NoNewline

Write-Host 'Wrote .env.generated with secrets:'
Write-Host "OPENAI_API_KEY=$(Get-MaskedSecret $openai_key)"
Write-Host "AZURE_OPENAI_API_KEY=$(Get-MaskedSecret $openai_key)"
Write-Host "AZURE_OPENAI_ENDPOINT=$(Get-MaskedSecret $azure_endpoint)"
Write-Host 'OPENAI_MODEL=gpt4.1'
Write-Host 'LLM_PROVIDER=cloud'
Write-Host 'FEATURE_SHAREPOINT_ENRICHMENT=false'
Write-Host "NEXTAUTH_SECRET=$(Get-MaskedSecret $nextauth_secret)"
Write-Host "AZURE_AD_CLIENT_ID=$(Get-MaskedSecret $azure_client_id)"
Write-Host "AZURE_AD_CLIENT_SECRET=$(Get-MaskedSecret $azure_client_secret)"
Write-Host "AZURE_AD_TENANT_ID=$(Get-MaskedSecret $azure_tenant_id)"

docker compose --env-file .env.generated -f $COMPOSE_FILE up -d --force-recreate
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }

$requiredVars = @('NEXTAUTH_SECRET', 'AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID')
$envOutput = docker exec documentation-generator printenv 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read environment from container 'documentation-generator'."
}

Write-Host 'Verifying environment variables inside documentation-generator:'
$emptyVars = [System.Collections.ArrayList]@()
foreach ($var in $requiredVars) {
  $line = ($envOutput -split "`n" | ForEach-Object {
    if ($_ -match "^${var}=(.*)$") { $Matches[1].Trim() }
  } | Select-Object -First 1)
  if ([string]::IsNullOrWhiteSpace($line)) {
    [void]$emptyVars.Add($var)
    Write-Host "${var}=EMPTY"
  } else {
    Write-Host "${var}=SET"
  }
}

if ($emptyVars.Count -gt 0) {
  Write-Error "One or more required secrets are empty inside documentation-generator. This is usually caused by blank environment entries in docker-compose.dev.yml or another compose override file."
}

Write-Host 'Done. App is running (backend: port 8001, docs UI: port 3000).'
