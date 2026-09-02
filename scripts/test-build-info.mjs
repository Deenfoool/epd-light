import { buildInfoFromEnv, buildPublicInfo } from '../server/build-info.mjs'

const assert = (condition, message) => { if (!condition) throw new Error(message) }

const valid = buildPublicInfo(buildInfoFromEnv({
  EPD_RELEASE: '0.1.0',
  EPD_BUILD_COMMIT: 'ABCDEF1234567890abcdef1234567890abcdef12',
  EPD_BUILD_TIME: '2026-09-02T08:15:30Z',
  EPD_DATABASE_URL: 'postgresql://secret:password@db/epd',
  EPD_KONTUR_ACCESS_TOKEN: 'secret-token',
}))
assert(valid.release === '0.1.0', 'release should be preserved')
assert(valid.commit === 'abcdef1234567890abcdef1234567890abcdef12', 'commit should be normalized to lowercase')
assert(valid.shortCommit === 'abcdef123456', 'short commit should use first 12 chars')
assert(valid.buildTime === '2026-09-02T08:15:30.000Z', 'build time should normalize to ISO')
assert(valid.traceableBuild === true, 'valid commit/time should be traceable')
assert(valid.sensitiveValuesIncluded === false, 'public build info must declare secret-free output')

const serialized = JSON.stringify(valid)
for (const forbidden of ['secret-token', 'postgresql://', 'password', 'EPD_DATABASE_URL', 'EPD_KONTUR_ACCESS_TOKEN']) {
  assert(!serialized.includes(forbidden), `public build info leaked sensitive value/name: ${forbidden}`)
}

const invalid = buildPublicInfo(buildInfoFromEnv({
  EPD_RELEASE: 'bad release with spaces',
  EPD_BUILD_COMMIT: 'not-a-commit',
  EPD_BUILD_TIME: 'yesterday-ish',
}))
assert(invalid.release === 'unknown', 'invalid release should fail closed')
assert(invalid.commit === 'unknown' && invalid.shortCommit === 'unknown', 'invalid commit should fail closed')
assert(invalid.buildTime === 'unknown', 'invalid build time should fail closed')
assert(invalid.traceableBuild === false, 'invalid metadata must not be traceable')

console.log('Build info test OK: runtime release/commit/time are normalized, traceable and secret-free')
