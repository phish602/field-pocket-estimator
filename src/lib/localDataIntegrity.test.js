import {
  applySafeLocalDataRepairs,
  getCloudDataDecision,
  LOCAL_DATA_DECISION,
  scanLocalDataIntegrity,
} from "./localDataIntegrity";

function buildSnapshot(overrides = {}) {
  return {
    customers: [{ id: "cust_1", name: "Acme Co", email: "hello@example.com" }],
    projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
    estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100", total: 100 }],
    invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "est_1", estimateNumber: "EST-100", invoiceTotal: 100, total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
    scopeTemplates: [{ id: "tmpl_1", name: "Default" }],
    auditEvents: [{ id: "evt_1", type: "estimate.saved", createdAt: Date.now() }],
    ...overrides,
  };
}

describe("localDataIntegrity", () => {
  test("counts customers, projects, estimates, invoices, and payments", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      invoices: [{
        id: "inv_1",
        projectId: "proj_1",
        customerId: "cust_1",
        invoiceNumber: "INV-100",
        invoiceTotal: 100,
        total: 100,
        amountPaid: 25,
        balanceRemaining: 75,
        payments: [{ id: "pay_1", amount: 25 }],
      }],
    }));

    expect(integrity.summary).toEqual(expect.objectContaining({
      customers: 1,
      projects: 1,
      estimates: 1,
      invoices: 1,
      invoicePayments: 1,
    }));
  });

  test("detects missing estimate numbers as repairable metadata", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", total: 100 }],
    }));

    expect(integrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_number_missing" }),
    ]));
  });

  test("detects stale invoice sourceEstimateId as repairable when estimates still exist", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "missing_estimate", total: 100, amountPaid: 0, balanceRemaining: 100 }],
    }));

    expect(integrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invoice_source_estimate_stale" }),
    ]));
    expect(integrity.blockers).toHaveLength(0);
  });

  test("detects duplicate estimate numbers", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      estimates: [
        { id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
        { id: "est_2", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
      ],
    }));

    expect(integrity.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_estimate_number:EST-100" }),
    ]));
  });

  test("detects duplicate invoice numbers", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      invoices: [
        { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
        { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
      ],
    }));

    expect(integrity.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_invoice_number:INV-100" }),
    ]));
  });

  test("detects empty-estimates-with-invoices danger state", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      estimates: [],
      invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "est_1", total: 100, amountPaid: 0, balanceRemaining: 100 }],
    }));

    expect(integrity.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "empty_estimates_with_invoices" }),
    ]));
  });

  test("separates blockers, warnings, and repairable issues", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      customers: [{ id: "cust_1" }],
      estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1" }],
      invoices: [
        { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
        { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
      ],
    }));

    expect(integrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_number_missing" }),
    ]));
    expect(integrity.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "customer_identity_sparse" }),
    ]));
    expect(integrity.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_invoice_number:INV-100" }),
    ]));
  });

  test("does not mutate input data while scanning or repairing", () => {
    const snapshot = buildSnapshot({
      estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1" }],
      invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "missing_estimate", sourceEstimateSnapshot: { estimateId: "missing_estimate", estimateNumber: "EST-1" }, total: 100, amountPaid: 0, balanceRemaining: 100 }],
    });
    const before = JSON.parse(JSON.stringify(snapshot));

    scanLocalDataIntegrity(snapshot);
    const repaired = applySafeLocalDataRepairs(snapshot);

    expect(snapshot).toEqual(before);
    expect(repaired.snapshot.invoices[0]).toEqual(expect.objectContaining({
      sourceEstimateId: "",
      sourceEstimateSnapshot: null,
      estimateNumber: "EST-1",
    }));
  });

  test("mismatch beats last successful backup", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
  });

  test("concrete blocker beats Cloud OK", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        estimates: [],
        invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "est_1", total: 100, amountPaid: 0, balanceRemaining: 100 }],
      })),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA);
  });

  test("restore available does not beat backup issue", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1" }],
      })),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "cloud_available_empty_device" },
      restorePreview: { eligible: true, partial: false },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });

  test("verified current shows Cloud OK", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("empty local plus valid cloud recommends restore", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        customers: [],
        projects: [],
        estimates: [],
        invoices: [],
        scopeTemplates: [],
        auditEvents: [],
      })),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "cloud_available_empty_device" },
      restorePreview: { eligible: true, partial: false },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.SAFE_TO_RESTORE_EMPTY_DEVICE);
  });

  test("valid local and stale cloud recommends backup", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "ready_to_backup" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.SAFE_TO_BACKUP);
  });
});
