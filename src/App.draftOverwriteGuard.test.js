import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const COMPLETE_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  email: "owner@acme.test",
  addressLine1: "123 Main St",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
};

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_PROFILE));
}

function seedMeaningfulLiveDraft() {
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATOR_STATE,
    JSON.stringify({ customer: { name: "Jane Doe" } })
  );
}

function seedCustomer() {
  const customer = { id: "c1", type: "residential", fullName: "Jane Field" };
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  return customer;
}

beforeEach(() => {
  localStorage.clear();
});

test("Home 'Start New Estimate' shows the guard when a meaningful draft exists, and Continue keeps it", () => {
  seedCompanyProfile();
  seedMeaningfulLiveDraft();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Start New Estimate" }));

  expect(screen.getByText("You have a draft in progress")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue Current Draft" }));

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  // Still on Home; draft untouched.
  expect(screen.getByRole("button", { name: "Start New Estimate" })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE))).toEqual({
    customer: { name: "Jane Doe" },
  });
});

test("Home 'Start New Estimate' Discard clears the draft and proceeds into the builder", () => {
  seedCompanyProfile();
  seedMeaningfulLiveDraft();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Start New Estimate" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and Start New Estimate" }));

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBeNull();
  // Left Home for the builder.
  expect(screen.queryByRole("button", { name: "Start New Estimate" })).not.toBeInTheDocument();
});

test("Home 'Start New Estimate' proceeds without a guard when there is no meaningful draft", () => {
  seedCompanyProfile();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Start New Estimate" }));

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start New Estimate" })).not.toBeInTheDocument();
});

test("Customers 'Use' shows the guard when a meaningful draft exists; Continue preserves the draft and clears the pending payload", async () => {
  seedCompanyProfile();
  seedMeaningfulLiveDraft();
  seedCustomer();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  const useButton = await screen.findByRole("button", { name: "Use" });
  fireEvent.click(useButton);

  expect(screen.getByText("You have a draft in progress")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue Current Draft" }));

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE))).toEqual({
    customer: { name: "Jane Doe" },
  });
  expect(localStorage.getItem(STORAGE_KEYS.PENDING_CUSTOMER_USE)).toBeNull();
});

test("Customers 'Use' Discard clears the draft and applies the customer to the builder", async () => {
  seedCompanyProfile();
  seedMeaningfulLiveDraft();
  seedCustomer();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  const useButton = await screen.findByRole("button", { name: "Use" });
  fireEvent.click(useButton);

  fireEvent.click(screen.getByRole("button", { name: "Discard and Start New Estimate" }));

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBeNull();
  expect(localStorage.getItem(STORAGE_KEYS.SELECTED_CUSTOMER_ID)).toBe("c1");
});

test("Customers 'Use' proceeds without a guard when there is no meaningful draft", async () => {
  seedCompanyProfile();
  seedCustomer();
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  const useButton = await screen.findByRole("button", { name: "Use" });
  fireEvent.click(useButton);

  expect(screen.queryByText("You have a draft in progress")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(localStorage.getItem(STORAGE_KEYS.SELECTED_CUSTOMER_ID)).toBe("c1");
  });
});
