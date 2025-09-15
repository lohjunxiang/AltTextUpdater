#!/usr/bin/env bash
# Run (writes changes) with backups.
set -euo pipefail

# Defaults (can be overridden when calling, e.g., ALT_REWRITE_SRC=0 ./run-update.sh)
: "${ALT_DRY_RUN:=0}"        # write changes
: "${ALT_BACKUP:=1}"         # keep a backup of jsonFiles/
: "${ALT_REWRITE_SRC:=1}"    # rewrite src using CSV mapping by default

export ALT_DRY_RUN ALT_BACKUP ALT_REWRITE_SRC

# Prefer python3, fallback to python
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

"$PY" "$(dirname "$0")/update_alt_text_from_csv.py"
