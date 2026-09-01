import {
  KONTUR_T1_CONTRACT,
  analyzeKonturT1Contract,
  buildKonturContentUrl,
  buildKonturGenerateT1Url,
  buildKonturGetDocumentTypesUrl,
  discoverKonturT1Descriptor,
  findKonturT1Descriptor,
  generateKonturT1Xml,
  getKonturContent,
  getKonturDocumentTypes,
  konturConfigStatus,
  konturPublicCapabilities,
  listKonturLogisticsWaybillContracts,
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

const contentUrl = new URL(buildKonturContentUrl({ contentPath: '/GetContent?typeNamedId=LogisticsWaybill&function=reception&version=kl_trn_mt_05_01&titleIndex=0&contentType=UserContractXsd' }))
assert(contentUrl.pathname === '/GetContent', 'GetContent URL must resolve against Diadoc host')
assert(contentUrl.searchParams.get('contentType') === 'UserContractXsd', 'GetContent contentType lost')

const descriptorFixture = {
  DocumentTypes: [{
    Name: 'LogisticsWaybill',
    Functions: [{
      Name: 'reception',
      Versions: [{
        Version: 'kl_trn_mt_05_01',
        Titles: [{
          Index: 0,
          IsFormal: true,
          XsdUrl: '/GetContent?typeNamedId=LogisticsWaybill&function=reception&version=kl_trn_mt_05_01&titleIndex=0&contentType=TitleXsd',
          UserDataXsdUrl: '/GetContent?typeNamedId=LogisticsWaybill&function=reception&version=kl_trn_mt_05_01&titleIndex=0&contentType=UserContractXsd',
          SignerInfo: { SignerUserDataXsdUrl: '/GetContent?typeNamedId=LogisticsWaybill&function=reception&version=kl_trn_mt_05_01&titleIndex=0&contentType=SignerUserContractXsd' },
        }],
      }],
    }],
  }],
}
const descriptor = findKonturT1Descriptor(descriptorFixture)
assert(descriptor?.documentTypeNamedId === 'LogisticsWaybill', 'T1 descriptor type not found')
assert(descriptor?.documentFunction === 'reception', 'T1 descriptor function not found')
assert(descriptor?.documentVersion === 'kl_trn_mt_05_01', 'T1 descriptor version not found')
assert(descriptor?.titleIndex === 0, 'T1 descriptor title not found')
assert(descriptor?.xsdUrl.includes('TitleXsd'), 'XsdUrl missing from descriptor')
assert(descriptor?.userDataXsdUrl.includes('UserContractXsd'), 'UserDataXsdUrl missing from descriptor')
assert(findKonturT1Descriptor({ DocumentTypes: [] }) === null, 'unknown contract must not be guessed')
const pinnedAnalysis = analyzeKonturT1Contract(descriptorFixture)
assert(pinnedAnalysis.matchesPinned === true, 'pinned contract analysis should match')
assert(pinnedAnalysis.available.length === 1, 'pinned fixture should expose one available title')

const driftFixture = {
  DocumentTypes: [{
    Name: 'LogisticsWaybill',
    Functions: [{
      Name: 'reception',
      Versions: [{
        Version: 'kl_trn_mt_06_00',
        Titles: [{ Index: 0, IsFormal: true, XsdUrl: '/new-title.xsd', UserDataXsdUrl: '/new-userdata.xsd' }],
      }],
    }, {
      Name: 'other-function',
      Versions: [{ Version: '1', Titles: [{ Index: 0, IsFormal: true, XsdUrl: '/other.xsd', UserDataXsdUrl: '/other-user.xsd' }] }],
    }],
  }],
}
const available = listKonturLogisticsWaybillContracts(driftFixture)
assert(available.some((x) => x.documentVersion === 'kl_trn_mt_06_00' && x.documentFunction === 'reception'), 'new reception version should be visible as metadata')
const driftAnalysis = analyzeKonturT1Contract(driftFixture)
assert(driftAnalysis.matchesPinned === false, 'new version must not silently match pinned contract')
assert(driftAnalysis.descriptor === null, 'drift analysis must not auto-select a new version')
assert(driftAnalysis.pinned.documentVersion === 'kl_trn_mt_05_01', 'pinned version must remain unchanged')

const emptyStatus = konturConfigStatus({ boxId: '', accessToken: '' })
assert(emptyStatus.configured === false && emptyStatus.missing.length === 2, 'empty config must be rejected')
const caps = konturPublicCapabilities({ boxId: 'box', accessToken: 'secret' })
assert(caps.credentialsConfigured === true, 'configured capability must be detected')
assert(caps.schemaDiscoveryReady === true, 'schema discovery should be ready server-side')
assert(caps.schemaDriftFailClosed === true, 'schema drift must remain fail-closed')
assert(caps.schemaDiscoveryWiredToGateway === false, 'schema discovery must not be public gateway route')
assert(caps.userDataPreviewWiredToGateway === true, 'local UserData preview should be gateway-wired')
assert(caps.userDataPreviewExternalCall === false, 'UserData preview must remain local-only')
assert(caps.generateTitleBoundaryReady === true, 'server-only GenerateTitle boundary should be ready')
assert(caps.generateTitleWiredToGateway === false, 'GenerateTitleXml must not be gateway-wired')
assert(caps.postMessageImplemented === false, 'PostMessage must remain unimplemented')
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

let discoveryCalls = 0
const discovered = await discoverKonturT1Descriptor({
  boxId: 'box-3',
  accessToken: 'token-3',
  baseUrl: 'https://example.test',
  fetchImpl: async () => {
    discoveryCalls += 1
    return new Response(JSON.stringify(descriptorFixture), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert(discoveryCalls === 1, 'schema discovery should call GetDocumentTypes once')
assert(discovered.userDataXsdUrl.includes('UserContractXsd'), 'discovery did not return UserDataXsdUrl')

let driftFailed = false
try {
  await discoverKonturT1Descriptor({
    boxId: 'box-drift', accessToken: 'token-drift', baseUrl: 'https://example.test',
    fetchImpl: async () => new Response(JSON.stringify(driftFixture), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
} catch (error) {
  driftFailed = error?.code === 'kontur_contract_drift'
    && error?.pinned?.documentVersion === 'kl_trn_mt_05_01'
    && Array.isArray(error?.available)
    && error.available.some((x) => x.documentVersion === 'kl_trn_mt_06_00')
}
assert(driftFailed, 'schema discovery must fail closed and report available versions on drift')

let contentRequest
const content = await getKonturContent({
  contentPath: discovered.userDataXsdUrl,
  accessToken: 'token-4',
  baseUrl: 'https://example.test',
  fetchImpl: async (url, init) => {
    contentRequest = { url: String(url), init }
    return new Response('<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>', { status: 200, headers: { 'content-type': 'application/xml' } })
  },
})
assert(content.includes('<xs:schema'), 'GetContent XML not returned')
assert(new URL(contentRequest.url).pathname === '/GetContent', 'GetContent wrong path')
assert(contentRequest.init.headers.authorization === 'Bearer token-4', 'GetContent Bearer token missing')

let missingTokenFailed = false
try {
  await generateKonturT1Xml({ boxId: 'box', accessToken: '', userDataXml: '<x/>', fetchImpl: async () => new Response('', { status: 200 }) })
} catch {
  missingTokenFailed = true
}
assert(missingTokenFailed, 'missing access token must fail before network request')

console.log('Kontur provider offline test OK: schema discovery/drift, Bearer auth, private GenerateTitle boundary and fail-closed sending verified')
