import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`SOURCE PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}

try { execFileSync('sh', ['-n', path.join(root, 'deploy', 'server-day.sh')], { stdio: 'pipe' }) }
catch { fail('deploy/server-day.sh shell syntax invalid') }

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day source traceability', serverDay, [
  'git rev-parse --is-inside-work-tree',
  'git status --porcelain --untracked-files=normal',
  'production checkout is dirty',
  'git rev-parse --verify HEAD',
  'full traceable git commit',
  'RELEASE="$(awk -F',
  'package.json version is missing or invalid',
  'EPD_RELEASE="$RELEASE"',
  'EPD_BUILD_COMMIT="$BUILD_COMMIT"',
  'EPD_BUILD_TIME="$BUILD_TIME"',
  '"release":"$RELEASE"',
  '"commit":"$BUILD_COMMIT"',
])
for (const forbidden of [
  'BUILD_COMMIT="${EPD_BUILD_COMMIT:-',
  'RELEASE="${EPD_RELEASE:-',
  'EPD_ALLOW_DIRTY',
]) {
  if (serverDay.includes(forbidden)) fail(`server-day contains traceability bypass: ${forbidden}`)
}

const pkg = JSON.parse(await read('package.json'))
const packageVersion = String(pkg.version || '')
if (!/^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  fail(`package.json version is not release-safe: ${packageVersion || '<empty>'}`)
}
if (!String(pkg.scripts?.preflight || '').includes('preflight-source.mjs')) {
  fail('npm run preflight must include preflight-source.mjs')
}

const buildInfo = await read('server', 'build-info.mjs')
requireAll('build info boundary', buildInfo, [
  'EPD_RELEASE',
  'EPD_BUILD_COMMIT',
  'EPD_BUILD_TIME',
  'traceableBuild:',
  'sensitiveValuesIncluded: false',
])

console.log(`Source preflight OK: clean git checkout, package release ${packageVersion}, commit/build metadata and runtime version matching are fail-closed`)
