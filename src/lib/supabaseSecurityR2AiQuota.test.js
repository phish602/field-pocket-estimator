import fs from "fs";
import path from "path";

const migrationPath = path.resolve(process.cwd(), "docs/supabase-security-r2-ai-quota-v1.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

// Executable SQL with every `--` comment removed, so contract assertions can
// never be satisfied by prose in a header comment.
const executableSql = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, "").trimEnd())
  .filter((line) => line.trim())
  .join("\n");

const CONSUME_SIGNATURE ="public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer)";
const PRUNE_SIGNATURE = "public.prune_ai_route_quota_counters(integer)";

function functionBody(name) {
  const match = migration.match(
    new RegExp(`create or replace function public\\.${name}\\b[\\s\\S]*?\\nend \\$\\$;`, "i")
  );
  expect(match).not.toBeNull();
  return match[0];
}

describe("Security R2.2 AI quota migration contract", () => {
  test("is a single forward-only transaction that repairs no data", () => {
    expect(executableSql.startsWith("begin;")).toBe(true);
    expect(executableSql.endsWith("commit;")).toBe(true);
    // Anchored to statement position: the postcondition legitimately names
    // TRUNCATE as a privilege to assert the absence of.
    expect(executableSql).not.toMatch(/^\s*drop\s+(table|policy|function|constraint)\b/im);
    expect(executableSql).not.toMatch(/^\s*truncate\b/im);
    // The only writes are to the quota table this migration creates.
    expect(executableSql).not.toMatch(/^\s*(?:delete\s+from|update)\s+(?!public\.ai_route_quota_counters\b)/im);
  });

  test("stores only bounded bucket structure: identifiers, timestamps and counters", () => {
    const table = executableSql.match(
      /create table public\.ai_route_quota_counters \(([\s\S]*?)\n\);/i
    );
    expect(table).not.toBeNull();

    const lines = table[1].split("\n").map((line) => line.trim()).filter(Boolean);
    const firstConstraint = lines.findIndex((line) => line.startsWith("constraint"));
    expect(firstConstraint).toBeGreaterThan(0);
    const columns = lines.slice(0, firstConstraint).map((line) => line.split(/\s+/)[0]);

    expect(columns.sort()).toEqual([
      "bucket_started_at", "budget_key", "created_at", "request_count",
      "subject_id", "subject_type", "updated_at", "window_kind",
    ]);
    // No route column: counters are keyed by shared budget, so a second paid
    // route cannot create a second set of counters.
    expect(columns).not.toContain("route");
  });

  test("never introduces a column that could hold request content", () => {
    [
      "token", "access_token", "prompt", "context", "user_input", "response",
      "completion", "estimate", "customer", "ip", "ip_address", "user_agent", "payload",
    ].forEach((forbidden) => {
      expect(migration).not.toMatch(new RegExp(`^\\s*${forbidden}\\s+(text|jsonb|json|inet|bytea)\\b`, "im"));
    });
  });

  test("keys buckets so each subject holds at most one row per window", () => {
    expect(migration).toContain(
      "primary key (subject_type, subject_id, budget_key, window_kind, bucket_started_at)"
    );
    expect(migration).toMatch(/check \(subject_type in \('user', 'company'\)\)/i);
    expect(migration).toMatch(/check \(window_kind in \('short', 'daily'\)\)/i);
    expect(migration).toMatch(/check \(request_count >= 0\)/i);
  });

  test("counts against one shared paid-AI budget rather than per route", () => {
    expect(migration).toMatch(/check \(budget_key in \('paid_ai'\)\)/i);
    // No route ever reaches the database: every paid route passes the budget,
    // so enrolling a second route cannot double a caller's allowance.
    expect(executableSql).not.toContain("/api/");
    const body = functionBody("consume_ai_route_quota");
    expect(body).toContain("p_budget text");
    expect(body).toContain("p_budget <> 'paid_ai'");
    expect(body).not.toMatch(/\bp_route\b/);
  });

  test("enables RLS and grants no role direct table access", () => {
    expect(migration).toContain(
      "alter table public.ai_route_quota_counters enable row level security;"
    );
    // service_role included: it reaches the table only through the two
    // SECURITY DEFINER functions, never by direct read or DML.
    ["public", "anon", "authenticated", "service_role"].forEach((role) => {
      expect(migration).toContain(
        `revoke all privileges on table public.ai_route_quota_counters from ${role};`
      );
    });
    // No policy exists, so no non-bypassing role can read or write a row.
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/grant[^;]*on table public\.ai_route_quota_counters[^;]*to \w+/i);
  });

  test("proves absence of effective table privileges for every browser and server role", () => {
    // A REVOKE statement is not proof: it says nothing about privileges held by
    // inheritance. The postcondition must test what each role can exercise.
    expect(executableSql).not.toMatch(/information_schema\.role_table_grants/i);

    const postcondition = migration.slice(migration.indexOf("Post-conditions."));
    expect(postcondition).toMatch(
      /foreach v_role in array array\['anon', 'authenticated', 'service_role'\] loop/
    );
    expect(postcondition).toMatch(
      /foreach v_privilege in array array\[\s*\n?\s*'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\s*\n?\s*\] loop/
    );
    expect(postcondition).toContain(
      "if has_table_privilege(v_role, 'public.ai_route_quota_counters', v_privilege) then"
    );
    expect(postcondition).toMatch(/raise exception[^;]*retains effective %[^;]*v_role, v_privilege;/);

    // Every named role and every named privilege is covered by that loop.
    const roleList = postcondition.match(/array\['anon', 'authenticated', 'service_role'\]/);
    expect(roleList).not.toBeNull();
    ["anon", "authenticated", "service_role"].forEach((role) => {
      expect(roleList[0]).toContain(`'${role}'`);
    });
    const privilegeList = postcondition.match(/array\[\s*'SELECT',[^\]]*\]/);
    expect(privilegeList).not.toBeNull();
    ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].forEach((privilege) => {
      expect(privilegeList[0]).toContain(`'${privilege}'`);
    });

    // A missing role would make has_table_privilege raise, so absence is
    // caught explicitly rather than passing silently.
    expect(postcondition).toContain("if to_regrole(v_role) is null then");
  });

  test("verifies the absence of a PUBLIC table ACL entry separately from the role loop", () => {
    const postcondition = migration.slice(migration.indexOf("Post-conditions."));
    // PUBLIC is not a role, so has_table_privilege can never speak for it: the
    // ACL is read directly, with PUBLIC identified by grantee OID 0.
    expect(postcondition).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(postcondition).toMatch(/and a\.grantee = 0/);
    expect(postcondition).toContain("'public.ai_route_quota_counters'::regclass");
    expect(postcondition).toContain("still carries a PUBLIC table ACL entry");
  });

  test("aborts on any surviving forbidden privilege", () => {
    const postcondition = migration.slice(migration.indexOf("Post-conditions."));
    // Both checks must terminate the transaction, not warn.
    const raises = postcondition.match(/raise exception 'Security R2\.2 refused:/g) || [];
    expect(raises.length).toBeGreaterThanOrEqual(2);
    expect(postcondition).not.toMatch(/raise (notice|warning)/i);
    // The whole migration is one transaction, so any abort rolls it all back.
    expect(executableSql.startsWith("begin;")).toBe(true);
    expect(executableSql.endsWith("commit;")).toBe(true);
  });

  test("claims no protection against a compromised service-role credential", () => {
    // service_role keeps EXECUTE on the functions by design, so the table-grant
    // boundary must not be described as defeating a leaked service key.
    expect(migration).not.toMatch(/leaked service (key|role)/i);
    expect(migration).not.toMatch(/cannot[^.\n]*forge usage/i);
    expect(migration).toMatch(/EXECUTE on those functions by design/);
    expect(migration).toMatch(/outside what this table-grant boundary can guarantee/);
    // The intended function grants are unchanged.
    [CONSUME_SIGNATURE, PRUNE_SIGNATURE].forEach((signature) => {
      expect(migration).toContain(`grant execute on function ${signature} to service_role;`);
    });
  });

  test("refuses to run against a pre-existing quota table", () => {
    // CREATE TABLE IF NOT EXISTS would silently accept a relation missing
    // columns, keys, checks, RLS or trusted ownership.
    expect(executableSql).not.toMatch(/create table if not exists public\.ai_route_quota_counters/i);
    expect(executableSql).toMatch(/create table public\.ai_route_quota_counters \(/);
    expect(migration).toMatch(
      /if to_regclass\('public\.ai_route_quota_counters'\) is not null then\s*\n\s*raise exception/i
    );
    expect(migration).toContain("already exists");
    expect(executableSql).not.toMatch(/create index if not exists/i);
  });

  test("establishes and verifies trusted ownership for the table and both functions", () => {
    expect(migration).toContain("alter table public.ai_route_quota_counters owner to postgres;");
    [CONSUME_SIGNATURE, PRUNE_SIGNATURE].forEach((signature) => {
      expect(migration).toContain(`alter function ${signature} owner to postgres;`);
    });
    // CREATE OR REPLACE keeps a pre-existing owner, so the post-conditions
    // re-read the catalog rather than trusting the DDL above.
    expect(migration).toContain("pg_get_userbyid(relowner)");
    expect(migration).toContain("pg_get_userbyid(proowner) as owner");
    expect(migration).toMatch(/rather than postgres/);
    expect(migration).toContain("is not SECURITY DEFINER");
    expect(migration).toContain("does not fix search_path");
    expect(migration).toMatch(/if not v_rls then/);
    expect(migration).toContain("must have no policy");
  });

  test("exposes quota consumption only to service_role", () => {
    [CONSUME_SIGNATURE, PRUNE_SIGNATURE].forEach((signature) => {
      ["public", "anon", "authenticated"].forEach((role) => {
        expect(migration).toContain(`revoke all privileges on function ${signature} from ${role};`);
      });
      expect(migration).toContain(`grant execute on function ${signature} to service_role;`);
    });
    expect(migration).not.toMatch(/grant execute on function public\.(consume_ai_route_quota|prune_ai_route_quota_counters)[^;]*to (anon|authenticated|public)\b/i);
  });

  test("gives every SECURITY DEFINER function a fixed search_path", () => {
    const definers = [...migration.matchAll(/create or replace function public\.([a-z_]+)\(/gi)].map((m) => m[1]);
    expect(definers.sort()).toEqual(["consume_ai_route_quota", "prune_ai_route_quota_counters"]);
    definers.forEach((name) => {
      const body = functionBody(name);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = pg_catalog, public");
    });
  });

  test("consumes atomically under row locks taken in a fixed, deadlock-free order", () => {
    const body = functionBody("consume_ai_route_quota");
    // Inspect only the locking SELECTs, not the retention DELETE above them.
    const locks = [...body.matchAll(/select request_count into v_\w+[\s\S]*?for update;/gi)]
      .map(([statement]) => {
        const subject = statement.match(/subject_type = '(user|company)'/);
        const window = statement.match(/window_kind = '(short|daily)'/);
        expect(subject).not.toBeNull();
        expect(window).not.toBeNull();
        return `${subject[1]}:${window[1]}`;
      });
    expect(locks).toHaveLength(4);
    // Shared company rows are always locked first, so no lock cycle can form.
    expect(locks).toEqual(["company:short", "company:daily", "user:short", "user:daily"]);
    expect(body).toMatch(/insert into public\.ai_route_quota_counters[\s\S]*?on conflict do nothing;/i);

    // The single increment happens strictly after every limit check.
    const incrementAt = body.indexOf("set request_count = request_count + 1");
    expect(incrementAt).toBeGreaterThan(-1);
    ["v_user_short >= p_user_short_limit", "v_company_short >= p_company_short_limit",
      "v_user_daily >= p_user_daily_limit", "v_company_daily >= p_company_daily_limit"].forEach((check) => {
      expect(body.indexOf(check)).toBeGreaterThan(-1);
      expect(body.indexOf(check)).toBeLessThan(incrementAt);
    });
    // Exactly one increment statement: one quota unit per admitted request.
    expect(body.match(/request_count = request_count \+ 1/g)).toHaveLength(1);
  });

  test("enforces both per-user and per-company limits in both windows", () => {
    const body = functionBody("consume_ai_route_quota");
    ["p_user_short_limit", "p_company_short_limit", "p_user_daily_limit", "p_company_daily_limit"]
      .forEach((limit) => expect(body).toContain(limit));
    // Limits arrive from the server and are still range-validated in the database.
    expect(body).toContain("consume_ai_route_quota received an invalid limit");
    expect(body).toMatch(/allowed := false; retry_after_seconds := v_short_retry/);
    expect(body).toMatch(/allowed := false; retry_after_seconds := v_daily_retry/);
    expect(body).toMatch(/allowed := true; retry_after_seconds := 0/);
  });

  test("derives a positive Retry-After from the rejected bucket", () => {
    const body = functionBody("consume_ai_route_quota");
    expect(body).toMatch(/v_short_retry := greatest\(1, ceil\(/);
    expect(body).toMatch(/v_daily_retry := greatest\(1, ceil\(/);
    expect(body).toContain("v_short_bucket + make_interval(secs => v_short_seconds)");
    expect(body).toContain("v_daily_bucket + interval '1 day'");
  });

  test("bounds retention with namespace-safe per-call cleanup", () => {
    const body = functionBody("consume_ai_route_quota");
    const cleanup = body.match(
      /delete from public\.ai_route_quota_counters([\s\S]*?);/i
    );
    expect(cleanup).not.toBeNull();

    // Each subject id must be matched only inside its own namespace: a user id
    // must never be able to delete a company row, or vice versa.
    expect(cleanup[1]).toMatch(/subject_type = 'user' and subject_id = p_user_id/);
    expect(cleanup[1]).toMatch(/subject_type = 'company' and subject_id = p_company_id/);
    expect(cleanup[1]).not.toMatch(/subject_id in \(/i);
    expect(cleanup[1]).not.toMatch(/subject_type = 'user' and subject_id = p_company_id/);
    expect(cleanup[1]).not.toMatch(/subject_type = 'company' and subject_id = p_user_id/);
    expect(cleanup[1]).toMatch(/bucket_started_at < v_short_bucket/);
    expect(cleanup[1]).toMatch(/bucket_started_at < v_daily_bucket/);
    // Nowhere in the function may a subject id be matched without its namespace.
    expect(body).not.toMatch(/subject_id in \(/i);

    const prune = functionBody("prune_ai_route_quota_counters");
    expect(prune).toContain("p_retention_days integer default 2");
    expect(prune).toMatch(/bucket_started_at < now\(\) - make_interval\(days => p_retention_days\)/);
    expect(migration).toContain(
      "create index ai_route_quota_counters_bucket_started_at_idx"
    );
  });

  test("changes no existing business table, policy, grant or constraint", () => {
    const touchedTables = [...migration.matchAll(/(?:alter|create) table (?:if not exists )?public\.([a-z_]+)/gi)]
      .map((match) => match[1]);
    expect([...new Set(touchedTables)]).toEqual(["ai_route_quota_counters"]);

    const grantTargets = [...migration.matchAll(/(?:grant|revoke)[\s\S]*?on (?:table|function) public\.([a-z_]+)/gi)]
      .map((match) => match[1]);
    expect([...new Set(grantTargets)].sort()).toEqual([
      "ai_route_quota_counters", "consume_ai_route_quota", "prune_ai_route_quota_counters",
    ]);
    expect(migration).not.toMatch(/alter policy/i);
  });
});
