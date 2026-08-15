import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DRILLDOWN_SCOPES, ESTIMATE_DRILLDOWNS, createDrilldownIntent } from "../utils/dashboardDrilldowns";

function createEstimate(overrides = {}) {
  return {
    id: "est_a",
    docType: "estimate",
    estimateNumber: "EST-0098",
    customerId: "cust_jose",
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

const DRAFT = createEstimate({ id: "est_draft", estimateNumber: "EST-0001", status: "draft", total: 3400 });
const PENDING = createEstimate({ id: "est_pending", estimateNumber: "EST-0002", status: "pending", total: 4200, customerName: "Dana Reyes" });
const APPROVED_HIGH = createEstimate({ id: "est_approved", estimateNumber: "EST-0003", status: "approved", total: 25000, customerName: "Kim Alvarez" });
const LOST = createEstimate({ id: "est_lost", estimateNumber: "EST-0004", status: "lost", total: 900, customerName: "Rio Chen" });

const ALL = [DRAFT, PENDING, APPROVED_HIGH, LOST];

function renderBoard(estimates = ALL, props = {}) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
  return render(<EstimatesScreen lang="en" t={(k) => k} history={estimates} {...props} />);
}

function cardIds() {
  return Array.from(document.querySelectorAll("[data-estimate-card-id]"))
    .map((node) => node.getAttribute("data-estimate-card-id"));
}

function focusedCardIds() {
  return Array.from(document.querySelectorAll('[data-estimate-card-focused="true"]'))
    .map((node) => node.getAttribute("data-estimate-card-id"));
}

function metric(name) {
  return screen.getByRole("button", { name: new RegExp(name, "i") });
}

describe("EstimatesScreen pipeline focus is non-destructive", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test("Awaiting Response focuses pending estimates without hiding Draft", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));
    const before = cardIds();

    act(() => {
      fireEvent.click(metric("Awaiting response"));
    });

    await waitFor(() => {
      expect(focusedCardIds()).toEqual(["est_pending"]);
    });
    // The whole board survives: this is a focus, not a filter.
    expect(cardIds().sort()).toEqual(before.sort());
    expect(cardIds()).toContain("est_draft");
    expect(cardIds()).toContain("est_approved");
    expect(cardIds()).toContain("est_lost");
  });

  test("High value emphasizes the expensive estimate and keeps cheaper ones on the board", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    act(() => {
      fireEvent.click(metric("High value"));
    });

    await waitFor(() => {
      expect(focusedCardIds()).toEqual(["est_approved"]);
    });
    expect(cardIds()).toContain("est_lost");
    expect(cardIds()).toContain("est_draft");
    expect(cardIds()).toHaveLength(ALL.length);
  });

  test("Ready for invoice keeps every other status rendered", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    act(() => {
      fireEvent.click(metric("Ready for invoice"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ready for invoice.*Clear focus/i })).toBeInTheDocument();
    });
    expect(cardIds()).toHaveLength(ALL.length);
    expect(cardIds()).toContain("est_draft");
    expect(cardIds()).toContain("est_pending");
  });

  test("tapping the focused metric again releases the focus", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    act(() => {
      fireEvent.click(metric("Awaiting response"));
    });
    await waitFor(() => expect(focusedCardIds()).toHaveLength(1));

    act(() => {
      fireEvent.click(metric("Awaiting response"));
    });
    await waitFor(() => expect(focusedCardIds()).toHaveLength(0));
    expect(cardIds()).toHaveLength(ALL.length);
  });

  test("an incoming dashboard intent focuses without removing records and is consumed once", async () => {
    const onDrilldownIntentConsumed = jest.fn();
    renderBoard(ALL, {
      drilldownIntent: createDrilldownIntent(DRILLDOWN_SCOPES.ESTIMATES, ESTIMATE_DRILLDOWNS.AWAITING),
      onDrilldownIntentConsumed,
    });

    await waitFor(() => expect(onDrilldownIntentConsumed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(focusedCardIds()).toEqual(["est_pending"]));
    expect(cardIds()).toHaveLength(ALL.length);
    expect(cardIds()).toContain("est_draft");
  });

  test("a post-save target still reaches its card while a focus is active", async () => {
    const onPostSaveTargetConsumed = jest.fn();
    const scrollIntoView = jest.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      renderBoard(ALL, {
        drilldownIntent: createDrilldownIntent(DRILLDOWN_SCOPES.ESTIMATES, ESTIMATE_DRILLDOWNS.AWAITING),
        onDrilldownIntentConsumed: jest.fn(),
        // The saved estimate is a Draft, which the Awaiting focus does not
        // match. Because focus never hides anything, it stays reachable.
        postSaveTarget: { type: "estimate", id: "est_draft", filters: {} },
        onPostSaveTargetConsumed,
      });

      await waitFor(() => {
        const card = document.querySelector('[data-estimate-card-id="est_draft"]');
        expect(card).toHaveAttribute("data-estimate-card-highlighted", "true");
      });
      await waitFor(() => expect(onPostSaveTargetConsumed).toHaveBeenCalled());
      expect(cardIds()).toHaveLength(ALL.length);
    } finally {
      Element.prototype.scrollIntoView = prev;
    }
  });

  test("the dead drag-to-bucket affordance is gone from the board", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    expect(screen.queryByText(/Drag here to keep follow-up and pipeline status current/i)).toBeNull();
    expect(screen.queryByText(/Arrastra aquí para mantener el pipeline/i)).toBeNull();
  });

  test("estimate cards are not draggable", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    const cards = Array.from(document.querySelectorAll("[data-estimate-card-id]"));
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => {
      expect(card.getAttribute("draggable")).not.toBe("true");
      expect(card.draggable).toBe(false);
    });
  });

  test("a real filter with no matches still shows the empty state", async () => {
    renderBoard();
    await waitFor(() => expect(cardIds()).toHaveLength(ALL.length));

    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/Search estimates/i), {
        target: { value: "zzz-no-such-estimate" },
      });
    });

    await waitFor(() => expect(cardIds()).toHaveLength(0));
  });
});
