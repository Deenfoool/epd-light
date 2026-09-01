const documentId = (value) => String(value || '').trim()

export function operatorDocumentIdFromCandidate(candidate) {
  return documentId(candidate?.document?.internalId)
}

/**
 * Authorizes a canonical server-loaded document/candidate for an external operator action.
 * The browser-provided candidate is never authoritative for external calls.
 *
 * loadOwnedCandidate(documentId) must return either:
 *   { ownerSubject: '<auth sub>', candidate: <canonical candidate> }
 * or null when the document is unavailable to the current backend repository.
 */
export async function authorizeExternalOperatorDocument({ auth, documentId: requestedId, loadOwnedCandidate }) {
  if (auth?.mode !== 'supabase' || !String(auth?.subject || '').trim()) {
    return { ok: false, status: 403, error: 'external_auth_required' }
  }
  const id = documentId(requestedId)
  if (!id) return { ok: false, status: 400, error: 'document_id_required' }
  if (typeof loadOwnedCandidate !== 'function') {
    return { ok: false, status: 503, error: 'document_repository_unavailable' }
  }

  const loaded = await loadOwnedCandidate(id)
  if (!loaded || String(loaded.ownerSubject || '') !== auth.subject || !loaded.candidate) {
    // Do not reveal whether the ID exists for another account.
    return { ok: false, status: 404, error: 'document_not_available' }
  }
  const canonicalId = operatorDocumentIdFromCandidate(loaded.candidate)
  if (canonicalId !== id) {
    return { ok: false, status: 409, error: 'document_identity_mismatch' }
  }
  return { ok: true, documentId: id, candidate: loaded.candidate }
}

export const EXTERNAL_OPERATOR_AUTHORIZATION_POLICY = Object.freeze({
  verifiedJwtSubjectRequired: true,
  serverLoadedDocumentRequired: true,
  ownershipMatchRequired: true,
  clientPayloadAuthoritative: false,
  hidesCrossAccountDocumentExistence: true,
  gatewayExternalRouteEnabled: false,
  backendDocumentRepositoryAdapterReady: true,
  supabaseRlsUsed: true,
  serviceRoleRequired: false,
  runtimeRepositoryConfigurationRequired: true,
})
