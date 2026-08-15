import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import InvoicesScreen from "./InvoicesScreen";
import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  DRILLDOWN_SCOPES,
  ESTIMATE_DRILLDOWNS,
  INVOICE_DRILLDOWNS,
  createDrilldownIntent,
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

function seedInvoices(list) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(list));
}

function visibleButtonNames() {
  return Array.from(document.querySelectorAll("button"))
    .filter((b) => {
      const panel = b.closest("[aria-hidden]");
      if (panel && panel.getAttribute("aria-hidden") === "true") return false;
      return true;
    })
    .map((b) => (b.textContent || "").trim());
}

describe("Invoices: receivables context surfaces the existing payment action", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("an overdue drill-down lifts the existing payment action onto the card", async () => {
    seedInvoices([OVERDUE, PAID]);
    render(
      <InvoicesScreen
        lang="en"
        t={(k) => k}
        drilldownIntent={createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.OVERDUE)}
        onDrilldownIntentConsumed={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(visibleButtonNames()).toEqual(expect.arrayContaining(["Take Payment"]));
    });
  });

  test("without a receivables context the card keeps its original actions", async () => {
    seedInvoices([OVERDUE, PAID]);
    render(<InvoicesScreen lang="en" t={(k) => k} />);

    await screen.findByText(/INV-0042/);
    // No drill-down, so the payment action stays where it always lived: inside
    // the details panel, not on the collapsed card.
    expect(visibleButtonNames()).not.toEqual(expect.arrayContaining(["Take Payment"]));
  });

  test("a metric with no records behind it is not offered as an entry point", async () => {
    seedInvoices([OVERDUE, PAID]);
    render(<InvoicesScreen lang="en" t={(k) => k} />);
    await screen.findByText(/INV-0042/);

    // Nothing is awaiting Stripe follow-up in this fixture.
    expect(screen.queryByRole("button", { name: /Payment Status:/i })).toBeNull();
    // Metrics that do have records stay interactive.
    expect(screen.getByRole("button", { name: /Overdue:/i })).toBeInTheDocument();
  });
});

function estimate(overrides = {}) {
  return {
    id: "est_a",
    docType: "estimate",
    estimateNumber: "EST-0001",
    customerName: "Jose Martinez",
    projectName: "Bathroom remodel",
    status: "draft",
    total: 3400,
    updatedAt: 1720000000000,
    createdAt: 1720000000000,
    savedAt: 1720000000000,
    ts: 1720000000000,
    ...overrides,
  };
}

const EST_DRAFT = estimate({ id: "est_draft", estimateNumber: "EST-0001", status: "draft" });
const EST_PENDING = estimate({ id: "est_pending", estimateNumber: "EST-0002", status: "pending" });
const EST_ALL = [EST_DRAFT, EST_PENDING];

function cardIds() {
  return Array.from(document.querySelectorAll("[data-estimate-card-id]"))
    .map((n) => n.getAttribute("data-estimate-card-id"));
}

function visibleActionsFor(cardId) {
  const card = document.querySelector(`[data-estimate-card-id="${cardId}"]`);
  if (!card) return [];
  return Array.from(card.querySelectorAll("button"))
    .filter((b) => {
      const panel = b.closest("[aria-hidden]");
      return !(panel && panel.getAttribute("aria-hidden") === "true");
    })
    .map((b) => (b.textContent || "").trim());
}

describe("Estimates: awaiting focus surfaces existing status actions only where relevant", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function renderBoard(props = {}) {
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(EST_ALL));
    return render(<EstimatesScreen lang="en" t={(k) => k} history={EST_ALL} {...props} />);
  }

  test("focused pending cards expose Mark Approved and Mark Lost without hiding anything", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(EST_ALL.length));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Awaiting response:/i }));
    });

    await waitFor(() => {
      expect(visibleActionsFor("est_pending")).toEqual(expect.arrayContaining(["Mark Approved", "Mark Lost"]));
    });
    // The unfocused draft keeps its original, uncluttered action set, and the
    // board still renders every estimate.
    expect(visibleActionsFor("est_draft")).not.toEqual(expect.arrayContaining(["Mark Approved"]));
    expect(cardIds()).toHaveLength(EST_ALL.length);
  });

  test("a high-value focus adds no status actions -- real status still governs", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(EST_ALL.length));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /High value:/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /High value:.*Clear focus/i })).toBeInTheDocument();
    });
    expect(visibleActionsFor("est_pending")).not.toEqual(expect.arrayContaining(["Mark Approved"]));
    expect(cardIds()).toHaveLength(EST_ALL.length);
  });

  test("an incoming awaiting intent surfaces the same actions and stays non-destructive", async () => {
    renderBoard({
      drilldownIntent: createDrilldownIntent(DRILLDOWN_SCOPES.ESTIMATES, ESTIMATE_DRILLDOWNS.AWAITING),
      onDrilldownIntentConsumed: jest.fn(),
    });

    await waitFor(() => {
      expect(visibleActionsFor("est_pending")).toEqual(expect.arrayContaining(["Mark Approved"]));
    });
    expect(cardIds()).toEqual(expect.arrayContaining(["est_draft", "est_pending"]));
  });
});
