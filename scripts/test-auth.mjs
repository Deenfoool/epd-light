import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import {
  assertGatewayAuthConfig,
  authenticateGatewayRequest,
  gatewayAuthConfigFromEnv,
} from '../server/auth.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const { publicKey, privateKey } = await generateKeyPair('RS256')
const publicJwk = await exportJWK(publicKey)
Object.assign(publicJwk, { kid: 'epd-test-key', alg: 'RS256', use: 'sig' })

const jwksServer = createServer((req, res) => {
  if (req.url === '/auth/v1/.well-known/jwks.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ keys: [publicJwk] }))
    return
  }
  res.writeHead(404).end()
})
await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
const address = jwksServer.address()
const baseUrl = `http://127.0.0.1:${address.port}`
const issuer = `${baseUrl}/auth/v1`

const config = assertGatewayAuthConfig(gatewayAuthConfigFromEnv({
  EPD_GATEWAY_AUTH_MODE: 'supabase',
  EPD_AUTH_SUPABASE_URL: baseUrl,
  EPD_AUTH_AUDIENCE: 'authenticated',
}), 'disabled')

const sign = ({ role = 'authenticated', audience = 'authenticated', clientId = '' } = {}) => {
  let jwt = new SignJWT({ role, ...(clientId ? { client_id: clientId } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'epd-test-key', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime('5m')
  return jwt.sign(privateKey)
}

try {
  const validToken = await sign()
  const valid = await authenticateGatewayRequest({ headers: { authorization: `Bearer ${validToken}` } }, config)
  assert(valid.ok === true, 'valid RS256 Supabase-style JWT must authenticate')
  assert(valid.subject === 'user-123', 'JWT subject not returned')
  assert(valid.role === 'authenticated', 'authenticated role not returned')
  assert(JSON.stringify(valid).includes(validToken) === false, 'auth result must never echo bearer token')

  const missing = await authenticateGatewayRequest({ headers: {} }, config)
  assert(missing.ok === false && missing.status === 401 && missing.error === 'auth_required', 'missing bearer token must return auth_required')

  const wrongAudience = await authenticateGatewayRequest({ headers: { authorization: `Bearer ${await sign({ audience: 'wrong' })}` } }, config)
  assert(wrongAudience.ok === false && wrongAudience.status === 401, 'wrong JWT audience must fail verification')

  const wrongRole = await authenticateGatewayRequest({ headers: { authorization: `Bearer ${await sign({ role: 'anon' })}` } }, config)
  assert(wrongRole.ok === false && wrongRole.status === 403 && wrongRole.error === 'auth_forbidden', 'anon role must be forbidden')

  const clientConfig = { ...config, clientId: 'epd-light-web' }
  const wrongClient = await authenticateGatewayRequest({ headers: { authorization: `Bearer ${await sign({ clientId: 'other-client' })}` } }, clientConfig)
  assert(wrongClient.ok === false && wrongClient.error === 'auth_wrong_client', 'wrong client_id must be forbidden when pinning is enabled')
  const rightClient = await authenticateGatewayRequest({ headers: { authorization: `Bearer ${await sign({ clientId: 'epd-light-web' })}` } }, clientConfig)
  assert(rightClient.ok === true, 'allowed client_id should authenticate')

  const disabled = assertGatewayAuthConfig(gatewayAuthConfigFromEnv({ EPD_GATEWAY_AUTH_MODE: 'disabled' }), 'disabled')
  const local = await authenticateGatewayRequest({ headers: {} }, disabled)
  assert(local.ok === true && local.mode === 'disabled', 'disabled auth mode must support local demo')

  let unsafeModeRejected = false
  try { assertGatewayAuthConfig(disabled, 'sandbox') } catch { unsafeModeRejected = true }
  assert(unsafeModeRejected, 'non-disabled operator mode must reject disabled gateway auth')

  assert(config.jwksUrl.endsWith('/auth/v1/.well-known/jwks.json'), 'wrong Supabase JWKS path')
  assert(config.algorithms.includes('RS256') && config.algorithms.includes('ES256'), 'asymmetric algorithm allow-list missing')

  console.log('Gateway auth test OK: local JWKS, RS256 signature, iss/aud/role/client checks and fail-closed operator mode verified')
} finally {
  await new Promise((resolve) => jwksServer.close(resolve))
}
