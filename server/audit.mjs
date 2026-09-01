const SAFE_CODE_RE = /^[a-z0-9_.-]{1,64}$/i

const text = (value, max) => String(value ?? '').trim().slice(0, max)
const integer = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback
}

/**
 * Builds a strict allow-listed gateway audit event.
 * Never pass request body, headers, XML/JSON documents, contact data or tokens here.
 */
export function createGatewayAuditEvent({
  requestId,
  method,
  path,
  provider,
  httpStatus,
  durationMs,
  errorCode,
}) {
  const code = text(errorCode, 64)
  return {
    event: 'gateway_request',
    ts: new Date().toISOString(),
    requestId: text(requestId, 128),
    method: text(method, 12).toUpperCase(),
    path: text(path, 160),
    provider: text(provider, 32) || 'none',
    httpStatus: integer(httpStatus),
    durationMs: integer(durationMs),
    errorCode: code && SAFE_CODE_RE.test(code) ? code : null,
  }
}

/**
 * Writes exactly one JSON line containing only the allow-listed audit fields.
 * The sink is injectable for tests; production defaults to stdout.
 */
export function writeGatewayAudit(input, sink = console.log) {
  const event = createGatewayAuditEvent(input)
  sink(JSON.stringify(event))
  return event
}

/** Only machine-safe payload.error values may become audit error codes. */
export function auditErrorCode(payload, httpStatus) {
  const code = text(payload?.error, 64)
  if (code && SAFE_CODE_RE.test(code)) return code
  return Number(httpStatus) >= 400 ? 'http_error' : null
}
