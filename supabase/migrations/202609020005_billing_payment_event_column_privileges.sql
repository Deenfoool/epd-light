-- Restrict authenticated users to the exact safe payment-event columns used by the UI.
-- RLS still limits rows to auth.uid() = user_id; column privileges additionally prevent
-- direct Data API reads of provider_event_id, payload_sha256 and internal ids.

revoke all on public.billing_payment_events from authenticated;

grant select (
  provider,
  event_type,
  event_status,
  plan_code,
  amount_kopecks,
  currency,
  safe_error_code,
  created_at,
  processed_at
) on public.billing_payment_events to authenticated;

-- Keep row ownership policy explicit after privilege narrowing.
drop policy if exists billing_payment_events_own_read on public.billing_payment_events;
create policy billing_payment_events_own_read
  on public.billing_payment_events
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.billing_payment_events is
'Metadata-only payment event ledger. Authenticated browser users have column-level SELECT only for safe history fields; provider_event_id, payload_sha256, user_id and internal id stay server-only.';
