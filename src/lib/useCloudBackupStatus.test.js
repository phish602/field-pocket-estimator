import { act, renderHook, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import useCloudBackupStatus from "./useCloudBackupStatus";

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
