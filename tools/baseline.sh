#!/usr/bin/env bash
# G6 (PLAN.md §3): records the migration baseline into <dataDir>/baseline/ (committed in THIS
# repo). Re-run after every rebase of the target onto a new base ref. Run on the HOST (needs git
# + docker).
#
#   tools/baseline.sh [--only jest,karma,...]
#
# Collects inside the sr_web container (see collect.mjs for the file formats), then copies the
# normalized, diff-friendly files into baseline/. Raw logs stay in <workDir>/baseline-run/raw.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")"
REPO="$COFFEE_TARGET_REPO"
APP="$COFFEE_APP_DIR"
RUN_DIR="$COFFEE_WORK_DIR/baseline-run"
OUT="$COFFEE_DATA_DIR/baseline"
ONLY=""
if [[ "${1:-}" == "--only" ]]; then ONLY="--only $2"; fi

if [[ -n "$(git -C "$REPO" status --porcelain -- "$APP/src" "$APP/webpack.config.js" "$APP/package.json")" ]]; then
  echo "baseline.sh: $APP/src (or build config) has uncommitted changes; record the baseline on a clean tree." >&2
  git -C "$REPO" status --short -- "$APP/src" "$APP/webpack.config.js" "$APP/package.json" >&2
  if [[ "${BASELINE_ALLOW_DIRTY:-}" != "1" ]]; then exit 1; fi
  echo "BASELINE_ALLOW_DIRTY=1: continuing anyway." >&2
fi

"$HERE/ensure_packages.sh"
[[ -z "$ONLY" ]] && rm -rf "$RUN_DIR"
# collect.mjs resolves --out against the work dir
# shellcheck disable=SC2086
"$HERE/sr_web.sh" yarn node "$COFFEE_C_TOOLS/tools/collect.mjs" --out baseline-run $ONLY

mkdir -p "$OUT"
for f in jest-failures.txt jest-passing.txt karma.txt karma-specs.txt test-config.txt eslint.json tsc-errors.txt webpack-modules-dev.txt webpack-modules-prod.txt; do
  [[ -f "$RUN_DIR/$f" ]] && cp "$RUN_DIR/$f" "$OUT/$f"
done
# summary without timings/timestamps so it only changes when the numbers change
node -e '
const fs = require("fs")
const [src, dst] = process.argv.slice(1)
const s = JSON.parse(fs.readFileSync(src, "utf8"))
const prev = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, "utf8")) : {}
for (const v of Object.values(s)) { delete v.secs; delete v.collectedAt }
fs.writeFileSync(dst, JSON.stringify({ ...prev, ...s }, null, 1) + "\n")
' "$RUN_DIR/summary.json" "$OUT/summary.json"

{
  echo "recorded: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "target: $COFFEE_TARGET_NAME ($REPO, $APP)"
  echo "HEAD: $(git -C "$REPO" rev-parse --short HEAD)"
  echo "$COFFEE_BASE_REF: $(git -C "$REPO" rev-parse --short "$COFFEE_BASE_REF" 2>/dev/null || echo unknown)"
  echo "merge-base: $(git -C "$REPO" merge-base HEAD "$COFFEE_BASE_REF" 2>/dev/null | cut -c1-10 || echo unknown)"
  echo "collectors: ${ONLY:-all}"
} > "$OUT/meta.txt"

echo
echo "baseline written to ${OUT#"$COFFEE_TOOLS_ROOT"/}:"
node -e 'const s=require(process.argv[1]); for (const [k,v] of Object.entries(s)) console.log("  " + k.padEnd(13), JSON.stringify(v))' "$OUT/summary.json"
