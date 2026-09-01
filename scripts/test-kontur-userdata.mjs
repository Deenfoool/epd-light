import { buildKonturT1UserDataXml, validateKonturT1Candidate } from '../server/providers/kontur-userdata.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const address = (region, city) => ({ zipCode: '620050', region, city, settlement: '', street: 'Ленина', building: '1', corpus: '', apartment: '' })
const party = (boxId, name, inn, kpp, phone) => ({ kind: 'org', name, inn, kpp, address: '', russianAddress: address('66', 'Екатеринбург'), phone, email: '', edoId: boxId })

const candidate = {
  kind: 'epd-light/operator-candidate-v1',
  draftModelVersion: 3,
  readiness: { candidate: true, operatorFieldsMissing: 0, warnings: 0 },
  document: { number: 'ЭТрН-2026-001', date: '2026-09-01', orderNumber: 'ЗАЯВКА-1', orderDate: '2026-08-31', contractNumber: '', contractDate: '' },
  participants: {
    shipper: party('11111111-1111-4111-8111-111111111111', 'ООО «Отправитель»', '7700000000', '770001001', '+79000000001'),
    consignee: party('22222222-2222-4222-8222-222222222222', 'ООО «Получатель»', '6900000000', '690001001', '+79000000002'),
    carrier: party('33333333-3333-4333-8333-333333333333', 'ООО «Перевозчик»', '7800000000', '780001001', '+79000000003'),
  },
  route: {
    loadingAddress: 'Москва, Тестовая, 1', loadingRussianAddress: address('77', 'Москва'),
    plannedLoadingDate: '2026-09-01', plannedLoadingTime: '09:00', actualArrival: '2026-09-01T08:55', actualDeparture: '2026-09-01T09:20',
    unloadingAddress: 'Тверь, Примерная, 2', unloadingRussianAddress: address('69', 'Тверь'), plannedUnloadingDate: '2026-09-01', plannedUnloadingTime: '15:00', note: '',
  },
  loadingFacts: { actualGrossWeight: '840', actualPlaces: '12', massDeterminationMethod: '01' },
  cargo: [{ internalId: '1', name: 'Товар & тест', state: 'Целый', places: '12', unit: 'мест', grossWeightKg: '840', declaredValue: '', currencyCode: '643', packaging: 'короб', packagingMethod: 'Коробки', packagingCode: '00', marking: 'Отсутствует', specialConditions: '' }],
  vehicle: { registrationNumber: 'А001АА777', trailerRegistrationNumber: '', type: 'грузовой автомобиль', brand: 'КАМАЗ', model: '5490', ownershipType: '1', loadCapacity: '20', volumeCapacity: '82' },
  driver: { fullName: 'Иванов Иван Иванович', phone: '+79000000003', licenseLegacy: '', licenseSeries: '9999', licenseNumber: '123456', licenseIssueDate: '2024-01-20', waybillNumber: '', waybillDate: '' },
  shipperInstructions: { instructions: 'Особых указаний нет', redirectionContact: '+79000000001' },
  signer: { fullName: 'Петров Петр Петрович', position: 'Кладовщик' },
  commercial: { carriagePrice: '', comment: '', extra: '' },
}

const validation = validateKonturT1Candidate(candidate)
assert(validation.ok, `valid candidate rejected: ${validation.errors.join('; ')}`)
const xml = buildKonturT1UserDataXml(candidate)
for (const snippet of [
  '<LogisticsWaybillConsignorTitle',
  'Number="ЭТрН-2026-001"',
  'Date="01.09.2026"',
  '<OrganizationReference BoxId="11111111-1111-4111-8111-111111111111">',
  '<DeliveryAddres><AddressLogisticsWaybill><RussianAddress',
  'Region="69"',
  'Name="Товар &amp; тест"',
  '<DriverInfo LastName="Иванов" FirstName="Иван" MiddleName="Иванович"',
  '<Vehicle Number="А001АА777" Ownership="1"',
  'StatedArrivalDateTime="01.09.2026T09:00:00"',
  'StatedArrivalDateTimeEnablingTimeZone="0"',
  '<Signer SignerType="1"><SignerDetails Position="Кладовщик" LastName="Петров" FirstName="Петр" MiddleName="Петрович"',
]) assert(xml.includes(snippet), `XML missing: ${snippet}`)
assert(!xml.includes('Товар & тест'), 'XML attribute escaping failed')

const ipCandidate = structuredClone(candidate)
ipCandidate.participants.carrier.kind = 'ip'
assert(validateKonturT1Candidate(ipCandidate).ok === false, 'IP mapping must remain blocked until verified')

const noAddress = structuredClone(candidate)
noAddress.route.loadingRussianAddress.region = ''
assert(validateKonturT1Candidate(noAddress).ok === false, 'missing structured loading region must fail')

const badBox = structuredClone(candidate)
badBox.participants.shipper.edoId = '7700000000'
assert(validateKonturT1Candidate(badBox).ok === false, 'INN must not be accepted as Diadoc BoxId')

console.log('Kontur UserDataXml preview test OK: validation, escaping, T1 structure and fail-closed cases verified')
