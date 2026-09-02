import { getBillingState } from './billing'
import { listBillingPaymentEvents } from './billing-events'
import {
  cloudEnabled,
  getProfile,
  getSessionEmail,
  listCompanies,
  listDocuments,
  listDrivers,
  listVehicles,
  supabase,
} from './data'

export type AccountDeletionRequest = {
  id: string
  status: 'pending' | 'in_review' | 'completed' | 'rejected' | 'canceled'
  requested_at: string
  updated_at: string
  resolved_at: string | null
}

const localKey = (name: string) => `epd-lite:${name}`
const readLocal = <T>(name: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(localKey(name))
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}
const writeLocal = <T>(name: string, value: T) => localStorage.setItem(localKey(name), JSON.stringify(value))

async function currentCloudUser() {
  if (!supabase) throw new Error('Облачный режим не подключён')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Не выполнен вход')
  return data.user
}

function throwFirst(...results: Array<{ error?: any }>) {
  const failed = results.find((result) => result?.error)
  if (failed?.error) throw failed.error
}

export async function listAccountDeletionRequests(): Promise<AccountDeletionRequest[]> {
  if (!cloudEnabled || !supabase) {
    return readLocal<AccountDeletionRequest[]>('privacyDeletionRequests', [])
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
  }
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('id,status,requested_at,updated_at,resolved_at')
    .order('requested_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []) as AccountDeletionRequest[]
}

export async function requestAccountDeletion(): Promise<AccountDeletionRequest> {
  if (!cloudEnabled || !supabase) {
    const current = readLocal<AccountDeletionRequest[]>('privacyDeletionRequests', [])
    const active = current.find((item) => item.status === 'pending' || item.status === 'in_review')
    if (active) return active
    const now = new Date().toISOString()
    const request: AccountDeletionRequest = {
      id: crypto.randomUUID(),
      status: 'pending',
      requested_at: now,
      updated_at: now,
      resolved_at: null,
    }
    writeLocal('privacyDeletionRequests', [request, ...current])
    return request
  }

  const user = await currentCloudUser()
  const existing = await listAccountDeletionRequests()
  const active = existing.find((item) => item.status === 'pending' || item.status === 'in_review')
  if (active) return active

  const { data, error } = await supabase
    .from('account_deletion_requests')
    .insert({ user_id: user.id })
    .select('id,status,requested_at,updated_at,resolved_at')
    .single()
  if (error) {
    // Handles a concurrent duplicate request without allowing the browser to update/delete the row.
    const afterRace = await listAccountDeletionRequests()
    const raced = afterRace.find((item) => item.status === 'pending' || item.status === 'in_review')
    if (raced) return raced
    throw error
  }
  return data as AccountDeletionRequest
}

export async function buildAccountDataExport() {
  const exportedAt = new Date().toISOString()

  if (!cloudEnabled || !supabase) {
    const [email, profile, companies, vehicles, drivers, documents, billing] = await Promise.all([
      getSessionEmail(),
      getProfile(),
      listCompanies(),
      listVehicles(),
      listDrivers(),
      listDocuments(),
      getBillingState(),
    ])
    return {
      kind: 'epd-light/account-data-export-v1',
      exportedAt,
      mode: 'demo',
      scope: 'Данные, доступные этому локальному demo-аккаунту. Это не юридический ответ на формальный запрос субъекта персональных данных.',
      account: { email },
      profile,
      companies,
      vehicles,
      drivers,
      documents,
      integrationRequests: readLocal<any[]>('integrationRequests', []),
      billing,
      operatorAttempts: [],
      billingPaymentEvents: [],
      deletionRequests: await listAccountDeletionRequests(),
      secretsIncluded: false,
    }
  }

  const user = await currentCloudUser()
  const [
    profileResult,
    companiesResult,
    vehiclesResult,
    driversResult,
    documentsResult,
    integrationRequestsResult,
    operatorAttemptsResult,
    billing,
    billingPaymentEvents,
    deletionRequests,
  ] = await Promise.all([
    supabase.from('profiles').select('company_name,inn,kpp,org_type,phone,email,onboarded,created_at,updated_at').maybeSingle(),
    supabase.from('companies').select('id,org_type,name,inn,kpp,roles,address,phone,email,edo_id,address_zip_code,address_region,address_city,address_settlement,address_street,address_building,address_corpus,address_apartment,created_at,updated_at').order('name'),
    supabase.from('vehicles').select('id,brand,model,plate,vehicle_type,trailer_plate,ownership_type,load_capacity,volume_capacity,created_at,updated_at').order('plate'),
    supabase.from('drivers').select('id,full_name,phone,license,license_series,license_number,license_date,created_at,updated_at').order('full_name'),
    supabase.from('documents').select('id,doc_number,doc_date,status,data,created_at,updated_at').order('updated_at', { ascending: false }),
    supabase.from('integration_requests').select('id,company_name,inn,operator,contact,created_at').order('created_at', { ascending: false }),
    supabase.from('operator_attempts').select('id,document_id,provider,operation,mode,document_revision,idempotency_key,request_fingerprint,status,safe_error_code,external_message_id,external_entity_id,created_at,updated_at').order('created_at', { ascending: false }),
    getBillingState(),
    listBillingPaymentEvents(50),
    listAccountDeletionRequests(),
  ])

  throwFirst(
    profileResult,
    companiesResult,
    vehiclesResult,
    driversResult,
    documentsResult,
    integrationRequestsResult,
    operatorAttemptsResult,
  )

  return {
    kind: 'epd-light/account-data-export-v1',
    exportedAt,
    mode: 'cloud',
    scope: 'Экспорт данных, доступных текущему аккаунту через его RLS-права. Это не юридический ответ на формальный запрос субъекта персональных данных и не включает server secrets.',
    account: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
    },
    profile: profileResult.data ?? null,
    companies: companiesResult.data ?? [],
    vehicles: vehiclesResult.data ?? [],
    drivers: driversResult.data ?? [],
    documents: documentsResult.data ?? [],
    integrationRequests: integrationRequestsResult.data ?? [],
    billing,
    operatorAttempts: operatorAttemptsResult.data ?? [],
    billingPaymentEvents,
    deletionRequests,
    secretsIncluded: false,
  }
}

export function downloadAccountDataExport(payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `epd-light-account-export-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function deletionRequestStatusLabel(status: AccountDeletionRequest['status']) {
  if (status === 'pending') return 'Ожидает обработки'
  if (status === 'in_review') return 'На проверке'
  if (status === 'completed') return 'Выполнено'
  if (status === 'rejected') return 'Отклонено'
  return 'Отменено'
}
