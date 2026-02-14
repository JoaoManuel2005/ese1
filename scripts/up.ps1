$ErrorActionPreference = "Stop"

$vault = "docgenvault"

# Fetch secrets from Key Vault
$azureKey = az keyvault secret show --vault-name $vault --name "AI-API-KEY" --query value -o tsv
$endpoint = az keyvault secret show --vault-name $vault --name "AZURE-OPENAI-ENDPOINT" --query value -o tsv
$msSecret = az keyvault secret show --vault-name $vault --name "MICROSOFT-CLIENT-SECRET" --query value -o tsv

# Write runtime env file (NOT committed)
@"
OPENAI_API_KEY=$azureKey
AZURE_OPENAI_API_KEY=$azureKey
AZURE_OPENAI_ENDPOINT=$endpoint
MICROSOFT_CLIENT_SECRET=$msSecret
"@ | Set-Content -NoNewline .env.generated

# Run stack
docker compose up -d --build --force-recreate
