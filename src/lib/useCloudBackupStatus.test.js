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
