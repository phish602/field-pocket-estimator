import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

const CUSTOMER_SEARCH_PLACEHOLDER = "Search or select a customer…";

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function seedMeaningfulDraft(docType, customerName) {
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATOR_STATE,
    JSON.stringify({
      ui: { docType },
      customer: { name: customerName },
    })
  );
}

function queryToggle() {
  return document.querySelector(".pe-builder-mode");
}

function clickCreate() {
  fireEvent.click(screen.getByLabelText("Create"));
}

function clickNewEstimate() {
  fireEvent.click(screen.getByRole("button", { name: "New Estimate" }));
}

function clickNewInvoice() {
  fireEvent.click(screen.getByRole("button", { name: "New Invoice" }));
}

beforeEach(() => {
  localStorage.clear();
  seedCompanyProfile();
});

test("1. Create -> New Estimate opens Estimate Builder with no Estimate/Invoice toggle", () => {
  render(<App />);

  clickCreate();
  clickNewEstimate();

  expect(screen.getByText(/Estimator Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});

test("2. Create -> New Invoice opens Invoice Builder with no toggle", () => {
  render(<App />);

  clickCreate();
  clickNewInvoice();

  expect(screen.getByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Estimate" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});

test("3. New Invoice draft guard: Continue Current Draft keeps Estimate Draft A and routes to Estimate Builder", () => {
  seedMeaningfulDraft("estimate", "Draft A Customer");
  render(<App />);

  clickCreate();
  clickNewInvoice();

  expect(screen.getByRole("dialog", { name: "Draft in progress" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue Current Draft" }));

  expect(screen.getByText(/Estimator Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Draft A Customer");
  expect(queryToggle()).toBeNull();
});

test("4. New Invoice draft guard: Discard and Start New Invoice clears stale estimate data", () => {
  seedMeaningfulDraft("estimate", "Draft A Customer");
  render(<App />);

  clickCreate();
  clickNewInvoice();

  fireEvent.click(screen.getByRole("button", { name: "Discard and Start New Invoice" }));

  expect(screen.getByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("");
  expect(queryToggle()).toBeNull();
});

test("5. New Estimate draft guard: Continue Current Draft keeps Invoice Draft A and routes to Invoice Builder", () => {
  seedMeaningfulDraft("invoice", "Invoice Draft A Customer");
  render(<App />);

  clickCreate();
  clickNewEstimate();

  expect(screen.getByRole("dialog", { name: "Draft in progress" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue Current Draft" }));

  expect(screen.getByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Invoice Draft A Customer");
  expect(queryToggle()).toBeNull();
});

test("6. New Estimate draft guard: Discard and Start New Estimate clears stale invoice data", () => {
  seedMeaningfulDraft("invoice", "Invoice Draft A Customer");
  render(<App />);

  clickCreate();
  clickNewEstimate();

  fireEvent.click(screen.getByRole("button", { name: "Discard and Start New Estimate" }));

  expect(screen.getByText(/Estimator Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("");
  expect(queryToggle()).toBeNull();
});

test("7. New Estimate with no existing draft does not show the draft guard", () => {
  render(<App />);

  clickCreate();
  clickNewEstimate();

  expect(screen.queryByRole("dialog", { name: "Draft in progress" })).toBeNull();
  expect(screen.getByText(/Estimator Builder/i)).toBeInTheDocument();
});

test("8. New Estimate when an Estimate draft already exists does not show the draft guard (same docType)", () => {
  seedMeaningfulDraft("estimate", "Existing Customer");
  render(<App />);

  clickCreate();
  clickNewEstimate();

  expect(screen.queryByRole("dialog", { name: "Draft in progress" })).toBeNull();
  expect(screen.getByText(/Estimator Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Existing Customer");
});
