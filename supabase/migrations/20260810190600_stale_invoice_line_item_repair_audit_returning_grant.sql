-- The guarded repair requests the inserted audit IDs with `insert(...).select`.
-- PostgREST requires SELECT for that explicit returning representation, even
-- though the repair only writes its own audit rows. Keep the grant constrained
-- to the repair audit table rather than broadening the service role globally.
GRANT SELECT ON TABLE public.audit_events TO service_role;
