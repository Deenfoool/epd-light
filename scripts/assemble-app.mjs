import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = path.join(root, 'src', 'app-chunks')
const parts = (await readdir(partsDir)).filter((name) => name.endsWith('.part')).sort()
if (!parts.length) throw new Error('App source parts not found')
const source = (await Promise.all(parts.map((name) => readFile(path.join(partsDir, name), 'utf8')))).join('')
await writeFile(path.join(root, 'src', 'App.tsx'), source)
console.log(`Assembled src/App.tsx from ${parts.length} source parts`)
