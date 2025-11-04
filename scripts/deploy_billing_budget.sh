#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --email EMAIL [--budget-amount AMOUNT] [--threshold PERCENT] [--stack-name NAME] [--region REGION]

Defaults:
  BUDGET_AMOUNT=50
  THRESHOLD=80
  STACK_NAME=financial-rag-billing
  REGION=us-east-1

Example:
  ./scripts/deploy_billing_budget.sh --email you@example.com --budget-amount 20 --threshold 80 --stack-name fr-billing --region us-east-1
EOF
}

BUDGET_AMOUNT=50
THRESHOLD=80
STACK_NAME=financial-rag-billing
REGION=us-east-1
EMAIL=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="$2"; shift 2;;
    --budget-amount)
      BUDGET_AMOUNT="$2"; shift 2;;
    --threshold)
      THRESHOLD="$2"; shift 2;;
    --stack-name)
      STACK_NAME="$2"; shift 2;;
    --region)
      REGION="$2"; shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

if [[ -z "$EMAIL" ]]; then
  echo "--email is required"; usage; exit 1
fi

aws cloudformation deploy \
  --template-file deploy/aws-billing-budget.yml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides BudgetAmount="$BUDGET_AMOUNT" AlertThresholdPercent="$THRESHOLD" NotificationEmail="$EMAIL" \
  --region "$REGION"

echo "Deployed billing budget stack. Confirm the subscription email in your inbox to receive alerts."