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
requireAll('.gitignore', gitignore, ['.env\n', '.env.*', '!.env.example', '.backups', '*.dump.enc', '*.dump.sha256'])

const dockerignore = await read('.dockerignore')
requireAll('.dockerignore', dockerignore, ['.git', '.env', '.env.*', 'node_modules', 'src/App.tsx', '.backups', '*.dump.enc'])

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

const backup = await read('deploy', 'backup-postgres.sh')
requireAll('backup-postgres.sh', backup, [
  'EPD_DATABASE_URL', 'EPD_BACKUP_PASSPHRASE', 'pg_dump --format=custom',
  'openssl enc -aes-256-cbc', '-pbkdf2', '-iter 200000', 'verify-postgres-backup.sh',
  'EPD_BACKUP_RETENTION_DAYS', 'contains_passphrase=false',
])
if (backup.includes('echo "$DB_URL"') || backup.includes('echo "$PASSPHRASE"')) fail('backup script must never print database URL or backup passphrase')

const verifyBackup = await read('deploy', 'verify-postgres-backup.sh')
requireAll('verify-postgres-backup.sh', verifyBackup, [
  'sha256sum -c', 'openssl enc -d -aes-256-cbc', 'pg_restore --list', 'trap cleanup',
])

const restoreTest = await read('deploy', 'test-restore-postgres.sh')
requireAll('test-restore-postgres.sh', restoreTest, [
  'EPD_RESTORE_TEST_CONFIRM', 'RESTORE_TEST_ONLY', 'restore test URL matches EPD_DATABASE_URL',
  'test database name must contain test, restore, or staging', 'pg_restore --clean --if-exists',
  "to_regclass('public.documents')", "to_regclass('public.profiles')",
])

const envExample = await read('.env.example')
requireAll('.env.example', envExample, [
  'EPD_GATEWAY_AUTH_MODE=disabled',
  'EPD_DATA_SUPABASE_PUBLIC_KEY=',
  'EPD_EXTERNAL_RATE_LIMIT_MAX=10',
  'EPD_OPERATOR_MODE=sandbox',
  'EPD_KONTUR_ACCESS_TOKEN=',
  'EPD_DATABASE_URL=',
  'EPD_BACKUP_RETENTION_DAYS=14',
  'EPD_BACKUP_PASSPHRASE=',
  'EPD_RESTORE_TEST_DATABASE_URL=',
])

const pkg = JSON.parse(await read('package.json'))
for (const script of ['deploy:server-day', 'backup:create', 'backup:verify', 'backup:restore:test']) {
  if (!pkg.scripts?.[script]) fail(`package script missing: ${script}`)
}
for (const [section, dependencies] of Object.entries({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} })) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (/^[~^*]|\s|\|\||>|</.test(String(version))) fail(`${section}.${name} must use a pinned direct version, found ${version}`)
  }
}

console.log('Deploy preflight OK: env/backups ignored, loopback binding, private gateway, HTTPS template, encrypted backup/restore safeguards and pinned dependencies verified')
