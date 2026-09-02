import { checkRuntimeDependencies, safeDependencyFailure } from '../server/dependency-check.mjs'

try {
  const result = await checkRuntimeDependencies()
  console.log('Runtime dependency check OK')
  console.log(`- auth JWKS reachable: ${result.authJwksReachable}`)
  console.log(`- asymmetric signing key published: ${result.asymmetricSigningKeyPublished}`)
  console.log(`- data API reachable: ${result.dataApiReachable}`)
  console.log(`- billing foundation visible: ${result.billingFoundationVisible}`)
  console.log('- sensitive values included: false')
} catch (error) {
  const safe = safeDependencyFailure(error)
  console.error('Runtime dependency check FAILED')
  console.error(`- code: ${safe.code}`)
  if (safe.httpStatus) console.error(`- http status: ${safe.httpStatus}`)
  console.error('- response bodies, URLs and credentials are intentionally not printed')
  process.exit(1)
}
