#!/usr/bin/env bash
set -euo pipefail

# Change to project root directory
cd "$(dirname "$0")/.."

VAULT="docgenvault"

get_secret() {
  local name="$1"
  local value
  value=$(az keyvault secret show --vault-name "$VAULT" --name "$name" --query value -o tsv)
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "ERROR: Failed to fetch secret '$name' from Key Vault '$VAULT'." >&2
    exit 1
  fi
  if [[ -z "$value" ]]; then
    echo "ERROR: Secret '$name' in Key Vault '$VAULT' is empty." >&2
    exit 1
  fi
  echo "$value"
}

mask_secret() {
  local value="$1"
  if [[ -z "$value" ]]; then
    echo "EMPTY"
    return
  fi
  local prefix="${value:0:4}"
  echo "${prefix}****"
}

# Check for .env.local fallback file
if [[ -f ".env.local" ]]; then
  echo "Found .env.local - using local secrets instead of Azure Key Vault"
  source .env.local
  
  openai_key="${AZURE_OPENAI_API_KEY:-${OPENAI_API_KEY:-}}"
  azure_endpoint="${AZURE_OPENAI_ENDPOINT:-}"
  nextauth_secret="${NEXTAUTH_SECRET:-}"
  azure_client_id="${AZURE_AD_CLIENT_ID:-}"
  azure_client_secret="${AZURE_AD_CLIENT_SECRET:-}"
  azure_tenant_id="${AZURE_AD_TENANT_ID:-}"
  
  # Validate required secrets
  if [[ -z "$openai_key" ]] || [[ -z "$azure_endpoint" ]]; then
    echo "ERROR: .env.local is missing required secrets (AZURE_OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT)" >&2
    exit 1
  fi
else
  echo "No .env.local found - fetching secrets from Azure Key Vault"
  openai_key="$(get_secret "AI-API-KEY")"
  azure_endpoint="$(get_secret "AZURE-OPENAI-ENDPOINT")"
  nextauth_secret="$(get_secret "NEXTAUTH-SECRET")"
  azure_client_id="$(get_secret "AZURE-AD-CLIENT-ID")"
  azure_client_secret="$(get_secret "AZURE-AD-CLIENT-SECRET")"
  azure_tenant_id="$(get_secret "AZURE-AD-TENANT-ID")"
fi

# Strip /openai/v1/ suffix if present (SDK adds its own path)
azure_endpoint="${azure_endpoint%/openai/v1/}"
azure_endpoint="${azure_endpoint%/openai/v1}"

cat > .env.generated <<EOF
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
EOF

echo "Wrote .env.generated with secrets:"
echo "OPENAI_API_KEY=$(mask_secret "$openai_key")"
echo "AZURE_OPENAI_API_KEY=$(mask_secret "$openai_key")"
echo "AZURE_OPENAI_ENDPOINT=$(mask_secret "$azure_endpoint")"
echo "OPENAI_MODEL=gpt4.1"
echo "LLM_PROVIDER=cloud"
echo "FEATURE_SHAREPOINT_ENRICHMENT=false"
echo "NEXTAUTH_SECRET=$(mask_secret "$nextauth_secret")"
echo "AZURE_AD_CLIENT_ID=$(mask_secret "$azure_client_id")"
echo "AZURE_AD_CLIENT_SECRET=$(mask_secret "$azure_client_secret")"
echo "AZURE_AD_TENANT_ID=$(mask_secret "$azure_tenant_id")"

# Auto-detect GPU support and conditionally enable GPU acceleration
GPU_COMPOSE=""
GPU_DETECTED=false

# Check for NVIDIA GPU with Docker support
if command -v nvidia-smi &> /dev/null; then
  if nvidia-smi &> /dev/null 2>&1; then
    # Verify Docker can actually use NVIDIA GPU (requires NVIDIA Container Toolkit)
    if docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi &> /dev/null 2>&1; then
      echo "✓ NVIDIA GPU detected and Docker has NVIDIA Container Toolkit - enabling CUDA acceleration"
      GPU_COMPOSE="-f docker-compose.gpu.yml"
      GPU_DETECTED=true
    else
      echo "⚠ NVIDIA GPU detected but Docker cannot access it"
      echo "  Install NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
      echo "  Then restart Docker: sudo systemctl restart docker"
      echo "  Falling back to optimized CPU mode for now"
    fi
  else
    echo "⚠ nvidia-smi found but GPU not accessible (driver issue?)"
  fi
fi

# Check for AMD GPU with ROCm (Linux only)
if [ "$GPU_DETECTED" = false ] && command -v rocm-smi &> /dev/null; then
  if rocm-smi &> /dev/null 2>&1; then
    echo "ℹ AMD GPU detected, but ROCm in Docker requires additional setup"
    echo "  See: https://rocmdocs.amd.com/en/latest/deploy/docker.html"
    echo "  Falling back to optimized CPU mode for now"
  fi
fi

# Fallback to CPU
if [ "$GPU_DETECTED" = false ]; then
  echo "ℹ Using optimized CPU mode"
fi

docker compose --env-file .env.generated -f docker-compose.dotnet.yml $GPU_COMPOSE up -d --build --force-recreate

required_vars=(
  "NEXTAUTH_SECRET"
  "AZURE_AD_CLIENT_ID"
  "AZURE_AD_CLIENT_SECRET"
  "AZURE_AD_TENANT_ID"
)

env_output="$(docker exec documentation-generator printenv)" || {
  echo "ERROR: Failed to read environment from container 'documentation-generator'." >&2
  exit 1
}

echo "Verifying environment variables inside documentation-generator:"
empty_vars=()
for var in "${required_vars[@]}"; do
  value="$(printf "%s\n" "$env_output" | sed -n "s/^${var}=//p" | head -n 1)"
  if [[ -z "${value:-}" ]]; then
    empty_vars+=("$var")
    echo "${var}=EMPTY"
  else
    echo "${var}=SET"
  fi
done

if [[ ${#empty_vars[@]} -gt 0 ]]; then
  echo "ERROR: One or more required secrets are empty inside documentation-generator. This is usually caused by blank environment entries in docker-compose.dev.yml or another compose override file." >&2
  exit 1
fi
