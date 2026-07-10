import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function createInvoice(overrides = {}) {
  return {
    id: "inv_a",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-0041",
    customerId: "cust_jose",
    customerName: "Jose Martinez",
    projectName: "Kitchen Remodel",
    invoiceTotal: 1250,
    total: 1250,
    amountPaid: 400,
    balanceRemaining: 850,
    status: "sent",
    paymentStatus: "partial",
    dueDate: "2026-07-20",
    updatedAt: 1720000000000,
    createdAt: 1720000000000,
    savedAt: 1720000000000,
    ts: 1720000000000,
    ...overrides,
  };
}

function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}
function readStoredInvoices() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]");
}

function renderInvoices() {
  render(<InvoicesScreen lang="en" t={(key) => key} />);
}

function getSearchInput() {
  return screen.getByPlaceholderText(/Search/i);
}

async function typeSearch(value) {
  const input = getSearchInput();
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
  return input;
}

describe("InvoicesScreen search typeahead", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  function seedTwoInvoices() {
    seedInvoices([
      createInvoice({ id: "inv_a", invoiceNumber: "INV-0041", invoiceTotal: 1250, total: 1250, amountPaid: 400, balanceRemaining: 850 }),
      createInvoice({ id: "inv_b", invoiceNumber: "INV-0042", invoiceTotal: 900, total: 900, amountPaid: 900, balanceRemaining: 0, status: "paid", paymentStatus: "paid" }),
    ]);
  }

  test("typing shows a dropdown with descriptive invoice rows (not just customer name)", async () => {
    seedTwoInvoices();
    renderInvoices();
    await screen.findByText(/INV-0041/);

    await typeSearch("Jose");
    const listbox = await screen.findByRole("listbox", { name: /Matching invoices/i });

    // Descriptive: invoice number + status + money details, for both invoices.
    expect(within(listbox).getByText(/#INV-0041/)).toBeInTheDocument();
    expect(within(listbox).getByText(/#INV-0042/)).toBeInTheDocument();
    const rowText = listbox.textContent;
    expect(rowText).toMatch(/total/i);
    expect(rowText).toMatch(/balance/i);
    expect(rowText).toMatch(/\$/);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  });

  test("Escape closes the dropdown without clearing the search text", async () => {
    seedTwoInvoices();
    renderInvoices();
    await screen.findByText(/INV-0041/);

    const input = await typeSearch("Jose");
    await screen.findByRole("listbox", { name: /Matching invoices/i });

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: /Matching invoices/i })).not.toBeInTheDocument();
    });
    expect(input).toHaveValue("Jose");
  });

  test("clicking outside closes the dropdown without clearing the search text", async () => {
    seedTwoInvoices();
    renderInvoices();
    await screen.findByText(/INV-0041/);

    const input = await typeSearch("Jose");
    await screen.findByRole("listbox", { name: /Matching invoices/i });

    act(() => {
      fireEvent.pointerDown(document.body);
    });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: /Matching invoices/i })).not.toBeInTheDocument();
    });
    expect(input).toHaveValue("Jose");
  });

  test("selecting an invoice row is view-only: no archive/void/status/payment change, scrolls + highlights the card", async () => {
    const scrollIntoView = jest.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    try {
      seedTwoInvoices();
      renderInvoices();
      await screen.findByText(/INV-0041/);

      await typeSearch("Jose");
      const listbox = await screen.findByRole("listbox", { name: /Matching invoices/i });
      const row = within(listbox).getByText(/#INV-0041/).closest("button");
      await act(async () => {
        fireEvent.click(row);
      });

      // Still on the invoices list; no mutation to the invoice record.
      expect(getSearchInput()).toBeInTheDocument();
      const stored = readStoredInvoices();
      const a = stored.find((i) => i.id === "inv_a");
      expect(a.archived).toBeFalsy();
      expect(a.status).toBe("sent");
      expect(a.amountPaid).toBe(400);
      expect(alertSpy).not.toHaveBeenCalled();

      // Dropdown closed, matching card highlighted + scrolled.
      await waitFor(() => {
        expect(screen.queryByRole("listbox", { name: /Matching invoices/i })).not.toBeInTheDocument();
      });
      const card = document.querySelector('[data-invoice-card-id="inv_a"]');
      expect(card.getAttribute("data-invoice-card-highlighted")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = prev;
      alertSpy.mockRestore();
    }
  });

  test("archived invoices are hidden from the dropdown by default and shown with an Archived label when Show archived is on", async () => {
    seedInvoices([
      createInvoice({ id: "inv_active", invoiceNumber: "INV-0041" }),
      createInvoice({ id: "inv_arch", invoiceNumber: "INV-0099", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    renderInvoices();
    await screen.findByText(/INV-0041/);

    await typeSearch("Jose");
    let listbox = await screen.findByRole("listbox", { name: /Matching invoices/i });
    // Archived invoice not present by default.
    expect(within(listbox).queryByText(/#INV-0099/)).not.toBeInTheDocument();
    expect(within(listbox).getByText(/#INV-0041/)).toBeInTheDocument();

    // Turn on Show archived.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Show archived/i }));
    });
    // Re-focus/refresh the dropdown by re-typing.
    await typeSearch("Jose");
    listbox = await screen.findByRole("listbox", { name: /Matching invoices/i });
    expect(within(listbox).getByText(/#INV-0099/)).toBeInTheDocument();
    expect(within(listbox).getByText(/Archived/i)).toBeInTheDocument();
  });
});
