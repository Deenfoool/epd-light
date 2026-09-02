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
const ledgerMigration = await readFile('supabase/migrations/202609020003_billing_payment_events.sql', 'utf8')
const entitlementMigration = await readFile('supabase/migrations/202609020004_billing_entitlement_function.sql', 'utf8')
const repository = await readFile('server/repositories/billing-events.mjs', 'utf8')

for (const snippet of [
  'create table if not exists public.billing_payment_events',
  "event_status in ('received','verified','applied','ignored','failed')",
  'payload_sha256',
  'billing_payment_events_provider_event_unique unique',
  'grant select on public.billing_payment_events to authenticated',
  'create role epd_billing_writer nologin noinherit',
  'grant select, insert, update on public.billing_payment_events to epd_billing_writer',
]) assert(ledgerMigration.includes(snippet), `billing payment ledger migration missing invariant: ${snippet}`)

for (const snippet of [
  'create or replace function public.apply_verified_billing_entitlement',
  'security definer',
  'set search_path = pg_catalog, public',
  "v_event.event_status <> 'verified'",
  "v_event.plan_code is distinct from p_plan_code",
  "status = 'active'",
  "event_status = 'applied'",
  'grant execute on function public.apply_verified_billing_entitlement',
  'revoke update on public.subscriptions from epd_billing_writer',
  'revoke update on public.billing_payment_events from epd_billing_writer',
  'drop policy if exists subscriptions_billing_writer_update',
  'drop policy if exists billing_payment_events_writer_update',
]) assert(entitlementMigration.includes(snippet), `billing entitlement migration missing invariant: ${snippet}`)

for (const forbidden of [
  'grant insert on public.billing_payment_events to authenticated',
  'grant update on public.billing_payment_events to authenticated',
  'grant delete on public.billing_payment_events to authenticated',
  'create role epd_billing_writer login',
  'raw_payload', 'raw_webhook', 'card_number', 'cvv',
]) assert(!ledgerMigration.toLowerCase().includes(forbidden.toLowerCase()), `unsafe billing migration pattern: ${forbidden}`)

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
assert(status.directSubscriptionUpdateAllowed === false, 'billing runtime must not allow direct subscription update')
assert(status.entitlementDatabaseFunctionRequired === true, 'verified-event DB function must be mandatory')
assert(JSON.stringify(status).includes('secret') === false, 'billing repository status must not expose connection string')

for (const snippet of [
  "set local role ${config.writerRole}",
  'public.apply_verified_billing_entitlement(',
  "if (existing.eventStatus !== 'verified')",
  'on conflict (provider, provider_event_id) do nothing',
  'billing_event_identity_conflict',
  'directSubscriptionUpdateAllowed: false',
]) assert(repository.includes(snippet), `billing repository missing transaction/idempotency invariant: ${snippet}`)

for (const forbidden of [
  'update public.subscriptions',
  "set event_status='applied'",
  'console.log(config.connectionString)',
  'rawWebhookPayload',
  'cardNumber',
  'cvv',
  'request.body',
]) assert(!repository.includes(forbidden), `billing repository may bypass DB boundary or expose sensitive value: ${forbidden}`)

const caps = billingPublicCapabilities(billingConfigFromEnv({ EPD_BILLING_PROVIDER: 'none' }))
assert(caps.checkoutEnabled === false && caps.webhookEnabled === false, 'billing public capabilities must stay fail-closed')

console.log('Billing payment boundary test OK: verified-event ledger, DB-enforced entitlement function, restricted writer and fail-closed payment policy verified')
