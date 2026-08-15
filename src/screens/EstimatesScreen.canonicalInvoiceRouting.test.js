import React from "react";
import { render, waitFor } from "@testing-library/react";

import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function estimate(overrides = {}) {
  return {
    id: "est_approved",
    docType: "estimate",
    estimateNumber: "EST-9001",
    customerId: "cust_1",
    customerName: "Jose Martinez",
    projectName: "Bathroom remodel",
    status: "approved",
    total: 4000,
    invoiceTotal: 4000,
    updatedAt: 1720000000000,
    createdAt: 1720000000000,
    savedAt: 1720000000000,
    ts: 1720000000000,
    ...overrides,
  };
}

const APPROVED = estimate();
const OTHER_APPROVED = estimate({ id: "est_other", estimateNumber: "EST-9002", customerName: "Dana Reyes", total: 7000, invoiceTotal: 7000 });
const DRAFT = estimate({ id: "est_draft", estimateNumber: "EST-9003", status: "draft" });
const ARCHIVED = estimate({ id: "est_archived", estimateNumber: "EST-9004", archived: true });

const ALL = [APPROVED, OTHER_APPROVED, DRAFT, ARCHIVED];

function seed(list = ALL) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(list));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
}

function storedInvoices() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]");
}

function renderScreen(props = {}) {
  return render(<EstimatesScreen lang="en" t={(k) => k} history={ALL} {...props} />);
}

// The quick composer's only visible marker: its modal names the requested
// amount. The canonical builder never renders it.
function quickComposerOpen(container) {
  return /Requested amount|Invoice composer/i.test(container.textContent || "");
}

describe("Snapshot invoice requests route through the canonical builder", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("a request creates the invoice draft through the canonical path, not the composer", async () => {
    seed();
    const onInvoiceBuilderRequestHandled = jest.fn();
    const navigated = jest.fn();
    window.addEventListener("estipaid:navigate-invoice-builder", navigated);

    try {
      const { container } = renderScreen({
        requestedInvoiceBuilderEstimateId: "est_approved",
        onInvoiceBuilderRequestHandled,
      });

      // The canonical launch is what writes the draft and asks for the builder.
      await waitFor(() => expect(storedInvoices()).toHaveLength(1));
      await waitFor(() => expect(navigated).toHaveBeenCalled());
      expect(quickComposerOpen(container)).toBe(false);
      expect(onInvoiceBuilderRequestHandled).toHaveBeenCalled();
    } finally {
      window.removeEventListener("estipaid:navigate-invoice-builder", navigated);
    }
  });

  test("the requested id selects that estimate and no other", async () => {
    seed();
    renderScreen({
      requestedInvoiceBuilderEstimateId: "est_other",
      onInvoiceBuilderRequestHandled: jest.fn(),
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
    const created = storedInvoices()[0];
    expect(created.estimateNumber).toBe("EST-9002");
    expect(created.customerName).toBe("Dana Reyes");
    expect(String(created.sourceEstimateId)).toBe("est_other");
  });

  test.each([
    ["a draft estimate", "est_draft"],
    ["an archived estimate", "est_archived"],
    ["an estimate that does not exist", "est_missing"],
  ])("%s creates nothing and still releases the request", async (_label, requestedId) => {
    seed();
    const onInvoiceBuilderRequestHandled = jest.fn();
    const { container } = renderScreen({
      requestedInvoiceBuilderEstimateId: requestedId,
      onInvoiceBuilderRequestHandled,
    });

    await waitFor(() => expect(onInvoiceBuilderRequestHandled).toHaveBeenCalled());
    expect(storedInvoices()).toHaveLength(0);
    expect(quickComposerOpen(container)).toBe(false);
  });

  test("re-rendering the same request does not create a second draft", async () => {
    seed();
    const onInvoiceBuilderRequestHandled = jest.fn();
    const { rerender } = renderScreen({
      requestedInvoiceBuilderEstimateId: "est_approved",
      onInvoiceBuilderRequestHandled,
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));

    // App clears the request once handled; an unrelated re-render must not
    // launch a second conversion for the same estimate.
    rerender(
      <EstimatesScreen
        lang="en"
        t={(k) => k}
        history={ALL}
        requestedInvoiceBuilderEstimateId=""
        onInvoiceBuilderRequestHandled={onInvoiceBuilderRequestHandled}
      />
    );

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
  });

  test("the created draft carries the estimate linkage the builder relies on", async () => {
    seed();
    renderScreen({
      requestedInvoiceBuilderEstimateId: "est_approved",
      onInvoiceBuilderRequestHandled: jest.fn(),
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
    const created = storedInvoices()[0];
    expect(created.docType).toBe("invoice");
    expect(created.status).toBe("draft");
    expect(String(created.sourceEstimateId)).toBe("est_approved");
    expect(created.customerName).toBe("Jose Martinez");
    expect(created.projectName).toBe("Bathroom remodel");
    expect(created.id).toBeTruthy();
    expect(created.id).not.toBe("est_approved");
  });
});
