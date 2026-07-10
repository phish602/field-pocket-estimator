import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function createInvoice(overrides = {}) {
  return {
    id: "inv_test",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-1001",
    customerId: "cust_1",
    customerName: "Invoice Customer",
    projectName: "Invoice Project",
    invoiceTotal: 250,
    total: 250,
    amountPaid: 0,
    balanceRemaining: 250,
    status: "draft",
    paymentStatus: "unpaid",
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
  render(
    <InvoicesScreen
      lang="en"
      t={(key) => key}
    />
  );

  act(() => {
    jest.advanceTimersByTime(300);
  });
}

async function openInvoiceDetails() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Details/i }));
  });
}

async function archiveInvoice() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Archive Invoice/i }));
    await Promise.resolve();
  });
}

async function restoreInvoice() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Restore Invoice/i }));
    await Promise.resolve();
  });
}

describe("InvoicesScreen archive safety", () => {
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

  test("even a disposable draft invoice is archived instead of deleted", async () => {
    seedInvoices([
      createInvoice({
        id: "inv_disposable_draft",
        invoiceNumber: "INV-DRAFT-1",
        customerId: "",
        customerName: "",
        projectId: "",
        projectName: "",
      }),
    ]);

    renderInvoicesScreen();
    await openInvoiceDetails();
    await archiveInvoice();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(readStoredInvoices()).toHaveLength(1);
    expect(readStoredInvoices()[0]).toMatchObject({
      id: "inv_disposable_draft",
      archived: true,
    });
    expect(typeof readStoredInvoices()[0].archivedAt).toBe("string");
  });

  test("linked invoices archive without altering their financial history", async () => {
    const linkedInvoice = createInvoice({
      id: "inv_linked_history",
      invoiceNumber: "INV-LINKED-1",
      projectId: "proj_1",
      projectName: "Linked Project",
      sourceEstimateId: "est_1",
      sourceEstimateSnapshot: {
        estimateId: "est_1",
        estimateNumber: "EST-1",
        projectId: "proj_1",
      },
    });
    seedInvoices([linkedInvoice]);

    renderInvoicesScreen();
    await openInvoiceDetails();
    await archiveInvoice();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(readStoredInvoices()[0]).toMatchObject({
      id: "inv_linked_history",
      sourceEstimateId: "est_1",
      invoiceTotal: 250,
      amountPaid: 0,
      balanceRemaining: 250,
      status: "draft",
      paymentStatus: "unpaid",
      archived: true,
    });
  });

  test("sent invoices archive without changing their status or balance", async () => {
    const sentInvoice = createInvoice({
      id: "inv_sent_history",
      invoiceNumber: "INV-SENT-1",
      projectId: "",
      projectName: "Sent Invoice",
      status: "sent",
      paymentStatus: "unpaid",
    });
    seedInvoices([sentInvoice]);

    renderInvoicesScreen();
    await openInvoiceDetails();
    await archiveInvoice();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(readStoredInvoices()[0]).toMatchObject({
      id: "inv_sent_history",
      invoiceTotal: 250,
      amountPaid: 0,
      archived: true,
      status: "sent",
      paymentStatus: "unpaid",
      balanceRemaining: 250,
    });
  });

  test("archived invoices are hidden by default, shown with an Archived badge, and can be restored", async () => {
    seedInvoices([createInvoice({ archived: true, archivedAt: "2026-07-10T00:00:00.000Z" })]);

    renderInvoicesScreen();

    expect(screen.queryByText("Invoice Project")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Show archived/i }));
    });
    expect(screen.getByText("Invoice Project")).toBeInTheDocument();
    expect(screen.getByText(/^Archived$/i)).toBeInTheDocument();

    await openInvoiceDetails();
    await restoreInvoice();

    expect(readStoredInvoices()[0].archived).toBeUndefined();
    expect(readStoredInvoices()[0].archivedAt).toBeUndefined();
  });
});
