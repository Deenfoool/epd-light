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
  'function ImportPage(',
  'function Integrations(',
  'ЧЕРНОВИК — НЕ ЯВЛЯЕТСЯ ПЕРЕВОЗОЧНЫМ ДОКУМЕНТОМ',
  'Готов к передаче оператору',
  'Статусы «Передан оператору», «Подписан» и «Принят ГИС ЭПД» недоступны',
  'dirty.current=true',
  "addEventListener('beforeunload',beforeUnload)",
  'Базовая проверка пройдена',
  'positiveNumber(r.places)',
  'positiveNumber(r.weight)',
  'https://www.nalog.gov.ru/rn77/related_activities/el_doc/el_bus_entities/edotransp/',
]
for (const snippet of requiredSnippets) if (!app.includes(snippet)) fail(`missing app invariant: ${snippet}`)

const migration = await readFile(path.join(root, 'supabase', 'migrations', '202609010001_init.sql'), 'utf8')
for (const table of ['profiles','companies','vehicles','drivers','documents','integration_requests']) {
  if (!migration.includes(`alter table public.${table} enable row level security`)) fail(`RLS not enabled for ${table}`)
}
if (!migration.includes('grant select, insert, update, delete on public.documents to authenticated')) fail('authenticated document grants missing')

const operator = await readFile(path.join(root, 'src', 'operator.ts'), 'utf8')
for (const snippet of ['interface OperatorAdapter', 'assertOperatorConfigured', 'sendToOperatorDisabled', 'Отправка оператору ИС ЭПД не настроена в MVP']) {
  if (!operator.includes(snippet)) fail(`operator safety invariant missing: ${snippet}`)
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!pkg.scripts?.build || !pkg.scripts?.prebuild || !pkg.scripts?.preflight) fail('build/prebuild/preflight scripts missing')

console.log(`Preflight OK: ${parts.length} source parts, ${app.length} app bytes, RLS and safety checks passed`)
