import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

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

function buildLiveDraft({ docType = "estimate", customerName, projectName, docNumber, scopeNotes }) {
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
      location: "123 Draft Way",
    },
    scopeNotes,
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
    status: "unpaid",
    customerName,
    projectName,
    invoiceNumber: docNumber,
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
