import type { CargoItem, DocStatus, DocumentRow, EtrnData, Party } from './types'

const id = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
export const emptyParty = (): Party => ({ kind: 'org', name: '', inn: '', kpp: '', phone: '', email: '', address: '' })
export const emptyCargo = (): CargoItem => ({ id: id(), name: '', places: '', unit: 'шт', weight: '', value: '', packaging: '', conditions: '' })
export const emptyEtrn = (): EtrnData => ({
  shipper: emptyParty(), consignee: emptyParty(), carrier: emptyParty(),
  route: { loadAddress: '', loadDate: '', loadTime: '', unloadAddress: '', unloadDate: '', unloadTime: '', note: '' },
  cargo: [emptyCargo()],
  transport: { brand: '', model: '', plate: '', trailerPlate: '', driverName: '', driverPhone: '', driverLicense: '' },
  terms: { contractNumber: '', contractDate: '', price: '', comment: '', extra: '' },
})

export const statusLabel: Record<DocStatus,string> = {
  draft: 'Черновик', incomplete: 'Требует заполнения', ready: 'Готов к передаче оператору', archived: 'Архив'
}
export const validInn = (v:string) => /^\d{10}$|^\d{12}$/.test(v.trim())
export type Issue = { field:string; message:string; step:number; kind:'required'|'recommended' }

export function validateEtrn(d:EtrnData): Issue[] {
  const issues: Issue[] = []
  const add=(field:string,message:string,step:number,kind:'required'|'recommended'='required')=>issues.push({field,message,step,kind})
  const parties:[keyof Pick<EtrnData,'shipper'|'consignee'|'carrier'>,string][] = [['shipper','Грузоотправитель'],['consignee','Грузополучатель'],['carrier','Перевозчик']]
  for (const [key,label] of parties) {
    const p=d[key]
    if(!p.name.trim()) add(label,'не указано наименование',1)
    if(!p.inn.trim()) add(label,'не указан ИНН',1)
    else if(!validInn(p.inn)) add(label,'ИНН должен содержать 10 или 12 цифр',1)
    if(p.kind==='org'&&!p.kpp.trim()) add(label,'рекомендуется указать КПП организации',1,'recommended')
    if(!p.phone.trim()&&!p.email.trim()) add(label,'нет телефона или email',1,'recommended')
  }
  if(!d.route.loadAddress.trim()) add('Маршрут','не указан адрес погрузки',2)
  if(!d.route.unloadAddress.trim()) add('Маршрут','не указан адрес выгрузки',2)
  if(!d.route.loadDate) add('Маршрут','не указана дата погрузки',2)
  if(!d.route.unloadDate) add('Маршрут','не указана плановая дата выгрузки',2,'recommended')
  const cargo=d.cargo.filter(x=>x.name.trim())
  if(!cargo.length) add('Груз','не добавлено ни одной позиции',3)
  cargo.forEach((x,i)=>{ if(!x.places) add(`Груз #${i+1}`,'не указано количество мест',3); if(!x.weight) add(`Груз #${i+1}`,'не указана масса',3); if(!x.packaging) add(`Груз #${i+1}`,'не указана упаковка',3,'recommended') })
  if(!d.transport.plate.trim()) add('Транспорт','не указан госномер автомобиля',4)
  if(!d.transport.driverName.trim()) add('Водитель','не указано ФИО',4)
  if(!d.transport.driverPhone.trim()) add('Водитель','не указан телефон',4,'recommended')
  if(!d.terms.contractNumber.trim()) add('Условия перевозки','не указан номер договора/заявки',5,'recommended')
  return issues
}

export const isReady = (d:EtrnData)=>!validateEtrn(d).some(x=>x.kind==='required')
export const cargoTotals = (d:EtrnData)=>d.cargo.reduce((a,x)=>({places:a.places+(Number(x.places)||0),weight:a.weight+(Number(String(x.weight).replace(',','.'))||0)}),{places:0,weight:0})
export const newDoc = ():DocumentRow => ({ id:id(), doc_number:`ЭТрН-${new Date().getFullYear()}-${Math.floor(Math.random()*900+100)}`, doc_date:new Date().toISOString().slice(0,10), status:'draft', data:emptyEtrn(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() })

export function exportJson(doc:DocumentRow){
  return {
    documentType:'ЭТрН (черновик)',
    schemaVersion:'epd-lite/draft-1',
    disclaimer:'Черновик. Не является юридически значимым перевозочным документом, не подписан КЭП и не передан в ГИС ЭПД.',
    number:doc.doc_number,date:doc.doc_date,status:statusLabel[doc.status],updatedAt:doc.updated_at,
    data:doc.data, totals:cargoTotals(doc.data)
  }
}
