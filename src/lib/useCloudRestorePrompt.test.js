import { renderHook } from "@testing-library/react";
import useCloudRestorePrompt, { CLOUD_RESTORE_PROMPT_STATE } from "./useCloudRestorePrompt";

jest.mock("./useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./useCloudBackupStatus", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const useSupabaseAuth = require("./useSupabaseAuth").default;
const useSupabaseAccount = require("./useSupabaseAccount").default;
const useCloudBackupStatus = require("./useCloudBackupStatus").default;

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

beforeEach(() => {
  signInWithCompany();
  useCloudBackupStatus.mockReset();
  useCloudBackupStatus.mockReturnValue({
    queueState: { pending: false },
    onboardingStatus: { status: "cloud_available_empty_device" },
    restorePreview: { status: "eligible", eligible: true, partial: false, blockers: [] },
    restorePreviewLoading: false,
    decision: { screenState: null },
    refreshCloudStatus: jest.fn(),
  });
});

test("surfaces exact missing estimate payload count for an empty-device blocked restore", () => {
  useCloudBackupStatus.mockReturnValue({
    queueState: { pending: false },
    onboardingStatus: { status: "cloud_available_empty_device" },
    restorePreview: {
      status: "blocked_unsupported_shape",
      eligible: true,
      partial: true,
      blockers: [{
        code: "estimates_not_reconstructable",
        message: "Estimates cannot be safely restored yet.",
        details: { missingRestorePayloadCount: 2 },
      }],
    },
    restorePreviewLoading: false,
    decision: { screenState: null },
    refreshCloudStatus: jest.fn(),
  });

  const { result } = renderHook(() => useCloudRestorePrompt());

  expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE);
  expect(result.current.restoreAvailable).toBe(false);
  expect(result.current.missingEstimatePayloadCount).toBe(2);
  expect(result.current.restoreBlockedReason).toBe(
    "Estimates cannot be safely restored yet. 2 cloud estimates are missing restore payload data needed for a faithful restore."
  );
});

test("treats a chambered draft on an otherwise empty device as local work", () => {
  const { result } = renderHook(() => useCloudRestorePrompt({ hasChamberedDraft: true }));

  expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS);
});

test("suppresses restore prompt state while a cloud backup is pending", () => {
  useCloudBackupStatus.mockReturnValue({
    queueState: { pending: true },
    onboardingStatus: { status: "cloud_available_empty_device" },
    restorePreview: { status: "eligible", eligible: true, partial: false, blockers: [] },
    restorePreviewLoading: false,
    decision: { screenState: null },
    refreshCloudStatus: jest.fn(),
  });

  const { result } = renderHook(() => useCloudRestorePrompt());

  expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.LOCAL_PENDING_BACKUP);
});
