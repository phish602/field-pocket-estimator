import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CloudHomeRestorePrompt from "./CloudHomeRestorePrompt";
import useCloudRestorePrompt, { CLOUD_RESTORE_PROMPT_STATE } from "../lib/useCloudRestorePrompt";
import { executeSupabaseCloudRestore, CLOUD_RESTORE_STATUS } from "../lib/supabaseCloudRestore";

jest.mock("../lib/useCloudRestorePrompt", () => {
  const actual = jest.requireActual("../lib/useCloudRestorePrompt");
  return { ...actual, __esModule: true, default: jest.fn() };
});

jest.mock("../lib/supabaseCloudRestore", () => {
  const actual = jest.requireActual("../lib/supabaseCloudRestore");
  return { ...actual, executeSupabaseCloudRestore: jest.fn() };
});

function promptState(state, overrides = {}) {
  return {
    state,
    checking: false,
    isSupabaseReady: true,
    hasCompany: true,
    userEmail: "owner@example.com",
    user: { id: "user-1" },
    company: { id: "company-1", name: "BVW Contracting" },
    role: "owner",
    onboardingStatus: null,
    restorePreview: { fullyRestorable: true },
    restoreAvailable: true,
    restoreBlockedReason: "",
    missingEstimatePayloadCount: 0,
    partialLocalSnapshot: false,
    localFirstBlocker: null,
    localBlockersCount: 0,
    refreshCloudStatus: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  executeSupabaseCloudRestore.mockReset();
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED });
  useCloudRestorePrompt.mockReturnValue(promptState(CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE));
});

afterEach(cleanup);

test("fresh empty device retains one explicit Restore Cloud to This Device action", async () => {
  render(<CloudHomeRestorePrompt />);
  expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeInTheDocument();
  const rendered = document.body.textContent || "";
  ["Back Up This Device", "Back Up Now", "Retry Sync", "Migration", "data_mismatch", "Download Emergency Backup File", "Technical details"]
    .forEach((copy) => expect(rendered).not.toContain(copy));

  fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });
  await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user-1" },
    company: expect.objectContaining({ id: "company-1" }),
  }));
});

test.each([
  CLOUD_RESTORE_PROMPT_STATE.NEEDS_ATTENTION,
  CLOUD_RESTORE_PROMPT_STATE.LOCAL_PENDING_BACKUP,
  CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS,
])("established Home state %s exposes no backup, retry, or recovery console", (state) => {
  useCloudRestorePrompt.mockReturnValue(promptState(state));
  render(<CloudHomeRestorePrompt />);
  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
});

test("an incomplete fresh-device restore preview exposes no unsafe maintenance action", () => {
  useCloudRestorePrompt.mockReturnValue(promptState(CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE, {
    restoreAvailable: false,
    restorePreview: { fullyRestorable: false },
  }));
  render(<CloudHomeRestorePrompt />);
  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});
