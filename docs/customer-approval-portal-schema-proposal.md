# Customer Approval Portal Schema Proposal

This is a planning document only.

- No migration is being created.
- No Supabase SQL is being applied.
- No runtime app code is being changed.
- No public portal is being implemented yet.

## 1. Purpose and Scope

This document turns Gate 14A portal architecture into a docs-only schema, RLS, and backend-action proposal for the future Customer Approval Portal / Send-to-Customer workflow.

It is intended to supplement, not replace, these broader planning docs:

- `docs/backend-data-contract.md`
- `docs/supabase-schema-draft-v1.md`
- `docs/supabase-rls-policy-draft-v1.md`

Why this proposal is separate:

- The existing backend/schema/RLS drafts describe the core contractor app.
- Customer portal work adds a distinct public-access model, immutable customer-facing snapshots, token handling rules, and append-only customer actions.
- Those concerns are easier to review safely in a dedicated proposal before folding anything into general backend docs.

## 2. Gate 14A Product Decisions Locked for This Proposal

The following product decisions are assumed by this proposal:

1. Invoice customer action is **Acknowledge**, not **Approve**.
2. Estimate **Request Changes** keeps the core estimate status as `pending`.
3. Default portal-link expiration is **7 days**.
4. Customers cannot comment after a terminal action:
   - estimate approved
   - estimate request changes
   - invoice acknowledged
5. Only **one active link per snapshot** is allowed.
6. Customer-facing wording is **Request Changes**, not **Reject**.
7. Estimate approval must capture:
   - signer name
   - checkbox confirmation
8. Sending a draft invoice should move the core invoice status to `sent`.

## 3. Placement and Existing-Doc Alignment

### Best home for the portal schema proposal

The portal schema proposal best belongs in a new dedicated doc because it introduces:

- public-but-restricted access rules
- token-hash handling
- immutable customer-facing snapshots
- append-only customer event capture
- terminal decision records separate from normal contractor CRUD

### Why not fold this directly into the current schema draft yet

The current schema and RLS drafts are intentionally broad and core-app oriented. Folding portal design into them now would mix:

- contractor-authenticated CRUD
- future public portal access
- optional later provider integrations

Keeping this as a supplement reduces churn until the repo is ready for actual schema work.

### Existing planning conflicts to keep explicit

Current planning docs contain a few pre-existing naming/status differences that matter here:

- Membership table naming is not yet standardized:
  - `backend-data-contract.md` uses `company_members`
  - schema/RLS drafts use `company_users`
- Invoice lifecycle vocabulary is not fully consistent:
  - some docs mention invoice `partial`
  - current app logic treats `partial` as `payment_status`, not core invoice status

This portal proposal follows the more detailed current Supabase draft naming where possible:

- membership table name assumed here: `company_users`
- invoice core status remains `draft | sent | overdue | paid | void`
- partial payment remains a payment-state concern, not a new portal-specific invoice status

## 4. Proposed Tables

Suggested data types use Postgres/Supabase-style names for review only.

### 4.1 `customer_document_snapshots`

Purpose:

- Store the immutable customer-facing version of an estimate or invoice that a customer is allowed to review.
- Provide a stable `snapshot_id` for links, events, approvals, PDF generation, and legal/business traceability.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `source_document_type` | `text` | `estimate` or `invoice` |
| `source_document_id` | `uuid` | Source estimate/invoice row |
| `estimate_id` | `uuid` | Nullable direct FK when snapshot is for an estimate |
| `invoice_id` | `uuid` | Nullable direct FK when snapshot is for an invoice |
| `customer_id` | `uuid` | Customer receiving the portal view |
| `project_id` | `uuid` | Nullable if source document has no project |
| `snapshot_version` | `integer` | Monotonic version within a source document |
| `source_document_number` | `text` | Estimate/invoice number shown to customer |
| `source_document_status` | `text` | Source status when snapshot was created |
| `snapshot_payload` | `jsonb` | Sanitized customer-facing payload only |
| `payload_schema_version` | `integer` | Payload contract version |
| `payload_sha256` | `text` | Hash of the immutable payload |
| `pdf_storage_path` | `text` | Nullable future stored PDF path |
| `pdf_sha256` | `text` | Nullable future PDF checksum |
| `total_amount` | `numeric(12,2)` | Customer-visible total |
| `currency` | `text` | Default expected `usd` |
| `created_by` | `uuid` | Contractor actor |
| `created_at` | `timestamptz` | Snapshot creation timestamp |

#### Relationships

- `company_id → companies.id`
- `customer_id → customers.id`
- `project_id → projects.id` nullable
- `estimate_id → estimates.id` nullable
- `invoice_id → invoices.id` nullable

#### Required indexes / constraints

- Primary key on `id`
- Unique constraint on:
  - `(company_id, source_document_type, source_document_id, snapshot_version)`
- Index on:
  - `(company_id, source_document_type, source_document_id, created_at desc)`
  - `(company_id, customer_id, created_at desc)`
- Check rule:
  - exactly one of `estimate_id` or `invoice_id` is populated in a way that matches `source_document_type`

#### Immutability rules

- Snapshot payload is append-only and immutable after creation.
- A snapshot row must never be edited to change:
  - customer-facing text
  - visible totals
  - source linkages
- The only tolerated post-create fill-in is future PDF metadata derived from the same immutable payload:
  - `pdf_storage_path`
  - `pdf_sha256`

### 4.2 `customer_portal_links`

Purpose:

- Represent a secure portal link tied to exactly one immutable snapshot.
- Track expiration, revocation, supersession, and first/last view state.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `snapshot_id` | `uuid` | Snapshot being shared |
| `source_document_type` | `text` | `estimate` or `invoice` |
| `source_document_id` | `uuid` | Source estimate/invoice row |
| `customer_id` | `uuid` | Target customer |
| `project_id` | `uuid` | Nullable project |
| `token_hash` | `text` | Hash only; never raw token |
| `token_hash_version` | `text` | Hashing strategy version |
| `token_prefix` | `text` | Short masked support reference only |
| `expires_at` | `timestamptz` | Default `created_at + 7 days` |
| `revoked_at` | `timestamptz` | Nullable |
| `revoked_by` | `uuid` | Nullable contractor actor |
| `revoke_reason` | `text` | Nullable |
| `superseded_at` | `timestamptz` | Nullable when regenerated |
| `superseded_by_link_id` | `uuid` | Nullable replacement link |
| `first_viewed_at` | `timestamptz` | Nullable |
| `last_viewed_at` | `timestamptz` | Nullable |
| `allow_comments` | `boolean` | Default `true`; still blocked after terminal action |
| `allow_pdf_download` | `boolean` | Default `true` |
| `created_by` | `uuid` | Contractor actor |
| `created_at` | `timestamptz` | Link creation timestamp |

#### Relationships

- `company_id → companies.id`
- `snapshot_id → customer_document_snapshots.id`
- `customer_id → customers.id`
- `project_id → projects.id` nullable
- `superseded_by_link_id → customer_portal_links.id` nullable

#### Required indexes / constraints

- Primary key on `id`
- Unique constraint on `token_hash`
- Partial unique index on `snapshot_id` for active links only, for example:
  - one row where `revoked_at is null` and `superseded_at is null`
- Index on:
  - `(company_id, source_document_type, source_document_id, created_at desc)`
  - `(company_id, customer_id, created_at desc)`
  - `(expires_at)`

#### Expiration / revocation rules

- Default expiration: 7 days unless the contractor chooses a different allowed value later.
- Revoking a link does not delete it; it stamps:
  - `revoked_at`
  - `revoked_by`
  - optional `revoke_reason`
- Regenerating a link for the same snapshot should:
  - supersede the prior active link
  - create a new row with a new token hash
- Expired, revoked, or superseded links must not allow:
  - document retrieval
  - comment creation
  - approval/request-changes/acknowledgment

### 4.3 `customer_portal_events`

Purpose:

- Capture append-only portal business events and safe public interaction traces.
- Provide the contractor activity timeline source of truth.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `link_id` | `uuid` | Portal link involved |
| `snapshot_id` | `uuid` | Immutable snapshot involved |
| `source_document_type` | `text` | `estimate` or `invoice` |
| `source_document_id` | `uuid` | Source estimate/invoice row |
| `estimate_id` | `uuid` | Nullable direct estimate FK |
| `invoice_id` | `uuid` | Nullable direct invoice FK |
| `customer_id` | `uuid` | Target customer |
| `project_id` | `uuid` | Nullable project |
| `actor_type` | `text` | `customer`, `contractor`, or `system` |
| `event_type` | `text` | See event list below |
| `actor_name` | `text` | Nullable customer/contractor display text |
| `comment_text` | `text` | Nullable |
| `metadata` | `jsonb` | Safe extra context only |
| `ip_hash` | `text` | Nullable hashed security telemetry |
| `user_agent_hash` | `text` | Nullable hashed security telemetry |
| `occurred_at` | `timestamptz` | Event timestamp |

#### Event vocabulary

Recommended portal event types:

- `link_created`
- `link_viewed`
- `pdf_downloaded`
- `comment_added`
- `estimate_approved`
- `estimate_request_changes`
- `invoice_acknowledged`
- `link_revoked`
- `link_expired`
- `link_superseded`
- `rate_limited`

#### Relationships

- `company_id → companies.id`
- `link_id → customer_portal_links.id`
- `snapshot_id → customer_document_snapshots.id`
- `customer_id → customers.id`
- `project_id → projects.id` nullable
- `estimate_id → estimates.id` nullable
- `invoice_id → invoices.id` nullable

#### Required indexes / constraints

- Primary key on `id`
- Index on:
  - `(company_id, occurred_at desc)`
  - `(snapshot_id, occurred_at desc)`
  - `(link_id, occurred_at desc)`
  - `(source_document_type, source_document_id, occurred_at desc)`

#### Immutability rules

- Append-only only.
- No updates to past event meaning.
- No hard delete in normal product flow.

### 4.4 `document_approvals`

Purpose:

- Store the single terminal customer decision for a snapshot in a query-friendly way.
- Provide a durable summary row backed by append-only portal events.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `snapshot_id` | `uuid` | One terminal decision per snapshot |
| `link_id` | `uuid` | Link used for the decision |
| `source_document_type` | `text` | `estimate` or `invoice` |
| `source_document_id` | `uuid` | Source estimate/invoice row |
| `estimate_id` | `uuid` | Nullable direct estimate FK |
| `invoice_id` | `uuid` | Nullable direct invoice FK |
| `customer_id` | `uuid` | Target customer |
| `project_id` | `uuid` | Nullable project |
| `decision` | `text` | `approved`, `request_changes`, or `acknowledged` |
| `signer_name` | `text` | Required for estimate approval; nullable for other decisions unless policy later expands |
| `confirmation_checked` | `boolean` | Required `true` for estimate approval |
| `decision_comment` | `text` | Nullable; request-changes should require meaningful text |
| `portal_event_id` | `uuid` | Back-reference to the event row that created the terminal decision |
| `decided_at` | `timestamptz` | Decision timestamp |

#### Relationships

- `company_id → companies.id`
- `snapshot_id → customer_document_snapshots.id`
- `link_id → customer_portal_links.id`
- `customer_id → customers.id`
- `project_id → projects.id` nullable
- `estimate_id → estimates.id` nullable
- `invoice_id → invoices.id` nullable
- `portal_event_id → customer_portal_events.id`

#### Required indexes / constraints

- Primary key on `id`
- Unique constraint on `snapshot_id`
- Unique constraint on `portal_event_id`
- Index on:
  - `(company_id, decided_at desc)`
  - `(source_document_type, source_document_id)`

#### Immutability rules

- Append-only only.
- No second terminal decision for the same snapshot.
- Re-opening a customer response requires a new snapshot and new link, not editing this row.

### 4.5 `outbound_messages` (later / optional)

Purpose:

- Track manual-provider or future integrated email/SMS send attempts.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `link_id` | `uuid` | Portal link being delivered |
| `snapshot_id` | `uuid` | Snapshot being delivered |
| `channel` | `text` | `email`, `sms`, or later channels |
| `destination_masked` | `text` | Never raw private destination in logs if avoidable |
| `provider` | `text` | Nullable until provider exists |
| `provider_message_id` | `text` | Nullable |
| `delivery_status` | `text` | queued/sent/failed/etc. |
| `template_key` | `text` | Nullable |
| `last_error_code` | `text` | Nullable |
| `created_by` | `uuid` | Contractor actor |
| `created_at` | `timestamptz` | Created timestamp |
| `sent_at` | `timestamptz` | Nullable |

#### Notes

- Not required for Gate 14B.
- May be added in Gate 14H or later.

### 4.6 `portal_access_audit` (later / optional)

Purpose:

- Store higher-volume security telemetry separately from business timeline events.

#### Proposed fields

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | Primary key |
| `company_id` | `uuid` | Owning company |
| `link_id` | `uuid` | Portal link |
| `snapshot_id` | `uuid` | Snapshot |
| `outcome` | `text` | allowed/expired/revoked/invalid/rate_limited |
| `ip_hash` | `text` | Never raw IP |
| `user_agent_hash` | `text` | Never raw UA if hashing is enough |
| `rate_limit_bucket` | `text` | Nullable |
| `metadata` | `jsonb` | Safe debugging context only |
| `occurred_at` | `timestamptz` | Event timestamp |

#### Notes

- Not required for Gate 14B.
- Could be excluded from local export artifacts later if too large/noisy, while still living in backend backups.

## 5. Raw Token Handling Rule

Raw portal tokens must never be stored in:

- database tables
- local export artifacts
- diagnostics exports unless specifically redacted
- backup/restore payloads

Recommended rule set:

- The app generates a raw secret token at link-creation time.
- Backend stores only:
  - `token_hash`
  - `token_hash_version`
  - short masked `token_prefix`
- Public URLs are assembled at send/copy time using the raw token, but the raw token is not persisted as a durable database column.
- Token lookup must hash the presented token server-side and compare hashes.

## 6. RLS and Security Proposal

### 6.1 Contractor authenticated access

Portal tables are still company-owned contractor data:

- `customer_document_snapshots`
- `customer_portal_links`
- `customer_portal_events`
- `document_approvals`
- later optional `outbound_messages`
- later optional `portal_access_audit`

Recommended contractor access:

- active `company_users` membership required for reads
- `owner`, `admin`, and `member` may create portal links and read portal activity within company
- `viewer` is read-only unless a later policy removes even that
- revoke/regenerate should be allowed for `owner`, `admin`, and likely `member`

### 6.2 Public portal access

Anon/public users should **not** receive direct table access to:

- `estimates`
- `invoices`
- `projects`
- `customers`
- `customer_document_snapshots`
- `customer_portal_links`
- `customer_portal_events`
- `document_approvals`

Reason:

- Portal access is token-scoped, not company-membership-scoped.
- Direct anon `SELECT` would make accidental overexposure much easier than a narrow secure boundary.
- The public portal must return only sanitized snapshot data, not raw app rows.

### 6.3 Secure function / edge-function boundary

Recommended public boundary:

- Customer actions go through a narrow server-side boundary:
  - Edge Function, RPC, or equivalent secure backend action
- That boundary is responsible for:
  - hashing the presented token
  - resolving the current link
  - checking expiration/revocation/supersession
  - loading the immutable snapshot
  - returning only allowed customer-facing fields
  - inserting allowed events/terminal decisions
  - applying status side effects safely

### 6.4 Token-hash lookup behavior

Recommended lookup rules:

1. Receive raw token at public `/portal/:token` boundary.
2. Hash token server-side using the active hash version.
3. Compare to `customer_portal_links.token_hash`.
4. Reject invalid, revoked, superseded, or expired links before loading snapshot payload.
5. Never return `token_hash` to the client.

### 6.5 Public event insertion restrictions

Public/anon callers must not be allowed to directly insert arbitrary rows into:

- `customer_portal_events`
- `document_approvals`

Instead:

- secure backend action validates token + action + state
- secure backend action inserts only allowed event types
- secure backend action blocks:
  - comments after terminal action
  - second terminal decision
  - actions on expired/revoked/superseded links

### 6.6 Rate-limit and telemetry plan

Recommended later protections:

- rate limit per:
  - token hash
  - hashed IP bucket
  - hashed user-agent bucket
- record rate-limit outcomes in:
  - `customer_portal_events` for meaningful business/security events
  - `portal_access_audit` later for high-volume telemetry

### 6.7 What the customer can see

Customer should see only:

- company branding/contact appropriate for the sent document
- document type and number
- customer/project summary fields intentionally included in snapshot
- scope/notes intentionally included in snapshot
- customer-visible totals
- due date for invoices when included
- PDF download if enabled
- comment box if enabled and still allowed
- decision buttons valid for that snapshot/link state

### 6.8 What the customer must never see

Customer must never see:

- internal notes
- cost breakdown
- margin / internal profitability
- audit internals
- unrelated records
- raw app-state blobs
- raw source estimate/invoice rows
- other customers
- raw tokens, token hashes, or backend identifiers beyond what is intentionally displayed

## 7. Backend Action Contracts (Docs Only)

Future backup-dirty effects below are planning notes only. No runtime backup code is being changed in Gate 14B.

Suggested future dirty domains:

- `customer_document_snapshots`
- `customer_portal_links`
- `customer_portal_events`
- `document_approvals`
- `outbound_messages`

### 7.1 Create portal link

**Input**

- contractor auth context
- `source_document_type`
- `source_document_id`
- optional `expires_at`
- optional `allow_comments`
- optional `allow_pdf_download`

**Output**

- `snapshot_id`
- `link_id`
- public portal URL
- `expires_at`
- allowed-actions summary

**Auth requirement**

- authenticated contractor with active company membership

**Validation**

- source document exists and belongs to contractor company
- source document is eligible for customer send
- customer linkage is resolvable
- sanitized snapshot payload can be built
- any previous active link for that snapshot is revoked or superseded before new insert

**Failure cases**

- document not found
- wrong company
- invalid source type
- source document not sendable
- snapshot build failed

**Status side effects**

- create immutable snapshot row
- create link row
- add `link_created` event
- if sending a draft invoice, move core invoice status to `sent`

**Backup dirty effect**

- future mark dirty for:
  - `customer_document_snapshots`
  - `customer_portal_links`
  - `customer_portal_events`

### 7.2 Fetch public portal document by token

**Input**

- raw public token

**Output**

- sanitized snapshot data
- safe link-state summary
- permitted actions

**Auth requirement**

- public/anon allowed through secure backend boundary only

**Validation**

- token hashes to a known link
- link is not revoked, superseded, or expired
- snapshot exists

**Failure cases**

- invalid token
- expired link
- revoked link
- superseded link
- rate-limited request

**Status side effects**

- update `first_viewed_at` / `last_viewed_at`
- append `link_viewed` event when appropriate

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_links`
  - `customer_portal_events`

### 7.3 Approve estimate by token

**Input**

- raw token
- `signer_name`
- `confirmation_checked`
- optional customer comment

**Output**

- success receipt
- `snapshot_id`
- resulting portal/document status summary

**Auth requirement**

- public/anon allowed through secure backend boundary only

**Validation**

- link resolves to an estimate snapshot
- link is active and not terminally decided
- `signer_name` is non-empty
- `confirmation_checked = true`

**Failure cases**

- invalid/expired/revoked/superseded token
- wrong document type
- missing signer name
- confirmation not checked
- terminal decision already exists

**Status side effects**

- append `estimate_approved` event
- insert `document_approvals` row with `decision = approved`
- move core estimate status to `approved`
- allow existing approved-estimate-to-invoice flow to remain unchanged

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_events`
  - `document_approvals`
  - affected source estimate domain

### 7.4 Request changes by token

**Input**

- raw token
- required `decision_comment`
- optional `signer_name`

**Output**

- success receipt
- `snapshot_id`
- resulting portal/document status summary

**Auth requirement**

- public/anon allowed through secure backend boundary only

**Validation**

- link resolves to an estimate snapshot
- link is active and not terminally decided
- request-changes comment is non-empty and meaningful

**Failure cases**

- invalid/expired/revoked/superseded token
- wrong document type
- missing comment
- terminal decision already exists

**Status side effects**

- append `estimate_request_changes` event
- insert `document_approvals` row with `decision = request_changes`
- keep core estimate status as `pending`
- any follow-up/change-request UX should come from portal activity and later project/timeline surfaces, not by forcing a new estimate core status now

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_events`
  - `document_approvals`
  - affected source estimate domain

### 7.5 Acknowledge invoice by token

**Input**

- raw token
- optional `signer_name`
- optional acknowledgment note

**Output**

- success receipt
- `snapshot_id`
- resulting portal/document status summary

**Auth requirement**

- public/anon allowed through secure backend boundary only

**Validation**

- link resolves to an invoice snapshot
- link is active and not terminally decided

**Failure cases**

- invalid/expired/revoked/superseded token
- wrong document type
- terminal decision already exists

**Status side effects**

- append `invoice_acknowledged` event
- insert `document_approvals` row with `decision = acknowledged`
- core invoice payment state remains unchanged
- if the invoice was draft at send time, the send action should already have moved it to `sent`

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_events`
  - `document_approvals`
  - affected source invoice domain

### 7.6 Add customer comment

**Input**

- raw token
- `comment_text`
- optional `actor_name`

**Output**

- success receipt
- saved comment metadata

**Auth requirement**

- public/anon allowed through secure backend boundary only

**Validation**

- link is active
- comments are allowed
- no terminal decision exists yet
- comment text is non-empty and within limits

**Failure cases**

- invalid/expired/revoked/superseded token
- comments disabled
- terminal decision already exists
- empty or oversized comment
- rate limited

**Status side effects**

- append `comment_added` event only
- no estimate/invoice math changes

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_events`

### 7.7 Revoke portal link

**Input**

- contractor auth context
- `link_id`
- optional revoke reason

**Output**

- revoked link summary

**Auth requirement**

- authenticated contractor with active company membership

**Validation**

- link exists in contractor company
- link is not already revoked

**Failure cases**

- link not found
- wrong company
- already revoked

**Status side effects**

- stamp revoke fields on link
- append `link_revoked` event

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_links`
  - `customer_portal_events`

### 7.8 Record portal access event

**Input**

- secure internal call context
- resolved `link_id`
- `event_type`
- safe metadata

**Output**

- internal ack only

**Auth requirement**

- internal/server-side only

**Validation**

- link exists
- event type is allowed for the caller path

**Failure cases**

- invalid link
- disallowed event type

**Status side effects**

- append event row
- optionally append security telemetry later

**Backup dirty effect**

- future mark dirty for:
  - `customer_portal_events`
  - optional `portal_access_audit`

### 7.9 Future send email/text action

**Input**

- contractor auth context
- `link_id`
- `channel`
- destination
- optional template/message override

**Output**

- queued/sent/failure summary

**Auth requirement**

- authenticated contractor with active company membership

**Validation**

- link exists and is still sendable
- provider is configured
- destination is valid

**Failure cases**

- provider unavailable
- invalid destination
- link revoked/expired
- send failed

**Status side effects**

- insert or update `outbound_messages`
- optionally append a contractor-side send event later

**Backup dirty effect**

- future mark dirty for:
  - `outbound_messages`
  - optionally `customer_portal_events`

## 8. Backup and Restore Implications

Portal backup/restore coverage is intentionally deferred to a later gate, but the schema direction should anticipate it now.

Recommended future coverage:

- include in backend backup scope:
  - `customer_document_snapshots`
  - `customer_portal_links`
  - `customer_portal_events`
  - `document_approvals`
  - later `outbound_messages`
- treat `portal_access_audit` as optional/high-volume backup scope later

Rules:

- raw tokens must never appear in export artifacts
- token hashes and masked prefixes may be backed up
- immutable snapshot payloads and terminal decision rows are the critical recovery records

## 9. Required Future Tests

Before any implementation is accepted, future tests should cover at least:

### Schema/data-shape tests

- only one active link per snapshot
- token hash uniqueness
- one terminal decision per snapshot
- snapshot immutability
- correct estimate/invoice snapshot FK rules

### Security/RLS tests

- anon users cannot directly `SELECT` estimates/invoices/customers/projects
- anon users cannot directly insert portal events or approvals
- contractor reads stay company-scoped
- cross-company portal reads are blocked
- revoked/expired/superseded links cannot act

### Backend action tests

- create-link uses sanitized immutable snapshot payload
- estimate approval requires signer name and checkbox confirmation
- request changes keeps estimate core status `pending`
- invoice acknowledgment does not alter payment math/status
- comments stop after terminal action
- sending a draft invoice promotes it to `sent`

### Backup/privacy tests

- raw tokens never appear in artifacts/logs
- token hash lookup works across supported hash versions
- later backup-dirty markers fire for portal mutations without altering financial logic

## 10. Explicit Non-Goals for Gate 14B

Do not do any of the following in this gate:

- create migrations
- create SQL
- deploy RLS
- change runtime backup/restore
- implement `/portal/:token`
- change contractor app routing
- change estimate or invoice math
- change current PDF rendering logic
- change `EstimateForm`

This proposal is for review only and should stay ahead of implementation.
