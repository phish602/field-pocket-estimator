import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { readCloudBackupQueueState } from "../lib/cloudBackupQueue";

jest.mock("../lib/BusinessMutationGuardContext", () => ({
  useBusinessMutationGuard: jest.fn(),
}));

const { useBusinessMutationGuard } = require("../lib/BusinessMutationGuardContext");

const SAVED_PROFILE = {
  companyName: "Desert Ridge",
  phone: "6025550147",
  email: "office@desertridge.test",
  addressLine1: "123 Main St",
  addressLine2: "",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
  logoDataUrl: "data:image/png;base64,old-logo",
};

function readProfile() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE) || "{}");
}

async function renderProfile() {
  await act(async () => {
    render(<CompanyProfileScreen />);
  });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await Promise.resolve();
  });
}

describe("CompanyProfileScreen explicit save", () => {
  let originalConfirm;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(SAVED_PROFILE));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: true })),
    });
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    localStorage.clear();
  });

  test("confirmed overwrite persists the normalized profile and replacement logo, clears dirty state, and queues cloud backup", async () => {
    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);
    const OriginalFileReader = window.FileReader;
    window.FileReader = class {
      readAsDataURL() {
        this.result = "data:image/png;base64,replacement-logo";
        this.onload();
      }
    };

    try {
      await renderProfile();
      fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: " Desert Ridge Updated " } });
      fireEvent.change(document.querySelector('input[type="file"]'), {
        target: { files: [new File(["replacement"], "replacement.png", { type: "image/png" })] },
      });
      await waitFor(() => expect(screen.getByAltText("Company logo preview")).toHaveAttribute("src", "data:image/png;base64,replacement-logo"));
      const beforeSaveUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeSaveUnload);
      expect(beforeSaveUnload.defaultPrevented).toBe(true);

      await save();

      expect(window.confirm).toHaveBeenCalledWith("Overwrite saved Company Profile?");
      expect(readProfile()).toEqual(expect.objectContaining({
        companyName: " Desert Ridge Updated ",
        logoDataUrl: "data:image/png;base64,replacement-logo",
        address: "123 Main St\nPhoenix, AZ 85001",
      }));
      expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
        pending: true,
        status: "pending",
        domains: expect.arrayContaining(["company_profile"]),
      }));
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(false));
      const afterSaveUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(afterSaveUnload);
      expect(afterSaveUnload.defaultPrevented).toBe(false);
      expect(screen.queryByText(/Save failed/i)).not.toBeInTheDocument();
    } finally {
      window.FileReader = OriginalFileReader;
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("canceling overwrite preserves the edited dirty state and does not persist", async () => {
    window.confirm = jest.fn(() => false);
    const events = [];
    const onDirty = (event) => events.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    try {
      await renderProfile();
      fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Unsaved Ridge" } });
      await waitFor(() => expect(events.at(-1)).toBe(true));
      await save();

      expect(readProfile().companyName).toBe("Desert Ridge");
      expect(readCloudBackupQueueState().pending).toBe(false);
      expect(events.at(-1)).toBe(true);
    } finally {
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("mutation-guard denial preserves edits and shows a persistent failure", async () => {
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: false, userMessage: "Save stopped on this device." })),
    });
    await renderProfile();
    fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Blocked Ridge" } });
    await save();

    expect(readProfile().companyName).toBe("Desert Ridge");
    expect(screen.getByText("Save stopped on this device.")).toBeInTheDocument();
    expect(readCloudBackupQueueState().pending).toBe(false);
  });

  test("localStorage failure keeps the profile dirty and does not show a save success", async () => {
    const originalSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      if (key === STORAGE_KEYS.COMPANY_PROFILE) throw new Error("quota exceeded");
      return originalSetItem.call(this, key, value);
    });

    try {
      await renderProfile();
      fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Unsaved Ridge" } });
      await save();

      expect(readProfile().companyName).toBe("Desert Ridge");
      expect(screen.getByText("Unable to save this Company Profile on this device.")).toBeInTheDocument();
      expect(screen.queryByText("Profile updated")).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem.mockRestore();
    }
  });

  test("removing a logo persists an empty logoDataUrl without resurrecting the old logo", async () => {
    await renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await save();

    expect(readProfile().logoDataUrl).toBe("");
    expect(screen.queryByAltText("Company logo preview")).not.toBeInTheDocument();
  });
});
