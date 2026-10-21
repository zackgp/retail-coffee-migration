// Prints the resolved configuration as shell exports for the bash tools:
//   eval "$(node "$HERE/lib/config_env.mjs")"
// Host only (inside the container sr_web.sh sets the COFFEE_* variables itself).
import {
  APP_DIR,
  BASE_REF,
  CONFIG,
  CONTAINER,
  DATA_DIR,
  HOST_DEPS_DIR,
  MONOLITH,
  REPO_ROOT,
  TOOLS_DIR,
  TOOLS_ROOT,
  WORK_DIR,
  toContainer,
} from './paths.mjs'

const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`

const vars = {
  COFFEE_TARGET_NAME: CONFIG.name || 'target',
  COFFEE_TOOLS_ROOT: TOOLS_ROOT,
  COFFEE_TOOLS_DIR: TOOLS_DIR,
  COFFEE_TARGET_REPO: REPO_ROOT,
  COFFEE_APP_DIR: APP_DIR,
  COFFEE_MONOLITH: MONOLITH,
  COFFEE_DATA_DIR: DATA_DIR,
  COFFEE_WORK_DIR: WORK_DIR,
  COFFEE_HOST_DEPS: HOST_DEPS_DIR,
  COFFEE_BASE_REF: BASE_REF,
  COFFEE_COMPOSE_FILES: CONTAINER.composeFiles.join(':'),
  COFFEE_SERVICE: CONTAINER.service,
  COFFEE_PROJECT_NAME: CONTAINER.projectName,
  COFFEE_TOOLS_MOUNT: CONTAINER.toolsMount,
  COFFEE_C_REPO: CONTAINER.repo,
  COFFEE_C_MONOLITH: CONTAINER.monolith,
  COFFEE_C_TOOLS: CONTAINER.tools,
  COFFEE_C_DATA_DIR: toContainer(DATA_DIR),
  COFFEE_C_WORK_DIR: toContainer(WORK_DIR),
}

for (const [k, v] of Object.entries(vars)) console.log(`export ${k}=${q(v)}`)
