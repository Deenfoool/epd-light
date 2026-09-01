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

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  await waitForHealth()

  const capabilitiesResponse = await fetch(`${base}/api/operator/capabilities`)
  const capabilities = await capabilitiesResponse.json()
  assert(capabilitiesResponse.status === 200, 'capabilities status must be 200')
  assert(capabilities.externalSendEnabled === false, 'external sending must be fail-closed')
  assert(capabilities.xsdValidationEnabled === false, 'XSD validation must not be claimed')

  const candidate = {
    kind: 'epd-light/operator-candidate-v1',
    document: { number: 'TEST-1', date: '2026-09-01' },
    participants: {
      shipper: { name: 'ООО Тест', inn: '7700000000' },
      consignee: { name: 'ООО Тест 2', inn: '7800000000' },
      carrier: { name: 'ИП Тест', inn: '770000000001' },
    },
    cargo: [{ name: 'Тестовый груз' }],
    vehicle: { registrationNumber: 'А001АА777' },
    driver: { fullName: 'Иванов Иван Иванович' },
    readiness: { candidate: true },
  }

  const preflightResponse = await fetch(`${base}/api/operator/preflight`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(candidate),
  })
  const preflight = await preflightResponse.json()
  assert(preflightResponse.status === 200 && preflight.ok === true, 'valid candidate should pass structural preflight')
  assert(preflight.warnings.some((x) => String(x).includes('не является XSD')), 'preflight must disclaim XSD validation')

  const sendResponse = await fetch(`${base}/api/operator/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(candidate),
  })
  const send = await sendResponse.json()
  assert(sendResponse.status === 503, 'send endpoint must stay disabled')
  assert(send.error === 'operator_send_disabled', 'send endpoint must return operator_send_disabled')

  console.log('Gateway smoke test OK: health, capabilities, preflight and fail-closed send verified')
} finally {
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(1000),
  ])
  if (!child.killed) child.kill('SIGKILL')
}
