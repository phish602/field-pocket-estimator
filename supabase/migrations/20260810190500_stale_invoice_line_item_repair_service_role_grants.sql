-- The stale invoice-line-item repair API runs with the Supabase service-role
-- credential after independently proving the caller, active device, tenant,
-- and each candidate placeholder. The baseline intentionally restricts this
-- role, but omitted the minimum table privileges that the guarded repair must
-- use. Without these grants PostgREST returns 42501 before the proof can run,
-- and a real cloud/local mismatch can never converge.
--
-- Keep this deliberately narrow: these are only the rows the repair reads,
-- archives, deletes, and (only on failed post-delete verification) restores.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_line_items TO service_role;
GRANT SELECT ON TABLE public.invoices TO service_role;
GRANT SELECT ON TABLE public.invoice_payments TO service_role;
GRANT INSERT ON TABLE public.audit_events TO service_role;
