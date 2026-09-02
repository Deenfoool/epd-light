-- Provider-neutral payment event ledger.
-- No payment provider is enabled by this migration and no raw webhook payload is stored.

create table if not exists public.billing_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_-]{2,32}$'),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (event_type ~ '^[a-z0-9_.:-]{1,80}$'),
  event_status text not null default 'received' check (event_status in ('received','verified','applied','ignored','failed')),
  plan_code text references public.billing_plans(code),
  amount_kopecks bigint check (amount_kopecks is null or amount_kopecks >= 0),
  currency text not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  safe_error_code text not null default '' check (safe_error_code ~ '^[a-z0-9_]{0,64}$'),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint billing_payment_events_provider_event_unique unique (provider, provider_event_id)
);

create index if not exists billing_payment_events_user_created_idx
  on public.billing_payment_events(user_id, created_at desc);
create index if not exists billing_payment_events_status_idx
  on public.billing_payment_events(event_status, created_at desc);

alter table public.billing_payment_events enable row level security;

-- Users may inspect safe metadata for their own billing history, but cannot forge payments.
revoke all on public.billing_payment_events from anon, authenticated;
grant select on public.billing_payment_events to authenticated;

drop policy if exists billing_payment_events_own_read on public.billing_payment_events;
create policy billing_payment_events_own_read
  on public.billing_payment_events
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Dedicated capability role for a future verified-webhook backend.
-- Deployment creates a separate LOGIN and grants membership in this NOLOGIN role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'epd_billing_writer') then
    create role epd_billing_writer nologin noinherit;
  end if;
end
$$;

grant usage on schema public to epd_billing_writer;
grant select on public.billing_plans to epd_billing_writer;
grant select on public.billing_settings to epd_billing_writer;
grant select, update on public.subscriptions to epd_billing_writer;
grant select, insert, update on public.billing_payment_events to epd_billing_writer;
revoke delete on public.billing_payment_events from epd_billing_writer;
revoke insert, delete on public.subscriptions from epd_billing_writer;

-- RLS policies for the server-only capability role.
drop policy if exists billing_plans_writer_read on public.billing_plans;
create policy billing_plans_writer_read
  on public.billing_plans
  for select
  to epd_billing_writer
  using (true);

drop policy if exists billing_settings_writer_read on public.billing_settings;
create policy billing_settings_writer_read
  on public.billing_settings
  for select
  to epd_billing_writer
  using (true);

drop policy if exists subscriptions_billing_writer_read on public.subscriptions;
create policy subscriptions_billing_writer_read
  on public.subscriptions
  for select
  to epd_billing_writer
  using (true);

drop policy if exists subscriptions_billing_writer_update on public.subscriptions;
create policy subscriptions_billing_writer_update
  on public.subscriptions
  for update
  to epd_billing_writer
  using (true)
  with check (true);

drop policy if exists billing_payment_events_writer_read on public.billing_payment_events;
create policy billing_payment_events_writer_read
  on public.billing_payment_events
  for select
  to epd_billing_writer
  using (true);

drop policy if exists billing_payment_events_writer_insert on public.billing_payment_events;
create policy billing_payment_events_writer_insert
  on public.billing_payment_events
  for insert
  to epd_billing_writer
  with check (true);

drop policy if exists billing_payment_events_writer_update on public.billing_payment_events;
create policy billing_payment_events_writer_update
  on public.billing_payment_events
  for update
  to epd_billing_writer
  using (true)
  with check (true);

drop trigger if exists billing_payment_events_updated_at on public.billing_payment_events;
create trigger billing_payment_events_updated_at
  before update on public.billing_payment_events
  for each row execute function public.set_updated_at();

comment on table public.billing_payment_events is 'Metadata-only payment event ledger. Raw provider webhook payloads, card data and secrets are never stored here.';
comment on role epd_billing_writer is 'NOLOGIN capability role for verified billing webhook processing only; browser roles never receive it';
