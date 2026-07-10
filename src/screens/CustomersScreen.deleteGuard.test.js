import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CustomersScreen from "./CustomersScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

// Controllable mutation-guard result so we can simulate a stale/locked device.
let mockMutationGuardResult = { ok: true, offline: true };
jest.mock("../lib/BusinessMutationGuardContext", () => ({
  useBusinessMutationGuard: () => ({
    ensureCanMutateBusinessData: async () => mockMutationGuardResult,
    canMutateBusinessDataSync: () => mockMutationGuardResult?.ok !== false,
  }),
}));

function createCustomer(overrides = {}) {
  return {
    id: "cust_test",
    type: "residential",
    fullName: "Test Customer",
    name: "Test Customer",
    resPhone: "602-555-0100",
    resEmail: "test@example.com",
    ...overrides,
  };
}

function seedCustomers(customers) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
}
function seedProjects(projects) {
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
}
function seedEstimates(estimates) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}
function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function readCustomers() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS) || "[]");
}
function readProjects() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS) || "[]");
}
function readEstimates() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]");
}
function readInvoices() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]");
}

async function clickButton(matcher) {
  const btn = await screen.findByRole("button", { name: matcher });
  await act(async () => {
    fireEvent.click(btn);
  });
}

describe("CustomersScreen delete/archive safety", () => {
  let confirmSpy;
  let alertSpy;

  beforeEach(() => {
    localStorage.clear();
    mockMutationGuardResult = { ok: true, offline: true };
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
    localStorage.clear();
  });

  // --- Hard delete: only unused customers -------------------------------

  test("unlinked customer can be hard deleted after confirmation", async () => {
    seedCustomers([createCustomer()]);
    seedProjects([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    await clickButton(/Delete Customer/i);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Stronger, reassuring copy for an unused customer.
    expect(confirmSpy.mock.calls[0][0]).toMatch(/no estimates, invoices, projects, or payments/i);
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(readCustomers()).toEqual([]);
    });
  });

  test("unlinked hard delete removes only the customer record, not other business data", async () => {
    seedCustomers([createCustomer()]);
    seedProjects([]);
    seedEstimates([]);
    // An invoice belonging to a DIFFERENT customer must remain untouched.
    const otherInvoice = { id: "inv_other", docType: "invoice", customerId: "cust_other", amountPaid: 500 };
    seedInvoices([otherInvoice]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    await clickButton(/Delete Customer/i);

    await waitFor(() => {
      expect(readCustomers()).toEqual([]);
    });
    expect(readInvoices()).toEqual([otherInvoice]);
  });

  // --- Archive: customers with business history --------------------------

  test("customer linked to a project is archived instead of hard deleted", async () => {
    const customer = createCustomer();
    seedCustomers([customer]);
    seedProjects([{ id: "proj_1", projectName: "Test Project", customerId: "cust_test", customerName: "Test Customer" }]);
    seedEstimates([]);
    seedInvoices([]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    // The action for a customer with history is "Archive Customer", not "Delete".
    expect(screen.queryByRole("button", { name: /Delete Customer/i })).not.toBeInTheDocument();
    await clickButton(/Archive Customer/i);

    expect(confirmSpy.mock.calls[0][0]).toMatch(/This Customer Has Business History/i);
    await waitFor(() => {
      const stored = readCustomers();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe("cust_test");
      expect(stored[0].archived).toBe(true);
      expect(typeof stored[0].archivedAt).toBe("string");
    });
    // Project is preserved.
    expect(readProjects()).toHaveLength(1);
  });

  test("customer linked to an estimate is archived, and the estimate is preserved", async () => {
    seedCustomers([createCustomer()]);
    seedProjects([]);
    const estimate = { id: "est_1", docType: "estimate", customerId: "cust_test", customerName: "Test Customer" };
    seedEstimates([estimate]);
    seedInvoices([]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    await clickButton(/Archive Customer/i);

    await waitFor(() => {
      expect(readCustomers()[0].archived).toBe(true);
    });
    expect(readEstimates()).toEqual([estimate]);
  });

  test("customer linked to an invoice with payments is archived, and invoice/payments are preserved", async () => {
    seedCustomers([createCustomer()]);
    seedProjects([]);
    seedEstimates([]);
    const invoice = { id: "inv_1", docType: "invoice", customerId: "cust_test", customerName: "Test Customer", amountPaid: 750, payments: [{ id: "pmt_1", amount: 750 }], status: "paid" };
    seedInvoices([invoice]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    await clickButton(/Archive Customer/i);

    await waitFor(() => {
      expect(readCustomers()[0].archived).toBe(true);
    });
    // Invoice, its amountPaid and payments array survive archiving.
    expect(readInvoices()).toEqual([invoice]);
    expect(readInvoices()[0].payments).toEqual([{ id: "pmt_1", amount: 750 }]);
  });

  test("archived customer keeps the same id and core fields", async () => {
    seedCustomers([createCustomer()]);
    seedInvoices([{ id: "inv_1", docType: "invoice", customerId: "cust_test" }]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");
    await clickButton(/Archive Customer/i);

    await waitFor(() => {
      const stored = readCustomers()[0];
      expect(stored.id).toBe("cust_test");
      expect(stored.fullName).toBe("Test Customer");
      expect(stored.resPhone).toBe("602-555-0100");
      expect(stored.resEmail).toBe("test@example.com");
      expect(stored.type).toBe("residential");
    });
  });

  // --- Active vs archived visibility ------------------------------------

  test("archived customers are hidden from the active list by default and revealed via Show archived", async () => {
    seedCustomers([
      createCustomer({ id: "c_active", fullName: "Active Customer", name: "Active Customer" }),
      createCustomer({ id: "c_arch", fullName: "Archived Customer", name: "Archived Customer", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Active Customer");

    // Hidden by default.
    expect(screen.queryByText("Archived Customer")).not.toBeInTheDocument();

    // Reveal with the toggle.
    const toggle = screen.getByRole("checkbox", { name: /Show archived/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    const archivedName = await screen.findByText("Archived Customer");
    expect(archivedName).toBeInTheDocument();
    // The archived card shows the Archived badge and a Restore action.
    expect(document.querySelector('[data-customer-archived-badge="c_arch"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Restore Customer/i })).toBeInTheDocument();
  });

  test("restoring an archived customer clears archived/archivedAt", async () => {
    seedCustomers([
      createCustomer({ id: "c_arch", fullName: "Archived Customer", name: "Archived Customer", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    render(<CustomersScreen lang="en" t={(k) => k} />);
    // Reveal archived first.
    const toggle = await screen.findByRole("checkbox", { name: /Show archived/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await screen.findByText("Archived Customer");

    await clickButton(/Restore Customer/i);

    await waitFor(() => {
      const stored = readCustomers()[0];
      expect(stored.archived).toBeFalsy();
      expect(stored.archivedAt).toBeFalsy();
      expect(stored.id).toBe("c_arch");
    });
  });

  // --- Mutation guard (stale device) blocks all three actions -----------

  test("stale device blocks hard delete", async () => {
    seedCustomers([createCustomer()]);
    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    mockMutationGuardResult = { ok: false, userMessage: "Save stopped because EstiPaid was switched to another device." };
    await clickButton(/Delete Customer/i);

    expect(alertSpy).toHaveBeenCalled();
    // Customer NOT removed.
    await waitFor(() => {
      expect(readCustomers()).toHaveLength(1);
    });
  });

  test("stale device blocks archive", async () => {
    seedCustomers([createCustomer()]);
    seedInvoices([{ id: "inv_1", docType: "invoice", customerId: "cust_test" }]);
    render(<CustomersScreen lang="en" t={(k) => k} />);
    await screen.findByText("Test Customer");

    mockMutationGuardResult = { ok: false, userMessage: "Save stopped because EstiPaid was switched to another device." };
    await clickButton(/Archive Customer/i);

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(readCustomers()[0].archived).toBeFalsy();
    });
  });

  test("stale device blocks restore", async () => {
    seedCustomers([
      createCustomer({ id: "c_arch", fullName: "Archived Customer", name: "Archived Customer", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    render(<CustomersScreen lang="en" t={(k) => k} />);
    const toggle = await screen.findByRole("checkbox", { name: /Show archived/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    await screen.findByText("Archived Customer");

    mockMutationGuardResult = { ok: false, userMessage: "Save stopped because EstiPaid was switched to another device." };
    await clickButton(/Restore Customer/i);

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(readCustomers()[0].archived).toBe(true);
    });
  });
});
