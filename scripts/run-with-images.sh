#!/usr/bin/env bash
set -euo pipefail

# Run from repo root or from extracted CI artifact root. The script expects to find
# docker-compose.images.yml in that directory. Image tars (dotnet-backend.tar,
# documentation_generator.tar, pac_cli.tar, qdrant.tar) are loaded from the SAME directory
# when the full release image set is present.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.images.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: $COMPOSE_FILE not found in $ROOT. Run this script from the repo or from the extracted CI artifact." >&2
  exit 1
fi

# Load image tars if present in ROOT (same directory as this script's parent and docker-compose.images.yml)
tars=(
  "dotnet-backend.tar"
  "documentation_generator.tar"
  "pac_cli.tar"
  "qdrant.tar"
)

present_tars=()
missing_tars=()
for tar in "${tars[@]}"; do
  if [[ -f "$tar" ]]; then
    present_tars+=("$tar")
  else
    missing_tars+=("$tar")
  fi
done

if [[ ${#present_tars[@]} -gt 0 && ${#missing_tars[@]} -gt 0 ]]; then
  echo "ERROR: Incomplete Docker image set in $ROOT." >&2
  echo "Missing image archives: ${missing_tars[*]}" >&2
  echo "Expected release artifacts to include: ${tars[*]}" >&2
  exit 1
fi

if [[ ${#missing_tars[@]} -eq 0 ]]; then
  echo "Loading Docker images from $ROOT ..."
  docker load -i dotnet-backend.tar
  docker load -i documentation_generator.tar
  docker load -i pac_cli.tar
  docker load -i qdrant.tar
  mkdir -p pac-workspace documentation_generator/runtime-data
fi

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

# Fetch secrets from Azure Key Vault
echo "Fetching secrets from Azure Key Vault '$VAULT'..."
openai_key="$(get_secret "AI-API-KEY")"
azure_endpoint="$(get_secret "AZURE-OPENAI-ENDPOINT")"
nextauth_secret="$(get_secret "NEXTAUTH-SECRET")"
azure_client_id="$(get_secret "AZURE-AD-CLIENT-ID")"
azure_client_secret="$(get_secret "AZURE-AD-CLIENT-SECRET")"
azure_tenant_id="$(get_secret "AZURE-AD-TENANT-ID")"

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

docker compose --env-file .env.generated -f "$COMPOSE_FILE" up -d --force-recreate

required_containers=(
  "qdrant"
  "rag-backend-dotnet"
  "documentation-generator"
  "pac-cli"
)

echo "Verifying release containers are running:"
for container in "${required_containers[@]}"; do
  running="$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)"
  if [[ "$running" != "true" ]]; then
    echo "ERROR: Expected container '$container' to be running." >&2
    exit 1
  fi
  echo "${container}=RUNNING"
done

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

echo "Done. App is running (backend: port 8001, docs UI: port 3000, qdrant: ports 6333/6334)."
