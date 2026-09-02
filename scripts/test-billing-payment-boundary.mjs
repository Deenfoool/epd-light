import { readFile } from 'node:fs/promises'
import {
  BILLING_PAYMENT_POLICY,
  billingConfigFromEnv,
  billingPublicCapabilities,
  validateBillingCheckoutRequest,
} from '../server/billing.mjs'
import {
  billingEventRepositoryConfigFromEnv,
  billingEventRepositoryStatus,
  validateVerifiedBillingEvent,
} from '../server/repositories/billing-events.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const migration = await readFile('supabase/migrations/202609020003_billing_payment_events.sql', 'utf8')
const repository = await readFile('server/repositories/billing-events.mjs', 'utf8')

for (const snippet of [
  'create table if not exists public.billing_payment_events',
  "event_status in ('received','verified','applied','ignored','failed')",
  'payload_sha256',
  'billing_payment_events_provider_event_unique unique',
  'grant select on public.billing_payment_events to authenticated',
  'create role epd_billing_writer nologin noinherit',
  'grant select, update on public.subscriptions to epd_billing_writer',
  'grant select, insert, update on public.billing_payment_events to epd_billing_writer',
  'revoke insert, delete on public.subscriptions from epd_billing_writer',
]) assert(migration.includes(snippet), `billing payment migration missing invariant: ${snippet}`)

for (const forbidden of [
  'grant insert on public.billing_payment_events to authenticated',
  'grant update on public.billing_payment_events to authenticated',
  'grant delete on public.billing_payment_events to authenticated',
  'create role epd_billing_writer login',
  'raw_payload', 'raw_webhook', 'card_number', 'cvv',
]) assert(!migration.toLowerCase().includes(forbidden.toLowerCase()), `unsafe billing migration pattern: ${forbidden}`)

assert(BILLING_PAYMENT_POLICY.browserCanActivateSubscription === false, 'browser must not activate subscription')
assert(BILLING_PAYMENT_POLICY.successRedirectAuthoritative === false, 'success redirect must never prove payment')
assert(BILLING_PAYMENT_POLICY.verifiedWebhookRequiredForActivation === true, 'verified webhook must be required')
assert(BILLING_PAYMENT_POLICY.realMoneyEnabled === false, 'real money must remain disabled')
assert(BILLING_PAYMENT_POLICY.webhookRouteImplemented === false, 'public webhook route must stay absent until provider verification exists')

assert(validateBillingCheckoutRequest({ planCode: 'business' }).ok === true, 'paid plan should validate')
assert(validateBillingCheckoutRequest({ planCode: 'trial' }).ok === false, 'trial must not be purchasable')
assert(validateBillingCheckoutRequest({ planCode: 'business', price: 1 }).error === 'billing_checkout_payload_rejected', 'browser price override must be rejected')
assert(validateBillingCheckoutRequest({ planCode: 'team', userId: 'other' }).ok === false, 'browser userId override must be rejected')

const event = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  provider: 'provider_test',
  providerEventId: 'evt_123',
  eventType: 'payment.succeeded',
  planCode: 'start',
  amountKopecks: 99000,
  currency: 'RUB',
  payloadSha256: 'a'.repeat(64),
}
assert(validateVerifiedBillingEvent(event).ok === true, 'valid verified billing event should pass')
assert(validateVerifiedBillingEvent({ ...event, payloadSha256: 'raw-json' }).ok === false, 'raw payload must not replace hash')
assert(validateVerifiedBillingEvent({ ...event, planCode: 'trial' }).ok === false, 'verified paid event must target a paid plan')

const cfg = billingEventRepositoryConfigFromEnv({
  EPD_BILLING_DATABASE_URL: 'postgresql://billing:secret@db.example.ru:5432/epd_light',
  EPD_BILLING_DATABASE_ROLE: 'epd_billing_writer',
})
const status = billingEventRepositoryStatus(cfg)
assert(status.configured === true, 'billing repository should recognize restricted config')
assert(status.rawWebhookPayloadStored === false && status.cardDataStored === false && status.secretsStored === false, 'billing repository capabilities must stay metadata-only')
assert(JSON.stringify(status).includes('secret') === false, 'billing repository status must not expose connection string')

for (const snippet of [
  "set local role ${config.writerRole}",
  "event_status='applied'",
  "if (billingEvent.eventStatus !== 'verified')",
  "status='active'",
  'on conflict (provider, provider_event_id) do nothing',
  'billing_event_identity_conflict',
]) assert(repository.includes(snippet), `billing repository missing transaction/idempotency invariant: ${snippet}`)

for (const forbidden of ['console.log(config.connectionString)', 'rawWebhookPayload', 'cardNumber', 'cvv', 'request.body']) {
  assert(!repository.includes(forbidden), `billing repository may expose sensitive value: ${forbidden}`)
}

const caps = billingPublicCapabilities(billingConfigFromEnv({ EPD_BILLING_PROVIDER: 'none' }))
assert(caps.checkoutEnabled === false && caps.webhookEnabled === false, 'billing public capabilities must stay fail-closed')

console.log('Billing payment boundary test OK: verified-event ledger, restricted writer, idempotency and fail-closed payment policy verified')
