import { auditErrorCode, createGatewayAuditEvent, writeGatewayAudit } from '../server/audit.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const secretToken = 'super-secret-bearer-token'
const personName = 'Иванов Секретный Иванович'
const phone = '+79991234567'
const xml = '<LogisticsWaybillConsignorTitle Secret="yes" />'

const event = createGatewayAuditEvent({
  requestId: 'req-1',
  method: 'post',
  path: '/api/operator/preflight',
  provider: 'kontur',
  httpStatus: 422,
  durationMs: 12.4,
  errorCode: 'candidate_invalid',
  authorization: `Bearer ${secretToken}`,
  body: { driver: { fullName: personName, phone }, xml },
  token: secretToken,
})

assert(event.event === 'gateway_request', 'wrong audit event name')
assert(event.method === 'POST', 'method should be normalized')
assert(event.path === '/api/operator/preflight', 'path missing')
assert(event.httpStatus === 422, 'HTTP status missing')
assert(event.durationMs === 12, 'duration should be integer')
assert(event.errorCode === 'candidate_invalid', 'safe error code missing')

const serialized = JSON.stringify(event)
for (const forbidden of [secretToken, personName, phone, xml, 'authorization', 'body', 'token']) {
  assert(!serialized.includes(forbidden), `audit leaked forbidden value/key: ${forbidden}`)
}

let line = ''
writeGatewayAudit({
  requestId: 'req-2', method: 'GET', path: '/healthz', provider: 'none', httpStatus: 200, durationMs: 1,
}, (value) => { line = value })
const parsed = JSON.parse(line)
assert(parsed.requestId === 'req-2' && parsed.httpStatus === 200, 'audit sink did not receive valid JSON line')

assert(auditErrorCode({ error: 'operator_send_disabled' }, 503) === 'operator_send_disabled', 'machine error code should be retained')
assert(auditErrorCode({ error: 'human readable error with personal data 123' }, 500) === 'http_error', 'free-form errors must collapse to http_error')
assert(createGatewayAuditEvent({ requestId:'x', method:'GET', path:'/', provider:'none', httpStatus:500, durationMs:1, errorCode:'bad code with spaces' }).errorCode === null, 'unsafe code must be dropped')

console.log('Gateway audit test OK: strict allow-list, JSON-line output and payload/token non-disclosure verified')
