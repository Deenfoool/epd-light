import { generateKonturT1FromCandidate, KONTUR_GENERATION_BOUNDARY } from '../server/services/kontur-title.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const address = (region, city) => ({ zipCode: '620050', region, city, settlement: '', street: 'Ленина', building: '1', corpus: '', apartment: '' })
const party = (boxId, inn, phone) => ({ kind: 'org', name: 'ООО Тест', inn, kpp: '770001001', address: '', russianAddress: address('77', 'Москва'), phone, email: '', edoId: boxId })

const candidate = {
  kind: 'epd-light/operator-candidate-v1',
  draftModelVersion: 4,
  document: { number: 'TEST-1', date: '2026-09-01', orderNumber: 'ORDER-1', orderDate: '2026-09-01' },
  participants: {
    shipper: party('11111111-1111-1111-1111-111111111111', '7700000000', '+79000000001'),
    consignee: party('22222222-2222-2222-2222-222222222222', '7800000000', '+79000000002'),
    carrier: party('33333333-3333-3333-3333-333333333333', '7900000000', '+79000000003'),
  },
  route: {
    loadingRussianAddress: address('77', 'Москва'), unloadingRussianAddress: address('69', 'Тверь'),
    plannedLoadingDate: '2026-09-01', plannedLoadingTime: '09:00', actualArrival: '2026-09-01T08:55', actualDeparture: '2026-09-01T09:20',
  },
  loadingFacts: { actualGrossWeight: '100', actualPlaces: '2', massDeterminationMethod: '01' },
  loadingDetails: { matchingShipper: '1', employeeFullName: 'Сидоров Иван Иванович', employeePosition: 'Кладовщик', employeeResponsibilities: '', partyInn: '', ownerType: '1', ownerInn: '7700000000' },
  cargo: [{ name: 'Тестовый груз', state: 'Целый', packagingMethod: 'Коробки', packagingCode: '00', places: '2', grossWeightKg: '100', marking: 'Отсутствует' }],
  vehicle: { registrationNumber: 'А001АА777', type: 'грузовой автомобиль', brand: 'Тест', model: 'Truck', ownershipType: '1', loadCapacity: '20', volumeCapacity: '80' },
  driver: { fullName: 'Иванов Иван Иванович', phone: '+79000000003', licenseSeries: '9999', licenseNumber: '123456', licenseIssueDate: '2024-01-20' },
  shipperInstructions: { instructions: 'Отсутствуют', redirectionContact: '' },
  signer: { fullName: 'Петров Петр Петрович', position: 'Кладовщик' },
}

let request
const result = await generateKonturT1FromCandidate({
  candidate,
  config: { boxId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', accessToken: 'server-secret' },
  baseUrl: 'https://example.test',
  fetchImpl: async (url, init) => {
    request = { url: String(url), init }
    return new Response('<Файл ВерсФорм="5.01"/>', { status: 200, headers: { 'content-type': 'application/xml' } })
  },
})

const url = new URL(request.url)
assert(url.pathname === '/GenerateTitleXml', 'boundary must call GenerateTitleXml only')
assert(url.searchParams.get('documentTypeNamedId') === 'LogisticsWaybill', 'wrong document type')
assert(url.searchParams.get('documentFunction') === 'reception', 'wrong document function')
assert(url.searchParams.get('documentVersion') === 'kl_trn_mt_05_01', 'wrong version')
assert(url.searchParams.get('titleIndex') === '0', 'wrong title index')
assert(request.init.headers.authorization === 'Bearer server-secret', 'server token missing')
assert(request.init.body.includes('<LogisticsWaybillConsignorTitle'), 'UserDataXml not passed to GenerateTitleXml')
assert(request.init.body.includes('<LoadingPartyDetails MatchingShipper="1">'), 'loading party mapping missing at boundary')
assert(result.generatedXml.includes('ВерсФорм="5.01"'), 'generated title XML not returned')
assert(result.signed === false && result.sent === false, 'boundary must never claim signing or sending')
assert(KONTUR_GENERATION_BOUNDARY.gatewayRouteExposed === false, 'external generation route must stay private')
assert(KONTUR_GENERATION_BOUNDARY.callsPostMessage === false, 'boundary must not call PostMessage')

let networkCalled = false
let configFailed = false
try {
  await generateKonturT1FromCandidate({
    candidate,
    config: { boxId: '', accessToken: '' },
    fetchImpl: async () => { networkCalled = true; return new Response('', { status: 200 }) },
  })
} catch (error) {
  configFailed = error?.code === 'kontur_config_incomplete'
}
assert(configFailed, 'missing server credentials must fail closed')
assert(networkCalled === false, 'missing config must fail before network call')

console.log('Kontur generation boundary test OK: candidate -> UserDataXml -> GenerateTitleXml, no signing/PostMessage, fail-closed config')
