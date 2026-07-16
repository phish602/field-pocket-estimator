// Gate 17A: server-only internal grant administration.
//
// This is an operator CLI, never an API route. These tests prove every write is
// opt-in, confirmed, reasoned, non-destructive, and that no secret is printed.

const fs = require("fs");
const path = require("path");
const {
  inspectEntitlementGrants,
  grantInternalEntitlement,
  revokeInternalEntitlement,
} = require("../../server/internalEntitlementGrantAdmin");

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
// adminClient is injected in these tests, so no service-role env is needed.
const ENV = { SUPABASE_URL: "https://x.supabase.co" };
const FAKE_SERVICE_ROLE_VALUE = "super-secret-service-role-value";

// Tracks every write so "wrote nothing" is provable rather than assumed.
function createClientStub({ company = { id: COMPANY_ID, name: "EstiPaid Demo Company" }, unrevokedRows = [], grantRow = null, insertError = null, updateError = null } = {}) {
  const calls = { insert: [], update: [] };
  return {
    calls,
    from: jest.fn((table) => {
      if (table === "companies") {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: company, error: null }) };
        return chain;
      }
      if (table === "company_entitlement_grants") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: chain.__single ?? grantRow, error: null }),
          then: (resolve) => resolve({ data: unrevokedRows, error: null }),
          insert: (payload) => {
            calls.insert.push(payload);
            const after = {
              select: () => after,
              maybeSingle: async () => (insertError
                ? { data: null, error: insertError }
                : { data: { id: GRANT_ID, company_id: payload.company_id, plan: payload.plan, source: payload.source, starts_at: payload.starts_at || "2026-07-16T00:00:00.000Z", expires_at: payload.expires_at || null, revoked_at: null }, error: null }),
            };
            return after;
          },
          update: (payload) => {
            calls.update.push(payload);
            const after = {
              eq: () => after,
              is: () => after,
              select: () => after,
              maybeSingle: async () => (updateError
                ? { data: null, error: updateError }
                : { data: { id: GRANT_ID, company_id: COMPANY_ID, plan: "business", source: "internal_comp", starts_at: "2026-07-16T00:00:00.000Z", expires_at: null, revoked_at: payload.revoked_at }, error: null }),
            };
            return after;
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const validGrant = (overrides = {}) => ({
  companyId: COMPANY_ID,
  confirmCompanyId: COMPANY_ID,
  plan: "business",
  grantedByUserId: USER_ID,
  reason: "Founder demonstration workspace",
  env: ENV,
  ...overrides,
});

describe("dry run is the default", () => {
  test("without --apply nothing is written", async () => {
    const stub = createClientStub();
    const result = await grantInternalEntitlement({ ...validGrant(), adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: true, applied: false, dryRun: true, plan: "business" }));
    expect(stub.calls.insert).toHaveLength(0);
    expect(stub.calls.update).toHaveLength(0);
  });

  test("--apply is required to insert", async () => {
    const stub = createClientStub();
    const result = await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: true, applied: true, plan: "business", grantId: GRANT_ID }));
    expect(stub.calls.insert).toHaveLength(1);
  });

  test("revoke dry run writes nothing", async () => {
    const stub = createClientStub({ grantRow: { id: GRANT_ID, company_id: COMPANY_ID, plan: "business", source: "internal_comp", starts_at: "2026-07-16T00:00:00.000Z", expires_at: null, revoked_at: null } });
    const result = await revokeInternalEntitlement({ companyId: COMPANY_ID, confirmCompanyId: COMPANY_ID, grantId: GRANT_ID, revokedByUserId: USER_ID, reason: "No longer required", env: ENV, adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: true, applied: false, dryRun: true }));
    expect(stub.calls.update).toHaveLength(0);
  });
});

describe("input validation refuses to write", () => {
  test.each([
    ["company confirmation mismatch", { confirmCompanyId: OTHER_COMPANY_ID }],
    ["invalid plan", { plan: "enterprise" }],
    ["free plan is not grantable", { plan: "free" }],
    ["blank reason", { reason: "   " }],
    ["missing reason", { reason: "" }],
    ["invalid company id", { companyId: "nope", confirmCompanyId: "nope" }],
    ["invalid granter id", { grantedByUserId: "nope" }],
    ["invalid starts-at", { startsAt: "nonsense" }],
    ["invalid expires-at", { expiresAt: "nonsense" }],
    ["expiry before start", { startsAt: "2026-07-16T00:00:00.000Z", expiresAt: "2026-07-15T00:00:00.000Z" }],
  ])("%s writes nothing", async (_label, overrides) => {
    const stub = createClientStub();
    const result = await grantInternalEntitlement({ ...validGrant(overrides), apply: true, adminClient: stub });
    expect(result.ok).toBe(false);
    expect(stub.calls.insert).toHaveLength(0);
  });

  test("missing service-role configuration writes nothing", async () => {
    const result = await grantInternalEntitlement({ ...validGrant({ env: {} }), apply: true });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(result.error).toMatch(/SERVICE_ROLE/);
  });

  test("a nonexistent company writes nothing", async () => {
    const stub = createClientStub({ company: null });
    const result = await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "Company not found." }));
    expect(stub.calls.insert).toHaveLength(0);
  });
});

describe("existing grants are never silently replaced", () => {
  const activeRow = { id: GRANT_ID, company_id: COMPANY_ID, plan: "pro", source: "internal_comp", starts_at: "2026-07-01T00:00:00.000Z", expires_at: null, revoked_at: null };

  test("an existing active grant is not overwritten", async () => {
    const stub = createClientStub({ unrevokedRows: [activeRow] });
    const result = await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already has an unrevoked grant");
    expect(stub.calls.insert).toHaveLength(0);
  });

  test("an expired but unrevoked grant must be revoked first", async () => {
    const expiredRow = { ...activeRow, starts_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-02-01T00:00:00.000Z" };
    const stub = createClientStub({ unrevokedRows: [expiredRow] });
    const result = await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("expired grant still counts until revoked");
    expect(stub.calls.insert).toHaveLength(0);
  });

  test("an already-revoked grant cannot be revoked again", async () => {
    const stub = createClientStub({ grantRow: { ...activeRow, revoked_at: "2026-07-10T00:00:00.000Z" } });
    const result = await revokeInternalEntitlement({ companyId: COMPANY_ID, confirmCompanyId: COMPANY_ID, grantId: GRANT_ID, revokedByUserId: USER_ID, reason: "again", apply: true, env: ENV, adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "That grant is already revoked." }));
    expect(stub.calls.update).toHaveLength(0);
  });
});

describe("writes carry exactly the expected safe fields", () => {
  test("grant inserts source internal_comp with the operator's reason and granter", async () => {
    const stub = createClientStub();
    await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    expect(stub.calls.insert[0]).toEqual({
      company_id: COMPANY_ID,
      plan: "business",
      source: "internal_comp",
      granted_by_user_id: USER_ID,
      reason: "Founder demonstration workspace",
    });
  });

  test("optional starts/expires are normalized to ISO when supplied", async () => {
    const stub = createClientStub();
    await grantInternalEntitlement({ ...validGrant({ startsAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-01T00:00:00Z" }), apply: true, adminClient: stub });
    expect(stub.calls.insert[0].starts_at).toBe("2026-08-01T00:00:00.000Z");
    expect(stub.calls.insert[0].expires_at).toBe("2026-09-01T00:00:00.000Z");
  });

  test("revoke updates the audit fields and does not delete", async () => {
    const stub = createClientStub({ grantRow: { id: GRANT_ID, company_id: COMPANY_ID, plan: "business", source: "internal_comp", starts_at: "2026-07-16T00:00:00.000Z", expires_at: null, revoked_at: null } });
    const result = await revokeInternalEntitlement({ companyId: COMPANY_ID, confirmCompanyId: COMPANY_ID, grantId: GRANT_ID, revokedByUserId: USER_ID, reason: "No longer required", apply: true, env: ENV, adminClient: stub });
    expect(result).toEqual(expect.objectContaining({ ok: true, applied: true, active: false }));
    expect(stub.calls.update).toHaveLength(1);
    expect(Object.keys(stub.calls.update[0]).sort()).toEqual(["revoke_reason", "revoked_at", "revoked_by_user_id", "updated_at"]);
    expect(stub.calls.update[0].revoked_by_user_id).toBe(USER_ID);
    expect(stub.calls.update[0].revoke_reason).toBe("No longer required");
    // No delete path exists at all.
    expect(JSON.stringify(stub.from.mock.calls)).not.toContain("delete");
  });
});

describe("nothing sensitive is exposed", () => {
  test("results never contain the reason, granter, or service-role key", async () => {
    const stub = createClientStub();
    const granted = await grantInternalEntitlement({ ...validGrant(), apply: true, adminClient: stub });
    const serialized = JSON.stringify(granted);
    [FAKE_SERVICE_ROLE_VALUE, "Founder demonstration workspace", USER_ID, "granted_by_user_id", "revoke_reason"].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  test("inspect returns only safe summary fields", async () => {
    const stub = createClientStub({ unrevokedRows: [{ id: GRANT_ID, company_id: COMPANY_ID, plan: "business", source: "internal_comp", starts_at: "2026-07-16T00:00:00.000Z", expires_at: null, revoked_at: null }] });
    const result = await inspectEntitlementGrants({ companyId: COMPANY_ID, env: ENV, adminClient: stub });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.activeGrants[0]).sort()).toEqual(["active", "companyId", "expiresAt", "grantId", "plan", "revokedAt", "source", "startsAt"]);
  });

  test("the CLI prints no secrets", () => {
    const cli = fs.readFileSync(path.join(__dirname, "../../scripts/manage-entitlement-grant.js"), "utf8");
    expect(cli).not.toMatch(/console\.\w+\([^)]*SERVICE_ROLE/);
    expect(cli).not.toMatch(/console\.log\(\s*process\.env/);
    expect(cli).not.toContain("JSON.stringify(process.env");
  });
});

describe("the admin code is server-only", () => {
  test("no browser-delivered module imports the grant admin or the CLI", () => {
    const srcDir = path.join(__dirname, "..");
    const offenders = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (!/\.(js|jsx)$/.test(entry.name)) return;
        if (/\.test\.jsx?$/.test(entry.name)) return; // this test file itself references it
        const contents = fs.readFileSync(full, "utf8");
        if (contents.includes("internalEntitlementGrantAdmin") || contents.includes("manage-entitlement-grant")) offenders.push(full);
      });
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  test("no browser-delivered module imports the server resolver", () => {
    const srcDir = path.join(__dirname, "..");
    const offenders = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (!/\.(js|jsx)$/.test(entry.name)) return;
        if (/\.test\.jsx?$/.test(entry.name)) return;
        if (fs.readFileSync(full, "utf8").includes("server/companyEntitlements")) offenders.push(full);
      });
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
