import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const roots = ['apps', 'packages']
const extensions = new Set(['.ts', '.tsx', '.css'])
const hardLimit = 300
const warningLimit = 200
const warnings = []
const failures = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
      continue
    }
    if (!extensions.has(extname(entry.name))) continue
    const lines = (await readFile(path, 'utf8')).split('\n').length
    const record = `${relative(process.cwd(), path)} (${lines} lines)`
    if (lines > hardLimit) failures.push(record)
    else if (lines > warningLimit) warnings.push(record)
  }
}

for (const root of roots) await walk(root)
for (const warning of warnings) console.warn(`File-size warning: ${warning}`)
if (failures.length > 0) {
  throw new Error(`Source file hard limit exceeded:\n${failures.join('\n')}`)
}
