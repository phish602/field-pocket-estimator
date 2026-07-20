-- EstiPaid Security R2.3B — applied-event ledger cleanup.
-- DESTRUCTIVE DATA RETENTION WORK: separate review and explicit execution
-- authorization are required. This file is not scheduled and never deletes an
-- ordering row or tombstone. It deletes only ledger rows for tombstoned
-- subscriptions whose tombstone has remained unchanged for at least 35 days.

begin;

with deleted as (
  delete from public.stripe_subscription_webhook_events e
   using public.stripe_subscription_webhook_ordering o
   where o.company_id = e.company_id
     and o.stripe_subscription_id = e.stripe_subscription_id
     and o.is_deleted = true
     and o.updated_at < now() - interval '35 days'
  returning 1
)
select count(*) as deleted_event_rows from deleted;

commit;
