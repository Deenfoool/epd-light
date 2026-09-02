import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tasks = [
  'deploy:env:test',
  'build-info:test',
  'dependency:test',
  'readiness:test',
  'web-security:test',
  'privacy:test',
  'audit:test',
  'auth:test',
  'authorization:test',
  'repository:test',
  'attempt-repository:test',
  'attempt-client:test',
  'idempotency:test',
  'billing:test',
  'billing-payment:test',
  'billing-payment-client:test',
  'rate-limit:test',
  'gateway:test',
  'gateway:auth:test',
  'kontur:provider:test',
  'kontur:userdata:test',
  'kontur:generation:test',
  'kontur:sandbox:test',
]

for (const task of tasks) {
  console.log(`\n==> npm run ${task}`)
  const result = spawnSync(npm, ['run', task], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`\nAll ${tasks.length} test groups passed.`)
