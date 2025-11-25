# Billing alerts & budgets

This guide shows a safe, minimal way to create AWS billing alerts for your Bedrock usage using AWS Budgets and SNS email notifications.

Why
- Bedrock calls incur real AWS charges. A budget with email alerts helps you avoid surprises.
- This repo includes a CloudFormation template that creates an SNS topic and an AWS Budget that emails you when actual costs exceed a percentage threshold.

What I added
- `deploy/aws-billing-budget.yml` — CloudFormation template to create an SNS topic and AWS Budget with email notifications.
- `scripts/deploy_billing_budget.sh` — small wrapper that runs `aws cloudformation deploy` with sensible defaults.

How it works
1. The template creates an SNS topic and an AWS Budgets resource.
2. The budget is configured with `NotificationsWithSubscribers` so when actual cost crosses the provided `Threshold` (percentage) an email is sent to the address you provide.
3. Email subscriptions require one confirmation click from the recipient.

Quick deploy (recommended)
1. Ensure the AWS CLI is configured for the AWS account/region you will run Bedrock in and that the user/role has `cloudformation:CreateStack`, `cloudformation:UpdateStack`, `iam:PassRole` (if you create IAM resources), and `budgets:*` permissions.

2. Deploy using the provided script. Example (zsh):

```bash
# make script executable first if needed
chmod +x scripts/deploy_billing_budget.sh

# Deploy: this will create a monthly budget of 50 USD and notify when 80% (40 USD) is exceeded
./scripts/deploy_billing_budget.sh --budget-amount 50 --threshold 80 --email you@example.com --stack-name financial-rag-billing --region us-east-1
```

3. Confirm the SNS email subscription by clicking the confirmation link sent to the address you specified.

4. Monitor budgets in the AWS console (Billing -> Budgets) and set additional notifications or actions as needed.

Notes & recommendations
- Choose a conservative `BudgetAmount` for early tests (e.g., $10-50) to avoid unexpected spend.
- You can add multiple notifications (e.g., 50%/80%/100%) by extending the CloudFormation template.
- Consider adding CloudWatch alarms and automated actions (e.g., stop nonessential resources) for stricter control.
- For production, attach budgets/alerts to the AWS account owner or a team alias that receives alerts.

If you'd like, I can:
- Add a second template that creates multiple percentage thresholds (50/80/100).
- Add an option to route notifications to an SNS topic subscribed by an Ops Slack/Chat webhook using an HTTP(S) subscription (requires an endpoint that accepts the SNS confirmation flow).
- Create a small Terraform alternative if you prefer Terraform over CloudFormation.
