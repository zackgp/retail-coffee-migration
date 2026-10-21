#!/usr/bin/env bash
# G7 (PLAN.md §3): strict lint + residue scan for the JS files a batch created from .coffee.
#
#   tools/lint_converted.sh <files…>     (src/…, <appDir>/src/… or absolute paths)
#
# 1. lint_scan.mjs (residue / forbidden patterns; lists defaults and `&&` JSX for review)
# 2. eslint --max-warnings 0 with no-undef / import/no-unresolved / no-unused-vars as errors
# Runs eslint through sr_web.sh on the host, or directly when already inside the container.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ "${COFFEE_IN_CONTAINER:-}" == "1" ]]; then
  : "${COFFEE_MONOLITH:?}" "${COFFEE_WORK_DIR:?}"
  NODE=(yarn node)
  APP_PREFIX="${COFFEE_MONOLITH#"${COFFEE_REPO_ROOT:-/sr}"/}"
else
  eval "$(node "$HERE/lib/config_env.mjs")" || exit 2
  NODE=(node)
  APP_PREFIX="$COFFEE_APP_DIR"
fi
cd "$COFFEE_MONOLITH"

if [[ $# -eq 0 ]]; then
  echo "lint_converted.sh: no files (nothing converted) — ok"
  exit 0
fi
files=()
for f in "$@"; do
  f="${f#"$COFFEE_MONOLITH"/}"
  files+=("${f#"$APP_PREFIX"/}")
done

status=0
mkdir -p "$COFFEE_WORK_DIR"
"${NODE[@]}" "$HERE/lint_scan.mjs" "${files[@]}" --report "$COFFEE_WORK_DIR/lint_converted.md" || status=1

ESLINT=(yarn eslint --max-warnings 0
  --rule 'no-undef: error'
  --rule 'import/no-unresolved: error'
  --rule 'no-unused-vars: error'
  "${files[@]}")
if [[ "${COFFEE_IN_CONTAINER:-}" == "1" ]]; then
  "${ESLINT[@]}" || status=1
else
  "$HERE/sr_web.sh" "${ESLINT[@]}" || status=1
fi

if [[ $status -eq 0 ]]; then echo "lint_converted: ok"; else echo "lint_converted: FAIL"; fi
exit $status
