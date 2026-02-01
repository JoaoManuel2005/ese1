import os
from typing import Dict, Optional

import requests
from openai import OpenAI


DEFAULT_PROVIDER = "cloud"

# Placeholder values that should not be used as real API keys
PLACEHOLDER_VALUES = {
    "your_openai_api_key_here",
    "your_anthropic_api_key_here",
    "sk-xxx",
    "your-api-key",
    "",
}


def is_valid_api_key(key: Optional[str]) -> bool:
    """Check if an API key is valid (not a placeholder or empty)"""
    if not key:
        return False
    return key.strip().lower() not in {v.lower() for v in PLACEHOLDER_VALUES}


def resolve_provider(provider_override: Optional[str] = None) -> str:
    provider = (provider_override or os.getenv("LLM_PROVIDER", DEFAULT_PROVIDER)).strip().lower()
    return "local" if provider == "local" else "cloud"


def resolve_model(provider: str, model_override: Optional[str] = None) -> str:
    if provider == "local":
        return model_override or os.getenv("LOCAL_LLM_MODEL", "llama3.1:8b")
    return model_override or os.getenv("OPENAI_MODEL", "gpt-4")


def provider_config(provider_override: Optional[str] = None, model_override: Optional[str] = None) -> Dict[str, str]:
    provider = resolve_provider(provider_override)
    model = resolve_model(provider, model_override)
    base_url = os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434").rstrip("/")
    return {"provider": provider, "model": model, "base_url": base_url}


def chat_complete(
    system: str,
    user: str,
    *,
    provider_override: Optional[str] = None,
    model_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
) -> str:
    config = provider_config(provider_override, model_override)
    provider = config["provider"]
    model = config["model"]

    if provider == "local":
        # Use /api/generate for tinyllama, fallback to /api/chat for others
        try:
            if model.startswith("tinyllama"):
                # Use /api/generate endpoint for TinyLlama
                resp = requests.post(
                    f"{config['base_url']}/api/generate",
                    json={
                        "model": model,
                        "prompt": f"{system}\n{user}",
                        "stream": False,
                    },
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data.get("response")
                if not content:
                    raise ValueError("Local LLM returned no content")
                return content
            else:
                # Use /api/chat for other models
                resp = requests.post(
                    f"{config['base_url']}/api/chat",
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "stream": False,
                    },
                    timeout=120,
                )
                resp.raise_for_status()
                data = resp.json()
                message = data.get("message", {})
                content = message.get("content")
                if not content:
                    raise ValueError("Local LLM returned no content")
                return content
        except requests.RequestException as exc:
            raise RuntimeError(
                f"Local LLM not reachable at {config['base_url']}. "
                "Please ensure Ollama is running (ollama serve) or set a valid OPENAI_API_KEY in .env file. "
                f"Error: {exc}"
            ) from exc
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Local LLM error: {exc}") from exc

    api_key = api_key_override or os.getenv("OPENAI_API_KEY")
    
    # Validate API key is set and not a placeholder
    if not is_valid_api_key(api_key):
        raise RuntimeError(
            "OPENAI_API_KEY not configured or using placeholder value. "
            "Please set a valid OpenAI API key in the .env file, or "
            "set LLM_PROVIDER=local and run Ollama for local LLM."
        )

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        return resp.choices[0].message.content
    except Exception as exc:  # noqa: BLE001
        error_msg = str(exc).lower()
        if "invalid api key" in error_msg or "incorrect api key" in error_msg:
            raise RuntimeError(
                "Invalid OpenAI API key. Please check your OPENAI_API_KEY in the .env file."
            ) from exc
        if "quota" in error_msg or "billing" in error_msg or "insufficient" in error_msg:
            raise RuntimeError(
                "OpenAI API quota exceeded or billing issue. Please check your OpenAI account."
            ) from exc
        raise RuntimeError(f"Cloud LLM error: {exc}") from exc
