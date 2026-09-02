const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
let pgModulePromise
const pools = new Map()

const getPg = () => {
  pgModulePromise ??= import('pg')
  return pgModulePromise
}

export function operatorAttemptRepositoryConfigFromEnv(env = process.env) {
  return {
    connectionString: String(env.EPD_GATEWAY_DATABASE_URL || '').trim(),
    writerRole: String(env.EPD_GATEWAY_DATABASE_ROLE || 'epd_gateway_writer').trim(),
    staleAfterMs: Math.max(60_000, Number(env.EPD_OPERATOR_ATTEMPT_STALE_MS || 5 * 60_000)),
  }
}

export function operatorAttemptRepositoryStatus(config = operatorAttemptRepositoryConfigFromEnv()) {
  const errors = []
  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString)
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('EPD_GATEWAY_DATABASE_URL must be PostgreSQL')
    } catch {
      errors.push('EPD_GATEWAY_DATABASE_URL must be a valid PostgreSQL URL')
    }
  }
  if (!ROLE_RE.test(config.writerRole)) errors.push('EPD_GATEWAY_DATABASE_ROLE is invalid')
  return {
    adapterAvailable: true,
    configured: Boolean(config.connectionString) && errors.length === 0,
    role: config.writerRole,
    errors,
    storesDocumentPayload: false,
    storesXml: false,
    storesTokens: false,
  }
}

async function poolFor(config) {
  const key = config.connectionString
  if (pools.has(key)) return pools.get(key)
  const { Pool } = await getPg()
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  pools.set(key, pool)
  return pool
}

async function withWriterTransaction(config, fn) {
  const status = operatorAttemptRepositoryStatus(config)
  if (!status.configured) {
    const error = new Error('Operator attempt repository is not configured')
    error.code = 'operator_attempt_repository_unconfigured'
    throw error
  }
  const pool = await poolFor(config)
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${config.writerRole}`)
    await client.query("set local statement_timeout = '5000ms'")
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    try { await client.query('rollback') } catch {}
    throw error
  } finally {
    client.release()
  }
}

const rowShape = (row) => row ? ({
  id: String(row.id),
  userId: String(row.user_id),
  documentId: String(row.document_id),
  provider: String(row.provider),
  operation: String(row.operation),
  mode: String(row.mode),
  documentRevision: new Date(row.document_revision).toISOString(),
  idempotencyKey: String(row.idempotency_key),
  requestFingerprint: String(row.request_fingerprint),
  status: String(row.status),
  safeErrorCode: String(row.safe_error_code || ''),
  externalMessageId: String(row.external_message_id || ''),
  externalEntityId: String(row.external_entity_id || ''),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
}) : null

export function createOperatorAttemptRepository(config = operatorAttemptRepositoryConfigFromEnv()) {
  const status = operatorAttemptRepositoryStatus(config)

  return {
    status,

    async claim({ userId, documentId, identity }) {
      return withWriterTransaction(config, async (client) => {
        const inserted = await client.query(`
          insert into public.operator_attempts(
            user_id, document_id, provider, operation, mode, document_revision,
            idempotency_key, request_fingerprint, status, safe_error_code
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,'started','')
          on conflict (provider, operation, mode, idempotency_key) do nothing
          returning *
        `, [
          userId,
          documentId,
          identity.provider,
          identity.operation,
          identity.mode,
          identity.sourceRevision,
          identity.idempotencyKey,
          identity.requestFingerprint,
        ])
        if (inserted.rowCount === 1) return { state: 'claimed', attempt: rowShape(inserted.rows[0]) }

        const existingResult = await client.query(`
          select * from public.operator_attempts
          where provider=$1 and operation=$2 and mode=$3 and idempotency_key=$4
          limit 1
        `, [identity.provider, identity.operation, identity.mode, identity.idempotencyKey])
        const existing = rowShape(existingResult.rows[0])
        if (!existing) {
          const error = new Error('Operator attempt conflict row was not found')
          error.code = 'operator_attempt_conflict_missing'
          throw error
        }
        if (existing.userId !== String(userId) || existing.documentId !== String(documentId) || existing.requestFingerprint !== identity.requestFingerprint) {
          const error = new Error('Operator attempt identity conflict')
          error.code = 'operator_attempt_identity_conflict'
          throw error
        }
        if (existing.status === 'succeeded') return { state: 'already_succeeded', attempt: existing }

        const staleCutoff = new Date(Date.now() - config.staleAfterMs).toISOString()
        const retry = await client.query(`
          update public.operator_attempts
          set status='started', safe_error_code='', external_message_id='', external_entity_id='', updated_at=now()
          where id=$1
            and (status in ('failed','blocked') or (status='started' and updated_at <= $2::timestamptz))
          returning *
        `, [existing.id, staleCutoff])
        if (retry.rowCount === 1) return { state: 'claimed_retry', attempt: rowShape(retry.rows[0]) }
        return { state: 'in_progress', attempt: existing }
      })
    },

    async succeed(attemptId, { externalMessageId = '', externalEntityId = '' } = {}) {
      return withWriterTransaction(config, async (client) => {
        const result = await client.query(`
          update public.operator_attempts
          set status='succeeded', safe_error_code='', external_message_id=$2, external_entity_id=$3, updated_at=now()
          where id=$1
          returning *
        `, [attemptId, String(externalMessageId || ''), String(externalEntityId || '')])
        if (result.rowCount !== 1) throw Object.assign(new Error('Operator attempt not found'), { code: 'operator_attempt_not_found' })
        return rowShape(result.rows[0])
      })
    },

    async fail(attemptId, safeErrorCode = 'operator_call_failed') {
      const safeCode = /^[a-z0-9_]{1,64}$/.test(String(safeErrorCode)) ? String(safeErrorCode) : 'operator_call_failed'
      return withWriterTransaction(config, async (client) => {
        const result = await client.query(`
          update public.operator_attempts
          set status='failed', safe_error_code=$2, updated_at=now()
          where id=$1
          returning *
        `, [attemptId, safeCode])
        if (result.rowCount !== 1) throw Object.assign(new Error('Operator attempt not found'), { code: 'operator_attempt_not_found' })
        return rowShape(result.rows[0])
      })
    },
  }
}

export async function closeOperatorAttemptPoolsForTests() {
  const current = [...pools.values()]
  pools.clear()
  await Promise.all(current.map((pool) => pool.end()))
}
