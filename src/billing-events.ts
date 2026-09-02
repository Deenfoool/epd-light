import { cloudEnabled, supabase } from './data'

export type BillingPaymentEventView = {
  provider: string
  event_type: string
  event_status: 'received' | 'verified' | 'applied' | 'ignored' | 'failed'
  plan_code: string | null
  amount_kopecks: number | null
  currency: string
  safe_error_code: string
  created_at: string
  processed_at: string | null
}

const SAFE_PAYMENT_EVENT_COLUMNS = [
  'provider',
  'event_type',
  'event_status',
  'plan_code',
  'amount_kopecks',
  'currency',
  'safe_error_code',
  'created_at',
  'processed_at',
].join(',')

export async function listBillingPaymentEvents(limit = 20): Promise<BillingPaymentEventView[]> {
  if (!cloudEnabled || !supabase) return []
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)))
  const { data, error } = await supabase
    .from('billing_payment_events')
    .select(SAFE_PAYMENT_EVENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(safeLimit)
  if (error) throw error
  return (data ?? []) as BillingPaymentEventView[]
}

export function billingPaymentEventStatusLabel(status: BillingPaymentEventView['event_status']): string {
  if (status === 'received') return 'Получено'
  if (status === 'verified') return 'Проверено'
  if (status === 'applied') return 'Применено к подписке'
  if (status === 'ignored') return 'Игнорировано'
  return 'Ошибка обработки'
}
