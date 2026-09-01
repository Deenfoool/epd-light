import { createHash } from 'node:crypto'

const buckets = new Map()
let operations = 0

const hashKey = (value) => createHash('sha256').update(String(value || 'anonymous')).digest('hex').slice(0, 24)

export function rateLimitConfigFromEnv(env = process.env) {
  const windowMs = Math.max(1_000, Number(env.EPD_RATE_LIMIT_WINDOW_MS || 60_000))
  const max = Math.max(1, Number(env.EPD_RATE_LIMIT_MAX || 60))
  const authMax = Math.max(1, Number(env.EPD_AUTH_ATTEMPT_LIMIT_MAX || 30))
  return { windowMs, max, authMax }
}

export function requestNetworkKey(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim()
  const remote = String(req?.socket?.remoteAddress || '').trim()
  return hashKey(forwarded || remote || 'unknown')
}

export function authenticatedRateKey(auth, req) {
  const subject = String(auth?.subject || '').trim()
  return subject ? hashKey(`sub:${subject}`) : requestNetworkKey(req)
}

function cleanup(now) {
  operations += 1
  if (operations % 250 !== 0) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size > 20_000) {
    const entries = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    for (const [key] of entries.slice(0, buckets.size - 20_000)) buckets.delete(key)
  }
}

export function consumeRateLimit({ key, scope = 'default', max = 60, windowMs = 60_000, now = Date.now() }) {
  cleanup(now)
  const bucketKey = `${scope}:${hashKey(key)}`
  let bucket = buckets.get(bucketKey)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(bucketKey, bucket)
  }
  bucket.count += 1
  const remaining = Math.max(0, max - bucket.count)
  const allowed = bucket.count <= max
  const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  return { allowed, limit: max, remaining, resetAt: bucket.resetAt, retryAfter }
}

export function rateLimitHeaders(result) {
  const headers = {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(Math.ceil(result.resetAt / 1000)),
  }
  if (!result.allowed) headers['retry-after'] = String(result.retryAfter)
  return headers
}

export function clearRateLimitStateForTests() {
  buckets.clear()
  operations = 0
}
