import {
  EXTERNAL_OPERATOR_AUTHORIZATION_POLICY,
  authorizeExternalOperatorDocument,
  operatorDocumentIdFromCandidate,
} from '../server/authorization.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const candidate = { document: { internalId: 'doc-1', number: 'TEST-1' } }
const auth = { mode: 'supabase', subject: 'user-1', role: 'authenticated' }

assert(operatorDocumentIdFromCandidate(candidate) === 'doc-1', 'candidate document id extraction failed')

const disabled = await authorizeExternalOperatorDocument({
  auth: { mode: 'disabled', subject: '' }, documentId: 'doc-1', loadOwnedCandidate: async () => ({ ownerSubject: 'user-1', candidate }),
})
assert(disabled.ok === false && disabled.error === 'external_auth_required', 'external calls must reject disabled/local auth')

const missingId = await authorizeExternalOperatorDocument({ auth, documentId: '', loadOwnedCandidate: async () => null })
assert(missingId.ok === false && missingId.status === 400 && missingId.error === 'document_id_required', 'missing document id must fail')

const noRepository = await authorizeExternalOperatorDocument({ auth, documentId: 'doc-1' })
assert(noRepository.ok === false && noRepository.status === 503, 'missing backend repository must fail closed')

const wrongOwner = await authorizeExternalOperatorDocument({
  auth, documentId: 'doc-1', loadOwnedCandidate: async () => ({ ownerSubject: 'user-2', candidate }),
})
assert(wrongOwner.ok === false && wrongOwner.status === 404 && wrongOwner.error === 'document_not_available', 'cross-account document must be hidden')

const identityMismatch = await authorizeExternalOperatorDocument({
  auth, documentId: 'doc-1', loadOwnedCandidate: async () => ({ ownerSubject: 'user-1', candidate: { document: { internalId: 'doc-2' } } }),
})
assert(identityMismatch.ok === false && identityMismatch.status === 409, 'repository/candidate identity mismatch must fail')

const allowed = await authorizeExternalOperatorDocument({
  auth, documentId: 'doc-1', loadOwnedCandidate: async (id) => id === 'doc-1' ? { ownerSubject: 'user-1', candidate } : null,
})
assert(allowed.ok === true && allowed.candidate === candidate, 'owned canonical candidate must be authorized')
assert(EXTERNAL_OPERATOR_AUTHORIZATION_POLICY.clientPayloadAuthoritative === false, 'client payload must never be authoritative for external call')
assert(EXTERNAL_OPERATOR_AUTHORIZATION_POLICY.serverLoadedDocumentRequired === true, 'server-loaded canonical document must be required')
assert(EXTERNAL_OPERATOR_AUTHORIZATION_POLICY.backendDocumentRepositoryReady === false, 'repository must not be claimed ready before implementation')

console.log('External operator authorization test OK: JWT subject ownership, hidden cross-account IDs and canonical server document policy verified')
