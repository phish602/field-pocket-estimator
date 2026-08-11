// Reproduction for the payment auto-sync state machine.
//
// Repro: cloud is OK, a manual payment is added, the payment marks a
// money-critical revision dirty -- and BEFORE that revision's own cloud write
// has had any chance to run, verification compares local (4 payments) against
// the still-old cloud (3 payments) and the app settles into external-divergence
// recovery ("Cloud changed elsewhere" / Data mismatch), while another surface
// simultaneously claimed "Cloud backup is up to date".
//
// A pending LOCAL revision must be classified as pending sync, not as the cloud
// having changed elsewhere. Genuine cloud-only divergence must still win.

import { getCloudDataDecision, LOCAL_DATA_DECISION } from "./localDataIntegrity";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
  readCloudBackupQueueState,
  applyCloudBackupResultToQueue,
  CLOUD_BACKUP_STATUS,
} from "./cloudBackupQueue";

const INVOICE_LEGACY_ID = "inv_mso82d79_wvdf4u";
const NEW_PAYMENT_LEGACY_ID = "pay_mso84xgo_k8m9f4";

const cleanLocalIntegrity = { blockers: [], safeRepairs: [], summary: {} };

// Verification as it looks the instant after the payment is saved: every table
// matches except invoice_payments, where the cloud is MISSING the new payment.
// Nothing is cloud-only.
function localAheadVerification() {
  return {
    ok: true,
    allMatched: false,
    tableResults: [
      { table: "invoices", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
      {
        table: "invoice_payments",
        status: "mismatch",
        localCount: 4,
        cloudCount: 3,
        missingLegacyIds: [NEW_PAYMENT_LEGACY_ID],
        extraLegacyIds: [],
      },
    ],
  };
}

// Genuine external divergence: the cloud holds a payment this device does not.
function cloudOnlyVerification() {
  return {
    ok: true,
    allMatched: false,
    tableResults: [
      { table: "invoices", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
      {
        table: "invoice_payments",
        status: "mismatch",
        missingLegacyIds: [],
        extraLegacyIds: ["pay_from_another_device"],
      },
    ],
  };
}

function markPaymentDirty() {
  return markCloudBackupDirty({
    reason: "invoice_data_saved",
    domains: ["invoices", "invoice_payments"],
    severity: "money_critical",
    source: "writeStoredInvoices",
    documentId: INVOICE_LEGACY_ID,
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("a pending local payment revision is not external divergence", () => {
  test("the new payment's own queued revision keeps the app in pending sync, not Data mismatch", () => {
    const queueState = markPaymentDirty();
    expect(queueState.pending).toBe(true);
    expect(queueState.severity).toBe("money_critical");

    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: localAheadVerification(),
      queueState,
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    // The core fix: this is the expected local-ahead state.
    expect(decision.pendingLocalAheadOnly).toBe(true);
    expect(decision.mismatch).toBe(false);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
    expect(decision.screenState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);

    // And it must NOT offer the destructive recovery choices for a difference
    // this device is about to resolve by itself.
    expect(decision.replaceCloudAvailable).toBe(false);
    expect(decision.restoreCloudAvailable).toBe(false);
  });

  test("the app never reports the cloud current while the payment revision is pending", () => {
    const queueState = markPaymentDirty();
    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: localAheadVerification(),
      queueState,
      onboardingStatus: { status: "already_backed_up" },
    });

    expect(decision.verifiedCurrent).toBe(false);
    expect(decision.chipState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
    expect(decision.screenState).not.toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("a superseded generation never stamps a successful backup while a newer revision is pending", () => {
    // Generation 1 (the invoice) is uploaded...
    const firstGeneration = markCloudBackupDirty({ reason: "invoice_data_saved", severity: "money_critical" }).localMutationRevision;
    // ...and the payment lands while that upload is still in flight.
    const paymentQueue = markPaymentDirty();
    expect(paymentQueue.localMutationRevision).toBe(firstGeneration + 1);

    // The older generation completes successfully.
    const { state } = applyCloudBackupResultToQueue({ status: "backup_completed" }, { queueGeneration: firstGeneration });

    // The newer payment revision is still unsynced, so nothing may claim success.
    expect(state.pending).toBe(true);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.PENDING);
    expect(state.lastSuccessfulBackupAt).toBeFalsy();
    expect(state.lastVerifiedAt).toBeFalsy();
    expect(state.localMutationRevision).toBe(firstGeneration + 1);

    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: localAheadVerification(),
      queueState: state,
      onboardingStatus: { status: "already_backed_up" },
    });
    expect(decision.lastSuccessfulBackupAt).toBeFalsy();
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_PENDING);
  });

  test("the queue is acknowledged only after the matching revision actually completes", () => {
    const queueState = markPaymentDirty();
    const revision = queueState.localMutationRevision;

    const { state } = applyCloudBackupResultToQueue({ status: "backup_completed" }, { queueGeneration: revision });
    expect(state.pending).toBe(false);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.CLEAN);
    expect(state.lastSuccessfulBackupAt).toBeTruthy();

    // Once the write really landed, verification matches and the app is current.
    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: {
        ok: true,
        allMatched: true,
        tableResults: [
          { table: "invoices", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
          { table: "invoice_payments", status: "matched", localCount: 4, cloudCount: 4, missingLegacyIds: [], extraLegacyIds: [] },
        ],
      },
      queueState: state,
      onboardingStatus: { status: "already_backed_up" },
    });
    expect(decision.mismatch).toBe(false);
    expect(decision.verifiedCurrent).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT);
  });

  test("re-evaluating the same settled state is idempotent", () => {
    const queueState = markPaymentDirty();
    const first = getCloudDataDecision({ localIntegrity: cleanLocalIntegrity, cloudVerification: localAheadVerification(), queueState });
    const second = getCloudDataDecision({ localIntegrity: cleanLocalIntegrity, cloudVerification: localAheadVerification(), queueState });
    expect(second.chipState).toBe(first.chipState);
    expect(second.mismatch).toBe(first.mismatch);
    expect(readCloudBackupQueueState().localMutationRevision).toBe(queueState.localMutationRevision);
  });
});

describe("genuine external divergence is still reported", () => {
  test("a cloud-only payment is a real mismatch even while a local revision is pending", () => {
    const queueState = markPaymentDirty();

    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: cloudOnlyVerification(),
      queueState,
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    expect(decision.pendingLocalAheadOnly).toBe(false);
    expect(decision.mismatch).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
    expect(decision.restoreCloudAvailable).toBe(true);
  });

  test("a mismatch with NO pending queue is still a real mismatch", () => {
    clearCloudBackupDirty("backup_verified");
    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: localAheadVerification(),
      queueState: readCloudBackupQueueState(),
      onboardingStatus: { status: "local_cloud_mismatch" },
    });

    // Nothing pending can explain the difference -> genuine divergence.
    expect(decision.pendingLocalAheadOnly).toBe(false);
    expect(decision.mismatch).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
  });

  test("a queue in review state is never explained away by a pending local write", () => {
    const queueState = { ...markPaymentDirty(), status: "remote_changed" };
    const decision = getCloudDataDecision({
      localIntegrity: cleanLocalIntegrity,
      cloudVerification: localAheadVerification(),
      queueState,
    });
    expect(decision.queueRequiresReview).toBe(true);
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH);
  });

  test("a local blocker still outranks a pending local write", () => {
    const decision = getCloudDataDecision({
      localIntegrity: { blockers: [{ code: "empty_estimates_with_invoices" }], safeRepairs: [], summary: {} },
      cloudVerification: localAheadVerification(),
      queueState: markPaymentDirty(),
    });
    expect(decision.chipState).toBe(LOCAL_DATA_DECISION.BACKUP_FAILED);
  });
});
