import { authorizeExternalOperatorDocument } from '../authorization.mjs'
import { buildKonturT1UserDataXml, validateKonturT1Candidate } from '../providers/kontur-userdata.mjs'
import { KONTUR_T1_CONTRACT, generateKonturT1Xml, konturConfigFromEnv, konturConfigStatus } from '../providers/kontur.mjs'

/**
 * Low-level server-only boundary for controlled utilities/tests.
 * It validates an already canonical candidate, builds Diadoc UserDataXml and
 * calls GenerateTitleXml. It NEVER signs or sends the generated title.
 *
 * IMPORTANT: do not expose this function directly from a gateway route.
 */
export async function generateKonturT1FromCandidate({
  candidate,
  config,
  fetchImpl = fetch,
  baseUrl,
}) {
  const validation = validateKonturT1Candidate(candidate)
  if (!validation.ok) {
    const error = new Error('Kontur T1 candidate validation failed')
    error.code = 'kontur_candidate_invalid'
    error.validation = validation
    throw error
  }

  const resolvedConfig = config ?? konturConfigFromEnv()
  const configStatus = konturConfigStatus(resolvedConfig)
  if (!configStatus.configured) {
    const error = new Error(`Kontur server configuration incomplete: ${configStatus.missing.join(', ')}`)
    error.code = 'kontur_config_incomplete'
    error.missing = configStatus.missing
    throw error
  }

  const userDataXml = buildKonturT1UserDataXml(candidate)
  const generatedXml = await generateKonturT1Xml({
    boxId: resolvedConfig.boxId,
    accessToken: resolvedConfig.accessToken,
    userDataXml,
    fetchImpl,
    ...(baseUrl ? { baseUrl } : {}),
  })

  return {
    provider: 'kontur',
    contract: KONTUR_T1_CONTRACT,
    generatedXml,
    userDataXml,
    externalCallMade: true,
    signed: false,
    sent: false,
    warning: 'GenerateTitleXml создаёт XML титула, но результат не подписан и не отправлен через PostMessage.',
  }
}

/**
 * Future gateway-facing boundary. It refuses client-supplied candidate data and
 * requires a backend repository to load the canonical candidate owned by JWT sub.
 */
export async function generateAuthorizedKonturT1({
  auth,
  documentId,
  loadOwnedCandidate,
  config,
  fetchImpl = fetch,
  baseUrl,
}) {
  const authorization = await authorizeExternalOperatorDocument({ auth, documentId, loadOwnedCandidate })
  if (!authorization.ok) {
    const error = new Error(`Kontur external authorization failed: ${authorization.error}`)
    error.code = authorization.error
    error.statusCode = authorization.status
    throw error
  }
  return generateKonturT1FromCandidate({
    candidate: authorization.candidate,
    config,
    fetchImpl,
    baseUrl,
  })
}

export const KONTUR_GENERATION_BOUNDARY = Object.freeze({
  serverOnly: true,
  gatewayRouteExposed: false,
  verifiedJwtSubjectRequiredForGateway: true,
  serverLoadedDocumentRequiredForGateway: true,
  clientPayloadAuthoritative: false,
  callsGenerateTitleXml: true,
  callsPostMessage: false,
  signsDocument: false,
})
