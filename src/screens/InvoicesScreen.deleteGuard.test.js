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

function openInvoiceDetails() {
  fireEvent.click(screen.getByRole("button", { name: /Details/i }));
}

describe("InvoicesScreen delete guard", () => {
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

  test("disposable draft invoice can still be deleted", () => {
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
  openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(readStoredInvoices()).toEqual([]);
    expect(screen.getByText(/No invoices yet/i)).toBeInTheDocument();
  });

  test("linked invoice delete is blocked and storage remains unchanged", () => {
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
    openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("This invoice is part of project/financial history and cannot be deleted.");
    expect(readStoredInvoices()).toEqual([linkedInvoice]);
    expect(screen.getByText("Linked Project")).toBeInTheDocument();
  });

  test("non-draft invoice delete is blocked and storage remains unchanged", () => {
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
    openInvoiceDetails();

    fireEvent.click(screen.getByRole("button", { name: /Delete/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("This invoice is part of project/financial history and cannot be deleted.");
    expect(readStoredInvoices()).toEqual([sentInvoice]);
    expect(screen.getByText("Sent Invoice")).toBeInTheDocument();
  });
});