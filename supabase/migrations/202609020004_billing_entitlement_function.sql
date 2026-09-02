-- Harden billing entitlement writes: the restricted billing role may no longer UPDATE
-- subscriptions or payment-event rows directly. Entitlement + verified->applied transition
-- happens only inside this SECURITY DEFINER function.

create or replace function public.apply_verified_billing_entitlement(
  p_event_id uuid,
  p_user_id uuid,
  p_plan_code text,
  p_current_period_start date,
  p_current_period_end date,
  p_provider_customer_id text default '',
  p_provider_subscription_id text default ''
)
returns table (
  event_id uuid,
  event_status text,
  subscription_user_id uuid,
  subscription_plan_code text,
  subscription_status text,
  subscription_period_start date,
  subscription_period_end date,
  payment_provider text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.billing_payment_events%rowtype;
  v_subscription public.subscriptions%rowtype;
begin
  if p_event_id is null or p_user_id is null then
    raise exception using errcode = 'P0001', message = 'billing_entitlement_identity_required';
  end if;
  if p_plan_code not in ('start','business','team') then
    raise exception using errcode = 'P0001', message = 'billing_entitlement_plan_invalid';
  end if;
  if p_current_period_start is null or p_current_period_end is null or p_current_period_end < p_current_period_start then
    raise exception using errcode = 'P0001', message = 'billing_entitlement_period_invalid';
  end if;

  select * into v_event
  from public.billing_payment_events
  where id = p_event_id and user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'billing_event_not_found';
  end if;
  if v_event.event_status = 'applied' then
    raise exception using errcode = 'P0001', message = 'billing_event_already_applied';
  end if;
  if v_event.event_status <> 'verified' then
    raise exception using errcode = 'P0001', message = 'billing_event_not_verified';
  end if;
  if v_event.plan_code is distinct from p_plan_code then
    raise exception using errcode = 'P0001', message = 'billing_event_plan_mismatch';
  end if;

  update public.subscriptions
  set plan_code = p_plan_code,
      status = 'active',
      trial_ends_at = null,
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      cancel_at_period_end = false,
      payment_provider = v_event.provider,
      provider_customer_id = nullif(p_provider_customer_id, ''),
      provider_subscription_id = nullif(p_provider_subscription_id, ''),
      updated_at = now()
  where user_id = p_user_id
  returning * into v_subscription;

  if not found then
    raise exception using errcode = 'P0001', message = 'billing_subscription_not_found';
  end if;

  update public.billing_payment_events
  set event_status = 'applied',
      processed_at = now(),
      safe_error_code = '',
      updated_at = now()
  where id = p_event_id and event_status = 'verified';

  if not found then
    raise exception using errcode = 'P0001', message = 'billing_event_apply_race';
  end if;

  return query select
    p_event_id,
    'applied'::text,
    v_subscription.user_id,
    v_subscription.plan_code,
    v_subscription.status,
    v_subscription.current_period_start,
    v_subscription.current_period_end,
    v_subscription.payment_provider;
end;
$$;

revoke all on function public.apply_verified_billing_entitlement(uuid, uuid, text, date, date, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_verified_billing_entitlement(uuid, uuid, text, date, date, text, text)
  to epd_billing_writer;

-- The billing runtime role must not bypass the verified-event function with direct writes.
revoke update on public.subscriptions from epd_billing_writer;
revoke update on public.billing_payment_events from epd_billing_writer;

drop policy if exists subscriptions_billing_writer_update on public.subscriptions;
drop policy if exists billing_payment_events_writer_update on public.billing_payment_events;

comment on function public.apply_verified_billing_entitlement(uuid, uuid, text, date, date, text, text)
is 'Only server-owned verified payment events may atomically activate a subscription; browser roles have no EXECUTE permission.';
