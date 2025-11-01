import os
import json

# Minimal Lambda handler that delegates to the project's Bedrock adapter.
# This keeps imports lazy so tests and local tooling don't fail at import-time.

def _get_bedrock_adapter():
    # Import lazily to avoid heavy imports during test collection
    try:
        from llm_bedrock import BedrockLLMAdapter
    except Exception:
        # If llm_bedrock isn't available or raises, raise a clear error
        raise RuntimeError("Bedrock adapter not available. Ensure llm_bedrock.py is present and boto3 is configured.")

    model_id = os.environ.get("BEDROCK_MODEL_ID")
    if not model_id:
        raise RuntimeError("BEDROCK_MODEL_ID environment variable is required for Bedrock adapter")

    return BedrockLLMAdapter(model_id=model_id)


def lambda_handler(event, context):
    """Lambda-compatible handler.

    Expects a JSON body with either:
      {"prompt": "..."}

    Returns a JSON object with {"text": "..."}
    """
    adapter = _get_bedrock_adapter()

    # Support both API Gateway proxy and direct invocation
    body = event.get("body") if isinstance(event, dict) else None
    if body:
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}
    else:
        payload = event

    prompt = payload.get("prompt")
    if not prompt:
        return {"statusCode": 400, "body": json.dumps({"error": "prompt required"})}

    # Call the adapter's generate or predict method
    try:
        generated = adapter.generate(prompt)
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}

    return {"statusCode": 200, "body": json.dumps({"text": generated})}
