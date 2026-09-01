import {
  KONTUR_T1_CONTRACT,
  buildKonturGenerateT1Url,
  buildKonturGetDocumentTypesUrl,
  generateKonturT1Xml,
  getKonturDocumentTypes,
  konturConfigStatus,
  konturPublicCapabilities,
} from '../server/providers/kontur.mjs'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

assert(KONTUR_T1_CONTRACT.documentTypeNamedId === 'LogisticsWaybill', 'wrong documentTypeNamedId')
assert(KONTUR_T1_CONTRACT.documentFunction === 'reception', 'wrong T1 function')
assert(KONTUR_T1_CONTRACT.documentVersion === 'kl_trn_mt_05_01', 'wrong T1 version')
assert(KONTUR_T1_CONTRACT.titleIndex === 0, 'wrong T1 titleIndex')

const generateUrl = new URL(buildKonturGenerateT1Url({ boxId: '11111111-1111-1111-1111-111111111111' }))
assert(generateUrl.hostname === 'diadoc-api.kontur.ru', 'wrong Kontur API host')
assert(generateUrl.pathname === '/GenerateTitleXml', 'wrong GenerateTitleXml path')
assert(generateUrl.searchParams.get('documentTypeNamedId') === 'LogisticsWaybill', 'missing LogisticsWaybill query')
assert(generateUrl.searchParams.get('documentFunction') === 'reception', 'missing reception query')
assert(generateUrl.searchParams.get('documentVersion') === 'kl_trn_mt_05_01', 'missing version query')
assert(generateUrl.searchParams.get('titleIndex') === '0', 'missing titleIndex query')

const typesUrl = new URL(buildKonturGetDocumentTypesUrl({ boxId: '22222222-2222-2222-2222-222222222222' }))
assert(typesUrl.pathname === '/V3/GetDocumentTypes', 'wrong GetDocumentTypes path')
assert(typesUrl.searchParams.get('boxId'), 'boxId missing in GetDocumentTypes')

const emptyStatus = konturConfigStatus({ boxId: '', accessToken: '' })
assert(emptyStatus.configured === false && emptyStatus.missing.length === 2, 'empty config must be rejected')
const caps = konturPublicCapabilities({ boxId: 'box', accessToken: 'secret' })
assert(caps.credentialsConfigured === true, 'configured capability must be detected')
assert(caps.generateTitleWiredToGateway === false, 'GenerateTitleXml must not be gateway-wired')
assert(caps.sendWiredToGateway === false, 'send must not be gateway-wired')
assert(!JSON.stringify(caps).includes('secret'), 'public capabilities must never expose token')

let generateRequest
const generated = await generateKonturT1Xml({
  boxId: 'box-1',
  accessToken: 'token-1',
  userDataXml: '<LogisticsWaybillConsignorTitle/>',
  baseUrl: 'https://example.test',
  fetchImpl: async (url, init) => {
    generateRequest = { url: String(url), init }
    return new Response('<Файл/>', { status: 200, headers: { 'content-type': 'application/xml' } })
  },
})
assert(generated === '<Файл/>', 'generated XML response not returned')
assert(generateRequest.init.method === 'POST', 'GenerateTitleXml must use POST')
assert(generateRequest.init.headers.authorization === 'Bearer token-1', 'Bearer token missing')
assert(generateRequest.init.headers['content-type'].startsWith('application/xml'), 'XML content type missing')
assert(generateRequest.init.body === '<LogisticsWaybillConsignorTitle/>', 'UserDataXml body changed')

let typesRequest
const types = await getKonturDocumentTypes({
  boxId: 'box-2',
  accessToken: 'token-2',
  baseUrl: 'https://example.test',
  fetchImpl: async (url, init) => {
    typesRequest = { url: String(url), init }
    return new Response(JSON.stringify({ DocumentTypes: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert(Array.isArray(types.DocumentTypes), 'GetDocumentTypes JSON not returned')
assert(typesRequest.init.headers.authorization === 'Bearer token-2', 'GetDocumentTypes Bearer token missing')

let missingTokenFailed = false
try {
  await generateKonturT1Xml({ boxId: 'box', accessToken: '', userDataXml: '<x/>', fetchImpl: async () => new Response('', { status: 200 }) })
} catch {
  missingTokenFailed = true
}
assert(missingTokenFailed, 'missing access token must fail before network request')

console.log('Kontur provider offline test OK: contract, URLs, Bearer auth and fail-closed gateway wiring verified')
