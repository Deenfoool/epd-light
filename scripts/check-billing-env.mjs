const env = process.env
const errors = []
const warnings = []
const value = (name) => String(env[name] || '').trim()

const parseDb = (name, raw) => {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push(`${name} must use postgres:// or postgresql://`)
    if (!url.username || !url.hostname || !url.pathname || url.pathname === '/') errors.push(`${name} must include user, host and database`)
    return url
  } catch {
    errors.push(`${name} must be a valid PostgreSQL URL`)
    return null
  }
}

const provider = value('EPD_BILLING_PROVIDER') || 'none'
if (provider !== 'none') errors.push('EPD_BILLING_PROVIDER must remain none until a verified provider adapter/webhook implementation exists')

const billingUrl = parseDb('EPD_BILLING_DATABASE_URL', value('EPD_BILLING_DATABASE_URL'))
const adminUrl = parseDb('EPD_DATABASE_URL', value('EPD_DATABASE_URL'))
const operatorUrl = parseDb('EPD_GATEWAY_DATABASE_URL', value('EPD_GATEWAY_DATABASE_URL'))
const billingRole = value('EPD_BILLING_DATABASE_ROLE') || 'epd_billing_writer'

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(billingRole)) errors.push('EPD_BILLING_DATABASE_ROLE must be a safe PostgreSQL role name')
if (billingRole !== 'epd_billing_writer') errors.push('EPD_BILLING_DATABASE_ROLE must remain epd_billing_writer until billing capability grants are deliberately changed')

const credentialIdentity = (url) => url ? `${url.username}@${url.hostname}:${url.port || '5432'}${url.pathname}` : ''
if (billingUrl && adminUrl && credentialIdentity(billingUrl) === credentialIdentity(adminUrl)) {
  errors.push('EPD_BILLING_DATABASE_URL must use a separate restricted login, not EPD_DATABASE_URL/admin credential')
}
if (billingUrl && operatorUrl && credentialIdentity(billingUrl) === credentialIdentity(operatorUrl)) {
  errors.push('EPD_BILLING_DATABASE_URL must use a separate restricted login, not EPD_GATEWAY_DATABASE_URL/operator credential')
}

if (billingUrl && provider === 'none') warnings.push('Billing DB writer is configured but payment provider remains disabled; no payment route/webhook should use it yet')
if (!billingUrl) warnings.push('Billing restricted DB writer is not configured; this is expected until payment provider integration begins')

if (errors.length) {
  console.error('Billing environment check FAILED')
  for (const error of errors) console.error(`- ERROR: ${error}`)
  for (const warning of warnings) console.error(`- WARN: ${warning}`)
  process.exit(1)
}

console.log('Billing environment check OK')
console.log(`- provider: ${provider}`)
console.log(`- restricted writer: ${billingUrl ? 'configured' : 'not configured'}`)
console.log('- real money enabled: false')
for (const warning of warnings) console.log(`- WARN: ${warning}`)
