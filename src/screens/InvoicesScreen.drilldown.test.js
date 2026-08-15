import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DRILLDOWN_SCOPES, INVOICE_DRILLDOWNS, createDrilldownIntent, createDrilldownRecordIntent } from "../utils/dashboardDrilldowns";

function createInvoice(overrides = {}) {
  return {
    id: "inv_a",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-0041",
    customerId: "cust_jose",
    customerName: "Jose Martinez",
    projectName: "Kitchen Remodel",
    invoiceTotal: 1250,
    total: 1250,
    amountPaid: 400,
    balanceRemaining: 850,
    status: "sent",
    paymentStatus: "partial",
    dueDate: "2999-07-20",
    updatedAt: 1720000000000,
    createdAt: 1720000000000,
    savedAt: 1720000000000,
    ts: 1720000000000,
    ...overrides,
  };
}

const OPEN_INVOICE = createInvoice({ id: "inv_open", invoiceNumber: "INV-0041" });
const OVERDUE_INVOICE = createInvoice({
  id: "inv_overdue",
  invoiceNumber: "INV-0042",
  customerName: "Dana Reyes",
  amountPaid: 0,
  balanceRemaining: 1250,
  paymentStatus: "unpaid",
  dueDate: "2020-01-05",
});
const PAID_INVOICE = createInvoice({
  id: "inv_paid",
  invoiceNumber: "INV-0043",
  customerName: "Kim Alvarez",
  amountPaid: 1250,
  balanceRemaining: 0,
  status: "paid",
  paymentStatus: "paid",
});

function seedAll() {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([OPEN_INVOICE, OVERDUE_INVOICE, PAID_INVOICE]));
}

function metricButton(name) {
  return screen.getByRole("button", { name: new RegExp(name, "i") });
}

function visibleInvoiceNumbers() {
  return ["INV-0041", "INV-0042", "INV-0043"].filter((number) => screen.queryAllByText(new RegExp(`#?${number}`)).length > 0);
}

describe("InvoicesScreen dashboard drill-downs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("tapping Overdue filters the list to exactly the overdue invoices and shows the active filter", async () => {
    seedAll();
    render(<InvoicesScreen lang="en" t={(key) => key} />);
    await screen.findByText(/INV-0041/);

    act(() => {
      fireEvent.click(metricButton("Overdue:"));
    });

    await waitFor(() => {
      expect(visibleInvoiceNumbers()).toEqual(["INV-0042"]);
    });
    // The destination makes the active subset obvious rather than silently
    // showing a shorter list.
    expect(screen.getByRole("button", { name: /Clear dashboard filter/i })).toBeInTheDocument();
  });

  test("clearing the active filter restores the unfiltered list", async () => {
    seedAll();
    render(<InvoicesScreen lang="en" t={(key) => key} />);
    await screen.findByText(/INV-0041/);

    act(() => {
      fireEvent.click(metricButton("Overdue:"));
    });
    await waitFor(() => expect(visibleInvoiceNumbers()).toEqual(["INV-0042"]));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Clear dashboard filter/i }));
    });

    await waitFor(() => {
      expect(visibleInvoiceNumbers()).toEqual(["INV-0041", "INV-0042", "INV-0043"]);
    });
  });

  test("tapping the active metric again toggles it off", async () => {
    seedAll();
    render(<InvoicesScreen lang="en" t={(key) => key} />);
    await screen.findByText(/INV-0041/);

    act(() => {
      fireEvent.click(metricButton("Overdue:"));
    });
    await waitFor(() => expect(visibleInvoiceNumbers()).toEqual(["INV-0042"]));

    act(() => {
      fireEvent.click(metricButton("Overdue:"));
    });
    await waitFor(() => expect(visibleInvoiceNumbers()).toHaveLength(3));
  });

  test("a cross-screen intent is applied once and handed straight back so it cannot re-fire", async () => {
    seedAll();
    const onDrilldownIntentConsumed = jest.fn();
    const intent = createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.RECEIVABLES);

    const { rerender } = render(
      <InvoicesScreen
        lang="en"
        t={(key) => key}
        drilldownIntent={intent}
        onDrilldownIntentConsumed={onDrilldownIntentConsumed}
      />
    );

    await waitFor(() => {
      expect(visibleInvoiceNumbers()).toEqual(["INV-0041", "INV-0042"]);
    });
    expect(onDrilldownIntentConsumed).toHaveBeenCalledTimes(1);

    // The user clears the filter, then an ordinary re-render happens with the
    // intent already released. The old intent must not reapply itself.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Clear dashboard filter/i }));
    });
    await waitFor(() => expect(visibleInvoiceNumbers()).toHaveLength(3));

    rerender(
      <InvoicesScreen
        lang="en"
        t={(key) => key}
        drilldownIntent={null}
        onDrilldownIntentConsumed={onDrilldownIntentConsumed}
      />
    );

    await waitFor(() => expect(visibleInvoiceNumbers()).toHaveLength(3));
    expect(onDrilldownIntentConsumed).toHaveBeenCalledTimes(1);
  });

  test("an intent addressed to another screen is ignored", async () => {
    seedAll();
    const onDrilldownIntentConsumed = jest.fn();
    render(
      <InvoicesScreen
        lang="en"
        t={(key) => key}
        drilldownIntent={createDrilldownIntent(DRILLDOWN_SCOPES.PROJECTS, "active")}
        onDrilldownIntentConsumed={onDrilldownIntentConsumed}
      />
    );

    await waitFor(() => expect(visibleInvoiceNumbers()).toHaveLength(3));
    expect(onDrilldownIntentConsumed).not.toHaveBeenCalled();
  });

  test("an exact-record intent targets that one invoice instead of a filtered list", async () => {
    seedAll();
    const onDrilldownIntentConsumed = jest.fn();
    render(
      <InvoicesScreen
        lang="en"
        t={(key) => key}
        drilldownIntent={createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "inv_overdue")}
        onDrilldownIntentConsumed={onDrilldownIntentConsumed}
      />
    );

    await waitFor(() => expect(onDrilldownIntentConsumed).toHaveBeenCalledTimes(1));
    // Exact-record targeting reveals the record; it does not narrow the list to
    // a subset, so the other invoices remain reachable.
    await waitFor(() => expect(visibleInvoiceNumbers()).toHaveLength(3));
  });

  test("a post-save target still wins over an active drill-down that would hide it", async () => {
    seedAll();
    render(
      <InvoicesScreen
        lang="en"
        t={(key) => key}
        postSaveTarget={{ type: "invoice", id: "inv_paid", filters: {} }}
        onPostSaveTargetConsumed={jest.fn()}
        drilldownIntent={createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.OVERDUE)}
        onDrilldownIntentConsumed={jest.fn()}
      />
    );

    // The saved invoice is paid, so the overdue drill-down would hide it. Lane 2
    // wins: the conflicting filter is relaxed and the saved record stays visible.
    await waitFor(() => {
      expect(screen.queryAllByText(/INV-0043/).length).toBeGreaterThan(0);
    });
  });
});
