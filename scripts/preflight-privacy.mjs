import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`PRIVACY PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing ${snippet}`)
}

const migration = await read('supabase', 'migrations', '202609020006_account_deletion_requests.sql')
requireAll('account deletion migration', migration, [
  'create table if not exists public.account_deletion_requests',
  "status in ('pending','in_review','completed','rejected','canceled')",
  'account_deletion_requests_one_active_idx',
  "where status in ('pending','in_review')",
  'grant select, insert on public.account_deletion_requests to authenticated',
  'alter table public.account_deletion_requests enable row level security',
  'account_deletion_requests_own_read',
  'account_deletion_requests_own_insert',
  'auth.uid() = user_id',
  "status = 'pending'",
  'revoke update, delete on public.account_deletion_requests from authenticated',
  'No automatic deletion is performed',
])
if (/grant\s+(?:update|delete).*account_deletion_requests\s+to\s+authenticated/i.test(migration)) {
  fail('browser must never receive update/delete rights on account deletion requests')
}

const client = await read('src', 'privacy.ts')
requireAll('privacy client', client, [
  "kind: 'epd-light/account-data-export-v1'",
  "from('account_deletion_requests')",
  ".insert({ user_id: user.id })",
  "from('documents').select('id,doc_number,doc_date,status,data,created_at,updated_at')",
  "from('operator_attempts').select('id,document_id,provider,operation,mode,document_revision,idempotency_key,request_fingerprint,status,safe_error_code,external_message_id,external_entity_id,created_at,updated_at')",
  'listBillingPaymentEvents(50)',
  'secretsIncluded: false',
  'downloadAccountDataExport',
])
for (const forbidden of [
  'access_token',
  'refresh_token',
  'service_role',
  'auth.admin',
  ".from('account_deletion_requests').update(",
  ".from('account_deletion_requests').delete(",
  ".select('*')",
]) {
  if (client.includes(forbidden)) fail(`privacy client contains forbidden secret/write/broad-select pattern: ${forbidden}`)
}

const nav = await read('src', 'app-chunks', 'App.09.part')
requireAll('privacy navigation', nav, ["'/app/privacy'", 'Данные и удаление'])
const page = await read('src', 'app-chunks', 'App.30.part')
requireAll('privacy UI', page, [
  'function PrivacyPage()',
  'Экспорт моих данных',
  'Создать заявку на удаление',
  'Это не мгновенное удаление',
  'Browser не получает права удалять auth user или server-owned журналы',
])
const routes = await read('src', 'app-chunks', 'App.34.part')
requireAll('privacy route', routes, ["pathname==='/app/privacy'", '<PrivacyPage/>'])

const pkg = JSON.parse(await read('package.json'))
if (!pkg.scripts?.['privacy:test']) fail('package script privacy:test missing')
if (!String(pkg.scripts?.preflight || '').includes('preflight-privacy.mjs')) fail('npm run preflight must include preflight-privacy.mjs')

console.log('Privacy preflight OK: RLS read/insert-only deletion requests, explicit safe export fields and non-destructive account controls verified')
