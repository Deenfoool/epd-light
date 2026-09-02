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
requireAll('.gitignore', gitignore, ['.env\n', '.env.*', '!.env.example', '.backups', '.epd-light-migration.lock', '*.dump.enc', '*.dump.sha256'])

const dockerignore = await read('.dockerignore')
requireAll('.dockerignore', dockerignore, ['.git', '.env', '.env.*', 'node_modules', 'src/App.tsx', '.backups', '.epd-light-migration.lock', '*.dump.enc'])

const compose = await read('docker-compose.yml')
requireAll('docker-compose.yml', compose, [
  '"127.0.0.1:8080:8080"',
  'EPD_RELEASE: ${EPD_RELEASE:-0.1.0}',
  'EPD_BUILD_COMMIT: ${EPD_BUILD_COMMIT:-}',
  'EPD_BUILD_TIME: ${EPD_BUILD_TIME:-}',
  'EPD_DEPLOYMENT_MODE',
  'EPD_EXTERNAL_RATE_LIMIT_MAX',
  'EPD_DATA_SUPABASE_PUBLIC_KEY',
  'EPD_GATEWAY_DATABASE_URL',
  'EPD_GATEWAY_DATABASE_ROLE',
  'EPD_OPERATOR_ATTEMPT_STALE_MS',
  'EPD_KONTUR_ACCESS_TOKEN',
  'expose:',
  '- "8787"',
])
for (const forbidden of ['"8080:8080"', '"0.0.0.0:8080:8080"', '"8787:8787"']) {
  if (compose.includes(forbidden)) fail(`unsafe published port found: ${forbidden}`)
}

const nginx = await read('deploy', 'nginx-compose.conf')
requireAll('nginx security headers', nginx, [
  'Content-Security-Policy', "default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'",
  "connect-src 'self' https: wss:", 'Cross-Origin-Opener-Policy "same-origin"',
  'proxy_set_header Authorization $http_authorization', 'proxy_set_header X-Real-IP $remote_addr',
  'proxy_set_header X-Forwarded-For $remote_addr', 'expires 1y;', 'expires -1;',
])
if (nginx.includes('add_header Cache-Control')) fail('location Cache-Control add_header would break inherited server security headers')

const caddy = await read('deploy', 'Caddyfile.example')
requireAll('Caddyfile.example', caddy, [
  'reverse_proxy 127.0.0.1:8080',
  'Strict-Transport-Security',
  'Content-Security-Policy',
  'Cross-Origin-Opener-Policy',
  'max_size 1MB',
])

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day.sh', serverDay, [
  'scripts/check-deployment-env.mjs',
  'scripts/preflight-runtime.mjs',
  'scripts/test-build-info.mjs',
  'scripts/test-dependency-check.mjs',
  'scripts/test-readiness.mjs',
  'scripts/check-runtime-dependencies.mjs',
  'Production dependency smoke check',
  'scripts/test-web-security.mjs',
  'scripts/test-operator-attempt-repository.mjs',
  'scripts/test-operator-attempt-client.mjs',
  'scripts/test-idempotency.mjs',
  'scripts/test-billing-foundation.mjs',
  'BUILD_COMMIT=',
  'git rev-parse --verify HEAD',
  'EPD_BUILD_COMMIT="$BUILD_COMMIT"',
  'EPD_BUILD_TIME="$BUILD_TIME"',
  '/api/system/version',
  '"traceableBuild":true',
  'runtime version does not match deployment source',
  'persistentAttemptJournal',
  '/api/system/readiness',
  '"productionBaselineReady":true',
  '"traceableRuntimeBuild":true',
  '"legalReadinessClaimed":false',
  '"sensitiveValuesIncluded":false',
  'Content-Security-Policy:',
  'docker compose --env-file',
  'externalSendEnabled',
  '127.0.0.1:8080',
])

const buildInfo = await read('server', 'build-info.mjs')
requireAll('runtime build info', buildInfo, [
  'EPD_RELEASE', 'EPD_BUILD_COMMIT', 'EPD_BUILD_TIME',
  'traceableBuild:', 'shortCommit:', 'sensitiveValuesIncluded: false',
])
for (const forbidden of ['EPD_DATABASE_URL', 'EPD_KONTUR_ACCESS_TOKEN', 'EPD_BILLING_DATABASE_URL']) {
  if (buildInfo.includes(forbidden)) fail(`build info module must not read secret env: ${forbidden}`)
}

const dependencyCheck = await read('server', 'dependency-check.mjs')
requireAll('runtime dependency check', dependencyCheck, [
  'gatewayAuthConfigFromEnv',
  'supabaseDocumentRepositoryConfigFromEnv',
  '/auth/v1/.well-known/jwks.json',
  '/rest/v1/billing_plans',
  'auth_jwks_no_asymmetric_keys',
  'data_api_billing_plans_missing',
  'sensitiveValuesIncluded: false',
  'safeDependencyFailure',
])
for (const forbidden of ['console.log', 'console.error', 'response.text()', 'JSON.stringify(env)', 'publicApiKey: repositoryConfig.publicApiKey']) {
  if (dependencyCheck.includes(forbidden)) fail(`dependency check module may expose sensitive runtime details: ${forbidden}`)
}
const dependencyScript = await read('scripts', 'check-runtime-dependencies.mjs')
requireAll('dependency smoke script', dependencyScript, [
  'checkRuntimeDependencies',
  'safeDependencyFailure',
  'response bodies, URLs and credentials are intentionally not printed',
])

const backup = await read('deploy', 'backup-postgres.sh')
requireAll('backup-postgres.sh', backup, [
  'EPD_DATABASE_URL', 'EPD_BACKUP_PASSPHRASE', 'pg_dump --format=custom',
  'openssl enc -aes-256-cbc', '-pbkdf2', '-iter 200000', 'verify-postgres-backup.sh',
  'EPD_BACKUP_RETENTION_DAYS', 'contains_passphrase=false', '.epd-light-backup.lock',
  'PGDATABASE="$EPD_DATABASE_URL" pg_dump', '-e EPD_DATABASE_URL',
])
if (backup.includes('-e EPD_DATABASE_URL="$DB_URL"') || backup.includes('pg_dump') && backup.includes('"$EPD_DATABASE_URL"\'')) {
  fail('backup script must not place database URL in docker/pg_dump argv')
}
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

const migrations = await read('deploy', 'apply-migrations.sh')
requireAll('apply-migrations.sh', migrations, [
  'EPD_MIGRATION_CONFIRM', 'APPLY_MIGRATIONS', '.epd-light-migration.lock',
  'Pre-migration encrypted backup', 'Post-migration encrypted backup',
  'public.epd_light_schema_migrations', 'applied migration checksum changed',
  '--single-transaction', 'revoke all on public.epd_light_schema_migrations from anon, authenticated',
  'PGDATABASE="$EPD_DATABASE_URL" exec psql', '-e EPD_DATABASE_URL',
])
if (migrations.includes('-e EPD_DATABASE_URL="$DB_URL"') || migrations.includes('psql "$DB_URL"')) {
  fail('migration runner must not place database URL in docker/psql argv')
}

const billingMigration = await read('supabase', 'migrations', '202609020001_billing_foundation.sql')
requireAll('billing foundation migration', billingMigration, [
  'create table if not exists public.billing_plans',
  'create table if not exists public.subscriptions',
  'create table if not exists public.billing_usage_monthly',
  "values ('default', false, 14)",
  'after insert on public.documents',
  'grant select on public.subscriptions to authenticated',
])

const writerMigration = await read('supabase', 'migrations', '202609020002_gateway_writer_role.sql')
requireAll('gateway writer migration', writerMigration, [
  'create role epd_gateway_writer nologin noinherit',
  'grant select, insert, update on public.operator_attempts to epd_gateway_writer',
  'revoke delete on public.operator_attempts from epd_gateway_writer',
  'operator_attempts_gateway_insert',
  'operator_attempts_gateway_update',
])
if (/create\s+role\s+epd_gateway_writer\s+login/i.test(writerMigration)) fail('gateway capability role must remain NOLOGIN')

const readiness = await read('server', 'readiness.mjs')
requireAll('technical readiness', readiness, [
  'technicalReadinessOnly: true',
  'legalReadinessClaimed: false',
  'productionBaselineReady: Object.values(checks).every(Boolean)',
  'traceableRuntimeBuild: traceableBuild',
  'sensitiveValuesIncluded: false',
  'operatorProductionSendDisabled: true',
  'billingFailClosed',
])

const gateway = await read('server', 'index.mjs')
requireAll('system runtime routes', gateway, [
  "url.pathname === '/api/system/version'",
  '...publicBuildInfo',
  "url.pathname === '/api/system/readiness'",
  'buildInfo: publicBuildInfo',
])

const envExample = await read('.env.example')
requireAll('.env.example', envExample, [
  'EPD_RELEASE=0.1.0',
  '# EPD_BUILD_COMMIT=',
  '# EPD_BUILD_TIME=',
  'EPD_DEPLOYMENT_MODE=local',
  'EPD_DEPLOYMENT_MODE=production',
  'EPD_GATEWAY_AUTH_MODE=disabled',
  'EPD_DATA_SUPABASE_PUBLIC_KEY=',
  'EPD_GATEWAY_DATABASE_URL=',
  'EPD_GATEWAY_DATABASE_ROLE=epd_gateway_writer',
  'EPD_OPERATOR_ATTEMPT_STALE_MS=300000',
  'EPD_EXTERNAL_RATE_LIMIT_MAX=10',
  'EPD_OPERATOR_MODE=sandbox',
  'EPD_KONTUR_ACCESS_TOKEN=',
  'EPD_DATABASE_URL=',
  'EPD_BACKUP_RETENTION_DAYS=14',
  'EPD_BACKUP_PASSPHRASE=',
  'EPD_RESTORE_TEST_DATABASE_URL=',
])

const pkg = JSON.parse(await read('package.json'))
for (const script of ['deploy:server-day', 'deploy:dependencies:check', 'db:migrate', 'backup:create', 'backup:verify', 'backup:restore:test', 'attempt-repository:test', 'attempt-client:test', 'billing:test', 'build-info:test', 'dependency:test', 'readiness:test', 'web-security:test']) {
  if (!pkg.scripts?.[script]) fail(`package script missing: ${script}`)
}
if (pkg.dependencies?.pg !== '8.23.0') fail('root pg dependency must stay pinned to 8.23.0')
const serverPkg = JSON.parse(await read('server', 'package.json'))
if (serverPkg.dependencies?.pg !== '8.23.0') fail('gateway pg dependency must stay pinned to 8.23.0')
for (const [section, dependencies] of Object.entries({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} })) {
  for (const [name, version] of Object.entries(dependencies)) {
    if (/^[~^*]|\s|\|\||>|</.test(String(version))) fail(`${section}.${name} must use a pinned direct version, found ${version}`)
  }
}

console.log('Deploy preflight OK: private JWKS/Data API dependency smoke-check, traceable runtime commit/version, production readiness, CSP/header inheritance, safe journals, guarded migrations, billing fail-closed, loopback binding, HTTPS edge and encrypted recovery safeguards verified')
