import { readFile } from 'node:fs/promises'

const read = (path) => readFile(path, 'utf8')
const fail = (message) => { console.error(`RUNTIME PRECHECK FAILED: ${message}`); process.exit(1) }
const requireAll = (name, text, snippets) => {
  const normalized = text.replace(/\s+/g, ' ')
  for (const snippet of snippets) if (!normalized.includes(snippet.replace(/\s+/g, ' '))) fail(`${name}: missing invariant: ${snippet}`)
}

const auth = await read('server/auth.mjs')
requireAll('auth runtime guard', auth, [
  "const DEPLOYMENT_MODES = new Set(['local', 'production'])",
  "EPD_DEPLOYMENT_MODE || 'local'",
  "config.deploymentMode === 'production' && config.mode !== 'supabase'",
  'Production deployment requires EPD_GATEWAY_AUTH_MODE=supabase',
  'productionRequiresSupabaseAuth: true',
])

const authTest = await read('scripts/test-auth.mjs')
requireAll('auth test', authTest, [
  "EPD_DEPLOYMENT_MODE: 'production'",
  'production deployment must reject disabled gateway auth even when operator mode is disabled',
  'unknown deployment mode must fail closed',
])

const compose = await read('docker-compose.yml')
requireAll('compose deployment mode', compose, [
  'EPD_DEPLOYMENT_MODE: ${EPD_DEPLOYMENT_MODE:-local}',
])

const deploymentCheck = await read('scripts/check-deployment-env.mjs')
requireAll('production deployment check', deploymentCheck, [
  "required('EPD_DEPLOYMENT_MODE')",
  'Production EPD_DEPLOYMENT_MODE must be production',
  'Production EPD_GATEWAY_AUTH_MODE must be supabase',
])

const attemptClient = await read('src/operator-attempts.ts')
requireAll('operator attempt client', attemptClient, [
  "from('operator_attempts')",
  ".eq('document_id', id)",
  '.limit(20)',
])
for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', 'generatedXml', 'document_payload', 'access_token']) {
  if (attemptClient.includes(forbidden)) fail(`operator attempt browser client contains forbidden write/payload pattern: ${forbidden}`)
}

const documentView = await read('src/App.tsx')
requireAll('operator attempt history UI', documentView, [
  'История действий оператора',
  'listOperatorAttempts(doc.id)',
  'operatorAttemptStatusLabel(a.status)',
  'request_fingerprint',
  'safe_error_code',
  'XML, токены и данные ЭТрН здесь не хранятся',
])

const attemptClientTest = await read('scripts/test-operator-attempt-client.mjs')
requireAll('operator attempt client test', attemptClientTest, [
  'browser journal access is read-only, metadata-only and document-scoped',
])

console.log('Runtime preflight OK: production JWT guard and read-only operator journal UI verified')
