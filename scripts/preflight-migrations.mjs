import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`MIGRATION PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}

const expectedMigrations = [
  '202609010001_init.sql',
  '202609010002_extend_directories_t1.sql',
  '202609010003_operator_attempts.sql',
  '202609020001_billing_foundation.sql',
  '202609020002_gateway_writer_role.sql',
  '202609020003_billing_payment_events.sql',
  '202609020004_billing_entitlement_function.sql',
  '202609020005_billing_payment_event_column_privileges.sql',
]
const actualMigrations = (await readdir(path.join(root, 'supabase', 'migrations')))
  .filter((name) => name.endsWith('.sql'))
  .sort()
if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) {
  fail(`unexpected migration set: ${actualMigrations.join(', ')}`)
}

const checker = await read('deploy', 'check-migrations.sh')
requireAll('migration status checker', checker, [
  'ENV_FILE="${1:-}"',
  'read_env_value()',
  'strip_outer_quotes()',
  'EPD_DATABASE_URL',
  'EPD_POSTGRES_CLIENT_IMAGE',
  'unsafe EPD_POSTGRES_CLIENT_IMAGE',
  'sha256sum',
  'public.epd_light_schema_migrations',
  'production DB is missing migration',
  'production migration checksum differs from checkout',
  'select count(*) from public.epd_light_schema_migrations',
  'migration set mismatch: checkout=$LOCAL_COUNT database=$DB_COUNT',
  'Refusing to deploy code against a DB with missing or extra registered migrations.',
  'exactly match production registry and SHA-256 checksums',
  '-e EPD_DATABASE_URL',
  'PGDATABASE="$EPD_DATABASE_URL" exec psql',
])
for (const forbidden of [
  'source "$ENV_FILE"',
  '. "$ENV_FILE"',
  'eval ',
  'psql "$DB_URL"',
  '-e EPD_DATABASE_URL="$DB_URL"',
  'echo "$DB_URL"',
]) {
  if (checker.includes(forbidden)) fail(`migration status checker contains unsafe env/secret pattern: ${forbidden}`)
}

const runner = await read('deploy', 'apply-migrations.sh')
requireAll('guarded migration runner', runner, [
  'EPD_MIGRATION_CONFIRM',
  'APPLY_MIGRATIONS',
  'public.epd_light_schema_migrations',
  'applied migration checksum changed',
  '--single-transaction',
  'Pre-migration encrypted backup',
  'Post-migration encrypted backup',
])

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day migration gate', serverDay, [
  '== Production migration registry check ==',
  'sh "$ROOT_DIR/deploy/check-migrations.sh" "$ENV_FILE"',
  '== Production dependency smoke check ==',
])
if (serverDay.indexOf('== Production migration registry check ==') > serverDay.indexOf('== Production dependency smoke check ==')) {
  fail('migration registry check must run before network dependency smoke and Docker build')
}
if (serverDay.indexOf('== Production migration registry check ==') > serverDay.indexOf('== Build and start ==')) {
  fail('migration registry check must run before Docker build/start')
}

const pkg = JSON.parse(await read('package.json'))
if (pkg.scripts?.['db:migrations:check'] !== 'sh deploy/check-migrations.sh') {
  fail('package script db:migrations:check must point to deploy/check-migrations.sh')
}
if (!String(pkg.scripts?.preflight || '').includes('preflight-migrations.mjs')) {
  fail('npm run preflight must include preflight-migrations.mjs')
}

const ci = await read('.github', 'workflows', 'ci.yml')
requireAll('CI migration checker syntax', ci, [
  'node --check scripts/preflight-migrations.mjs',
  'sh -n deploy/check-migrations.sh',
])

console.log('Migration preflight OK: exact 8-file registry, SHA-256 drift detection, rollback protection and secret-safe production checker verified')
