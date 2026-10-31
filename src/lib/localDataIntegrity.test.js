import {
  applySafeLocalDataRepairs,
  getCloudDataDecision,
  LOCAL_DATA_DECISION,
  scanLocalDataIntegrity,
} from "./localDataIntegrity";
import { CLOUD_BACKUP_REVIEW_ORIGIN } from "./cloudBackupQueue";

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

  test("detects estimate with a stale project link as repairable when other jobs still exist", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      estimates: [{ id: "est_1", projectId: "missing_project", customerId: "cust_1", estimateNumber: "EST-100", total: 100 }],
    }));

    expect(integrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_project_stale" }),
    ]));
    expect(integrity.blockers).toHaveLength(0);
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

  test("repair clears a stale estimate projectId without changing estimate totals or identifiers", () => {
    const snapshot = buildSnapshot({
      estimates: [{
        id: "est_1",
        projectId: "missing_project",
        customerId: "cust_1",
        estimateNumber: "EST-100",
        total: 250,
      }],
    });

    const repaired = applySafeLocalDataRepairs(snapshot);

    expect(repaired.changed).toBe(true);
    expect(repaired.repairs.staleEstimateProjectIds).toEqual([
      expect.objectContaining({ estimateId: "est_1", staleProjectId: "missing_project" }),
    ]);
    expect(repaired.snapshot.estimates[0]).toEqual(expect.objectContaining({
      id: "est_1",
      projectId: "",
      customerId: "cust_1",
      estimateNumber: "EST-100",
      total: 250,
    }));
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

  test("mismatch becomes a generic unresolved sync issue and cannot offer recovery actions", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123, lastVerifiedAt: 123 },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.restoreCloudAvailable).toBe(false);
    expect(decision.replaceCloudAvailable).toBe(false);
  });

  test("mismatch beats ordinary backup pending work", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "pending" },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
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

  test("cloud-only estimate rows remain internal mismatch evidence but expose only a generic sync issue", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      cloudVerification: buildCloudOnlyEstimateVerification(),
      queueState: { pending: true, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
    expect(decision.cloudOnlyRowsDetected).toBe(true);
    expect(decision.replaceCloudAvailable).toBe(false);
    expect(decision.restoreCloudAvailable).toBe(false);
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

  function buildGenericMismatchVerification() {
    // No tableResults/extraLegacyIds at all -- mirrors the writer's own
    // post-write verification notice ("Cloud verification found mismatches
    // between local and Supabase data") with no specific rows called out.
    return {
      ok: true,
      allMatched: false,
      notices: [{
        level: "warning",
        code: "cloud_verification_mismatch",
        message: "Cloud verification found mismatches between local and Supabase data.",
      }],
    };
  }

  test("generic cloud verification mismatch uses backup_failed with no Restore or Replace", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      cloudVerification: buildGenericMismatchVerification(),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "needs_attention" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.restoreCloudAvailable).toBe(false);
    expect(decision.replaceCloudAvailable).toBe(false);
  });

  test("generic cloud verification mismatch does not produce Cloud OK", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      cloudVerification: buildGenericMismatchVerification(),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123, lastVerifiedAt: 123 },
      onboardingStatus: { status: "needs_attention" },
    });

    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
    expect(decision.screenState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("a true local blocker still beats replace availability even with a generic verification mismatch", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
          { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
        ],
      })),
      cloudVerification: buildGenericMismatchVerification(),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "needs_attention" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP);
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

  test("safe repair alone stays out of global failure status and recovery actions", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
      })),
      queueState: { pending: false, status: "current" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.firstSafeRepair).toEqual(expect.objectContaining({ code: "invoice_project_stale" }));
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.screenState).not.toBe(LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP);
    expect(decision.restoreCloudAvailable).toBe(false);
    expect(decision.replaceCloudAvailable).toBe(false);
  });

  test.each(["failed", "needs_attention"])(
    "real queue status %s remains a generic backup failure when safe repair metadata exists",
    (status) => {
      const decision = getCloudDataDecision({
        localIntegrity: scanLocalDataIntegrity(buildSnapshot({
          invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
        })),
        queueState: { pending: false, status },
        onboardingStatus: { status: "already_backed_up" },
      });

      expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
      expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    }
  );

  test.each(["remote_changed", "conflict"])(
    "historical queue review status %s is diagnostic and not a global Backup issue",
    (status) => {
      const decision = getCloudDataDecision({
        localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
        queueState: { pending: true, status, lastVerifiedAt: 123, reviewOrigin: CLOUD_BACKUP_REVIEW_ORIGIN.LEGACY_HISTORICAL_REVIEW },
        onboardingStatus: { status: "needs_attention" },
      });
      expect(decision.queueRequiresReview).toBe(true);
      expect(decision.queueHistoricalReview).toBe(true);
      expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
      expect(decision.screenState).not.toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    }
  );

  test("a current ledger failure remains a generic Sync issue", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "conflict", reviewOrigin: CLOUD_BACKUP_REVIEW_ORIGIN.LEGACY_HISTORICAL_REVIEW },
      mutationLedger: { entries: [{ revision: 1, status: "needs_attention" }] },
      onboardingStatus: { status: "established_workspace" },
    });
    expect(decision.ledgerFailed).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });

  test("strictly verified ledger proof may show Cloud OK over stored historical review", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "conflict", reviewOrigin: CLOUD_BACKUP_REVIEW_ORIGIN.LEGACY_HISTORICAL_REVIEW },
      mutationLedger: { entries: [{ revision: 1, status: "acknowledged", verifiedAt: 456 }], lastVerifiedAt: 456 },
      onboardingStatus: { status: "local_cloud_mismatch" },
    });
    expect(decision.verifiedCurrent).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test.each(["pending", "retry_wait", "syncing"])("current ledger status %s has active status precedence", (status) => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "conflict", reviewOrigin: CLOUD_BACKUP_REVIEW_ORIGIN.LEGACY_HISTORICAL_REVIEW },
      mutationLedger: { entries: [{ revision: 1, status }] },
      onboardingStatus: { status: "established_workspace" },
    });
    expect(decision.chipState).toBe(status === "syncing" ? LOCAL_DATA_DECISION.BACKUP_RUNNING : LOCAL_DATA_DECISION.BACKUP_PENDING);
  });

  test.each(["conflict", "remote_changed"])("new current review status %s remains a real Sync issue", (status) => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: {
        pending: true,
        status,
        reviewOrigin: CLOUD_BACKUP_REVIEW_ORIGIN.CURRENT_SYNC_FAILURE,
        lastVerifiedAt: 123,
      },
      onboardingStatus: { status: "established_workspace" },
    });

    expect(decision.queueCurrentReview).toBe(true);
    expect(decision.queueUnresolved).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
    expect(decision.verifiedCurrent).toBe(false);
  });

  test("safe repair metadata preserves pending queue precedence", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
      })),
      queueState: { pending: true, status: "pending" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
  });

  test("safe repair metadata allows real clean-queue verification proof to show Cloud OK", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [{ id: "inv_1", projectId: "missing_project", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
      })),
      queueState: { pending: false, status: "current", lastVerifiedAt: 123 },
      onboardingStatus: { status: "established_workspace" },
    });

    expect(decision.verifiedCurrent).toBe(true);
    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("Pending still shows when the backup queue is pending and no blockers or repairs exist", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "current" },
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
  });

  test("an active worker beats ordinary pending work when no blocker or mismatch exists", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "pending" },
      onboardingStatus: { status: "already_backed_up" },
      workerRunning: true,
    });

    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_RUNNING);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_RUNNING);
  });

  test("restore available does not beat a real local blocker", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot({
        invoices: [
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
          { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100 },
        ],
      })),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "cloud_available_empty_device" },
      restorePreview: { eligible: true, partial: false },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });

  test("established workspace alone is neutral without queue verification proof", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123 },
      onboardingStatus: { status: "established_workspace" },
    });

    expect(decision.screenState).toBeNull();
    expect(decision.chipState).toBeNull();
    expect(decision.verifiedCurrent).toBe(false);
  });

  test("clean queue with existing verified-success proof shows Cloud OK", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: false, status: "current", lastSuccessfulBackupAt: 123, lastVerifiedAt: 123 },
      onboardingStatus: { status: "established_workspace" },
    });

    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("stale verified proof cannot override a newer pending local revision", () => {
    const decision = getCloudDataDecision({
      localIntegrity: scanLocalDataIntegrity(buildSnapshot()),
      queueState: { pending: true, status: "pending", localMutationRevision: 8, lastVerifiedAt: 123 },
      onboardingStatus: { status: "established_workspace" },
    });

    expect(decision.verifiedCurrent).toBe(false);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
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

describe("Gate 16D customerless project integrity", () => {
  test("a customerless project (customerId '') is valid and produces no blocker", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      customers: [{ id: "cust_1", name: "Acme" }],
      projects: [{ id: "proj_1", customerId: "", projectName: "Unassigned" }],
    }));
    expect((integrity.blockers || []).some((b) => String(b?.code || "") === "project_customer_missing")).toBe(false);
  });

  test("a nonempty missing project customer reference is still blocked", () => {
    const integrity = scanLocalDataIntegrity(buildSnapshot({
      customers: [{ id: "cust_1", name: "Acme" }],
      projects: [{ id: "proj_1", customerId: "cust_missing", projectName: "Dangling" }],
    }));
    expect((integrity.blockers || []).some((b) => String(b?.code || "") === "project_customer_missing")).toBe(true);
  });
});
