import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const port = 18787 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(port), EPD_OPERATOR_PROVIDER: 'none', EPD_OPERATOR_MODE: 'disabled' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stderr = ''
child.stderr.on('data', (chunk) => { stderr += String(chunk) })

async function waitForHealth() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${base}/healthz`)
      if (r.ok) return
    } catch {}
    await sleep(100)
  }
  throw new Error(`gateway did not become healthy: ${stderr}`)
}

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const a = (region, city) => ({ zipCode: '123456', region, city, settlement: '', street: 'Тестовая', building: '1', corpus: '', apartment: '' })
const p = (id, phone) => ({ kind: 'org', name: 'ООО Тест', inn: '7700000000', kpp: '770001001', address: '', russianAddress: a('77','Москва'), phone, email: '', edoId: id })

try {
  await waitForHealth()

  const capabilitiesResponse = await fetch(`${base}/api/operator/capabilities`)
  const capabilities = await capabilitiesResponse.json()
  assert(capabilitiesResponse.status === 200, 'capabilities status must be 200')
  assert(capabilities.externalSendEnabled === false, 'external sending must be fail-closed')
  assert(capabilities.xsdValidationEnabled === false, 'XSD validation must not be claimed')
  assert(capabilities.localKonturUserDataPreview?.externalCallRequired === false, 'UserData preview must be local-only')

  const candidate = {
    kind: 'epd-light/operator-candidate-v1',
    document: { number: 'TEST-1', date: '2026-09-01', orderNumber: 'ORDER-1', orderDate: '2026-09-01' },
    participants: {
      shipper: p('11111111-1111-4111-8111-111111111111', '+79000000001'),
      consignee: p('22222222-2222-4222-8222-222222222222', '+79000000002'),
      carrier: p('33333333-3333-4333-8333-333333333333', '+79000000003'),
    },
    route: {
      loadingRussianAddress: a('77','Москва'), unloadingRussianAddress: a('69','Тверь'),
      plannedLoadingDate: '2026-09-01', plannedLoadingTime: '09:00', actualArrival: '2026-09-01T08:55', actualDeparture: '2026-09-01T09:20',
    },
    cargo: [{ name: 'Тестовый груз', state: 'Целый', packagingMethod: 'Коробки', packagingCode: '00', places: '1', grossWeightKg: '10', marking: 'Отсутствует' }],
    loadingFacts: { actualGrossWeight: '10', actualPlaces: '1', massDeterminationMethod: '01' },
    vehicle: { registrationNumber: 'А001АА777', type: 'грузовой автомобиль', ownershipType: '1', brand: 'Тест', model: '1', loadCapacity: '20', volumeCapacity: '80' },
    driver: { fullName: 'Иванов Иван Иванович', phone: '+79000000003', licenseSeries: '9999', licenseNumber: '123456', licenseLegacy: '', licenseIssueDate: '2024-01-20' },
    shipperInstructions: { instructions: 'Особых указаний нет', redirectionContact: '+79000000001' },
    signer: { fullName: 'Петров Петр Петрович', position: 'Кладовщик' },
    readiness: { candidate: true },
  }

  const preflightResponse = await fetch(`${base}/api/operator/preflight`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(candidate),
  })
  const preflight = await preflightResponse.json()
  assert(preflightResponse.status === 200 && preflight.ok === true, 'valid candidate should pass structural preflight')
  assert(preflight.warnings.some((x) => String(x).includes('не является XSD')), 'preflight must disclaim XSD validation')

  const previewResponse = await fetch(`${base}/api/operator/kontur/userdata-preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(candidate),
  })
  const preview = await previewResponse.json()
  assert(previewResponse.status === 200 && preview.ok === true, 'valid candidate should produce local UserData preview')
  assert(preview.externalCallMade === false, 'UserData preview must not make an external call')
  assert(preview.contract?.xsdValidated === false, 'UserData preview must not claim XSD validation')
  assert(String(preview.xml).includes('<LogisticsWaybillConsignorTitle'), 'UserData preview XML root missing')

  const sendResponse = await fetch(`${base}/api/operator/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(candidate),
  })
  const send = await sendResponse.json()
  assert(sendResponse.status === 503, 'send endpoint must stay disabled')
  assert(send.error === 'operator_send_disabled', 'send endpoint must return operator_send_disabled')

  console.log('Gateway smoke test OK: health, capabilities, preflight, local Kontur UserData preview and fail-closed send verified')
} finally {
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(1000)])
  if (!child.killed) child.kill('SIGKILL')
}
