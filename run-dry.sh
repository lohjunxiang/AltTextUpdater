#!/usr/bin/env bash
# Dry-run (preview only) — no writes.
set -euo pipefail

# Defaults (can be overridden when calling, e.g., ALT_REWRITE_SRC=0 ./run-dry.sh)
: "${ALT_DRY_RUN:=1}"        # always preview
: "${ALT_BACKUP:=0}"         # no backup needed for dry-run
: "${ALT_REWRITE_SRC:=1}"    # preview src rewrites by default

export ALT_DRY_RUN ALT_BACKUP ALT_REWRITE_SRC

# Prefer python3, fallback to python
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

"$PY" "$(dirname "$0")/update_alt_text_from_csv.py"
