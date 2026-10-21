// Paths for the guardrail jest tests/helpers of the retail-coffee-migration repo. These files
// run inside the target's jest (sr_web container, mounted at <app dir>/coffee-tools by
// tools/sr_web.sh), so the target app dir comes from COFFEE_MONOLITH (or jest's cwd), and data
// files are read from this repo's dataDir (config.json + config.local.json; COFFEE_DATA_DIR wins).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const TOOLS_ROOT = path.resolve(__dirname, '../..')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error(`${file}: ${e.message}`)
  }
}

const config = { ...(readJson(path.join(TOOLS_ROOT, 'config.json')) || {}), ...(readJson(path.join(TOOLS_ROOT, 'config.local.json')) || {}) }

export const MONOLITH = path.resolve(process.env.COFFEE_MONOLITH || process.cwd())
export const SRC = path.join(MONOLITH, 'src')
export const DATA_DIR = process.env.COFFEE_DATA_DIR || path.resolve(TOOLS_ROOT, config.dataDir || 'data')
export const SHAPES_DIR = path.join(DATA_DIR, 'shapes')

if (!fs.existsSync(path.join(MONOLITH, 'webpack.config.js'))) {
  throw new Error(`tool_paths: ${MONOLITH} is not the target app dir (run jest through tools/sr_web.sh)`)
}

/** git's blob id of a file's bytes (what `git rev-parse <rev>:<path>` prints). */
export function gitBlobSha(buf) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex')
}
