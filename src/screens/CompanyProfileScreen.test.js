import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { readCloudBackupQueueState } from "../lib/cloudBackupQueue";
import { buildLocalStorageExportArtifact } from "../lib/localStorageExportArtifact";

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

// Reproduction of the confirmed Production failure: an imported BVW profile is
// on device, the user selects the correct AAS logo, clicks Save, and the save
// must only report success once the canonical localStorage key durably holds
// the exact new logo. Read-back verification is what closes the gap.
describe("CompanyProfileScreen verified local save (BVW -> AAS)", () => {
  const BVW_PROFILE = {
    companyName: "BVW Contracting Solutions",
    phone: "6025550147",
    email: "office@bvw.test",
    addressLine1: "100 Old Rd",
    addressLine2: "",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    logoDataUrl: "data:image/png;base64,BVW-OLD-LOGO",
  };
  const AAS_LOGO = "data:image/png;base64,AAS-PROPERTY-CARE-NEW-LOGO";

  let originalConfirm;
  let originalFileReader;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(BVW_PROFILE));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: true })),
    });
    originalFileReader = window.FileReader;
    window.FileReader = class {
      readAsDataURL() {
        this.result = AAS_LOGO;
        this.onload();
      }
    };
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    window.FileReader = originalFileReader;
    localStorage.clear();
  });

  async function selectAasBranding() {
    fireEvent.change(screen.getByDisplayValue("BVW Contracting Solutions"), {
      target: { value: "AAS Property Care" },
    });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File(["aas"], "aas-property-care.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(screen.getByAltText("Company logo preview")).toHaveAttribute("src", AAS_LOGO),
    );
  }

  test("save persists the exact new logo, the device backup reads it, and dirty clears only after verified persistence", async () => {
    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    try {
      await renderProfile();
      await selectAasBranding();

      // The selected logo makes the profile dirty before saving.
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(true));

      await save();

      // Canonical localStorage key holds the exact new logo and company name.
      const persisted = readProfile();
      expect(persisted.companyName).toBe("AAS Property Care");
      expect(persisted.logoDataUrl).toBe(AAS_LOGO);

      // The This-Device backup builder reads the new profile and logo.
      const artifact = buildLocalStorageExportArtifact(localStorage);
      const backupProfile = artifact.parsedData.migration.companyProfile.parsed;
      expect(backupProfile.companyName).toBe("AAS Property Care");
      expect(backupProfile.logoDataUrl).toBe(AAS_LOGO);

      // Cloud backup is queued only after the verified local save.
      expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
        pending: true,
        status: "pending",
        domains: expect.arrayContaining(["company_profile"]),
      }));

      // Success UI is shown and dirty clears only after verified persistence.
      expect(screen.getByText("Profile updated")).toBeInTheDocument();
      expect(screen.queryByText(/could not confirm/i)).not.toBeInTheDocument();
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(false));
    } finally {
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("a silent write that does not durably persist reports failure, keeps dirty state and the AAS preview, and does not queue cloud backup", async () => {
    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    // setItem returns without throwing but never persists the Company Profile,
    // so a read-back returns the old BVW payload -- the exact Production symptom.
    const originalSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      if (key === STORAGE_KEYS.COMPANY_PROFILE) return undefined;
      return originalSetItem.call(this, key, value);
    });

    try {
      await renderProfile();
      await selectAasBranding();
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(true));

      await save();

      // Save reports failure and shows no saved-success UI.
      expect(screen.getByText(/could not confirm/i)).toBeInTheDocument();
      expect(screen.queryByText("Profile updated")).not.toBeInTheDocument();

      // The canonical record and device backup remain the old BVW payload.
      expect(readProfile().companyName).toBe("BVW Contracting Solutions");
      expect(readProfile().logoDataUrl).toBe("data:image/png;base64,BVW-OLD-LOGO");

      // Dirty state remains true and the new AAS preview stays visible.
      expect(dirtyEvents.at(-1)).toBe(true);
      expect(screen.getByAltText("Company logo preview")).toHaveAttribute("src", AAS_LOGO);

      // No cloud backup was queued for the unverified payload.
      expect(readCloudBackupQueueState().pending).toBe(false);
    } finally {
      Storage.prototype.setItem.mockRestore();
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });
});
