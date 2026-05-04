import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function createEstimate(overrides = {}) {
  return {
    id: "est_test",
    docType: "estimate",
    estimateNumber: "EST-1001",
    projectName: "Test Project",
    customerName: "Test Customer",
    customerId: "cust_1",
    status: "pending",
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
    savedAt: 1714694400000,
    ts: 1714694400000,
    ...overrides,
  };
}

function createLinkedInvoice(estimateId, overrides = {}) {
  return {
    id: "inv_linked",
    docType: "invoice",
    invoiceNumber: "INV-1001",
    sourceEstimateId: estimateId,
    sourceEstimateSnapshot: { estimateId },
    customerName: "Test Customer",
    status: "draft",
    ...overrides,
  };
}

function seedEstimates(estimates) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}

function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function readStoredEstimates() {
  const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
  const arr = raw ? JSON.parse(raw) : [];
  return (Array.isArray(arr) ? arr : []).filter(
    (e) => String(e?.docType || "estimate").toLowerCase() !== "invoice",
  );
}

function renderEstimatesScreen(history = []) {
  render(<EstimatesScreen lang="en" t={(k) => k} history={history} />);
  act(() => {
    jest.advanceTimersByTime(300);
  });
}

function expandCard() {
  fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
}

function clickStatusButton(statusName) {
  const buttonName = statusName === "approved" ? /Mark Approved/i
    : statusName === "lost" ? /Mark Lost/i
    : /Reset to Pending/i;
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
}

describe("EstimatesScreen status reversion guard", () => {
  let alertSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("approved estimate with no linked invoices can be reverted to pending", () => {
    const estimate = createEstimate({ status: "approved" });
    seedEstimates([estimate]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("pending");

    expect(alertSpy).not.toHaveBeenCalled();
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("pending");
  });

  test("approved estimate with linked invoice cannot be reverted to pending", () => {
    const estimate = createEstimate({ status: "approved" });
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("pending");

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot revert/i);
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });

  test("approved estimate with linked invoice cannot be reverted to lost", () => {
    const estimate = createEstimate({ status: "approved" });
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("lost");

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot revert/i);
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });

  test("pending estimate can be moved to approved", () => {
    const estimate = createEstimate({ status: "pending" });
    seedEstimates([estimate]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("approved");

    expect(alertSpy).not.toHaveBeenCalled();
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });

  test("approved estimate can still be set to approved", () => {
    const estimate = createEstimate({ status: "approved" });
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("approved");

    expect(alertSpy).not.toHaveBeenCalled();
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });

  test("lost estimate with linked invoice can be reverted to approved", () => {
    const estimate = createEstimate({ status: "lost" });
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("approved");

    expect(alertSpy).not.toHaveBeenCalled();
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });

  test("approved estimate with only void linked invoices can be reverted to pending", () => {
    const estimate = createEstimate({ status: "approved" });
    const voidInvoice = createLinkedInvoice("est_test", {
      id: "inv_void",
      invoiceNumber: "INV-VOID-ONLY",
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    seedEstimates([estimate]);
    seedInvoices([voidInvoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("pending");

    expect(alertSpy).not.toHaveBeenCalled();
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("pending");
  });

  test("approved estimate with mixed void and active linked invoices cannot be reverted", () => {
    const estimate = createEstimate({ status: "approved" });
    const voidInvoice = createLinkedInvoice("est_test", {
      id: "inv_void_mix",
      invoiceNumber: "INV-VOID-MIX",
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const activeInvoice = createLinkedInvoice("est_test", {
      id: "inv_active_mix",
      invoiceNumber: "INV-ACTIVE-MIX",
      status: "sent",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 500,
    });
    seedEstimates([estimate]);
    seedInvoices([voidInvoice, activeInvoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickStatusButton("pending");

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot revert/i);
    const stored = readStoredEstimates();
    expect(stored[0].status).toBe("approved");
  });
});
