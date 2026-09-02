import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`BILLING PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}

const migration = await read('supabase', 'migrations', '202609020003_billing_payment_events.sql')
requireAll('payment event migration', migration, [
  'create table if not exists public.billing_payment_events',
  'constraint billing_payment_events_provider_event_unique unique (provider, provider_event_id)',
  'payload_sha256',
  "event_status in ('received','verified','applied','ignored','failed')",
  'grant select on public.billing_payment_events to authenticated',
  'create policy billing_payment_events_own_read',
  'create role epd_billing_writer nologin noinherit',
  'grant select, insert, update on public.billing_payment_events to epd_billing_writer',
  'revoke delete on public.billing_payment_events from epd_billing_writer',
])
if (/grant\s+(?:insert|update|delete).*billing_payment_events\s+to\s+authenticated/i.test(migration)) {
  fail('browser must never receive payment-event write permission')
}
if (/create\s+role\s+epd_billing_writer\s+login/i.test(migration)) fail('billing capability role must remain NOLOGIN')

const repository = await read('server', 'repositories', 'billing-events.mjs')
requireAll('billing repository', repository, [
  'EPD_BILLING_DATABASE_URL',
  "EPD_BILLING_DATABASE_ROLE || 'epd_billing_writer'",
  'set local role ${config.writerRole}',
  'claimVerifiedEvent',
  "values ($1,$2,$3,$4,'verified'",
  'on conflict (provider, provider_event_id) do nothing',
  'applyVerifiedEntitlement',
  "billingEvent.eventStatus !== 'verified'",
  "status='active'",
  "event_status='applied'",
  'rawWebhookPayloadStored: false',
  'cardDataStored: false',
  'secretsStored: false',
  'verifiedEventRequiredForEntitlement: true',
])
for (const forbidden of ['console.log(config.connectionString)', 'rawWebhookPayload', 'cardNumber', 'cvv']) {
  if (repository.includes(forbidden)) fail(`billing repository contains forbidden sensitive pattern: ${forbidden}`)
}

const browserClient = await read('src', 'billing-events.ts')
requireAll('billing history client', browserClient, [
  "from('billing_payment_events')",
  '.select(SAFE_PAYMENT_EVENT_COLUMNS)',
  "'provider'", "'event_type'", "'event_status'", "'plan_code'", "'amount_kopecks'", "'currency'", "'safe_error_code'", "'created_at'", "'processed_at'",
])
for (const forbidden of ['provider_event_id', 'payload_sha256', 'user_id', '.insert(', '.update(', '.upsert(', '.delete(']) {
  if (browserClient.includes(forbidden)) fail(`billing history browser client contains forbidden field/write: ${forbidden}`)
}

const app = await read('src', 'app-chunks', 'App.29.part')
requireAll('billing history UI', app, [
  'История платежных событий',
  'listBillingPaymentEvents(20)',
  'billingPaymentEventStatusLabel',
  'Success redirect никогда не считается доказательством оплаты',
])
if (app.includes('provider_event_id') || app.includes('payload_sha256')) fail('billing UI must not render provider identifiers or payload hashes')

const billingPolicy = await read('server', 'billing.mjs')
requireAll('billing policy', billingPolicy, [
  "provider: 'none'",
  'realMoneyEnabled: false',
  'browserCanSetPrice: false',
  'browserCanSetUserId: false',
  'successRedirectProvesPayment: false',
  'verifiedWebhookRequired: true',
  'serverOwnedEntitlementWriteRequired: true',
])

const envCheck = await read('scripts', 'check-billing-env.mjs')
requireAll('billing env checker', envCheck, [
  "EPD_BILLING_PROVIDER') || 'none'",
  "provider !== 'none'",
  'EPD_BILLING_DATABASE_URL',
  'EPD_BILLING_DATABASE_ROLE',
  'separate restricted login',
  'real money enabled: false',
])

const envExample = await read('.env.example')
requireAll('.env.example billing', envExample, [
  'EPD_BILLING_PROVIDER=none',
  'EPD_BILLING_DATABASE_URL=',
  'EPD_BILLING_DATABASE_ROLE=epd_billing_writer',
])

const compose = await read('docker-compose.yml')
requireAll('docker-compose billing', compose, [
  'EPD_BILLING_PROVIDER: ${EPD_BILLING_PROVIDER:-none}',
  'EPD_BILLING_DATABASE_URL: ${EPD_BILLING_DATABASE_URL:-}',
  'EPD_BILLING_DATABASE_ROLE: ${EPD_BILLING_DATABASE_ROLE:-epd_billing_writer}',
])

const serverDay = await read('deploy', 'server-day.sh')
requireAll('server-day billing', serverDay, [
  'scripts/check-billing-env.mjs',
  'scripts/preflight-billing.mjs',
  'scripts/test-billing-env.mjs',
  'scripts/test-billing-payment-boundary.mjs',
  'scripts/test-billing-payment-client.mjs',
  'Billing provider must remain disabled',
])

const pkg = JSON.parse(await read('package.json'))
for (const script of ['billing:test', 'billing-payment:test', 'billing-payment-client:test', 'billing-env:test']) {
  if (!pkg.scripts?.[script]) fail(`package script missing: ${script}`)
}

console.log('Billing preflight OK: payment event ledger, restricted writer, verified-event entitlement boundary, safe browser history and disabled provider policy verified')
