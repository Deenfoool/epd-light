const API_BASE = 'https://diadoc-api.kontur.ru'

export const KONTUR_T1_CONTRACT = Object.freeze({
  provider: 'kontur',
  documentTypeNamedId: 'LogisticsWaybill',
  documentFunction: 'reception',
  documentVersion: 'kl_trn_mt_05_01',
  titleIndex: 0,
  filePrefix: 'ON_TRNACLGROT',
})

export function konturConfigFromEnv(env = process.env) {
  return {
    boxId: String(env.EPD_KONTUR_BOX_ID || '').trim(),
    accessToken: String(env.EPD_KONTUR_ACCESS_TOKEN || '').trim(),
  }
}

export function konturConfigStatus(config = konturConfigFromEnv()) {
  const missing = []
  if (!config.boxId) missing.push('EPD_KONTUR_BOX_ID')
  if (!config.accessToken) missing.push('EPD_KONTUR_ACCESS_TOKEN')
  return {
    configured: missing.length === 0,
    missing,
    boxIdConfigured: Boolean(config.boxId),
    accessTokenConfigured: Boolean(config.accessToken),
  }
}

function requireValue(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name} is required`)
  return String(value).trim()
}

export function buildKonturGetDocumentTypesUrl({ boxId, baseUrl = API_BASE }) {
  const id = requireValue(boxId, 'boxId')
  const url = new URL('/V3/GetDocumentTypes', baseUrl)
  url.searchParams.set('boxId', id)
  return url.toString()
}

export function buildKonturGenerateT1Url({ boxId, baseUrl = API_BASE }) {
  const id = requireValue(boxId, 'boxId')
  const url = new URL('/GenerateTitleXml', baseUrl)
  url.searchParams.set('boxId', id)
  url.searchParams.set('documentTypeNamedId', KONTUR_T1_CONTRACT.documentTypeNamedId)
  url.searchParams.set('documentFunction', KONTUR_T1_CONTRACT.documentFunction)
  url.searchParams.set('documentVersion', KONTUR_T1_CONTRACT.documentVersion)
  url.searchParams.set('titleIndex', String(KONTUR_T1_CONTRACT.titleIndex))
  return url.toString()
}

function bearerHeaders(accessToken, contentType) {
  const token = requireValue(accessToken, 'accessToken')
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  }
  if (contentType) headers['content-type'] = contentType
  return headers
}

/**
 * Reads document contracts available in the configured Diadoc box.
 * This is metadata discovery only; it does not create, sign or send an EPD.
 */
export async function getKonturDocumentTypes({ boxId, accessToken, fetchImpl = fetch, baseUrl = API_BASE }) {
  const response = await fetchImpl(buildKonturGetDocumentTypesUrl({ boxId, baseUrl }), {
    method: 'GET',
    headers: bearerHeaders(accessToken),
  })
  if (!response.ok) {
    throw new Error(`Kontur GetDocumentTypes failed with HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * Generates T1 XML from operator-specific UserDataXml through Diadoc GenerateTitleXml.
 * IMPORTANT: generated XML is still not signed and this function does not send it.
 * The gateway does not expose this function until provider credentials and the
 * UserData mapping are validated in a controlled integration environment.
 */
export async function generateKonturT1Xml({ boxId, accessToken, userDataXml, fetchImpl = fetch, baseUrl = API_BASE }) {
  const xml = requireValue(userDataXml, 'userDataXml')
  const response = await fetchImpl(buildKonturGenerateT1Url({ boxId, baseUrl }), {
    method: 'POST',
    headers: {
      ...bearerHeaders(accessToken, 'application/xml; charset=utf-8'),
      accept: 'application/xml',
    },
    body: xml,
  })
  if (!response.ok) {
    throw new Error(`Kontur GenerateTitleXml failed with HTTP ${response.status}`)
  }
  return response.text()
}

export function konturPublicCapabilities(config = konturConfigFromEnv()) {
  const status = konturConfigStatus(config)
  return {
    provider: 'kontur',
    adapterAvailable: true,
    credentialsConfigured: status.configured,
    boxIdConfigured: status.boxIdConfigured,
    accessTokenConfigured: status.accessTokenConfigured,
    contract: KONTUR_T1_CONTRACT,
    generateTitleWiredToGateway: false,
    sendWiredToGateway: false,
    note: 'Adapter реализует discovery и GenerateTitleXml как серверные функции, но gateway не открывает их наружу до завершения mapping/auth тестов.',
  }
}
