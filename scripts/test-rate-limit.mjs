import {
  authenticatedRateKey,
  clearRateLimitStateForTests,
  consumeRateLimit,
  rateLimitConfigFromEnv,
  rateLimitHeaders,
  requestNetworkKey,
} from '../server/rate-limit.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
clearRateLimitStateForTests()

const first = consumeRateLimit({ key: 'user-a', scope: 'test', max: 2, windowMs: 10_000, now: 1_000 })
const second = consumeRateLimit({ key: 'user-a', scope: 'test', max: 2, windowMs: 10_000, now: 1_001 })
const third = consumeRateLimit({ key: 'user-a', scope: 'test', max: 2, windowMs: 10_000, now: 1_002 })
assert(first.allowed && first.remaining === 1, 'first request should be allowed')
assert(second.allowed && second.remaining === 0, 'second request should be allowed')
assert(third.allowed === false && third.retryAfter > 0, 'third request should be rate limited')
assert(rateLimitHeaders(third)['retry-after'], '429 headers must contain Retry-After')

const reset = consumeRateLimit({ key: 'user-a', scope: 'test', max: 2, windowMs: 10_000, now: 11_001 })
assert(reset.allowed === true && reset.remaining === 1, 'window reset should allow request again')

const networkReq = { headers: { 'x-real-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.10, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.3' } }
const spoofedForwardedReq = { headers: { 'x-real-ip': '198.51.100.20', 'x-forwarded-for': '192.0.2.99' }, socket: { remoteAddress: '10.0.0.3' } }
const networkKey = requestNetworkKey(networkReq)
const spoofedNetworkKey = requestNetworkKey(spoofedForwardedReq)
assert(networkKey.length === 24, 'network rate key must be hashed')
assert(!networkKey.includes('198.51.100.20'), 'raw IP must not be stored in rate key')
assert(networkKey === spoofedNetworkKey, 'client-controlled X-Forwarded-For must not override nginx X-Real-IP')

const noRealIpA = { headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.3' } }
const noRealIpB = { headers: { 'x-forwarded-for': '192.0.2.99, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.3' } }
assert(requestNetworkKey(noRealIpA) === requestNetworkKey(noRealIpB), 'fallback must use the last forwarded hop, not a spoofable first hop')

const subjectKey = authenticatedRateKey({ subject: 'user-123' }, networkReq)
assert(subjectKey.length === 24 && subjectKey !== networkKey, 'authenticated subject must use a separate hashed rate key')

const cfg = rateLimitConfigFromEnv({
  EPD_RATE_LIMIT_WINDOW_MS: '5000',
  EPD_RATE_LIMIT_MAX: '12',
  EPD_AUTH_ATTEMPT_LIMIT_MAX: '30',
  EPD_EXTERNAL_RATE_LIMIT_MAX: '4',
})
assert(cfg.windowMs === 5000 && cfg.max === 12 && cfg.authMax === 30 && cfg.externalMax === 4, 'rate env configuration not parsed')

clearRateLimitStateForTests()
const external1 = consumeRateLimit({ key: subjectKey, scope: 'operator-external', max: cfg.externalMax, windowMs: cfg.windowMs, now: 20_000 })
const external2 = consumeRateLimit({ key: subjectKey, scope: 'operator-external', max: cfg.externalMax, windowMs: cfg.windowMs, now: 20_001 })
const external3 = consumeRateLimit({ key: subjectKey, scope: 'operator-external', max: cfg.externalMax, windowMs: cfg.windowMs, now: 20_002 })
const external4 = consumeRateLimit({ key: subjectKey, scope: 'operator-external', max: cfg.externalMax, windowMs: cfg.windowMs, now: 20_003 })
const external5 = consumeRateLimit({ key: subjectKey, scope: 'operator-external', max: cfg.externalMax, windowMs: cfg.windowMs, now: 20_004 })
assert(external1.allowed && external2.allowed && external3.allowed && external4.allowed, 'configured external calls should be allowed within limit')
assert(external5.allowed === false && external5.retryAfter > 0, 'external operator calls need a stricter separate limit')

console.log('Gateway rate limit test OK: fixed window, external-call limit, Retry-After, privacy-safe keys and forwarded-header spoof protection verified')
