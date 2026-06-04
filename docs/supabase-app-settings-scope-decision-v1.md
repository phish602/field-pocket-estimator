# Supabase App Settings Scope Decision V1

This is a planning / decision artifact only.

- Not SQL.
- Not deployed.
- Not a migration.
- Not runtime wiring.
- No backend writes are being added.

This document resolves the open `app_settings` scope decision before RLS SQL drafting.

## 1. Final V1 Decision

- `app_settings` should support both company-wide settings and user-specific settings.
- Company-wide settings are the default for settings that affect document output, numbering, company behavior, templates, shared preferences, or backend migration/sync behavior.
- User-specific settings are only for personal UI preferences that do not affect company records or exported documents.
- `company_id` is required for all `app_settings` rows.
- `user_id` is nullable.
- `setting_scope` should distinguish `company` vs `user` settings.

## 2. Scope Semantics

### setting_scope = company

- `company_id` required
- `user_id` null
- Applies to the company or workspace
- Readable by company members
- Writable by owner/admin by default unless a later policy allows members

### setting_scope = user

- `company_id` required
- `user_id` required
- Applies only to that user inside that company
- Readable/writable by that user
- Owner/admin should not use this path to alter another user’s personal UI preferences unless future admin tooling explicitly allows it

## 3. Examples

### Company-scoped examples

- Default estimate terms
- Default invoice terms
- Company document preferences
- Numbering preferences
- Shared template preferences
- Backend migration/sync settings
- PDF/export settings that affect company documents

### User-scoped examples

- Collapsed/expanded UI preferences
- Last selected filters
- Theme/display preference if stored server-side later
- Personal dashboard layout preference if added later

## 4. SQL Draft Implication

- `app_settings` should include `company_id`.
- `app_settings` should include nullable `user_id`.
- `app_settings` should include a `setting_scope` check constraint with `company` and `user` values.
- Uniqueness should prevent duplicate setting keys per scope:
  - company settings unique by `company_id + setting_key` where `setting_scope = company`
  - user settings unique by `company_id + user_id + setting_key` where `setting_scope = user`
- RLS draft should distinguish company-scope reads/writes from user-scope reads/writes.

## 5. RLS Implication

- Company-scoped settings:
  - Read: active company members
  - Write: owner/admin by default
  - Optional future member write only for safe operational settings
- User-scoped settings:
  - Read/write: owning user within active company membership
  - Viewer/member/admin/owner roles do not automatically grant mutation of another user’s personal settings
- Migration/sync settings remain owner/admin controlled.

## 6. Migration Implication

- Local settings with company/document/output impact should migrate as company-scoped.
- Local UI-only settings should migrate as user-scoped only when a `user_id` exists.
- Ambiguous local settings should be flagged needs-review by preview/report rather than silently guessed.
- `legacy_local_id` and `migration_batch_id` should be preserved where applicable.

## 7. Decision Status

- `app_settings` scope decision: resolved for V1 SQL/RLS drafting
- Remaining future decision: exact setting keys and which current local settings map to company vs user scope

## 8. Approval Gate

- After this decision, the RLS SQL draft may be created as a docs-only review artifact.
- SQL/RLS still must not be executed.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.

## 9. Non-Goals

Do not build any of the following yet:

- SQL edits
- Supabase policies
- Migrations
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials
- Source code mapping changes

This decision document exists to resolve the last app_settings scope ambiguity before the next RLS drafting step.

