#!/usr/bin/env bash
# G8 (PLAN.md §3): per-batch verification. Run on the HOST from anywhere; the target checkout
# comes from config.json / config.local.json / COFFEE_TARGET_REPO (README.md).
#
#   tools/verify.sh [--quick] [--batch Bxx] [--base <ref, default config baseRef>]
#
# --quick  steps 0–4 (+4b): interop, G7 lint, eslint vs baseline, related jest + guardrail tests,
#          hotspot conclusions. For iterating.
# (full)   additionally 5–8: tsc, webpack dev+prod module sets, karma run + DEPRECATED_spec
#          guard, full jest — each compared with <dataDir>/baseline/. Required for DoD.
# Step 9 (e2e) is not automated here; see PLAN.md G8.
#
# Changed files come from git (merge-base with --base, plus untracked files); --batch adds the
# batch's modules and their callers (inventory.mjs) and enables the hotspot check (4b).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")" || exit 2
cd "$COFFEE_MONOLITH"
MODE=full
BATCH=""
BASE="$COFFEE_BASE_REF"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) MODE=quick ;;
    --batch) BATCH="$2"; shift ;;
    --base) BASE="$2"; shift ;;
    *) echo "verify.sh: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

W="$COFFEE_WORK_DIR/verify"
rm -rf "$W"
mkdir -p "$W/status"
declare -a SUMMARY=()
FAILED=0
record() { # record <step> <exit> <label>
  if [[ "$2" == "0" ]]; then SUMMARY+=("ok    $1 $3"); else SUMMARY+=("FAIL  $1 $3"); FAILED=1; fi
}

echo "### verify.sh ($MODE${BATCH:+, batch $BATCH}) target=$COFFEE_MONOLITH base=$BASE"
node "$HERE/changes.mjs" --base "$BASE" || exit 2
node "$HERE/changes.mjs" --base "$BASE" --list converted > "$W/converted.txt"
node "$HERE/changes.mjs" --base "$BASE" --list related-src > "$W/related.txt"
node "$HERE/changes.mjs" --base "$BASE" --list changed > "$W/eslint_files.txt"
node "$HERE/changes.mjs" --base "$BASE" --list deleted > "$W/deleted.txt"
node "$HERE/changes.mjs" --base "$BASE" --list removed-only > "$W/removed_only.txt"
node "$HERE/changes.mjs" --base "$BASE" --list added > "$W/added.txt"
if [[ -n "$BATCH" ]]; then
  node "$HERE/inventory.mjs" --batch "$BATCH" --list related 2>/dev/null | grep -E '\.(jsx?|tsx?)$' >> "$W/eslint_files.txt"
  node "$HERE/inventory.mjs" --batch "$BATCH" --list js 2>/dev/null >> "$W/related.txt"
fi
for f in eslint_files related; do sort -u "$W/$f.txt" -o "$W/$f.txt"; done
echo "converted: $(wc -l < "$W/converted.txt" | tr -d ' ')  related: $(wc -l < "$W/related.txt" | tr -d ' ')  eslint: $(wc -l < "$W/eslint_files.txt" | tr -d ' ')  deleted: $(wc -l < "$W/deleted.txt" | tr -d ' ')"

echo; echo "=== [0] batch assignment (inventory.mjs --check)"
node "$HERE/inventory.mjs" --check; record 0 $? "inventory --check (every .coffee in exactly one batch; no new .coffee/.js pairs)"

echo; echo "=== [0b] snapshot integrity (G4 recorded from the merge-base .coffee; G5 registry unchanged)"
node "$HERE/changes.mjs" --base "$BASE" --list snapshot-problems > "$W/snapshot_problems.txt"
if [[ -s "$W/snapshot_problems.txt" ]]; then sed 's/^/  ✗ /' "$W/snapshot_problems.txt"; record 0b 1 "snapshot integrity"; else record 0b 0 "snapshot integrity"; fi

echo; echo "=== [0c] tool leaks (target branch must not depend on the tools repo)"
node "$HERE/changes.mjs" --base "$BASE" --list tool-leaks > "$W/tool_leaks.txt"
if [[ -s "$W/tool_leaks.txt" ]]; then sed 's/^/  ✗ /' "$W/tool_leaks.txt"; record 0c 1 "tool leaks"; else record 0c 0 "tool leaks"; fi

echo; echo "=== [1] check_interop.mjs (full)"
node "$HERE/check_interop.mjs" --quiet; record 1 $? "check_interop (G3)"

echo; echo "=== [2] lint_scan.mjs on converted files"
if [[ -s "$W/converted.txt" ]]; then
  # shellcheck disable=SC2046
  node "$HERE/lint_scan.mjs" $(cat "$W/converted.txt") --report "$W/lint_converted.md" > /dev/null
  rc=$?
  sed -n '/^## Failures/,/^## Default/p' "$W/lint_converted.md" | head -40
  echo "(review list: $W/lint_converted.md)"
  record 2 $rc "G7 residue scan"
else
  echo "(no converted files)"; record 2 0 "G7 residue scan (nothing converted)"
fi

if [[ -n "$BATCH" ]]; then
  echo; echo "=== [4b] hotspot conclusions"
  HS="$COFFEE_WORK_DIR/hotspots/$(echo "$BATCH" | tr '[:lower:]' '[:upper:]').md"
  if [[ -f "$HS" ]]; then
    node "$HERE/coffee_hotspots.mjs" --check "$HS"; record 4b $? "hotspot conclusions ($HS)"
  else
    echo "missing $HS — generate it before converting: node tools/coffee_hotspots.mjs --batch $BATCH"
    record 4b 1 "hotspot conclusions (checklist missing)"
  fi
fi

echo; echo "=== container steps"
"$HERE/ensure_packages.sh"
"$HERE/sr_web.sh" bash "$COFFEE_C_TOOLS/tools/verify_container.sh" "$MODE" 2>&1 | grep -v -E 'level=warn|^ *Container ' | tee "$W/container.log" | grep -E '^===|✕|FAIL|Tests:|Test Suites:|problems|error ' | head -80
st() { cat "$W/status/$1" 2>/dev/null || echo 99; }
record 2 "$(st 2-eslint-strict)" "eslint --max-warnings 0 strict rules on converted files (G7)"
record 4 "$(st 4-jest-related)" "jest --findRelatedTests"
record 4 "$(st 4-jest-guardrails)" "jest coffee-tools/jest/tests (G4 shapes, G5 registry, G9 helpers)"

echo; echo "=== compare with baseline"
ALLOW=()
re_escape() { printf '%s' "$1" | sed 's/[.[\*^$()+?{|]/\\&/g'; }
while read -r f; do
  [[ -z "$f" ]] && continue
  ALLOW+=(--allow-removed "^$(re_escape "${f%.*}")\\.")
done < "$W/removed_only.txt"
while read -r f; do
  [[ -z "$f" ]] && continue
  ALLOW+=(--allow-added "^$(re_escape "${f%.*}")\\.")
done < "$W/added.txt"
# deleting tests is only expected together with dead code (B01) — otherwise fewer passing tests fail
if grep -qE '(__tests__/|\.test\.)' "$W/deleted.txt" && [[ -s "$W/removed_only.txt" ]]; then ALLOW+=(--allow-test-removal); fi
if [[ "$MODE" == "quick" ]]; then
  [[ "$(st 3-eslint-collect)" != "0" ]] && record 3 1 "eslint collector failed"
  node "$HERE/compare.mjs" --current "$W/current" --only eslint --eslint-files "$W/eslint_files.txt"
  record 3 $? "eslint errors vs baseline (changed files + callers)"
else
  [[ "$(st 5-8-collect)" != "0" ]] && record 5 1 "collect.mjs failed"
  for c in eslint tsc webpack-dev webpack-prod karma-static karma jest; do
    out=$(node "$HERE/compare.mjs" --current "$W/current" --git-base "$BASE" --only "$c" ${ALLOW[@]+"${ALLOW[@]}"})
    rc=$?
    echo "$out" | grep -v '^RESULT'
    case "$c" in
      eslint) n=3 ;; tsc) n=5 ;; webpack-*) n=6 ;; karma*) n=7 ;; jest) n=8 ;;
    esac
    record "$n" $rc "$c vs baseline"
  done
fi

echo; echo "### summary ($MODE)"
printf '%s\n' "${SUMMARY[@]}"
if [[ "$MODE" == "full" ]]; then echo "(step 9 e2e: not automated — see PLAN.md G8)"; fi
if [[ $FAILED -eq 0 ]]; then echo "VERIFY: ALL GREEN"; else echo "VERIFY: FAILED"; fi
exit $FAILED
