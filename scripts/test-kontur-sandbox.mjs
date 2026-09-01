import {
  generateKonturSandboxTitleForDocument,
  validateSandboxGenerateRequest,
} from '../server/services/kontur-sandbox.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const address = (region, city) => ({ zipCode: '123456', region, city, settlement: '', street: 'Тестовая', building: '1', corpus: '', apartment: '' })
const party = (boxId, inn, phone, city = 'Москва', region = '77') => ({
  kind: 'org', name: 'ООО Тест', inn, kpp: `${inn.slice(0,4)}01001`, phone, email: '', address: city,
  edoId: boxId, russianAddress: address(region, city),
})

const row = {
  id: documentId,
  user_id: userId,
  doc_number: 'ЭТрН-SBX-1',
  doc_date: '2026-09-01',
  status: 'ready',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  data: {
    shipper: party('11111111-1111-4111-8111-111111111111', '7700000000', '+79000000001'),
    consignee: party('22222222-2222-4222-8222-222222222222', '6900000000', '+79000000002', 'Тверь', '69'),
    carrier: party('33333333-3333-4333-8333-333333333333', '7800000000', '+79000000003', 'Санкт-Петербург', '78'),
    route: {
      loadAddress: 'Москва, Тестовая, 1', loadRussianAddress: address('77', 'Москва'), loadDate: '2026-09-01', loadTime: '09:00',
      loadArrival: '2026-09-01T08:55', loadDeparture: '2026-09-01T09:20', actualWeight: '100', actualPlaces: '2', massMethod: '01',
      unloadAddress: 'Тверь, Тестовая, 2', unloadRussianAddress: address('69', 'Тверь'), unloadDate: '2026-09-01', unloadTime: '15:00', note: '',
    },
    loadingDetails: {
      matchingShipper: '1', employeeFullName: 'Сидоров Иван Иванович', employeePosition: 'Кладовщик',
      employeeResponsibilities: 'Передача груза', partyInn: '', ownerType: '1', ownerInn: '7700000000',
    },
    cargo: [{ id: 'cargo-1', name: 'Тестовый груз', state: 'Целый', places: '2', unit: 'мест', weight: '100', value: '', currency: '643', packaging: 'короб', packagingMethod: 'Коробки', packagingCode: '00', marking: 'Отсутствует', conditions: '' }],
    transport: {
      plate: 'А001АА777', trailerPlate: '', vehicleType: 'грузовой автомобиль', brand: 'Тест', model: 'Truck', ownershipType: '1', loadCapacity: '20', volumeCapacity: '80',
      driverName: 'Иванов Иван Иванович', driverPhone: '+79000000003', driverLicense: '', driverLicenseSeries: '9999', driverLicenseNumber: '123456', driverLicenseDate: '2024-01-20', waybillNumber: 'ПЛ-1', waybillDate: '2026-09-01',
    },
    terms: { orderNumber: 'ORDER-1', orderDate: '2026-08-31', contractNumber: '', contractDate: '', shipperInstructions: 'Особых указаний нет', redirectionContact: '', price: '', comment: '', extra: '' },
    signer: { fullName: 'Петров Петр Петрович', position: 'Кладовщик' },
  },
}

const validRequest = validateSandboxGenerateRequest({ documentId })
assert(validRequest.ok && validRequest.documentId === documentId, 'documentId-only request should be accepted')
assert(validateSandboxGenerateRequest({ documentId, candidate: { forged: true } }).error === 'sandbox_payload_rejected', 'client candidate payload must be rejected')
assert(validateSandboxGenerateRequest({ documentId: 'not-a-uuid' }).error === 'document_id_invalid', 'invalid document id must fail')

const auth = { ok: true, mode: 'supabase', subject: userId, role: 'authenticated' }
Object.defineProperty(auth, 'accessToken', { value: 'user-access-token', enumerable: false })

let repositoryRequest
let konturRequest
const baseArgs = {
  auth,
  documentId,
  repositoryConfig: { baseUrl: 'https://supabase.test', publicApiKey: 'public-key' },
  konturConfig: { boxId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', accessToken: 'operator-secret' },
  konturBaseUrl: 'https://kontur.test',
}
const result = await generateKonturSandboxTitleForDocument({
  ...baseArgs,
  repositoryFetchImpl: async (url, init) => {
    repositoryRequest = { url: String(url), init }
    return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } })
  },
  konturFetchImpl: async (url, init) => {
    konturRequest = { url: String(url), init }
    return new Response('<Файл ВерсФорм="5.01"/>', { status: 200, headers: { 'content-type': 'application/xml' } })
  },
})

const repositoryUrl = new URL(repositoryRequest.url)
assert(repositoryUrl.pathname === '/rest/v1/documents', 'sandbox must reload document through Data API')
assert(repositoryUrl.searchParams.get('id') === `eq.${documentId}`, 'repository must request only requested document id')
assert(repositoryRequest.init.headers.authorization === 'Bearer user-access-token', 'repository must use verified user JWT for RLS')
assert(repositoryRequest.init.headers.apikey === 'public-key', 'repository must use public key, not service_role')

const konturUrl = new URL(konturRequest.url)
assert(konturUrl.pathname === '/GenerateTitleXml', 'sandbox boundary must call GenerateTitleXml only')
assert(konturUrl.searchParams.get('documentTypeNamedId') === 'LogisticsWaybill', 'wrong Kontur document type')
assert(konturRequest.init.headers.authorization === 'Bearer operator-secret', 'operator token must stay server-side')
assert(konturRequest.init.body.includes('Number="ЭТрН-SBX-1"'), 'GenerateTitleXml must use canonical row data')
assert(result.generatedXml.includes('ВерсФорм="5.01"'), 'generated title must be returned')
assert(result.signed === false && result.sent === false, 'sandbox generation must not claim signing/sending')
assert(/^[0-9a-f]{64}$/.test(result.idempotency?.idempotencyKey || ''), 'sandbox result must expose safe sha256 idempotency key')
assert(/^[0-9a-f]{64}$/.test(result.idempotency?.requestFingerprint || ''), 'sandbox result must expose safe request fingerprint')
assert(result.idempotency?.sourceRevision === row.updated_at, 'idempotency must bind to canonical documents.updated_at')
assert(result.idempotency?.completedPersistenceWired === false, 'completed-attempt persistence must not be claimed yet')

let concurrentExternalCalls = 0
let releaseConcurrent
const concurrentGate = new Promise((resolve) => { releaseConcurrent = resolve })
const concurrentArgs = {
  ...baseArgs,
  repositoryFetchImpl: async () => new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } }),
  konturFetchImpl: async () => {
    concurrentExternalCalls += 1
    await concurrentGate
    return new Response('<Файл ВерсФорм="5.01"/>', { status: 200, headers: { 'content-type': 'application/xml' } })
  },
}
const concurrentA = generateKonturSandboxTitleForDocument(concurrentArgs)
const concurrentB = generateKonturSandboxTitleForDocument(concurrentArgs)
await new Promise((resolve) => setTimeout(resolve, 0))
assert(concurrentExternalCalls === 1, 'concurrent same-revision sandbox calls must collapse to one external request')
releaseConcurrent()
const concurrentResults = await Promise.all([concurrentA, concurrentB])
assert(concurrentResults.filter((x) => x.idempotency.sharedInFlight).length === 1, 'one concurrent caller must share the in-flight external result')
assert(concurrentResults[0].idempotency.idempotencyKey === concurrentResults[1].idempotency.idempotencyKey, 'concurrent callers must use the same action identity')

let crossAccountExternalCall = false
let crossAccountHidden = false
try {
  await generateKonturSandboxTitleForDocument({
    ...baseArgs,
    repositoryFetchImpl: async () => new Response(JSON.stringify([{ ...row, user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }]), { status: 200 }),
    konturFetchImpl: async () => { crossAccountExternalCall = true; return new Response('<x/>', { status: 200 }) },
  })
} catch (error) {
  crossAccountHidden = error?.code === 'document_not_available'
}
assert(crossAccountHidden, 'cross-account document must be hidden as unavailable')
assert(crossAccountExternalCall === false, 'cross-account document must fail before Kontur request')
assert(JSON.stringify(auth).includes('user-access-token') === false, 'verified user token must stay non-enumerable')

console.log('Kontur sandbox test OK: documentId-only JWT/RLS flow, revision idempotency, concurrent dedupe and ownership verified')
