import fs from 'node:fs'
import path from 'node:path'
import { SRC, rel } from './paths.mjs'

export const CODE_EXT = /\.(coffee|js|jsx|mjs|cjs|ts|tsx)$/
export const TEMPLATE_EXT = /\.(eco|ejs)$/

/** Every file under src/ (monolith-relative), excluding node_modules. Works without git (container). */
export function listSrcFiles() {
  const out = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else out.push(rel(p))
    }
  }
  walk(SRC)
  return out.sort()
}

export function isVendor(f) {
  return f.startsWith('src/vendor/')
}

export function isKarmaSpec(f) {
  return f.startsWith('src/DEPRECATED_spec/') && /spec\.(js|coffee)$/.test(f)
}

export function isKarma(f) {
  return f.startsWith('src/DEPRECATED_spec/')
}

export function isJestTest(f) {
  return !isKarma(f) && (/\/__tests__\//.test(f) || /\.(test|spec)\.[jt]sx?$/.test(f))
}

export function isTestSupport(f) {
  return !isKarma(f) && (/\/__mocks__\//.test(f) || f.startsWith('src/jest_helpers/'))
}

export function langOf(f) {
  if (f.endsWith('.coffee')) return 'coffee'
  if (/\.tsx?$/.test(f)) return 'ts'
  if (TEMPLATE_EXT.test(f)) return 'template'
  return 'js'
}

/** coarse role of a file, used to group importers */
export function roleOf(f) {
  if (isKarma(f)) return 'karma'
  if (isJestTest(f)) return 'jest'
  if (isTestSupport(f)) return 'test-support'
  return langOf(f)
}
