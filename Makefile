# One target takes a clean checkout to a running state, and CI calls the same
# targets. A command that only works on the maintainer's machine is not a
# command this project has.

UV ?= uv
PY ?= .venv/bin/python
NPM ?= npm --prefix ui

.PHONY: setup lint typecheck test ui verify serve seed clean

setup:                     ## Install both halves and the interface's toolchain
	$(UV) venv --python 3.12
	VIRTUAL_ENV=$(PWD)/.venv $(UV) pip install -e ".[server,httpx]" \
		"blackboardx>=0.11.1" pytest ruff mypy
	$(NPM) install

lint:                      ## ruff, and the interface's own gates
	.venv/bin/ruff check src tests examples
	.venv/bin/ruff format --check src tests examples
	$(NPM) run check
	$(NPM) run contrast

typecheck:                 ## mypy --strict, and tsc
	.venv/bin/mypy src
	$(NPM) run typecheck

test:                      ## The suite. Names a database and it runs every test
	.venv/bin/python -m pytest

ui:                        ## Build the interface into the Python package
	$(NPM) run build

verify: lint typecheck test ## Everything a pull request has to pass

serve:                     ## Run the platform
	.venv/bin/python -m blackboardxray.server serve

seed:                      ## Put real runs in front of the interface
	.venv/bin/python examples/seed.py

clean:
	rm -rf src/blackboardxray/server/web ui/node_modules .pytest_cache .mypy_cache
