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

describe("shared automatic-operation ownership", () => {
  const cloudAvailableEmptyDevice = (overrides = {}) => ({
    queueState: { pending: false },
    onboardingStatus: {
      status: "cloud_available_empty_device",
      preview: { localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0 } },
    },
    restorePreview: { status: "eligible", eligible: true, partial: false, blockers: [] },
    restorePreviewLoading: false,
    decision: { screenState: null },
    refreshCloudStatus: jest.fn(),
    ...overrides,
  });

  // CASE 8: empty device, nothing pending, cloud has data -> recovery eligible
  // exactly as before.
  test("a clean empty device with cloud data still offers fresh-device recovery", () => {
    useCloudBackupStatus.mockReturnValue(cloudAvailableEmptyDevice());
    const { result } = renderHook(() => useCloudRestorePrompt());
    expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE);
  });

  // CASE 9 / DELETION-TO-EMPTY: the same empty device, but the user's deletion is
  // still queued. Pending local work outranks the empty core, so the prompt must
  // NOT offer or auto-start a fresh-device restore over that un-backed-up work.
  test("an empty core with pending local work is protected as backup work, never a restore offer", () => {
    useCloudBackupStatus.mockReturnValue(cloudAvailableEmptyDevice({
      queueState: { pending: true, localMutationRevision: 4 },
    }));

    const { result } = renderHook(() => useCloudRestorePrompt());

    expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.LOCAL_PENDING_BACKUP);
    expect(result.current.state).not.toBe(CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE);
  });

  // Pending work outranks every other classification, not just the empty-device one.
  test.each([
    ["cloud_available_empty_device"],
    ["local_cloud_mismatch"],
    ["needs_attention"],
    ["error"],
  ])("pending local work outranks the %s classification", (status) => {
    useCloudBackupStatus.mockReturnValue(cloudAvailableEmptyDevice({
      queueState: { pending: true, localMutationRevision: 2 },
      onboardingStatus: { status, preview: { localCounts: { customers: 1 } } },
    }));

    const { result } = renderHook(() => useCloudRestorePrompt());
    expect(result.current.state).toBe(CLOUD_RESTORE_PROMPT_STATE.LOCAL_PENDING_BACKUP);
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
