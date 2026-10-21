/* eslint-disable import/no-commonjs, no-console */
// Runs the target app's real webpack config through the Node API and writes a stats
// subset that always contains entrypoints/chunks/modules, regardless of the config's
// SILENT/production stats preset. Used by collect.mjs (G6/G8 step 6). Container only.
//
//   yarn node <tools>/webpack_stats.cjs <out.json>     (NODE_ENV selects dev/prod; cwd or
//                                                      COFFEE_MONOLITH = the app dir)
'use strict'

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const outArg = process.argv[2]
if (!outArg) {
  console.error('usage: webpack_stats.cjs <out.json>')
  process.exit(2)
}
const out = path.resolve(outArg)
const MONOLITH = path.resolve(process.env.COFFEE_MONOLITH || process.cwd())
process.chdir(MONOLITH)
const appRequire = createRequire(path.join(MONOLITH, 'package.json'))
const webpack = appRequire('webpack')
const config = require(path.join(MONOLITH, 'webpack.config.js'))

const t0 = Date.now()
webpack(config, (err, stats) => {
  if (err) {
    console.error(err.stack || err)
    process.exit(1)
  }
  const json = stats.toJson({
    all: false,
    entrypoints: true,
    chunks: true,
    chunkModules: false,
    modules: true,
    nestedModules: true,
    ids: true,
    errors: true,
    warnings: true,
    errorDetails: false,
  })
  fs.writeFileSync(out, JSON.stringify(json))
  console.log(
    `webpack ${config.mode}: ${json.modules.length} modules, ${json.errors.length} errors, ${json.warnings.length} warnings in ${Math.round((Date.now() - t0) / 1000)}s`,
  )
  // let plugins (e.g. CleanBuildPlugin's async move) finish before exiting
  process.exitCode = stats.hasErrors() ? 1 : 0
})
