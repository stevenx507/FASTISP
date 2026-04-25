/**
 * audit_api.mjs
 * Extracts all apiClient.METHOD('/endpoint') calls from the frontend
 * and dumps a sorted unique list for cross-referencing with backend routes.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, extname } from 'path'

function walk(dir) {
  let files = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) files = files.concat(walk(full))
    else if (['.tsx', '.ts'].includes(extname(full))) files.push(full)
  }
  return files
}

const RE = /apiClient\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"?]+)/g
const calls = new Set()

for (const file of walk('src')) {
  const src = readFileSync(file, 'utf-8')
  let m
  while ((m = RE.exec(src)) !== null) {
    // normalise template literals: strip ${...}
    const path = m[2].replace(/\$\{[^}]*\}/g, ':id')
    calls.add(`${m[1].toUpperCase().padEnd(7)} ${path}`)
  }
}

const sorted = [...calls].sort()
const out = sorted.join('\n')
writeFileSync('frontend_api_calls.txt', out)
console.log(out)
console.log(`\nTotal unique endpoints: ${sorted.length}`)
