const env = process.env
const errors = []
const warnings = []

const value = (name) => String(env[name] || '').trim()
const required = (name) => {
  const v = value(name)
  if (!v) errors.push(`${name} is required`)
  return v
}
const httpsUrl = (name, { allowLocal = false } = {}) => {
  const raw = required(name)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(allowLocal && local)) errors.push(`${name} must use https`)
    return url.toString().replace(/\/$/, '')
  } catch {
    errors.push(`${name} must be a valid URL`)
    return ''
  }
}
const parsePostgresUrl = (name, raw, { requiredValue = true } = {}) => {
  if (!raw) {
    if (requiredValue) errors.push(`${name} is required`)
    return null
  }
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push(`${name} must use postgres:// or postgresql://`)
    if (!url.hostname) errors.push(`${name} must contain a database host`)
    if (!url.pathname || url.pathname === '/') errors.push(`${name} must contain a database name`)
    return url
  } catch {
    errors.push(`${name} must be a valid PostgreSQL URL`)
    return null
  }
}

const frontendUrl = httpsUrl('VITE_SUPABASE_URL')
const frontendKey = required('VITE_SUPABASE_ANON_KEY')
const authUrl = httpsUrl('EPD_AUTH_SUPABASE_URL')
const dataUrl = httpsUrl('EPD_DATA_SUPABASE_URL')
const dataKey = required('EPD_DATA_SUPABASE_PUBLIC_KEY')
const authMode = required('EPD_GATEWAY_AUTH_MODE')
const operatorMode = value('EPD_OPERATOR_MODE') || 'disabled'
const provider = value('EPD_OPERATOR_PROVIDER') || 'none'
const allowedOrigins = required('EPD_ALLOWED_ORIGINS')

if (authMode && authMode !== 'supabase') errors.push('Production EPD_GATEWAY_AUTH_MODE must be supabase')
if (!['disabled', 'sandbox'].includes(operatorMode)) errors.push('EPD_OPERATOR_MODE must be disabled or sandbox')
if (operatorMode === 'sandbox' && provider !== 'kontur') errors.push('Sandbox mode currently requires EPD_OPERATOR_PROVIDER=kontur')
if (operatorMode === 'disabled' && provider !== 'none' && provider !== 'kontur') warnings.push(`Unknown disabled provider: ${provider}`)

if (frontendUrl && authUrl && frontendUrl !== authUrl) warnings.push('VITE_SUPABASE_URL and EPD_AUTH_SUPABASE_URL differ; verify this is intentional')
if (authUrl && dataUrl && authUrl !== dataUrl) warnings.push('EPD_AUTH_SUPABASE_URL and EPD_DATA_SUPABASE_URL differ; verify Auth JWT and Data API share the expected trust boundary')

if (allowedOrigins) {
  const origins = allowedOrigins.split(',').map((x) => x.trim()).filter(Boolean)
  if (!origins.length) errors.push('EPD_ALLOWED_ORIGINS must contain at least one exact HTTPS origin')
  for (const origin of origins) {
    try {
      const u = new URL(origin)
      if (u.protocol !== 'https:') errors.push(`EPD_ALLOWED_ORIGINS entry must use https: ${origin}`)
      if (u.pathname !== '/' || u.search || u.hash) errors.push(`EPD_ALLOWED_ORIGINS entry must be an origin only: ${origin}`)
    } catch {
      errors.push(`Invalid EPD_ALLOWED_ORIGINS entry: ${origin}`)
    }
  }
  if (origins.includes('*')) errors.push('Wildcard CORS origin is forbidden')
}

const viteSecretPattern = /(service.?role|secret|private|kontur|operator.*token|access.?token|refresh.?token|jwt.?secret|database.?url|db.?url|backup.?pass|password)/i
const allViteSecrets = Object.entries(env).filter(([name, v]) => name.startsWith('VITE_') && viteSecretPattern.test(`${name}=${v}`))
if (allViteSecrets.length) errors.push(`Potential server secret exposed through VITE_*: ${allViteSecrets.map(([name]) => name).join(', ')}`)
if (/service[_-]?role/i.test(frontendKey) || /service[_-]?role/i.test(dataKey)) errors.push('Supabase service_role must not be used as frontend/data public key')

const maxBody = Number(value('EPD_MAX_BODY_BYTES') || 524288)
if (!Number.isFinite(maxBody) || maxBody < 1024 || maxBody > 2 * 1024 * 1024) errors.push('EPD_MAX_BODY_BYTES must be between 1 KiB and 2 MiB')

const rateWindow = Number(value('EPD_RATE_LIMIT_WINDOW_MS') || 60000)
const normalLimit = Number(value('EPD_RATE_LIMIT_MAX') || 60)
const authLimit = Number(value('EPD_AUTH_ATTEMPT_LIMIT_MAX') || 120)
const externalLimit = Number(value('EPD_EXTERNAL_RATE_LIMIT_MAX') || 10)
if (![rateWindow, normalLimit, authLimit, externalLimit].every(Number.isFinite)) errors.push('Rate limit variables must be numeric')
if (externalLimit > normalLimit) errors.push('EPD_EXTERNAL_RATE_LIMIT_MAX must not exceed EPD_RATE_LIMIT_MAX')
if (externalLimit > 30) warnings.push('External operator call limit is unusually high')

if (operatorMode === 'sandbox') {
  required('EPD_KONTUR_BOX_ID')
  required('EPD_KONTUR_ACCESS_TOKEN')
  if (!value('EPD_EXTERNAL_RATE_LIMIT_MAX')) warnings.push('Sandbox uses default external rate limit 10/min')
} else if (value('EPD_KONTUR_ACCESS_TOKEN')) {
  warnings.push('Kontur access token is present while operator mode is disabled; remove it from hosts that do not need sandbox access')
}

const dbUrl = parsePostgresUrl('EPD_DATABASE_URL', value('EPD_DATABASE_URL'))
const backupPassphrase = required('EPD_BACKUP_PASSPHRASE')
if (backupPassphrase && backupPassphrase.length < 20) errors.push('EPD_BACKUP_PASSPHRASE must contain at least 20 characters')
if (dbUrl?.password && backupPassphrase) {
  let dbPassword = dbUrl.password
  try { dbPassword = decodeURIComponent(dbPassword) } catch {}
  if (dbPassword && dbPassword === backupPassphrase) errors.push('Backup passphrase must differ from database password')
}
const retention = Number(value('EPD_BACKUP_RETENTION_DAYS') || 14)
if (!Number.isInteger(retention) || retention < 7 || retention > 365) errors.push('EPD_BACKUP_RETENTION_DAYS must be an integer between 7 and 365')
const backupDir = value('EPD_BACKUP_DIR') || '.backups'
if (['/', '.', '..'].includes(backupDir)) errors.push('EPD_BACKUP_DIR must be a dedicated backup directory')
const pgImage = value('EPD_POSTGRES_CLIENT_IMAGE') || 'postgres:17-alpine'
if (/:(latest)$/i.test(pgImage) || !pgImage.includes(':')) errors.push('EPD_POSTGRES_CLIENT_IMAGE must pin an explicit image tag')

const gatewayDbRaw = value('EPD_GATEWAY_DATABASE_URL')
const gatewayDbUrl = parsePostgresUrl('EPD_GATEWAY_DATABASE_URL', gatewayDbRaw, { requiredValue: false })
const gatewayDbRole = value('EPD_GATEWAY_DATABASE_ROLE') || 'epd_gateway_writer'
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(gatewayDbRole)) errors.push('EPD_GATEWAY_DATABASE_ROLE must be a safe PostgreSQL role name')
if (gatewayDbRole !== 'epd_gateway_writer') warnings.push('Gateway writer role differs from the repository default; verify matching DB grants/policies')
if (gatewayDbUrl && dbUrl) {
  const normalizeDb = (u) => `${u.protocol}//${u.username}@${u.hostname}:${u.port || '5432'}${u.pathname}`
  if (normalizeDb(gatewayDbUrl) === normalizeDb(dbUrl)) errors.push('EPD_GATEWAY_DATABASE_URL must use a separate restricted login, not EPD_DATABASE_URL/admin credential')
}
if (operatorMode === 'sandbox' && !gatewayDbUrl) warnings.push('Persistent operator-attempt journal is not configured; dedupe will not survive gateway restart')
const attemptStaleMs = Number(value('EPD_OPERATOR_ATTEMPT_STALE_MS') || 300000)
if (!Number.isFinite(attemptStaleMs) || attemptStaleMs < 60000 || attemptStaleMs > 3600000) errors.push('EPD_OPERATOR_ATTEMPT_STALE_MS must be between 60000 and 3600000')

const restoreUrlRaw = value('EPD_RESTORE_TEST_DATABASE_URL')
if (restoreUrlRaw) {
  try {
    const restoreUrl = new URL(restoreUrlRaw)
    if (!['postgres:', 'postgresql:'].includes(restoreUrl.protocol)) errors.push('EPD_RESTORE_TEST_DATABASE_URL must be PostgreSQL')
    if (dbUrl && restoreUrl.toString() === dbUrl.toString()) errors.push('Restore-test database must differ from EPD_DATABASE_URL')
    const restoreName = decodeURIComponent(restoreUrl.pathname.replace(/^\//, '')).toLowerCase()
    if (!/(test|restore|staging)/.test(restoreName)) errors.push('Restore-test database name must contain test, restore, or staging')
  } catch {
    errors.push('EPD_RESTORE_TEST_DATABASE_URL must be a valid PostgreSQL URL when provided')
  }
}

if (errors.length) {
  console.error('Deployment environment check FAILED')
  for (const error of errors) console.error(`- ERROR: ${error}`)
  for (const warning of warnings) console.error(`- WARN: ${warning}`)
  process.exit(1)
}

console.log('Deployment environment check OK')
console.log(`- auth: ${authMode}`)
console.log(`- operator mode: ${operatorMode}`)
console.log(`- provider: ${provider}`)
console.log(`- external operator limit: ${externalLimit}/${Math.round(rateWindow / 1000)}s`)
console.log(`- allowed origins: ${allowedOrigins}`)
console.log(`- encrypted database backups: configured, retention ${retention}d`)
console.log(`- persistent operator journal: ${gatewayDbUrl ? 'configured' : 'not configured'}`)
for (const warning of warnings) console.log(`- WARN: ${warning}`)
