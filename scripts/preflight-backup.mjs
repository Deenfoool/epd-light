import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`BACKUP PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}
const shellSyntax = (...parts) => {
  try { execFileSync('sh', ['-n', path.join(root, ...parts)], { stdio: 'pipe' }) }
  catch { fail(`shell syntax invalid: ${parts.join('/')}`) }
}

shellSyntax('deploy', 'check-backup-readiness.sh')
shellSyntax('deploy', 'backup-postgres.sh')
shellSyntax('deploy', 'verify-postgres-backup.sh')
shellSyntax('deploy', 'test-restore-postgres.sh')

const readiness = await read('deploy', 'check-backup-readiness.sh')
requireAll('backup readiness checker', readiness, [
  'ENV_FILE="${1:-}"',
  'read_env_value()',
  'strip_outer_quotes()',
  'EPD_BACKUP_DIR',
  'EPD_BACKUP_PASSPHRASE',
  'EPD_BACKUP_MAX_AGE_HOURS',
  'EPD_POSTGRES_CLIENT_IMAGE',
  'must be between 1 and 168',
  'epd-light-*.dump.enc',
  'newest backup has no SHA-256 sidecar',
  'newest verified backup is stale',
  'verify-postgres-backup.sh',
  'passed SHA-256/decryption/pg_restore verification',
])
for (const forbidden of [
  'source "$ENV_FILE"',
  '. "$ENV_FILE"',
  'eval ',
  'echo "$PASSPHRASE"',
  'printf \'%s\' "$PASSPHRASE"',
]) {
  if (readiness.includes(forbidden)) fail(`backup readiness checker contains unsafe env/secret pattern: ${forbidden}`)
}

const verifier = await read('deploy', 'verify-postgres-backup.sh')
requireAll('backup verifier', verifier, [
  'sha256sum -c',
  'openssl enc -d -aes-256-cbc',
  '-pbkdf2',
  '-iter 200000',
  'pg_restore --list',
  'trap cleanup',
])

const envExample = await read('.env.example')
requireAll('.env.example backup freshness', envExample, [
  'EPD_BACKUP_RETENTION_DAYS=14',
  'EPD_BACKUP_MAX_AGE_HOURS=30',
  'EPD_BACKUP_PASSPHRASE=',
])

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day backup gate', serverDay, [
  '== Production backup readiness ==',
  'sh "$ROOT_DIR/deploy/check-backup-readiness.sh" "$ENV_FILE"',
  '== Production dependency smoke check ==',
])
if (serverDay.indexOf('== Production backup readiness ==') > serverDay.indexOf('== Production dependency smoke check ==')) {
  fail('backup readiness must run before network dependency smoke and Docker build')
}
if (serverDay.indexOf('== Production backup readiness ==') > serverDay.indexOf('== Build and start ==')) {
  fail('backup readiness must run before Docker build/start')
}

const pkg = JSON.parse(await read('package.json'))
if (pkg.scripts?.['backup:readiness'] !== 'sh deploy/check-backup-readiness.sh') {
  fail('package script backup:readiness must point to deploy/check-backup-readiness.sh')
}
if (!String(pkg.scripts?.preflight || '').includes('preflight-backup.mjs')) {
  fail('npm run preflight must include preflight-backup.mjs')
}

console.log('Backup preflight OK: shell syntax, freshness threshold, encrypted archive checksum/decryption/pg_restore verification and secret-safe env parsing verified')
