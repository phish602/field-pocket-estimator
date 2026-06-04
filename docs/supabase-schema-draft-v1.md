# Supabase Schema Draft V1

This is a review artifact only.

- Not a migration.
- Not deployed.
- Not wired into runtime.
- No backend writes are being added.

## 1. Draft Table List

Recommended tables for V1 review:

- `companies`
- `company_users`
- `customers`
- `projects`
- `estimates`
- `estimate_line_items`
- `invoices`
- `invoice_line_items`
- `invoice_payments`
- `scope_templates`
- `app_settings`
- `audit_events`
- `migration_batches`
- `migration_write_results`

## 2. Table Draft Notes

### companies

- Purpose: Company ownership boundary and company profile storage.
- Primary key: `id`
- Ownership fields: `id`, `created_by`, `updated_by`
- Important columns: company name, contact details, branding, billing/admin fields
- Relationship fields: none at the row level beyond ownership
- Migration trace fields: `legacy_local_id`, `migration_batch_id`, `migrated_at`
- Lifecycle/status fields: optional active/archived state if needed later

### company_users

- Purpose: Company membership and access control.
- Primary key: `id`
- Ownership fields: `company_id`, `user_id`
- Important columns: `role`, `status`, `invited_at`, `joined_at`, `created_at`, `updated_at`
- Relationship fields: `company_id → companies.id`, `user_id → users.id`
- Migration trace fields: `migration_batch_id`, `legacy_local_id` if needed
- Lifecycle/status fields: membership status

### customers

- Purpose: Company-scoped customer records.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`
- Important columns: display/company/contact fields, phone, email, address, billing address, customer type, status, terms
- Relationship fields: `company_id → companies.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`, `migrated_at`
- Lifecycle/status fields: optional active/inactive/archive state

### projects

- Purpose: Company-scoped work records tied to customers.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`, `archived_by`, `deleted_by`
- Important columns: project number, project name, site address, notes, scope summary, status
- Relationship fields: `company_id → companies.id`, `customer_id → customers.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`, `migrated_at`
- Lifecycle/status fields: draft, estimating, active, completed, archived

### estimates

- Purpose: Estimate documents for jobs and proposals.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`, `archived_by`, `deleted_by`
- Important columns: estimate number, status, totals, customer/project display fields, source metadata
- Relationship fields: `company_id → companies.id`, `project_id → projects.id`, `customer_id → customers.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`, `migrated_at`, `converted_invoice_id` or similar
- Lifecycle/status fields: draft, pending, sent, approved, lost

### estimate_line_items

- Purpose: Normalized estimate detail rows.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`
- Important columns: description, quantity, unit price, unit cost, total, sort order
- Relationship fields: `estimate_id → estimates.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: none beyond parent estimate lifecycle

### invoices

- Purpose: Invoice documents and financial lifecycle records.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`, `archived_by`, `deleted_by`
- Important columns: invoice number, estimate number, status, payment status, total, amount paid, balance remaining, due date, invoice date
- Relationship fields: `company_id → companies.id`, `project_id → projects.id`, `customer_id → customers.id`, `source_estimate_id → estimates.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`, `migrated_at`
- Lifecycle/status fields: draft, sent, partial, paid, overdue, void

### invoice_line_items

- Purpose: Normalized invoice detail rows.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`
- Important columns: description, quantity, unit price, unit cost, total, sort order
- Relationship fields: `invoice_id → invoices.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: none beyond parent invoice lifecycle

### invoice_payments

- Purpose: Payment ledger entries for invoices.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`
- Important columns: amount, method, status, paid_at, created_at
- Relationship fields: `invoice_id → invoices.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: payment status

### scope_templates

- Purpose: Reusable scope text templates.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`, `updated_by`
- Important columns: name, scope text, timestamps
- Relationship fields: `company_id → companies.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: optional archive state if needed later

### app_settings

- Purpose: Company or user-scoped configuration storage.
- Primary key: `id`
- Ownership fields: `company_id`, `user_id` if user-scoped settings are needed
- Important columns: settings payload, setting scope, timestamps
- Relationship fields: `company_id → companies.id` when company-scoped
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: none required for V1 draft

### audit_events

- Purpose: Append-only operational history and support traceability.
- Primary key: `id`
- Ownership fields: `company_id`, `actor_user_id`
- Important columns: event type, target type, target id, related ids, source, reason, hashes, metadata, created_at
- Relationship fields: `company_id → companies.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id` if useful
- Lifecycle/status fields: immutable append-only record

### migration_batches

- Purpose: Track each migration run or write attempt.
- Primary key: `id`
- Ownership fields: `company_id`, `created_by`
- Important columns: started_at, completed_at, status, counts, notes
- Relationship fields: `company_id → companies.id`
- Migration trace fields: batch metadata itself is the trace
- Lifecycle/status fields: queued, running, completed, blocked, failed, rolled_back

### migration_write_results

- Purpose: Record per-entity write results for a batch.
- Primary key: `id`
- Ownership fields: `company_id`, `migration_batch_id`
- Important columns: entity type, entity id, legacy local id, result status, failure reason, retry eligibility
- Relationship fields: `company_id → companies.id`, `migration_batch_id → migration_batches.id`
- Migration trace fields: `legacy_local_id`, `migration_batch_id`
- Lifecycle/status fields: success, failed, skipped

## 3. Relationship Notes

- Company owns company-scoped data.
- `company_users` controls membership.
- Customers, projects, and documents must link safely.
- Line items belong to documents.
- Payments belong to invoices.
- Audit events are append-only.

## 4. Safety Notes

- Preserve `legacy_local_id`.
- Preserve `migration_batch_id`.
- No silent overwrite.
- No orphaned payments.
- No orphaned line items.
- Document numbers are company-scoped.
- Estimates and invoices use separate number spaces.

## 5. Open Schema Decisions

The following items still need final decisions:

- UUID strategy
- Exact status enums
- Archive vs soft-delete field names
- RLS policy naming
- Storage strategy for photos and attachments
- Whether `app_settings` are company-wide, user-specific, or both
- Whether `scope_templates` are company-wide, user-specific, or both

## 6. Non-Goals

Do not build any of the following yet:

- SQL migration
- RLS policies
- Supabase client code
- Runtime sync
- Backend credentials
- UI implementation

This draft is intended for review only and should be used to align the eventual Supabase schema with the existing backend planning docs.

