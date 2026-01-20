#!/usr/bin/env bash
set -euo pipefail

# Regenerate requirements-lock.txt deterministically and fail if it differs
# Uses pinned tool versions to avoid resolver drift between developer machines and CI

PYTHON=${PYTHON:-python}

echo "Using interpreter: $($PYTHON --version 2>&1)"
echo "Installing pinned tooling..."
$PYTHON -m pip install --upgrade pip==25.2 pip-tools==7.5.1 >/dev/null

echo "Regenerating requirements-lock.txt"
$PYTHON -m piptools compile --output-file=requirements-lock.txt requirements.txt

if ! git --no-pager diff --quiet -- requirements-lock.txt; then
  echo "requirements-lock.txt is out of date. Please run:" >&2
  echo "  python -m pip install --upgrade pip==25.2 pip-tools==7.5.1" >&2
  echo "  python -m piptools compile --output-file=requirements-lock.txt requirements.txt" >&2
  echo "Then commit the updated requirements-lock.txt." >&2
  git --no-pager diff -- requirements-lock.txt || true
  exit 1
fi

echo "requirements-lock.txt is up to date."
