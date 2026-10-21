#!/usr/bin/env bash
# Regression test for `coffee_hotspots.mjs --check` (G7b / verify.sh step 4b).
# Run from anywhere; exits non-zero if any scenario returns an unexpected exit code.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(dirname "$HERE")"
eval "$(node "$TOOLS/lib/config_env.mjs")" || exit 2
cd "$COFFEE_MONOLITH"

T="$COFFEE_WORK_DIR/selftest/hotspots_check.md"
mkdir -p "$(dirname "$T")"
H="node $TOOLS/coffee_hotspots.mjs"
FILES="src/sagamore/lib/util.coffee src/sagamore/mixins/imports.coffee"
fail=0
expect() { # expect <code> <label>
  local got=$?
  if [[ "$got" == "$1" ]]; then echo "ok   $2 (exit $got)"; else echo "FAIL $2: expected exit $1, got $got"; fail=1; fi
}
sedi() { if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi; }

$H $FILES --out $T --fresh > /dev/null

$H --check $T > /dev/null; expect 1 "1. nothing concluded"

sedi 's/^批量结论：$/批量结论：已核对，按 §6 规则翻译/' $T
$H --check $T > /dev/null; expect 1 "2. only batch conclusions (⚠ items still open)"

sedi -E '/⚠/ s/ — 结论：$/ — 结论：已处理/' $T
sedi -E '/\[splat\].*:24 / s/ — 结论：$/ — 结论：TODO/' $T
$H --check $T > /dev/null; expect 1 "3. one item explicitly TODO"

sedi -E 's/ — 结论：TODO$/ — 结论：展开参数直接对应 ...params/' $T
$H --check $T > /dev/null; expect 0 "4. everything concluded"

$H $FILES --out $T > /dev/null
$H --check $T > /dev/null; expect 0 "5. regenerate keeps conclusions"

cp $T $T.bak
sedi -E 's/`delimiter \?= "."`/`delimiter ?= ","`/' $T
$H --check $T > /dev/null; expect 1 "6. tampered item text (hash)"
cp $T.bak $T

sedi -E '/\[for-own\].*:29 /d' $T
$H --check $T > /dev/null; expect 1 "7. deleted item"
cp $T.bak $T

node -e '
const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8").split("\n");
const i=s.findIndex(l=>l.startsWith("- [splat]"));const l=s.splice(i,1)[0];
const j=s.findIndex(l=>l.startsWith("- [for-own]"));s.splice(j,0,l);fs.writeFileSync(p,s.join("\n"))' $T
$H --check $T > /dev/null; expect 1 "8. item moved to another category"
cp $T.bak $T

$H --check "$COFFEE_WORK_DIR/selftest/does_not_exist.md" > /dev/null 2>&1; expect 2 "9. missing file"

exit $fail
