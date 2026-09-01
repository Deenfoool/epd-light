import {
  buildOperatorActionIdentity,
  clearInFlightForTests,
  runInFlightOnce,
  stableJson,
} from '../server/idempotency.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const candidate = {
  kind: 'epd-light/operator-candidate-v1',
  sourceRevision: '2026-09-01T12:00:00.123456+00:00',
  document: { internalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', number: 'ETRN-1' },
  cargo: [{ name: 'Груз', grossWeightKg: '100' }],
  participants: { shipper: { inn: '7700000000' } },
}

const reordered = {
  participants: { shipper: { inn: '7700000000' } },
  cargo: [{ grossWeightKg: '100', name: 'Груз' }],
  document: { number: 'ETRN-1', internalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  sourceRevision: '2026-09-01T12:00:00.123456+00:00',
  kind: 'epd-light/operator-candidate-v1',
}

assert(stableJson(candidate) === stableJson(reordered), 'stableJson must ignore object key order')

const firstIdentity = buildOperatorActionIdentity({ candidate })
const reorderedIdentity = buildOperatorActionIdentity({ candidate: reordered })
assert(firstIdentity.idempotencyKey === reorderedIdentity.idempotencyKey, 'same revision/action must get same idempotency key')
assert(firstIdentity.requestFingerprint === reorderedIdentity.requestFingerprint, 'same canonical payload must get same fingerprint')
assert(/^[0-9a-f]{64}$/.test(firstIdentity.idempotencyKey), 'idempotency key must be sha256 hex')
assert(/^[0-9a-f]{64}$/.test(firstIdentity.requestFingerprint), 'request fingerprint must be sha256 hex')

const changedRevision = buildOperatorActionIdentity({
  candidate: { ...candidate, sourceRevision: '2026-09-01T12:01:00.000000+00:00' },
})
assert(changedRevision.idempotencyKey !== firstIdentity.idempotencyKey, 'new document revision must get a new idempotency key')

const changedPayloadSameRevision = buildOperatorActionIdentity({
  candidate: { ...candidate, cargo: [{ name: 'Другой груз', grossWeightKg: '100' }] },
})
assert(changedPayloadSameRevision.idempotencyKey === firstIdentity.idempotencyKey, 'action key is revision-based')
assert(changedPayloadSameRevision.requestFingerprint !== firstIdentity.requestFingerprint, 'fingerprint must detect payload drift inside same revision')

let missingRevisionRejected = false
try { buildOperatorActionIdentity({ candidate: { document: { internalId: candidate.document.internalId } } }) } catch (error) {
  missingRevisionRejected = error?.code === 'idempotency_revision_missing'
}
assert(missingRevisionRejected, 'missing canonical source revision must fail closed')

clearInFlightForTests()
let calls = 0
let release
const gate = new Promise((resolve) => { release = resolve })
const task = async () => { calls += 1; await gate; return { generated: true } }
const p1 = runInFlightOnce(firstIdentity, task)
const p2 = runInFlightOnce(firstIdentity, task)
await new Promise((resolve) => setTimeout(resolve, 0))
assert(calls === 1, 'concurrent duplicate must execute external task once')
release()
const [r1, r2] = await Promise.all([p1, p2])
assert(r1.result.generated && r2.result.generated, 'both concurrent callers must receive the result')
assert([r1.sharedInFlight, r2.sharedInFlight].filter(Boolean).length === 1, 'one caller must be marked as shared in-flight')

await runInFlightOnce(firstIdentity, async () => { calls += 1; return { generated: true } })
assert(calls === 2, 'completed call is not persisted by in-memory layer and may run again')

console.log('Operator idempotency test OK: stable fingerprint, revision key and concurrent in-flight dedupe verified')
