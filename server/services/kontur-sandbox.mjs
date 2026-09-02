import { authorizeExternalOperatorDocument } from '../authorization.mjs'
import { buildOperatorActionIdentity, runInFlightOnce } from '../idempotency.mjs'
import { KONTUR_T1_CONTRACT } from '../providers/kontur.mjs'
import { createSupabaseOwnedCandidateLoader } from '../repositories/supabase-documents.mjs'
import { generateKonturT1FromCandidate } from './kontur-title.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_CODE_RE = /^[a-z0-9_]{1,64}$/

export function validateSandboxGenerateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'sandbox_request_invalid', message: 'JSON object with documentId is required' }
  }
  const keys = Object.keys(input)
  if (keys.some((key) => key !== 'documentId')) {
    return { ok: false, status: 400, error: 'sandbox_payload_rejected', message: 'Sandbox generation accepts documentId only; client document payload is not authoritative' }
  }
  const documentId = String(input.documentId || '').trim()
  if (!UUID_RE.test(documentId)) {
    return { ok: false, status: 400, error: 'document_id_invalid', message: 'documentId must be a UUID' }
  }
  return { ok: true, documentId }
}

const safeFailureCode = (error) => {
  const code = String(error?.code || '')
  return SAFE_CODE_RE.test(code) ? code : 'sandbox_generation_failed'
}

const journalConflict = (claim) => {
  if (claim.state === 'already_succeeded') {
    const error = new Error('This document revision already has a successful sandbox GenerateTitleXml attempt')
    error.code = 'sandbox_already_generated'
    error.statusCode = 409
    error.attemptId = claim.attempt?.id
    return error
  }
  if (claim.state === 'in_progress') {
    const error = new Error('This document revision already has an in-progress sandbox GenerateTitleXml attempt')
    error.code = 'sandbox_generation_in_progress'
    error.statusCode = 409
    error.attemptId = claim.attempt?.id
    return error
  }
  return null
}

/**
 * Sandbox-only external boundary.
 * The browser supplies only documentId. The canonical document is reloaded through
 * Supabase Data API with the verified user's JWT so existing RLS remains authoritative.
 */
export async function generateKonturSandboxTitleForDocument({
  auth,
  documentId,
  repositoryConfig,
  konturConfig,
  repositoryFetchImpl = fetch,
  konturFetchImpl = fetch,
  konturBaseUrl,
  attemptRepository = null,
}) {
  if (auth?.mode !== 'supabase' || !String(auth?.subject || '').trim() || !String(auth?.accessToken || '').trim()) {
    const error = new Error('Verified Supabase user context is required for sandbox generation')
    error.code = 'sandbox_auth_required'
    error.statusCode = 403
    throw error
  }

  const loadOwnedCandidate = createSupabaseOwnedCandidateLoader({
    accessToken: auth.accessToken,
    config: repositoryConfig,
    fetchImpl: repositoryFetchImpl,
  })

  const authorization = await authorizeExternalOperatorDocument({ auth, documentId, loadOwnedCandidate })
  if (!authorization.ok) {
    const error = new Error(`Kontur sandbox authorization failed: ${authorization.error}`)
    error.code = authorization.error
    error.statusCode = authorization.status
    throw error
  }

  const identity = buildOperatorActionIdentity({
    candidate: authorization.candidate,
    provider: 'kontur',
    mode: 'sandbox',
    operation: 'generate_title',
    documentVersion: KONTUR_T1_CONTRACT.documentVersion,
    titleIndex: KONTUR_T1_CONTRACT.titleIndex,
  })

  const persistentConfigured = Boolean(attemptRepository?.status?.configured)
  const execution = await runInFlightOnce(identity, async () => {
    let claim = null
    if (persistentConfigured) {
      claim = await attemptRepository.claim({
        userId: auth.subject,
        documentId,
        identity,
      })
      const conflict = journalConflict(claim)
      if (conflict) throw conflict
    }

    try {
      const generation = await generateKonturT1FromCandidate({
        candidate: authorization.candidate,
        config: konturConfig,
        fetchImpl: konturFetchImpl,
        ...(konturBaseUrl ? { baseUrl: konturBaseUrl } : {}),
      })
      let persistedAttempt = claim?.attempt || null
      if (persistentConfigured && persistedAttempt?.id) {
        try {
          persistedAttempt = await attemptRepository.succeed(persistedAttempt.id)
        } catch (journalError) {
          const error = new Error('GenerateTitleXml succeeded but persistent attempt journal could not be marked succeeded')
          error.code = 'operator_attempt_journal_update_failed'
          error.statusCode = 503
          error.cause = journalError
          throw error
        }
      }
      return {
        generation,
        persistence: {
          configured: persistentConfigured,
          persisted: Boolean(persistedAttempt?.id),
          attemptId: persistedAttempt?.id || '',
          status: persistedAttempt?.status || '',
        },
      }
    } catch (error) {
      if (persistentConfigured && claim?.attempt?.id && error?.code !== 'operator_attempt_journal_update_failed') {
        try {
          await attemptRepository.fail(claim.attempt.id, safeFailureCode(error))
        } catch (journalError) {
          const wrapped = new Error('Sandbox call failed and persistent attempt journal could not record failure')
          wrapped.code = 'operator_attempt_journal_update_failed'
          wrapped.statusCode = 503
          wrapped.cause = journalError
          throw wrapped
        }
      }
      throw error
    }
  })

  return {
    ...execution.result.generation,
    externalCallMade: !execution.sharedInFlight,
    externalResultShared: execution.sharedInFlight,
    persistence: execution.result.persistence,
    idempotency: {
      idempotencyKey: identity.idempotencyKey,
      requestFingerprint: identity.requestFingerprint,
      sourceRevision: identity.sourceRevision,
      sharedInFlight: execution.sharedInFlight,
      completedPersistenceWired: persistentConfigured,
      attemptId: execution.result.persistence?.attemptId || '',
    },
  }
}

export const KONTUR_SANDBOX_GENERATION_POLICY = Object.freeze({
  gatewayRoute: '/api/operator/kontur/generate-title-sandbox',
  enabledOperatorMode: 'sandbox',
  enabledProvider: 'kontur',
  requestFields: ['documentId'],
  clientDocumentPayloadAccepted: false,
  clientIdempotencyKeyAccepted: false,
  verifiedJwtRequired: true,
  supabaseRlsReloadRequired: true,
  concurrentDuplicateExternalCallsCollapsed: true,
  completedAttemptPersistenceTableReady: true,
  completedAttemptPersistenceOptional: true,
  persistentDuplicateExternalCallsBlockedWhenConfigured: true,
  callsGenerateTitleXml: true,
  callsPostMessage: false,
  signsDocument: false,
  sendsDocument: false,
})
