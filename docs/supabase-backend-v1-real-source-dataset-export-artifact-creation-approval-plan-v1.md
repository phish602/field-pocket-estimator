# Supabase Backend V1 Real Source Dataset / Export Artifact Creation Approval Plan V1

## 1. Summary
This document is real source dataset/export artifact creation approval planning only for EstiPaid backend V1. It defines future approval scope for creating or approving the actual source dataset/export artifact needed for controlled migration write dry-run and future migration write execution, without creating that real artifact in this pass.

## 2. Planning status
Planning-only.

Real source dataset/export artifact creation execution is not approved in this pass. This pass is docs-only.

## 3. Current blocker status
Current blocker state remains:
- Actual approved source dataset/export artifact has not been created/approved.
- Actual approved executable write mechanism has not been created/approved.
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
- Source dataset/export artifact readiness passed for contract/evidence definition scope only.
- Executable write mechanism readiness passed for contract/evidence definition scope only.
- Actual approved source dataset/export artifact has not been created/approved.
- Actual approved executable write mechanism has not been created/approved.
- No migration writes have run.
- No production data was changed.
- No source/runtime/env files were changed.
- Production launch remains blocked.

## 5. Future approval scope
Future separate approval may allow one controlled real source dataset/export artifact creation execution approval pass to:
- Define exact boundary for creating or approving the actual operator-held real source dataset/export artifact.
- Define metadata-only documentation rules and no-payload handling boundaries.
- Define source/provenance/scope/version/manifest/count/checksum/redaction/freshness requirements for actual artifact approval.
- Define chain-of-custody and approver evidence requirements for actual artifact creation or approval.
- Define readiness criteria for dry-run consumption and later migration write execution gates.

This scope does not imply migration write execution approval.

## 6. Explicit exclusions
This planning document does not approve:
- Real source dataset/export artifact creation execution.
- Real source dataset/export artifact creation in this pass.
- Real source dataset/export artifact commit in this pass.
- Real customer/business data handling in repo/docs/terminal/chat.
- Migration write code creation.
- Migration write script creation.
- Executable write mechanism creation.
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

## 7. Real artifact creation approval boundary
Future approval must require:
- Explicit creation/approval boundary for the actual source dataset/export artifact only.
- Explicit separation between artifact creation approval and artifact consumption approval.
- Explicit separation between artifact creation approval and executable write mechanism approval.
- Explicit separation between artifact creation approval and migration write execution approval.

## 8. Operator-held artifact boundary
Future approval must require:
- Any real source dataset/export artifact remains operator-held outside repository.
- Access-bounded custody boundary with approved operator roles.
- No repository storage of real payload files.
- Metadata-only references in repository docs.

## 9. No-repo/no-docs/no-chat payload rule
Future approval must require:
- No real customer/business payload content in repo files.
- No real payload excerpts in docs.
- No real payload output in terminal.
- No real payload excerpts in chat.
- No requests in chat for real customer/business payload content.

## 10. Metadata-only reporting rules
Future approval must require:
- Reporting in docs limited to metadata only.
- Allowed fields include artifact id/version, scope labels, entity counts, skipped/error counts, checksum/hash references, and approval status.
- No raw record payload values in reports.
- No sensitive free-text payload excerpts in reports.

## 11. Dataset source and provenance requirements
Future approval must require:
- Source origin class declaration for actual artifact.
- Source extraction/generation method summary.
- Provenance owner and approver role declarations.
- Provenance timestamp/version evidence.
- Provenance reporting without raw customer/business payload disclosure.

## 12. Dataset scope and entity coverage requirements
Future approval must require:
- Explicit included and excluded entity scope for actual artifact.
- Field-level scope boundaries for sensitive content.
- Entity coverage alignment to approved migration scope.
- Re-approval trigger when entity coverage scope changes.

## 13. Dataset version and identifier requirements
Future approval must require:
- Artifact identifier format.
- Artifact version format and increment policy.
- Snapshot/run label linkage requirements.
- Immutability expectations for approved id/version combinations.

## 14. Manifest requirements
Future approval must require manifest fields for:
- Artifact id/version.
- Provenance reference id.
- Scope declaration.
- Entity inventory list.
- Count summaries.
- Skipped/error summaries.
- Checksum/hash references.
- Approval evidence references.

## 15. Entity list and count requirements
Future approval must require:
- Explicit entity list aligned to migration scope.
- Per-entity source record counts.
- Per-entity eligible/ineligible counts where applicable.
- Per-entity expected mapped counts where applicable.

## 16. Skipped and error count requirements
Future approval must require:
- Skipped count reporting by entity and reason class.
- Error count reporting by entity and reason class.
- Threshold/tolerance definitions triggering blocker escalation.
- Reviewer sign-off requirement for skipped/error analysis.

## 17. Checksum/hash reference requirements
Future approval must require:
- Checksum/hash references in manifest.
- Integrity verification method declaration.
- Revalidation rules if artifact metadata changes.
- Reporting format that proves integrity without exposing payload values.

## 18. Redaction requirements
Future approval must require:
- Redaction policy for identifiers, contact fields, addresses, notes, and payment references when represented in metadata context.
- No raw sensitive payload storage in repository artifacts.
- No unredacted payload excerpts in docs/terminal/chat.
- Compliance evidence that redaction/no-payload boundaries were enforced.

## 19. Freshness and snapshot timing requirements
Future approval must require:
- Freshness window declarations.
- Snapshot timing requirements tied to approved run labels.
- Staleness tolerance and refresh triggers.
- Freshness evidence prior to downstream dry-run consumption.

## 20. Backup/export/rollback alignment
Future approval must require alignment with runbooks by ensuring:
- Backup/export handling for real artifacts remains outside repo.
- Rollback/recovery prerequisites remain required before any write consideration.
- No-write/read-only preview and verification baselines remain preserved.
- Artifact creation approval does not relax rollback governance.

## 21. Storage location boundary
Future approval must require:
- Approved storage location boundary outside repository for real artifact custody.
- Access controls and retention policy declarations.
- No sync of real payload files into repository paths.
- Revocation/rotation expectations for operator-held storage access.

## 22. Chain-of-custody and approval evidence
Future approval must require evidence entries for:
- Artifact origin and provenance custody records.
- Creation/approval actor and timestamp records.
- Scope/version/manifest/count/skipped-error/checksum review records.
- Operator-held boundary compliance records.
- Final approver no-go/go status for artifact readiness only.

## 23. Dry-run consumption readiness criteria
Before any future dry-run may consume actual artifact output, future approval must require:
- Real artifact creation/approval gate completed.
- Artifact contract and evidence package complete and approved.
- Provenance/scope/version/manifest/count/checksum/freshness evidence approved.
- No-repo/no-docs/no-chat payload boundary compliance verified.
- Dry-run remains no-write and non-destructive.

## 24. Migration write execution readiness criteria
Before any future migration write execution can be considered, future approval must require:
- Real source dataset/export artifact creation/approval completed in separate gate.
- Executable write mechanism creation/approval completed in separate gate.
- Explicit write scope/order/rollback-stop/post-write verification approvals completed in separate gate.
- Migration writes remain blocked until all separate approvals are complete.

## 25. Secret safety rules
Future approval must enforce:
- Service-role/secret/admin/database/JWT/token/private-key classes remain blocked from repo/frontend/docs/chat.
- No real Supabase URL or real anon/publishable key in repo files.
- No passwords, connection strings, tokens, private keys, or admin credentials in repo/docs/terminal/chat.

## 26. localStorage safety rules
Future approval must enforce:
- No localStorage mutation in this planning scope.
- Automatic localStorage migration remains blocked.
- Automatic sync remains blocked.
- localStorage fallback/default behavior remains unchanged.

## 27. Runtime separation rules
Future approval must enforce:
- No source/runtime behavior modifications in this planning scope.
- No browser runtime wiring changes in this planning scope.
- No save/load behavior changes in this planning scope.
- No unguarded production reads/writes from app workflows.

## 28. Production launch separation rules
- Artifact creation approval planning is not production launch approval.
- Production launch remains blocked and separately gated.
- Artifact creation approval completion does not imply launch authorization.

## 29. Hard stops
Immediate hard stops for this planning track:
- Any request to create the real source dataset/export artifact in this pass.
- Any request to commit real customer/business data.
- Any request to expose real data in docs, repo, terminal output, or chat.
- Any request to create migration write code.
- Any request to create migration write scripts.
- Any request to create the executable write mechanism.
- Any request to execute migration writes.
- Any request to insert/update/delete production rows.
- Any request to modify source/runtime behavior.
- Any request to wire writes into browser/app runtime.
- Any request to mutate localStorage.
- Any request to automatically migrate localStorage.
- Any request to automatically sync all data.
- Any request to expose real credentials or secrets.
- Any request to add service-role/secret/admin/database/JWT/token/private-key values to repo/frontend/docs/chat.
- Any request to launch production.
- Any request to add auth/session UX, onboarding UI, or membership UI.

## 30. Remaining blocked actions
- Real source dataset/export artifact creation or approval until separately approved
- Executable write mechanism creation or approval until separately approved
- Migration writes
- Production inserts/updates/deletes
- Real customer/project/estimate/invoice/payment data movement
- Real customer/business data committed to repo
- Migration write code creation
- Migration write script creation
- Source/runtime behavior changes unless separately approved
- Save/load behavior changes unless separately approved
- localStorage mutation
- Automatic localStorage migration
- Automatic sync
- Replacing localStorage entirely
- Removing localStorage fallback
- Unguarded production reads on app load
- Unguarded production writes from app workflows
- Browser-triggered production writes
- Auth/session UX
- User onboarding UI
- Company membership management UI
- Production launch
- Service-role/secret/admin key exposure in repo/frontend/docs/chat
- Real credential exposure in repo/docs/terminal/chat

## 31. Exact next gate
After this planning document is created and saved, the next gate is real source dataset/export artifact creation execution approval. That future approval may allow a controlled docs/evidence approval record for creating or approving the actual operator-held source dataset/export artifact outside the repo. Actual dataset creation, executable write mechanism creation, migration write code/script creation, migration writes, production inserts/updates/deletes, real data movement, source/runtime behavior changes, auth/session UX, onboarding UI, membership UI, automatic localStorage migration, automatic sync, and production launch remain blocked unless separately approved.
