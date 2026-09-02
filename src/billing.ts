import { cloudEnabled, supabase } from './data'
import type { BillingPlan, BillingState, BillingSubscription, BillingUsage } from './types'

const demoPlans: BillingPlan[] = [
  { code: 'trial', name: 'Пробный', monthly_price_rub: 0, document_limit: 50, active: true, features: { trialDays: 14 }, sort_order: 0 },
  { code: 'start', name: 'Старт', monthly_price_rub: 990, document_limit: 50, active: true, features: {}, sort_order: 10 },
  { code: 'business', name: 'Бизнес', monthly_price_rub: 2490, document_limit: 500, active: true, features: {}, sort_order: 20 },
  { code: 'team', name: 'Команда', monthly_price_rub: 4990, document_limit: 2000, active: true, features: { teamAccessRoadmap: true }, sort_order: 30 },
]

const demoState = (): BillingState => ({
  mode: 'demo',
  enforcementEnabled: false,
  trialDays: 14,
  plans: demoPlans,
  subscription: null,
  currentPlan: demoPlans[0],
  usage: null,
})

export function currentBillingPeriodStart(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`
}

export async function getBillingState(): Promise<BillingState> {
  if (!cloudEnabled || !supabase) return demoState()
  const periodStart = currentBillingPeriodStart()

  const [settingsResult, plansResult, subscriptionResult, usageResult] = await Promise.all([
    supabase.from('billing_settings').select('enforcement_enabled,trial_days').eq('id', 'default').maybeSingle(),
    supabase.from('billing_plans').select('code,name,monthly_price_rub,document_limit,active,features,sort_order').order('sort_order'),
    supabase.from('subscriptions').select('user_id,plan_code,status,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,payment_provider,created_at,updated_at').maybeSingle(),
    supabase.from('billing_usage_monthly').select('user_id,period_start,documents_created,sandbox_generations,updated_at').eq('period_start', periodStart).maybeSingle(),
  ])

  const firstError = settingsResult.error || plansResult.error || subscriptionResult.error || usageResult.error
  if (firstError) throw firstError

  const plans = (plansResult.data ?? []) as BillingPlan[]
  const subscription = (subscriptionResult.data ?? null) as BillingSubscription | null
  const usage = (usageResult.data ?? null) as BillingUsage | null
  const settings = settingsResult.data
  const currentPlan = subscription ? plans.find((plan) => plan.code === subscription.plan_code) ?? null : null

  return {
    mode: 'cloud',
    enforcementEnabled: Boolean(settings?.enforcement_enabled),
    trialDays: Number(settings?.trial_days || 14),
    plans,
    subscription,
    currentPlan,
    usage,
  }
}

export function billingStatusLabel(state: BillingState): string {
  if (state.mode === 'demo') return 'Демо — без биллинга'
  if (!state.subscription) return 'Подписка не создана'
  if (state.subscription.status === 'trialing') return 'Пробный период'
  if (state.subscription.status === 'active') return 'Активна'
  if (state.subscription.status === 'past_due') return 'Ожидает оплаты'
  if (state.subscription.status === 'canceled') return 'Отменена'
  return 'Истекла'
}

export function billingRemainingDocuments(state: BillingState): number | null {
  const limit = state.currentPlan?.document_limit
  if (limit == null) return null
  return Math.max(0, limit - Number(state.usage?.documents_created || 0))
}

export function billingErrorMessage(error: unknown): string {
  const raw = String((error as any)?.message || (error as any)?.details || error || '')
  if (raw.includes('billing_document_limit_reached')) return 'Месячный лимит новых черновиков исчерпан. Откройте «Тариф и лимиты».'
  if (raw.includes('billing_trial_expired')) return 'Пробный период закончился. Для создания новых черновиков потребуется активный тариф.'
  if (raw.includes('billing_period_expired')) return 'Оплаченный период закончился. Обновите подписку перед созданием нового черновика.'
  if (raw.includes('billing_subscription_inactive')) return 'Подписка не активна. Откройте «Тариф и лимиты».'
  if (raw.includes('billing_subscription_missing')) return 'Не удалось определить тариф аккаунта. Обратитесь в поддержку.'
  if (raw.includes('billing_user_mismatch')) return 'База отклонила создание документа из-за несоответствия владельца.'
  return raw || 'Не удалось выполнить операцию'
}
