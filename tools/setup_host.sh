#!/usr/bin/env bash
# One-time host setup for this tools repo:
#   1. installs the two packages the host-side tools need (coffeescript 1.12.7 + typescript,
#      versions matching the target's yarn.lock) into the gitignored .host-deps/. The sr_web
#      container does not need them: there the tools resolve the target's deps through PnP.
#   2. keeps the container mount point (<appDir>/<toolsMount>, an empty dir docker creates on
#      the host) out of the target's git status via its info/exclude (local, never committed).
# Re-run after changing targetRepo (e.g. a new worktree).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")"

npm install --no-save --no-package-lock --prefix "$COFFEE_HOST_DEPS" \
  coffeescript@1.12.7 typescript@5.7.2
node -e "const p=process.argv[1];console.log('coffeescript', require(p+'/node_modules/coffeescript').VERSION, '/ typescript', require(p+'/node_modules/typescript').version)" "$COFFEE_HOST_DEPS"

EXCLUDE="$(git -C "$COFFEE_TARGET_REPO" rev-parse --path-format=absolute --git-path info/exclude)"
LINE="/$COFFEE_APP_DIR/$COFFEE_TOOLS_MOUNT/"
mkdir -p "$(dirname "$EXCLUDE")"
touch "$EXCLUDE"
if ! grep -qxF "$LINE" "$EXCLUDE"; then
  printf '\n# retail-coffee-migration: container mount point for the tools repo\n%s\n' "$LINE" >> "$EXCLUDE"
  echo "added $LINE to $EXCLUDE"
else
  echo "$LINE already in $EXCLUDE"
fi
