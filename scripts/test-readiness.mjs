import { buildTechnicalReadiness } from '../server/readiness.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const billingClosed = {
  provider: 'none',
  checkoutEnabled: false,
  webhookEnabled: false,
  realMoneyEnabled: false,
  successRedirectAuthoritative: false,
  directRuntimeSubscriptionUpdateAllowed: false,
  entitlementDatabaseFunctionRequired: true,
}

const production = buildTechnicalReadiness({
  authConfig: { deploymentMode: 'production', mode: 'supabase', supabaseUrl: 'https://secret-project.example.ru' },
  documentRepositoryStatus: { configured: true, publicKey: 'secret-key' },
  operatorMode: 'disabled',
  operatorProvider: 'none',
  sandboxReady: false,
  operatorAttemptJournalStatus: { configured: false, connectionString: 'postgresql://secret' },
  billingCapabilities: billingClosed,
  allowedOriginsCount: 1,
})
assert(production.productionBaselineReady === true, 'safe production baseline should be ready')
assert(production.technicalReadinessOnly === true && production.legalReadinessClaimed === false, 'readiness must not claim legal readiness')
assert(production.operator.productionSendEnabled === false, 'readiness must keep production send disabled')
assert(production.billing.realMoneyEnabled === false, 'readiness must keep real money disabled')
assert(production.sensitiveValuesIncluded === false, 'readiness must declare secret-free output')
const serialized = JSON.stringify(production)
for (const forbidden of ['secret-project', 'secret-key', 'postgresql://secret', 'supabaseUrl', 'publicKey', 'connectionString']) {
  assert(!serialized.includes(forbidden), `readiness leaked sensitive/config value: ${forbidden}`)
}

const local = buildTechnicalReadiness({
  authConfig: { deploymentMode: 'local', mode: 'disabled' },
  documentRepositoryStatus: { configured: false },
  operatorMode: 'disabled',
  operatorProvider: 'none',
  billingCapabilities: billingClosed,
  allowedOriginsCount: 0,
})
assert(local.productionBaselineReady === false, 'local demo must not report production baseline ready')
assert(local.checks.productionMode === false && local.checks.jwtJwksAuth === false, 'local readiness flags wrong')

const sandboxNotReady = buildTechnicalReadiness({
  authConfig: { deploymentMode: 'production', mode: 'supabase' },
  documentRepositoryStatus: { configured: true },
  operatorMode: 'sandbox',
  operatorProvider: 'kontur',
  sandboxReady: false,
  billingCapabilities: billingClosed,
  allowedOriginsCount: 1,
})
assert(sandboxNotReady.productionBaselineReady === false, 'sandbox without operator readiness must fail baseline')
assert(sandboxNotReady.checks.operatorModeAllowed === true && sandboxNotReady.checks.operatorBoundaryReady === false, 'sandbox readiness flags wrong')

const billingUnsafe = buildTechnicalReadiness({
  authConfig: { deploymentMode: 'production', mode: 'supabase' },
  documentRepositoryStatus: { configured: true },
  operatorMode: 'disabled',
  operatorProvider: 'none',
  billingCapabilities: { ...billingClosed, realMoneyEnabled: true },
  allowedOriginsCount: 1,
})
assert(billingUnsafe.productionBaselineReady === false && billingUnsafe.checks.billingFailClosed === false, 'unsafe billing must fail readiness')

console.log('Technical readiness test OK: production/local/sandbox/billing checks are secret-free and never claim legal readiness')
