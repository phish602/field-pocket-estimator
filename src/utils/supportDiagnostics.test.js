import { buildDiagnosticBundle, createDiagnosticBundleMeta, redactDiagnosticSnapshot } from "./supportDiagnostics";

describe("supportDiagnostics", () => {
  const snapshot = {
    companyProfile: {
      id: "company-1",
      email: "boss@example.com",
      phone: "555-111-2222",
      address: "123 Main St",
      notes: "private note",
    },
    customers: [
      { id: "c1", name: "Acme", email: "a@acme.com", phone: "555-222-3333", address: "1 Test St" },
    ],
    projects: [
      { id: "p1", customerId: "c1", projectName: "Roof", notes: "internal" },
    ],
    estimates: [
      { id: "e1", projectId: "p1", status: "approved", total: 100, date: "2025-01-01" },
    ],
    invoices: [
      { id: "i1", projectId: "p1", status: "sent", invoiceTotal: 100, amountPaid: 20, balanceRemaining: 80, dueDate: "2025-01-10" },
    ],
    settings: {
      docDefaults: { defaultInternalNotesEstimate: "secret" },
    },
    scopeTemplates: [{ id: "t1", name: "Template" }],
    auditEvents: [{ id: "evt-1", type: "health.check_run", createdAt: 1710000000000 }],
  };

  test("creates bundle meta deterministically when inputs are provided", () => {
    expect(createDiagnosticBundleMeta({
      supportId: "SUP-1",
      generatedAt: 1710000000000,
      bundleSchemaVersion: "1.0.0",
      appVersion: "1.2.3",
      routeContext: "project-detail",
    })).toEqual({
      supportId: "SUP-1",
      generatedAt: new Date(1710000000000).toISOString(),
      bundleSchemaVersion: "1.0.0",
      appVersion: "1.2.3",
      routeContext: "project-detail",
    });
  });

  test("builds a diagnostic bundle with the expected top-level keys", () => {
    const bundle = buildDiagnosticBundle(snapshot, {
      supportId: "SUP-ABC",
      generatedAt: 1710000000000,
      appVersion: "2.0.0",
      routeContext: "/projects/1",
    });

    expect(Object.keys(bundle).sort()).toEqual([
      "bundleMeta",
      "healthSummary",
      "integrityGraph",
      "migrationNotes",
      "paymentEvidence",
      "recentEvents",
      "recordInventory",
      "sourceSnapshots",
      "statusSnapshots",
    ].sort());
    expect(bundle.bundleMeta.supportId).toBe("SUP-ABC");
    expect(bundle.healthSummary.ok).toBe(true);
    expect(bundle.recordInventory.customers.ids).toEqual(["c1"]);
    expect(bundle.integrityGraph.customerToProjects).toEqual([{ customerId: "c1", projectIds: ["p1"] }]);
    expect(bundle.paymentEvidence.items[0]).toEqual(expect.objectContaining({ id: "i1", amountPaid: 20, balanceRemaining: 80 }));
    expect(bundle.statusSnapshots.projects[0]).toEqual(expect.objectContaining({ id: "p1", derivedStatus: "active" }));
  });

  test("redacts sensitive fields by default and preserves them when requested", () => {
    const redacted = redactDiagnosticSnapshot(snapshot);
    expect(redacted.companyProfile.email).toBe("[redacted]");
    expect(redacted.companyProfile.phone).toBe("[redacted]");
    expect(redacted.companyProfile.address).toBe("[redacted]");
    expect(redacted.companyProfile.notes).toBe("[redacted]");
    expect(redacted.customers[0].email).toBe("[redacted]");
    expect(redacted.projects[0].notes).toBe("[redacted]");

    const unredacted = redactDiagnosticSnapshot(snapshot, { includeSensitive: true });
    expect(unredacted.companyProfile.email).toBe("boss@example.com");
    expect(unredacted.companyProfile.phone).toBe("555-111-2222");
    expect(unredacted.companyProfile.address).toBe("123 Main St");
    expect(unredacted.projects[0].notes).toBe("internal");
  });

  test("includes health summary from data health", () => {
    const bundle = buildDiagnosticBundle({
      invoices: [{ id: "i1", invoiceTotal: 100, amountPaid: 50, balanceRemaining: 60, status: "paid" }],
    }, {
      supportId: "SUP-Z",
      generatedAt: 1710000000000,
    });

    expect(bundle.healthSummary.errors).toBeGreaterThan(0);
    expect(bundle.healthSummary.issueCount).toBeGreaterThan(0);
    expect(bundle.healthSummary.ok).toBe(false);
  });
});
