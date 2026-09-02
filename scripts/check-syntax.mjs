import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

async function filesBelow(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return filesBelow(fullPath, extension)
      return entry.isFile() && entry.name.endsWith(extension) ? [fullPath] : []
    }),
  )
  return nested.flat()
}

function run(command, args, file) {
  const result = spawnSync(command, [...args, file], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const modules = [
  ...(await filesBelow('server', '.mjs')),
  ...(await filesBelow('scripts', '.mjs')),
].sort()
const shellScripts = (await filesBelow('deploy', '.sh')).sort()

for (const file of modules) run(process.execPath, ['--check'], file)
for (const file of shellScripts) run('sh', ['-n'], file)

console.log(
  `Syntax check OK: ${modules.length} modules and ${shellScripts.length} shell scripts verified.`,
)
