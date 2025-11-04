## GitHub Actions OIDC -> IAM role (quick guide)

This guide shows how to configure an IAM role that GitHub Actions can assume via OIDC. This avoids storing AWS long-lived credentials in repository secrets.

1. Create an IAM role with a trust policy that allows GitHub OIDC. Replace `<OWNER>` and `<REPO>` with your values, or adjust the `sub` condition to allow org-level flows.

Example trust policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

2. Attach a permissions policy to that role (example minimal policy to allow Bedrock invocation and Secrets Manager read):

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

3. Copy the role ARN and add it to your repository secrets as `AWS_ROLE_TO_ASSUME`.

4. Update the workflow to use `aws-actions/configure-aws-credentials@v2` (we updated `bedrock-integration.yml` already). Ensure the workflow has `permissions: id-token: write` and `contents: read`.

Example minimal workflow permissions:

```yaml
permissions:
  id-token: write
  contents: read
```

Notes & tips:
- Use the narrowest `sub` condition possible to reduce blast radius (bind to a single branch or tag and the repo).
- If you need cross-repo access or org-level usage, configure the `sub` condition accordingly.
- Test the trust policy with a single manual run and check the CloudTrail `AssumeRoleWithWebIdentity` entries if troubleshooting.
