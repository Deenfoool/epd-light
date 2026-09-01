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
  'export default function App()', 'function Wizard(', 'function Documents(', 'function Integrations(',
  'function RussianAddressEditor(', 'gatewayFetch', 'buildOperatorDraft', 'operatorReadiness',
  'ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ',
  'Статусы «Передан оператору», «Подписан» и «Принят ГИС ЭПД» недоступны',
  'dirty.current=true', "addEventListener('beforeunload',beforeUnload)",
  'Структурированный адрес погрузки', 'Лицо и владелец места погрузки', 'MatchingShipper',
  'Код тары / ContainerType', 'Код Ownership (оператор)', 'companies-example-t1.csv',
  '/api/operator/capabilities', '/api/operator/kontur/userdata-preview', 'Kontur XML preview',
  'Supabase access token', 'RLS repository adapter', 'service_role для этого пути не нужен',
])

const gatewayClient = await read('src', 'gateway.ts')
requireSnippets('frontend gateway client', gatewayClient, [
  "import { supabase } from './data'", 'data.session?.access_token', "headers.set('authorization'", 'return fetch',
])
if (gatewayClient.includes('service_role')) fail('frontend gateway client must never use service_role')

const migration = await read('supabase', 'migrations', '202609010001_init.sql')
for (const table of ['profiles','companies','vehicles','drivers','documents','integration_requests']) {
  if (!migration.includes(`alter table public.${table} enable row level security`)) fail(`RLS not enabled for ${table}`)
}
requireSnippets('documents RLS', migration, [
  'grant select, insert, update, delete on public.documents to authenticated',
  'create policy "documents_own" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
])
const directoryMigration = await read('supabase', 'migrations', '202609010002_extend_directories_t1.sql')
requireSnippets('T1 directory migration', directoryMigration, [
  'add column if not exists org_type', 'add column if not exists edo_id', 'add column if not exists address_region',
  'add column if not exists ownership_type', 'add column if not exists license_series', 'companies_org_type_check',
])

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
  'supabaseDocumentRepositoryPublicCapabilities', 'consumeRateLimit', 'rateLimitHeaders',
  'externalSendEnabled: false', 'externalCallMade: false', "error: 'operator_send_disabled'", 'writeGatewayAudit', 'path: url.pathname',
])
for (const forbiddenRoute of ['/api/operator/kontur/generate-title', '/api/operator/kontur/schemas']) {
  if (gateway.includes(forbiddenRoute)) fail(`${forbiddenRoute} must not be exposed as a gateway route`)
}
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
  'backendDocumentRepositoryAdapterReady: true', 'supabaseRlsUsed: true', 'serviceRoleRequired: false',
  'runtimeRepositoryConfigurationRequired: true', 'gatewayExternalRouteEnabled: false',
])

const canonicalMapper = await read('server', 'mappers', 'operator-candidate.mjs')
requireSnippets('canonical mapper', canonicalMapper, [
  'buildCanonicalOperatorCandidate', "canonicalSource: 'server-documents-row'", 'requiresServerValidation: true',
  'clientIntegrationJsonTrusted: false', 'serverRevalidationRequired: true', 'draftModelVersion: 4',
])
const repository = await read('server', 'repositories', 'supabase-documents.mjs')
requireSnippets('Supabase RLS repository', repository, [
  'loadSupabaseDocumentWithUserToken', 'createSupabaseOwnedCandidateLoader', '/rest/v1/documents',
  'authorization: `Bearer ${token}`', 'EPD_DATA_SUPABASE_PUBLIC_KEY', 'usesUserJwt: true', 'reliesOnRls: true',
  'serviceRoleRequired: false', 'canonicalCandidateMapperReady: true',
])
if (repository.includes('service_role')) fail('RLS document repository must not use service_role')

const rateLimit = await read('server', 'rate-limit.mjs')
requireSnippets('rate limiting', rateLimit, [
  'consumeRateLimit', 'requestNetworkKey', "req?.headers?.['x-real-ip']", 'authenticatedRateKey', 'retry-after', 'createHash',
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

const compose = await read('docker-compose.yml')
requireSnippets('Docker Compose', compose, [
  'gateway:', 'expose:', 'nginx-compose.conf', 'EPD_GATEWAY_AUTH_MODE', 'EPD_AUTH_SUPABASE_URL',
  'EPD_DATA_SUPABASE_URL', 'EPD_DATA_SUPABASE_PUBLIC_KEY', 'EPD_RATE_LIMIT_MAX', 'EPD_KONTUR_ACCESS_TOKEN',
])
const nginx = await read('deploy', 'nginx-compose.conf')
requireSnippets('nginx proxy', nginx, [
  'proxy_pass http://gateway:8787', 'proxy_set_header Authorization $http_authorization',
  'proxy_set_header X-Real-IP $remote_addr', 'proxy_set_header X-Forwarded-For $remote_addr',
])
const serverDockerfile = await read('server', 'Dockerfile')
requireSnippets('gateway Docker image', serverDockerfile, ['COPY package.json', 'npm install --omit=dev', 'COPY . .', 'USER node'])
const serverPkg = JSON.parse(await read('server', 'package.json'))
if (serverPkg.dependencies?.jose !== '6.2.10') fail('gateway Docker runtime must pin jose 6.2.10')

const schemaCheck = await read('scripts', 'check-fns-schema.mjs')
if (!schemaCheck.includes('min_ON_TRNACLGROT_1_973_01_05_01_02.xsd')) fail('FNS schema checker does not pin expected draft XSD')
const konturSchemaCheck = await read('scripts', 'check-kontur-schemas.mjs')
requireSnippets('Kontur schema checker', konturSchemaCheck, ['discoverKonturT1Descriptor', 'getKonturContent', 'sha256', 'UserDataXsd', 'EPD_KONTUR_BOX_ID'])

const pkg = JSON.parse(await read('package.json'))
for (const script of [
  'build','prebuild','preflight','audit:test','auth:test','authorization:test','repository:test','rate-limit:test',
  'gateway:test','gateway:auth:test','kontur:provider:test','kontur:userdata:test','kontur:generation:test',
  'kontur:schema:check','kontur:schema:save','fns:schema:check',
]) if (!pkg.scripts?.[script]) fail(`required package script missing: ${script}`)
if (pkg.dependencies?.jose !== '6.2.10') fail('root jose dependency must stay pinned to tested version 6.2.10')

console.log(`Preflight OK: ${parts.length} source parts, JWT/JWKS auth, RLS ownership repository, canonical mapping, rate limits, privacy audit, Docker gateway and fail-closed Kontur boundaries verified`)
