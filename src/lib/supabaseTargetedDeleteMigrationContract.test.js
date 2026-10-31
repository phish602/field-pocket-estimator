const fs = require("fs");
const path = require("path");

// The targeted mutation writer performs exact-target deletes. That capability is
// half source and half SQL: a writer that asks for a DELETE the authenticated
// role cannot perform fails with 42501 forever, no matter how correct the client
// is. This reads the repository migration SQL as text and proves the contract
// the writer depends on actually exists in the migration set. It needs no
// running database.
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const BASELINE = "20260725071222_production_baseline.sql";
const CONTRACT = "20260826010356_targeted_mutation_delete_contract.sql";

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
}

function readMigration(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

// Statements only. The migration's own explanatory header names the privileges
// it deliberately does NOT take, so prose must never be read as SQL.
function statementsOnly(sql) {
  return sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

function allMigrationSql() {
  return migrationFiles().map(readMigration).join("\n");
}

// Matches a grant that includes DELETE for `authenticated` on the given table,
// whether the privilege is listed alone or among others, quoted or bare.
function grantsDeleteToAuthenticated(sql, table) {
  const pattern = new RegExp(
    `GRANT[^;]*\\bDELETE\\b[^;]*ON\\s+TABLE\\s+"?public"?\\.\\s*"?${table}"?\\s+TO\\s+"?authenticated"?`,
    "i"
  );
  return pattern.test(sql);
}

function deletePolicyHelper(sql, policyName, table) {
  const pattern = new RegExp(
    `CREATE POLICY\\s+"?${policyName}"?\\s+ON\\s+"?public"?\\.\\s*"?${table}"?\\s+FOR DELETE\\s+TO\\s+"?authenticated"?\\s+USING\\s*\\(\\s*"?public"?\\.\\s*"?(\\w+)"?\\s*\\(\\s*"?company_id"?\\s*\\)\\s*\\)`,
    "i"
  );
  const match = sql.match(pattern);
  return match ? match[1] : "";
}

describe("targeted mutation delete SQL contract", () => {
  test("the forward migration exists and the production baseline is untouched", () => {
    const files = migrationFiles();
    expect(files).toContain(BASELINE);
    expect(files).toContain(CONTRACT);
    // Forward-only: the new contract sorts after the baseline and after the
    // last shipped repair migration.
    expect(files[files.length - 1]).toBe(CONTRACT);
    expect(readMigration(BASELINE)).toContain('CREATE POLICY "estimate_line_items_delete_operational"');
  });

  test.each([
    ["customers"],
    ["projects"],
    ["estimates"],
    ["invoices"],
    ["invoice_payments"],
  ])("authenticated may DELETE from %s", (table) => {
    expect(grantsDeleteToAuthenticated(allMigrationSql(), table)).toBe(true);
  });

  test.each([
    ["customers_delete_operational", "customers", "can_write_company_records"],
    ["projects_delete_operational", "projects", "can_write_company_records"],
    ["estimates_delete_operational", "estimates", "can_write_company_records"],
    ["invoices_delete_owner_admin", "invoices", "can_manage_company"],
    ["invoice_payments_delete_owner_admin", "invoice_payments", "can_manage_company"],
  ])("%s authorizes rows through %s", (policyName, table, helper) => {
    expect(deletePolicyHelper(allMigrationSql(), policyName, table)).toBe(helper);
  });

  test("the existing line-item delete boundaries are left exactly as the baseline set them", () => {
    const sql = allMigrationSql();
    expect(deletePolicyHelper(sql, "estimate_line_items_delete_operational", "estimate_line_items"))
      .toBe("can_write_company_records");
    expect(deletePolicyHelper(sql, "invoice_line_items_delete_owner_admin", "invoice_line_items"))
      .toBe("can_manage_company");
    // The forward migration must not restate or redefine either of them.
    const contract = statementsOnly(readMigration(CONTRACT));
    expect(contract).not.toContain("estimate_line_items");
    expect(contract).not.toContain("invoice_line_items");
  });

  test("the forward migration widens nothing beyond those five deletes", () => {
    const contract = statementsOnly(readMigration(CONTRACT));
    expect(contract).not.toMatch(/GRANT\s+ALL[^;]*TO\s+"?authenticated"?/i);
    expect(contract).not.toMatch(/\bTRUNCATE\b/i);
    expect(contract).not.toMatch(/TO\s+"?anon"?/i);
    expect(contract).not.toMatch(/TO\s+"?service_role"?/i);
    expect(contract).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(contract).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(contract).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(contract).not.toMatch(/(ADD|DROP)\s+CONSTRAINT|FOREIGN\s+KEY|ON\s+DELETE\s+CASCADE/i);
    // Only the five intended DELETE grants, one per table.
    expect(contract.match(/GRANT\s+DELETE\s+ON\s+TABLE/gi)).toHaveLength(5);
  });

  test("no migration disables row level security or grants delete to anon", () => {
    const sql = statementsOnly(allMigrationSql());
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*TO\s+"?anon"?/i);
  });
});
