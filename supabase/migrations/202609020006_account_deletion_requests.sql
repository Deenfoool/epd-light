-- Account data lifecycle request foundation.
-- This does NOT delete an auth user or business records automatically.
-- Browser users may create/read only their own request; processing remains server-controlled.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','in_review','completed','rejected','canceled')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status in ('completed','rejected','canceled') and resolved_at is not null)
      or (status in ('pending','in_review') and resolved_at is null))
);

create unique index if not exists account_deletion_requests_one_active_idx
  on public.account_deletion_requests(user_id)
  where status in ('pending','in_review');

create index if not exists account_deletion_requests_user_created_idx
  on public.account_deletion_requests(user_id, requested_at desc);

revoke all on public.account_deletion_requests from anon, authenticated;
grant select, insert on public.account_deletion_requests to authenticated;

alter table public.account_deletion_requests enable row level security;

drop policy if exists account_deletion_requests_own_read on public.account_deletion_requests;
create policy account_deletion_requests_own_read
  on public.account_deletion_requests
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_deletion_requests_own_insert on public.account_deletion_requests;
create policy account_deletion_requests_own_insert
  on public.account_deletion_requests
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and resolved_at is null
  );

revoke update, delete on public.account_deletion_requests from authenticated;

drop trigger if exists account_deletion_requests_updated_at on public.account_deletion_requests;
create trigger account_deletion_requests_updated_at
before update on public.account_deletion_requests
for each row execute function public.set_updated_at();

comment on table public.account_deletion_requests is
'User-initiated deletion requests. No automatic deletion is performed; resolution is a separate server-controlled retention-aware process.';
