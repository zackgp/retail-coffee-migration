#!/usr/bin/env bash
# Runs a command in a one-off sr_web container of the TARGET checkout (config.json targetRepo),
# preserving argument quoting. `sr-dev run ...` passes its arguments to docker compose unquoted,
# which breaks things like `sh -c '...'`, so the migration tools use this instead.
#
#   tools/sr_web.sh yarn jest src/sagamore/views
#   tools/sr_web.sh sh -c 'yarn eslint src/foo.js && yarn jest src/foo'
#
# Working directory in the container is the app dir (/sr/apps/monolith). This repo is mounted
# at <app dir>/<toolsMount> (default /sr/apps/monolith/coffee-tools): inside the Yarn workspace
# folder, so PnP resolves the target's dependencies for our scripts and jest picks up
# coffee-tools/jest/tests, while `jest ./src`, `eslint src` and tsc never look there.
#
# The container has no git (a worktree's .git points outside the mount); compute file lists on
# the host and pass them in through the work dir.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")"

cd "$COFFEE_TARGET_REPO"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$COFFEE_PROJECT_NAME}"
if [[ "$COMPOSE_PROJECT_NAME" == "$(basename "$COFFEE_TARGET_REPO")" ]]; then
  echo "sr_web.sh: refusing to use compose project '$COMPOSE_PROJECT_NAME' (shared with the main checkout)." >&2
  echo "Set container.projectName in config.local.json (or COMPOSE_PROJECT_NAME) to something unique, e.g. sr-coffee." >&2
  exit 2
fi
export COMPOSE_FILE="$COFFEE_COMPOSE_FILES"
export SR_DB_SHARDING_HOSTS="${SR_DB_SHARDING_HOSTS:-}"

# Docker creates the bind-mount target on the host as an empty directory. If it has content,
# somebody put real files there (or the mount leaked); refuse rather than shadow them.
MOUNT_HOST="$COFFEE_MONOLITH/$COFFEE_TOOLS_MOUNT"
if [[ -d "$MOUNT_HOST" ]] && [[ -n "$(ls -A "$MOUNT_HOST" 2>/dev/null)" ]]; then
  echo "sr_web.sh: $MOUNT_HOST is not empty; it is the mount point for this tools repo." >&2
  echo "Move its contents away (and keep it out of git) before running the tools." >&2
  exit 2
fi

mkdir -p "$COFFEE_WORK_DIR"

# The container is one-off (--rm): keep corepack's yarn download and jest's transform cache in
# the mounted, gitignored work dir so repeated runs are not cold. (Not apps/monolith/tmp:
# production builds move that whole directory to public/.)
exec docker compose run --rm -T \
  -v "$COFFEE_TOOLS_ROOT:$COFFEE_C_TOOLS" \
  -w "$COFFEE_C_MONOLITH" \
  -e COFFEE_IN_CONTAINER=1 \
  -e "COFFEE_REPO_ROOT=$COFFEE_C_REPO" \
  -e "COFFEE_MONOLITH=$COFFEE_C_MONOLITH" \
  -e "COFFEE_TOOLS_ROOT=$COFFEE_C_TOOLS" \
  -e "COFFEE_WORK_DIR=$COFFEE_C_WORK_DIR" \
  -e "COFFEE_DATA_DIR=$COFFEE_C_DATA_DIR" \
  -e "COREPACK_HOME=$COFFEE_C_WORK_DIR/corepack" \
  -e "JEST_CACHE_DIR=$COFFEE_C_WORK_DIR/jest-cache" \
  "$COFFEE_SERVICE" "$@"
