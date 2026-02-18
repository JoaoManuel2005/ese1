import os
import subprocess
import re

# Patterns for obvious secret leaks (keeping conservative to avoid false positives)
SECRET_PATTERNS = [

    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"(?<![A-Z0-9_])[A-Za-z0-9_-]{40,}(?![A-Z0-9_])"),
]

ALLOWED_FILES = {
    ".env.example",
    "credentials.md",
    "bedrock-setup.md",
    "package-lock.json",
    "requirements-lock.txt",
}

ALLOWED_PATH_SUBSTRINGS = (
    "docs/",
    "docker-compose",
)


SCAN_EXTENSIONS = (".py", ".md", ".txt", ".yml", ".yaml", ".json")


def _git_tracked_files():
    out = subprocess.check_output(
        ["git", "ls-files"], stderr=subprocess.DEVNULL, text=True
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def test_no_secrets_committed():
    offenders = []

    for path in _git_tracked_files():

        if os.path.basename(path) in ALLOWED_FILES:
            continue

        if any(p in path for p in ALLOWED_PATH_SUBSTRINGS):
            continue

        if not path.endswith(SCAN_EXTENSIONS):
            continue

        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except OSError:
            continue

        for pattern in SECRET_PATTERNS:
            if pattern.search(content):
                offenders.append(path)
                break

    assert not offenders, (
        "Potential secret(s) detected in committed files:\n"
        + "\n".join(sorted(set(offenders)))
    )
