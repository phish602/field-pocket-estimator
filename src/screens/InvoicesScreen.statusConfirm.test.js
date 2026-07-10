import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

function seedCompanyProfile(overrides = {}) {
  localStorage.setItem(
    STORAGE_KEYS.COMPANY_PROFILE,
    JSON.stringify({
      stripeAccountId: "",
      ...overrides,
    }),
  );
}

function seedStripeCheckoutSessions(entries) {
  localStorage.setItem(STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS, JSON.stringify(entries || []));
}

function readStripeCheckoutSessions() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS) || "[]");
}

function buildStripeCheckoutCreateLockKey({
  invoiceId = "inv_sent_payment",
  stripeAccountId = "acct_test_connected_123",
  balanceRemaining = 500,
  currency = "usd",
} = {}) {
  return `invoice:${invoiceId}|account:${stripeAccountId}|amount:${Number(balanceRemaining).toFixed(2)}|currency:${String(currency || "usd").toLowerCase()}`;
}

function seedStripeCheckoutCreateLocks(entries) {
  localStorage.setItem(STORAGE_KEYS.STRIPE_CHECKOUT_CREATE_LOCKS, JSON.stringify(entries || {}));
}

function readStripeCheckoutCreateLocks() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.STRIPE_CHECKOUT_CREATE_LOCKS) || "{}");
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

async function clickAndFlush(target) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

function setInvoiceStatusFilter(value) {
  const [statusSelect] = screen.getAllByRole("combobox");
  fireEvent.change(statusSelect, { target: { value } });
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

  test("voiding a paid invoice updates storage to void with amountPaid 0, empty payments, and balanceRemaining 0", async () => {
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
    await clickAndFlush(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

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

  test("Mark Paid retires pending Stripe sessions and hides Stripe payment actions", async () => {
    seedInvoices([createSentInvoice()]);
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_mark_paid_stale",
        checkoutUrl: "https://checkout.stripe.com/pay/mark-paid-stale",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Mark Paid$/i }));

    const dialog = screen.getByRole("dialog", { name: /Mark invoice as paid\?/i });
    await clickAndFlush(within(dialog).getByRole("button", { name: /^Mark Paid$/i }));

    const invoice = readStoredInvoices()[0];
    expect(invoice.status).toBe("paid");
    expect(invoice.paymentStatus).toBe("paid");
    expect(invoice.balanceRemaining).toBe(0);
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_mark_paid_stale",
      status: "stale",
    }));
    expect(screen.getByText(/^Stale$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Existing Stripe Link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeNull();
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

  test("partial payment appends a ledger entry and updates payment totals", async () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /^Take Payment$/i }));

    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.change(within(dialog).getByLabelText(/Payment amount/i), { target: { value: "125.00" } });
    fireEvent.change(within(dialog).getByLabelText(/Paid date/i), { target: { value: "2026-05-06" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment method/i), { target: { value: "cash" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment note/i), { target: { value: "Deposit received" } });
    await clickAndFlush(within(dialog).getByRole("button", { name: /Record payment/i }));

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

  test("manual partial payment marks existing old-balance pending Stripe session stale without mutating accounting beyond the payment", async () => {
    seedInvoices([createSentInvoice()]);
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_manual_stale_123",
        checkoutUrl: "https://checkout.stripe.com/pay/manual-stale",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /^Take Payment$/i }));
    const dialog = screen.getByRole("dialog", { name: /Record payment/i });
    fireEvent.change(within(dialog).getByLabelText(/Payment amount/i), { target: { value: "125.00" } });
    fireEvent.change(within(dialog).getByLabelText(/Paid date/i), { target: { value: "2026-05-06" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment method/i), { target: { value: "cash" } });
    fireEvent.change(within(dialog).getByLabelText(/Payment note/i), { target: { value: "Deposit received" } });
    await clickAndFlush(within(dialog).getByRole("button", { name: /Record payment/i }));

    const invoice = readStoredInvoices()[0];
    expect(invoice.status).toBe("sent");
    expect(invoice.paymentStatus).toBe("partial");
    expect(invoice.amountPaid).toBe(125);
    expect(invoice.balanceRemaining).toBe(375);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]).toEqual(expect.objectContaining({
      amount: 125,
      method: "cash",
      note: "Deposit received",
    }));
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_manual_stale_123",
      status: "stale",
      amount: 500,
    }));
    expect(screen.getByText(/^Stale$/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice balance changed after this link was generated\./i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy Existing Stripe Link/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeInTheDocument();
  });

  test("final payoff marks the invoice paid", async () => {
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
    await clickAndFlush(within(dialog).getByRole("button", { name: /Record payment/i }));

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

  test("voiding a partially paid invoice still clears the payment ledger", async () => {
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
    await clickAndFlush(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

    const stored = readStoredInvoices();
    const invoice = stored.find((entry) => entry.id === "inv_partial_void");
    expect(invoice).toBeDefined();
    expect(invoice.status).toBe("void");
    expect(invoice.paymentStatus).toBe("void");
    expect(invoice.payments).toEqual([]);
    expect(Number(invoice.amountPaid)).toBe(0);
    expect(Number(invoice.balanceRemaining)).toBe(0);
  });

  test("Void retires pending Stripe sessions and keeps Stripe actions hidden", async () => {
    seedInvoices([createSentInvoice()]);
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_void_stale_123",
        checkoutUrl: "https://checkout.stripe.com/pay/void-stale",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Void$/i }));

    const dialog = screen.getByRole("dialog", { name: /Void this invoice\?/i });
    await clickAndFlush(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

    const invoice = readStoredInvoices()[0];
    expect(invoice.status).toBe("void");
    expect(invoice.paymentStatus).toBe("void");
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.balanceRemaining).toBe(0);
    expect(invoice.payments).toEqual([]);
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_void_stale_123",
      status: "stale",
    }));
    expect(screen.getByText(/^Stale$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Existing Stripe Link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeNull();
  });
});

describe("InvoicesScreen Stripe checkout action", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    window.history.replaceState({}, "", "/");
    jest.useRealTimers();
  });

  test("shows Stripe action for eligible invoices", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /Pay Online with Stripe/i })).toBeInTheDocument();
  });

  test("without stripeAccountId the Stripe actions are hidden and connect notice is shown while manual payment remains", () => {
    seedCompanyProfile({ stripeAccountId: "" });
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Take Payment/i })).toBeInTheDocument();
    expect(screen.getByText(/Connect Stripe in Company Profile to accept online payments\./i)).toBeInTheDocument();
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
    expect(payload.stripeAccountId).toBe("acct_test_connected_123");
    expect(payload.balanceRemaining).toBe(775);
    expect(payload.balanceRemaining).not.toBe(900);
    expect(payload.invoiceId).toBe("inv_sent_payment");
    expect(payload.customerEmail).toBe("customer@example.com");
    expect(payload.idempotencyKey).toMatch(/^estipaid-checkout-[a-f0-9]+-[a-f0-9]+$/i);
    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/test-session",
      "_blank",
      "noopener,noreferrer"
    );
    expect(window.location.href).toBe("http://localhost/");
    expect(readStoredInvoices()).toEqual(before);
    expect(readStripeCheckoutSessions()).toEqual([
      expect.objectContaining({
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_test_123",
        checkoutUrl: "https://checkout.stripe.com/pay/test-session",
        amount: 775,
        currency: "usd",
        status: "pending",
      }),
    ]);
  });

  test("Pay Online reuses existing pending unexpired same-balance session without backend call", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_reuse_123",
        checkoutUrl: "https://checkout.stripe.com/pay/reuse-existing",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 2714694400,
        status: "pending",
      },
    ]);

    const beforeInvoices = readStoredInvoices();
    const beforeSessions = readStripeCheckoutSessions();
    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/reuse-existing",
      "_blank",
      "noopener,noreferrer"
    );
    expect(screen.getByText(/Using existing active Stripe link for this invoice balance\./i)).toBeInTheDocument();
    expect(readStoredInvoices()).toEqual(beforeInvoices);
    expect(readStripeCheckoutSessions()).toEqual(beforeSessions);
  });

  test("expired pending session is not reused and a fresh checkout session is created", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_expired_old",
        checkoutUrl: "https://checkout.stripe.com/pay/expired-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 1714694400,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/new-after-expired",
        sessionId: "cs_new_after_expired",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/new-after-expired",
      "_blank",
      "noopener,noreferrer"
    );
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_new_after_expired",
      checkoutUrl: "https://checkout.stripe.com/pay/new-after-expired",
      amount: 500,
      status: "pending",
    }));
  });

  test("rapid duplicate Pay Online clicks do not create two checkout sessions", async () => {
    seedInvoices([createSentInvoice()]);
    let resolveFetch;
    global.fetch.mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    renderInvoicesScreen();
    openInvoiceDetails();

    const button = screen.getByRole("button", { name: /Pay Online with Stripe/i });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({
          ok: true,
          checkoutUrl: "https://checkout.stripe.com/pay/double-click-safe",
          sessionId: "cs_double_click_safe",
        }),
      });
      await Promise.resolve();
    });

    expect(readStripeCheckoutSessions()).toEqual([
      expect.objectContaining({
        sessionId: "cs_double_click_safe",
        checkoutUrl: "https://checkout.stripe.com/pay/double-click-safe",
        status: "pending",
      }),
    ]);
    expect(readStripeCheckoutCreateLocks()).toEqual({});
  });

  test("shared localStorage checkout lock prevents a second create call for the same invoice balance", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutCreateLocks({
      [buildStripeCheckoutCreateLockKey()]: {
        ownerId: "other-tab",
        lockToken: "other-token",
        createdAt: 1714694400000,
        expiresAt: Date.now() + 10000,
      },
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(screen.getByText(/A Stripe link is already being generated for this invoice\./i)).toBeInTheDocument();
  });

  test("expired shared checkout lock is ignored and a new create can proceed", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutCreateLocks({
      [buildStripeCheckoutCreateLockKey()]: {
        ownerId: "other-tab",
        lockToken: "expired-token",
        createdAt: 1714694400000,
        expiresAt: Date.now() - 1000,
      },
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/expired-lock-new",
        sessionId: "cs_expired_lock_new",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(readStripeCheckoutCreateLocks()).toEqual({});
  });

  test("after shared lock acquisition a newly stored reusable session is reused without backend POST", async () => {
    seedInvoices([createSentInvoice()]);
    const originalDispatchEvent = window.dispatchEvent;
    window.dispatchEvent = jest.fn((event) => {
      if (event?.type === "pe-localstorage" && event?.detail?.key === STORAGE_KEYS.STRIPE_CHECKOUT_CREATE_LOCKS) {
        seedStripeCheckoutSessions([
          {
            invoiceId: "inv_sent_payment",
            invoiceNumber: "INV-SENT-1",
            stripeAccountId: "acct_test_connected_123",
            sessionId: "cs_raced_session",
            checkoutUrl: "https://checkout.stripe.com/pay/raced-session",
            amount: 500,
            currency: "usd",
            createdAt: 1714694500000,
            expiresAt: 2714694400,
            status: "pending",
          },
        ]);
      }
      return originalDispatchEvent.call(window, event);
    });
    try {
      renderInvoicesScreen();
      openInvoiceDetails();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(window.open).toHaveBeenCalledWith(
        "https://checkout.stripe.com/pay/raced-session",
        "_blank",
        "noopener,noreferrer"
      );
      expect(readStripeCheckoutCreateLocks()).toEqual({});
    } finally {
      window.dispatchEvent = originalDispatchEvent;
    }
  });

  test("shows Stripe action for unpaid sent invoice with no payments and stored balanceRemaining 0", () => {
    // Simulates a fresh invoice created by the UI where balanceRemaining is initialised to 0
    // even though no payment has been recorded.
    seedInvoices([
      createSentInvoice({
        id: "inv_fresh_no_payments",
        invoiceTotal: 500,
        total: 500,
        amountPaid: 0,
        balanceRemaining: 0,
        paymentStatus: "unpaid",
        payments: [],
      }),
    ]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /Pay Online with Stripe/i })).toBeInTheDocument();
  });

  test("shows Stripe action for unpaid overdue invoice with stored balanceRemaining 0", () => {
    seedInvoices([
      createSentInvoice({
        id: "inv_overdue_no_payments",
        invoiceTotal: 750,
        total: 750,
        amountPaid: 0,
        balanceRemaining: 0,
        status: "overdue",
        paymentStatus: "overdue",
        payments: [],
      }),
    ]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /Pay Online with Stripe/i })).toBeInTheDocument();
  });

  test("Stripe checkout payload uses derived balanceRemaining for fresh invoice with stored 0", async () => {
    const freshInvoice = createSentInvoice({
      id: "inv_fresh_stripe_payload",
      invoiceTotal: 600,
      total: 600,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: "unpaid",
      payments: [],
    });
    seedInvoices([freshInvoice]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/fresh-session",
        sessionId: "cs_fresh_123",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    // Derived balance = invoiceTotal(600) - amountPaid(0) = 600, not the stored 0
    expect(payload.balanceRemaining).toBe(600);
    expect(payload.balanceRemaining).not.toBe(0);
    expect(payload.idempotencyKey).toMatch(/^estipaid-checkout-[a-f0-9]+-[a-f0-9]+$/i);
    expect(window.location.href).toBe("http://localhost/");
    // Storage must be unchanged
    expect(readStoredInvoices()).toEqual(before);
  });

  test("Stripe checkout keeps the current EstiPaid tab in place when the popup handle is unavailable", async () => {
    const sourceInvoice = createSentInvoice();
    seedInvoices([sourceInvoice]);
    window.open = jest.fn(() => null);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/blocked-session",
        sessionId: "cs_blocked_123",
      }),
    });

    const before = readStoredInvoices();
    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/blocked-session",
      "_blank",
      "noopener,noreferrer"
    );
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Copy Payment Link"));
    expect(window.location.href).toBe("http://localhost/");
    expect(readStoredInvoices()).toEqual(before);
    expect(readStripeCheckoutSessions()).toEqual([
      expect.objectContaining({
        sessionId: "cs_blocked_123",
        checkoutUrl: "https://checkout.stripe.com/pay/blocked-session",
        status: "pending",
      }),
    ]);
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
    expect(readStripeCheckoutCreateLocks()).toEqual({});
  });
});

describe("InvoicesScreen Copy Payment Link action", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
    window.history.replaceState({}, "", "/");
    // Provide a working clipboard mock
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    window.history.replaceState({}, "", "/");
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    jest.useRealTimers();
  });

  test("Copy Payment Link button is visible for eligible sent invoice", () => {
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByRole("button", { name: /Copy Payment Link/i })).toBeInTheDocument();
  });

  test("Copy Payment Link is hidden without stripeAccountId and connect notice is shown", () => {
    seedCompanyProfile({ stripeAccountId: "" });
    seedInvoices([createSentInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pay Online with Stripe/i })).toBeNull();
    expect(screen.getByText(/Connect Stripe in Company Profile to accept online payments\./i)).toBeInTheDocument();
  });

  test("Copy Payment Link is hidden for draft invoice", () => {
    seedInvoices([createSentInvoice({ id: "inv_draft_copy", status: "draft" })]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
  });

  test("Copy Payment Link is hidden for void invoice", () => {
    seedInvoices([createSentInvoice({ id: "inv_void_copy", status: "void", paymentStatus: "void", balanceRemaining: 0 })]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
  });

  test("Copy Payment Link is hidden for paid invoice", () => {
    seedInvoices([createPaidInvoice()]);
    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.queryByRole("button", { name: /Copy Payment Link/i })).toBeNull();
  });

  test("Copy Payment Link calls backend with normalized balanceRemaining and copies URL to clipboard", async () => {
    const sourceInvoice = createSentInvoice({
      id: "inv_copy_link_test",
      invoiceTotal: 800,
      total: 800,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: "unpaid",
      payments: [],
    });
    seedInvoices([sourceInvoice]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/copy-session",
        sessionId: "cs_copy_123",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/stripe/create-checkout-session",
      expect.objectContaining({ method: "POST" })
    );
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.stripeAccountId).toBe("acct_test_connected_123");
    // Derived: invoiceTotal(800) - amountPaid(0) = 800, not stored 0
    expect(payload.balanceRemaining).toBe(800);
    expect(payload.idempotencyKey).toMatch(/^estipaid-checkout-[a-f0-9]+-[a-f0-9]+$/i);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/copy-session");
    expect(window.open).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
    // Storage must be unchanged
    expect(readStoredInvoices()).toEqual(before);
    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(0);
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.paymentStatus).toBe("unpaid");
    expect(invoice.status).toBe("sent");
    expect(readStripeCheckoutSessions()).toEqual([
      expect.objectContaining({
        invoiceId: "inv_copy_link_test",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_copy_123",
        checkoutUrl: "https://checkout.stripe.com/pay/copy-session",
        amount: 800,
        currency: "usd",
        status: "pending",
      }),
    ]);
    expect(readStripeCheckoutCreateLocks()).toEqual({});
  });

  test("Copy Payment Link reuses existing pending unexpired same-balance session without backend call", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_copy_reuse_123",
        checkoutUrl: "https://checkout.stripe.com/pay/copy-reuse-existing",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 2714694400,
        status: "pending",
      },
    ]);

    const beforeInvoices = readStoredInvoices();
    const beforeSessions = readStripeCheckoutSessions();
    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/copy-reuse-existing");
    expect(screen.getByText(/Using existing active Stripe link for this invoice balance\./i)).toBeInTheDocument();
    expect(readStoredInvoices()).toEqual(beforeInvoices);
    expect(readStripeCheckoutSessions()).toEqual(beforeSessions);
  });

  test("balance-changed session is not reused and Copy Payment Link creates a fresh session", async () => {
    seedInvoices([
      createSentInvoice({
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
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_old_balance_123",
        checkoutUrl: "https://checkout.stripe.com/pay/old-balance",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 2714694400,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/new-balance-link",
        sessionId: "cs_new_balance_123",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/new-balance-link");
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_new_balance_123",
      amount: 375,
      checkoutUrl: "https://checkout.stripe.com/pay/new-balance-link",
      status: "pending",
    }));
    expect(readStripeCheckoutSessions()[1]).toEqual(expect.objectContaining({
      sessionId: "cs_old_balance_123",
      status: "stale",
      amount: 500,
    }));
  });

  test("idempotencyKey changes when balance changes", async () => {
    const firstInvoice = createSentInvoice({
      id: "inv_balance_key",
      invoiceNumber: "INV-BAL-1",
      invoiceTotal: 500,
      total: 500,
      amountPaid: 0,
      balanceRemaining: 500,
      paymentStatus: "unpaid",
      payments: [],
    });
    seedInvoices([firstInvoice]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/balance-key-1",
        sessionId: "cs_balance_key_1",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    const firstPayload = JSON.parse(global.fetch.mock.calls[0][1].body);

    cleanup();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    seedInvoices([
      createSentInvoice({
        id: "inv_balance_key",
        invoiceNumber: "INV-BAL-1",
        invoiceTotal: 500,
        total: 500,
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_balance_key",
            amount: 125,
            paidAt: "2026-05-05",
            method: "cash",
            note: "Deposit",
            order: 0,
          },
        ],
      }),
    ]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/balance-key-2",
        sessionId: "cs_balance_key_2",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    const secondPayload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(firstPayload.idempotencyKey).not.toBe(secondPayload.idempotencyKey);
    expect(firstPayload.balanceRemaining).toBe(500);
    expect(secondPayload.balanceRemaining).toBe(375);
  });

  test("idempotencyKey changes when forcing a fresh session after expired or stale refs", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_expired_key_old",
        checkoutUrl: "https://checkout.stripe.com/pay/expired-key-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 1714694400,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/expired-key-new",
        sessionId: "cs_expired_key_new",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });
    const firstPayload = JSON.parse(global.fetch.mock.calls[0][1].body);

    cleanup();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_stale_key_old",
        checkoutUrl: "https://checkout.stripe.com/pay/stale-key-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "stale",
      },
    ]);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/stale-key-new",
        sessionId: "cs_stale_key_new",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });
    const secondPayload = JSON.parse(global.fetch.mock.calls[1][1].body);

    expect(firstPayload.idempotencyKey).not.toBe(secondPayload.idempotencyKey);
  });

  test("stale session is not reused by Pay Online", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_stale_pay_online",
        checkoutUrl: "https://checkout.stripe.com/pay/stale-pay-online",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "stale",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/fresh-after-stale",
        sessionId: "cs_fresh_after_stale",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pay Online with Stripe/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/fresh-after-stale",
      "_blank",
      "noopener,noreferrer"
    );
  });

  test("synced session is not reused for a new payment link", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_synced_old_123",
        checkoutUrl: "https://checkout.stripe.com/pay/synced-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "synced",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/new-after-synced",
        sessionId: "cs_new_after_synced",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/new-after-synced");
  });

  test("review session is not reused for a new payment link", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_review_old_123",
        checkoutUrl: "https://checkout.stripe.com/pay/review-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "review",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/new-after-review",
        sessionId: "cs_new_after_review",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/new-after-review");
  });

  test("stale session is not reused by Copy Payment Link", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_copy_stale_123",
        checkoutUrl: "https://checkout.stripe.com/pay/copy-stale",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "stale",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/copy-fresh-after-stale",
        sessionId: "cs_copy_fresh_after_stale",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/copy-fresh-after-stale");
  });

  test("Copy Payment Link clipboard fallback shows URL in alert without mutating storage", async () => {
    // Clipboard unavailable
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("Not allowed")) },
      writable: true,
      configurable: true,
    });
    const sourceInvoice = createSentInvoice({
      id: "inv_copy_fallback",
      invoiceTotal: 300,
      total: 300,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: "unpaid",
      payments: [],
    });
    seedInvoices([sourceInvoice]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checkoutUrl: "https://checkout.stripe.com/pay/fallback-session",
        sessionId: "cs_fallback_123",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    // Alert should contain the checkout URL so user can copy manually
    expect(window.alert).toHaveBeenCalled();
    const alertArg = window.alert.mock.calls[0][0];
    expect(alertArg).toContain("https://checkout.stripe.com/pay/fallback-session");
    expect(window.open).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
    // Storage must be unchanged
    expect(readStoredInvoices()).toEqual(before);
  });

  test("Copy Payment Link failure does not mutate invoice storage", async () => {
    const sourceInvoice = createSentInvoice({
      id: "inv_copy_fail",
      invoiceTotal: 500,
      total: 500,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: "unpaid",
      payments: [],
    });
    seedInvoices([sourceInvoice]);
    global.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Stripe not configured." }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Payment Link/i }));
    });

    expect(window.alert).toHaveBeenCalledWith("Stripe not configured.");
    expect(window.open).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
    expect(readStoredInvoices()).toEqual(before);
    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(0);
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.status).toBe("sent");
    expect(readStripeCheckoutCreateLocks()).toEqual({});
  });
});

describe("InvoicesScreen Stripe payment sync", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    window.history.replaceState({}, "", "/");
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    jest.useRealTimers();
  });

  test("pending session shows Stripe session panel and Check / Sync does not mutate invoice when unpaid", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_pending_123",
        checkoutUrl: "https://checkout.stripe.com/pay/pending",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_pending_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "unpaid",
        status: "open",
        amountTotal: 50000,
        currency: "usd",
        paymentIntentId: "",
        paidAt: "",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    expect(screen.getByText(/Stripe session/i)).toBeInTheDocument();
    expect(screen.getByText(/^Pending$/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending means a Stripe link was generated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy Existing Stripe Link/i })).toBeInTheDocument();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/stripe/retrieve-checkout-session",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      sessionId: "cs_pending_123",
      stripeAccountId: "acct_test_connected_123",
    });
    expect(readStoredInvoices()).toEqual(before);
    expect(screen.getByText(/This Stripe payment has not completed yet\./i)).toBeInTheDocument();
  });

  test("Copy Existing Stripe Link copies stored checkoutUrl without creating a new session", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_existing_123",
        checkoutUrl: "https://checkout.stripe.com/pay/existing-link",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Existing Stripe Link/i }));
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://checkout.stripe.com/pay/existing-link");
    expect(window.open).not.toHaveBeenCalled();
    expect(window.location.href).toBe("http://localhost/");
    expect(readStripeCheckoutSessions()).toEqual([
      expect.objectContaining({
        sessionId: "cs_existing_123",
        checkoutUrl: "https://checkout.stripe.com/pay/existing-link",
        status: "pending",
      }),
    ]);
  });

  test("paid Stripe session appends one stripe payment and normalizes invoice totals", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_paid_123",
        checkoutUrl: "https://checkout.stripe.com/pay/paid",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_paid_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 20000,
        currency: "usd",
        receiptEmail: "payer@example.com",
        receiptUrl: "https://pay.stripe.com/receipts/acct_123/ch_123",
        paymentIntentId: "pi_paid_123",
        paymentMethodType: "card",
        cardBrand: "visa",
        cardLast4: "4242",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]).toEqual(expect.objectContaining({
      method: "stripe",
      note: "Stripe Checkout",
      amount: 200,
      stripeSessionId: "cs_paid_123",
      stripePaymentIntentId: "pi_paid_123",
      stripeAccountId: "acct_test_connected_123",
      paymentMethodType: "card",
      cardBrand: "visa",
      cardLast4: "4242",
      receiptEmail: "payer@example.com",
      receiptUrl: "https://pay.stripe.com/receipts/acct_123/ch_123",
      stripePaymentStatus: "paid",
      currency: "usd",
    }));
    expect(invoice.amountPaid).toBe(200);
    expect(invoice.balanceRemaining).toBe(300);
    expect(invoice.paymentStatus).toBe("partial");
    expect(screen.getByText(/Stripe payment recorded successfully\./i)).toBeInTheDocument();
    expect(screen.getByText(/Stripe payment synced successfully\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open synced invoice/i })).toBeInTheDocument();
    expect(screen.getByText(/^Synced$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Stripe$/i)).toBeInTheDocument();
    expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
    expect(screen.getByText("payer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Stripe receipt/i })).toHaveAttribute("href", "https://pay.stripe.com/receipts/acct_123/ch_123");
    expect(screen.queryByText(/pi_paid_123/i)).toBeNull();
    expect(screen.queryByText(/cs_paid_123/i)).toBeNull();
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_paid_123",
      status: "synced",
      paymentIntentId: "pi_paid_123",
    }));
  });

  test("manual and Stripe payments coexist and final Stripe payoff marks invoice paid without double-counting", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_manual_1",
            amount: 125,
            paidAt: "2026-05-05",
            note: "Deposit",
            method: "cash",
            order: 0,
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_payoff_123",
        checkoutUrl: "https://checkout.stripe.com/pay/payoff",
        amount: 375,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_payoff_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 37500,
        currency: "usd",
        paymentIntentId: "pi_payoff_123",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(2);
    expect(invoice.amountPaid).toBe(500);
    expect(invoice.balanceRemaining).toBe(0);
    expect(invoice.paymentStatus).toBe("paid");
    expect(invoice.status).toBe("paid");
  });

  test("duplicate sync is blocked by matching stripePaymentIntentId", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 200,
        balanceRemaining: 300,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_stripe_existing",
            amount: 200,
            paidAt: "2026-05-05",
            note: "Stripe Checkout",
            method: "stripe",
            order: 0,
            stripeSessionId: "cs_old",
            stripePaymentIntentId: "pi_duplicate",
            stripeAccountId: "acct_test_connected_123",
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_duplicate_new",
        checkoutUrl: "https://checkout.stripe.com/pay/duplicate",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_duplicate_new",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 20000,
        currency: "usd",
        paymentIntentId: "pi_duplicate",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(1);
    expect(screen.getAllByText(/Payment details were refreshed\./i).length).toBeGreaterThan(0);
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_duplicate_new",
      status: "synced",
    }));
  });

  test("duplicate sync is blocked by matching stripeSessionId", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 200,
        balanceRemaining: 300,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_stripe_existing_session",
            amount: 200,
            paidAt: "2026-05-05",
            note: "Stripe Checkout",
            method: "stripe",
            order: 0,
            stripeSessionId: "cs_duplicate_session",
            stripePaymentIntentId: "pi_existing",
            stripeAccountId: "acct_test_connected_123",
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_duplicate_session",
        checkoutUrl: "https://checkout.stripe.com/pay/duplicate-session",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_duplicate_session",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 20000,
        currency: "usd",
        paymentIntentId: "pi_new_duplicate_session",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(1);
    expect(screen.getByText(/^Synced$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeInTheDocument();
  });

  test("duplicate sync backfills safe Stripe payment details without changing invoice accounting", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 500,
        balanceRemaining: 0,
        paymentStatus: "paid",
        status: "paid",
        payments: [
          {
            id: "pay_stripe_backfill",
            amount: 500,
            paidAt: "2026-05-06T12:00:00.000Z",
            note: "Stripe Checkout",
            method: "stripe",
            order: 0,
            stripeSessionId: "cs_backfill_123",
            stripePaymentIntentId: "pi_backfill_123",
            stripeAccountId: "acct_test_connected_123",
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_backfill_123",
        checkoutUrl: "https://checkout.stripe.com/pay/backfill",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "synced",
        paymentIntentId: "pi_backfill_123",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_backfill_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 50000,
        currency: "usd",
        receiptEmail: "payer@example.com",
        receiptUrl: "https://pay.stripe.com/receipts/acct_123/ch_backfill",
        paymentIntentId: "pi_backfill_123",
        paymentMethodType: "card",
        cardBrand: "visa",
        cardLast4: "4242",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    const invoice = readStoredInvoices()[0];
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.amountPaid).toBe(500);
    expect(invoice.balanceRemaining).toBe(0);
    expect(invoice.paymentStatus).toBe("paid");
    expect(invoice.status).toBe("paid");
    expect(invoice.payments[0]).toEqual(expect.objectContaining({
      paymentMethodType: "card",
      cardBrand: "visa",
      cardLast4: "4242",
      receiptEmail: "payer@example.com",
      receiptUrl: "https://pay.stripe.com/receipts/acct_123/ch_backfill",
      stripePaymentStatus: "paid",
      currency: "usd",
    }));
    expect(screen.getAllByText(/Payment details were refreshed\./i).length).toBeGreaterThan(0);
    expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View Stripe receipt/i })).toHaveAttribute("href", "https://pay.stripe.com/receipts/acct_123/ch_backfill");
  });

  test("final Stripe sync keeps confirmation visible and reveals the invoice in Paid on demand", async () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_paid_full_123",
        checkoutUrl: "https://checkout.stripe.com/pay/full",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_paid_full_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 50000,
        currency: "usd",
        paymentIntentId: "pi_paid_full_123",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    setInvoiceStatusFilter("sent");
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    expect(screen.getByText(/Payment synced\. Invoice moved to Paid\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View in Paid/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /View in Paid/i }));
    });

    const [statusSelect] = screen.getAllByRole("combobox");
    expect(statusSelect).toHaveValue("paid");
    expect(screen.getByRole("button", { name: /^Hide$/i })).toBeInTheDocument();
    expect(screen.getByText(/Stripe payment recorded and invoice is now paid\./i)).toBeInTheDocument();
  });

  test("successful Stripe sync retires other pending sessions that are now stale", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_manual_sync_retire",
            amount: 125,
            paidAt: "2026-05-05",
            note: "Deposit",
            method: "cash",
            order: 0,
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_sync_target_123",
        checkoutUrl: "https://checkout.stripe.com/pay/sync-target",
        amount: 375,
        currency: "usd",
        createdAt: 1714694500000,
        status: "pending",
      },
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_sync_old_123",
        checkoutUrl: "https://checkout.stripe.com/pay/sync-old",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_sync_target_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 37500,
        currency: "usd",
        paymentIntentId: "pi_sync_target_123",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    const sessions = readStripeCheckoutSessions();
    expect(sessions.find((entry) => entry.sessionId === "cs_sync_target_123")).toEqual(expect.objectContaining({
      status: "synced",
      paymentIntentId: "pi_sync_target_123",
    }));
    expect(sessions.find((entry) => entry.sessionId === "cs_sync_old_123")).toEqual(expect.objectContaining({
      status: "stale",
      amount: 500,
    }));
  });

  test("manual payment ledger rendering stays unchanged without Stripe-only details", () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 125,
        balanceRemaining: 375,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_manual_cash",
            amount: 125,
            paidAt: "2026-05-05",
            note: "Cash deposit",
            method: "cash",
            order: 0,
          },
        ],
      }),
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();

    expect(screen.getByText("Cash deposit")).toBeInTheDocument();
    expect(screen.getByText(/^Cash$/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View Stripe receipt/i })).toBeNull();
    expect(screen.queryByText(/4242/i)).toBeNull();
  });

  test("stale-balance overpayment is blocked without invoice mutation and session is marked review", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 450,
        balanceRemaining: 50,
        paymentStatus: "partial",
        payments: [
          {
            id: "pay_manual_2",
            amount: 450,
            paidAt: "2026-05-05",
            note: "Large deposit",
            method: "cash",
            order: 0,
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_review_123",
        checkoutUrl: "https://checkout.stripe.com/pay/review",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "cs_review_123",
        stripeAccountId: "acct_test_connected_123",
        paymentStatus: "paid",
        status: "complete",
        amountTotal: 20000,
        currency: "usd",
        paymentIntentId: "pi_review_123",
        paidAt: "2026-05-06T12:00:00.000Z",
      }),
    });

    renderInvoicesScreen();
    openInvoiceDetails();

    const before = readStoredInvoices();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i }));
    });

    expect(readStoredInvoices()).toEqual(before);
    expect(screen.getByText(/The Stripe amount exceeds the current remaining balance\. Review it manually before recording it\./i)).toBeInTheDocument();
    expect(readStripeCheckoutSessions()[0]).toEqual(expect.objectContaining({
      sessionId: "cs_review_123",
      status: "review",
      paymentIntentId: "pi_review_123",
    }));
  });

  test("synced session state remains visible in the Stripe session panel", () => {
    seedInvoices([createSentInvoice({ amountPaid: 200, balanceRemaining: 300, paymentStatus: "partial" })]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_synced_panel",
        checkoutUrl: "https://checkout.stripe.com/pay/synced-panel",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "synced",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByText(/^Synced$/i)).toBeInTheDocument();
    expect(screen.getByText(/already been recorded in EstiPaid/i)).toBeInTheDocument();
  });

  test("stale pending session ref displays synced when matching Stripe ledger payment already exists", () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 500,
        balanceRemaining: 0,
        paymentStatus: "paid",
        status: "paid",
        payments: [
          {
            id: "pay_stripe_existing",
            amount: 500,
            paidAt: "2026-05-06T12:00:00.000Z",
            note: "Stripe Checkout",
            method: "stripe",
            order: 0,
            stripeSessionId: "cs_stale_pending_123",
            stripePaymentIntentId: "pi_stale_pending_123",
            stripeAccountId: "acct_test_connected_123",
          },
        ],
      }),
    ]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_stale_pending_123",
        checkoutUrl: "https://checkout.stripe.com/pay/stale-pending",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
        paymentIntentId: "pi_stale_pending_123",
      },
    ]);

    const beforeInvoices = readStoredInvoices();
    const beforeSessions = readStripeCheckoutSessions();
    renderInvoicesScreen();
    openInvoiceDetails();

    expect(screen.getByText(/^Synced$/i)).toBeInTheDocument();
    expect(screen.getByText(/already been recorded in EstiPaid/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy Existing Stripe Link/i })).toBeNull();
    expect(readStoredInvoices()).toEqual(beforeInvoices);
    expect(readStripeCheckoutSessions()).toEqual(beforeSessions);
  });

  test("review session state remains visible in the Stripe session panel", () => {
    seedInvoices([createSentInvoice({ amountPaid: 200, balanceRemaining: 300, paymentStatus: "partial" })]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_review_panel",
        checkoutUrl: "https://checkout.stripe.com/pay/review-panel",
        amount: 200,
        currency: "usd",
        createdAt: 1714694400000,
        status: "review",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    expect(screen.getByText(/^Review$/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be safely recorded automatically/i)).toBeInTheDocument();
  });

  test("expired session shows expired state and fresh-link guidance", () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_expired_123",
        checkoutUrl: "https://checkout.stripe.com/pay/expired",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        expiresAt: 1714694400,
        status: "pending",
      },
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();

    expect(screen.getByText(/^Expired$/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate a fresh link if the customer still needs to pay\./i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy Existing Stripe Link/i })).toBeNull();
  });

  test("void still clears synced Stripe and manual payments", async () => {
    seedInvoices([
      createSentInvoice({
        amountPaid: 500,
        balanceRemaining: 0,
        paymentStatus: "paid",
        status: "paid",
        payments: [
          {
            id: "pay_manual_3",
            amount: 125,
            paidAt: "2026-05-05",
            note: "Deposit",
            method: "cash",
            order: 0,
          },
          {
            id: "pay_stripe_3",
            amount: 375,
            paidAt: "2026-05-06",
            note: "Stripe Checkout",
            method: "stripe",
            order: 1,
            stripeSessionId: "cs_void_123",
            stripePaymentIntentId: "pi_void_123",
            stripeAccountId: "acct_test_connected_123",
          },
        ],
      }),
    ]);

    renderInvoicesScreen();
    openInvoiceDetails();
    fireEvent.click(screen.getByRole("button", { name: /^Void$/i }));
    const dialog = screen.getByRole("dialog", { name: /Void this invoice\?/i });
    await clickAndFlush(within(dialog).getByRole("button", { name: /^Void Invoice$/i }));

    const invoice = readStoredInvoices()[0];
    expect(invoice.status).toBe("void");
    expect(invoice.paymentStatus).toBe("void");
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.balanceRemaining).toBe(0);
    expect(invoice.payments).toEqual([]);
  });
});

describe("InvoicesScreen Stripe return notices", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    seedCompanyProfile({ stripeAccountId: "acct_test_connected_123" });
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    window.history.replaceState({}, "", "/");
    jest.useRealTimers();
  });

  test("Stripe success return prompts manual sync when matching local session exists", () => {
    seedInvoices([createSentInvoice()]);
    seedStripeCheckoutSessions([
      {
        invoiceId: "inv_sent_payment",
        invoiceNumber: "INV-SENT-1",
        stripeAccountId: "acct_test_connected_123",
        sessionId: "cs_return_paid",
        checkoutUrl: "https://checkout.stripe.com/pay/return-paid",
        amount: 500,
        currency: "usd",
        createdAt: 1714694400000,
        status: "pending",
      },
    ]);
    window.history.replaceState({}, "", "/?stripe=success&invoiceId=inv_sent_payment&session_id=cs_return_paid");

    const before = readStoredInvoices();
    renderInvoicesScreen();

    expect(screen.getByRole("button", { name: /^Hide$/i })).toBeInTheDocument();
    expect(screen.getByText(/Stripe received the payment\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Check \/ Sync Stripe Payment/i })).toBeInTheDocument();
    expect(readStoredInvoices()).toEqual(before);
  });

  test("Stripe success return warns when the local session reference is missing", () => {
    seedInvoices([createSentInvoice()]);
    window.history.replaceState({}, "", "/?stripe=success&invoiceId=inv_sent_payment&session_id=cs_missing_local");

    const before = readStoredInvoices();
    renderInvoicesScreen();

    expect(screen.getByRole("button", { name: /^Hide$/i })).toBeInTheDocument();
    expect(screen.getByText(/does not have the local session reference/i)).toBeInTheDocument();
    expect(readStoredInvoices()).toEqual(before);
  });
});
