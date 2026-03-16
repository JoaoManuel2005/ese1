$ErrorActionPreference = "Stop"

# Change to project root directory
Set-Location (Join-Path $PSScriptRoot "..")

$vault = "docgenvault"

function Get-Secret {
  param(
    [string]$Vault,
    [string]$Name
  )

  $value = az keyvault secret show --vault-name $Vault --name $Name --query value -o tsv
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to fetch secret '$Name' from Key Vault '$Vault'."
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Secret '$Name' in Key Vault '$Vault' is empty."
  }
  return $value
}

function Mask-Secret {
  param([string]$Value)
  if ([string]::IsNullOrEmpty($Value)) {
    return "EMPTY"
  }
  $prefixLength = [Math]::Min(4, $Value.Length)
  return $Value.Substring(0, $prefixLength) + "****"
}

# Fetch secrets from Key Vault
$openAiKey = Get-Secret -Vault $vault -Name "AI-API-KEY"
$azureEndpoint = Get-Secret -Vault $vault -Name "AZURE-OPENAI-ENDPOINT"
# Strip /openai/v1/ suffix if present (SDK adds its own path)
$azureEndpoint = $azureEndpoint -replace '/openai/v1/?$', ''
$nextAuthSecret = Get-Secret -Vault $vault -Name "NEXTAUTH-SECRET"
$azureClientID = Get-Secret -Vault $vault -Name "AZURE-AD-CLIENT-ID"
$azureClientSecret = Get-Secret -Vault $vault -Name "AZURE-AD-CLIENT-SECRET"
$azureTenantID = Get-Secret -Vault $vault -Name "AZURE-AD-TENANT-ID"

# Write runtime env file (NOT committed)
@"
OPENAI_API_KEY=$openAiKey
AZURE_OPENAI_API_KEY=$openAiKey
AZURE_OPENAI_ENDPOINT=$azureEndpoint
OPENAI_MODEL=gpt4.1
LLM_PROVIDER=cloud
FEATURE_SHAREPOINT_ENRICHMENT=false
NEXTAUTH_SECRET=$nextAuthSecret
AZURE_AD_CLIENT_ID=$azureClientID
AZURE_AD_CLIENT_SECRET=$azureClientSecret
AZURE_AD_TENANT_ID=$azureTenantID
"@ | Set-Content -NoNewline .env.generated

Write-Host "Wrote .env.generated with secrets:"
Write-Host ("OPENAI_API_KEY=" + (Mask-Secret $openAiKey))
Write-Host ("AZURE_OPENAI_API_KEY=" + (Mask-Secret $openAiKey))
Write-Host ("AZURE_OPENAI_ENDPOINT=" + (Mask-Secret $azureEndpoint))
Write-Host "OPENAI_MODEL=gpt4.1"
Write-Host "LLM_PROVIDER=cloud"
Write-Host "FEATURE_SHAREPOINT_ENRICHMENT=false"
Write-Host ("NEXTAUTH_SECRET=" + (Mask-Secret $nextAuthSecret))
Write-Host ("AZURE_AD_CLIENT_ID=" + (Mask-Secret $azureClientID))
Write-Host ("AZURE_AD_CLIENT_SECRET=" + (Mask-Secret $azureClientSecret))
Write-Host ("AZURE_AD_TENANT_ID=" + (Mask-Secret $azureTenantID))

# Auto-detect GPU support and conditionally enable GPU acceleration
$gpuCompose = ""
$gpuDetected = $false

# Check for NVIDIA GPU with Docker support
$nvidiaSmiExists = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvidiaSmiExists) {
  try {
    $null = nvidia-smi 2>&1
    if ($LASTEXITCODE -eq 0) {
      # Verify Docker can actually use NVIDIA GPU (requires NVIDIA Container Toolkit)
      try {
        $dockerGpuTest = docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi 2>&1
        if ($LASTEXITCODE -eq 0) {
          Write-Host "[OK] NVIDIA GPU detected and Docker has NVIDIA Container Toolkit - enabling CUDA acceleration"
          $gpuCompose = "-f docker-compose.gpu.yml"
          $gpuDetected = $true
        } else {
          Write-Host "[WARN] NVIDIA GPU detected but Docker cannot access it"
          Write-Host "  Install NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
          Write-Host "  Then restart Docker service"
          Write-Host "  Falling back to optimized CPU mode for now"
        }
      } catch {
        Write-Host "[WARN] NVIDIA GPU detected but Docker cannot access it: $_"
        Write-Host "  Install NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
        Write-Host "  Falling back to optimized CPU mode for now"
      }
    } else {
      Write-Host "[WARN] nvidia-smi found but GPU not accessible (NVIDIA driver issue?)"
    }
  } catch {
    Write-Host "[WARN] nvidia-smi check failed: $_"
  }
}

# Check for AMD GPU (Windows with DirectML only works natively, not in Docker)
if (-not $gpuDetected) {
  try {
    $amdGpu = Get-WmiObject -Class Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "AMD|Radeon" }
    if ($amdGpu) {
      Write-Host "[INFO] AMD GPU detected, but DirectML only works when running .NET natively (not in Docker)"
      Write-Host "  Falling back to optimized CPU mode in container"
    }
  } catch {
    # Silently continue if WMI check fails
  }
}

# Fallback message
if (-not $gpuDetected) {
  Write-Host "[INFO] Using optimized CPU mode"
}

# Run stack
if ($gpuCompose) {
  docker compose --env-file .env.generated -f docker-compose.dotnet.yml $gpuCompose up -d --build --force-recreate
} else {
  docker compose --env-file .env.generated -f docker-compose.dotnet.yml up -d --build --force-recreate
}
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up failed."
}

# Verify injected secrets in container without printing values
$requiredVars = @(
  "NEXTAUTH_SECRET",
  "AZURE_AD_CLIENT_ID",
  "AZURE_AD_CLIENT_SECRET",
  "AZURE_AD_TENANT_ID"
)

$envOutput = docker exec documentation-generator printenv
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read environment from container 'documentation-generator'."
}

$envMap = @{}
foreach ($line in ($envOutput -split "`r?`n")) {
  if ($line -match '^(?<name>[A-Z0-9_]+)=(?<value>.*)$') {
    $envMap[$matches['name']] = $matches['value']
  }
}

$emptyVars = @()
Write-Host "Verifying environment variables inside documentation-generator:"
foreach ($var in $requiredVars) {
  $value = $envMap[$var]
  if ([string]::IsNullOrEmpty($value)) {
    $emptyVars += $var
    Write-Host "$var=EMPTY"
  } else {
    Write-Host "$var=SET"
  }
}

if ($emptyVars.Count -gt 0) {
  throw "One or more required secrets are empty inside documentation-generator. This is usually caused by blank environment entries in docker-compose.dev.yml or another compose override file."
}
