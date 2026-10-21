#!/usr/bin/env bash
# The local compose setup mounts ./apps over the image, hiding the apps/packages/*/dist the
# image built. Without them ts-jest (and webpack) cannot resolve @sr/* packages. Build them
# once (gitignored output, in the target checkout) when missing. Host only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
eval "$(node "$HERE/lib/config_env.mjs")"
PACKAGES="$(dirname "$COFFEE_MONOLITH")/packages"
missing=0
if [[ -d "$PACKAGES" ]]; then
  for pkg in "$PACKAGES"/*/; do
    if grep -q '"build"' "$pkg/package.json" 2>/dev/null && [[ ! -d "$pkg/dist" ]]; then missing=1; fi
  done
fi
if [[ "$missing" == "1" || "${FORCE_BUILD_PACKAGES:-}" == "1" ]]; then
  echo "ensure_packages: building $PACKAGES (dist missing)" >&2
  "$HERE/sr_web.sh" yarn build:packages >&2
fi
