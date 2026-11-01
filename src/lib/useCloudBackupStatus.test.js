import { act, renderHook, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import useCloudBackupStatus, {
  CLOUD_PRODUCT_STATE,
  deriveCloudProductStatus,
  deriveLastSuccessfulSyncAt,
} from "./useCloudBackupStatus";

jest.mock("./useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./supabaseCloudOnboarding", () => ({
  __esModule: true,
  checkSupabaseCloudOnboardingStatus: jest.fn(),
}));

jest.mock("./supabaseCloudRestore", () => ({
  __esModule: true,
  previewSupabaseCloudRestore: jest.fn(),
  CLOUD_RESTORE_COMPLETE_EVENT: "estipaid:cloud-restore-complete",
  getLastCloudRestoreCompleteAt: jest.fn(() => null),
}));

const useSupabaseAuth = require("./useSupabaseAuth").default;
const useSupabaseAccount = require("./useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus } = require("./supabaseCloudOnboarding");
const { previewSupabaseCloudRestore } = require("./supabaseCloudRestore");

function signInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  useSupabaseAccount.mockReturnValue({
    company: { id: "company_1", name: "BVW Contracting Solutions" },
    role: "owner",
    hasCompany: true,
  });
}

function writePartialRecoveryStatus() {
  localStorage.setItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, JSON.stringify({
    recoveryMode: "partial_cloud_recovery",
    status: "finished_with_older_estimates_kept",
    skippedEstimateCount: 3,
    skippedEstimateIds: ["est_2", "est_3", "est_4"],
    skippedReason: "missing_full_estimate_details",
    recoveredAt: "2026-07-06T01:00:00.000Z",
    olderEstimatesKeptInCloud: true,
  }));
}

function mutationLedger(status, entityType = "invoice") {
  return {
    entries: [{
      mutationId: "mutation-1",
      revision: 1,
      companyId: "company_1",
      entityType,
      documentId: "invoice-1",
      operation: "upsert",
      payload: { id: "invoice-1" },
      status,
    }],
  };
}

describe("canonical cloud product status", () => {
  test.each([
    ["verified proof", { decision: { verifiedCurrent: true } }, CLOUD_PRODUCT_STATE.CLOUD_OK],
    ["connected without proof", { decision: {} }, CLOUD_PRODUCT_STATE.CLOUD_CONNECTED],
    ["current syncing", { decision: { ledgerSyncing: true } }, CLOUD_PRODUCT_STATE.SYNCING],
    ["current pending", { decision: { ledgerPending: true } }, CLOUD_PRODUCT_STATE.PENDING],
    ["current issue", { decision: { queueUnresolved: true, verifiedCurrent: true } }, CLOUD_PRODUCT_STATE.SYNC_ISSUE],
    ["fresh restore", { decision: { restoreAvailable: true } }, CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE],
  ])("maps %s to one canonical state", (_label, input, expected) => {
    expect(deriveCloudProductStatus({ connected: true, ...input }).state).toBe(expected);
  });

  test("current work outranks restore and verified proof", () => {
    expect(deriveCloudProductStatus({
      connected: true,
      decision: { ledgerPending: true, restoreAvailable: true, verifiedCurrent: true },
    }).state).toBe(CLOUD_PRODUCT_STATE.PENDING);
    expect(deriveCloudProductStatus({
      connected: true,
      decision: { queueUnresolved: true, ledgerPending: true, verifiedCurrent: true },
    }).state).toBe(CLOUD_PRODUCT_STATE.SYNC_ISSUE);
  });

  test("only worker-owned failures offer Retry Sync", () => {
    expect(deriveCloudProductStatus({
      connected: true,
      decision: { ledgerFailed: true },
      mutationLedger: mutationLedger("needs_attention"),
    }).retryAvailable).toBe(true);
    expect(deriveCloudProductStatus({
      connected: true,
      decision: { queueUnresolved: true },
      queueState: { pending: true, status: "conflict" },
    }).retryAvailable).toBe(false);
  });

  // "Last synced" has three legitimate owners: the first whole-workspace
  // bootstrap backup, a verified queue generation, and a verified targeted
  // mutation. After the ledger cutover routine sync only writes the last of
  // them, so reading the queue alone reported a months-old bootstrap date while
  // targeted syncs were succeeding the same day.
  const AUG_11 = Date.parse("2026-08-11T17:00:00.000Z");
  const AUG_25 = Date.parse("2026-08-25T17:00:00.000Z");
  const AUG_26 = Date.parse("2026-08-26T17:00:00.000Z");

  test.each([
    [
      "an acknowledged targeted mutation outranks both older queue clocks",
      { queueState: { lastSuccessfulBackupAt: AUG_11, lastVerifiedAt: AUG_11 }, ledgerVerifiedAt: AUG_26 },
      AUG_26,
    ],
    [
      "a newer bootstrap backup outranks an older ledger verification",
      { queueState: { lastSuccessfulBackupAt: AUG_26 }, ledgerVerifiedAt: AUG_25 },
      AUG_26,
    ],
    [
      "a verified queue generation counts as proof too",
      { queueState: { lastSuccessfulBackupAt: AUG_11, lastVerifiedAt: AUG_26 }, ledgerVerifiedAt: null },
      AUG_26,
    ],
    [
      "invalid clocks are not proof",
      { queueState: { lastSuccessfulBackupAt: 0, lastVerifiedAt: Number.NaN }, ledgerVerifiedAt: -1 },
      null,
    ],
    ["no proof at all reports no timestamp", { queueState: null, ledgerVerifiedAt: null }, null],
  ])("%s", (_label, input, expected) => {
    expect(deriveLastSuccessfulSyncAt(input)).toBe(expected);
  });

  test("the product status publishes the newest proof under one clock", () => {
    const status = deriveCloudProductStatus({
      connected: true,
      decision: { verifiedCurrent: true },
      queueState: { lastSuccessfulBackupAt: AUG_11, lastVerifiedAt: AUG_11 },
      mutationLedger: { entries: [], lastVerifiedAt: AUG_26 },
    });

    expect(status.state).toBe(CLOUD_PRODUCT_STATE.CLOUD_OK);
    expect(status.lastSuccessfulSyncAt).toBe(AUG_26);
    // The compatibility alias can never show a different clock.
    expect(status.lastSuccessfulBackupAt).toBe(status.lastSuccessfulSyncAt);
  });

  test("a pending or failed mutation never advances Last synced and never fabricates Cloud OK", () => {
    const failing = deriveCloudProductStatus({
      connected: true,
      decision: { ledgerFailed: true },
      queueState: { lastSuccessfulBackupAt: AUG_11 },
      mutationLedger: mutationLedger("needs_attention"),
    });
    expect(failing.state).toBe(CLOUD_PRODUCT_STATE.SYNC_ISSUE);
    expect(failing.lastSuccessfulSyncAt).toBe(AUG_11);

    const pending = deriveCloudProductStatus({
      connected: true,
      decision: { ledgerPending: true },
      queueState: { lastSuccessfulBackupAt: AUG_11 },
      mutationLedger: mutationLedger("pending"),
    });
    expect(pending.state).toBe(CLOUD_PRODUCT_STATE.PENDING);
    expect(pending.lastSuccessfulSyncAt).toBe(AUG_11);
  });

  test("a disconnected workspace reports no sync timestamp at all", () => {
    expect(deriveCloudProductStatus({ connected: false })).toEqual(expect.objectContaining({
      lastSuccessfulSyncAt: null,
      lastSuccessfulBackupAt: null,
    }));
  });

  test("a current estimate mutation failure remains a canonical Sync issue", () => {
    expect(deriveCloudProductStatus({
      connected: true,
      decision: { ledgerFailed: true },
      mutationLedger: mutationLedger("needs_attention", "estimate"),
    })).toEqual(expect.objectContaining({
      state: CLOUD_PRODUCT_STATE.SYNC_ISSUE,
      retryAvailable: true,
    }));
  });
});

beforeEach(() => {
  localStorage.clear();
  signInWithCompany();
  checkSupabaseCloudOnboardingStatus.mockReset();
  checkSupabaseCloudOnboardingStatus
    .mockResolvedValueOnce({ status: "local_cloud_mismatch" })
    .mockResolvedValueOnce({ status: "already_backed_up" });
  previewSupabaseCloudRestore.mockReset();
  previewSupabaseCloudRestore.mockResolvedValue({
    status: "eligible",
    eligible: true,
    partial: false,
    blockers: [],
    notices: [],
  });
});

test("refreshes cloud status when partial recovery status changes", async () => {
  const { result } = renderHook(() => useCloudBackupStatus());

  await waitFor(() => expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(1));
  expect(checkSupabaseCloudOnboardingStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({
      allowAutomaticSafeRepair: false,
      verifyEstablishedWorkspace: false,
    })
  );
  await waitFor(() => expect(result.current.onboardingStatus?.status).toBe("local_cloud_mismatch"));

  act(() => {
    writePartialRecoveryStatus();
    window.dispatchEvent(new CustomEvent("pe-localstorage", {
      detail: { key: STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS },
    }));
  });

  await waitFor(() => expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.onboardingStatus?.status).toBe("already_backed_up"));
});

test("surfaces automatic safe repair failure state from onboarding checks", async () => {
  checkSupabaseCloudOnboardingStatus.mockReset();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({
    status: "needs_attention",
    automaticSafeRepair: {
      attempted: true,
      failed: true,
      technicalDetail: "Safe repair can detach a stale project link on 2 estimates.",
    },
    preview: {
      integrity: {
        blockers: [],
        safeRepairs: [{ code: "estimate_project_stale" }],
        summary: { blockersCount: 0, warningsCount: 0, repairsAvailableCount: 1 },
        backupReadiness: {
          blocked: false,
          safe: false,
          canProceedAfterSafeRepair: true,
          firstBlocker: null,
        },
      },
    },
  });

  const { result } = renderHook(() => useCloudBackupStatus());

  await waitFor(() => expect(result.current.onboardingStatus?.automaticSafeRepair?.failed).toBe(true));
  expect(result.current.chipState).toBe("backup_failed");
});

describe("automatic convergence result wiring (Gate 16B)", () => {
  test("re-runs cloud verification when an automatic convergence result arrives", async () => {
    signInWithCompany();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "cloud_verified_current", verification: { ok: true, allMatched: true, notices: [] } });
    renderHook(() => useCloudBackupStatus());
    await waitFor(() => expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-result", { detail: { ok: true, status: "converged", code: "" } })); });
    await waitFor(() => expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(2));
  });

  test("exposes the safe convergence result so a failed automatic sync stays visible", async () => {
    signInWithCompany();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "cloud_verified_current", verification: { ok: true, allMatched: false, notices: [] } });
    const { result } = renderHook(() => useCloudBackupStatus());
    act(() => { window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-result", { detail: { ok: false, status: "rolled_back", code: "cloud_verification_failed" } })); });
    await waitFor(() => expect(result.current.convergenceResult).toEqual(expect.objectContaining({ ok: false, code: "cloud_verification_failed" })));
  });
});
