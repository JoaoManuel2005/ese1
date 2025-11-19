## Credentials and secrets (Bedrock + AWS)

Do not store Bedrock or AWS credentials in the repository. Use one of the following options depending on the runtime.

- Production (recommended): attach an IAM role to the runtime (Lambda execution role, ECS task role, or EC2 instance role). Grant `bedrock:InvokeModel` and any Secrets Manager read permissions the role needs.
- CI (recommended): use GitHub OIDC to allow Actions to assume a short-lived role (see `docs/github-oidc.md`).
- Local development: use `aws configure`, `aws-vault`, or AWS SSO. Avoid committing long-lived credentials.
- Secrets Manager / Parameter Store: good for non-credential secrets (model IDs, keys) and rotation/audit.

Environment variables to set (examples):

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-west-2
BEDROCK_MODEL_ID=your-bedrock-model-id
LLAMA_CLOUD_API_KEY=optional-other-key
```

Minimal IAM policy example (replace ARNs and region/account):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-west-2:123456789012:secret:my-bedrock-secret-*"
    }
  ]
}
```

If you want, store `BEDROCK_MODEL_ID` in Secrets Manager and read it at runtime with the execution role.

---

See `docs/github-oidc.md` for a guide to configure GitHub Actions OIDC so you don't need to put AWS keys in Action secrets.
