import { readFile } from 'node:fs/promises'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const client = await readFile('src/operator-attempts.ts', 'utf8')
const app = await readFile('src/App.tsx', 'utf8')
const appCompact = app.replace(/\s+/g, '')

for (const snippet of [
  "from('operator_attempts')",
  "select('id,document_id,provider,operation,mode,document_revision,idempotency_key,request_fingerprint,status,safe_error_code,external_message_id,external_entity_id,created_at,updated_at')",
  ".eq('document_id', id)",
  ".order('created_at', { ascending: false })",
  '.limit(20)',
]) assert(client.includes(snippet), `operator-attempt client missing safe read invariant: ${snippet}`)

for (const forbidden of [
  ".insert(", ".update(", ".upsert(", ".delete(",
  'generated_xml', 'generatedXml', 'userdata_xml', 'UserDataXml', 'document_payload', 'candidate',
  'access_token', 'refresh_token', 'operator_token',
]) assert(!client.includes(forbidden), `operator-attempt client must stay read-only/metadata-only: ${forbidden}`)

for (const snippet of [
  'История действий оператора',
  'listOperatorAttempts(doc.id)',
  'operatorAttemptStatusLabel(a.status)',
  'request_fingerprint',
  'safe_error_code',
  'XML, токены и данные ЭТрН здесь не хранятся',
]) assert(appCompact.includes(snippet.replace(/\s+/g, '')), `document operator-history UI missing invariant: ${snippet}`)

assert(!app.includes('a.generatedXml'), 'operator history UI must not expect generated XML from journal')
assert(!app.includes('a.document_payload'), 'operator history UI must not expect document payload from journal')

console.log('Operator attempt client test OK: browser journal access is read-only, metadata-only and document-scoped')
