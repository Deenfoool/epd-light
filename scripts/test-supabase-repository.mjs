import {
  buildSupabaseDocumentUrl,
  createSupabaseOwnedCandidateLoader,
  loadSupabaseDocumentWithUserToken,
  supabaseDocumentRepositoryPublicCapabilities,
} from '../server/repositories/supabase-documents.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const config = { baseUrl: 'https://project.example.test', publicApiKey: 'public-anon-key' }
const row = {
  id: 'doc-1',
  user_id: 'user-1',
  doc_number: 'ЭТрН-1',
  doc_date: '2026-09-01',
  status: 'ready',
  data: {
    shipper: { kind: 'org', name: 'ООО A', inn: '7700000000', kpp: '770001001', phone: '+79000000001', email: '', address: '', edoId: '11111111-1111-1111-1111-111111111111', russianAddress: { region: '77', city: 'Москва' } },
    consignee: { kind: 'org', name: 'ООО B', inn: '7800000000', kpp: '780001001', phone: '+79000000002', email: '', address: '', edoId: '22222222-2222-2222-2222-222222222222', russianAddress: { region: '69', city: 'Тверь' } },
    carrier: { kind: 'org', name: 'ООО C', inn: '7900000000', kpp: '790001001', phone: '+79000000003', email: '', address: '', edoId: '33333333-3333-3333-3333-333333333333', russianAddress: { region: '78', city: 'Санкт-Петербург' } },
    route: { loadAddress: 'Москва', loadRussianAddress: { region: '77', city: 'Москва' }, loadDate: '2026-09-01', loadTime: '09:00', loadArrival: '2026-09-01T08:55', loadDeparture: '2026-09-01T09:20', unloadAddress: 'Тверь', unloadRussianAddress: { region: '69', city: 'Тверь' }, unloadDate: '2026-09-01', unloadTime: '15:00', massMethod: '01', actualWeight: '', actualPlaces: '' },
    loadingDetails: { matchingShipper: '1', employeeFullName: 'Сидоров Иван Иванович', employeePosition: 'Кладовщик', ownerType: '1', ownerInn: '7700000000' },
    cargo: [{ id: 'cargo-1', name: 'Груз', state: 'Целый', places: '2', unit: 'мест', weight: '100', packaging: 'короб', packagingMethod: 'Коробки', packagingCode: '00', marking: 'Отсутствует' }],
    transport: { plate: 'А001АА777', vehicleType: 'грузовой автомобиль', brand: 'Тест', model: 'Truck', ownershipType: '1', loadCapacity: '20', volumeCapacity: '80', driverName: 'Иванов Иван Иванович', driverPhone: '+79000000003', driverLicenseSeries: '9999', driverLicenseNumber: '123456', driverLicenseDate: '2024-01-20' },
    terms: { orderNumber: 'ORDER-1', orderDate: '2026-08-31', shipperInstructions: 'Отсутствуют', redirectionContact: '', contractNumber: '', contractDate: '', price: '', comment: '', extra: '' },
    signer: { fullName: 'Петров Петр Петрович', position: 'Кладовщик' },
  },
}

const url = new URL(buildSupabaseDocumentUrl({ baseUrl: config.baseUrl, documentId: 'doc-1' }))
assert(url.pathname === '/rest/v1/documents', 'wrong Supabase documents path')
assert(url.searchParams.get('id') === 'eq.doc-1', 'document RLS query must filter exact id')
assert(url.searchParams.get('limit') === '1', 'document query must be limited to one row')

let request
const loaded = await loadSupabaseDocumentWithUserToken({
  documentId: 'doc-1',
  accessToken: 'verified-user-jwt',
  config,
  fetchImpl: async (input, init) => {
    request = { input: String(input), init }
    return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
assert(loaded.id === 'doc-1', 'repository did not return row')
assert(request.init.headers.apikey === 'public-anon-key', 'public Data API key missing')
assert(request.init.headers.authorization === 'Bearer verified-user-jwt', 'user JWT must carry RLS context')
assert(!JSON.stringify(supabaseDocumentRepositoryPublicCapabilities(config)).includes('public-anon-key'), 'capabilities must not expose API key value')
assert(supabaseDocumentRepositoryPublicCapabilities(config).serviceRoleRequired === false, 'service_role must not be required')

const loader = createSupabaseOwnedCandidateLoader({
  accessToken: 'verified-user-jwt',
  config,
  fetchImpl: async () => new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } }),
})
const owned = await loader('doc-1')
assert(owned.ownerSubject === 'user-1', 'repository owner subject missing')
assert(owned.candidate.document.internalId === 'doc-1', 'canonical candidate must preserve document identity')
assert(owned.candidate.canonicalSource === 'server-documents-row', 'candidate must identify canonical server source')
assert(owned.candidate.loadingFacts.actualGrossWeight === '100', 'canonical mapper should fall back to cargo total weight')
assert(owned.candidate.loadingFacts.actualPlaces === '2', 'canonical mapper should fall back to cargo total places')
assert(owned.candidate.readiness.requiresServerValidation === true, 'canonical candidate must require server validation')

const hidden = createSupabaseOwnedCandidateLoader({
  accessToken: 'verified-user-jwt', config,
  fetchImpl: async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
})
assert(await hidden('other-doc') === null, 'RLS-hidden/unknown document must return null')

let networkCalled = false
let missingTokenRejected = false
try {
  await loadSupabaseDocumentWithUserToken({ documentId: 'doc-1', accessToken: '', config, fetchImpl: async () => { networkCalled = true } })
} catch (error) {
  missingTokenRejected = error?.code === 'document_repository_token_required'
}
assert(missingTokenRejected && networkCalled === false, 'missing user JWT must fail before Data API request')

console.log('Supabase document repository test OK: user JWT RLS context, canonical mapper, hidden documents and no service_role verified')
