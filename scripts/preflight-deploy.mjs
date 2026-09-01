import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`DEPLOY PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}

const gitignore = await read('.gitignore')
requireAll('.gitignore', gitignore, ['.env\n', '.env.*', '!.env.example'])

const dockerignore = await read('.dockerignore')
requireAll('.dockerignore', dockerignore, ['.git', '.env', '.env.*', 'node_modules', 'src/App.tsx'])

const compose = await read('docker-compose.yml')
requireAll('docker-compose.yml', compose, [
  '"127.0.0.1:8080:8080"',
  'EPD_EXTERNAL_RATE_LIMIT_MAX',
  'EPD_DATA_SUPABASE_PUBLIC_KEY',
  'EPD_KONTUR_ACCESS_TOKEN',
  'expose:',
  '- "8787"',
])
for (const forbidden of ['"8080:8080"', '"0.0.0.0:8080:8080"', '"8787:8787"']) {
  if (compose.includes(forbidden)) fail(`unsafe published port found: ${forbidden}`)
}

const caddy = await read('deploy', 'Caddyfile.example')
requireAll('Caddyfile.example', caddy, [
  'reverse_proxy 127.0.0.1:8080',
  'Strict-Transport-Security',
  'max_size 1MB',
])

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day.sh', serverDay, [
  'scripts/check-deployment-env.mjs',
  'scripts/preflight.mjs',
  'docker compose --env-file',
  'externalSendEnabled',
  '127.0.0.1:8080',
])

const envExample = await read('.env.example')
requireAll('.env.example', envExample, [
  'EPD_GATEWAY_AUTH_MODE=disabled',
  'EPD_DATA_SUPABASE_PUBLIC_KEY=',
  'EPD_EXTERNAL_RATE_LIMIT_MAX=10',
  'EPD_OPERATOR_MODE=sandbox',
  'EPD_KONTUR_ACCESS_TOKEN=',
])

const pkg = JSON.parse(await read('package.json'))
for (const [section, dependencies] of Object.entries({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} })) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (/^[~^*]|\s|\|\||>|</.test(String(version))) fail(`${section}.${name} must use a pinned direct version, found ${version}`)
  }
}

console.log('Deploy preflight OK: env secrets ignored, loopback binding, private gateway, HTTPS proxy template and pinned direct dependencies verified')
