export type DocStatus = 'draft' | 'incomplete' | 'ready' | 'archived'
export type OrgType = 'org' | 'ip'

export type RussianAddressDraft = {
  zipCode: string
  region: string
  city: string
  settlement: string
  street: string
  building: string
  corpus: string
  apartment: string
}

export type Party = {
  kind: OrgType
  name: string
  inn: string
  kpp: string
  phone: string
  email: string
  address: string
  /** Идентификатор участника ЭДО/FNS participant id у выбранного оператора. */
  edoId?: string
  /** Структурированная версия российского адреса для operator/UserDataXml mapping. */
  russianAddress?: RussianAddressDraft
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
  /** Дополнительные поля для подготовки маппинга на титул Т1 ЭТрН. */
  state?: string
  marking?: string
  packagingMethod?: string
  packagingCode?: string
  currency?: string
}

export type LoadingDetailsDraft = {
  /** Значение будущего атрибута MatchingShipper: '', '0' или '1'. */
  matchingShipper: string
  employeeFullName: string
  employeePosition: string
  employeeResponsibilities: string
  /** ИНН лица, осуществляющего погрузку; при MatchingShipper=1 может совпадать с ИНН грузоотправителя. */
  partyInn: string
  /** Код Type из актуального UserDataXsd для LoadingOwnerDetails. */
  ownerType: string
  ownerInn: string
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
    loadRussianAddress?: RussianAddressDraft
    unloadRussianAddress?: RussianAddressDraft
    /** Фактические данные погрузки, если они уже известны к моменту подготовки Т1. */
    loadArrival?: string
    loadDeparture?: string
    massMethod?: string
    actualWeight?: string
    actualPlaces?: string
  }
  loadingDetails?: LoadingDetailsDraft
  cargo: CargoItem[]
  transport: {
    brand: string
    model: string
    plate: string
    trailerPlate: string
    driverName: string
    driverPhone: string
    driverLicense: string
    vehicleType?: string
    ownershipType?: string
    loadCapacity?: string
    volumeCapacity?: string
    driverLicenseSeries?: string
    driverLicenseNumber?: string
    driverLicenseDate?: string
    waybillNumber?: string
    waybillDate?: string
  }
  terms: {
    contractNumber: string
    contractDate: string
    price: string
    comment: string
    extra: string
    orderNumber?: string
    orderDate?: string
    shipperInstructions?: string
    redirectionContact?: string
  }
  signer?: {
    fullName: string
    position: string
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
  org_type?: OrgType
  name: string
  inn: string
  kpp: string
  roles: string[]
  address: string
  phone: string
  email: string
  edo_id?: string
  address_zip_code?: string
  address_region?: string
  address_city?: string
  address_settlement?: string
  address_street?: string
  address_building?: string
  address_corpus?: string
  address_apartment?: string
}

export type Vehicle = {
  id: string
  brand: string
  model: string
  plate: string
  vehicle_type: string
  trailer_plate: string
  ownership_type?: string
  load_capacity?: string
  volume_capacity?: string
}

export type Driver = {
  id: string
  full_name: string
  phone: string
  license: string
  license_series?: string
  license_number?: string
  license_date?: string
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

export type BillingPlan = {
  code: string
  name: string
  monthly_price_rub: number
  document_limit: number | null
  active: boolean
  features: Record<string, unknown>
  sort_order: number
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'

export type BillingSubscription = {
  user_id: string
  plan_code: string
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  payment_provider: string
  created_at: string
  updated_at: string
}

export type BillingUsage = {
  user_id: string
  period_start: string
  documents_created: number
  sandbox_generations: number
  updated_at: string
}

export type BillingState = {
  mode: 'demo' | 'cloud'
  enforcementEnabled: boolean
  trialDays: number
  plans: BillingPlan[]
  subscription: BillingSubscription | null
  currentPlan: BillingPlan | null
  usage: BillingUsage | null
}
