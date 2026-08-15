import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import ProjectsScreen from "./ProjectsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  DRILLDOWN_SCOPES,
  INVOICE_DRILLDOWNS,
  createDrilldownIntent,
  createDrilldownRecordIntent,
} from "../utils/dashboardDrilldowns";

function invoice(overrides = {}) {
  return {
    id: "inv_a",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-0041",
    customerName: "Jose Martinez",
    projectName: "Kitchen Remodel",
    invoiceTotal: 1250,
    total: 1250,
    amountPaid: 0,
    balanceRemaining: 1250,
    status: "sent",
    paymentStatus: "unpaid",
    dueDate: "2020-01-05",
    updatedAt: 1720000000000,
    createdAt: 1720000000000,
    savedAt: 1720000000000,
    ts: 1720000000000,
    ...overrides,
  };
}

const OVERDUE = invoice({ id: "inv_overdue", invoiceNumber: "INV-0042" });
const PAID = invoice({
  id: "inv_paid",
  invoiceNumber: "INV-0043",
  amountPaid: 1250,
  balanceRemaining: 0,
  status: "paid",
  paymentStatus: "paid",
  dueDate: "2999-01-01",
});

function seed() {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([OVERDUE, PAID]));
}

const SNAPSHOT_RETURN = { anchor: "at-risk" };

describe("Snapshot exact-record landing", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("an exact-record intent opens that invoice's own details panel", async () => {
    seed();
    render(
      <InvoicesScreen
        lang="en"
        t={(k) => k}
        drilldownIntent={createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "inv_overdue")}
        onDrilldownIntentConsumed={jest.fn()}
      />
    );

    await waitFor(() => {
      const card = document.querySelector('[data-invoice-card-id="inv_overdue"]');
      expect(card).toBeTruthy();
      // The same details panel the Details button toggles, now open for review.
      expect(card.querySelector('[aria-hidden="false"]')).toBeTruthy();
    });

    // Only the named record is expanded; the rest of the list is untouched.
    const other = document.querySelector('[data-invoice-card-id="inv_paid"]');
    expect(other.querySelector('[aria-hidden="false"]')).toBeNull();
  });

  test("opening an exact record never hands off to the builder or edit flow", async () => {
    seed();
    const onBeginInvoiceEdit = jest.fn();
    const onDone = jest.fn();

    render(
      <InvoicesScreen
        lang="en"
        t={(k) => k}
        onBeginInvoiceEdit={onBeginInvoiceEdit}
        onDone={onDone}
        drilldownIntent={createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "inv_overdue")}
        onDrilldownIntentConsumed={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(document.querySelector('[data-invoice-card-id="inv_overdue"] [aria-hidden="false"]')).toBeTruthy();
    });
    // Reviewing is not editing.
    expect(onBeginInvoiceEdit).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  test("the exact record keeps its highlight targeting", async () => {
    seed();
    render(
      <InvoicesScreen
        lang="en"
        t={(k) => k}
        drilldownIntent={createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "inv_overdue")}
        onDrilldownIntentConsumed={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(document.querySelector('[data-invoice-card-id="inv_overdue"]'))
        .toHaveAttribute("data-invoice-card-highlighted", "true");
    });
  });
});

describe("Back to Snapshot appears only for Snapshot-origin drill-downs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("Invoices reached from Snapshot exposes the return control", async () => {
    seed();
    const onReturnToSnapshot = jest.fn();
    render(
      <InvoicesScreen
        lang="en"
        t={(k) => k}
        drilldownIntent={createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.OVERDUE)}
        onDrilldownIntentConsumed={jest.fn()}
        snapshotReturn={SNAPSHOT_RETURN}
        onReturnToSnapshot={onReturnToSnapshot}
      />
    );

    const back = await screen.findByRole("button", { name: /Back to Snapshot/i });
    back.click();
    expect(onReturnToSnapshot).toHaveBeenCalledTimes(1);
  });

  test("an ordinary Invoices visit shows no return control", async () => {
    seed();
    render(<InvoicesScreen lang="en" t={(k) => k} />);
    await screen.findByText(/INV-0042/);
    expect(screen.queryByRole("button", { name: /Back to Snapshot/i })).toBeNull();
  });

  test("Projects reached from Snapshot exposes the return control", async () => {
    localStorage.setItem(
      STORAGE_KEYS.PROJECTS,
      JSON.stringify([{ id: "p1", projectName: "Job A", status: "active", customerName: "Jose" }])
    );
    const onReturnToSnapshot = jest.fn();
    render(
      <ProjectsScreen
        onOpenProjectDetail={jest.fn()}
        snapshotReturn={SNAPSHOT_RETURN}
        onReturnToSnapshot={onReturnToSnapshot}
      />
    );

    const back = await screen.findByRole("button", { name: /Back to Snapshot/i });
    back.click();
    expect(onReturnToSnapshot).toHaveBeenCalledTimes(1);
  });

  test("an ordinary Projects visit shows no return control", async () => {
    localStorage.setItem(
      STORAGE_KEYS.PROJECTS,
      JSON.stringify([{ id: "p1", projectName: "Job A", status: "active", customerName: "Jose" }])
    );
    render(<ProjectsScreen onOpenProjectDetail={jest.fn()} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Back to Snapshot/i })).toBeNull());
  });
});
