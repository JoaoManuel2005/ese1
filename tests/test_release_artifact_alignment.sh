#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

assert_contains() {
  local file="$1"
  local pattern="$2"

  if ! rg -Fq "$pattern" "$file"; then
    echo "FAIL: expected '$pattern' in $file" >&2
    exit 1
  fi
}

echo "Checking image-based release compose settings..."
assert_contains "docker-compose.images.yml" 'FEATURE_SHAREPOINT_ENRICHMENT=${FEATURE_SHAREPOINT_ENRICHMENT:-false}'
assert_contains "docker-compose.images.yml" 'EMBEDDING_PROVIDER=onnx'
assert_contains "docker-compose.images.yml" 'ONNX_MODEL_PATH=/app/Models/bge-base-en-v1.5.onnx'
assert_contains "docker-compose.images.yml" 'ONNX_MAX_SEQUENCE_LENGTH=512'

echo "Checking Bash release script env generation..."
assert_contains "scripts/run-with-images.sh" 'FEATURE_SHAREPOINT_ENRICHMENT=false'
assert_contains "scripts/run-with-images.sh" 'docker compose --env-file .env.generated -f "$COMPOSE_FILE" up -d --force-recreate'
assert_contains "scripts/run-with-images.sh" 'NEXTAUTH_SECRET'
assert_contains "scripts/run-with-images.sh" 'AZURE_AD_CLIENT_ID'
assert_contains "scripts/run-with-images.sh" 'AZURE_AD_CLIENT_SECRET'
assert_contains "scripts/run-with-images.sh" 'AZURE_AD_TENANT_ID'

echo "Checking PowerShell release script env generation..."
assert_contains "scripts/run-with-images.ps1" 'FEATURE_SHAREPOINT_ENRICHMENT=false'
assert_contains "scripts/run-with-images.ps1" 'docker compose --env-file .env.generated -f $COMPOSE_FILE up -d --force-recreate'
assert_contains "scripts/run-with-images.ps1" 'NEXTAUTH_SECRET'
assert_contains "scripts/run-with-images.ps1" 'AZURE_AD_CLIENT_ID'
assert_contains "scripts/run-with-images.ps1" 'AZURE_AD_CLIENT_SECRET'
assert_contains "scripts/run-with-images.ps1" 'AZURE_AD_TENANT_ID'

echo "Checking release docs..."
assert_contains "README.md" 'docgenvault'
assert_contains "README.md" 'FEATURE_SHAREPOINT_ENRICHMENT=false'
assert_contains "RUN-FROM-ARTIFACT.md" 'FEATURE_SHAREPOINT_ENRICHMENT=false'
assert_contains "RUN-FROM-ARTIFACT.md" 'ONNX/BGE embedding configuration'

echo "Release artifact alignment checks passed."
