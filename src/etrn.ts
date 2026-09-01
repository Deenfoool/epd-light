import type { CargoItem, DocStatus, DocumentRow, EtrnData, Party, RussianAddressDraft } from './types'

const id = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

/**
 * Reference observed on official FNS materials on 2026-09-01.
 * This does NOT mean EPD Light currently produces XML conforming to this XSD.
 */
export const FNS_ETRN_REFERENCE = {
  knd: '1110339',
  formatVersion: '5.01',
  title: 'T1 / информация грузоотправителя',
  filePrefix: 'ON_TRNACLGROT',
  draftSchema: 'ON_TRNACLGROT_1_973_01_05_01_02',
  observedAt: '2026-09-01',
  officialFormatUrl: 'https://www.nalog.gov.ru/rn77/about_fts/docs/14975031/',
  officialDraftUrl: 'https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/approved_formats/16631750/',
} as const

export const emptyRussianAddress = (): RussianAddressDraft => ({
  zipCode: '', region: '', city: '', settlement: '', street: '', building: '', corpus: '', apartment: '',
})
export const emptyParty = (): Party => ({
  kind: 'org', name: '', inn: '', kpp: '', phone: '', email: '', address: '', edoId: '', russianAddress: emptyRussianAddress(),
})
export const emptyCargo = (): CargoItem => ({
  id: id(), name: '', places: '', unit: 'шт', weight: '', value: '', packaging: '', conditions: '',
  state: '', marking: '', packagingMethod: '', packagingCode: '', currency: '643',
})
export const emptyEtrn = (): EtrnData => ({
  shipper: emptyParty(), consignee: emptyParty(), carrier: emptyParty(),
  route: {
    loadAddress: '', loadDate: '', loadTime: '', unloadAddress: '', unloadDate: '', unloadTime: '', note: '',
    loadRussianAddress: emptyRussianAddress(), unloadRussianAddress: emptyRussianAddress(),
    loadArrival: '', loadDeparture: '', massMethod: '', actualWeight: '', actualPlaces: '',
  },
  cargo: [emptyCargo()],
  transport: {
    brand: '', model: '', plate: '', trailerPlate: '', driverName: '', driverPhone: '', driverLicense: '',
    vehicleType: '', ownershipType: '', loadCapacity: '', volumeCapacity: '',
    driverLicenseSeries: '', driverLicenseNumber: '', driverLicenseDate: '', waybillNumber: '', waybillDate: '',
  },
  terms: {
    contractNumber: '', contractDate: '', price: '', comment: '', extra: '',
    orderNumber: '', orderDate: '', shipperInstructions: '', redirectionContact: '',
  },
  signer: { fullName: '', position: '' },
})

const normalizeAddress = (input: Partial<RussianAddressDraft> | null | undefined): RussianAddressDraft => ({
  ...emptyRussianAddress(), ...(input ?? {}),
})
const normalizeParty = (base: Party, input: Partial<Party> | null | undefined): Party => ({
  ...base, ...(input ?? {}), russianAddress: normalizeAddress(input?.russianAddress),
})

/** Makes older JSON drafts safe after the draft model grows. */
export function normalizeEtrn(input: Partial<EtrnData> | null | undefined): EtrnData {
  const base = emptyEtrn()
  const d = input ?? {}
  return {
    ...base,
    ...d,
    shipper: normalizeParty(base.shipper, d.shipper),
    consignee: normalizeParty(base.consignee, d.consignee),
    carrier: normalizeParty(base.carrier, d.carrier),
    route: {
      ...base.route,
      ...(d.route ?? {}),
      loadRussianAddress: normalizeAddress(d.route?.loadRussianAddress),
      unloadRussianAddress: normalizeAddress(d.route?.unloadRussianAddress),
    },
    cargo: Array.isArray(d.cargo) && d.cargo.length
      ? d.cargo.map((x) => ({ ...emptyCargo(), ...x, id: x.id || id() }))
      : [emptyCargo()],
    transport: { ...base.transport, ...(d.transport ?? {}) },
    terms: { ...base.terms, ...(d.terms ?? {}) },
    signer: { ...base.signer!, ...(d.signer ?? {}) },
  }
}

export const statusLabel: Record<DocStatus,string> = {
  draft: 'Черновик', incomplete: 'Требует заполнения', ready: 'Черновик готов', archived: 'Архив'
}
export const validInn = (v:string) => /^\d{10}$|^\d{12}$/.test(v.trim())
export const validGuid = (v:string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim())
export type IssueKind = 'required' | 'operator' | 'recommended'
export type Issue = { field:string; message:string; step:number; kind:IssueKind }

const addressCandidateReady = (a: RussianAddressDraft | undefined) => Boolean(a?.region.trim() && (a?.city.trim() || a?.settlement.trim()))

export function validateEtrn(raw:EtrnData): Issue[] {
  const d = normalizeEtrn(raw)
  const issues: Issue[] = []
  const add=(field:string,message:string,step:number,kind:IssueKind='required')=>issues.push({field,message,step,kind})
  const parties:[keyof Pick<EtrnData,'shipper'|'consignee'|'carrier'>,string][] = [['shipper','Грузоотправитель'],['consignee','Грузополучатель'],['carrier','Перевозчик']]
  for (const [key,label] of parties) {
    const p=d[key]
    if(!p.name.trim()) add(label,'не указано наименование',1)
    if(!p.inn.trim()) add(label,'не указан ИНН',1)
    else if(!validInn(p.inn)) add(label,'ИНН должен содержать 10 или 12 цифр',1)
    if(p.kind==='org'&&!p.kpp.trim()) add(label,'рекомендуется указать КПП организации',1,'recommended')
    if(!p.address.trim()) add(label,'не указан читаемый адрес',1,'recommended')
    if(!addressCandidateReady(p.russianAddress)) add(label,'структурированный адрес участника можно заполнить для альтернативного operator mapping',1,'recommended')
    if(!p.phone.trim()&&!p.email.trim()) add(label,'нет телефона или email',1,'operator')
    if(!p.edoId?.trim()) add(label,'для первого адаптера нужен BoxId / ID участника ЭДО',1,'operator')
  }
  if(!d.route.loadAddress.trim()) add('Маршрут','не указан адрес погрузки',2)
  if(!d.route.unloadAddress.trim()) add('Маршрут','не указан адрес выгрузки',2)
  if(!addressCandidateReady(d.route.loadRussianAddress)) add('Погрузка','не заполнен структурированный адрес погрузки для UserDataXml',2,'operator')
  if(!addressCandidateReady(d.route.unloadRussianAddress)) add('Выгрузка','не заполнен структурированный адрес выгрузки для UserDataXml',2,'operator')
  if(!d.route.loadDate) add('Маршрут','не указана дата погрузки',2)
  if(!d.route.loadTime) add('Погрузка','рекомендуется указать заявленное время погрузки',2,'operator')
  if(!d.route.unloadDate) add('Маршрут','не указана плановая дата выгрузки',2,'recommended')
  if(!d.route.loadArrival) add('Погрузка','фактическое время прибытия заполняется, когда оно известно',2,'operator')
  if(!d.route.loadDeparture) add('Погрузка','фактическое время убытия заполняется, когда оно известно',2,'operator')
  if(!d.route.massMethod?.trim()) add('Погрузка','не указан код/метод определения массы',2,'operator')

  const cargo=d.cargo.filter(x=>x.name.trim())
  if(!cargo.length) add('Груз','не добавлено ни одной позиции',3)
  cargo.forEach((x,i)=>{
    if(!x.places) add(`Груз #${i+1}`,'не указано количество мест',3)
    if(!x.weight) add(`Груз #${i+1}`,'не указана масса',3)
    if(!x.packaging) add(`Груз #${i+1}`,'не указана упаковка/тара',3,'operator')
    if(!x.state?.trim()) add(`Груз #${i+1}`,'не указано состояние груза',3,'operator')
    if(!x.packagingMethod?.trim()) add(`Груз #${i+1}`,'не указан способ упаковки',3,'operator')
    if(!x.marking?.trim()) add(`Груз #${i+1}`,'не указана маркировка либо отметка об её отсутствии',3,'operator')
    if(!x.packagingCode?.trim()) add(`Груз #${i+1}`,'не указан код вида тары для UserDataXml',3,'operator')
    if(x.value && !x.currency?.trim()) add(`Груз #${i+1}`,'для объявленной стоимости нужен код валюты',3,'operator')
  })

  if(!d.transport.plate.trim()) add('Транспорт','не указан госномер автомобиля',4)
  if(!d.transport.driverName.trim()) add('Водитель','не указано ФИО',4)
  if(!d.transport.driverPhone.trim()) add('Водитель','не указан телефон',4,'operator')
  if(!d.transport.vehicleType?.trim()) add('Транспорт','не указан тип транспортного средства',4,'operator')
  if(!d.transport.ownershipType?.trim()) add('Транспорт','не указан тип/код владения транспортным средством',4,'operator')
  if(!d.transport.driverLicenseSeries?.trim()) add('Водитель','не указана серия водительского удостоверения',4,'operator')
  if(!d.transport.driverLicenseNumber?.trim() && !d.transport.driverLicense?.trim()) add('Водитель','не указан номер водительского удостоверения',4,'operator')
  if(!d.transport.driverLicenseDate) add('Водитель','не указана дата выдачи водительского удостоверения',4,'operator')
  if(!d.transport.waybillNumber?.trim()) add('Путевой лист','не указан номер путевого листа',4,'recommended')
  if(!d.transport.waybillDate) add('Путевой лист','не указана дата путевого листа',4,'recommended')

  if(!d.terms.orderNumber?.trim()) add('Основание перевозки','не указан номер заказа/заявки',5,'operator')
  if(!d.terms.orderDate) add('Основание перевозки','не указана дата заказа/заявки',5,'operator')
  if(!d.terms.contractNumber.trim()) add('Условия перевозки','номер договора можно указать для внутренней связки документов',5,'recommended')
  if(!d.terms.shipperInstructions?.trim()) add('Указания грузоотправителя','не заполнены дополнительные указания/отметка об их отсутствии',5,'operator')
  if(!d.signer?.fullName.trim()) add('Подписант','не указано ФИО подписанта грузоотправителя',5,'operator')
  if(!d.signer?.position.trim()) add('Подписант','не указана должность подписанта',5,'operator')
  return issues
}

/** Base MVP readiness only. It is intentionally NOT an XSD validation result. */
export const isReady = (d:EtrnData)=>!validateEtrn(d).some(x=>x.kind==='required')

export function operatorReadiness(d:EtrnData) {
  const issues = validateEtrn(d)
  const operator = issues.filter(x=>x.kind==='operator')
  const recommended = issues.filter(x=>x.kind==='recommended')
  return { candidate: operator.length===0, missing: operator.length, warnings: recommended.length, issues: operator }
}

export const cargoTotals = (raw:EtrnData)=>normalizeEtrn(raw).cargo.reduce((a,x)=>({places:a.places+(Number(x.places)||0),weight:a.weight+(Number(String(x.weight).replace(',','.'))||0)}),{places:0,weight:0})
export const newDoc = ():DocumentRow => ({ id:id(), doc_number:`ЭТрН-${new Date().getFullYear()}-${Math.floor(Math.random()*900+100)}`, doc_date:new Date().toISOString().slice(0,10), status:'draft', data:emptyEtrn(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() })

export function exportJson(doc:DocumentRow){
  const data = normalizeEtrn(doc.data)
  return {
    documentType:'ЭТрН (внутренний черновик)',
    draftModelVersion:3,
    schemaVersion:'epd-light/draft-3',
    fnsReference:FNS_ETRN_REFERENCE,
    disclaimer:'Черновик. Не является юридически значимым перевозочным документом, не подписан КЭП, не проверен по XSD ФНС и не передан в ГИС ЭПД.',
    number:doc.doc_number,date:doc.doc_date,status:statusLabel[doc.status],updatedAt:doc.updated_at,
    data, totals:cargoTotals(data), operatorReadiness:operatorReadiness(data)
  }
}
