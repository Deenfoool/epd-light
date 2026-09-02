import { cloudEnabled, supabase } from './data'
import type { OperatorAttempt } from './types'

export async function listOperatorAttempts(documentId: string): Promise<OperatorAttempt[]> {
  if (!cloudEnabled || !supabase) return []
  const id = String(documentId || '').trim()
  if (!id) return []

  const { data, error } = await supabase
    .from('operator_attempts')
    .select('id,document_id,provider,operation,mode,document_revision,idempotency_key,request_fingerprint,status,safe_error_code,external_message_id,external_entity_id,created_at,updated_at')
    .eq('document_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  return (data ?? []) as OperatorAttempt[]
}

export function operatorAttemptStatusLabel(status: OperatorAttempt['status']): string {
  if (status === 'started') return 'В процессе'
  if (status === 'succeeded') return 'Успешно'
  if (status === 'failed') return 'Ошибка'
  return 'Заблокировано'
}
