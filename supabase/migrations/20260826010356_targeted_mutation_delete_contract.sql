-- The targeted mutation writer performs exact-target deletes for legitimate
-- durable mutation work: a proven record delete removes its own children and
-- then its own row, and an invoice/estimate upsert removes only the stale
-- children still hanging under that exact target. The production baseline
-- granted authenticated DELETE for estimate_line_items and invoice_line_items
-- only, so every other targeted delete is refused by PostgREST (42501) before
-- any application proof can run. The mutation then fails, retries, and fails
-- again -- a permanent Sync issue that no amount of client work can settle.
--
-- These grants close that source/schema mismatch and nothing else: no TRUNCATE,
-- no GRANT ALL, no anonymous privilege, no service_role change, no RLS change
-- beyond the five DELETE policies below, and no foreign-key or cascade edit.
GRANT DELETE ON TABLE public.customers TO authenticated;
GRANT DELETE ON TABLE public.projects TO authenticated;
GRANT DELETE ON TABLE public.estimates TO authenticated;
GRANT DELETE ON TABLE public.invoices TO authenticated;
GRANT DELETE ON TABLE public.invoice_payments TO authenticated;

-- Row-level authority stays exactly where each table already put it. Customer,
-- project, and estimate rows are operational records whose hard-delete
-- eligibility is already constrained by the application's business-history
-- guards, so they keep operational write authority -- the same helper their
-- INSERT/UPDATE policies use, and the same one estimate_line_items already uses
-- for DELETE. Invoices and payments are money records, so their destructive
-- authority stays on the owner/admin boundary that invoice_line_items DELETE
-- and invoice_payments UPDATE already established.
DROP POLICY IF EXISTS "customers_delete_operational" ON public.customers;
CREATE POLICY "customers_delete_operational" ON public.customers FOR DELETE TO authenticated USING (public.can_write_company_records(company_id));

DROP POLICY IF EXISTS "projects_delete_operational" ON public.projects;
CREATE POLICY "projects_delete_operational" ON public.projects FOR DELETE TO authenticated USING (public.can_write_company_records(company_id));

DROP POLICY IF EXISTS "estimates_delete_operational" ON public.estimates;
CREATE POLICY "estimates_delete_operational" ON public.estimates FOR DELETE TO authenticated USING (public.can_write_company_records(company_id));

DROP POLICY IF EXISTS "invoices_delete_owner_admin" ON public.invoices;
CREATE POLICY "invoices_delete_owner_admin" ON public.invoices FOR DELETE TO authenticated USING (public.can_manage_company(company_id));

DROP POLICY IF EXISTS "invoice_payments_delete_owner_admin" ON public.invoice_payments;
CREATE POLICY "invoice_payments_delete_owner_admin" ON public.invoice_payments FOR DELETE TO authenticated USING (public.can_manage_company(company_id));
