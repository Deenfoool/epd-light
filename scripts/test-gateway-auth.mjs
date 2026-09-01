import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
Object.assign(jwk, { kid: 'gateway-auth-test', alg: 'RS256', use: 'sig' })
const jwksServer = createServer((req, res) => {
  if (req.url === '/auth/v1/.well-known/jwks.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: [jwk] }))
    return
  }
  res.writeHead(404).end()
})
await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve))
const jwksAddress = jwksServer.address()
const authBase = `http://127.0.0.1:${jwksAddress.port}`
const issuer = `${authBase}/auth/v1`

const token = await new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg: 'RS256', kid: 'gateway-auth-test' })
  .setIssuer(issuer)
  .setAudience('authenticated')
  .setSubject('user-gateway-test')
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(privateKey)

const port = 20000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    EPD_OPERATOR_PROVIDER: 'none',
    EPD_OPERATOR_MODE: 'disabled',
    EPD_GATEWAY_AUTH_MODE: 'supabase',
    EPD_AUTH_SUPABASE_URL: authBase,
    EPD_AUTH_AUDIENCE: 'authenticated',
    EPD_RATE_LIMIT_WINDOW_MS: '60000',
    EPD_RATE_LIMIT_MAX: '2',
    EPD_AUTH_ATTEMPT_LIMIT_MAX: '20',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += String(chunk) })
child.stderr.on('data', (chunk) => { stderr += String(chunk) })

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try { const r = await fetch(`${base}/healthz`); if (r.ok) return } catch {}
    await sleep(100)
  }
  throw new Error(`auth gateway did not become healthy: ${stderr}`)
}

const minimalCandidate = {
  kind: 'epd-light/operator-candidate-v1',
  document: { number: 'AUTH-1', date: '2026-09-01' },
  participants: {
    shipper: { name: 'A', inn: '7700000000' },
    consignee: { name: 'B', inn: '7800000000' },
    carrier: { name: 'C', inn: '7900000000' },
  },
  cargo: [{ name: 'Тест' }],
  vehicle: { registrationNumber: 'А001АА777' },
  driver: { fullName: 'Иванов Иван' },
  readiness: { candidate: true },
}

try {
  await waitForHealth()

  const capabilities = await fetch(`${base}/api/operator/capabilities`).then((r) => r.json())
  assert(capabilities.auth?.mode === 'supabase', 'capabilities must expose supabase auth mode')
  assert(capabilities.auth?.requiredForOperatorApi === true, 'operator namespace must require auth')

  const futureNoAuth = await fetch(`${base}/api/operator/future-endpoint`)
  const futureNoAuthBody = await futureNoAuth.json()
  assert(futureNoAuth.status === 401 && futureNoAuthBody.error === 'auth_required', 'future operator endpoint must be protected by namespace default')

  const noAuth = await fetch(`${base}/api/operator/preflight`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(minimalCandidate),
  })
  assert(noAuth.status === 401, 'preflight without bearer token must be rejected')

  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  const first = await fetch(`${base}/api/operator/preflight`, { method: 'POST', headers, body: JSON.stringify(minimalCandidate) })
  assert(first.status === 200, 'authenticated preflight should pass')
  assert(first.headers.get('ratelimit-limit') === '2', 'rate limit header missing')

  const second = await fetch(`${base}/api/operator/preflight`, { method: 'POST', headers, body: JSON.stringify(minimalCandidate) })
  assert(second.status === 200, 'second authenticated request should pass')

  const third = await fetch(`${base}/api/operator/preflight`, { method: 'POST', headers, body: JSON.stringify(minimalCandidate) })
  const thirdBody = await third.json()
  assert(third.status === 429 && thirdBody.error === 'rate_limited', 'third request should be rate limited')
  assert(Number(third.headers.get('retry-after')) >= 1, '429 must return Retry-After')

  await sleep(50)
  assert(!stdout.includes(token), 'gateway audit/startup logs must never contain bearer token')
  assert(stdout.includes('"errorCode":"auth_required"'), 'auth rejection should be audit-visible by safe code')
  assert(stdout.includes('"errorCode":"rate_limited"'), 'rate limit should be audit-visible by safe code')

  console.log('Gateway auth integration test OK: namespace fail-closed auth, JWKS verification and per-user rate limit verified')
} finally {
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(1000)])
  if (!child.killed) child.kill('SIGKILL')
  await new Promise((resolve) => jwksServer.close(resolve))
}
