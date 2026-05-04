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

function readStoredInvoices() {
  const raw = localStorage.getItem(STORAGE_KEYS.INVOICES);
  return raw ? JSON.parse(raw) : [];
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

function clickPanelDelete() {
  fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
}

function confirmDelete() {
  const dialog = screen.getByRole("dialog", { name: /Delete estimate/i });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
}

describe("EstimatesScreen delete guard", () => {
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

  test("unlinked estimate can still be deleted", () => {
    const estimate = createEstimate();
    seedEstimates([estimate]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickPanelDelete();
    confirmDelete();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(readStoredEstimates()).toEqual([]);
  });

  test("estimate linked to an invoice is blocked and estimate storage remains unchanged", () => {
    const estimate = createEstimate();
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickPanelDelete();
    confirmDelete();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot delete/i);
    expect(alertSpy.mock.calls[0][0]).toMatch(/invoice/i);
    expect(readStoredEstimates()).toEqual([estimate]);
  });

  test("linked invoice storage remains unchanged after blocked delete", () => {
    const estimate = createEstimate();
    const invoice = createLinkedInvoice("est_test");
    seedEstimates([estimate]);
    seedInvoices([invoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickPanelDelete();
    confirmDelete();

    expect(readStoredInvoices()).toEqual([invoice]);
  });

  test("estimate linked to a void invoice is also blocked by default", () => {
    const estimate = createEstimate();
    const voidInvoice = createLinkedInvoice("est_test", { status: "void" });
    seedEstimates([estimate]);
    seedInvoices([voidInvoice]);

    renderEstimatesScreen([estimate]);
    expandCard();
    clickPanelDelete();
    confirmDelete();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/Cannot delete/i);
    expect(readStoredEstimates()).toEqual([estimate]);
  });
});
