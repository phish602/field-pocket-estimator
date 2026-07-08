import { act, render, screen, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import CustomersScreen from "./CustomersScreen";

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

function createCustomer(overrides = {}) {
  return {
    id: "cust_test",
    type: "residential",
    fullName: "Test Customer",
    name: "Test Customer",
    resPhone: "555-1234",
    resEmail: "test@example.com",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("CustomersScreen same-tab refresh", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("refreshes immediately when estipaid:customers-changed event fires", async () => {
    const customer = createCustomer({ id: "cust_1", fullName: "Original Customer", name: "Original Customer" });
    seedCustomers([customer]);
    seedProjects([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<CustomersScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Original Customer/i)).toBeInTheDocument();
    });

    // Update customer in storage
    const updatedCustomer = { ...customer, fullName: "Updated Customer Name", name: "Updated Customer Name" };
    seedCustomers([updatedCustomer]);

    // Dispatch estipaid:customers-changed event
    act(() => {
      window.dispatchEvent(new Event("estipaid:customers-changed"));
    });

    // Verify UI refreshes immediately
    await waitFor(() => {
      expect(screen.getByText(/Updated Customer Name/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Original Customer/i)).not.toBeInTheDocument();
  });

  test("refreshes when customer is added via estipaid:customers-changed event", async () => {
    const customer1 = createCustomer({ id: "cust_1", fullName: "Customer One", name: "Customer One" });
    seedCustomers([customer1]);
    seedProjects([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<CustomersScreen />);

    await waitFor(() => {
      expect(screen.getAllByText(/Customer One/i).length).toBeGreaterThan(0);
    });

    // Add a second customer
    const customer2 = createCustomer({ id: "cust_2", fullName: "Customer Two", name: "Customer Two" });
    seedCustomers([customer1, customer2]);

    // Dispatch estipaid:customers-changed event
    act(() => {
      window.dispatchEvent(new Event("estipaid:customers-changed"));
    });

    // Verify both customers are visible
    await waitFor(() => {
      expect(screen.getByText(/Customer Two/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Customer One/i).length).toBeGreaterThan(0);
  });

  test("refreshes when customer is deleted via estipaid:customers-changed event", async () => {
    const customer1 = createCustomer({ id: "cust_1", fullName: "Customer One", name: "Customer One" });
    const customer2 = createCustomer({ id: "cust_2", fullName: "Customer Two", name: "Customer Two" });
    seedCustomers([customer1, customer2]);
    seedProjects([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<CustomersScreen />);

    await waitFor(() => {
      expect(screen.getAllByText(/Customer One/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Customer Two/i)).toBeInTheDocument();
    });

    // Remove customer2
    seedCustomers([customer1]);

    // Dispatch estipaid:customers-changed event
    act(() => {
      window.dispatchEvent(new Event("estipaid:customers-changed"));
    });

    // Verify customer2 is removed
    await waitFor(() => {
      expect(screen.queryByText(/Customer Two/i)).not.toBeInTheDocument();
    });
    expect(screen.getAllByText(/Customer One/i).length).toBeGreaterThan(0);
  });
});
