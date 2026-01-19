import os
from typing import Dict, Optional

import requests
from openai import OpenAI


DEFAULT_PROVIDER = "cloud"


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
        try:
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
            raise RuntimeError(f"Local LLM not reachable at {config['base_url']}: {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Local LLM error: {exc}") from exc

    api_key = api_key_override or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set for cloud provider")

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
        raise RuntimeError(f"Cloud LLM error: {exc}") from exc
