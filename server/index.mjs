import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { auditErrorCode, writeGatewayAudit } from './audit.mjs'
import { GATEWAY_AUTH_POLICY, assertGatewayAuthConfig, authenticateGatewayRequest, gatewayAuthConfigFromEnv } from './auth.mjs'
import { EXTERNAL_OPERATOR_AUTHORIZATION_POLICY } from './authorization.mjs'
import { billingConfigFromEnv, billingConfigStatus, billingPublicCapabilities } from './billing.mjs'
import { authenticatedRateKey, consumeRateLimit, rateLimitConfigFromEnv, rateLimitHeaders, requestNetworkKey } from './rate-limit.mjs'
import { konturConfigFromEnv, konturConfigStatus, konturPublicCapabilities } from './providers/kontur.mjs'
import { KONTUR_USERDATA_PREVIEW_CONTRACT, buildKonturT1UserDataXml, validateKonturT1Candidate } from './providers/kontur-userdata.mjs'
import {
  supabaseDocumentRepositoryConfigFromEnv,
  supabaseDocumentRepositoryPublicCapabilities,
  supabaseDocumentRepositoryStatus,
} from './repositories/supabase-documents.mjs'
import {
  createOperatorAttemptRepository,
  operatorAttemptRepositoryConfigFromEnv,
  operatorAttemptRepositoryStatus,
} from './repositories/operator-attempts.mjs'
import {
  KONTUR_SANDBOX_GENERATION_POLICY,
  generateKonturSandboxTitleForDocument,
  validateSandboxGenerateRequest,
} from './services/kontur-sandbox.mjs'

const port = Number(process.env.PORT || 8787)
const provider = process.env.EPD_OPERATOR_PROVIDER || 'none'
const operatorMode = process.env.EPD_OPERATOR_MODE || 'disabled'
const maxBodyBytes = Number(process.env.EPD_MAX_BODY_BYTES || 512 * 1024)
if (!['disabled', 'sandbox'].includes(operatorMode)) throw new Error(`Unsupported EPD_OPERATOR_MODE: ${operatorMode}`)
if (operatorMode === 'sandbox' && provider !== 'kontur') throw new Error('Sandbox operator mode currently requires EPD_OPERATOR_PROVIDER=kontur')
const authConfig = assertGatewayAuthConfig(gatewayAuthConfigFromEnv(), operatorMode)
const billingConfig = billingConfigFromEnv()
const billingStatus = billingConfigStatus(billingConfig)
if (billingStatus.errors.length) throw new Error(`Unsupported EPD_BILLING_PROVIDER: ${billingConfig.provider}`)
const rateConfig = rateLimitConfigFromEnv()
const repositoryConfig = supabaseDocumentRepositoryConfigFromEnv()
const repositoryStatus = supabaseDocumentRepositoryStatus(repositoryConfig)
const attemptRepositoryConfig = operatorAttemptRepositoryConfigFromEnv()
const attemptRepositoryStatus = operatorAttemptRepositoryStatus(attemptRepositoryConfig)
const attemptRepository = createOperatorAttemptRepository(attemptRepositoryConfig)
const konturConfig = konturConfigFromEnv()
const konturStatus = konturConfigStatus(konturConfig)
const allowedOrigins = new Set(
  String(process.env.EPD_ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
)

const sandboxGenerateReady = () => operatorMode === 'sandbox'
  && provider === 'kontur'
  && authConfig.mode === 'supabase'
  && repositoryStatus.configured
  && konturStatus.configured

function responseHeaders(requestId, origin, extra = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-request-id': requestId,
    ...extra,
  }
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-expose-headers'] = 'x-request-id,ratelimit-limit,ratelimit-remaining,ratelimit-reset,retry-after'
    headers['vary'] = 'Origin'
  }
  return headers
}

function sendJson(res, status, payload, requestId, origin, extraHeaders = {}) {
  res.writeHead(status, responseHeaders(requestId, origin, extraHeaders))
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function preflightCandidate(input) {
  const errors = []
  const warnings = []
  if (!input || typeof input !== 'object') errors.push('payload должен быть JSON-объектом')
  if (input?.kind !== 'epd-light/operator-candidate-v1') errors.push('неподдерживаемый kind интеграционного черновика')
  if (!input?.document?.number) errors.push('не указан номер внутреннего черновика')
  if (!input?.document?.date) errors.push('не указана дата внутреннего черновика')
  for (const role of ['shipper', 'consignee', 'carrier']) {
    const p = input?.participants?.[role]
    if (!p?.name) errors.push(`${role}: не указано наименование`)
    if (!p?.inn) errors.push(`${role}: не указан ИНН`)
  }
  if (!Array.isArray(input?.cargo) || input.cargo.length === 0) errors.push('не указан груз')
  if (!input?.vehicle?.registrationNumber) errors.push('не указан госномер ТС')
  if (!input?.driver?.fullName) errors.push('не указан водитель')
  if (!input?.readiness?.candidate) warnings.push('frontend operator-readiness содержит незаполненные поля')
  warnings.push('server preflight не является XSD-валидацией ФНС')
  warnings.push('provider adapter не подключён к внешней отправке и внешние API здесь не вызываются')
  return { ok: errors.length === 0, errors, warnings }
}

function providerCapabilities() {
  if (provider === 'kontur') return konturPublicCapabilities()
  return {
    provider,
    adapterAvailable: false,
    credentialsConfigured: false,
    generateTitleWiredToGateway: false,
    sendWiredToGateway: false,
  }
}

function sandboxError(error) {
  const code = String(error?.code || '')
  const known = new Map([
    ['document_id_required', 400],
    ['document_not_available', 404],
    ['document_identity_mismatch', 409],
    ['kontur_candidate_invalid', 422],
    ['document_repository_unconfigured', 503],
    ['document_repository_token_required', 503],
    ['kontur_config_incomplete', 503],
    ['sandbox_auth_required', 403],
    ['sandbox_already_generated', 409],
    ['sandbox_generation_in_progress', 409],
    ['operator_attempt_identity_conflict', 409],
    ['operator_attempt_journal_update_failed', 503],
  ])
  return {
    status: known.get(code) || Number(error?.statusCode || 502),
    code: known.has(code) ? code : 'sandbox_generation_failed',
  }
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID()
  const startedAt = Date.now()
  const origin = req.headers.origin || ''
  const url = new URL(req.url || '/', 'http://gateway.local')

  const audit = (httpStatus, errorCode = null) => writeGatewayAudit({
    requestId,
    method: req.method || '',
    path: url.pathname,
    provider,
    httpStatus,
    durationMs: Date.now() - startedAt,
    errorCode,
  })
  const respond = (status, payload, errorCode, extraHeaders = {}) => {
    sendJson(res, status, payload, requestId, origin, extraHeaders)
    audit(status, errorCode ?? auditErrorCode(payload, status))
  }

  if (req.method === 'OPTIONS') {
    if (origin && allowedOrigins.has(origin)) {
      res.writeHead(204, {
        ...responseHeaders(requestId, origin),
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-max-age': '600',
      })
      res.end()
      audit(204)
    } else {
      respond(403, { error: 'origin_not_allowed', requestId })
    }
    return
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    respond(200, { ok: true, service: 'epd-light-operator-gateway', requestId })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/billing/capabilities') {
    respond(200, {
      service: 'epd-light-billing-boundary',
      ...billingPublicCapabilities(billingConfig),
      message: 'Payment provider is fail-closed. Checkout/webhook and real money remain disabled until a verified provider adapter is implemented.',
      requestId,
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/operator/capabilities') {
    respond(200, {
      service: 'epd-light-operator-gateway',
      provider,
      mode: operatorMode,
      externalSendEnabled: false,
      xsdValidationEnabled: false,
      auth: {
        mode: authConfig.mode,
        requiredForOperatorApi: authConfig.mode === 'supabase',
        policy: GATEWAY_AUTH_POLICY,
      },
      authorization: {
        ...EXTERNAL_OPERATOR_AUTHORIZATION_POLICY,
        repository: supabaseDocumentRepositoryPublicCapabilities(repositoryConfig),
      },
      rateLimit: {
        windowMs: rateConfig.windowMs,
        maxPerAuthenticatedSubject: rateConfig.max,
        preAuthMaxPerNetwork: rateConfig.authMax,
        maxExternalCallsPerAuthenticatedSubject: rateConfig.externalMax,
      },
      sandboxGenerateTitle: {
        ...KONTUR_SANDBOX_GENERATION_POLICY,
        enabled: operatorMode === 'sandbox' && provider === 'kontur',
        ready: sandboxGenerateReady(),
        repositoryConfigured: repositoryStatus.configured,
        operatorCredentialsConfigured: konturStatus.configured,
        persistentAttemptJournal: attemptRepositoryStatus,
      },
      supportedCandidate: 'epd-light/operator-candidate-v1',
      localKonturUserDataPreview: KONTUR_USERDATA_PREVIEW_CONTRACT,
      providerAdapter: providerCapabilities(),
      message: 'Gateway умеет локально собирать preview UserDataXml. Sandbox GenerateTitleXml принимает только documentId, перечитывает документ через RLS и не выполняет подписание/PostMessage.',
      requestId,
    })
    return
  }

  const operatorApiRequest = url.pathname.startsWith('/api/operator/')
  const publicOperatorRequest = req.method === 'GET' && url.pathname === '/api/operator/capabilities'
  let operatorRateHeaders = {}
  let operatorAuth = null

  if (operatorApiRequest && !publicOperatorRequest) {
    const preAuthLimit = consumeRateLimit({
      key: requestNetworkKey(req),
      scope: 'operator-preauth',
      max: rateConfig.authMax,
      windowMs: rateConfig.windowMs,
    })
    if (!preAuthLimit.allowed) {
      respond(429, { error: 'rate_limited', message: 'Too many operator API requests', requestId }, 'rate_limited', rateLimitHeaders(preAuthLimit))
      return
    }

    const auth = await authenticateGatewayRequest(req, authConfig)
    if (!auth.ok) {
      respond(auth.status, { error: auth.error, message: auth.message, requestId }, auth.error, rateLimitHeaders(preAuthLimit))
      return
    }
    operatorAuth = auth

    const actionLimit = consumeRateLimit({
      key: authenticatedRateKey(auth, req),
      scope: 'operator-api',
      max: rateConfig.max,
      windowMs: rateConfig.windowMs,
    })
    operatorRateHeaders = rateLimitHeaders(actionLimit)
    if (!actionLimit.allowed) {
      respond(429, { error: 'rate_limited', message: 'Operator API rate limit exceeded', requestId }, 'rate_limited', operatorRateHeaders)
      return
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/operator/preflight') {
    try {
      const body = await readJson(req)
      const result = preflightCandidate(body)
      respond(result.ok ? 200 : 422, { ...result, requestId }, result.ok ? null : 'candidate_invalid', operatorRateHeaders)
    } catch (error) {
      const status = Number(error?.statusCode || 500)
      respond(status, { error: error instanceof Error ? error.message : 'request failed', requestId }, status === 400 ? 'invalid_json' : status === 413 ? 'body_too_large' : 'request_failed', operatorRateHeaders)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/operator/kontur/userdata-preview') {
    try {
      const body = await readJson(req)
      const validation = validateKonturT1Candidate(body)
      if (!validation.ok) {
        respond(422, { ...validation, contract: KONTUR_USERDATA_PREVIEW_CONTRACT, requestId }, 'kontur_candidate_invalid', operatorRateHeaders)
        return
      }
      const xml = buildKonturT1UserDataXml(body)
      respond(200, {
        ok: true,
        errors: [],
        warnings: validation.warnings,
        xml,
        contract: KONTUR_USERDATA_PREVIEW_CONTRACT,
        externalCallMade: false,
        requestId,
      }, null, operatorRateHeaders)
    } catch (error) {
      const status = Number(error?.statusCode || 500)
      const validation = error?.validation
      respond(validation ? 422 : status, validation ? { ...validation, contract: KONTUR_USERDATA_PREVIEW_CONTRACT, requestId } : { error: error instanceof Error ? error.message : 'request failed', requestId }, validation ? 'kontur_candidate_invalid' : status === 400 ? 'invalid_json' : status === 413 ? 'body_too_large' : 'request_failed', operatorRateHeaders)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === KONTUR_SANDBOX_GENERATION_POLICY.gatewayRoute) {
    if (operatorMode !== 'sandbox' || provider !== 'kontur') {
      respond(404, { error: 'not_found', requestId }, 'not_found', operatorRateHeaders)
      return
    }
    if (!sandboxGenerateReady()) {
      respond(503, {
        error: 'sandbox_not_ready',
        message: 'Sandbox GenerateTitleXml requires Supabase auth/RLS repository and Kontur sandbox credentials',
        requestId,
      }, 'sandbox_not_ready', operatorRateHeaders)
      return
    }

    const externalLimit = consumeRateLimit({
      key: authenticatedRateKey(operatorAuth, req),
      scope: 'operator-external',
      max: rateConfig.externalMax,
      windowMs: rateConfig.windowMs,
    })
    const externalHeaders = rateLimitHeaders(externalLimit)
    if (!externalLimit.allowed) {
      respond(429, { error: 'rate_limited', message: 'External operator call rate limit exceeded', requestId }, 'rate_limited', externalHeaders)
      return
    }

    try {
      const body = await readJson(req)
      const requestValidation = validateSandboxGenerateRequest(body)
      if (!requestValidation.ok) {
        respond(requestValidation.status, {
          error: requestValidation.error,
          message: requestValidation.message,
          requestId,
        }, requestValidation.error, externalHeaders)
        return
      }

      const result = await generateKonturSandboxTitleForDocument({
        auth: operatorAuth,
        documentId: requestValidation.documentId,
        repositoryConfig,
        konturConfig,
        attemptRepository,
      })
      respond(200, {
        ok: true,
        documentId: requestValidation.documentId,
        provider: result.provider,
        contract: result.contract,
        generatedXml: result.generatedXml,
        externalCallMade: Boolean(result.externalCallMade),
        externalResultShared: Boolean(result.externalResultShared),
        persistence: result.persistence,
        idempotency: result.idempotency,
        signed: false,
        sent: false,
        message: result.externalResultShared
          ? 'Параллельный sandbox GenerateTitleXml уже выполнялся для этой revision; возвращён тот же результат. XML не подписан и не отправлен через PostMessage.'
          : 'Sandbox GenerateTitleXml выполнен. XML не подписан и не отправлен через PostMessage.',
        requestId,
      }, null, externalHeaders)
    } catch (error) {
      const mapped = sandboxError(error)
      respond(mapped.status, {
        error: mapped.code,
        message: mapped.code === 'sandbox_already_generated'
          ? 'Для этой revision уже есть успешная persistent sandbox-попытка; повторный внешний GenerateTitleXml заблокирован.'
          : mapped.code === 'sandbox_generation_in_progress'
            ? 'Для этой revision уже выполняется persistent sandbox-попытка.'
            : 'Sandbox GenerateTitleXml failed before any signing or PostMessage step',
        requestId,
      }, mapped.code, externalHeaders)
    }
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/operator/send') {
    respond(503, {
      error: 'operator_send_disabled',
      provider,
      mode: operatorMode,
      message: 'Юридически значимая отправка заблокирована: PostMessage не подключён к gateway, а подписание и production operator flow не настроены.',
      requestId,
    }, null, operatorRateHeaders)
    return
  }

  respond(404, { error: 'not_found', requestId }, null, operatorRateHeaders)
})

server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000

server.listen(port, '0.0.0.0', () => {
  console.log(`EPD Light gateway listening on :${port}; operator=${provider}/${operatorMode}; billing=${billingConfig.provider}; auth=${authConfig.mode}; externalSendEnabled=false; realMoneyEnabled=false`)
})
