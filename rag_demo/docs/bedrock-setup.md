# AWS Bedrock Setup (minimal)

This document explains how to run this project using AWS Bedrock as the LLM backend, and provides a minimal IAM policy and recommended best practices for production.

## Key points

- When using Bedrock you should prefer IAM roles (ECS task role / EC2 instance role / EKS service account) so you don't need to embed AWS keys in the environment.
- The application supports reading secrets from AWS Secrets Manager via `secret_manager.AwsSecretsManager` if you prefer that approach.
- The app respects `LLM_PROVIDER=bedrock` and requires `BEDROCK_MODEL_ID` to be set.

## Environment variables

- `LLM_PROVIDER=bedrock`  # choose bedrock as the LLM provider
- `BEDROCK_MODEL_ID=<bedrock-model-id>`  # the model identifier you want to invoke
- `LLAMA_CLOUD_API_KEY`  # required: key used by LlamaParse (document parser)
- (optional) `OPENAI_API_KEY`  # not required for Bedrock-only runs

If running on AWS, prefer assigning an IAM role to the compute resource (ECS/EKS/EC2). If not possible, set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` securely.

## Minimal IAM policy (example)

This policy grants permissions to call Bedrock runtime and to read secrets from Secrets Manager (if your setup uses it). Modify the resource ARNs to the smallest scope required for your account.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBedrockInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowReadSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:YOUR_SECRET_NAME*"
      ]
    }
  ]
}
```

Notes:
- Replace `REGION`, `ACCOUNT_ID` and `YOUR_SECRET_NAME` with your values.
- `bedrock` actions and resource model may change; consult the official AWS Bedrock documentation for the most up-to-date action names and scoping.

## Run locally (developer flow)

1. Create a Python 3.10 virtualenv and install dependencies:

```bash
python3.10 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-lock.txt
```

2. Set required env vars for local runs (or use `AwsSecretsManager` if you have AWS creds locally):

```bash
export LLM_PROVIDER=bedrock
export BEDROCK_MODEL_ID="your-bedrock-model"
export LLAMA_CLOUD_API_KEY="your-llamaparse-key"
# If not using an IAM role, export AWS keys securely
# export AWS_ACCESS_KEY_ID=...
# export AWS_SECRET_ACCESS_KEY=...
```

3. Run the application in no-prompt mode for CI-like non-interactive runs:

```bash
python app.py --no-prompt --data-dir ./data
```

## Production recommendations

- Use IAM roles for compute (ECS task role, EKS IRSA, or EC2 instance role).
- Do not store AWS keys in code or in `.env` files committed to source.
- Use Secrets Manager for non-AWS secrets; grant the app only the minimal `secretsmanager:GetSecretValue` permission.
- Enable structured logs and centralize them (CloudWatch, Datadog, etc.).
- Add monitoring and alerting for failed Bedrock invocations and rate limits.
- Gate any live Bedrock integration tests behind a manual CI input to avoid accidental usage/costs.

## Troubleshooting

- If Bedrock calls fail, verify the IAM role has `bedrock:InvokeModel` permissions and the Bedrock model id is correct.
- If secrets are not found, ensure the role has `secretsmanager:GetSecretValue` or set the env vars directly for testing.

---

If you want, I can add a sample GitHub Actions job snippet for running gated integration tests that are manually triggered (so you can run Bedrock integration tests only when desired).