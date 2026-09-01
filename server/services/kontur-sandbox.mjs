import { generateAuthorizedKonturT1 } from './kontur-title.mjs'
import { createSupabaseOwnedCandidateLoader } from '../repositories/supabase-documents.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  return generateAuthorizedKonturT1({
    auth,
    documentId,
    loadOwnedCandidate,
    config: konturConfig,
    fetchImpl: konturFetchImpl,
    ...(konturBaseUrl ? { baseUrl: konturBaseUrl } : {}),
  })
}

export const KONTUR_SANDBOX_GENERATION_POLICY = Object.freeze({
  gatewayRoute: '/api/operator/kontur/generate-title-sandbox',
  enabledOperatorMode: 'sandbox',
  enabledProvider: 'kontur',
  requestFields: ['documentId'],
  clientDocumentPayloadAccepted: false,
  verifiedJwtRequired: true,
  supabaseRlsReloadRequired: true,
  callsGenerateTitleXml: true,
  callsPostMessage: false,
  signsDocument: false,
  sendsDocument: false,
})
