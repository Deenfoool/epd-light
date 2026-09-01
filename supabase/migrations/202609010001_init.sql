create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default '',
  inn text not null default '',
  kpp text not null default '',
  org_type text not null default 'org' check (org_type in ('org','ip')),
  phone text not null default '',
  email text not null default '',
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  inn text not null default '',
  kpp text not null default '',
  roles text[] not null default '{}',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand text not null default '',
  model text not null default '',
  plate text not null default '',
  vehicle_type text not null default '',
  trailer_plate text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null default '',
  license text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_number text not null default '',
  doc_date date,
  status text not null default 'draft' check (status in ('draft','incomplete','ready','archived')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text not null,
  inn text not null default '',
  operator text not null default '',
  contact text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists companies_user_idx on public.companies(user_id);
create index if not exists vehicles_user_idx on public.vehicles(user_id);
create index if not exists drivers_user_idx on public.drivers(user_id);
create index if not exists documents_user_idx on public.documents(user_id);
create index if not exists documents_updated_idx on public.documents(user_id, updated_at desc);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.drivers to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.integration_requests to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.documents enable row level security;
alter table public.integration_requests enable row level security;

drop policy if exists "profiles_own" on public.profiles;
drop policy if exists "companies_own" on public.companies;
drop policy if exists "vehicles_own" on public.vehicles;
drop policy if exists "drivers_own" on public.drivers;
drop policy if exists "documents_own" on public.documents;
drop policy if exists "integration_requests_own" on public.integration_requests;

create policy "profiles_own" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "companies_own" on public.companies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vehicles_own" on public.vehicles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "drivers_own" on public.drivers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents_own" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "integration_requests_own" on public.integration_requests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
drop trigger if exists vehicles_updated_at on public.vehicles;
create trigger vehicles_updated_at before update on public.vehicles for each row execute function public.set_updated_at();
drop trigger if exists drivers_updated_at on public.drivers;
create trigger drivers_updated_at before update on public.drivers for each row execute function public.set_updated_at();
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();
