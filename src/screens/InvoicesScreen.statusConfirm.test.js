import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function createPaidInvoice(overrides = {}) {
  return {
    id: "inv_paid_for_void",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-PAID-1",
    customerId: "cust_1",
    customerName: "Test Customer",
    projectName: "Test Project",
    invoiceTotal: 500,
    total: 500,
    amountPaid: 500,
    balanceRemaining: 0,
    status: "paid",
    paymentStatus: "paid",
    payments: [
      {
        id: "pay_1",
        amount: 500,
        paidAt: "2024-05-01",
        note: "Marked paid",
        method: "manual",
      },
    ],
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
    savedAt: 1714694400000,
    ts: 1714694400000,
    ...overrides,
  };
}

function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function readStoredInvoices() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]");
}

function renderInvoicesScreen() {
  render(<InvoicesScreen lang="en" t={(k) => k} />);
  act(() => {
    jest.advanceTimersByTime(300);
  });
}

function openInvoiceDetails() {
  fireEvent.click(screen.getByRole("button", { name: /Details/i }));
}

describe("InvoicesScreen status confirm dialog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("voiding a paid invoice updates storage to void with amountPaid 0, empty payments, and balanceRemaining 0", () => {
    const paidInvoice = createPaidInvoice();
    seedInvoices([paidInvoice]);

    renderInvoicesScreen();
    openInvoiceDetails();

    // Void action button opens the confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: /^Void$/i }));

    const dialog = screen.getByRole("dialog", { name: /Void this invoice\?/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/This will mark the invoice status to Void/i)).toBeInTheDocument();

    // Confirm void
    fireEvent.click(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

    // Dialog dismissed after confirmation
    expect(screen.queryByRole("dialog")).toBeNull();

    // Storage reflects void lifecycle values
    const stored = readStoredInvoices();
    const voided = stored.find((inv) => inv.id === "inv_paid_for_void");
    expect(voided).toBeDefined();
    expect(voided.status).toBe("void");
    expect(voided.amountPaid).toBe(0);
    expect(voided.payments).toEqual([]);
    expect(voided.balanceRemaining).toBe(0);
  });

  test("canceling the void confirm dialog leaves invoice status and storage unchanged", () => {
    const paidInvoice = createPaidInvoice();
    seedInvoices([paidInvoice]);

    renderInvoicesScreen();
    openInvoiceDetails();

    // Open the confirm dialog
    fireEvent.click(screen.getByRole("button", { name: /^Void$/i }));

    const dialog = screen.getByRole("dialog", { name: /Void this invoice\?/i });
    expect(dialog).toBeInTheDocument();

    // Cancel — should dismiss without writing
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.queryByRole("dialog")).toBeNull();

    // Storage unchanged: invoice still paid with payment records intact
    const stored = readStoredInvoices();
    const invoice = stored.find((inv) => inv.id === "inv_paid_for_void");
    expect(invoice).toBeDefined();
    expect(invoice.status).toBe("paid");
    expect(Number(invoice.amountPaid)).toBe(500);
    expect(Array.isArray(invoice.payments) && invoice.payments.length > 0).toBe(true);
  });
});

describe("InvoicesScreen void invoice Open button guard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("Open button is disabled for a void invoice", () => {
    seedInvoices([
      createPaidInvoice({
        id: "inv_void_open_guard",
        invoiceNumber: "INV-VOID-1",
        status: "void",
        paymentStatus: "void",
        amountPaid: 0,
        balanceRemaining: 0,
        payments: [],
      }),
    ]);

    renderInvoicesScreen();

    const openBtn = screen.getByRole("button", { name: /^Open$/i });
    expect(openBtn).toBeDisabled();
  });

  test("Details button still opens for a void invoice", () => {
    seedInvoices([
      createPaidInvoice({
        id: "inv_void_details_check",
        invoiceNumber: "INV-VOID-2",
        projectName: "Void Project",
        status: "void",
        paymentStatus: "void",
        amountPaid: 0,
        balanceRemaining: 0,
        payments: [],
      }),
    ]);

    renderInvoicesScreen();

    // Details button toggles the panel — clicking it should not throw and should show content
    const detailsBtn = screen.getByRole("button", { name: /^Details$/i });
    expect(detailsBtn).not.toBeDisabled();
    fireEvent.click(detailsBtn);

    // Panel is now open; "Hide" replaces "Details"
    expect(screen.getByRole("button", { name: /^Hide$/i })).toBeInTheDocument();
  });

  test("Open button is enabled for a non-void invoice", () => {
    seedInvoices([
      createPaidInvoice({
        id: "inv_sent_open_check",
        invoiceNumber: "INV-SENT-1",
        status: "sent",
        paymentStatus: "unpaid",
        amountPaid: 0,
        balanceRemaining: 500,
        payments: [],
      }),
    ]);

    renderInvoicesScreen();

    const openBtn = screen.getByRole("button", { name: /^Open$/i });
    expect(openBtn).not.toBeDisabled();
  });
});
