import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import CustomersScreen from "./CustomersScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function createCustomer(overrides = {}) {
  return {
    id: "cust_test",
    type: "residential",
    fullName: "Test Customer",
    ...overrides,
  };
}

function seedCustomers(customers) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
}

function readStoredCustomers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || "[]");
}

function renderCustomersScreen() {
  render(<CustomersScreen lang="en" t={(k) => k} />);
  act(() => {
    jest.advanceTimersByTime(300);
  });
}

function clickDeleteForCustomer() {
  fireEvent.click(screen.getByRole("button", { name: /Delete/i }));
}

describe("CustomersScreen delete guard", () => {
  let confirmSpy;
  let alertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("unlinked customer can still be deleted", () => {
    seedCustomers([createCustomer()]);

    renderCustomersScreen();
    clickDeleteForCustomer();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(readStoredCustomers()).toEqual([]);
  });

  test("customer linked to a project is blocked and storage remains unchanged", () => {
    const customer = createCustomer();
    seedCustomers([customer]);
    localStorage.setItem(
      STORAGE_KEYS.PROJECTS,
      JSON.stringify([
        {
          id: "proj_1",
          projectName: "Test Project",
          customerId: "cust_test",
          customerName: "Test Customer",
        },
      ]),
    );

    renderCustomersScreen();
    clickDeleteForCustomer();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot delete/i);
    expect(alertSpy.mock.calls[0][0]).toMatch(/project/i);
    expect(readStoredCustomers()).toEqual([customer]);
  });

  test("customer linked to an estimate is blocked and storage remains unchanged", () => {
    const customer = createCustomer();
    seedCustomers([customer]);
    localStorage.setItem(
      STORAGE_KEYS.ESTIMATES,
      JSON.stringify([
        {
          id: "est_1",
          docType: "estimate",
          customerId: "cust_test",
          customerName: "Test Customer",
        },
      ]),
    );

    renderCustomersScreen();
    clickDeleteForCustomer();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot delete/i);
    expect(alertSpy.mock.calls[0][0]).toMatch(/estimate/i);
    expect(readStoredCustomers()).toEqual([customer]);
  });

  test("customer linked to an invoice is blocked and storage remains unchanged", () => {
    const customer = createCustomer();
    seedCustomers([customer]);
    localStorage.setItem(
      STORAGE_KEYS.INVOICES,
      JSON.stringify([
        {
          id: "inv_1",
          docType: "invoice",
          customerId: "cust_test",
          customerName: "Test Customer",
        },
      ]),
    );

    renderCustomersScreen();
    clickDeleteForCustomer();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot delete/i);
    expect(alertSpy.mock.calls[0][0]).toMatch(/invoice/i);
    expect(readStoredCustomers()).toEqual([customer]);
  });
});
