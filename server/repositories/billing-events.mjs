const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
const PROVIDER_RE = /^[a-z0-9_-]{2,32}$/
const EVENT_TYPE_RE = /^[a-z0-9_.:-]{1,80}$/
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/
const SHA256_RE = /^[0-9a-f]{64}$/
const PLAN_CODES = new Set(['start', 'business', 'team'])
let pgModulePromise
const pools = new Map()

const getPg = () => {
  pgModulePromise ??= import('pg')
  return pgModulePromise
}

export function billingEventRepositoryConfigFromEnv(env = process.env) {
  return {
    connectionString: String(env.EPD_BILLING_DATABASE_URL || '').trim(),
    writerRole: String(env.EPD_BILLING_DATABASE_ROLE || 'epd_billing_writer').trim(),
  }
}

export function billingEventRepositoryStatus(config = billingEventRepositoryConfigFromEnv()) {
  const errors = []
  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString)
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) errors.push('EPD_BILLING_DATABASE_URL must be PostgreSQL')
    } catch {
      errors.push('EPD_BILLING_DATABASE_URL must be a valid PostgreSQL URL')
    }
  }
  if (!ROLE_RE.test(config.writerRole)) errors.push('EPD_BILLING_DATABASE_ROLE is invalid')
  return {
    adapterAvailable: true,
    configured: Boolean(config.connectionString) && errors.length === 0,
    role: config.writerRole,
    errors,
    rawWebhookPayloadStored: false,
    cardDataStored: false,
    secretsStored: false,
    verifiedEventRequiredForEntitlement: true,
    directSubscriptionUpdateAllowed: false,
    entitlementDatabaseFunctionRequired: true,
  }
}

async function poolFor(config) {
  const key = config.connectionString
  if (pools.has(key)) return pools.get(key)
  const { Pool } = await getPg()
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  })
  pools.set(key, pool)
  return pool
}

async function withBillingTransaction(config, fn) {
  const status = billingEventRepositoryStatus(config)
  if (!status.configured) throw Object.assign(new Error('Billing event repository is not configured'), { code: 'billing_repository_unconfigured' })
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

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

export function validateVerifiedBillingEvent(event) {
  const errors = []
  if (!validUuid(event?.userId)) errors.push('userId')
  if (!PROVIDER_RE.test(String(event?.provider || ''))) errors.push('provider')
  if (!SAFE_ID_RE.test(String(event?.providerEventId || ''))) errors.push('providerEventId')
  if (!EVENT_TYPE_RE.test(String(event?.eventType || ''))) errors.push('eventType')
  if (!PLAN_CODES.has(String(event?.planCode || ''))) errors.push('planCode')
  if (!SHA256_RE.test(String(event?.payloadSha256 || ''))) errors.push('payloadSha256')
  const amount = event?.amountKopecks
  if (amount != null && (!Number.isSafeInteger(Number(amount)) || Number(amount) < 0)) errors.push('amountKopecks')
  if (!/^[A-Z]{3}$/.test(String(event?.currency || 'RUB'))) errors.push('currency')
  return { ok: errors.length === 0, errors }
}

function eventShape(row) {
  return row ? {
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider),
    providerEventId: String(row.provider_event_id),
    eventType: String(row.event_type),
    eventStatus: String(row.event_status),
    planCode: String(row.plan_code || ''),
    amountKopecks: row.amount_kopecks == null ? null : Number(row.amount_kopecks),
    currency: String(row.currency || 'RUB'),
    payloadSha256: String(row.payload_sha256),
    safeErrorCode: String(row.safe_error_code || ''),
    createdAt: new Date(row.created_at).toISOString(),
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
  } : null
}

export function createBillingEventRepository(config = billingEventRepositoryConfigFromEnv()) {
  return {
    status: billingEventRepositoryStatus(config),

    async claimVerifiedEvent(event) {
      const validation = validateVerifiedBillingEvent(event)
      if (!validation.ok) throw Object.assign(new Error('Verified billing event is invalid'), { code: 'billing_event_invalid', fields: validation.errors })

      return withBillingTransaction(config, async (client) => {
        const result = await client.query(`
          insert into public.billing_payment_events(
            user_id, provider, provider_event_id, event_type, event_status,
            plan_code, amount_kopecks, currency, payload_sha256, safe_error_code
          ) values ($1,$2,$3,$4,'verified',$5,$6,$7,$8,'')
          on conflict (provider, provider_event_id) do nothing
          returning *
        `, [
          event.userId,
          event.provider,
          event.providerEventId,
          event.eventType,
          event.planCode,
          event.amountKopecks == null ? null : Number(event.amountKopecks),
          event.currency || 'RUB',
          event.payloadSha256,
        ])
        if (result.rowCount === 1) return { state: 'claimed', event: eventShape(result.rows[0]) }

        const existing = await client.query(`
          select * from public.billing_payment_events
          where provider=$1 and provider_event_id=$2
          limit 1
        `, [event.provider, event.providerEventId])
        const row = eventShape(existing.rows[0])
        if (!row) throw Object.assign(new Error('Billing event conflict row missing'), { code: 'billing_event_conflict_missing' })
        if (row.userId !== event.userId || row.planCode !== event.planCode || row.payloadSha256 !== event.payloadSha256) {
          throw Object.assign(new Error('Billing event identity conflict'), { code: 'billing_event_identity_conflict' })
        }
        return { state: row.eventStatus === 'applied' ? 'already_applied' : 'already_claimed', event: row }
      })
    },

    async applyVerifiedEntitlement(eventId, entitlement) {
      if (!validUuid(eventId) || !validUuid(entitlement?.userId) || !PLAN_CODES.has(String(entitlement?.planCode || ''))) {
        throw Object.assign(new Error('Billing entitlement input is invalid'), { code: 'billing_entitlement_invalid' })
      }
      const periodStart = String(entitlement.currentPeriodStart || '')
      const periodEnd = String(entitlement.currentPeriodEnd || '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodEnd < periodStart) {
        throw Object.assign(new Error('Billing period is invalid'), { code: 'billing_period_invalid' })
      }

      return withBillingTransaction(config, async (client) => {
        const existingResult = await client.query(`
          select * from public.billing_payment_events
          where id=$1 and user_id=$2
          limit 1
        `, [eventId, entitlement.userId])
        const existing = eventShape(existingResult.rows[0])
        if (!existing) throw Object.assign(new Error('Billing event not found'), { code: 'billing_event_not_found' })
        if (existing.eventStatus === 'applied') return { state: 'already_applied', event: existing }
        if (existing.eventStatus !== 'verified') throw Object.assign(new Error('Billing event is not verified'), { code: 'billing_event_not_verified' })
        if (existing.planCode !== entitlement.planCode) throw Object.assign(new Error('Billing event plan mismatch'), { code: 'billing_event_plan_mismatch' })

        const appliedResult = await client.query(`
          select *
          from public.apply_verified_billing_entitlement(
            $1::uuid, $2::uuid, $3::text, $4::date, $5::date, $6::text, $7::text
          )
        `, [
          eventId,
          entitlement.userId,
          entitlement.planCode,
          periodStart,
          periodEnd,
          String(entitlement.providerCustomerId || ''),
          String(entitlement.providerSubscriptionId || ''),
        ])
        if (appliedResult.rowCount !== 1) throw Object.assign(new Error('Billing entitlement function returned no row'), { code: 'billing_entitlement_apply_failed' })

        const eventResult = await client.query('select * from public.billing_payment_events where id=$1 limit 1', [eventId])
        const appliedEvent = eventShape(eventResult.rows[0])
        if (!appliedEvent || appliedEvent.eventStatus !== 'applied') throw Object.assign(new Error('Billing event was not marked applied'), { code: 'billing_event_apply_failed' })

        const row = appliedResult.rows[0]
        return {
          state: 'applied',
          event: appliedEvent,
          subscription: {
            user_id: row.subscription_user_id,
            plan_code: row.subscription_plan_code,
            status: row.subscription_status,
            current_period_start: row.subscription_period_start,
            current_period_end: row.subscription_period_end,
            payment_provider: row.payment_provider,
          },
        }
      })
    },
  }
}

export async function closeBillingEventPoolsForTests() {
  const current = [...pools.values()]
  pools.clear()
  await Promise.all(current.map((pool) => pool.end()))
}
