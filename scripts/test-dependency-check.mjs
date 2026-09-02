import { checkRuntimeDependencies, safeDependencyFailure } from '../server/dependency-check.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const secretKey = 'public-key-value-that-must-not-be-returned'
const env = {
  EPD_DEPLOYMENT_MODE: 'production',
  EPD_GATEWAY_AUTH_MODE: 'supabase',
  EPD_AUTH_SUPABASE_URL: 'https://project.example.ru',
  EPD_DATA_SUPABASE_URL: 'https://project.example.ru',
  EPD_DATA_SUPABASE_PUBLIC_KEY: secretKey,
}

const requests = []
const okFetch = async (input, init = {}) => {
  const url = String(input)
  requests.push({ url, headers: init.headers || {} })
  if (url.includes('/auth/v1/.well-known/jwks.json')) {
    return { ok: true, status: 200, json: async () => ({ keys: [{ kty: 'RSA', kid: 'test' }] }) }
  }
  if (url.includes('/rest/v1/billing_plans')) {
    return { ok: true, status: 200, json: async () => ([{ code: 'trial' }]) }
  }
  throw new Error('unexpected test URL')
}

const result = await checkRuntimeDependencies({ env, fetchImpl: okFetch, timeoutMs: 1_000 })
assert(result.ok === true, 'dependency check should pass with JWKS and billing plan')
assert(result.authJwksReachable === true && result.dataApiReachable === true, 'dependency reachability flags wrong')
assert(result.billingFoundationVisible === true, 'billing foundation should be visible')
assert(result.sensitiveValuesIncluded === false, 'dependency result must declare secret-free output')
assert(requests.some((r) => r.url.includes('/auth/v1/.well-known/jwks.json')), 'JWKS endpoint was not checked')
const dataRequest = requests.find((r) => r.url.includes('/rest/v1/billing_plans'))
assert(dataRequest?.headers?.apikey === secretKey, 'Data API check must use public API key in request only')
const serialized = JSON.stringify(result)
for (const forbidden of [secretKey, 'project.example.ru', 'apikey', 'jwksUrl', 'baseUrl']) {
  assert(!serialized.includes(forbidden), `dependency result leaked config value/name: ${forbidden}`)
}

try {
  await checkRuntimeDependencies({
    env,
    fetchImpl: async (input) => String(input).includes('/jwks.json')
      ? { ok: true, status: 200, json: async () => ({ keys: [] }) }
      : { ok: true, status: 200, json: async () => ([{ code: 'trial' }]) },
  })
  throw new Error('empty JWKS should fail')
} catch (error) {
  assert(error.code === 'auth_jwks_no_asymmetric_keys', 'empty JWKS must fail with safe code')
  const safe = safeDependencyFailure(error)
  assert(JSON.stringify(safe).includes(secretKey) === false, 'safe dependency error leaked key')
}

const httpFailure = safeDependencyFailure(Object.assign(new Error('provider body SECRET-BODY'), {
  code: 'data_api_billing_plans_http_error',
  statusCode: 503,
}))
assert(httpFailure.code === 'data_api_billing_plans_http_error' && httpFailure.httpStatus === 503, 'HTTP failure should preserve only safe code/status')
assert(JSON.stringify(httpFailure).includes('SECRET-BODY') === false, 'safe dependency error must not expose provider body')

console.log('Runtime dependency test OK: JWKS/Data API migration smoke-check uses credentials only in requests and returns safe metadata')
