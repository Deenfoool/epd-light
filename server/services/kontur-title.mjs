import { buildKonturT1UserDataXml, validateKonturT1Candidate } from '../providers/kontur-userdata.mjs'
import { KONTUR_T1_CONTRACT, generateKonturT1Xml, konturConfigFromEnv, konturConfigStatus } from '../providers/kontur.mjs'

/**
 * Server-only boundary for the future sandbox integration.
 * It validates an EPD Light operator candidate, builds Diadoc UserDataXml and
 * calls GenerateTitleXml. It NEVER signs or sends the generated title.
 *
 * IMPORTANT: this function is intentionally not exposed by server/index.mjs.
 * The public gateway has no authenticated external-call route yet.
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

export const KONTUR_GENERATION_BOUNDARY = Object.freeze({
  serverOnly: true,
  gatewayRouteExposed: false,
  callsGenerateTitleXml: true,
  callsPostMessage: false,
  signsDocument: false,
})
