import { gatewayAuthConfigFromEnv } from './auth.mjs'
import {
  supabaseDocumentRepositoryConfigFromEnv,
  supabaseDocumentRepositoryStatus,
} from './repositories/supabase-documents.mjs'

function dependencyError(code, statusCode = null) {
  const error = new Error(code)
  error.code = code
  if (statusCode != null) error.statusCode = Number(statusCode)
  return error
}

async function fetchJson(url, options, stage, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, options)
  } catch {
    throw dependencyError(`${stage}_network_error`)
  }
  if (!response?.ok) throw dependencyError(`${stage}_http_error`, response?.status || 0)
  try {
    return await response.json()
  } catch {
    throw dependencyError(`${stage}_invalid_json`)
  }
}

export async function checkRuntimeDependencies({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const authConfig = gatewayAuthConfigFromEnv(env)
  if (authConfig.mode !== 'supabase' || !authConfig.jwksUrl) {
    throw dependencyError('auth_jwks_not_configured')
  }

  const repositoryConfig = supabaseDocumentRepositoryConfigFromEnv(env)
  const repositoryStatus = supabaseDocumentRepositoryStatus(repositoryConfig)
  if (!repositoryStatus.configured) throw dependencyError('data_api_not_configured')

  const signal = AbortSignal.timeout(Math.max(1_000, Number(timeoutMs || 5_000)))
  const jwks = await fetchJson(authConfig.jwksUrl, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  }, 'auth_jwks', fetchImpl)
  if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) {
    throw dependencyError('auth_jwks_no_asymmetric_keys')
  }

  const plansUrl = new URL('/rest/v1/billing_plans', repositoryConfig.baseUrl)
  plansUrl.searchParams.set('select', 'code')
  plansUrl.searchParams.set('active', 'eq.true')
  plansUrl.searchParams.set('limit', '1')
  const plans = await fetchJson(plansUrl, {
    method: 'GET',
    headers: {
      apikey: repositoryConfig.publicApiKey,
      accept: 'application/json',
    },
    signal,
  }, 'data_api_billing_plans', fetchImpl)
  if (!Array.isArray(plans) || plans.length === 0 || typeof plans[0]?.code !== 'string') {
    throw dependencyError('data_api_billing_plans_missing')
  }

  return {
    ok: true,
    authJwksReachable: true,
    asymmetricSigningKeyPublished: true,
    dataApiReachable: true,
    billingFoundationVisible: true,
    sensitiveValuesIncluded: false,
  }
}

export function safeDependencyFailure(error) {
  const code = /^[a-z0-9_]{1,80}$/.test(String(error?.code || ''))
    ? String(error.code)
    : 'runtime_dependency_check_failed'
  const statusCode = Number(error?.statusCode || 0)
  return {
    ok: false,
    code,
    httpStatus: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null,
    sensitiveValuesIncluded: false,
  }
}
