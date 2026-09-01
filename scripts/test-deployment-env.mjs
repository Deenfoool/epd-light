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
  EPD_RATE_LIMIT_WINDOW_MS: '60000',
  EPD_RATE_LIMIT_MAX: '60',
  EPD_AUTH_ATTEMPT_LIMIT_MAX: '120',
  EPD_EXTERNAL_RATE_LIMIT_MAX: '10',
  EPD_DATABASE_URL: 'postgresql://epd:database-password@db.example.ru:5432/epd_light',
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
assert(sandboxGood.status === 0, `complete sandbox env must pass: ${sandboxGood.stderr}`)

console.log('Deployment env test OK: auth/CORS/VITE secrets/rate limits, encrypted backups, restore isolation and sandbox credentials verified')
