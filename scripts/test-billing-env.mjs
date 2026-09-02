import { spawnSync } from 'node:child_process'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const base = {
  PATH: process.env.PATH || '',
  EPD_BILLING_PROVIDER: 'none',
  EPD_DATABASE_URL: 'postgresql://epd_admin:admin-password@db.example.ru:5432/epd_light',
  EPD_GATEWAY_DATABASE_URL: 'postgresql://epd_gateway:gateway-password@db.example.ru:5432/epd_light',
  EPD_BILLING_DATABASE_ROLE: 'epd_billing_writer',
}
const run = (overrides = {}) => spawnSync(process.execPath, ['scripts/check-billing-env.mjs'], {
  env: { ...base, ...overrides },
  encoding: 'utf8',
})

const disabled = run()
assert(disabled.status === 0, `disabled billing env should pass: ${disabled.stderr}`)
assert(disabled.stdout.includes('provider: none'), 'disabled provider output missing')
assert(disabled.stdout.includes('real money enabled: false'), 'real-money fail-closed output missing')

const unsupportedProvider = run({ EPD_BILLING_PROVIDER: 'somebank' })
assert(unsupportedProvider.status !== 0 && unsupportedProvider.stderr.includes('must remain none'), 'unimplemented payment provider must fail closed')

const reusedAdmin = run({ EPD_BILLING_DATABASE_URL: base.EPD_DATABASE_URL })
assert(reusedAdmin.status !== 0 && reusedAdmin.stderr.includes('admin credential'), 'billing writer must not reuse admin credential')

const reusedOperator = run({ EPD_BILLING_DATABASE_URL: base.EPD_GATEWAY_DATABASE_URL })
assert(reusedOperator.status !== 0 && reusedOperator.stderr.includes('operator credential'), 'billing writer must not reuse operator credential')

const invalidRole = run({ EPD_BILLING_DATABASE_ROLE: 'epd_billing_writer;drop role x' })
assert(invalidRole.status !== 0 && invalidRole.stderr.includes('safe PostgreSQL role name'), 'unsafe billing role must fail')

const wrongRole = run({ EPD_BILLING_DATABASE_ROLE: 'postgres' })
assert(wrongRole.status !== 0 && wrongRole.stderr.includes('must remain epd_billing_writer'), 'billing runtime must use restricted capability role')

const safeWriter = run({ EPD_BILLING_DATABASE_URL: 'postgresql://epd_billing:billing-password@db.example.ru:5432/epd_light' })
assert(safeWriter.status === 0, `separate billing writer should pass: ${safeWriter.stderr}`)
assert(safeWriter.stdout.includes('restricted writer: configured'), 'configured billing writer status missing')
assert(safeWriter.stdout.includes('payment provider remains disabled'), 'preconfigured writer must warn that provider is still disabled')

console.log('Billing env test OK: provider stays disabled and billing DB login remains isolated from admin/operator credentials')
