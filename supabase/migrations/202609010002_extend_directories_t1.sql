-- Reusable directory fields required by the draft-v3 / Kontur T1 preparation flow.
-- Safe for existing installations: all new columns have non-null defaults.

alter table public.companies
  add column if not exists org_type text not null default 'org',
  add column if not exists edo_id text not null default '',
  add column if not exists address_zip_code text not null default '',
  add column if not exists address_region text not null default '',
  add column if not exists address_city text not null default '',
  add column if not exists address_settlement text not null default '',
  add column if not exists address_street text not null default '',
  add column if not exists address_building text not null default '',
  add column if not exists address_corpus text not null default '',
  add column if not exists address_apartment text not null default '';

-- Existing databases may already have the column before this check constraint is added.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companies_org_type_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_org_type_check check (org_type in ('org','ip'));
  end if;
end;
$$;

alter table public.vehicles
  add column if not exists ownership_type text not null default '',
  add column if not exists load_capacity text not null default '',
  add column if not exists volume_capacity text not null default '';

alter table public.drivers
  add column if not exists license_series text not null default '',
  add column if not exists license_number text not null default '',
  add column if not exists license_date date;

comment on column public.companies.edo_id is 'Operator participant id / Diadoc BoxId; never infer from INN';
comment on column public.vehicles.ownership_type is 'Operator/UserData Ownership code; validate against active provider schema before legal exchange';
comment on column public.drivers.license_date is 'Driver license issue date';
