# Deploying as an AWS Lambda container image

This guide shows how to build the repository as a Lambda container image, push it to ECR, and create a Lambda function that uses the image. It assumes you have the AWS CLI configured and permissions to create ECR repos, push images, and create Lambda functions.

1) Build the image locally (tag with your ECR repo URI)

```bash
# Replace ACCOUNT_ID, REGION and REPO_NAME
ACCOUNT_ID=123456789012
REGION=us-west-2
REPO_NAME=financial-rag-lambda

aws ecr create-repository --repository-name $REPO_NAME --region $REGION || true
ECR_URI=${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:latest

# Authenticate docker to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

docker build -f Dockerfile.lambda -t ${REPO_NAME}:latest .
docker tag ${REPO_NAME}:latest ${ECR_URI}
docker push ${ECR_URI}
```

2) Create an IAM role for Lambda (execution role)

- Create a role with a trust policy for Lambda.
- Attach a permissions policy that grants `bedrock:InvokeModel` and `secretsmanager:GetSecretValue` (if you use Secrets Manager).

3) Create the Lambda function using the image

```bash
aws lambda create-function \
  --function-name financial-rag-bedrock \
  --package-type Image \
  --code ImageUri=${ECR_URI} \
  --role arn:aws:iam::${ACCOUNT_ID}:role/YourLambdaExecutionRole \
  --region ${REGION}
```

4) Configure environment variables (via AWS Console or CLI)

Set at minimum:

- `BEDROCK_MODEL_ID` — the model identifier you want to call
- `AWS_DEFAULT_REGION` — region where Bedrock is available

5) Invoke the function (test) using the AWS CLI

```bash
aws lambda invoke --function-name financial-rag-bedrock --payload '{"prompt":"Hello"}' response.json
cat response.json
```

Notes and tips
- Do NOT bake secrets into the image. Attach an IAM role to the Lambda or use Secrets Manager with an execution role.
- Keep the image small: remove dev-only dependencies from `requirements-lock.txt` before building a production image.
- If your function has significant cold-start costs, consider running on ECS/Fargate or keep a warm pool.
