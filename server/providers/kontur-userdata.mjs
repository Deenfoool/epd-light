const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

const attr = (name, value) => String(value ?? '').trim() ? ` ${name}="${esc(String(value).trim())}"` : ''
const tag = (name, value) => String(value ?? '').trim() ? `<${name}>${esc(String(value).trim())}</${name}>` : ''

function ruDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function ruDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim())
  return m ? `${m[3]}.${m[2]}.${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}` : ''
}

function plannedDateTime(date, time) {
  const d = ruDate(date)
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || '').trim())
  return d && t ? `${d}T${t[1]}:${t[2]}:${t[3] || '00'}` : ''
}

function positiveNumber(value) {
  const normalized = String(value ?? '').trim().replace(',', '.')
  return normalized && Number.isFinite(Number(normalized)) && Number(normalized) > 0 ? normalized : ''
}

function fio(value, field, errors) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) {
    errors.push(`${field}: укажите как минимум фамилию и имя`)
    return { lastName: '', firstName: '', middleName: '' }
  }
  return { lastName: parts[0], firstName: parts[1], middleName: parts.slice(2).join(' ') }
}

function validateAddress(address, field, errors) {
  if (!address || typeof address !== 'object') {
    errors.push(`${field}: нет структурированного российского адреса`)
    return
  }
  if (!String(address.region || '').trim()) errors.push(`${field}: не указан код региона`)
  if (!String(address.city || '').trim() && !String(address.settlement || '').trim()) {
    errors.push(`${field}: укажите город или населённый пункт`)
  }
}

function russianAddressXml(address) {
  return `<RussianAddress${attr('ZipCode', address?.zipCode)}${attr('Region', address?.region)}${attr('City', address?.city)}${attr('Locality', address?.settlement)}${attr('Street', address?.street)}${attr('Building', address?.building)}${attr('Block', address?.corpus)}${attr('Apartment', address?.apartment)} />`
}

function partyReferenceXml(party, role, errors) {
  if (party?.kind !== 'org') errors.push(`${role}: первая версия Kontur mapping поддерживает только организации через OrganizationReference`)
  const boxId = String(party?.edoId || '').trim()
  if (!GUID_RE.test(boxId)) errors.push(`${role}: BoxId должен быть GUID Диадока`)
  const phone = String(party?.phone || '').trim()
  if (!phone) errors.push(`${role}: для текущего UserDataXml mapping нужен телефон`)
  return `<OrganizationReference${attr('BoxId', boxId)}>${phone ? `<Phones>${tag('Phone', phone)}</Phones>` : ''}</OrganizationReference>`
}

export function validateKonturT1Candidate(input) {
  const errors = []
  const warnings = []
  if (!input || typeof input !== 'object') return { ok: false, errors: ['payload должен быть JSON-объектом'], warnings }
  if (input.kind !== 'epd-light/operator-candidate-v1') errors.push('неподдерживаемый kind интеграционного черновика')
  if (!String(input.document?.number || '').trim()) errors.push('не указан номер ЭТрН')
  if (!ruDate(input.document?.date)) errors.push('дата ЭТрН должна быть YYYY-MM-DD')
  if (!String(input.document?.orderNumber || '').trim()) errors.push('не указан номер заказа/заявки')
  if (!ruDate(input.document?.orderDate)) errors.push('дата заказа/заявки должна быть YYYY-MM-DD')

  partyReferenceXml(input.participants?.shipper, 'Грузоотправитель', errors)
  partyReferenceXml(input.participants?.consignee, 'Грузополучатель', errors)
  partyReferenceXml(input.participants?.carrier, 'Перевозчик', errors)
  validateAddress(input.route?.loadingRussianAddress, 'Адрес погрузки', errors)
  validateAddress(input.route?.unloadingRussianAddress, 'Адрес доставки', errors)

  const cargo = Array.isArray(input.cargo) ? input.cargo : []
  if (!cargo.length) errors.push('не указаны позиции груза')
  cargo.forEach((item, index) => {
    const n = `Груз #${index + 1}`
    if (!String(item?.name || '').trim()) errors.push(`${n}: не указано наименование`)
    if (!String(item?.state || '').trim()) errors.push(`${n}: не указано состояние`)
    if (!String(item?.packagingMethod || '').trim()) errors.push(`${n}: не указан способ упаковки`)
    if (!String(item?.packagingCode || '').trim()) errors.push(`${n}: не указан ContainerType`)
    if (!positiveNumber(item?.places)) errors.push(`${n}: количество мест должно быть больше 0`)
    if (!positiveNumber(item?.grossWeightKg)) errors.push(`${n}: масса должна быть больше 0`)
    if (!String(item?.marking || '').trim()) errors.push(`${n}: укажите маркировку или отметку об её отсутствии`)
  })

  fio(input.driver?.fullName, 'Водитель', errors)
  if (!String(input.driver?.phone || '').trim()) errors.push('Водитель: не указан телефон')
  if (!String(input.driver?.licenseSeries || '').trim()) errors.push('Водитель: не указана серия ВУ')
  if (!String(input.driver?.licenseNumber || input.driver?.licenseLegacy || '').trim()) errors.push('Водитель: не указан номер ВУ')
  if (!ruDate(input.driver?.licenseIssueDate)) errors.push('Водитель: дата выдачи ВУ должна быть YYYY-MM-DD')

  if (!String(input.vehicle?.registrationNumber || '').trim()) errors.push('ТС: не указан госномер')
  if (!String(input.vehicle?.type || '').trim()) errors.push('ТС: не указан тип')
  if (!String(input.vehicle?.ownershipType || '').trim()) errors.push('ТС: не указан код владения Ownership')
  if (!String(input.vehicle?.model || '').trim()) warnings.push('ТС: модель не заполнена')

  if (!plannedDateTime(input.route?.plannedLoadingDate, input.route?.plannedLoadingTime)) errors.push('Погрузка: нужны дата и время планового прибытия')
  if (!ruDateTime(input.route?.actualArrival)) errors.push('Погрузка: фактическое прибытие должно быть datetime-local')
  if (!ruDateTime(input.route?.actualDeparture)) errors.push('Погрузка: фактическое убытие должно быть datetime-local')
  if (!positiveNumber(input.loadingFacts?.actualGrossWeight)) errors.push('Погрузка: фактическая масса должна быть больше 0')
  if (!positiveNumber(input.loadingFacts?.actualPlaces)) errors.push('Погрузка: фактическое число мест должно быть больше 0')
  if (!String(input.loadingFacts?.massDeterminationMethod || '').trim()) errors.push('Погрузка: не указан WeighingMethod')

  fio(input.signer?.fullName, 'Подписант', errors)
  if (!String(input.signer?.position || '').trim()) errors.push('Подписант: не указана должность')
  if (!String(input.shipperInstructions?.instructions || '').trim()) errors.push('Не заполнены указания грузоотправителя')

  warnings.push('UserDataXml preview не является результатом GenerateTitleXml и не подтверждает соответствие итоговой XSD ФНС')
  warnings.push('Время из datetime-local формируется без часового пояса с EnablingTimeZone=0; перед боевым подключением это нужно проверить на sandbox оператора')
  warnings.push('Публичный пример T1 содержит LoadingPartyDetails и LoadingOwnerDetails; эти блоки пока намеренно не генерируются до фиксации их обязательности по актуальному UserDataXsd')
  warnings.push('ИП и иные типы участников заблокированы до проверки соответствующей ветки актуального UserDataXsd')
  return { ok: errors.length === 0, errors, warnings }
}

export function buildKonturT1UserDataXml(input) {
  const validation = validateKonturT1Candidate(input)
  if (!validation.ok) {
    const error = new Error('Kontur T1 UserDataXml candidate is incomplete')
    error.validation = validation
    throw error
  }

  const shipper = input.participants.shipper
  const consignee = input.participants.consignee
  const carrier = input.participants.carrier
  const driver = fio(input.driver.fullName, 'Водитель', [])
  const signer = fio(input.signer.fullName, 'Подписант', [])
  const statedArrival = plannedDateTime(input.route.plannedLoadingDate, input.route.plannedLoadingTime)
  const actualArrival = ruDateTime(input.route.actualArrival)
  const actualDeparture = ruDateTime(input.route.actualDeparture)
  const grossWeight = positiveNumber(input.loadingFacts.actualGrossWeight)
  const places = positiveNumber(input.loadingFacts.actualPlaces)

  const cargoXml = input.cargo.map((item) => `<ItemDescription${attr('Name', item.name)}${attr('Condition', item.state)}${attr('PackageMethod', item.packagingMethod)}${attr('ContainerType', item.packagingCode)}${attr('CargoSpaceQuantity', positiveNumber(item.places))} IsForStateSystemRegistration="0"><Marks>${tag('Mark', item.marking)}</Marks><PlannedMass${attr('GrossWeight', positiveNumber(item.grossWeightKg))} /></ItemDescription>`).join('')
  const redirectPhone = String(input.shipperInstructions?.redirectionContact || '').trim()
  const vehicleModel = [input.vehicle?.brand, input.vehicle?.model].map((x) => String(x || '').trim()).filter(Boolean).join(' ')

  return `<?xml version="1.0" encoding="utf-8"?>\n<LogisticsWaybillConsignorTitle xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"${attr('Number', input.document.number)}${attr('Date', ruDate(input.document.date))}${attr('OrderNumber', input.document.orderNumber)}${attr('OrderDate', ruDate(input.document.orderDate))}>\n  <WaybillInfo>\n    <ShipperInfo IsFreightForwarder="0">\n      <Shipper>${partyReferenceXml(shipper, 'Грузоотправитель', [])}</Shipper>\n    </ShipperInfo>\n    <ConsigneeInfo>\n      <Consignee>${partyReferenceXml(consignee, 'Грузополучатель', [])}</Consignee>\n      <DeliveryAddres><AddressLogisticsWaybill>${russianAddressXml(input.route.unloadingRussianAddress)}</AddressLogisticsWaybill></DeliveryAddres>\n    </ConsigneeInfo>\n    <CargoInfo><ItemDescriptions>${cargoXml}</ItemDescriptions></CargoInfo>\n    <ConsignorDirectives${attr('TransportationDirectives', input.shipperInstructions.instructions)}>${redirectPhone ? `<ReaddressDetails AccountableSide="Consignor"><Phones>${tag('Phone', redirectPhone)}</Phones></ReaddressDetails>` : ''}</ConsignorDirectives>\n    <Carrier>${partyReferenceXml(carrier, 'Перевозчик', [])}</Carrier>\n    <Drivers><DriverInfo${attr('LastName', driver.lastName)}${attr('FirstName', driver.firstName)}${attr('MiddleName', driver.middleName)}${attr('LicenseNumber', input.driver.licenseNumber || input.driver.licenseLegacy)}${attr('LicenseSeries', input.driver.licenseSeries)}${attr('LicenseDate', ruDate(input.driver.licenseIssueDate))}><Phones>${tag('Phone', input.driver.phone)}</Phones></DriverInfo></Drivers>\n    <VehicleInfo><Vehicle${attr('Number', input.vehicle.registrationNumber)}${attr('Ownership', input.vehicle.ownershipType)}${attr('Type', input.vehicle.type)}${attr('Model', vehicleModel)}${attr('MaxWeight', input.vehicle.loadCapacity)}${attr('Capacity', input.vehicle.volumeCapacity)} /></VehicleInfo>\n    <LoadingInfo${attr('StatedArrivalDateTime', statedArrival)} StatedArrivalDateTimeEnablingTimeZone="0"${attr('ActualArrivalDateTime', actualArrival)} ActualArrivalDateTimeEnablingTimeZone="0"${attr('ActualDepartureDateTime', actualDeparture)} ActualDepartureDateTimeEnablingTimeZone="0"${attr('GrossWeight', grossWeight)}${attr('WeighingMethod', input.loadingFacts.massDeterminationMethod)}${attr('NumberOfPlaces', places)}>\n      <ActualLoadingAddress><AddressLogisticsWaybill>${russianAddressXml(input.route.loadingRussianAddress)}</AddressLogisticsWaybill></ActualLoadingAddress>\n    </LoadingInfo>\n  </WaybillInfo>\n  <Signer SignerType="1"><SignerDetails${attr('Position', input.signer.position)}${attr('LastName', signer.lastName)}${attr('FirstName', signer.firstName)}${attr('MiddleName', signer.middleName)} /></Signer>\n</LogisticsWaybillConsignorTitle>`
}

export const KONTUR_USERDATA_PREVIEW_CONTRACT = Object.freeze({
  documentTypeNamedId: 'LogisticsWaybill',
  documentFunction: 'reception',
  documentVersion: 'kl_trn_mt_05_01',
  titleIndex: 0,
  root: 'LogisticsWaybillConsignorTitle',
  externalCallRequired: false,
  xsdValidated: false,
})
