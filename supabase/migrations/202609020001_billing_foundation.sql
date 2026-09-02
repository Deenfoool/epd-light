-- Billing foundation. No payment provider is connected by this migration.
-- Entitlement enforcement is created fail-safe but remains disabled until explicitly enabled server-side.

create table if not exists public.billing_plans (
  code text primary key check (code ~ '^[a-z0-9_-]{2,32}$'),
  name text not null,
  monthly_price_rub integer not null default 0 check (monthly_price_rub >= 0),
  document_limit integer check (document_limit is null or document_limit > 0),
  active boolean not null default true,
  features jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plans(code, name, monthly_price_rub, document_limit, active, features, sort_order)
values
  ('trial', 'Пробный', 0, 50, true, '{"trialDays":14,"teamAccess":false,"operatorSend":false}'::jsonb, 0),
  ('start', 'Старт', 990, 50, true, '{"teamAccess":false,"operatorSend":false}'::jsonb, 10),
  ('business', 'Бизнес', 2490, 500, true, '{"teamAccess":false,"operatorSend":false}'::jsonb, 20),
  ('team', 'Команда', 4990, 2000, true, '{"teamAccess":false,"operatorSend":false,"teamAccessRoadmap":true}'::jsonb, 30)
on conflict (code) do update set
  name = excluded.name,
  monthly_price_rub = excluded.monthly_price_rub,
  document_limit = excluded.document_limit,
  active = excluded.active,
  features = excluded.features,
  sort_order = excluded.sort_order;

create table if not exists public.billing_settings (
  id text primary key default 'default' check (id = 'default'),
  enforcement_enabled boolean not null default false,
  trial_days integer not null default 14 check (trial_days between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.billing_settings(id, enforcement_enabled, trial_days)
values ('default', false, 14)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null references public.billing_plans(code),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled','expired')),
  trial_ends_at timestamptz,
  current_period_start date not null default current_date,
  current_period_end date not null default (current_date + 30),
  cancel_at_period_end boolean not null default false,
  payment_provider text not null default 'none',
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end >= current_period_start)
);

create unique index if not exists subscriptions_provider_subscription_uidx
  on public.subscriptions(payment_provider, provider_subscription_id)
  where provider_subscription_id is not null and provider_subscription_id <> '';

create table if not exists public.billing_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  documents_created integer not null default 0 check (documents_created >= 0),
  sandbox_generations integer not null default 0 check (sandbox_generations >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start),
  check (period_start = date_trunc('month', period_start)::date)
);

create index if not exists billing_usage_user_period_idx
  on public.billing_usage_monthly(user_id, period_start desc);

-- Existing accounts receive a fresh 14-day MVP trial when this billing foundation is installed.
-- Enforcement remains disabled, so this does not remove existing access.
insert into public.subscriptions(user_id, plan_code, status, trial_ends_at, current_period_start, current_period_end)
select id, 'trial', 'trialing', now() + interval '14 days', current_date, current_date + 14
from auth.users
on conflict (user_id) do nothing;

create or replace function public.init_epd_light_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trial_days_value integer := 14;
begin
  select trial_days into trial_days_value from public.billing_settings where id = 'default';
  trial_days_value := coalesce(trial_days_value, 14);
  insert into public.subscriptions(user_id, plan_code, status, trial_ends_at, current_period_start, current_period_end)
  values (
    new.id,
    'trial',
    'trialing',
    coalesce(new.created_at, now()) + make_interval(days => trial_days_value),
    coalesce(new.created_at, now())::date,
    (coalesce(new.created_at, now()) + make_interval(days => trial_days_value))::date
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.init_epd_light_subscription() from public, anon, authenticated;

drop trigger if exists epd_light_billing_user_created on auth.users;
create trigger epd_light_billing_user_created
after insert on auth.users
for each row execute function public.init_epd_light_subscription();

-- Counts document creation at the database boundary. Because this is AFTER INSERT,
-- normal UPSERT updates of an existing document do not consume the quota again.
create or replace function public.consume_epd_light_document_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enforcement boolean := false;
  plan_limit integer;
  sub_status text;
  sub_trial_ends timestamptz;
  sub_period_end date;
  usage_period date := date_trunc('month', now())::date;
  resulting_usage integer;
  configured_trial_days integer := 14;
begin
  -- A browser session must never consume quota for another user.
  if auth.uid() is not null and new.user_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'billing_user_mismatch';
  end if;

  select enforcement_enabled, trial_days
    into enforcement, configured_trial_days
  from public.billing_settings
  where id = 'default';
  enforcement := coalesce(enforcement, false);
  configured_trial_days := coalesce(configured_trial_days, 14);

  insert into public.subscriptions(user_id, plan_code, status, trial_ends_at, current_period_start, current_period_end)
  values (new.user_id, 'trial', 'trialing', now() + make_interval(days => configured_trial_days), current_date, current_date + configured_trial_days)
  on conflict (user_id) do nothing;

  select s.status, s.trial_ends_at, s.current_period_end, p.document_limit
    into sub_status, sub_trial_ends, sub_period_end, plan_limit
  from public.subscriptions s
  join public.billing_plans p on p.code = s.plan_code and p.active = true
  where s.user_id = new.user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'billing_subscription_missing';
  end if;

  if enforcement then
    if sub_status = 'trialing' then
      if sub_trial_ends is null or sub_trial_ends <= now() then
        raise exception using errcode = 'P0001', message = 'billing_trial_expired';
      end if;
    elsif sub_status = 'active' then
      if sub_period_end < current_date then
        raise exception using errcode = 'P0001', message = 'billing_period_expired';
      end if;
    else
      raise exception using errcode = 'P0001', message = 'billing_subscription_inactive';
    end if;
  end if;

  if plan_limit is null or not enforcement then
    insert into public.billing_usage_monthly(user_id, period_start, documents_created)
    values (new.user_id, usage_period, 1)
    on conflict (user_id, period_start) do update
      set documents_created = public.billing_usage_monthly.documents_created + 1,
          updated_at = now()
    returning documents_created into resulting_usage;
  else
    insert into public.billing_usage_monthly(user_id, period_start, documents_created)
    values (new.user_id, usage_period, 1)
    on conflict (user_id, period_start) do update
      set documents_created = public.billing_usage_monthly.documents_created + 1,
          updated_at = now()
      where public.billing_usage_monthly.documents_created < plan_limit
    returning documents_created into resulting_usage;

    if resulting_usage is null then
      raise exception using errcode = 'P0001', message = 'billing_document_limit_reached';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.consume_epd_light_document_quota() from public, anon, authenticated;

drop trigger if exists documents_billing_usage on public.documents;
create trigger documents_billing_usage
after insert on public.documents
for each row execute function public.consume_epd_light_document_quota();

-- Browser access is intentionally read-only. Payment/webhook code will own writes later.
revoke all on public.billing_plans from anon, authenticated;
revoke all on public.billing_settings from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.billing_usage_monthly from anon, authenticated;

grant select on public.billing_plans to anon, authenticated;
grant select on public.billing_settings to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.billing_usage_monthly to authenticated;

alter table public.billing_plans enable row level security;
alter table public.billing_settings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_usage_monthly enable row level security;

drop policy if exists billing_plans_read_active on public.billing_plans;
create policy billing_plans_read_active on public.billing_plans
for select using (active = true);

drop policy if exists billing_settings_authenticated_read on public.billing_settings;
create policy billing_settings_authenticated_read on public.billing_settings
for select to authenticated using (true);

drop policy if exists subscriptions_own_read on public.subscriptions;
create policy subscriptions_own_read on public.subscriptions
for select to authenticated using (auth.uid() = user_id);

drop policy if exists billing_usage_own_read on public.billing_usage_monthly;
create policy billing_usage_own_read on public.billing_usage_monthly
for select to authenticated using (auth.uid() = user_id);

drop trigger if exists billing_plans_updated_at on public.billing_plans;
create trigger billing_plans_updated_at before update on public.billing_plans
for each row execute function public.set_updated_at();
drop trigger if exists billing_settings_updated_at on public.billing_settings;
create trigger billing_settings_updated_at before update on public.billing_settings
for each row execute function public.set_updated_at();
drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

comment on table public.billing_plans is 'Public tariff catalogue; no payment provider is implied by a row here.';
comment on table public.subscriptions is 'Server-owned subscription entitlement. Browser roles have SELECT only.';
comment on table public.billing_usage_monthly is 'Server/database-owned usage counters; deleting a document does not refund quota.';
comment on table public.billing_settings is 'Billing rollout switch. enforcement_enabled remains false until payments/operations are ready.';
