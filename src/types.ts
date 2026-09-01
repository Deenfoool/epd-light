export type DocStatus = 'draft' | 'incomplete' | 'ready' | 'archived'
export type OrgType = 'org' | 'ip'

export type Party = {
  kind: OrgType
  name: string
  inn: string
  kpp: string
  phone: string
  email: string
  address: string
}

export type CargoItem = {
  id: string
  name: string
  places: string
  unit: string
  weight: string
  value: string
  packaging: string
  conditions: string
}

export type EtrnData = {
  shipper: Party
  consignee: Party
  carrier: Party
  route: {
    loadAddress: string
    loadDate: string
    loadTime: string
    unloadAddress: string
    unloadDate: string
    unloadTime: string
    note: string
  }
  cargo: CargoItem[]
  transport: {
    brand: string
    model: string
    plate: string
    trailerPlate: string
    driverName: string
    driverPhone: string
    driverLicense: string
  }
  terms: {
    contractNumber: string
    contractDate: string
    price: string
    comment: string
    extra: string
  }
}

export type DocumentRow = {
  id: string
  user_id?: string
  doc_number: string
  doc_date: string
  status: DocStatus
  data: EtrnData
  created_at: string
  updated_at: string
}

export type Company = {
  id: string
  name: string
  inn: string
  kpp: string
  roles: string[]
  address: string
  phone: string
  email: string
}

export type Vehicle = {
  id: string
  brand: string
  model: string
  plate: string
  vehicle_type: string
  trailer_plate: string
}

export type Driver = {
  id: string
  full_name: string
  phone: string
  license: string
}

export type Profile = {
  company_name: string
  inn: string
  kpp: string
  org_type: OrgType
  phone: string
  email: string
  onboarded: boolean
}
