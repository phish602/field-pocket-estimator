import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "docs/supabase-security-r1-audit-policy-cleanup-v1.sql"),
  "utf8"
);

describe("Security R1.2 audit policy cleanup migration contract", () => {
  test("is transaction-wrapped and verifies every reviewed audit-events precondition", () => {
    expect(migration).toMatch(/^\s*begin;/im);
    expect(migration).toMatch(/commit;\s*$/im);
    [
      "to_regclass('public.audit_events')",
      "c.relrowsecurity",
      "policyname = 'audit_events_select_members'",
      "policy_row.permissive <> 'PERMISSIVE'",
      "policy_row.cmd <> 'SELECT'",
      "policy_row.roles <> array['public'::name]",
      "policy_row.qual <> 'is_company_member(company_id)'",
      "has_table_privilege('anon', 'public.audit_events'",
      "has_table_privilege('authenticated', 'public.audit_events'",
    ].forEach((needle) => expect(migration).toContain(needle));
  });

  test("checks each browser role and table privilege exactly once", () => {
    const calls = [...migration.matchAll(/has_table_privilege\('([^']+)',\s*'public\.([^']+)',\s*'([^']+)'\)/gi)];
    const expected = ["anon", "authenticated"].flatMap((role) =>
      ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
        .map((privilege) => `${role}|audit_events|${privilege}`)
    );
    const actual = calls.map((match) => `${match[1]}|${match[2]}|${match[3]}`);

    expect(actual).toHaveLength(14);
    expect(actual.sort()).toEqual(expected.sort());
  });

  test("drops exactly the reviewed policy without conditional cleanup", () => {
    expect(migration).toMatch(/^drop policy audit_events_select_members on public\.audit_events;$/im);
    expect(migration.match(/drop policy\s+/gi)).toHaveLength(1);
    expect(migration).not.toMatch(/drop policy if exists/i);
  });

  test("makes no other database change", () => {
    expect(migration).not.toMatch(/\b(create|alter)\s+policy\b/i);
    expect(migration).not.toMatch(/\b(grant|revoke)\b/i);
    expect(migration).not.toMatch(/^\s*(insert|update|delete|truncate)\s+/im);
    expect(migration).not.toMatch(/\b(create|alter|drop)\s+(function|table|constraint)\b/i);
    expect(migration).not.toMatch(/row level security/i);
    expect(migration).not.toMatch(/on public\.(?!audit_events\b)/i);
  });

  test("references no public object other than audit_events", () => {
    const publicObjects = [...migration.matchAll(/public\.([a-z_][a-z0-9_]*)/gi)]
      .map((match) => match[1].toLowerCase());

    expect([...new Set(publicObjects)]).toEqual(["audit_events"]);
  });
});
