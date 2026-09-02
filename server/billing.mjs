const PAID_PLAN_CODES = new Set(['start', 'business', 'team'])
const BILLING_PROVIDERS = new Set(['none'])

export function billingConfigFromEnv(env = process.env) {
  return {
    provider: String(env.EPD_BILLING_PROVIDER || 'none').trim().toLowerCase(),
  }
}

export function billingConfigStatus(config) {
  const errors = []
  if (!BILLING_PROVIDERS.has(config?.provider)) errors.push('unsupported billing provider')
  return {
    adapterAvailable: true,
    provider: config?.provider || 'none',
    configured: false,
    checkoutEnabled: false,
    webhookEnabled: false,
    errors,
  }
}

export function validateBillingCheckoutRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'billing_checkout_payload_invalid', message: 'Checkout payload must be a JSON object' }
  }
  const keys = Object.keys(input)
  if (keys.length !== 1 || keys[0] !== 'planCode') {
    return { ok: false, status: 400, error: 'billing_checkout_payload_rejected', message: 'Checkout accepts only planCode' }
  }
  const planCode = String(input.planCode || '').trim().toLowerCase()
  if (!PAID_PLAN_CODES.has(planCode)) {
    return { ok: false, status: 422, error: 'billing_plan_invalid', message: 'Unknown or non-purchasable plan' }
  }
  return { ok: true, planCode }
}

export const BILLING_PAYMENT_POLICY = Object.freeze({
  checkoutRoute: '/api/billing/checkout',
  capabilitiesRoute: '/api/billing/capabilities',
  provider: 'none',
  allowedPaidPlans: [...PAID_PLAN_CODES],
  checkoutServerOwned: true,
  browserSuppliedPriceAccepted: false,
  browserSuppliedUserIdAccepted: false,
  browserSuppliedSubscriptionStatusAccepted: false,
  browserCanActivateSubscription: false,
  successRedirectAuthoritative: false,
  verifiedWebhookRequiredForActivation: true,
  webhookRouteImplemented: false,
  rawProviderPayloadStored: false,
  directRuntimeSubscriptionUpdateAllowed: false,
  entitlementDatabaseFunctionRequired: true,
  billingEnforcementDefault: false,
  realMoneyEnabled: false,
})

export function billingPublicCapabilities(config = billingConfigFromEnv()) {
  const status = billingConfigStatus(config)
  return {
    ...BILLING_PAYMENT_POLICY,
    provider: status.provider,
    providerConfigured: status.configured,
    checkoutEnabled: status.checkoutEnabled,
    webhookEnabled: status.webhookEnabled,
  }
}
