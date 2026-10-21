#!/usr/bin/env bash
# Container half of verify.sh (do not call directly; verify.sh runs it through sr_web.sh, which
# sets COFFEE_*). Reads file lists that verify.sh wrote to <workDir>/verify/ and records one exit
# status per step in .../status/<step>.
set -uo pipefail
: "${COFFEE_MONOLITH:?run through tools/sr_web.sh}" "${COFFEE_TOOLS_ROOT:?}" "${COFFEE_WORK_DIR:?}"
cd "$COFFEE_MONOLITH"
MODE="$1"
TOOLS="$COFFEE_TOOLS_ROOT/tools"
W="$COFFEE_WORK_DIR/verify"
mkdir -p "$W/status"
JEST_CACHE=(--cacheDirectory "${JEST_CACHE_DIR:-/tmp/jest-cache}")
mark() { echo "$2" > "$W/status/$1"; }
list() { [[ -s "$W/$1" ]] && cat "$W/$1"; }

echo "=== [2] eslint --max-warnings 0 (strict) on converted files"
if [[ -s "$W/converted.txt" ]]; then
  # shellcheck disable=SC2046
  yarn eslint --max-warnings 0 --rule 'no-undef: error' --rule 'import/no-unresolved: error' --rule 'no-unused-vars: error' $(list converted.txt)
  mark 2-eslint-strict $?
else
  echo "(no converted files)"; mark 2-eslint-strict 0
fi

if [[ "$MODE" == "quick" ]]; then
  echo "=== [3] eslint on changed files + callers"
  COLLECT_ESLINT_FILES="$W/eslint_files.txt" yarn node "$TOOLS/collect.mjs" --out verify/current --only eslint
  mark 3-eslint-collect $?
fi

echo "=== [4] jest --findRelatedTests (changed code) + coffee-tools/jest/tests (guardrails)"
if [[ -s "$W/related.txt" ]]; then
  # shellcheck disable=SC2046
  yarn jest --ci "${JEST_CACHE[@]}" --maxWorkers=4 --findRelatedTests $(list related.txt)
  mark 4-jest-related $?
else
  echo "(no changed code)"; mark 4-jest-related 0
fi
yarn jest --ci "${JEST_CACHE[@]}" "$COFFEE_TOOLS_ROOT/jest/tests"
mark 4-jest-guardrails $?

if [[ "$MODE" == "full" ]]; then
  echo "=== [3,5,6,7,8] collect eslint/tsc/webpack/karma/jest (full)"
  yarn node "$TOOLS/collect.mjs" --out verify/current --only karma-static,tsc,eslint,webpack-dev,webpack-prod,karma,jest
  mark 5-8-collect $?
fi
exit 0
