import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { readCloudBackupQueueState } from "./lib/cloudBackupQueue";

const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const CUSTOMER_SEARCH_PLACEHOLDER = "Search or select a customer…";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function buildLiveDraft({ docType = "estimate", customerName, projectName, docNumber, scopeNotes, scopeImages = [] }) {
  return {
    ui: {
      docType,
      materialsMode: docType === "invoice" ? "blanket" : "itemized",
    },
    customer: {
      name: customerName,
      projectName,
      projectNumber: docNumber,
    },
    job: {
      docNumber,
      date: "2026-07-01",
      location: "123 Draft Way",
    },
    scopeNotes,
    scopeImages,
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [],
    },
    materials: {
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: 0,
      items: [],
    },
    additionalCharges: {
      items: [],
    },
  };
}

function buildSavedEstimate({ id, customerName, projectName, docNumber, updatedAt }) {
  return {
    id,
    docType: "estimate",
    status: "pending",
    customerName,
    projectName,
    estimateNumber: docNumber,
    customer: {
      name: customerName,
      projectName,
      projectNumber: docNumber,
    },
    job: {
      docNumber,
      location: "999 Saved Estimate Rd",
    },
    scopeNotes: "Saved estimate scope",
    updatedAt,
    savedAt: updatedAt,
    createdAt: updatedAt - 1000,
  };
}

function buildSavedInvoice({ id, customerName, projectName, docNumber, updatedAt }) {
  return {
    id,
    docType: "invoice",
    status: "sent",
    paymentStatus: "unpaid",
    customerName,
    projectName,
    invoiceNumber: docNumber,
    invoiceTotal: 500,
    total: 500,
    amountPaid: 0,
    balanceRemaining: 500,
    customer: {
      name: customerName,
      projectName,
      projectNumber: docNumber,
    },
    job: {
      docNumber,
      location: "999 Saved Invoice Rd",
    },
    updatedAt,
    savedAt: updatedAt,
    createdAt: updatedAt - 1000,
  };
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  seedCompanyProfile();
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([]));
});

test("Home Resume Draft opens the live estimate draft instead of the newest saved estimate", async () => {
  const liveDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "Draft Estimate Customer",
    projectName: "Draft Estimate Project",
    docNumber: "DRAFT-EST-1",
    scopeNotes: "Draft estimate scope",
  });

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(liveDraft));
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATES,
    JSON.stringify([
      buildSavedEstimate({
        id: "saved-estimate-newer",
        customerName: "Saved Estimate Customer",
        projectName: "Saved Estimate Project",
        docNumber: "SAVED-EST-9",
        updatedAt: Date.now() + 5000,
      }),
    ])
  );
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));

  render(<App />);

  expect(screen.getByRole("button", { name: /Resume Draft/i })).toBeInTheDocument();
  expect(screen.queryByText(/Describe the Job/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Resume Draft/i }));

  expect(await screen.findByText("Estimate Builder")).toBeInTheDocument();
  expect(screen.queryByText("EDIT ESTIMATE")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Draft Estimate Customer");
  });
  expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
});

test("opening and leaving an existing invoice preserves an unrelated chambered estimate draft", async () => {
  const liveDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "Chamber Draft Customer",
    projectName: "Chamber Draft Project",
    docNumber: "CHAMBER-EST-1",
    scopeNotes: "Resume this estimate after reviewing invoices.",
  });
  const draftRaw = JSON.stringify(liveDraft);

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(
    STORAGE_KEYS.INVOICES,
    JSON.stringify([
      buildSavedInvoice({
        id: "saved-invoice-open",
        customerName: "Saved Invoice Customer",
        projectName: "Saved Invoice Project",
        docNumber: "SAVED-INV-OPEN",
        updatedAt: Date.now(),
      }),
    ])
  );

  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

  render(<App />);

  fireEvent.click(screen.getByLabelText("Invoices"));
  fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

  expect(await screen.findByText("EDIT INVOICE")).toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");

  fireEvent.click(screen.getByRole("button", { name: /cancel edit/i }));

  await waitFor(() => {
    expect(screen.queryByText("EDIT INVOICE")).not.toBeInTheDocument();
  });

  fireEvent.click(screen.getByLabelText("Home"));
  expect(await screen.findByRole("button", { name: /Resume Draft/i })).toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");

  confirmSpy.mockRestore();
});

test("opening and leaving an existing estimate preserves the chambered create draft", async () => {
  const chamberDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "Chamber Draft Customer",
    projectName: "Chamber Draft Project",
    docNumber: "CHAMBER-EST-2",
    scopeNotes: "Resume this estimate after reviewing another saved estimate.",
  });
  const draftRaw = JSON.stringify(chamberDraft);

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATES,
    JSON.stringify([
      buildSavedEstimate({
        id: "saved-estimate-open-2",
        customerName: "Saved Other Estimate Customer",
        projectName: "Saved Other Estimate Project",
        docNumber: "SAVED-EST-OTHER",
        updatedAt: Date.now(),
      }),
    ])
  );

  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

  render(<App />);

  fireEvent.click(screen.getByLabelText("Estimates"));

  fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

  expect(await screen.findByText("EDIT ESTIMATE")).toBeInTheDocument();
  // ESTIMATE_DRAFT and RESTORE_DRAFT_ON_CREATE must be untouched during an edit session
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");

  fireEvent.click(screen.getByRole("button", { name: /cancel edit/i }));

  await waitFor(() => {
    expect(screen.queryByText("EDIT ESTIMATE")).not.toBeInTheDocument();
  });

  // After cancel, the stash restores ESTIMATOR_STATE back to the chamber draft
  fireEvent.click(screen.getByLabelText("Home"));
  expect(await screen.findByRole("button", { name: /Resume Draft/i })).toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");

  confirmSpy.mockRestore();
});

test("opening existing invoice does not show Continue Estimate blocker when estimate draft is chambered", async () => {
  const chamberDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "Blocker Test Customer",
    projectName: "Blocker Test Project",
    docNumber: "BLOCKER-EST-1",
    scopeNotes: "This draft should not trigger a type-switch guard.",
  });
  const draftRaw = JSON.stringify(chamberDraft);

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(
    STORAGE_KEYS.INVOICES,
    JSON.stringify([
      buildSavedInvoice({
        id: "saved-invoice-blocker-test",
        customerName: "Invoice Blocker Customer",
        projectName: "Invoice Blocker Project",
        docNumber: "INV-BLOCKER-1",
        updatedAt: Date.now(),
      }),
    ])
  );

  render(<App />);

  fireEvent.click(screen.getByLabelText("Invoices"));
  fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

  // Must go directly to EDIT INVOICE without showing the type-switch guard
  expect(await screen.findByText("EDIT INVOICE")).toBeInTheDocument();
  expect(screen.queryByText(/Continue Estimate/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Start Blank Invoice/i)).not.toBeInTheDocument();
  // Draft keys must be intact
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");
});

test("StrictMode: opening existing invoice does not show Continue Estimate blocker (matches the real dev-server render path in index.js)", async () => {
  // index.js renders <App /> inside <React.StrictMode>. Its dev-only
  // mount->cleanup->remount effect simulation is what actually triggers the
  // "Continue Estimate / Start Blank Invoice" blocker on live/mobile devices
  // (npm start), even though a plain render(<App />) below never reproduces
  // it. Wrapping here closes that gap.
  const chamberDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "StrictMode Blocker Customer",
    projectName: "StrictMode Blocker Project",
    docNumber: "STRICT-EST-1",
    scopeNotes: "This draft must survive StrictMode's dev-only double-effect simulation.",
  });
  const draftRaw = JSON.stringify(chamberDraft);

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(
    STORAGE_KEYS.INVOICES,
    JSON.stringify([
      buildSavedInvoice({
        id: "strict-invoice-1",
        customerName: "StrictMode Invoice Customer",
        projectName: "StrictMode Invoice Project",
        docNumber: "INV-STRICT-1",
        updatedAt: Date.now(),
      }),
    ])
  );

  render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  fireEvent.click(screen.getByLabelText("Invoices"));
  fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

  expect(await screen.findByText("EDIT INVOICE")).toBeInTheDocument();
  expect(screen.queryByText(/Continue Estimate/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Start Blank Invoice/i)).not.toBeInTheDocument();

  await waitFor(() => {
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
    expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");
  });
});

test("StrictMode: opening an existing estimate preserves the chambered estimate draft and restores it after cancel (matches the real dev-server render path in index.js)", async () => {
  const chamberDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "StrictMode Estimate Chamber Customer",
    projectName: "StrictMode Estimate Chamber Project",
    docNumber: "STRICT-EST-CHAMBER-1",
    scopeNotes: "This chambered estimate draft must survive opening a different existing estimate.",
  });
  const draftRaw = JSON.stringify(chamberDraft);

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATES,
    JSON.stringify([
      buildSavedEstimate({
        id: "strict-estimate-1",
        customerName: "StrictMode Estimate Customer",
        projectName: "StrictMode Estimate Project",
        docNumber: "EST-STRICT-1",
        updatedAt: Date.now(),
      }),
    ])
  );

  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

  render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  fireEvent.click(screen.getByLabelText("Estimates"));
  fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

  expect(await screen.findByText("EDIT ESTIMATE")).toBeInTheDocument();

  await waitFor(() => {
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
    expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");
  });

  fireEvent.click(screen.getByRole("button", { name: /cancel edit/i }));
  await waitFor(() => {
    expect(screen.queryByText("EDIT ESTIMATE")).not.toBeInTheDocument();
  });

  fireEvent.click(screen.getByLabelText("Home"));
  expect(await screen.findByRole("button", { name: /Resume Draft/i })).toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");

  confirmSpy.mockRestore();
});

test("Home Resume Draft opens Invoice Builder for a live invoice draft even when newer saved docs exist", async () => {
  const liveDraft = buildLiveDraft({
    docType: "invoice",
    customerName: "Draft Invoice Customer",
    projectName: "Draft Invoice Project",
    docNumber: "DRAFT-INV-1",
    scopeNotes: "Draft invoice scope",
  });

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(liveDraft));
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATES,
    JSON.stringify([
      buildSavedEstimate({
        id: "saved-estimate-newer",
        customerName: "Saved Estimate Customer",
        projectName: "Saved Estimate Project",
        docNumber: "SAVED-EST-9",
        updatedAt: Date.now() + 5000,
      }),
    ])
  );
  localStorage.setItem(
    STORAGE_KEYS.INVOICES,
    JSON.stringify([
      buildSavedInvoice({
        id: "saved-invoice-newer",
        customerName: "Saved Invoice Customer",
        projectName: "Saved Invoice Project",
        docNumber: "SAVED-INV-9",
        updatedAt: Date.now() + 6000,
      }),
    ])
  );

  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /Resume Draft/i }));

  expect(await screen.findByText("Invoice Builder")).toBeInTheDocument();
  expect(screen.queryByText("EDIT INVOICE")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Draft Invoice Customer");
  });
  expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
});

test("Home shows no Resume Draft when only saved estimates exist and continueLast does not open them", async () => {
  localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATES,
    JSON.stringify([
      buildSavedEstimate({
        id: "saved-estimate-only",
        customerName: "Saved Estimate Customer",
        projectName: "Saved Estimate Project",
        docNumber: "SAVED-EST-9",
        updatedAt: Date.now() + 5000,
      }),
    ])
  );
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));

  render(<App />);

  expect(screen.queryByRole("button", { name: /Resume Draft/i })).toBeNull();
  expect(screen.queryByText(/Describe the Job/i)).not.toBeInTheDocument();

  await act(async () => {
    window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "continueLast" } }));
  });

  expect(screen.queryByText("Estimate Builder")).not.toBeInTheDocument();
  expect(screen.queryByText("Invoice Builder")).not.toBeInTheDocument();
  expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
});

test("successful new estimate save clears Resume Draft and returns Create to a clean estimate flow", async () => {
  const scopeImages = [
    {
      id: "scope-image-1",
      name: "Fresh Save Photo.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,freshsavephoto",
      storedWidth: 1024,
      storedHeight: 768,
      storedSizeBytes: 140000,
      layout: { size: "medium", align: "center", caption: false },
    },
  ];
  const liveDraft = buildLiveDraft({
    docType: "estimate",
    customerName: "Fresh Save Customer",
    projectName: "Fresh Save Project",
    docNumber: "FRESH-EST-1",
    scopeNotes: "Fresh estimate scope ready to save.\n[scope-image:scope-image-1]",
    scopeImages,
  });

  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(liveDraft));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));

  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /Resume Draft/i }));

  expect(await screen.findByText("Estimate Builder")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /save estimate/i }));

  await waitFor(() => {
    const storedEstimates = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]");
    expect(storedEstimates).toEqual([
      expect.objectContaining({
        estimateNumber: "FRESH-EST-1",
        customerName: "Fresh Save Customer",
        scopeNotes: "Fresh estimate scope ready to save.\n[scope-image:scope-image-1]",
        scopeImages: [
          expect.objectContaining({
            id: "scope-image-1",
            storedSizeBytes: 140000,
            storedWidth: 1024,
            storedHeight: 768,
          }),
        ],
      }),
    ]);
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBeNull();
  });

  // A real, conscious "Save Estimate" must mark automatic cloud backup dirty.
  const backupQueueState = readCloudBackupQueueState();
  expect(backupQueueState.pending).toBe(true);
  expect(backupQueueState.domains).toContain("estimates");

  fireEvent.click(screen.getByLabelText("Home"));

  expect(await screen.findByText(/Business Pulse/i)).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: /Resume Draft/i })).toBeNull();
  });

  fireEvent.click(screen.getByLabelText("Create"));
  const launcher = await screen.findByRole("dialog", { name: /Start New/i });
  expect(screen.queryByRole("button", { name: /Resume Estimate Draft/i })).toBeNull();
  expect(launcher).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Estimate$/i })).toBeInTheDocument();
});
