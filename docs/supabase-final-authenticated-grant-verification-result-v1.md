# Supabase Final Authenticated Grant Verification Result V1

## 1. Summary

- Result status: Passed
- Final authenticated grant verification passed in the disposable non-production project.
- RLS policies still govern row-level access on top of these table privileges.
- Production wiring remains blocked until explicitly approved.

## 2. Environment

- Project type: disposable / non-production Supabase dry-run project
- Project name: `estipaid-backend-v1-dryrun`
- Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`
- Execution method: manual Supabase SQL Editor

## 3. Verification Query

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
order by table_name, privilege_type;
```

## 4. Grant Result Matrix

| Table | Authenticated privileges |
| --- | --- |
| app_settings | INSERT, SELECT, UPDATE |
| audit_events | INSERT, SELECT |
| companies | INSERT, SELECT, UPDATE |
| company_users | DELETE, INSERT, SELECT, UPDATE |
| customers | INSERT, SELECT, UPDATE |
| estimate_line_items | INSERT, SELECT, UPDATE |
| estimates | INSERT, SELECT, UPDATE |
| invoice_line_items | INSERT, SELECT, UPDATE |
| invoice_payments | INSERT, SELECT, UPDATE |
| invoices | INSERT, SELECT, UPDATE |
| migration_batches | INSERT, SELECT, UPDATE |
| migration_write_results | INSERT, SELECT, UPDATE |
| projects | INSERT, SELECT, UPDATE |
| scope_templates | INSERT, SELECT, UPDATE |

## 5. Least-Privilege Conclusions

- No TRUNCATE grants were present for authenticated.
- No TRIGGER grants were present for authenticated.
- No REFERENCES grants were present for authenticated.
- DELETE was granted only on `company_users`.
- `audit_events` is limited to SELECT and INSERT.
- Business, financial, and migration records do not have broad destructive authenticated grants.
- RLS policies still govern row-level access on top of these table privileges.

## 6. Delete Safety Conclusion

- Only `company_users` has DELETE for authenticated.
- Protected business/financial/migration records do not have broad destructive authenticated delete grants.

## 7. Relationship to Final RLS Write / Deny Test

- This grant verification supports the final RLS write/deny behavior already proven in the disposable non-production project.
- The table privilege layer and the RLS policy layer are aligned for the tested matrix.

## 8. Remaining Production Blockers

- Production Supabase project has not been created/configured from this dry-run result.
- EstiPaid app is not wired to Supabase.
- Credentials/env handling has not been implemented.
- Local-to-backend migration execution has not been approved.
- Runtime backend client integration has not been tested.
- Production approval must still be explicit before wiring or data migration.

## 9. Non-Goals

- No source/runtime file changes
- No production deployment
- No production credentials
- No runtime auth wiring
- No backend writes
- No localStorage migration
- No UI changes

## 10. Approval Recommendation

- Recommended status: Passed
- Recommendation: keep production blocked until the production project, credentials, runtime integration, and migration approval are separately completed

## 11. Exact Next Step

- Keep production blocked until the production environment is explicitly approved and the app wiring/migration path is separately implemented and tested
