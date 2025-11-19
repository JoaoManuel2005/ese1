import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app import load_api_keys  # noqa: E402


def test_env_secret_manager_get_set(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENAI_API_KEY', 'sk_test_openai')
    monkeypatch.setenv('LLAMA_CLOUD_API_KEY', 'llama_test')

    # load_api_keys should pick up env vars in non-tty mode
    monkeypatch.setattr(os, 'isatty', lambda fd: False)
    openai, llama = load_api_keys()
    assert openai == 'sk_test_openai'
    assert llama == 'llama_test'
