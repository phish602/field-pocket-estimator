import { fireEvent, render, screen, within } from "@testing-library/react";
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

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function queryToggle() {
  return document.querySelector(".pe-builder-mode");
}

beforeEach(() => {
  localStorage.clear();
  seedCompanyProfile();
});

test("Create -> Estimate opens Estimate Builder with no Estimate/Invoice toggle", async () => {
  render(<App />);

  fireEvent.click(screen.getByLabelText("Create"));
  const launcher = await screen.findByRole("dialog", { name: /Start New/i });
  fireEvent.click(within(launcher).getByRole("button", { name: /^Estimate$|^Resume Estimate Draft$/i }));

  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});

test("Create -> Invoice (docType=invoice draft) opens Invoice Builder with no toggle", async () => {
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATOR_STATE,
    JSON.stringify({ ui: { docType: "invoice" } })
  );

  render(<App />);

  fireEvent.click(screen.getByLabelText("Create"));
  const launcher = await screen.findByRole("dialog", { name: /Start New/i });
  fireEvent.click(within(launcher).getByRole("button", { name: /^Invoice$/i }));

  expect(await screen.findByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Estimate" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});
