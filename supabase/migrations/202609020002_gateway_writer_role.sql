-- Restricted capability role for server-owned operator journal writes.
-- This role has NOLOGIN: deployment must create/choose a separate LOGIN role and grant
-- membership in epd_gateway_writer without committing its password/connection string.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'epd_gateway_writer') then
    create role epd_gateway_writer nologin noinherit;
  end if;
end
$$;

-- Membership is explicit. A runtime LOGIN should SET ROLE epd_gateway_writer on connect.
grant usage on schema public to epd_gateway_writer;
grant select, insert, update on public.operator_attempts to epd_gateway_writer;
revoke delete on public.operator_attempts from epd_gateway_writer;

-- RLS remains enabled. Only this capability role receives server-write policies.
drop policy if exists operator_attempts_gateway_select on public.operator_attempts;
create policy operator_attempts_gateway_select
  on public.operator_attempts
  for select
  to epd_gateway_writer
  using (true);

drop policy if exists operator_attempts_gateway_insert on public.operator_attempts;
create policy operator_attempts_gateway_insert
  on public.operator_attempts
  for insert
  to epd_gateway_writer
  with check (true);

drop policy if exists operator_attempts_gateway_update on public.operator_attempts;
create policy operator_attempts_gateway_update
  on public.operator_attempts
  for update
  to epd_gateway_writer
  using (true)
  with check (true);

comment on role epd_gateway_writer is 'NOLOGIN capability role for EPD Light gateway operator_attempts journal only';
