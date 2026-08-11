import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { readCloudBackupQueueState } from "../lib/cloudBackupQueue";
import { buildLocalStorageExportArtifact } from "../lib/localStorageExportArtifact";

jest.mock("../lib/BusinessMutationGuardContext", () => ({
  useBusinessMutationGuard: jest.fn(),
}));

// Keep the real limit constants; control only the async optimizer. The default
// implementation is a passthrough (returns the input data URL unchanged), which
// mirrors an already-small logo so existing upload tests behave as before. jsdom
// cannot decode images, so the real canvas optimizer must always be mocked here.
jest.mock("../lib/companyLogoCompression", () => {
  const actual = jest.requireActual("../lib/companyLogoCompression");
  return {
    ...actual,
    optimizeCompanyLogo: jest.fn(async (input) => {
      const dataUrl = typeof input === "string"
        ? input
        : await new Promise((resolve) => {
            try {
              const FileReaderCtor = (global.window && global.window.FileReader) || global.FileReader;
              const reader = new FileReaderCtor();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => resolve("");
              reader.readAsDataURL(input);
            } catch {
              resolve("");
            }
          });
      return {
        ok: Boolean(dataUrl),
        dataUrl,
        originalCharacters: dataUrl.length,
        optimizedCharacters: dataUrl.length,
        width: 0,
        height: 0,
        mimeType: "image/png",
        wasCompressed: false,
        error: dataUrl ? "" : "EstiPaid could not optimize this logo. Choose a smaller PNG, JPEG, or WebP image.",
      };
    }),
  };
});

const { useBusinessMutationGuard } = require("../lib/BusinessMutationGuardContext");
const { optimizeCompanyLogo } = require("../lib/companyLogoCompression");

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
    await Promise.resolve();
  });
}

describe("CompanyProfileScreen authoritative readiness hydration", () => {
  beforeEach(() => {
    localStorage.clear();
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: true })),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  test("hydrates the existing profile when authoritative storage becomes readable without writing or becoming dirty", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(SAVED_PROFILE));
    const profileWrites = jest.spyOn(Storage.prototype, "setItem");
    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    try {
      const view = render(<CompanyProfileScreen authoritativeStorageReady={false} />);
      expect(screen.getByPlaceholderText("Example: Desert Ridge HOA")).toHaveValue("");

      view.rerender(<CompanyProfileScreen authoritativeStorageReady />);

      await waitFor(() => {
        expect(screen.getByDisplayValue("Desert Ridge")).toBeInTheDocument();
      });
      expect(profileWrites.mock.calls.filter(([key]) => key === STORAGE_KEYS.COMPANY_PROFILE)).toHaveLength(0);
      expect(dirtyEvents).not.toContain(true);
    } finally {
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("keeps normal profile hydration unchanged when authoritative storage is ready at mount", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(SAVED_PROFILE));
    const profileWrites = jest.spyOn(Storage.prototype, "setItem");

    render(<CompanyProfileScreen authoritativeStorageReady />);

    expect(await screen.findByDisplayValue("Desert Ridge")).toBeInTheDocument();
    expect(profileWrites.mock.calls.filter(([key]) => key === STORAGE_KEYS.COMPANY_PROFILE)).toHaveLength(0);
  });

  test("does not overwrite form edits made before a late readiness transition", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(SAVED_PROFILE));
    const view = render(<CompanyProfileScreen authoritativeStorageReady={false} />);

    fireEvent.change(screen.getByPlaceholderText("Example: Desert Ridge HOA"), {
      target: { value: "Unsaved Local Edit" },
    });
    view.rerender(<CompanyProfileScreen authoritativeStorageReady />);

    expect(screen.getByDisplayValue("Unsaved Local Edit")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Desert Ridge")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual(SAVED_PROFILE);
  });

  test("missing required fields show actionable feedback without reaching persistence", async () => {
    const mutationGuard = jest.fn(async () => ({ ok: true }));
    useBusinessMutationGuard.mockReturnValue({ ensureCanMutateBusinessData: mutationGuard });
    const profileWrites = jest.spyOn(Storage.prototype, "setItem");

    render(<CompanyProfileScreen authoritativeStorageReady />);
    await save();

    expect(screen.getByRole("alert")).toHaveTextContent("Missing required information");
    expect(screen.getByRole("alert")).toHaveTextContent("Company Name");
    expect(screen.getByRole("alert")).toHaveTextContent("Phone");
    expect(screen.getAllByText("This field is required.")).toHaveLength(6);
    expect(mutationGuard).not.toHaveBeenCalled();
    expect(profileWrites.mock.calls.filter(([key]) => key === STORAGE_KEYS.COMPANY_PROFILE)).toHaveLength(0);
  });
});

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
    optimizeCompanyLogo.mockResolvedValueOnce({
      ok: true,
      dataUrl: "data:image/png;base64,replacement-logo",
      originalCharacters: 40,
      optimizedCharacters: 40,
      width: 128,
      height: 128,
      mimeType: "image/png",
      wasCompressed: false,
      error: "",
    });

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
      expect(screen.getByRole("alert")).toHaveTextContent("Save canceled. Your Company Profile changes were not written.");
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

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(BVW_PROFILE));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: true })),
    });
    // The AAS logo is already small, so the optimizer returns it unchanged.
    optimizeCompanyLogo.mockResolvedValue({
      ok: true,
      dataUrl: AAS_LOGO,
      originalCharacters: AAS_LOGO.length,
      optimizedCharacters: AAS_LOGO.length,
      width: 256,
      height: 256,
      mimeType: "image/png",
      wasCompressed: false,
      error: "",
    });
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    optimizeCompanyLogo.mockReset();
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

// Logo compression is what makes the verified save reachable when the stored
// logo is oversized. These scenarios exercise the four required behaviors.
describe("CompanyProfileScreen logo compression", () => {
  const FULL_BVW = {
    companyName: "BVW Contracting Solutions",
    phone: "6025550147",
    email: "office@bvw.test",
    addressLine1: "100 Old Rd",
    addressLine2: "",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    logoDataUrl: "",
  };
  const OVERSIZED_LOGO = "data:image/png;base64," + "A".repeat(300000);
  const OPTIMIZED_LOGO = "data:image/webp;base64," + "B".repeat(1200);

  let originalConfirm;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(FULL_BVW));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn(async () => ({ ok: true })),
    });
    optimizeCompanyLogo.mockClear();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    optimizeCompanyLogo.mockClear();
    localStorage.clear();
  });

  test("A: a new oversized upload is optimized, previewed, and saved as the optimized logo (device backup reads it)", async () => {
    optimizeCompanyLogo.mockResolvedValueOnce({
      ok: true,
      dataUrl: OPTIMIZED_LOGO,
      originalCharacters: 400000,
      optimizedCharacters: OPTIMIZED_LOGO.length,
      width: 768,
      height: 600,
      mimeType: "image/webp",
      wasCompressed: true,
      error: "",
    });

    await renderProfile();
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File(["aas"], "aas-property-care.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(screen.getByAltText("Company logo preview")).toHaveAttribute("src", OPTIMIZED_LOGO),
    );
    expect(screen.getByText("Logo optimized for storage.")).toBeInTheDocument();

    // The optimized logo is already under target, so Save must NOT recompress it
    // (Scenario D: an already-small logo is left untouched).
    optimizeCompanyLogo.mockClear();
    await save();
    expect(optimizeCompanyLogo).not.toHaveBeenCalled();

    expect(readProfile().logoDataUrl).toBe(OPTIMIZED_LOGO);
    const artifact = buildLocalStorageExportArtifact(localStorage);
    expect(artifact.parsedData.migration.companyProfile.parsed.logoDataUrl).toBe(OPTIMIZED_LOGO);
  });

  test("B: an existing oversized logo is optimized during a company-name-only Save", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ ...FULL_BVW, logoDataUrl: OVERSIZED_LOGO }));
    optimizeCompanyLogo.mockResolvedValueOnce({
      ok: true,
      dataUrl: OPTIMIZED_LOGO,
      originalCharacters: OVERSIZED_LOGO.length,
      optimizedCharacters: OPTIMIZED_LOGO.length,
      width: 768,
      height: 600,
      mimeType: "image/webp",
      wasCompressed: true,
      error: "",
    });

    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    try {
      await renderProfile();
      fireEvent.change(screen.getByDisplayValue("BVW Contracting Solutions"), {
        target: { value: "AAS Property Care" },
      });
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(true));

      await save();

      // The existing oversized logo was optimized before persistence.
      expect(optimizeCompanyLogo).toHaveBeenCalledWith(OVERSIZED_LOGO);
      const persisted = readProfile();
      expect(persisted.companyName).toBe("AAS Property Care");
      expect(persisted.logoDataUrl).toBe(OPTIMIZED_LOGO);
      expect(persisted.logoDataUrl.length).toBeLessThanOrEqual(350000);

      // Dirty clears only after the verified read-back of the optimized profile.
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(false));
      expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
    } finally {
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("C: a compression failure blocks the save, keeps dirty state and values, and shows an error", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ ...FULL_BVW, logoDataUrl: OVERSIZED_LOGO }));
    optimizeCompanyLogo.mockResolvedValueOnce({
      ok: false,
      dataUrl: "",
      originalCharacters: OVERSIZED_LOGO.length,
      optimizedCharacters: 0,
      width: 0,
      height: 0,
      mimeType: "",
      wasCompressed: false,
      error: "EstiPaid could not optimize the saved logo. Choose a smaller PNG, JPEG, or WebP image.",
    });

    const dirtyEvents = [];
    const onDirty = (event) => dirtyEvents.push(Boolean(event?.detail?.dirty));
    window.addEventListener("estipaid:user-profile-dirty", onDirty);

    try {
      await renderProfile();
      fireEvent.change(screen.getByDisplayValue("BVW Contracting Solutions"), {
        target: { value: "AAS Property Care" },
      });
      await waitFor(() => expect(dirtyEvents.at(-1)).toBe(true));

      await save();

      // No localStorage write and no cloud queue for the failed payload.
      expect(readProfile().companyName).toBe("BVW Contracting Solutions");
      expect(readProfile().logoDataUrl).toBe(OVERSIZED_LOGO);
      expect(readCloudBackupQueueState().pending).toBe(false);

      // Form remains dirty; edited value and existing logo remain visible.
      expect(dirtyEvents.at(-1)).toBe(true);
      expect(screen.getByDisplayValue("AAS Property Care")).toBeInTheDocument();
      expect(screen.getByAltText("Company logo preview")).toHaveAttribute("src", OVERSIZED_LOGO);

      // A real error is shown; no saved-success.
      expect(screen.getByText(/could not optimize the saved logo/i)).toBeInTheDocument();
      expect(screen.queryByText("Profile updated")).not.toBeInTheDocument();
    } finally {
      window.removeEventListener("estipaid:user-profile-dirty", onDirty);
    }
  });

  test("D: an already-small logo is not recompressed during Save", async () => {
    const smallLogo = "data:image/png;base64," + "C".repeat(500);
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ ...FULL_BVW, logoDataUrl: smallLogo }));

    await renderProfile();
    fireEvent.change(screen.getByDisplayValue("BVW Contracting Solutions"), {
      target: { value: "AAS Property Care" },
    });
    await save();

    // The small logo never went through the optimizer, and its bytes are intact.
    expect(optimizeCompanyLogo).not.toHaveBeenCalled();
    expect(readProfile().logoDataUrl).toBe(smallLogo);
    expect(readProfile().companyName).toBe("AAS Property Care");
  });
});
