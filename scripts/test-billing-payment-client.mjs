import { readFile } from 'node:fs/promises'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const source = await readFile(new URL('../src/billing-events.ts', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/app-chunks/App.29.part', import.meta.url), 'utf8')

for (const required of [
  "from('billing_payment_events')",
  '.select(SAFE_PAYMENT_EVENT_COLUMNS)',
  "'provider'",
  "'event_type'",
  "'event_status'",
  "'plan_code'",
  "'amount_kopecks'",
  "'currency'",
  "'safe_error_code'",
  "'created_at'",
  "'processed_at'",
]) assert(source.includes(required), `payment history client missing safe field/invariant: ${required}`)

for (const forbidden of [
  'provider_event_id',
  'payload_sha256',
  'user_id',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
]) assert(!source.includes(forbidden), `payment history client must not expose/write sensitive/server-owned field: ${forbidden}`)

for (const required of [
  'История платежных событий',
  'listBillingPaymentEvents(20)',
  'billingPaymentEventStatusLabel',
  'данные карты',
  'Success redirect никогда не считается доказательством оплаты',
]) assert(app.includes(required), `billing UI missing payment history invariant: ${required}`)

assert(!app.includes('provider_event_id'), 'billing UI must not render provider event id')
assert(!app.includes('payload_sha256'), 'billing UI must not render payload hash')

console.log('Billing payment client test OK: browser reads only safe own-event metadata and cannot write payment state')
