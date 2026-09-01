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
  'Gateway online',
]
for (const snippet of requiredSnippets) if (!app.includes(snippet)) fail(`missing app invariant: ${snippet}`)

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
for (const snippet of ['epd-light/operator-candidate-v1', 'draftModelVersion: 4', 'loadingRussianAddress', 'unloadingRussianAddress', 'loadingDetails:', 'не является XML ФНС', 'unresolvedByDesign']) {
  if (!operatorDraft.includes(snippet)) fail(`operator draft invariant missing: ${snippet}`)
}

const gateway = await readFile(path.join(root, 'server', 'index.mjs'), 'utf8')
for (const snippet of ["url.pathname === '/api/operator/capabilities'", "url.pathname === '/api/operator/preflight'", "url.pathname === '/api/operator/kontur/userdata-preview'", "url.pathname === '/api/operator/send'", 'externalSendEnabled: false', 'externalCallMade: false', "error: 'operator_send_disabled'"]) {
  if (!gateway.includes(snippet)) fail(`gateway fail-closed invariant missing: ${snippet}`)
}
if (gateway.includes('/api/operator/kontur/generate-title')) fail('GenerateTitleXml must not be exposed as an unauthenticated gateway route')

const konturProvider = await readFile(path.join(root, 'server', 'providers', 'kontur.mjs'), 'utf8')
for (const snippet of ["documentTypeNamedId: 'LogisticsWaybill'", "documentFunction: 'reception'", "documentVersion: 'kl_trn_mt_05_01'", 'userDataPreviewWiredToGateway: true', 'generateTitleBoundaryReady: true', 'generateTitleWiredToGateway: false', 'postMessageImplemented: false', 'sendWiredToGateway: false']) {
  if (!konturProvider.includes(snippet)) fail(`Kontur provider invariant missing: ${snippet}`)
}

const konturUserData = await readFile(path.join(root, 'server', 'providers', 'kontur-userdata.mjs'), 'utf8')
for (const snippet of ['validateKonturT1Candidate', 'buildKonturT1UserDataXml', '<LogisticsWaybillConsignorTitle', '<OrganizationReference', '<DeliveryAddres>', 'ContainerType', 'Ownership', 'WeighingMethod', 'EnablingTimeZone="0"', 'LoadingPartyDetails', 'LoadingOwnerDetails', 'xsdValidated: false']) {
  if (!konturUserData.includes(snippet)) fail(`Kontur UserData preview invariant missing: ${snippet}`)
}

const generationBoundary = await readFile(path.join(root, 'server', 'services', 'kontur-title.mjs'), 'utf8')
for (const snippet of ['generateKonturT1FromCandidate', 'generateKonturT1Xml', 'gatewayRouteExposed: false', 'callsPostMessage: false', 'signed: false', 'sent: false']) {
  if (!generationBoundary.includes(snippet)) fail(`Kontur generation boundary invariant missing: ${snippet}`)
}

const compose = await readFile(path.join(root, 'docker-compose.yml'), 'utf8')
if (!compose.includes('gateway:') || !compose.includes('expose:') || !compose.includes('nginx-compose.conf')) fail('docker compose gateway wiring missing')
const nginxCompose = await readFile(path.join(root, 'deploy', 'nginx-compose.conf'), 'utf8')
if (!nginxCompose.includes('proxy_pass http://gateway:8787')) fail('nginx does not proxy /api to private gateway')

const main = await readFile(path.join(root, 'src', 'main.tsx'), 'utf8')
if (!main.includes("import './v2.css'")) fail('draft-v4 responsive CSS is not loaded')

const schemaCheck = await readFile(path.join(root, 'scripts', 'check-fns-schema.mjs'), 'utf8')
if (!schemaCheck.includes('min_ON_TRNACLGROT_1_973_01_05_01_02.xsd')) fail('FNS schema checker does not pin expected draft XSD')

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
for (const script of ['build','prebuild','preflight','gateway:test','kontur:provider:test','kontur:userdata:test','kontur:generation:test','fns:schema:check']) {
  if (!pkg.scripts?.[script]) fail(`required package script missing: ${script}`)
}

console.log(`Preflight OK: ${parts.length} source parts, ${app.length} app bytes, RLS, T1 directories, draft-v4, Kontur UserData/GenerateTitle boundaries and fail-closed operator checks passed`)
