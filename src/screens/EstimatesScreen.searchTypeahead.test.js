import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import EstimatesScreen from "./EstimatesScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

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

function seedEstimates(estimates) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}
function readStoredEstimates() {
  const arr = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]");
  return (Array.isArray(arr) ? arr : []).filter((e) => String(e?.docType || "estimate").toLowerCase() !== "invoice");
}
function readStoredInvoices() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]");
}

function renderEstimates(estimates = []) {
  // EstimatesScreen sources its list from the `history` prop; storage is seeded
  // too so we can assert a selection does not mutate the stored record.
  seedEstimates(estimates);
  render(<EstimatesScreen lang="en" t={(k) => k} history={estimates} />);
}

function getSearchInput() {
  return screen.getByPlaceholderText(/Search estimates/i);
}

async function typeSearch(value) {
  const input = getSearchInput();
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
  return input;
}

describe("EstimatesScreen search typeahead", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  function seedThree() {
    return [
      createEstimate({ id: "est_draft", estimateNumber: "EST-0098", status: "draft", total: 3400 }),
      createEstimate({ id: "est_pending", estimateNumber: "EST-0099", status: "pending", total: 1500 }),
      createEstimate({ id: "est_approved", estimateNumber: "EST-0100", status: "approved", total: 2000 }),
    ];
  }

  test("typing shows a dropdown with descriptive estimate rows including status labels", async () => {
    renderEstimates(seedThree());
    await screen.findByText(/EST-0098/);

    await typeSearch("Jose");
    const listbox = await screen.findByRole("listbox", { name: /Matching estimates/i });

    expect(within(listbox).getByText(/#EST-0098/)).toBeInTheDocument();
    expect(within(listbox).getByText(/#EST-0099/)).toBeInTheDocument();
    expect(within(listbox).getByText(/#EST-0100/)).toBeInTheDocument();
    // Status labels: Draft / Awaiting Response / Approved.
    expect(within(listbox).getByText(/^Draft$/i)).toBeInTheDocument();
    expect(within(listbox).getByText(/Awaiting Response/i)).toBeInTheDocument();
    expect(within(listbox).getByText(/^Approved$/i)).toBeInTheDocument();
    // Descriptive money detail present.
    expect(listbox.textContent).toMatch(/\$/);
  });

  test("Escape closes the dropdown without clearing the search text", async () => {
    renderEstimates(seedThree());
    await screen.findByText(/EST-0098/);

    const input = await typeSearch("Jose");
    await screen.findByRole("listbox", { name: /Matching estimates/i });

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: /Matching estimates/i })).not.toBeInTheDocument();
    });
    expect(input).toHaveValue("Jose");
  });

  test("clicking outside closes the dropdown without clearing the search text", async () => {
    renderEstimates(seedThree());
    await screen.findByText(/EST-0098/);

    const input = await typeSearch("Jose");
    await screen.findByRole("listbox", { name: /Matching estimates/i });

    act(() => {
      fireEvent.pointerDown(document.body);
    });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: /Matching estimates/i })).not.toBeInTheDocument();
    });
    expect(input).toHaveValue("Jose");
  });

  test("selecting an estimate row is view-only: no status/archive/delete/create-invoice, scrolls + highlights the card", async () => {
    const scrollIntoView = jest.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderEstimates(seedThree());
      await screen.findByText(/EST-0100/);

      await typeSearch("Jose");
      const listbox = await screen.findByRole("listbox", { name: /Matching estimates/i });
      const row = within(listbox).getByText(/#EST-0100/).closest("button");
      await act(async () => {
        fireEvent.click(row);
      });

      // Still on the estimates list; estimate record unchanged; no invoice created.
      expect(getSearchInput()).toBeInTheDocument();
      const stored = readStoredEstimates();
      const approved = stored.find((e) => e.id === "est_approved");
      expect(approved.status).toBe("approved");
      expect(approved.archived).toBeFalsy();
      expect(readStoredInvoices()).toEqual([]);

      await waitFor(() => {
        expect(screen.queryByRole("listbox", { name: /Matching estimates/i })).not.toBeInTheDocument();
      });
      const card = document.querySelector('[data-estimate-card-id="est_approved"]');
      expect(card.getAttribute("data-estimate-card-highlighted")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = prev;
    }
  });

  test("archived estimates are hidden from the dropdown by default and shown with an Archived label when Show archived is on", async () => {
    renderEstimates([
      createEstimate({ id: "est_active", estimateNumber: "EST-0098", status: "draft" }),
      createEstimate({ id: "est_arch", estimateNumber: "EST-0200", status: "approved", archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    await screen.findByText(/EST-0098/);

    await typeSearch("Jose");
    let listbox = await screen.findByRole("listbox", { name: /Matching estimates/i });
    expect(within(listbox).queryByText(/#EST-0200/)).not.toBeInTheDocument();
    expect(within(listbox).getByText(/#EST-0098/)).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Show archived/i }));
    });
    await typeSearch("Jose");
    listbox = await screen.findByRole("listbox", { name: /Matching estimates/i });
    expect(within(listbox).getByText(/#EST-0200/)).toBeInTheDocument();
    expect(within(listbox).getAllByText(/Archived/i).length).toBeGreaterThan(0);
  });
});
