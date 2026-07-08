# EstiPaid Backend Data Contract

This document defines the canonical future backend data model for EstiPaid. It is a planning and contract document only. It does not imply that Supabase, auth, multi-user storage, API routes, or migrations are implemented yet.

The current app still uses localStorage-backed records and read models. Those local shapes are useful for migration mapping, but they are not the final database schema.

## 1. Purpose

- Establish the future company-scoped backend contract before any database, auth, or sync work begins.
- Prevent drift between localStorage blobs and the eventual backend schema.
- Preserve existing estimator, project, invoice, customer, diagnostics, and audit semantics while making the backend model explicit.
- Define which fields are authoritative, which are derived, and which are only support/migration metadata.

## 2. Current Local Model Summary

The current application stores these main areas locally:

- `settings`
  - Pricing and document defaults
  - Internal cost visibility flags
  - PDF layout options
  - Customer requirements flags
- `company profile`
  - Company name, contact details, branding, and Stripe-related account data
- `customers`
  - Residential/commercial customer records and UI-facing profile fields
- `projects`
  - Project identity, customer linkage, name/number/address, status, notes, and summary fields
- `estimates`
  - Saved estimate documents with builder state, document numbers, project/customer links, status, financials, totals, and metadata
- `invoices`
  - Saved invoice documents with payment lifecycle data, source estimate linkage, payments, balances, totals, and metadata
- `scope templates`
  - Reusable scope text snippets with names and timestamps
- `audit events`
  - Append-only local audit events, bounded in storage and included in diagnostics exports
- `Stripe checkout local tracking keys`
  - Checkout/session tracking and create-lock state used for client-side Stripe coordination
- `job learning / custom labor role data`
  - Review candidate snapshots, custom labor roles, and job-learning diagnostics support data

Important: the local storage shapes are intentionally permissive and legacy-tolerant. The backend schema should be stricter and normalized.

## 3. Canonical Backend Entities

Recommended future entities:

- `users`
- `companies`
- `company_members`
- `customers`
- `projects`
- `estimates`
- `estimate_line_items`
- `invoices`
- `invoice_line_items`
- `invoice_payments`
- `scope_templates`
- `settings`
- `audit_events`
- Future optional support entities:
  - `diagnostic_exports`
  - `support_cases`

Recommended entity intent:

- `users`: authentication and actor identity
- `companies`: top-level business ownership boundary
- `company_members`: role membership and access control
- `customers`: company-scoped customer records
- `projects`: company-scoped work records tied to customers
- `estimates`: company-scoped estimate documents
- `estimate_line_items`: normalized estimate detail rows
- `invoices`: company-scoped invoice documents
- `invoice_line_items`: normalized invoice detail rows
- `invoice_payments`: payment ledger entries and reconciliation source
- `scope_templates`: reusable scope text templates
- `settings`: company or user-scoped configuration, depending on the setting type
- `audit_events`: immutable operational event log
- `diagnostic_exports`: optional support artifacts for traceability
- `support_cases`: optional future support workflow records

## 4. Pure Mapper Output Contract

The committed backend mapper is a read-only adapter layer. It does not write storage, call network APIs, or depend on Supabase. Its job is to translate current local snapshot data into backend-ready draft objects that can be validated before any runtime wiring exists.

Mapper context:

- `createBackendMappingContext(options)` returns:
  - `mappingVersion`
  - `companyId`
  - `userId`
  - `generatedAt`
  - `source: "local_storage_export"`
  - `warnings: []`

Snapshot mapper:

- `mapLocalSnapshotToBackendDraft(snapshot, options)` returns:
  - `mappingMeta`
  - `companies`
  - `customers`
  - `projects`
  - `estimates`
  - `invoices`
  - `invoicePayments`
  - `scopeTemplates`
  - `settings`
  - `auditEvents`
  - `warnings`

Mapper rules:

- Preserve legacy local IDs in `legacy_local_id` fields.
- Keep `company_id` and `user_id` ownership fields explicit.
- Keep document numbers separate from database IDs.
- Keep invoice payment rows separate from invoice header rows.
- Preserve only safe top-level fields and obvious line-item structure.
- Treat warnings as pre-migration validation, not runtime repair logic.

Entity output intent:

- Company drafts represent the company ownership record plus contact/profile data.
- Customer drafts represent company-scoped customer records with preserved local IDs.
- Project drafts represent company-scoped work records with customer linkage.
- Estimate drafts represent backend-ready estimate documents with preserved legacy linkage and safe financial summary data.
- Invoice drafts represent backend-ready invoice documents with preserved estimate linkage, payment state, and safe line-item data.
- Invoice payment drafts represent normalized ledger entries only.
- Scope template drafts represent reusable scope content records.
- Settings drafts represent company-scoped configuration data.
- Audit event drafts represent immutable operational event records.

## 4. Ownership Model

The backend should use the following ownership boundaries:

- `company_id` is the business ownership boundary for customer/project/estimate/invoice/settings/template data
- `user_id` is the actor identity for auth, audit, and support traces
- `company_members` maps users to companies and carries role information
- Recommended roles:
  - `owner`
  - `admin`
  - `member`
  - `support`

Policy goals:

- Business records should never be globally readable by default.
- Support/admin access should be scoped to the relevant company and role.
- Audit events should identify the actor and the company, not just the target record.
- Multi-user support should be company-scoped, not record-scoped.

## 5. Relationship Model

Recommended relationships:

- `company → customers`
- `company → projects`
- `company → estimates`
- `company → invoices`
- `company → settings`
- `company → scope_templates`
- `company → audit_events`
- `customer → projects`
- `project → estimates`
- `project → invoices`
- `estimate → invoice` through `source_estimate_id`
- `invoice → payments`
- `audit_event → target entity`
- `diagnostic bundle → company/user context`

Recommended foreign-key shape:

- `customers.company_id → companies.id`
- `projects.company_id → companies.id`
- `projects.customer_id → customers.id`
- `estimates.company_id → companies.id`
- `estimates.project_id → projects.id`
- `invoices.company_id → companies.id`
- `invoices.project_id → projects.id`
- `invoices.source_estimate_id → estimates.id`
- `invoice_payments.invoice_id → invoices.id`
- `scope_templates.company_id → companies.id`
- `settings.company_id` or `settings.user_id` depending on scope
- `audit_events.company_id → companies.id`
- `audit_events.actor_user_id → users.id`

## 6. ID Strategy

Use two distinct identifier families:

- Database primary keys
  - Recommended format: UUID or ULID
  - Used for database relations and backend integrity
- Human/support identifiers
  - Used for document numbers, support references, and export traceability
  - Must remain separate from database primary keys

Migration rules:

- Preserve legacy local IDs during import/mapping.
- Keep legacy IDs in dedicated migration or external-ID columns when helpful.
- Never overwrite a database primary key with a legacy document number.
- Never rely on document numbers as a relational primary key.

Support IDs:

- Support IDs should be separate from database IDs.
- Support IDs may be human-friendly and prefixed for support workflows.
- Support IDs are for diagnostics and ticketing, not for joins.

## 7. Document Numbering Strategy

Document numbers must be company-scoped and transaction-safe.

Recommended strategy:

- `estimate_number` and `invoice_number` should be unique within a company
- Number allocation should be transactional to prevent collisions
- Numbering should not depend on client timing or localStorage state
- Existing local numbers should be preserved during migration whenever possible

Migration/backfill rules:

- If a local number already exists and is unique in a company, preserve it.
- If a collision exists, preserve the source number in a legacy/reference column and assign a new canonical number.
- Never renumber historical documents without an explicit controlled migration policy.

## 8. Status Model

Canonical status values:

- Projects:
  - `draft`
  - `estimating`
  - `active`
  - `completed`
  - `archived`
- Estimates:
  - `draft`
  - `pending`
  - `approved`
  - `sent`
  - `lost`
- Invoices:
  - `draft`
  - `sent`
  - `overdue`
  - `paid`
  - `void`
- Payments:
  - `unpaid`
  - `partial`
  - `paid`
  - `void`
- Diagnostic health severity:
  - `error`
  - `warning`
  - `info`

Status rules:

- UI display status may be derived from source fields.
- Backend persisted status should still follow the canonical vocabulary above.
- Paid/overdue/void invoice state should be derived from the ledger and lifecycle rules, not just copied from a single field.

## 9. Delete / Archive Rules

Recommended lifecycle rules:

- Customers with projects should not be hard-deleted in normal user flow.
- Projects with estimates, invoices, or payments should be soft-archived rather than hard-deleted.
- Converted estimates must remain linked to their resulting invoice.
- Invoices with payments should generally be voided or soft-retained, not hard-deleted.
- Audit events should be immutable.
- Diagnostic exports should never be treated as business records.

Hard delete guidance:

- Hard delete should be exceptional.
- Hard delete should be admin-only and support-audited later.
- Hard delete should not be possible if it would break referential integrity.
- If a record must disappear from active UI, prefer archive/soft-delete first.

## 10. Source-of-Truth Rules

Store authoritative fields:

- Company, customer, project, estimate, invoice, and payment identities
- Customer contact data
- Project relationship data
- Estimate and invoice line-item detail
- Invoice payment ledger entries
- Document numbering metadata
- Audit event metadata
- Support/diagnostic metadata

Recompute or derive:

- Project rollups
- Invoice balance remaining
- Payment status
- Overdue state
- Display-only labels and summary counts
- Diagnostic health summaries

Do not manually edit:

- Totals and balances without source reconciliation
- Status fields that are supposed to be derived from source records
- Conversion links without preserving the origin snapshot
- Document numbers after issuance unless a controlled repair process exists later

Payment source of truth:

- The payment ledger should drive payment state.
- Stripe evidence should reconcile against invoice payment entries rather than overwrite them blindly.

Estimate-to-invoice source of truth:

- The conversion snapshot should remain immutable once created.
- The invoice should retain its estimate linkage, source snapshot, and conversion metadata.

## 11. Migration Risk Register

High risk:

- localStorage shape drift
- mixed ID formats
- estimate-to-invoice conversion mismatch
- invoice balance/payment mismatch
- missing company/user ownership

Medium risk:

- duplicated relationship logic
- document-number collision
- orphaned records
- audit events with insufficient target IDs

Low risk:

- PDF/export schema mismatch, if the adapter layer is maintained carefully

## 12. Backend Implementation Order

Safest implementation order:

1. Canonical contract doc
2. Schema and migration design
3. RLS/security model
4. Local export/import adapter
5. Read-only sync
6. Write sync
7. Admin/support views
8. Repair tools later

Rationale:

- The model should be locked before any live storage migration.
- Read-only adapters should prove the mapping before writes exist.
- Repair tools should come last, after the normal data path is stable.

## 13. What Not To Build Yet

Do not build these yet:

- Repair tools
- Health UI
- Sensitive diagnostic export
- Backend admin console
- Automatic AI repairs
- Broad migration scripts
- Stripe server changes

## 14. Future Mapping Adapter Notes

The next backend-oriented implementation pass should add mapping fixtures and tests that prove existing local records can map into this company-scoped backend model without changing runtime behavior.

That future work should validate:

- Local customer/project/estimate/invoice records map to canonical backend entities
- Legacy IDs and document numbers survive migration cleanly
- Audit events can be imported as read-only support data
- Redacted diagnostics exports still match the backend contract shape
