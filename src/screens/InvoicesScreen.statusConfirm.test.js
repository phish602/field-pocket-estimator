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

function createSentInvoice(overrides = {}) {
  return createPaidInvoice({
    id: "inv_sent_payment",
    invoiceNumber: "INV-SENT-1",
    status: "sent",
    paymentStatus: "unpaid",
    amountPaid: 0,
    balanceRemaining: 500,
    payments: [],
    ...overrides,
  });
}

describe("InvoicesScreen status confirm dialog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
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
    act(() => {
      jest.runOnlyPendingTimers();
    });
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

describe("InvoicesScreen manual payments", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("shows Take Payment only for eligible invoices", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /^Take Payment$/i })).toBeInTheDocument();
  });

  test("hides manual payment action for draft invoices", () => {
    seedInvoices([
      createSentInvoice({
        id: "inv_draft",
        status: "draft",
      }),
    ]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Take Payment|Add Payment/i })).toBeNull();
  });

  test("hides manual payment action for void invoices", () => {
    seedInvoices([
      createSentInvoice({
        id: "inv_void",
        status: "void",
        paymentStatus: "void",
        balanceRemaining: 0,
      }),
    ]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Take Payment|Add Payment/i })).toBeNull();
  });

  test("hides manual payment action for paid invoices", () => {
    seedInvoices([createPaidInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Take Payment|Add Payment/i })).toBeNull();
  });

  test("partial payment appends a ledger entry and updates payment totals", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /^Take Payment$/i }));

    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.change(within(dialog).getByLabelText(/Payment amount/i), { target: { value: "125.00" } });
    fireEvent.change(within(dialog).getByLabelText(/Paid date/i), { target: { value: "2026-05-06" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment method/i), { target: { value: "cash" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment note/i), { target: { value: "Deposit received" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record payment/i }));

    const stored = readStoredInvoices();
    const invoice = stored.find((entry) => entry.id === "inv_sent_payment");
    expect(invoice).toBeDefined();
    expect(invoice.status).toBe("sent");
    expect(invoice.paymentStatus).toBe("partial");
    expect(Number(invoice.amountPaid)).toBe(125);
    expect(Number(invoice.balanceRemaining)).toBe(375);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]).toMatchObject({
      amount: 125,
      paidAt: "2026-05-06",
      method: "cash",
      note: "Deposit received",
    });
    expect(screen.getByText(/Deposit received/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add Payment$/i })).toBeInTheDocument();
  });

  test("final payoff marks the invoice paid", () => {
    seedInvoices([
      createSentInvoice({
        id: "inv_partial_payoff",
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_existing",
            amount: 125,
            paidAt: "2026-05-05",
            method: "cash",
            note: "Deposit",
            order: 0,
          },
        ],
      }),
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Add Payment$/i }));

    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.change(within(dialog).getByLabelText(/Payment amount/i), { target: { value: "375.00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record payment/i }));

    const stored = readStoredInvoices();
    const invoice = stored.find((entry) => entry.id === "inv_partial_payoff");
    expect(invoice).toBeDefined();
    expect(invoice.status).toBe("paid");
    expect(invoice.paymentStatus).toBe("paid");
    expect(Number(invoice.amountPaid)).toBe(500);
    expect(Number(invoice.balanceRemaining)).toBe(0);
    expect(invoice.payments).toHaveLength(2);
  });

  test("overpayment is blocked without mutating storage", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Take Payment$/i }));

    const before = readStoredInvoices();
    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.change(within(dialog).getByLabelText(/Payment amount/i), { target: { value: "600.00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Record payment/i }));

    expect(screen.getByText(/cannot exceed the remaining balance/i)).toBeInTheDocument();
    expect(readStoredInvoices()).toEqual(before);
  });

  test("canceling payment keeps storage unchanged", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Take Payment$/i }));

    const before = readStoredInvoices();
    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel$/i }));

    expect(screen.queryByRole("dialog", { name: /Record payment/i })).toBeNull();
    expect(readStoredInvoices()).toEqual(before);
  });

  test("voiding a partially paid invoice still clears the payment ledger", () => {
    seedInvoices([
      createSentInvoice({
        id: "inv_partial_void",
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_existing",
            amount: 125,
            paidAt: "2026-05-05",
            method: "cash",
            note: "Deposit",
            order: 0,
          },
        ],
      }),
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Void$/i }));

    const dialog = screen.getByRole("dialog", { name: /Void this invoice\?/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

    const stored = readStoredInvoices();
    const invoice = stored.find((entry) => entry.id === "inv_partial_void");
    expect(invoice).toBeDefined();
    expect(invoice.status).toBe("void");
    expect(invoice.paymentStatus).toBe("void");
    expect(invoice.payments).toEqual([]);
    expect(Number(invoice.amountPaid)).toBe(0);
    expect(Number(invoice.balanceRemaining)).toBe(0);
  });
});

describe("InvoicesScreen Stripe checkout action", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    jest.useRealTimers();
  });

  test("shows Stripe action for eligible invoices", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /Pay Online with Stripe/i })).toBeInTheDocument();
  });

  test("hides Stripe action for draft invoices", () => {
    seedInvoices([createSentInvoice({ id: "inv_draft_stripe", status: "draft" })]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
  });

  test("hides Stripe action for void invoices", () => {
    seedInvoices([createSentInvoice({ id: "inv_void_stripe", status: "void", paymentStatus: "void", balanceRemaining: 0 })]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
  });

  test("hides Stripe action for paid invoices", () => {
    seedInvoices([createPaidInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
  });

  test("Stripe checkout sends balanceRemaining and opens the returned checkout URL without mutating storage", async () => {
    const sourceInvoice = createSentInvoice({
      invoiceTotal: 900,
      total: 900,
      amountPaid: 125,
      balanceRemaining: 775,
      paymentStatus: "partial",
      customer: {
        id: "cust_1",
        name: "Test Customer",
        email: "customer@example.com",
      },
      payments: [
        {
          id: "pay_existing",
          amount: 125,
          paidAt: "2026-05-05",
          note: "Deposit",
          method: "cash",
          order: 0,
        },
      ],
    });
    seedInvoices([sourceInvoice]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/test-session",
        sessionId: "cs_test_123",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/stripe/create-checkout-session",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.balanceRemaining).toBe(775);
    expect(payload.balanceRemaining).not.toBe(900);
    expect(payload.invoiceId).toBe("inv_sent_payment");
    expect(payload.customerEmail).toBe("customer@example.com");
    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/test-session",
      "_blank",
      "noopener,noreferrer"
    );
    expect(readStoredInvoices()).toEqual(before);
  });

  test("Stripe checkout failure does not mutate invoice storage or append payments", async () => {
    const sourceInvoice = createSentInvoice({
      amountPaid: 125,
      balanceRemaining: 375,
      paymentStatus: "partial",
      payments: [
        {
          id: "pay_existing",
          amount: 125,
          paidAt: "2026-05-05",
          note: "Deposit",
          method: "cash",
          order: 0,
        },
      ],
    });
    seedInvoices([sourceInvoice]);
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: "Stripe is not configured.",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(window.alert).toHaveBeenCalledWith("Stripe is not configured.");
    expect(window.open).not.toHaveBeenCalled();
    expect(readStoredInvoices()).toEqual(before);
    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.amountPaid).toBe(125);
    expect(invoice.balanceRemaining).toBe(375);
    expect(invoice.paymentStatus).toBe("partial");
    expect(invoice.status).toBe("sent");
  });
});
