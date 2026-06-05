# Supabase Backend V1 Source Dataset / Export Artifact Readiness Approval Plan V1

## 1. Summary
This document is source dataset/export artifact readiness approval planning only for EstiPaid backend V1. It defines future approval scope for creating or approving the missing source dataset/export artifact needed for controlled migration write execution, without creating any real dataset artifact in this pass.

## 2. Planning status
Planning-only.

Source dataset/export artifact readiness execution is not approved in this pass. This pass is docs-only.

## 3. Current blocker status
Current blocker state remains:
- No approved source dataset/export artifact has been produced/approved.
- No approved executable write mechanism has been created/approved.
- Migration writes remain blocked.

## 4. Current prerequisite status
Current prerequisite status is confirmed from prior approved evidence:
- Production backend deployment verification passed.
- App behavior regression baseline passed.
- Security review passed.
- Migration preview passed as no-write/read-only.
- Backup/export/rollback verification passed as no-write/read-only.
- Migration write execution was blocked/not executed.
- Blocker resolution passed for definition/evidence scope only.
- No migration writes have run.
- No production data was changed.
- No source/runtime/env files were changed.
- Production launch remains blocked.

## 5. Future approval scope
Future separate approval may allow one controlled source dataset/export artifact readiness execution pass to:
- Define and document approved dataset source/provenance contract.
- Define and document approved dataset scope/version/manifest/count/checksum contract.
- Define and document redaction/no-repo/operator-held boundaries.
- Define and document approval evidence required before write mechanism dry-run can consume any approved dataset artifact.

This scope does not imply migration write execution approval.

## 6. Explicit exclusions
This planning document does not approve:
- Source dataset/export artifact readiness execution.
- Real source dataset/export artifact creation or commit.
- Real customer/business data handling in repo/docs/terminal/chat.
- Migration write code creation.
- Migration write script creation.
- Migration writes.
- Production inserts/updates/deletes.
- Real data movement.
- Source/runtime behavior changes.
- Save/load behavior changes.
- localStorage mutation.
- Automatic localStorage migration.
- Automatic sync.
- Auth/session UX.
- User onboarding UI.
- Company membership management UI.
- Production launch.

## 7. Dataset source and provenance plan
Future approval must require:
- Explicit source type declaration (synthetic, redacted export, or approved operator-held source).
- Explicit extraction/generation method summary.
- Explicit source owner and approver role declarations.
- Provenance timestamping/versioning requirements.
- Provenance evidence format that excludes raw customer/business payload content.

## 8. Dataset scope plan
Future approval must require:
- Explicit included entity scope.
- Explicit excluded entity scope.
- Explicit field-level scope boundaries for sensitive content.
- Explicit scope lock for approved run label/version.
- Re-approval triggers when scope changes.

## 9. Dataset version and identifier plan
Future approval must require:
- Dataset artifact identifier format.
- Dataset version format and increment rules.
- Environment/run label linkage rules.
- Immutability expectations for approved version identifiers.

## 10. Dataset manifest requirements
Future approval must require manifest fields for:
- Dataset id and version.
- Source type and provenance reference id.
- Scope declaration.
- Entity inventory.
- Count summaries.
- Checksum/hash references.
- Approval evidence references.

## 11. Entity list and count requirements
Future approval must require:
- Explicit entity list aligned to migration scope.
- Per-entity source record counts.
- Per-entity eligible/ineligible counts where applicable.
- Per-entity expected mapping-target counts where applicable.

## 12. Skipped and error count requirements
Future approval must require:
- Skipped count reporting rules by entity and reason class.
- Error count reporting rules by entity and reason class.
- Threshold/tolerance definitions requiring blocker escalation.
- Evidence record that skipped/error counts were reviewed and approved.

## 13. Checksum/hash reference requirements
Future approval must require:
- Checksum/hash reference fields in manifest.
- Integrity verification method declaration.
- Recalculation/revalidation trigger rules.
- Reporting format that provides integrity evidence without exposing payload values.

## 14. Redaction and no-repo requirements
Future approval must require:
- Redaction rules for identifiers, contact fields, addresses, notes, and payment references.
- No-repo policy for real customer/business payload data.
- No raw payload data in repository docs.
- Metadata-only reporting pattern for docs.

## 15. Real-data handling boundaries
Future approval must require:
- Real data handling only in approved operator-side boundaries.
- No real payload copies in repository paths.
- No real payload rendering in approval/result docs.
- No real payload use before separate explicit approval.

## 16. Operator-held artifact rules
Future approval must require:
- Operator-held storage outside repository for any real artifact.
- Access-bounded storage and retrieval controls.
- Artifact lifecycle controls (creation, retention, revocation, replacement).
- Artifact reference in docs by metadata only (id/version/count/hash/status).

## 17. Terminal and chat exposure restrictions
Future approval must require:
- No real customer/business payloads printed in terminal output.
- No real payload excerpts in chat.
- No prompts requesting real customer/business payload content in chat.
- No secrets or credentials printed in terminal/chat.

## 18. Dataset freshness requirements
Future approval must require:
- Freshness window definitions.
- Staleness tolerance definitions.
- Refresh/re-extract conditions.
- Freshness evidence requirement prior to downstream consumption.

## 19. Dataset approval evidence requirements
Future approval must require evidence package entries for:
- Provenance approval.
- Scope approval.
- Version/id approval.
- Manifest and count approval.
- Checksum/hash verification approval.
- Redaction/no-repo compliance approval.
- Freshness approval.
- Operator-held boundary compliance approval.

## 20. Readiness criteria before write mechanism dry-run
Before any future write mechanism dry-run may consume a dataset artifact, future approval must require:
- Dataset artifact contract approved.
- Provenance/scope/version/manifest/count/checksum evidence approved.
- Redaction/no-repo/operator-held controls verified.
- Freshness evidence verified.
- Dry-run remains no-write and no-production-change by definition.

## 21. Readiness criteria before migration write execution
Before any future migration write execution may be considered, future approval must require:
- Dataset artifact readiness approved in a separate gate.
- Executable write mechanism readiness approved in a separate gate.
- Explicit write scope/order/rollback-stop/post-write verification approved.
- Migration writes remain blocked until those approvals are complete.

## 22. Backup/export/rollback alignment
Future approval must align with backup/export/rollback governance by requiring:
- Backup/export expectations remain outside repo for real payloads.
- Rollback/recovery readiness remains explicit prerequisite for any write consideration.
- No-write/read-only preview and verification baselines remain preserved.

## 23. Secret safety rules
Future approval must enforce:
- Service-role/secret/admin/database/JWT/token/private-key classes remain blocked from repo/frontend/docs/chat.
- No real Supabase URL or real anon/publishable key in repo files.
- No passwords, connection strings, tokens, private keys, or admin credentials in tracked content/docs/terminal/chat.

## 24. localStorage safety rules
Future approval must enforce:
- No localStorage mutation in dataset-readiness scope unless separately approved.
- Automatic localStorage migration remains blocked.
- Automatic sync remains blocked.
- localStorage fallback/default behavior remains unchanged.

## 25. Runtime separation rules
Future approval must enforce:
- No source/runtime behavior modifications in dataset-readiness scope.
- No browser runtime wiring changes.
- No unguarded production reads/writes from app workflows.
- Save/load behavior remains unchanged unless separately approved.

## 26. Production launch separation rules
- Dataset-readiness approval is not production launch approval.
- Production launch remains blocked and must remain a separate explicit gate.
- Dataset-readiness completion does not imply launch authorization.

## 27. Hard stops
Immediate hard stops for this planning track:
- Any request to create or commit real customer/business data in this pass.
- Any request to expose real data in docs/repo/terminal/chat.
- Any request to execute migration writes.
- Any request to insert/update/delete production rows.
- Any request to create migration write code.
- Any request to modify source/runtime behavior.
- Any request to mutate localStorage.
- Any request to automatically migrate localStorage.
- Any request to automatically sync all data.
- Any request to expose real credentials or secrets.
- Any request to add service-role/secret/admin/database/JWT/token/private-key values to repo/frontend/docs/chat.
- Any request to launch production.
- Any request to add auth/session UX, onboarding UI, or membership UI.

## 28. Remaining blocked actions
- Source dataset/export artifact creation or approval until separately approved
- Executable write mechanism creation or approval until separately approved
- Migration writes
- Production inserts/updates/deletes
- Real customer/project/estimate/invoice/payment data movement
- Real customer/business data committed to repo
- Migration write code creation
- Source/runtime behavior changes unless separately approved
- Save/load behavior changes unless separately approved
- localStorage mutation
- Automatic localStorage migration
- Automatic sync
- Replacing localStorage entirely
- Removing localStorage fallback
- Unguarded production reads on app load
- Unguarded production writes from app workflows
- Auth/session UX
- User onboarding UI
- Company membership management UI
- Production launch
- Service-role/secret/admin key exposure in repo/frontend/docs/chat
- Real credential exposure in repo/docs/terminal/chat

## 29. Exact next gate
After this planning document is created and saved, the next gate is source dataset/export artifact readiness execution approval. That future approval may allow a controlled docs/evidence pass to define the approved dataset artifact contract and approval evidence only. Actual real source dataset/export artifact creation, migration writes, executable write mechanism creation, production inserts/updates/deletes, real data movement, source/runtime behavior changes, auth/session UX, onboarding UI, membership UI, automatic localStorage migration, automatic sync, and production launch remain blocked unless separately approved.
