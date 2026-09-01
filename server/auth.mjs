const AUTH_MODES = new Set(['disabled', 'supabase'])
const ALLOWED_ALGORITHMS = ['RS256', 'ES256']
const remoteJwks = new Map()
let joseModulePromise

const getJose = () => {
  joseModulePromise ??= import('jose')
  return joseModulePromise
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('EPD_AUTH_SUPABASE_URL must use https outside localhost')
  }
  return url.toString().replace(/\/$/, '')
}

export function gatewayAuthConfigFromEnv(env = process.env) {
  const mode = String(env.EPD_GATEWAY_AUTH_MODE || 'disabled').trim().toLowerCase()
  const supabaseUrl = normalizeBaseUrl(env.EPD_AUTH_SUPABASE_URL || '')
  return {
    mode,
    supabaseUrl,
    issuer: supabaseUrl ? `${supabaseUrl}/auth/v1` : '',
    jwksUrl: supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : '',
    audience: String(env.EPD_AUTH_AUDIENCE || 'authenticated').trim() || 'authenticated',
    clientId: String(env.EPD_AUTH_CLIENT_ID || '').trim(),
    algorithms: ALLOWED_ALGORITHMS,
  }
}

export function assertGatewayAuthConfig(config, operatorMode = 'disabled') {
  if (!AUTH_MODES.has(config?.mode)) {
    throw new Error(`Unsupported EPD_GATEWAY_AUTH_MODE: ${config?.mode || '<empty>'}`)
  }
  if (config.mode === 'supabase' && !config.supabaseUrl) {
    throw new Error('EPD_AUTH_SUPABASE_URL is required when EPD_GATEWAY_AUTH_MODE=supabase')
  }
  if (String(operatorMode || 'disabled') !== 'disabled' && config.mode !== 'supabase') {
    throw new Error('Non-disabled operator mode requires EPD_GATEWAY_AUTH_MODE=supabase')
  }
  return config
}

export function extractBearerToken(req) {
  const header = String(req?.headers?.authorization || '').trim()
  const match = /^Bearer\s+([^\s]+)$/i.exec(header)
  return match?.[1] || ''
}

async function defaultVerifyToken(token, config) {
  const { createRemoteJWKSet, jwtVerify } = await getJose()
  let jwks = remoteJwks.get(config.jwksUrl)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    })
    remoteJwks.set(config.jwksUrl, jwks)
  }
  return jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: config.algorithms,
    clockTolerance: 5,
  })
}

export async function authenticateGatewayRequest(req, config, { verifyToken = defaultVerifyToken } = {}) {
  if (config.mode === 'disabled') {
    return { ok: true, mode: 'disabled', subject: '', role: 'local-demo', claims: null }
  }

  const token = extractBearerToken(req)
  if (!token) {
    return { ok: false, status: 401, error: 'auth_required', message: 'Bearer access token is required' }
  }

  try {
    const { payload } = await verifyToken(token, config)
    const subject = String(payload?.sub || '').trim()
    const role = String(payload?.role || '').trim()
    if (!subject) return { ok: false, status: 401, error: 'auth_invalid', message: 'JWT subject is missing' }
    if (role !== 'authenticated') return { ok: false, status: 403, error: 'auth_forbidden', message: 'JWT role is not authenticated' }
    if (config.clientId && String(payload?.client_id || '') !== config.clientId) {
      return { ok: false, status: 403, error: 'auth_wrong_client', message: 'JWT client_id is not allowed' }
    }
    return {
      ok: true,
      mode: 'supabase',
      subject,
      role,
      claims: {
        sub: subject,
        role,
        exp: Number(payload?.exp || 0),
      },
    }
  } catch {
    return { ok: false, status: 401, error: 'auth_invalid', message: 'Access token verification failed' }
  }
}

export const GATEWAY_AUTH_POLICY = Object.freeze({
  provider: 'supabase',
  jwksPath: '/auth/v1/.well-known/jwks.json',
  audience: 'authenticated',
  acceptedAlgorithms: ALLOWED_ALGORITHMS,
  sharedJwtSecretAccepted: false,
  tokensLogged: false,
})
