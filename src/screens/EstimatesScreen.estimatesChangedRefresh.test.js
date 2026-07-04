import React from "react";
import { act, render, screen } from "@testing-library/react";

import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function makeEstimate(overrides = {}) {
  return {
    id: "est_refresh_test",
    docType: "estimate",
    estimateNumber: "EST-9001",
    projectName: "Stale Project",
    customerName: "Stale Customer",
    status: "pending",
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
    savedAt: 1714694400000,
    ts: 1714694400000,
    ...overrides,
  };
}

function seedEstimates(estimates) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}

function renderEstimatesScreen(history = []) {
  render(<EstimatesScreen lang="en" t={(k) => k} history={history} />);
  act(() => {
    jest.advanceTimersByTime(300);
  });
}

describe("EstimatesScreen estipaid:estimates-changed direct refresh", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("refreshes local estimate list from storage when estipaid:estimates-changed fires, without new history prop", async () => {
    const staleEstimate = makeEstimate({ projectName: "Stale Project" });
    seedEstimates([staleEstimate]);
    renderEstimatesScreen([staleEstimate]);

    // Confirm stale data is visible initially
    expect(screen.getAllByText(/Stale Project/i).length).toBeGreaterThan(0);

    // Seed updated estimate directly into storage (simulates save from EstimateForm)
    const updatedEstimate = makeEstimate({ projectName: "Updated Project" });
    seedEstimates([updatedEstimate]);

    // Dispatch the event — history prop is NOT changed
    act(() => {
      window.dispatchEvent(new Event("estipaid:estimates-changed"));
    });

    // EstimatesScreen should pick up updated data from storage
    expect(screen.getAllByText(/Updated Project/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Stale Project/i)).toBeNull();
  });

  test("shows restored approved estimates after storage refresh, including ones already linked to invoices", () => {
    const restoredApprovedEstimate = makeEstimate({
      id: "est_restored_approved",
      estimateNumber: "EST-RESTORE-1",
      projectName: "Restored Project",
      customerName: "Restored Customer",
      status: "approved",
      invoiceId: "inv_restored_1",
      convertedInvoiceId: "inv_restored_1",
      invoiceNumber: "INV-RESTORED-1",
    });

    seedEstimates([restoredApprovedEstimate]);
    renderEstimatesScreen([]);

    act(() => {
      window.dispatchEvent(new Event("estipaid:estimates-changed"));
    });

    expect(screen.getAllByText(/Restored Project/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Restored Customer/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/EST-RESTORE-1/i)).toBeInTheDocument();
  });
});
