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

const allViteSecrets = Object.entries(env).filter(([name, v]) => name.startsWith('VITE_') && /(service.?role|secret|private|kontur|operator.*token|access.?token|refresh.?token|jwt.?secret)/i.test(`${name}=${v}`))
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
} else {
  if (value('EPD_KONTUR_ACCESS_TOKEN')) warnings.push('Kontur access token is present while operator mode is disabled; remove it from hosts that do not need sandbox access')
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
for (const warning of warnings) console.log(`- WARN: ${warning}`)
