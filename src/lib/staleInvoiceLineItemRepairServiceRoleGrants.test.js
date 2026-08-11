import fs from "fs";
import path from "path";

const migrationDir = path.resolve(process.cwd(), "supabase/migrations");
const repairGrantMigration = fs.readFileSync(
  path.join(migrationDir, "20260810190500_stale_invoice_line_item_repair_service_role_grants.sql"),
  "utf8"
).toLowerCase();
const auditReturningGrantMigration = fs.readFileSync(
  path.join(migrationDir, "20260810190600_stale_invoice_line_item_repair_audit_returning_grant.sql"),
  "utf8"
).toLowerCase();

describe("stale invoice line-item repair service-role grants", () => {
  test("grants only the guarded repair's required table operations", () => {
    expect(repairGrantMigration).toContain(
      "grant select, insert, update, delete on table public.invoice_line_items to service_role;"
    );
    expect(repairGrantMigration).toContain(
      "grant select on table public.invoices to service_role;"
    );
    expect(repairGrantMigration).toContain(
      "grant select on table public.invoice_payments to service_role;"
    );
    expect(repairGrantMigration).toContain(
      "grant insert on table public.audit_events to service_role;"
    );
    expect(repairGrantMigration).not.toMatch(/grant\s+all\s+on\s+table/i);
  });

  test("permits the audit IDs explicitly returned by the guarded insert", () => {
    expect(auditReturningGrantMigration).toContain(
      "grant select on table public.audit_events to service_role;"
    );
    expect(auditReturningGrantMigration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+table/i);
  });
});
