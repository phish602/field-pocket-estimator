import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

jest.mock("./screens/ProjectsScreen", () => {
  return function MockProjectsScreen() {
    return <div data-testid="projects-screen">Projects screen</div>;
  };
});

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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([]));
});

test("long-press logo shortcut grid includes Projects and opens the existing Projects route", async () => {
  render(<App />);

  act(() => {
    window.dispatchEvent(new Event("estipaid:hero-logo-longpress"));
  });

  const quickMenu = await screen.findByRole("dialog", { name: /Shortcuts/i });
  expect(within(quickMenu).getByRole("button", { name: /^Projects$/i })).toBeInTheDocument();

  fireEvent.click(within(quickMenu).getByRole("button", { name: /^Projects$/i }));

  expect(await screen.findByTestId("projects-screen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: /Shortcuts/i })).not.toBeInTheDocument();
});
