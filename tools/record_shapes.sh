#!/usr/bin/env bash
# G4 recording (PLAN.md §4 step 3): snapshot the export shape of a batch's modules while they
# are still .coffee. Run on the HOST, on the target branch BEFORE converting.
#
#   tools/record_shapes.sh B05            # every .coffee of the batch
#   tools/record_shapes.sh src/sagamore/lib/util.coffee …
#
# Writes <dataDir>/shapes/<module>.json in THIS repo (with recordedFrom + recordedSha, the git
# blob sha of the .coffee; verify.sh step 0b checks it against the target's merge base). Commit
# them here, not in the target PR.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")"
cd "$COFFEE_MONOLITH"
if [[ $# -eq 0 ]]; then echo "usage: record_shapes.sh <Bxx | files…>" >&2; exit 2; fi
if [[ "$1" =~ ^[Bb][0-9] ]]; then
  MODULES="$(node "$HERE/inventory.mjs" --batch "$1" --list coffee 2>/dev/null | paste -sd, -)"
else
  MODULES=""
  for f in "$@"; do MODULES+="${f#"$COFFEE_APP_DIR"/},"; done
fi
if [[ -z "$MODULES" ]]; then echo "record_shapes.sh: no .coffee modules to record" >&2; exit 1; fi
echo "recording: ${MODULES//,/ }"
mkdir -p "$COFFEE_DATA_DIR/shapes"
"$HERE/ensure_packages.sh"
"$HERE/sr_web.sh" env UPDATE_COFFEE_SHAPES=1 "COFFEE_SHAPES_MODULES=$MODULES" \
  sh -c 'yarn jest --ci --cacheDirectory "$JEST_CACHE_DIR" "$COFFEE_TOOLS_ROOT/jest/tests/export_shapes"'
grep -l '"loadError"' "$COFFEE_DATA_DIR"/shapes/*.json 2>/dev/null | sed 's/^/loadError (shape not compared; G5 covers it): /' || true
