import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "docs/supabase-security-r1-tenant-isolation-v1.sql"),
  "utf8"
);

const requiredConstraints = [
  "company_users_company_id_user_id_key",
  "customers_company_id_id_key", "projects_company_id_id_key", "estimates_company_id_id_key",
  "invoices_company_id_id_key", "migration_batches_company_id_id_key",
  "projects_company_customer_fkey", "estimates_company_customer_fkey", "estimates_company_project_fkey",
  "invoices_company_customer_fkey", "invoices_company_project_fkey", "invoices_company_estimate_fkey",
  "estimate_line_items_company_estimate_fkey", "invoice_line_items_company_invoice_fkey",
  "invoice_payments_company_invoice_fkey", "migration_write_results_company_batch_fkey",
];

function constraintBlock(table, constraint) {
  const match = migration.match(new RegExp(
    `alter table public\\.${table}\\s+add constraint ${constraint}\\b[\\s\\S]*?;`,
    "i"
  ));
  expect(match).not.toBeNull();
  return match[0];
}

describe("Security R1.1 tenant-isolation migration contract", () => {
  test("adds every required tenant composite key and validates every new foreign key", () => {
    requiredConstraints.forEach((name) => expect(migration).toContain(`constraint ${name}`));
    [
      "projects_company_customer_fkey", "estimates_company_customer_fkey", "estimates_company_project_fkey",
      "invoices_company_customer_fkey", "invoices_company_project_fkey", "invoices_company_estimate_fkey",
      "estimate_line_items_company_estimate_fkey", "invoice_line_items_company_invoice_fkey",
      "invoice_payments_company_invoice_fkey", "migration_write_results_company_batch_fkey",
    ].forEach((name) => expect(migration).toContain(`validate constraint ${name}`));
  });

  test("makes every child foreign key company-scoped on both sides", () => {
    const pairs = [
      ["projects", "projects_company_customer_fkey", "customer_id", "customers"], ["estimates", "estimates_company_customer_fkey", "customer_id", "customers"],
      ["estimates", "estimates_company_project_fkey", "project_id", "projects"], ["invoices", "invoices_company_customer_fkey", "customer_id", "customers"],
      ["invoices", "invoices_company_project_fkey", "project_id", "projects"], ["invoices", "invoices_company_estimate_fkey", "estimate_id", "estimates"],
      ["estimate_line_items", "estimate_line_items_company_estimate_fkey", "estimate_id", "estimates"], ["invoice_line_items", "invoice_line_items_company_invoice_fkey", "invoice_id", "invoices"],
      ["invoice_payments", "invoice_payments_company_invoice_fkey", "invoice_id", "invoices"], ["migration_write_results", "migration_write_results_company_batch_fkey", "migration_batch_id", "migration_batches"],
    ];
    pairs.forEach(([child, name, column, parent]) => {
      expect(constraintBlock(child, name)).toContain(`foreign key (company_id, ${column}) references public.${parent} (company_id, id)`);
    });
  });

  test("uses exact per-constraint SET NULL targets and retains exact CASCADE blocks", () => {
    const targeted = {
      projects_company_customer_fkey: "customer_id",
      estimates_company_customer_fkey: "customer_id",
      estimates_company_project_fkey: "project_id",
      invoices_company_customer_fkey: "customer_id",
      invoices_company_project_fkey: "project_id",
      invoices_company_estimate_fkey: "estimate_id",
    };
    Object.entries(targeted).forEach(([name, column]) => {
      const table = name.startsWith("projects_") ? "projects" : name.startsWith("estimates_") ? "estimates" : "invoices";
      expect(constraintBlock(table, name)).toContain(`on delete set null (${column}) not valid`);
    });
    [["estimate_line_items", "estimate_line_items_company_estimate_fkey"], ["invoice_line_items", "invoice_line_items_company_invoice_fkey"], ["invoice_payments", "invoice_payments_company_invoice_fkey"], ["migration_write_results", "migration_write_results_company_batch_fkey"]].forEach(([table, name]) => {
      expect(constraintBlock(table, name)).toContain("on delete cascade not valid");
    });
    expect(migration).not.toMatch(/on delete set null\s+not valid/i);
    expect(migration).not.toMatch(/on delete set null\s*\([^)]*company_id/i);
  });

  test("contains only fail-safe preconditions, not data cleanup", () => {
    expect(migration).toMatch(/duplicate company_users\(company_id, user_id\) rows exist/i);
    expect(migration).not.toMatch(/^\s*(delete|truncate|update)\s+/im);
  });

  test("removes browser access from anon and server-only relations", () => {
    expect(migration).toMatch(/revoke all privileges on table[\s\S]*from anon;/i);
    ["audit_events", "company_entitlement_grants", "company_stripe_billing_refs"].forEach((table) => {
      expect(migration).toContain(`revoke all privileges on table public.${table} from authenticated;`);
    });
    expect(migration).not.toContain("grant select, insert on table public.audit_events to authenticated;");
    expect(migration).not.toContain("grant select, insert, update on table public.company_entitlement_grants to authenticated;");
    expect(migration).not.toContain("grant select, insert, update on table public.company_stripe_billing_refs to authenticated;");
    expect(migration).not.toMatch(/grant[^;]*to anon;/i);
    expect(migration).not.toMatch(/grant[^;]*(truncate|references|trigger)[^;]*to authenticated;/i);
    expect(migration).not.toMatch(/grant[^;]*on table[^;]*to service_role;/i);
    expect(migration).not.toMatch(/revoke[^;]*on table[^;]*from service_role;/i);
  });

  test("restores delete only for the three reviewed authenticated relations", () => {
    ["company_users", "estimate_line_items", "invoice_line_items"].forEach((table) => {
      expect(migration).toContain(`grant select, insert, update, delete on table public.${table} to authenticated;`);
    });
    const deleteGrants = [...migration.matchAll(/grant\s+select, insert, update, delete\s+on table public\.([a-z_]+)\s+to authenticated;/gi)].map((match) => match[1]);
    expect(deleteGrants.sort()).toEqual(["company_users", "estimate_line_items", "invoice_line_items"]);
  });

  test("restricts helper execution and preserves the automatic RLS trigger", () => {
    ["is_company_member(uuid)", "company_role(uuid)", "can_manage_company(uuid)", "can_write_company_records(uuid)"].forEach((fn) => {
      expect(migration).toContain(`revoke execute on function public.${fn} from public, anon;`);
      expect(migration).toContain(`grant execute on function public.${fn} to authenticated;`);
    });
    expect(migration).toContain("revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;");
    expect(migration).toContain("evtname = 'ensure_rls'");
    expect(migration).toContain("alter policy %I on %I.%I to authenticated");
  });
});
