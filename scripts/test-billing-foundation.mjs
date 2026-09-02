import { readFile } from 'node:fs/promises'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const migration = await readFile('supabase/migrations/202609020001_billing_foundation.sql', 'utf8')
const pricing = await readFile('src/App.tsx', 'utf8')
const billing = await readFile('src/billing.ts', 'utf8')
const app = pricing
const appCompact = app.replace(/\s+/g, '')

for (const snippet of [
  "('start', 'Старт', 990, 50",
  "('business', 'Бизнес', 2490, 500",
  "('team', 'Команда', 4990, 2000",
  "values ('default', false, 14)",
  'create table if not exists public.subscriptions',
  'create table if not exists public.billing_usage_monthly',
  'after insert on public.documents',
  'security definer',
  "message = 'billing_document_limit_reached'",
  'auth.uid() is not null and new.user_id <> auth.uid()',
  'grant select on public.subscriptions to authenticated',
  'grant select on public.billing_usage_monthly to authenticated',
]) assert(migration.includes(snippet), `billing migration missing invariant: ${snippet}`)

for (const forbidden of [
  'grant insert on public.subscriptions to authenticated',
  'grant update on public.subscriptions to authenticated',
  'grant delete on public.subscriptions to authenticated',
  'grant insert on public.billing_usage_monthly to authenticated',
  'grant update on public.billing_usage_monthly to authenticated',
]) assert(!migration.includes(forbidden), `browser must not receive billing write permission: ${forbidden}`)

assert(migration.includes('if plan_limit is null or not enforcement then'), 'usage must still be counted while enforcement is disabled')
assert(migration.includes("sub_status = 'trialing'"), 'trial state must be validated before enforcement')
assert(migration.includes("sub_status = 'active'"), 'active subscription state must be validated before enforcement')
assert(migration.includes('deleting a document does not refund quota'), 'quota semantics must be documented')

for (const snippet of ['990 ₽', '2 490 ₽', '4 990 ₽', 'до 50 новых черновиков', 'до 500 новых черновиков', 'до 2000 новых черновиков']) {
  assert(appCompact.includes(snippet.replace(/\s+/g, '')), `pricing UI drifted from billing catalogue: ${snippet}`)
}
for (const snippet of [
  "code: 'start'", 'monthly_price_rub: 990', "code: 'business'", 'monthly_price_rub: 2490', "code: 'team'", 'monthly_price_rub: 4990',
  'currentBillingPeriodStart', ".eq('period_start', periodStart).maybeSingle()",
]) assert(billing.includes(snippet), `billing client invariant missing: ${snippet}`)
assert(!billing.includes(".order('period_start', { ascending: false }).limit(1)"), 'billing UI must not show previous-month usage as current usage')

for (const snippet of [
  "'/app/billing'", 'function BillingPage()', 'Тариф и лимиты', 'billingErrorMessage',
  'Лимиты пока не блокируют', 'Деньги сейчас не списываются',
]) assert(appCompact.includes(snippet.replace(/\s+/g, '')), `billing app UI invariant missing: ${snippet}`)

console.log('Billing foundation test OK: catalogue, trial, current-month usage, DB enforcement and browser read-only boundaries verified')
