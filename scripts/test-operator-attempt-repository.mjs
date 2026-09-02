import {
  createOperatorAttemptRepository,
  operatorAttemptRepositoryConfigFromEnv,
  operatorAttemptRepositoryStatus,
} from '../server/repositories/operator-attempts.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const empty = operatorAttemptRepositoryConfigFromEnv({})
const emptyStatus = operatorAttemptRepositoryStatus(empty)
assert(emptyStatus.adapterAvailable === true, 'journal repository adapter must be available')
assert(emptyStatus.configured === false, 'journal repository must remain optional without connection string')
assert(JSON.stringify(emptyStatus).includes('connectionString') === false, 'public status must never expose connection string')

const validConfig = operatorAttemptRepositoryConfigFromEnv({
  EPD_GATEWAY_DATABASE_URL: 'postgresql://epd_gateway:super-secret@db.example.ru:5432/epd_light',
  EPD_GATEWAY_DATABASE_ROLE: 'epd_gateway_writer',
  EPD_OPERATOR_ATTEMPT_STALE_MS: '300000',
})
const validStatus = operatorAttemptRepositoryStatus(validConfig)
assert(validStatus.configured === true, `valid restricted journal config should pass: ${validStatus.errors.join(', ')}`)
assert(validStatus.role === 'epd_gateway_writer', 'writer role status mismatch')
assert(validStatus.storesDocumentPayload === false && validStatus.storesXml === false && validStatus.storesTokens === false, 'journal status must declare metadata-only storage')
assert(JSON.stringify(validStatus).includes('super-secret') === false, 'journal status leaked database password')
assert(createOperatorAttemptRepository(validConfig).status.configured === true, 'repository factory must preserve validated status')

const badProtocol = operatorAttemptRepositoryStatus({
  connectionString: 'https://db.example.ru/epd_light', writerRole: 'epd_gateway_writer', staleAfterMs: 300000,
})
assert(badProtocol.configured === false && badProtocol.errors.some((x) => x.includes('PostgreSQL')), 'non-PostgreSQL journal URL must fail')

const badRole = operatorAttemptRepositoryStatus({
  connectionString: 'postgresql://epd_gateway:secret@db.example.ru:5432/epd_light', writerRole: 'writer;drop role x', staleAfterMs: 300000,
})
assert(badRole.configured === false && badRole.errors.some((x) => x.includes('ROLE') || x.includes('role')), 'unsafe writer role must fail')

console.log('Operator attempt repository test OK: optional config, restricted role validation and secret-free capabilities verified')
