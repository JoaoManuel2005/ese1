PYTHON ?= python

.PHONY: lockfile check-lockfile

lockfile:
	$(PYTHON) -m pip install --upgrade pip==25.2 pip-tools==7.5.1
	$(PYTHON) -m piptools compile --output-file=requirements-lock.txt requirements.txt

check-lockfile:
	bash ./scripts/check_lockfile.sh
