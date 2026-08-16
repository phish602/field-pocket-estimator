import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// This is a routing suite.  The real encrypted runtime/queue transaction is
// covered by its dedicated tests; here the boundary is an async durable commit
// that mirrors the exact serialized writes a screen caller supplies.
jest.mock("../lib/cloudBackupQueue", () => {
  const actual = jest.requireActual("../lib/cloudBackupQueue");

  return {
    ...actual,
    commitAtomicCloudQueuedBusinessMutation: async ({ writes = [] }) => {
      writes.forEach(({ key, value }) => globalThis.localStorage.setItem(key, value));
      return {
        ok: true,
        revision: 1,
        queue: {},
        keys: writes.map(({ key }) => key),
      };
    },
  };
});

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

function launchRequest(estimateId, mode = "builder") {
  return { estimateId, mode };
}

function invoiceOptions(container) {
  return container.querySelector("[data-invoice-options='true']");
}

describe("Snapshot invoice requests route through the canonical builder", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  test("a request creates the invoice draft through the canonical path, not the composer", async () => {
    seed();
    const onInvoiceLaunchRequestHandled = jest.fn();
    const navigated = jest.fn();
    window.addEventListener("estipaid:navigate-invoice-builder", navigated);

    try {
      const { container } = renderScreen({
        invoiceLaunchRequest: launchRequest("est_approved"),
        onInvoiceLaunchRequestHandled,
      });

      // The canonical launch is what writes the draft and asks for the builder.
      await waitFor(() => expect(storedInvoices()).toHaveLength(1));
      await waitFor(() => expect(navigated).toHaveBeenCalled());
      expect(container.querySelector("[role='dialog'][aria-label='Create invoice']")).toBeNull();
      expect(onInvoiceLaunchRequestHandled).toHaveBeenCalled();
    } finally {
      window.removeEventListener("estipaid:navigate-invoice-builder", navigated);
    }
  });

  test("the requested id selects that estimate and no other", async () => {
    seed();
    renderScreen({
      invoiceLaunchRequest: launchRequest("est_other"),
      onInvoiceLaunchRequestHandled: jest.fn(),
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
    const onInvoiceLaunchRequestHandled = jest.fn();
    const { container } = renderScreen({
      invoiceLaunchRequest: launchRequest(requestedId),
      onInvoiceLaunchRequestHandled,
    });

    await waitFor(() => expect(onInvoiceLaunchRequestHandled).toHaveBeenCalled());
    expect(storedInvoices()).toHaveLength(0);
    expect(container.querySelector("[role='dialog'][aria-label='Create invoice']")).toBeNull();
  });

  test("re-rendering the same request does not create a second draft", async () => {
    seed();
    const onInvoiceLaunchRequestHandled = jest.fn();
    const { rerender } = renderScreen({
      invoiceLaunchRequest: launchRequest("est_approved"),
      onInvoiceLaunchRequestHandled,
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));

    // App clears the request once handled; an unrelated re-render must not
    // launch a second conversion for the same estimate.
    rerender(
      <EstimatesScreen
        lang="en"
        t={(k) => k}
        history={ALL}
        invoiceLaunchRequest={null}
        onInvoiceLaunchRequestHandled={onInvoiceLaunchRequestHandled}
      />
    );

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
  });

  test("the created draft carries the estimate linkage the builder relies on", async () => {
    seed();
    renderScreen({
      invoiceLaunchRequest: launchRequest("est_approved"),
      onInvoiceLaunchRequestHandled: jest.fn(),
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

describe("billing setup collects intent and delegates creation", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("an options request opens setup instead of creating anything", async () => {
    seed();
    const onInvoiceLaunchRequestHandled = jest.fn();
    const { container } = renderScreen({
      invoiceLaunchRequest: launchRequest("est_approved", "options"),
      onInvoiceLaunchRequestHandled,
    });

    await waitFor(() => expect(onInvoiceLaunchRequestHandled).toHaveBeenCalled());
    // Setup is intent collection only: nothing is written until the user submits.
    expect(storedInvoices()).toHaveLength(0);
    await waitFor(() => expect(invoiceOptions(container)).not.toBeNull());
    expect(screen.queryByRole("dialog", { name: "Create invoice" })).toBeNull();
    expect(invoiceOptions(container).textContent).toContain("Bathroom remodel");
  });

  test("submitting setup produces exactly one draft carrying the chosen intent", async () => {
    seed();
    const { container } = renderScreen({
      invoiceLaunchRequest: launchRequest("est_approved", "options"),
      onInvoiceLaunchRequestHandled: jest.fn(),
    });

    await waitFor(() => expect(invoiceOptions(container)).not.toBeNull());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Deposit" })));
    await screen.findByRole("button", { name: "25%" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "25%" })));

    const submit = screen.getByRole("button", { name: /^(Continue to Invoice Builder|Continuar al constructor)$/i });
    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
    const created = storedInvoices()[0];
    expect(String(created.sourceEstimateId)).toBe("est_approved");
    expect(created.status).toBe("draft");
    expect(created.invoiceType).toBe("deposit");
    expect(created.invoiceMeta?.amountMode).toBe("percent");
    expect(created.invoiceMeta?.requestedPercent).toBe(25);
    // Same canonical shape the builder launch produces.
    expect(created.meta?.ephemeralDraft).toBe(true);
  });

  test("the primary Convert action remains a direct canonical launch", async () => {
    seed();
    const { container } = renderScreen();

    await waitFor(() => expect(container.querySelector("[data-estimate-card-id='est_approved']")).not.toBeNull());
    const approvedCard = container.querySelector("[data-estimate-card-id='est_approved']");
    await act(async () => {
      fireEvent.click(within(approvedCard).getByRole("button", { name: "Details" }));
    });
    await within(approvedCard).findByRole("button", { name: "Convert to Invoice" });
    await act(async () => {
      fireEvent.click(within(approvedCard).getByRole("button", { name: "Convert to Invoice" }));
    });

    await waitFor(() => expect(storedInvoices()).toHaveLength(1));
    expect(invoiceOptions(container)).toBeNull();
    expect(container.querySelector("[role='dialog'][aria-label='Create invoice']")).toBeNull();
  });

  test("cancelling inline options changes no business data", async () => {
    seed();
    const { container } = renderScreen({
      invoiceLaunchRequest: launchRequest("est_approved", "options"),
      onInvoiceLaunchRequestHandled: jest.fn(),
    });

    await waitFor(() => expect(invoiceOptions(container)).not.toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(invoiceOptions(container)).toBeNull();
    expect(storedInvoices()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual(ALL);
  });
});
