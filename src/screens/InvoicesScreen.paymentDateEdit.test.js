import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitStoredInvoices } from "../utils/invoices";
import { useBusinessMutationGuard } from "../lib/BusinessMutationGuardContext";

jest.mock("../utils/invoices", () => {
  const actual = jest.requireActual("../utils/invoices");
  return {
    ...actual,
    commitStoredInvoices: jest.fn(async (invoices) => ({ invoices })),
  };
});

jest.mock("../lib/BusinessMutationGuardContext", () => ({
  useBusinessMutationGuard: jest.fn(),
}));

function seedInvoice() {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{
    id: "inv_payment_date_ui",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-DATE-1",
    customerId: "cust_1",
    customerName: "Date Customer",
    projectName: "Date Project",
    invoiceTotal: 500,
    total: 500,
    amountPaid: 125,
    balanceRemaining: 375,
    status: "sent",
    paymentStatus: "partial",
    lineItems: [{ id: "line_1", description: "Labor", total: 500 }],
    payments: [{
      id: "pay_payment_date_ui",
      amount: 125,
      paidAt: "2026-08-10",
      method: "check",
      note: "Deposit check",
      order: 0,
    }],
    updatedAt: 1,
    createdAt: 1,
    savedAt: 1,
    ts: 1,
  }]));
}

describe("InvoicesScreen payment date editing", () => {
  let ensureCanMutateBusinessData;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    jest.clearAllMocks();
    commitStoredInvoices.mockImplementation(async (invoices) => ({ invoices }));
    ensureCanMutateBusinessData = jest.fn(async () => ({ ok: true }));
    useBusinessMutationGuard.mockReturnValue({ ensureCanMutateBusinessData });
    seedInvoice();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    localStorage.clear();
  });

  test("uses the existing payment owner and guarded persistInvoices path for a date-only correction", async () => {
    render(<InvoicesScreen />);
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit payment date for pay_payment_date_ui" }));
    fireEvent.change(screen.getByLabelText("Payment date for pay_payment_date_ui"), { target: { value: "2026-08-11" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Date" }));
      await Promise.resolve();
    });

    expect(ensureCanMutateBusinessData).toHaveBeenCalledWith("local_save");
    await waitFor(() => {
      expect(commitStoredInvoices).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "inv_payment_date_ui",
          invoiceTotal: 500,
          amountPaid: 125,
          balanceRemaining: 375,
          payments: [expect.objectContaining({
            id: "pay_payment_date_ui",
            amount: 125,
            method: "check",
            paidAt: "2026-08-11",
          })],
        }),
      ], { source: "InvoicesScreen.persistInvoices" });
    });
  });
});
