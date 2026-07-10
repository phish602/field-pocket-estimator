import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("CustomersScreen typeahead dropdown", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function seedThreeCustomers() {
    seedCustomers([
      createCustomer({ id: "c1", fullName: "John Smith", name: "John Smith" }),
      createCustomer({ id: "c2", fullName: "Jose Martinez", name: "Jose Martinez" }),
      createCustomer({
        id: "c3",
        type: "commercial",
        fullName: "",
        name: "Johnson Painting LLC",
        companyName: "Johnson Painting LLC",
      }),
    ]);
    seedProjects([]);
    seedEstimates([]);
    seedInvoices([]);
  }

  async function typeSearch(value) {
    const input = await screen.findByPlaceholderText(/Search name, phone, email/i);
    act(() => {
      fireEvent.change(input, { target: { value } });
    });
    return input;
  }

  test("typing shows a dropdown with a matching customer, an Add Customer row, and keeps the lower filtered list", async () => {
    seedThreeCustomers();
    render(<CustomersScreen lang="en" t={(k) => k} />);

    // Wait for the existing lower card list to finish loading (skeleton cleared).
    await screen.findByText("John Smith");

    await typeSearch("Jo");

    const listbox = await screen.findByRole("listbox", { name: /Matching customers/i });
    expect(within(listbox).getByText("John Smith")).toBeInTheDocument();
    expect(within(listbox).getByText(/\+ Add Customer/i)).toBeInTheDocument();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);

    // The existing full filtered card list still renders below (name appears in both dropdown and card).
    await waitFor(() => {
      expect(screen.getAllByText("John Smith").length).toBeGreaterThan(1);
    });
  });

  test("dropdown still offers Add Customer when there are zero matches", async () => {
    seedThreeCustomers();
    render(<CustomersScreen lang="en" t={(k) => k} />);
    await typeSearch("Zzz-no-such-customer");

    const listbox = await screen.findByRole("listbox", { name: /Matching customers/i });
    expect(within(listbox).getByText(/\+ Add Customer/i)).toBeInTheDocument();
    expect(within(listbox).queryAllByRole("option").length).toBe(0);
  });

  test("clicking the dropdown Add Customer row opens the add form", async () => {
    seedThreeCustomers();
    render(<CustomersScreen lang="en" t={(k) => k} />);
    await typeSearch("Jo");

    const listbox = await screen.findByRole("listbox", { name: /Matching customers/i });
    const addButton = within(listbox).getByRole("button", { name: /\+ Add Customer/i });
    act(() => {
      fireEvent.click(addButton);
    });

    // Leaving list mode: the search input and dropdown are gone, edit/add form is shown.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search name, phone, email/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("listbox", { name: /Matching customers/i })).not.toBeInTheDocument();
  });

  test("clicking a dropdown customer row triggers the existing use handoff", async () => {
    seedThreeCustomers();
    const onDone = jest.fn();
    render(<CustomersScreen lang="en" t={(k) => k} onDone={onDone} />);
    await typeSearch("Jose");

    const listbox = await screen.findByRole("listbox", { name: /Matching customers/i });
    const row = within(listbox).getByRole("option", { name: /Jose Martinez/i });
    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });
});
