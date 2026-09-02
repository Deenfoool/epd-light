import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8')
const fail = (message) => { console.error(`PRECHECK FAILED: ${message}`); process.exit(1) }
const requireSnippets = (name, text, snippets) => {
  for (const snippet of snippets) if (!text.includes(snippet)) fail(`${name}: missing invariant: ${snippet}`)
}

const partsDir = path.join(root, 'src', 'app-chunks')
const parts = (await readdir(partsDir)).filter((name) => name.endsWith('.part')).sort()
if (parts.length !== 34) fail(`expected 34 app source parts, found ${parts.length}`)
const app = (await Promise.all(parts.map((name) => readFile(path.join(partsDir, name), 'utf8')))).join('')
requireSnippets('app', app, [
  'export default function App()', 'function Wizard(', 'function Documents(', 'function Integrations(', 'function BillingPage()',
  'function RussianAddressEditor(', 'gatewayFetch', 'buildOperatorDraft', 'operatorReadiness',
  'ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ',
  'Статусы «Передан оператору», «Подписан» и «Принят ГИС ЭПД» недоступны',
  'dirty.current=true', "addEventListener('beforeunload',beforeUnload)",
  'Структурированный адрес погрузки', 'Лицо и владелец места погрузки', 'MatchingShipper',
  'Код тары / ContainerType', 'Код Ownership (оператор)', 'companies-example-t1.csv',
  '/api/operator/capabilities', '/api/operator/kontur/userdata-preview', 'Kontur XML preview',
  '/api/operator/kontur/generate-title-sandbox', 'Kontur sandbox', 'documentId:doc.id',
  'externalResultShared', 'requestFingerprint', 'sourceRevision',
  "'/app/billing'", 'Тариф и лимиты', 'billingErrorMessage', 'Лимиты пока не блокируют',
  'Деньги сейчас не списываются', 'Supabase access token', 'RLS repository adapter',
  'service_role для этого пути не нужен',
])

const gatewayClient = await read('src', 'gateway.ts')
requireSnippets('frontend gateway client', gatewayClient, [
  "import { supabase } from './data'", 'data.session?.access_token', "headers.set('authorization'", 'return fetch',
])
if (gatewayClient.includes('service_role')) fail('frontend gateway client must never use service_role')

const billingClient = await read('src', 'billing.ts')
requireSnippets('billing client', billingClient, [
  'getBillingState', 'billingRemainingDocuments', 'billingErrorMessage', 'currentBillingPeriodStart',
  ".eq('period_start', periodStart).maybeSingle()", "code: 'start'", 'monthly_price_rub: 990',
  "code: 'business'", 'monthly_price_rub: 2490', "code: 'team'", 'monthly_price_rub: 4990',
])
if (billingClient.includes(".order('period_start', { ascending: false }).limit(1)")) fail('billing client must read current month, not latest historical usage')

const initMigration = await read('supabase', 'migrations', '202609010001_init.sql')
for (const table of ['profiles','companies','vehicles','drivers','documents','integration_requests']) {
  if (!initMigration.includes(`alter table public.${table} enable row level security`)) fail(`RLS not enabled for ${table}`)
}
requireSnippets('documents RLS', initMigration, [
  'grant select, insert, update, delete on public.documents to authenticated',
  'create policy "documents_own" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
  'create trigger documents_updated_at',
])

const directoryMigration = await read('supabase', 'migrations', '202609010002_extend_directories_t1.sql')
requireSnippets('T1 directory migration', directoryMigration, [
  'add column if not exists org_type', 'add column if not exists edo_id', 'add column if not exists address_region',
  'add column if not exists ownership_type', 'add column if not exists license_series', 'companies_org_type_check',
])

const attemptsMigration = await read('supabase', 'migrations', '202609010003_operator_attempts.sql')
requireSnippets('operator attempts migration', attemptsMigration, [
  'create table if not exists public.operator_attempts', "operation in ('generate_title','post_message')",
  "status in ('started','succeeded','failed','blocked')", 'operator_attempts_unique_action unique',
  'request_fingerprint', 'idempotency_key', 'document_revision', 'alter table public.operator_attempts enable row level security',
  'create policy "operator_attempts_read_own"', 'grant select on public.operator_attempts to authenticated',
  'revoke insert, update, delete on public.operator_attempts from authenticated',
])
if (/grant\s+(?:insert|update|delete).*operator_attempts\s+to\s+authenticated/i.test(attemptsMigration)) {
  fail('browser/user JWT must not receive operator_attempt write grants')
}

const billingMigration = await read('supabase', 'migrations', '202609020001_billing_foundation.sql')
requireSnippets('billing foundation migration', billingMigration, [
  'create table if not exists public.billing_plans', 'create table if not exists public.billing_settings',
  'create table if not exists public.subscriptions', 'create table if not exists public.billing_usage_monthly',
  "('start', 'Старт', 990, 50", "('business', 'Бизнес', 2490, 500", "('team', 'Команда', 4990, 2000",
  "values ('default', false, 14)", 'init_epd_light_subscription', 'consume_epd_light_document_quota',
  'after insert on public.documents', "message = 'billing_document_limit_reached'",
  'grant select on public.subscriptions to authenticated', 'grant select on public.billing_usage_monthly to authenticated',
])
for (const forbidden of [
  'grant insert on public.subscriptions to authenticated', 'grant update on public.subscriptions to authenticated',
  'grant delete on public.subscriptions to authenticated', 'grant insert on public.billing_usage_monthly to authenticated',
  'grant update on public.billing_usage_monthly to authenticated',
]) if (billingMigration.includes(forbidden)) fail(`browser must not receive billing write permission: ${forbidden}`)

const writerMigration = await read('supabase', 'migrations', '202609020002_gateway_writer_role.sql')
requireSnippets('restricted gateway writer migration', writerMigration, [
  'create role epd_gateway_writer nologin noinherit', 'grant select, insert, update on public.operator_attempts to epd_gateway_writer',
  'revoke delete on public.operator_attempts from epd_gateway_writer', 'operator_attempts_gateway_select',
  'operator_attempts_gateway_insert', 'operator_attempts_gateway_update',
])
if (/create\s+role\s+epd_gateway_writer\s+login/i.test(writerMigration)) fail('gateway capability role must remain NOLOGIN')

const etrn = await read('src', 'etrn.ts')
requireSnippets('draft-v4', etrn, [
  'FNS_ETRN_REFERENCE', "knd: '1110339'", "formatVersion: '5.01'", 'ON_TRNACLGROT_1_973_01_05_01_02',
  'emptyRussianAddress', 'emptyLoadingDetails', 'validGuid', 'LoadingPartyDetails', 'normalizeEtrn', 'operatorReadiness',
  "schemaVersion:'epd-light/draft-4'",
])
const operatorDraft = await read('src', 'operator-draft.ts')
requireSnippets('operator candidate', operatorDraft, [
  'epd-light/operator-candidate-v1', 'draftModelVersion: 4', 'internalId: doc.id', 'loadingDetails:',
  'браузерский payload не является авторитетным', 'не является XML ФНС', 'unresolvedByDesign',
])

const gateway = await read('server', 'index.mjs')
requireSnippets('gateway', gateway, [
  "url.pathname === '/api/operator/capabilities'", "url.pathname === '/api/operator/preflight'",
  "url.pathname === '/api/operator/kontur/userdata-preview'", "url.pathname === '/api/operator/send'",
  "url.pathname.startsWith('/api/operator/')", 'authenticateGatewayRequest', 'EXTERNAL_OPERATOR_AUTHORIZATION_POLICY',
  'supabaseDocumentRepositoryPublicCapabilities', 'KONTUR_SANDBOX_GENERATION_POLICY', 'generateKonturSandboxTitleForDocument',
  'createOperatorAttemptRepository', 'operatorAttemptRepositoryConfigFromEnv', 'persistentAttemptJournal',
  'attemptRepository,', 'sandbox_already_generated', 'sandbox_generation_in_progress', 'operator_attempt_journal_update_failed',
  "operatorMode === 'sandbox'", "provider === 'kontur'", 'sandboxGenerateReady',
  "scope: 'operator-external'", 'rateConfig.externalMax', 'maxExternalCallsPerAuthenticatedSubject',
  'externalSendEnabled: false', "error: 'operator_send_disabled'", 'writeGatewayAudit', 'path: url.pathname',
])
if (gateway.includes("url.pathname === '/api/operator/kontur/generate-title'")) fail('non-sandbox GenerateTitleXml route must not exist')
if (gateway.includes("url.pathname === '/api/operator/kontur/schemas'")) fail('schema discovery must not be exposed as a gateway route')
if (gateway.includes('req.headers.authorization')) fail('gateway routing/audit must delegate Authorization handling to auth module')

const auth = await read('server', 'auth.mjs')
requireSnippets('gateway auth', auth, [
  'createRemoteJWKSet', 'jwtVerify', '/auth/v1/.well-known/jwks.json',
  "audience: String(env.EPD_AUTH_AUDIENCE || 'authenticated')", "role !== 'authenticated'", 'algorithms: config.algorithms',
  'Non-disabled operator mode requires EPD_GATEWAY_AUTH_MODE=supabase', 'sharedJwtSecretAccepted: false',
  "Object.defineProperty(result, 'accessToken'", 'accessTokenEnumerable: false',
])
for (const forbidden of ['JWT_SECRET', 'service_role', 'console.log(token)', 'console.log(payload)']) {
  if (auth.includes(forbidden)) fail(`gateway auth contains forbidden pattern: ${forbidden}`)
}

const authorization = await read('server', 'authorization.mjs')
requireSnippets('external authorization', authorization, [
  'authorizeExternalOperatorDocument', 'ownerSubject', "error: 'document_not_available'", "error: 'document_identity_mismatch'",
  'serverLoadedDocumentRequired: true', 'ownershipMatchRequired: true', 'clientPayloadAuthoritative: false',
  'sandboxGenerateTitleRouteImplemented: true', 'sandboxGenerateTitleOnly: true', 'productionSendRouteEnabled: false',
  'backendDocumentRepositoryAdapterReady: true', 'supabaseRlsUsed: true', 'serviceRoleRequired: false',
  'runtimeRepositoryConfigurationRequired: true',
])

const canonicalMapper = await read('server', 'mappers', 'operator-candidate.mjs')
requireSnippets('canonical mapper', canonicalMapper, [
  'buildCanonicalOperatorCandidate', "canonicalSource: 'server-documents-row'", 'sourceRevision: text(row.updated_at)',
  "revisionColumn: 'updated_at'", 'requiresServerValidation: true', 'clientIntegrationJsonTrusted: false',
  'serverRevalidationRequired: true', 'draftModelVersion: 4',
])

const documentRepository = await read('server', 'repositories', 'supabase-documents.mjs')
requireSnippets('Supabase RLS repository', documentRepository, [
  'loadSupabaseDocumentWithUserToken', 'createSupabaseOwnedCandidateLoader', '/rest/v1/documents',
  'authorization: `Bearer ${token}`', 'updated_at', 'EPD_DATA_SUPABASE_PUBLIC_KEY', 'usesUserJwt: true', 'reliesOnRls: true',
  'serviceRoleRequired: false', 'canonicalCandidateMapperReady: true',
])
if (documentRepository.includes('service_role')) fail('RLS document repository must not use service_role')

const attemptRepository = await read('server', 'repositories', 'operator-attempts.mjs')
requireSnippets('persistent operator attempt repository', attemptRepository, [
  "import('pg')", 'EPD_GATEWAY_DATABASE_URL', "EPD_GATEWAY_DATABASE_ROLE || 'epd_gateway_writer'",
  'set local role ${config.writerRole}', "set local statement_timeout = '5000ms'", 'on conflict (provider, operation, mode, idempotency_key) do nothing',
  "state: 'already_succeeded'", "state: 'in_progress'", "state: 'claimed_retry'", 'async succeed(', 'async fail(',
  'storesDocumentPayload: false', 'storesXml: false', 'storesTokens: false',
])
for (const forbidden of ['console.log(config.connectionString)', 'request body', 'generatedXml']) {
  if (attemptRepository.includes(forbidden)) fail(`operator attempt repository may expose sensitive data: ${forbidden}`)
}

const idempotency = await read('server', 'idempotency.mjs')
requireSnippets('operator idempotency', idempotency, [
  "import { createHash } from 'node:crypto'", 'buildOperatorActionIdentity', 'requestFingerprint', 'idempotencyKey',
  'sourceRevision', 'stableJson', 'runInFlightOnce', 'concurrentDuplicatesSharedPerProcess: true',
  "completedPersistenceTable: 'public.operator_attempts'", 'completedPersistenceRepositoryImplemented: true',
  'completedPersistenceRuntimeOptional: true', 'completedPersistenceUsesRestrictedDbRole: true',
])

const rateLimit = await read('server', 'rate-limit.mjs')
requireSnippets('rate limiting', rateLimit, [
  'consumeRateLimit', 'requestNetworkKey', "req?.headers?.['x-real-ip']", 'authenticatedRateKey', 'retry-after', 'createHash',
  'EPD_EXTERNAL_RATE_LIMIT_MAX', 'externalMax',
])
const audit = await read('server', 'audit.mjs')
requireSnippets('privacy audit', audit, ["event: 'gateway_request'", 'createGatewayAuditEvent', 'writeGatewayAudit', 'auditErrorCode', 'SAFE_CODE_RE'])
for (const forbidden of ['input.body', 'input.headers', 'input.authorization', 'input.token', 'JSON.stringify(input)']) {
  if (audit.includes(forbidden)) fail(`audit module may serialize sensitive input: ${forbidden}`)
}

const konturProvider = await read('server', 'providers', 'kontur.mjs')
requireSnippets('Kontur provider', konturProvider, [
  "documentTypeNamedId: 'LogisticsWaybill'", "documentFunction: 'reception'", "documentVersion: 'kl_trn_mt_05_01'",
  'findKonturT1Descriptor', 'discoverKonturT1Descriptor', 'getKonturContent', 'schemaDiscoveryWiredToGateway: false',
  'userDataPreviewWiredToGateway: true', 'generateTitleBoundaryReady: true', 'generateTitleWiredToGateway: false',
  'postMessageImplemented: false', 'sendWiredToGateway: false',
])
const konturUserData = await read('server', 'providers', 'kontur-userdata.mjs')
requireSnippets('Kontur UserData', konturUserData, [
  'validateKonturT1Candidate', 'buildKonturT1UserDataXml', '<LogisticsWaybillConsignorTitle', '<OrganizationReference',
  '<DeliveryAddres>', 'ContainerType', 'Ownership', 'WeighingMethod', 'EnablingTimeZone="0"',
  'LoadingPartyDetails', 'LoadingOwnerDetails', 'xsdValidated: false',
])
const generation = await read('server', 'services', 'kontur-title.mjs')
requireSnippets('Kontur generation boundary', generation, [
  'generateKonturT1FromCandidate', 'generateAuthorizedKonturT1', 'generateAuthorizedKonturT1FromSupabase',
  'authorizeExternalOperatorDocument', 'createSupabaseOwnedCandidateLoader', 'supabaseRlsRepositoryBoundaryReady: true',
  'serverLoadedDocumentRequiredForGateway: true', 'clientPayloadAuthoritative: false', 'gatewayRouteExposed: false',
  'callsPostMessage: false', 'signed: false', 'sent: false',
])
const sandboxGeneration = await read('server', 'services', 'kontur-sandbox.mjs')
requireSnippets('Kontur sandbox boundary', sandboxGeneration, [
  'validateSandboxGenerateRequest', 'generateKonturSandboxTitleForDocument', "key !== 'documentId'", 'sandbox_payload_rejected',
  'createSupabaseOwnedCandidateLoader', 'authorizeExternalOperatorDocument', 'buildOperatorActionIdentity', 'runInFlightOnce',
  'attemptRepository = null', "state === 'already_succeeded'", "state === 'in_progress'", 'attemptRepository.succeed', 'attemptRepository.fail',
  "gatewayRoute: '/api/operator/kontur/generate-title-sandbox'", "enabledOperatorMode: 'sandbox'",
  'clientDocumentPayloadAccepted: false', 'clientIdempotencyKeyAccepted: false', 'supabaseRlsReloadRequired: true',
  'concurrentDuplicateExternalCallsCollapsed: true', 'completedAttemptPersistenceTableReady: true',
  'completedAttemptPersistenceOptional: true', 'persistentDuplicateExternalCallsBlockedWhenConfigured: true',
  'callsPostMessage: false', 'signsDocument: false', 'sendsDocument: false',
])

const compose = await read('docker-compose.yml')
requireSnippets('Docker Compose', compose, [
  'gateway:', 'expose:', 'nginx-compose.conf', 'EPD_GATEWAY_AUTH_MODE', 'EPD_AUTH_SUPABASE_URL',
  'EPD_DATA_SUPABASE_URL', 'EPD_DATA_SUPABASE_PUBLIC_KEY', 'EPD_GATEWAY_DATABASE_URL', 'EPD_GATEWAY_DATABASE_ROLE',
  'EPD_OPERATOR_ATTEMPT_STALE_MS', 'EPD_RATE_LIMIT_MAX', 'EPD_EXTERNAL_RATE_LIMIT_MAX', 'EPD_KONTUR_ACCESS_TOKEN',
])
const nginx = await read('deploy', 'nginx-compose.conf')
requireSnippets('nginx proxy', nginx, [
  'proxy_pass http://gateway:8787', 'proxy_set_header Authorization $http_authorization',
  'proxy_set_header X-Real-IP $remote_addr', 'proxy_set_header X-Forwarded-For $remote_addr',
])
const serverDockerfile = await read('server', 'Dockerfile')
requireSnippets('gateway Docker image', serverDockerfile, ['COPY package.json', 'npm install --omit=dev', 'COPY . .', 'USER node'])

const deployCheck = await read('scripts', 'check-deployment-env.mjs')
requireSnippets('deployment env checker', deployCheck, [
  'Production EPD_GATEWAY_AUTH_MODE must be supabase', 'EPD_DATA_SUPABASE_PUBLIC_KEY', 'Wildcard CORS origin is forbidden',
  'Potential server secret exposed through VITE_*', 'EPD_EXTERNAL_RATE_LIMIT_MAX must not exceed EPD_RATE_LIMIT_MAX', 'EPD_KONTUR_BOX_ID',
  'EPD_DATABASE_URL', 'EPD_BACKUP_PASSPHRASE', 'Backup passphrase must differ from database password',
  'EPD_GATEWAY_DATABASE_URL', 'separate restricted login', 'EPD_OPERATOR_ATTEMPT_STALE_MS',
  'EPD_BACKUP_RETENTION_DAYS', 'Restore-test database must differ from EPD_DATABASE_URL',
])
const deployTest = await read('scripts', 'test-deployment-env.mjs')
requireSnippets('deployment env test', deployTest, [
  'safe production env must pass', 'wildcard CORS must fail', 'VITE secret exposure must fail',
  'weak backup passphrase must fail', 'backup passphrase reused as DB password must fail',
  'gateway must not reuse migration/backup DB credential', 'separate restricted gateway DB credential should pass',
  'restore-test DB must never equal production DB', 'sandbox without Kontur credentials must fail',
  'sandbox with restricted persistent journal must pass',
])

const schemaCheck = await read('scripts', 'check-fns-schema.mjs')
if (!schemaCheck.includes('min_ON_TRNACLGROT_1_973_01_05_01_02.xsd')) fail('FNS schema checker does not pin expected draft XSD')
const konturSchemaCheck = await read('scripts', 'check-kontur-schemas.mjs')
requireSnippets('Kontur schema checker', konturSchemaCheck, ['discoverKonturT1Descriptor', 'getKonturContent', 'sha256', 'UserDataXsd', 'EPD_KONTUR_BOX_ID'])
const sandboxTest = await read('scripts', 'test-kontur-sandbox.mjs')
requireSnippets('Kontur sandbox test', sandboxTest, [
  'documentId-only request', 'sandbox_payload_rejected', 'Bearer user-access-token', 'public-key',
  "pathname === '/GenerateTitleXml'", 'same-revision sandbox calls must collapse to one external request',
  'persistent duplicate must be blocked before operator request', 'sandbox_already_generated', 'crossAccountExternalCall === false',
])
const billingTest = await read('scripts', 'test-billing-foundation.mjs')
requireSnippets('billing test', billingTest, [
  'billing migration missing invariant', 'browser must not receive billing write permission', 'current-month usage',
  'billing UI drifted from billing catalogue', 'billing app UI invariant missing',
])

const pkg = JSON.parse(await read('package.json'))
for (const script of [
  'build','prebuild','preflight','deploy:check','deploy:env:test','deploy:server-day','db:migrate',
  'backup:create','backup:verify','backup:restore:test','audit:test','auth:test','authorization:test','repository:test',
  'idempotency:test','billing:test','rate-limit:test','gateway:test','gateway:auth:test','kontur:provider:test',
  'kontur:userdata:test','kontur:generation:test','kontur:sandbox:test','kontur:schema:check','kontur:schema:save','fns:schema:check',
]) if (!pkg.scripts?.[script]) fail(`required package script missing: ${script}`)
if (pkg.dependencies?.jose !== '6.2.10') fail('root jose dependency must stay pinned to tested version 6.2.10')
if (pkg.dependencies?.pg !== '8.23.0') fail('root pg dependency must stay pinned to tested version 8.23.0')
const serverPkg = JSON.parse(await read('server', 'package.json'))
if (serverPkg.dependencies?.jose !== '6.2.10') fail('gateway jose dependency must stay pinned to tested version 6.2.10')
if (serverPkg.dependencies?.pg !== '8.23.0') fail('gateway pg dependency must stay pinned to tested version 8.23.0')

console.log(`Preflight OK: ${parts.length} source parts, 5 migrations, billing foundation, encrypted deployment policy, JWT/RLS canonical reads, persistent operator idempotency, sandbox GenerateTitle, rate limits, privacy audit and fail-closed PostMessage/send verified`)
