# Backend Sync Risk Register

This is a planning document only.

- No backend code is being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## Risk Register

| Risk | Why it matters | Likely cause | Prevention rule | Validation check |
|---|---|---|---|---|
| Missing `company_id` / `user_id` | Records cannot be safely scoped or audited. | Local records or context are incomplete. | Block migration until ownership IDs are present. | Preview must flag missing ownership IDs as blockers. |
| Duplicate local IDs | Can create collisions or overwrite the wrong record. | Legacy local data already contains duplicates. | Never merge duplicates silently. | Preview and mapper warnings must block duplicates. |
| Document-number collisions | Human-facing documents can become ambiguous. | Local numbers were generated without company-scoped uniqueness. | Flag collisions before migration and resolve before writes. | Preview must report collisions for estimates and invoices. |
| Broken customer/project/document relationships | Related records may become orphaned or mis-linked. | Local snapshot references missing parent records. | Require relationship review before syncing. | Preview must flag broken relationships clearly. |
| Orphaned invoice payments | Payment history can detach from invoice state. | Invoice rows or payment rows are incomplete. | Never write payment rows without a valid invoice link. | Mapping/preview must reject or warn on missing invoice linkage. |
| Orphaned line items | Totals and document detail can be lost. | Parent document mapping is incomplete or split. | Keep line items attached to their parent document only. | Draft mapping should preserve parent-child linkage. |
| Accidental cross-company data exposure | One company could read another company’s data. | Missing or incorrect RLS/company scoping. | Require company membership on every company-scoped read. | RLS design and permission matrix must be approved first. |
| Overwriting local records during sync | Local-first data could be lost or silently replaced. | Sync writes are designed before preview/merge rules. | Never overwrite local data without explicit approval. | Preview must be read-only and repeatable before writes exist. |
| Losing legacy local IDs | Migration traceability and support lookup break. | Backend schema omits legacy trace fields. | Preserve `legacy_local_id` and related legacy fields. | Mapper and preview outputs must retain legacy IDs. |
| Hard-deleting real project/document data | Real work history can be destroyed. | Delete flow is too permissive. | Prefer archive/soft-delete for non-empty records. | Delete rules must be approved before wiring any writes. |
| Editing sent/paid financial documents too loosely | Financial records can become inconsistent. | Role permissions are too broad. | Restrict edits for sent/paid/partial documents. | Role matrix and future RLS rules must enforce stricter access. |
| Migration preview not showing warnings clearly | Users may approve unsafe migrations. | Preview UX hides or downplays blockers. | Separate blockers from review items and keep warnings visible. | Preview report must surface severity groups before approval. |
| Partial migration writes | Data can end up half-migrated and hard to repair. | No transaction, rollback, or retry strategy. | Do not enable writes until partial-write handling is defined. | Backend wiring must not begin before dry-run validation exists. |
| Offline/local-first conflict | Later sync may disagree with local edits. | Multiple write sources or stale replicas. | Define sync conflict rules before any runtime sync. | Sync strategy must be approved before implementation. |
| Stale `app_settings` or `scope_templates` | Settings/templates may not match the active app state. | Migrated copy is not refreshed or versioned. | Validate recency and scope before migration. | Preview should expose timestamps/counts for these records. |
| Oversized image/photo payloads | Sync or storage can fail or become expensive. | Media blobs are carried forward without limits. | Enforce size limits and separate media handling. | Preview should surface large payload warnings if present. |
| Audit events being mutable or missing | Support traceability and trust are lost. | Audit storage is not append-only or events are dropped. | Keep audit events immutable and preserve them in migration. | Mapper/preview must retain audit events and flag gaps. |

## Blocker Risks

The following should stop a migration until resolved:

- Missing ownership IDs
- Duplicate entity IDs
- Cross-company access risk
- Partial writes without rollback/retry strategy
- Destructive actions without confirmation

## Needs Review Risks

The following should be reviewed before proceeding:

- Document-number collisions
- Broken optional relationships
- Missing payment amounts
- Stale templates/settings
- Oversized photo payloads

## Validation Gates Before Backend Wiring

Before any backend write path is added, confirm:

- Mapper tests pass.
- Migration preview tests pass.
- Schema is approved.
- RLS ownership model is approved.
- Role matrix is approved.
- Preview UI is approved before writes.
- Dry-run migration report is available.
- No write path exists until blockers are handled.

## Do Not Build Yet

Do not build any of the following yet:

- Supabase writes
- Production migration
- Runtime sync
- Automatic conflict resolution
- Destructive cleanup tool

This register is meant to keep the backend rollout conservative and focused on preventing data loss, bad relationships, and permission mistakes.

