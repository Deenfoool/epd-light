import { buildCanonicalOperatorCandidate } from '../mappers/operator-candidate.mjs'

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('EPD_DATA_SUPABASE_URL must use https outside localhost')
  }
  return url.toString().replace(/\/$/, '')
}

export function supabaseDocumentRepositoryConfigFromEnv(env = process.env) {
  return {
    baseUrl: normalizeBaseUrl(env.EPD_DATA_SUPABASE_URL || env.EPD_AUTH_SUPABASE_URL || ''),
    publicApiKey: String(env.EPD_DATA_SUPABASE_PUBLIC_KEY || '').trim(),
  }
}

export function supabaseDocumentRepositoryStatus(config = supabaseDocumentRepositoryConfigFromEnv()) {
  const missing = []
  if (!config.baseUrl) missing.push('EPD_DATA_SUPABASE_URL')
  if (!config.publicApiKey) missing.push('EPD_DATA_SUPABASE_PUBLIC_KEY')
  return {
    configured: missing.length === 0,
    missing,
    baseUrlConfigured: Boolean(config.baseUrl),
    publicApiKeyConfigured: Boolean(config.publicApiKey),
  }
}

export function buildSupabaseDocumentUrl({ baseUrl, documentId }) {
  const id = String(documentId || '').trim()
  if (!id) throw new Error('documentId is required')
  const url = new URL('/rest/v1/documents', baseUrl)
  url.searchParams.set('id', `eq.${id}`)
  url.searchParams.set('select', 'id,user_id,doc_number,doc_date,status,data,created_at,updated_at')
  url.searchParams.set('limit', '1')
  return url.toString()
}

/**
 * Loads a document using the verified user's JWT. Supabase RLS remains authoritative:
 * documents_own uses auth.uid() = user_id, so another account's ID returns no row.
 */
export async function loadSupabaseDocumentWithUserToken({
  documentId,
  accessToken,
  config = supabaseDocumentRepositoryConfigFromEnv(),
  fetchImpl = fetch,
}) {
  const status = supabaseDocumentRepositoryStatus(config)
  if (!status.configured) {
    const error = new Error(`Supabase document repository incomplete: ${status.missing.join(', ')}`)
    error.code = 'document_repository_unconfigured'
    error.missing = status.missing
    throw error
  }
  const token = String(accessToken || '').trim()
  if (!token) {
    const error = new Error('verified user access token is required for RLS document read')
    error.code = 'document_repository_token_required'
    throw error
  }

  const response = await fetchImpl(buildSupabaseDocumentUrl({ baseUrl: config.baseUrl, documentId }), {
    method: 'GET',
    headers: {
      apikey: config.publicApiKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })
  if (!response.ok) {
    const error = new Error(`Supabase document repository failed with HTTP ${response.status}`)
    error.code = 'document_repository_http_error'
    error.statusCode = response.status
    throw error
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) throw new Error('Supabase document repository returned non-array JSON')
  return rows[0] ?? null
}

export function createSupabaseOwnedCandidateLoader({
  accessToken,
  config = supabaseDocumentRepositoryConfigFromEnv(),
  fetchImpl = fetch,
} = {}) {
  return async (documentId) => {
    const row = await loadSupabaseDocumentWithUserToken({ documentId, accessToken, config, fetchImpl })
    if (!row) return null
    return {
      ownerSubject: String(row.user_id || ''),
      candidate: buildCanonicalOperatorCandidate(row),
    }
  }
}

export function supabaseDocumentRepositoryPublicCapabilities(config = supabaseDocumentRepositoryConfigFromEnv()) {
  const status = supabaseDocumentRepositoryStatus(config)
  return {
    adapterAvailable: true,
    configured: status.configured,
    baseUrlConfigured: status.baseUrlConfigured,
    publicApiKeyConfigured: status.publicApiKeyConfigured,
    usesUserJwt: true,
    reliesOnRls: true,
    serviceRoleRequired: false,
    canonicalCandidateMapperReady: true,
  }
}
