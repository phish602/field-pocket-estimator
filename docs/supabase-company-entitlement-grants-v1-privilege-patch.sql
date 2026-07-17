-- EstiPaid Gate 17A-R — company_entitlement_grants privilege patch
--
-- WHY THIS EXISTS
-- The v1 migration ran `grant select, insert, update ... to service_role` but
-- never revoked anything from service_role. Supabase ships a default privilege
-- rule (ALTER DEFAULT PRIVILEGES IN SCHEMA public ... TO service_role), so a
-- newly created table already carries broader privileges and the additive grant
-- was redundant. Direct catalog verification found service_role holding:
--
--     INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- DELETE was correctly absent, but TRUNCATE defeats the whole point of the
-- design: grant history is meant to be immutable ("revoked, never deleted"),
-- and TRUNCATE erases every row at once. REFERENCES and TRIGGER are unnecessary
-- ambient authority on an authorization table.
--
-- This patch removes exactly the three excess privileges and nothing else.
-- It does not touch data, structure, RLS, policies, or any other table.
--
-- Applies to: public.company_entitlement_grants only.
-- Safe to re-run: REVOKE of an absent privilege is a no-op.

begin;

-- Leave SELECT (resolver), INSERT (grant) and UPDATE (revoke) intact.
revoke truncate, references, trigger
  on table public.company_entitlement_grants
  from service_role;

commit;

-- Verify with docs/supabase-company-entitlement-grants-v1-verification.sql
-- Expected afterwards:
--   row 12  service_role has SELECT, INSERT, UPDATE          -> PASS
--   row 13  service_role lacks DELETE/TRUNCATE/REFERENCES/TRIGGER -> PASS
