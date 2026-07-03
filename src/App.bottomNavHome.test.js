import { fireEvent, render, screen, within } from "@testing-library/react";

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

jest.mock("./screens/ProjectsScreen", () => {
  return function MockProjectsScreen() {
    return <div data-testid="projects-screen">Projects screen</div>;
  };
});

jest.mock("./screens/CustomersScreen", () => {
  return function MockCustomersScreen() {
    return <div data-testid="customers-screen">Customers screen</div>;
  };
});

jest.mock("./screens/EstimatesScreen", () => {
  return function MockEstimatesScreen() {
    return <div data-testid="estimates-screen">Estimates screen</div>;
  };
});

jest.mock("./screens/InvoicesScreen", () => {
  return function MockInvoicesScreen() {
    return <div data-testid="invoices-screen">Invoices screen</div>;
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

function getBottomNav() {
  return screen.getByRole("navigation", { name: /primary/i });
}

test("Home is present in the bottom nav and is the first item", () => {
  render(<App />);

  const nav = getBottomNav();
  const buttons = within(nav).getAllByRole("button");
  expect(buttons[0]).toHaveAccessibleName("Home");
});

test("tapping Home from another bottom-nav screen returns to the dashboard", () => {
  render(<App />);

  const nav = getBottomNav();
  fireEvent.click(within(nav).getByRole("button", { name: "Estimates" }));
  expect(screen.getByTestId("estimates-screen")).toBeInTheDocument();

  fireEvent.click(within(getBottomNav()).getByRole("button", { name: "Home" }));

  expect(screen.getByText("Turn Scope into Revenue")).toBeInTheDocument();
});

test("Home's bottom-nav button is active only while on Home", () => {
  render(<App />);

  const homeBtn = within(getBottomNav()).getByRole("button", { name: "Home" });
  expect(homeBtn.style.opacity).toBe("1");

  fireEvent.click(within(getBottomNav()).getByRole("button", { name: "Customers" }));

  const homeBtnAfterNav = within(getBottomNav()).getByRole("button", { name: "Home" });
  expect(homeBtnAfterNav.style.opacity).not.toBe("1");
});

test("Customers, Estimates, and Invoices remain reachable from the bottom nav", () => {
  render(<App />);
  const nav = getBottomNav();

  fireEvent.click(within(nav).getByRole("button", { name: "Customers" }));
  expect(screen.getByTestId("customers-screen")).toBeInTheDocument();

  fireEvent.click(within(getBottomNav()).getByRole("button", { name: "Estimates" }));
  expect(screen.getByTestId("estimates-screen")).toBeInTheDocument();

  fireEvent.click(within(getBottomNav()).getByRole("button", { name: "Invoices" }));
  expect(screen.getByTestId("invoices-screen")).toBeInTheDocument();
});

test("Projects is reachable from the hamburger menu after leaving the bottom nav", () => {
  render(<App />);

  fireEvent.click(screen.getByLabelText(/open menu/i));
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));

  expect(screen.getByTestId("projects-screen")).toBeInTheDocument();
});

test("the bottom nav does not include a separate Projects tab", () => {
  render(<App />);

  const nav = getBottomNav();
  expect(within(nav).queryByRole("button", { name: "Projects" })).not.toBeInTheDocument();
});
