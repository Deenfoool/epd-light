import { spawnSync } from 'node:child_process'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const base = {
  PATH: process.env.PATH || '',
  VITE_SUPABASE_URL: 'https://db.example.ru',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  EPD_GATEWAY_AUTH_MODE: 'supabase',
  EPD_AUTH_SUPABASE_URL: 'https://db.example.ru',
  EPD_DATA_SUPABASE_URL: 'https://db.example.ru',
  EPD_DATA_SUPABASE_PUBLIC_KEY: 'public-anon-key',
  EPD_ALLOWED_ORIGINS: 'https://epd.example.ru',
  EPD_OPERATOR_MODE: 'disabled',
  EPD_OPERATOR_PROVIDER: 'none',
  EPD_GATEWAY_DATABASE_ROLE: 'epd_gateway_writer',
  EPD_OPERATOR_ATTEMPT_STALE_MS: '300000',
  EPD_RATE_LIMIT_WINDOW_MS: '60000',
  EPD_RATE_LIMIT_MAX: '60',
  EPD_AUTH_ATTEMPT_LIMIT_MAX: '120',
  EPD_EXTERNAL_RATE_LIMIT_MAX: '10',
  EPD_DATABASE_URL: 'postgresql://epd_admin:database-password@db.example.ru:5432/epd_light',
  EPD_BACKUP_DIR: '.backups',
  EPD_BACKUP_RETENTION_DAYS: '14',
  EPD_BACKUP_PASSPHRASE: 'backup-passphrase-separate-12345',
  EPD_POSTGRES_CLIENT_IMAGE: 'postgres:17-alpine',
}

const run = (overrides = {}) => spawnSync(process.execPath, ['scripts/check-deployment-env.mjs'], {
  env: { ...base, ...overrides },
  encoding: 'utf8',
})

const good = run()
assert(good.status === 0, `safe production env must pass: ${good.stderr}`)
assert(good.stdout.includes('Deployment environment check OK'), 'success output missing')
assert(good.stdout.includes('encrypted database backups: configured'), 'backup readiness output missing')
assert(good.stdout.includes('persistent operator journal: not configured'), 'optional journal status output missing')

const badAuth = run({ EPD_GATEWAY_AUTH_MODE: 'disabled' })
assert(badAuth.status !== 0 && badAuth.stderr.includes('must be supabase'), 'production auth disabled must fail')

const wildcardCors = run({ EPD_ALLOWED_ORIGINS: '*' })
assert(wildcardCors.status !== 0, 'wildcard CORS must fail')

const leakedVite = run({ VITE_OPERATOR_ACCESS_TOKEN: 'super-secret' })
assert(leakedVite.status !== 0 && leakedVite.stderr.includes('Potential server secret exposed through VITE_*'), 'VITE secret exposure must fail')
const leakedDb = run({ VITE_DATABASE_URL: 'postgresql://user:password@db/production' })
assert(leakedDb.status !== 0 && leakedDb.stderr.includes('Potential server secret exposed through VITE_*'), 'database URL in VITE_* must fail')

const badLimits = run({ EPD_EXTERNAL_RATE_LIMIT_MAX: '100', EPD_RATE_LIMIT_MAX: '20' })
assert(badLimits.status !== 0 && badLimits.stderr.includes('must not exceed'), 'external limit above normal limit must fail')

const weakBackupPass = run({ EPD_BACKUP_PASSPHRASE: 'short' })
assert(weakBackupPass.status !== 0 && weakBackupPass.stderr.includes('at least 20'), 'weak backup passphrase must fail')
const reusedDbPassword = run({ EPD_BACKUP_PASSPHRASE: 'database-password' })
assert(reusedDbPassword.status !== 0 && reusedDbPassword.stderr.includes('differ from database password'), 'backup passphrase reused as DB password must fail')
const badRetention = run({ EPD_BACKUP_RETENTION_DAYS: '2' })
assert(badRetention.status !== 0 && badRetention.stderr.includes('between 7 and 365'), 'unsafe retention must fail')
const dangerousBackupDir = run({ EPD_BACKUP_DIR: '/' })
assert(dangerousBackupDir.status !== 0 && dangerousBackupDir.stderr.includes('dedicated backup directory'), 'root backup directory must fail')
const latestPgImage = run({ EPD_POSTGRES_CLIENT_IMAGE: 'postgres:latest' })
assert(latestPgImage.status !== 0 && latestPgImage.stderr.includes('explicit image tag'), 'latest postgres image must fail')

const reusedGatewayCredential = run({ EPD_GATEWAY_DATABASE_URL: base.EPD_DATABASE_URL })
assert(reusedGatewayCredential.status !== 0 && reusedGatewayCredential.stderr.includes('separate restricted login'), 'gateway must not reuse migration/backup DB credential')
const invalidGatewayRole = run({
  EPD_GATEWAY_DATABASE_URL: 'postgresql://epd_gateway:writer-password@db.example.ru:5432/epd_light',
  EPD_GATEWAY_DATABASE_ROLE: 'epd_gateway_writer;drop role x',
})
assert(invalidGatewayRole.status !== 0 && invalidGatewayRole.stderr.includes('safe PostgreSQL role name'), 'unsafe gateway role name must fail')
const badStaleWindow = run({ EPD_OPERATOR_ATTEMPT_STALE_MS: '1000' })
assert(badStaleWindow.status !== 0 && badStaleWindow.stderr.includes('between 60000 and 3600000'), 'unsafe attempt stale window must fail')
const restrictedGatewayDb = run({ EPD_GATEWAY_DATABASE_URL: 'postgresql://epd_gateway:writer-password@db.example.ru:5432/epd_light' })
assert(restrictedGatewayDb.status === 0, `separate restricted gateway DB credential should pass: ${restrictedGatewayDb.stderr}`)
assert(restrictedGatewayDb.stdout.includes('persistent operator journal: configured'), 'configured journal status missing')

const sameRestoreDb = run({ EPD_RESTORE_TEST_DATABASE_URL: base.EPD_DATABASE_URL })
assert(sameRestoreDb.status !== 0 && sameRestoreDb.stderr.includes('must differ'), 'restore-test DB must never equal production DB')
const safeRestoreDb = run({ EPD_RESTORE_TEST_DATABASE_URL: 'postgresql://epd:test-password@db.example.ru:5432/epd_restore_test' })
assert(safeRestoreDb.status === 0, `safe restore-test DB should pass: ${safeRestoreDb.stderr}`)

const sandboxMissing = run({ EPD_OPERATOR_MODE: 'sandbox', EPD_OPERATOR_PROVIDER: 'kontur' })
assert(sandboxMissing.status !== 0 && sandboxMissing.stderr.includes('EPD_KONTUR_BOX_ID'), 'sandbox without Kontur credentials must fail')

const sandboxGood = run({
  EPD_OPERATOR_MODE: 'sandbox',
  EPD_OPERATOR_PROVIDER: 'kontur',
  EPD_KONTUR_BOX_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  EPD_KONTUR_ACCESS_TOKEN: 'server-only-token',
})
assert(sandboxGood.status === 0, `complete sandbox env without optional persistent journal must pass: ${sandboxGood.stderr}`)
assert(sandboxGood.stdout.includes('dedupe will not survive gateway restart'), 'sandbox without persistent journal must warn')

const sandboxPersistent = run({
  EPD_OPERATOR_MODE: 'sandbox',
  EPD_OPERATOR_PROVIDER: 'kontur',
  EPD_KONTUR_BOX_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  EPD_KONTUR_ACCESS_TOKEN: 'server-only-token',
  EPD_GATEWAY_DATABASE_URL: 'postgresql://epd_gateway:writer-password@db.example.ru:5432/epd_light',
})
assert(sandboxPersistent.status === 0, `sandbox with restricted persistent journal must pass: ${sandboxPersistent.stderr}`)
assert(!sandboxPersistent.stdout.includes('dedupe will not survive gateway restart'), 'persistent sandbox should not emit restart-dedupe warning')

console.log('Deployment env test OK: auth/CORS/VITE secrets/rate limits, encrypted backups, restricted journal DB, restore isolation and sandbox credentials verified')
