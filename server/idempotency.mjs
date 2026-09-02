import { createHash } from 'node:crypto'

const inFlight = new Map()
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

export function buildOperatorActionIdentity({
  candidate,
  provider = 'kontur',
  mode = 'sandbox',
  operation = 'generate_title',
  documentVersion = 'kl_trn_mt_05_01',
  titleIndex = 0,
}) {
  const documentId = String(candidate?.document?.internalId || '').trim()
  const sourceRevision = String(candidate?.sourceRevision || '').trim()
  if (!documentId) {
    const error = new Error('canonical document id is required for idempotency')
    error.code = 'idempotency_document_id_missing'
    throw error
  }
  if (!sourceRevision) {
    const error = new Error('canonical source revision is required for idempotency')
    error.code = 'idempotency_revision_missing'
    throw error
  }

  const requestFingerprint = sha256(stableJson(candidate))
  const keyMaterial = stableJson({
    version: 1,
    provider,
    mode,
    operation,
    documentId,
    sourceRevision,
    documentVersion,
    titleIndex: Number(titleIndex),
  })

  return {
    documentId,
    sourceRevision,
    provider,
    mode,
    operation,
    documentVersion,
    titleIndex: Number(titleIndex),
    idempotencyKey: sha256(keyMaterial),
    requestFingerprint,
  }
}

/**
 * Prevents concurrent duplicate external calls inside one gateway process.
 * A second, optional persistent layer is implemented by the restricted
 * public.operator_attempts repository and survives process restarts when configured.
 */
export async function runInFlightOnce(identity, task) {
  const key = String(identity?.idempotencyKey || '')
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('valid idempotencyKey is required')
  if (typeof task !== 'function') throw new Error('idempotent task function is required')

  const existing = inFlight.get(key)
  if (existing) return { result: await existing, sharedInFlight: true }

  const promise = Promise.resolve().then(task)
  inFlight.set(key, promise)
  try {
    return { result: await promise, sharedInFlight: false }
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  }
}

export function clearInFlightForTests() {
  inFlight.clear()
}

export const OPERATOR_IDEMPOTENCY_POLICY = Object.freeze({
  algorithm: 'sha256',
  sourceRevision: 'documents.updated_at',
  clientSuppliedKeyAccepted: false,
  requestPayloadStored: false,
  xmlStoredByIdentityLayer: false,
  concurrentDuplicatesSharedPerProcess: true,
  completedPersistenceTable: 'public.operator_attempts',
  completedPersistenceRepositoryImplemented: true,
  completedPersistenceRuntimeOptional: true,
  completedPersistenceUsesRestrictedDbRole: true,
})
