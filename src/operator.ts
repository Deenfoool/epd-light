import type { DocumentRow } from './types'

export type OperatorProvider = 'kontur' | 'taxcom' | 'other'

export interface OperatorConnection {
  provider: OperatorProvider
  organizationInn: string
  configured: boolean
}

export interface OperatorPreflightResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Internal integration boundary. The browser must never contain operator API secrets,
 * private keys or KEP material. Production implementations belong on a server located
 * in the approved infrastructure contour.
 */
export interface OperatorAdapter {
  preflight(document: DocumentRow): Promise<OperatorPreflightResult>
  createDraft(document: DocumentRow): Promise<{ externalId: string }>
  getStatus(externalId: string): Promise<string>
}

export function assertOperatorConfigured(connection: OperatorConnection) {
  if (!connection.configured) {
    throw new Error('Оператор ИС ЭПД не подключён. Юридически значимая отправка недоступна.')
  }
}

/**
 * Intentionally disabled in MVP. This prevents UI code from accidentally pretending
 * that a document was sent to GIS EPD before a real accredited-operator integration exists.
 */
export async function sendToOperatorDisabled(): Promise<never> {
  throw new Error('Отправка оператору ИС ЭПД не настроена в MVP')
}
