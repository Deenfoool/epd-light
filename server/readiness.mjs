export function buildTechnicalReadiness({
  authConfig,
  documentRepositoryStatus,
  operatorMode = 'disabled',
  operatorProvider = 'none',
  sandboxReady = false,
  operatorAttemptJournalStatus,
  billingCapabilities,
  buildInfo,
  allowedOriginsCount = 0,
} = {}) {
  const productionMode = authConfig?.deploymentMode === 'production'
  const authReady = authConfig?.mode === 'supabase'
  const documentsReady = Boolean(documentRepositoryStatus?.configured)
  const traceableBuild = Boolean(buildInfo?.traceableBuild)
  const operatorModeAllowed = operatorMode === 'disabled' || (operatorMode === 'sandbox' && operatorProvider === 'kontur')
  const operatorReady = operatorMode === 'disabled' ? true : Boolean(sandboxReady)
  const billingFailClosed = billingCapabilities?.provider === 'none'
    && billingCapabilities?.checkoutEnabled === false
    && billingCapabilities?.webhookEnabled === false
    && billingCapabilities?.realMoneyEnabled === false
    && billingCapabilities?.successRedirectAuthoritative === false
    && billingCapabilities?.directRuntimeSubscriptionUpdateAllowed === false
    && billingCapabilities?.entitlementDatabaseFunctionRequired === true
  const corsReady = Number(allowedOriginsCount || 0) > 0

  const checks = {
    productionMode,
    jwtJwksAuth: authReady,
    canonicalDocumentRepository: documentsReady,
    traceableRuntimeBuild: traceableBuild,
    exactCorsOriginsConfigured: corsReady,
    operatorModeAllowed,
    operatorBoundaryReady: operatorReady,
    operatorProductionSendDisabled: true,
    billingFailClosed,
  }

  return {
    technicalReadinessOnly: true,
    legalReadinessClaimed: false,
    productionBaselineReady: Object.values(checks).every(Boolean),
    checks,
    optional: {
      persistentOperatorJournalConfigured: Boolean(operatorAttemptJournalStatus?.configured),
    },
    build: {
      traceable: traceableBuild,
      release: String(buildInfo?.release || 'unknown'),
      shortCommit: String(buildInfo?.shortCommit || 'unknown'),
      buildTime: String(buildInfo?.buildTime || 'unknown'),
    },
    operator: {
      mode: String(operatorMode),
      provider: String(operatorProvider),
      sandboxReady: operatorMode === 'sandbox' ? Boolean(sandboxReady) : false,
      productionSendEnabled: false,
    },
    billing: {
      provider: String(billingCapabilities?.provider || 'none'),
      checkoutEnabled: Boolean(billingCapabilities?.checkoutEnabled),
      webhookEnabled: Boolean(billingCapabilities?.webhookEnabled),
      realMoneyEnabled: Boolean(billingCapabilities?.realMoneyEnabled),
    },
    sensitiveValuesIncluded: false,
  }
}
