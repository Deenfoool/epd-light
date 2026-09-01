create table if not exists public.operator_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  provider text not null check (provider in ('kontur')),
  operation text not null check (operation in ('generate_title','post_message')),
  mode text not null check (mode in ('sandbox','production')),
  document_revision timestamptz not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'started' check (status in ('started','succeeded','failed','blocked')),
  safe_error_code text not null default '',
  external_message_id text not null default '',
  external_entity_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_attempts_idempotency_key_sha256 check (idempotency_key ~ '^[0-9a-f]{64}$'),
  constraint operator_attempts_request_fingerprint_sha256 check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint operator_attempts_unique_action unique (provider, operation, mode, idempotency_key)
);

create index if not exists operator_attempts_user_document_idx
  on public.operator_attempts(user_id, document_id, created_at desc);
create index if not exists operator_attempts_status_idx
  on public.operator_attempts(status, created_at desc);

alter table public.operator_attempts enable row level security;

drop policy if exists "operator_attempts_read_own" on public.operator_attempts;
create policy "operator_attempts_read_own"
  on public.operator_attempts
  for select
  using (auth.uid() = user_id);

-- Users may inspect their own safe metadata, but browser/user JWT must not be able
-- to forge operator outcomes. Insert/update/delete are intentionally not granted.
grant select on public.operator_attempts to authenticated;
revoke insert, update, delete on public.operator_attempts from authenticated;

-- Keep updated_at correct for future server-owned writes.
drop trigger if exists operator_attempts_updated_at on public.operator_attempts;
create trigger operator_attempts_updated_at
  before update on public.operator_attempts
  for each row execute function public.set_updated_at();
