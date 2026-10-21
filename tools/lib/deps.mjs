// Loads the repo-pinned `coffeescript` (1.12.7) and `typescript` packages.
//
// - In the sr_web container (`yarn node ...`) they resolve through the target's Yarn PnP,
//   requested on behalf of the target app (createRequire on its package.json).
// - On the host the target has no installed deps; they fall back to this repo's gitignored
//   copy created by `tools/setup_host.sh` (.host-deps/node_modules).
import { createRequire } from 'node:module'
import path from 'node:path'
import { HOST_DEPS_DIR, MONOLITH } from './paths.mjs'

const requireFromTarget = createRequire(path.join(MONOLITH, 'package.json'))
const requireHere = createRequire(import.meta.url)
const HOST_DEPS = path.join(HOST_DEPS_DIR, 'node_modules')

function load(name) {
  const errors = []
  const attempts = [
    ['target', () => requireFromTarget(name)],
    ['host-deps', () => requireHere(path.join(HOST_DEPS, name))],
  ]
  for (const [label, attempt] of attempts) {
    try {
      return attempt()
    } catch (e) {
      errors.push(`${label}: ${e.code || e.message}`)
    }
  }
  throw new Error(
    `Cannot load "${name}".\n  ${errors.join('\n  ')}\n` +
      'On the host run: tools/setup_host.sh\n' +
      'In the container run the script with `yarn node` (tools/sr_web.sh).',
  )
}

let coffee
export function loadCoffee() {
  if (!coffee) {
    coffee = load('coffeescript')
    if (coffee.VERSION !== '1.12.7') {
      throw new Error(`Expected coffeescript 1.12.7, got ${coffee.VERSION}`)
    }
  }
  return coffee
}

let ts
export function loadTs() {
  if (!ts) ts = load('typescript')
  return ts
}
