import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = path.join(root, 'src', 'app-chunks')
const parts = (await readdir(partsDir)).filter((name) => name.endsWith('.part')).sort()

const fail = (message) => {
  console.error(`PRECHECK FAILED: ${message}`)
  process.exit(1)
}

if (parts.length !== 34) fail(`expected 34 app source parts, found ${parts.length}`)

const app = (await Promise.all(parts.map((name) => readFile(path.join(partsDir, name), 'utf8')))).join('')
const requiredSnippets = [
  'export default function App()',
  'function Wizard(',
  'function Documents(',
  'function DirectoryPage',
  'type DirectoryField',
  'function ImportPage(',
  'function Integrations(',
  'function RussianAddressEditor(',
  'partyToCompany',
  'gatewayFetch',
  'ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ',
  'Статусы «Передан оператору», «Подписан» и «Принят ГИС ЭПД» недоступны',
  'dirty.current=true',
  "addEventListener('beforeunload',beforeUnload)",
  'Базовая проверка пройдена',
  'positiveNumber(r.places)',
  'positiveNumber(r.weight)',
  'https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/',
  'Integration JSON',
  'buildOperatorDraft',
  'operatorReadiness',
  'Фактическое прибытие на погрузку',
  'Структурированный адрес погрузки',
  'Лицо и владелец места погрузки',
  'MatchingShipper',
  'Код тары / ContainerType',
  'Код Ownership (оператор)',
  'license_series',
  'address_region',
  'box_id',
  'companies-example-t1.csv',
  'Номер заказа / заявки',
  'не валидирует XML по XSD ФНС',
  '/api/operator/capabilities',
  '/api/operator/kontur/userdata-preview',
  'Kontur XML preview',
  'Supabase access token',
  'backend repository',
  'Gateway online',
]
for (const snippet of requiredSnippets) if (!app.includes(snippet)) fail(`missing app invariant: ${snippet}`)

const gatewayClient = await readFile(path.join(root, 'src', 'gateway.ts'), 'utf8')
for (const snippet of ["import { supabase } from './data'", 'data.session?.access_token', "headers.set('authorization'", 'return fetch']) {
  if (!gatewayClient.includes(snippet)) fail(`frontend gateway auth invariant missing: ${snippet}`)
}
if (gatewayClient.includes('service_role')) fail('frontend gateway helper must never use service_role')

const migration = await readFile(path.join(root, 'supabase', 'migrations', '202609010001_init.sql'), 'utf8')
for (const table of ['profiles','companies','vehicles','drivers','documents','integration_requests']) {
  if (!migration.includes(`alter table public.${table} enable row level security`)) fail(`RLS not enabled for ${table}`)
}
if (!migration.includes('grant select, insert, update, delete on public.documents to authenticated')) fail('authenticated document grants missing')

const directoryMigration = await readFile(path.join(root, 'supabase', 'migrations', '202609010002_extend_directories_t1.sql'), 'utf8')
for (const snippet of ['add column if not exists org_type', 'add column if not exists edo_id', 'add column if not exists address_region', 'add column if not exists ownership_type', 'add column if not exists license_series', 'companies_org_type_check']) {
  if (!directoryMigration.includes(snippet)) fail(`T1 directory migration invariant missing: ${snippet}`)
}

const operator = await readFile(path.join(root, 'src', 'operator.ts'), 'utf8')
for (const snippet of ['interface OperatorAdapter', 'assertOperatorConfigured', 'sendToOperatorDisabled', 'Отправка оператору ИС ЭПД не настроена в MVP']) {
  if (!operator.includes(snippet)) fail(`operator safety invariant missing: ${snippet}`)
}

const etrn = await readFile(path.join(root, 'src', 'etrn.ts'), 'utf8')
for (const snippet of ['FNS_ETRN_REFERENCE', "knd: '1110339'", "formatVersion: '5.01'", 'ON_TRNACLGROT_1_973_01_05_01_02', 'emptyRussianAddress', 'emptyLoadingDetails', 'loadRussianAddress', 'validGuid', 'BoxId должен иметь формат GUID', 'LoadingPartyDetails', 'normalizeEtrn', 'operatorReadiness', "schemaVersion:'epd-light/draft-4'"]) {
  if (!etrn.includes(snippet)) fail(`draft-v4 invariant missing: ${snippet}`)
}

const operatorDraft = await readFile(path.join(root, 'src', 'operator-draft.ts'), 'utf8')
for (const snippet of ['epd-light/operator-candidate-v1', 'draftModelVersion: 4', 'internalId: doc.id', 'loadingRussianAddress', 'unloadingRussianAddress', 'loadingDetails:', 'браузерский payload не является авторитетным', 'не является XML ФНС', 'unresolvedByDesign']) {
  if (!operatorDraft.includes(snippet)) fail(`operator draft invariant missing: ${snippet}`)
}

const gateway = await readFile(path.join(root, 'server', 'index.mjs'), 'utf8')
for (const snippet of ["url.pathname === '/api/operator/capabilities'", "url.pathname === '/api/operator/preflight'", "url.pathname === '/api/operator/kontur/userdata-preview'", "url.pathname === '/api/operator/send'", "url.pathname.startsWith('/api/operator/')", 'authenticateGatewayRequest', 'EXTERNAL_OPERATOR_AUTHORIZATION_POLICY', 'consumeRateLimit', 'rateLimitHeaders', 'externalSendEnabled: false', 'externalCallMade: false', "error: 'operator_send_disabled'", 'writeGatewayAudit', 'path: url.pathname']) {
  if (!gateway.includes(snippet)) fail(`gateway auth/fail-closed/audit invariant missing: ${snippet}`)
}
if (gateway.includes('/api/operator/kontur/generate-title')) fail('GenerateTitleXml must not be exposed as a gateway route')
if (gateway.includes('/api/operator/kontur/schemas')) fail('schema discovery must not be exposed as a gateway route')
if (gateway.includes('req.headers.authorization')) fail('gateway routing/audit must delegate Authorization handling to auth module')

const auth = await readFile(path.join(root, 'server', 'auth.mjs'), 'utf8')
for (const snippet of ['createRemoteJWKSet', 'jwtVerify', '/auth/v1/.well-known/jwks.json', "audience: String(env.EPD_AUTH_AUDIENCE || 'authenticated')", "role !== 'authenticated'", "algorithms: config.algorithms", 'Non-disabled operator mode requires EPD_GATEWAY_AUTH_MODE=supabase', 'sharedJwtSecretAccepted: false']) {
  if (!auth.includes(snippet)) fail(`gateway auth invariant missing: ${snippet}`)
}
for (const forbidden of ['JWT_SECRET', 'service_role', 'console.log(token)', 'console.log(payload)']) {
  if (auth.includes(forbidden)) fail(`gateway auth contains forbidden secret/logging pattern: ${forbidden}`)
}

const authorization = await readFile(path.join(root, 'server', 'authorization.mjs'), 'utf8')
for (const snippet of ['authorizeExternalOperatorDocument', 'ownerSubject', "error: 'document_not_available'", "error: 'document_identity_mismatch'", 'serverLoadedDocumentRequired: true', 'ownershipMatchRequired: true', 'clientPayloadAuthoritative: false', 'backendDocumentRepositoryReady: false']) {
  if (!authorization.includes(snippet)) fail(`external authorization invariant missing: ${snippet}`)
}

const rateLimit = await readFile(path.join(root, 'server', 'rate-limit.mjs'), 'utf8')
for (const snippet of ['consumeRateLimit', 'requestNetworkKey', "req?.headers?.['x-real-ip']", 'authenticatedRateKey', 'retry-after', 'createHash']) {
  if (!rateLimit.includes(snippet)) fail(`gateway rate limit invariant missing: ${snippet}`)
}

const audit = await readFile(path.join(root, 'server', 'audit.mjs'), 'utf8')
for (const snippet of ["event: 'gateway_request'", 'createGatewayAuditEvent', 'writeGatewayAudit', 'auditErrorCode', 'SAFE_CODE_RE', 'JSON.stringify(event)']) {
  if (!audit.includes(snippet)) fail(`privacy-safe audit invariant missing: ${snippet}`)
}
for (const forbidden of ['input.body', 'input.headers', 'input.authorization', 'input.token', 'JSON.stringify(input)']) {
  if (audit.includes(forbidden)) fail(`audit module may serialize sensitive input: ${forbidden}`)
}

const konturProvider = await readFile(path.join(root, 'server', 'providers', 'kontur.mjs'), 'utf8')
for (const snippet of ["documentTypeNamedId: 'LogisticsWaybill'", "documentFunction: 'reception'", "documentVersion: 'kl_trn_mt_05_01'", 'findKonturT1Descriptor', 'discoverKonturT1Descriptor', 'getKonturContent', 'schemaDiscoveryReady: true', 'schemaDiscoveryWiredToGateway: false', 'userDataPreviewWiredToGateway: true', 'generateTitleBoundaryReady: true', 'generateTitleWiredToGateway: false', 'postMessageImplemented: false', 'sendWiredToGateway: false']) {
  if (!konturProvider.includes(snippet)) fail(`Kontur provider invariant missing: ${snippet}`)
}

const konturUserData = await readFile(path.join(root, 'server', 'providers', 'kontur-userdata.mjs'), 'utf8')
for (const snippet of ['validateKonturT1Candidate', 'buildKonturT1UserDataXml', '<LogisticsWaybillConsignorTitle', '<OrganizationReference', '<DeliveryAddres>', 'ContainerType', 'Ownership', 'WeighingMethod', 'EnablingTimeZone="0"', 'LoadingPartyDetails', 'LoadingOwnerDetails', 'xsdValidated: false']) {
  if (!konturUserData.includes(snippet)) fail(`Kontur UserData preview invariant missing: ${snippet}`)
}

const generationBoundary = await readFile(path.join(root, 'server', 'services', 'kontur-title.mjs'), 'utf8')
for (const snippet of ['generateKonturT1FromCandidate', 'generateAuthorizedKonturT1', 'authorizeExternalOperatorDocument', 'serverLoadedDocumentRequiredForGateway: true', 'clientPayloadAuthoritative: false', 'generateKonturT1Xml', 'gatewayRouteExposed: false', 'callsPostMessage: false', 'signed: false', 'sent: false']) {
  if (!generationBoundary.includes(snippet)) fail(`Kontur generation boundary invariant missing: ${snippet}`)
}

const konturSchemaCheck = await readFile(path.join(root, 'scripts', 'check-kontur-schemas.mjs'), 'utf8')
for (const snippet of ['discoverKonturT1Descriptor', 'getKonturContent', 'sha256', 'UserDataXsd', '.cache', 'EPD_KONTUR_BOX_ID']) {
  if (!konturSchemaCheck.includes(snippet)) fail(`Kontur schema checker invariant missing: ${snippet}`)
}

const auditTest = await readFile(path.join(root, 'scripts', 'test-audit.mjs'), 'utf8')
for (const snippet of ['strict allow-list', 'super-secret-bearer-token', 'auditErrorCode', 'http_error']) {
  if (!auditTest.includes(snippet)) fail(`audit test invariant missing: ${snippet}`)
}

const compose = await readFile(path.join(root, 'docker-compose.yml'), 'utf8')
for (const snippet of ['gateway:', 'expose:', 'nginx-compose.conf', 'EPD_GATEWAY_AUTH_MODE', 'EPD_AUTH_SUPABASE_URL', 'EPD_RATE_LIMIT_MAX', 'EPD_KONTUR_ACCESS_TOKEN']) {
  if (!compose.includes(snippet)) fail(`docker compose gateway wiring missing: ${snippet}`)
}
const nginxCompose = await readFile(path.join(root, 'deploy', 'nginx-compose.conf'), 'utf8')
for (const snippet of ['proxy_pass http://gateway:8787', 'proxy_set_header Authorization $http_authorization', 'proxy_set_header X-Real-IP $remote_addr', 'proxy_set_header X-Forwarded-For $remote_addr']) {
  if (!nginxCompose.includes(snippet)) fail(`nginx gateway security invariant missing: ${snippet}`)
}

const serverDockerfile = await readFile(path.join(root, 'server', 'Dockerfile'), 'utf8')
for (const snippet of ['COPY package.json', 'npm install --omit=dev', 'COPY . .', 'USER node']) {
  if (!serverDockerfile.includes(snippet)) fail(`gateway Docker image invariant missing: ${snippet}`)
}
const serverPkg = JSON.parse(await readFile(path.join(root, 'server', 'package.json'), 'utf8'))
if (serverPkg.dependencies?.jose !== '6.2.10') fail('gateway Docker runtime must pin jose 6.2.10')

const main = await readFile(path.join(root, 'src', 'main.tsx'), 'utf8')
if (!main.includes("import './v2.css'")) fail('draft-v4 responsive CSS is not loaded')

const schemaCheck = await readFile(path.join(root, 'scripts', 'check-fns-schema.mjs'), 'utf8')
if (!schemaCheck.includes('min_ON_TRNACLGROT_1_973_01_05_01_02.xsd')) fail('FNS schema checker does not pin expected draft XSD')

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
for (const script of ['build','prebuild','preflight','audit:test','auth:test','authorization:test','rate-limit:test','gateway:test','gateway:auth:test','kontur:provider:test','kontur:userdata:test','kontur:generation:test','kontur:schema:check','kontur:schema:save','fns:schema:check']) {
  if (!pkg.scripts?.[script]) fail(`required package script missing: ${script}`)
}
if (pkg.dependencies?.jose !== '6.2.10') fail('root jose dependency must stay pinned to tested version 6.2.10')

console.log(`Preflight OK: ${parts.length} source parts, ${app.length} app bytes, RLS, JWT auth, ownership authorization, rate limiting, privacy-safe audit, Docker gateway, draft-v4 and Kontur boundaries verified`)
