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

  test("detects invoice with stale projectId and classifies it as repairable, not a blocker", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
    }));

    expect(integrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invoice_project_stale" }),
    ]));
    expect(integrity.blockers).toHaveLength(0);
    expect(integrity.backupReadiness.blocked).toBe(false);
    expect(integrity.backupReadiness.canProceedAfterSafeRepair).toBe(true);
  });

  test("standalone invoice without projectId is not a blocker", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      invoices: [{ id: "inv_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
    }));

    expect(integrity.blockers).toHaveLength(0);
    expect(integrity.safeRepairs).toEqual([]);
  });

  test("valid invoice projectId is preserved and not flagged", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot());

    expect(integrity.blockers).toHaveLength(0);
    expect(integrity.safeRepairs).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ code: "invoice_project_stale" })])
    );
  });

  test("repair clears a stale invoice projectId without touching business values", () => {
    const snapshot = buildSnapshot({
      invoices: [{
        id: "inv_1",
        projectId: "missing_project",
        customerId: "cust_1",
        invoiceNumber: "INV-100",
        status: "sent",
        total: 250,
        invoiceTotal: 250,
        amountPaid: 100,
        balanceRemaining: 150,
        payments: [{ id: "pay_1", amount: 100 }],
      }],
    });

    const repaired = applySafeLocalDataRepairs(snapshot);

    expect(repaired.changed).toBe(true);
    expect(repaired.repairs.staleInvoiceProjectIds).toEqual([
      expect.objectContaining({ invoiceId: "inv_1", staleProjectId: "missing_project" }),
    ]);
    expect(repaired.snapshot.invoices[0]).toEqual(expect.objectContaining({
      id: "inv_1",
      projectId: "",
      invoiceNumber: "INV-100",
      status: "sent",
      total: 250,
      invoiceTotal: 250,
      amountPaid: 100,
      balanceRemaining: 150,
      payments: [{ id: "pay_1", amount: 100 }],
    }));

    const rescanned = scanLocalDataIntegrity(repaired.snapshot);
    expect(rescanned.blockers).toHaveLength(0);
    expect(rescanned.safeRepairs).toHaveLength(0);
  });

  test("repair preserves a valid invoice projectId untouched", () => {
    const snapshot = buildSnapshot();

    const repaired = applySafeLocalDataRepairs(snapshot);

    expect(repaired.snapshot.invoices[0].projectId).toBe("proj_1");
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
      invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "missing_estimate", sourceEstimateSnapshot: { estimateId: "missing_estimate", estimateNumber: "EST-1" }, total: 100, amountPaid: 0, balanceRemaining: 100 }],
    });
    const before = JSON.parse(JSON.stringify(snapshot));

    scanLocalDataIntegrity(snapshot);
    const repaired = applySafeLocalDataRepairs(snapshot);

    expect(snapshot).toEqual(before);
    expect(repaired.snapshot.invoices[0]).toEqual(expect.objectContaining({
      sourceEstimateId: "",
      sourceEstimateSnapshot: null,
      estimateNumber: "EST-1",
      projectId: "",
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

  function buildCloudOnlyEstimateVerification() {
    return {
      ok: true,
      allMatched: false,
      tableResults: [
        { table: "estimates", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_est_1"] },
        { table: "customers", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
        { table: "invoices", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
      ],
    };
  }

  test("cloud-only estimate rows do not show Cloud OK or Pending, and enable both restore and replace", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      cloudVerification: buildCloudOnlyEstimateVerification(),
      queueState: { pending: true, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
    expect(decision.cloudOnlyRowsDetected).toBe(true);
    expect(decision.replaceCloudAvailable).toBe(true);
    expect(decision.restoreCloudAvailable).toBe(true);
  });

  test("true local corruption still blocks the replace-cloud option even with cloud-only rows", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
          { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
        ],
      })),
      cloudVerification: buildCloudOnlyEstimateVerification(),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.cloudOnlyRowsDetected).toBe(true);
    expect(decision.replaceCloudAvailable).toBe(false);
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

  test("does not show Pending when a blocker exists, even if the backup queue is pending", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        estimates: [],
        invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", sourceEstimateId: "est_1", total: 100, amountPaid: 0, balanceRemaining: 100 }],
      })),
      queueState: { pending: true, status: "current" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });

  test("shows Backup issue when repairable metadata exists, even if the backup queue is pending", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
      })),
      queueState: { pending: true, status: "current" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });

  test("Pending still shows when the backup queue is pending and no blockers or repairs exist", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "current" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
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
