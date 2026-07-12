import React from "react";
import { act, render, screen } from "@testing-library/react";

import FinancialSnapshotScreen from "./FinancialSnapshotScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function seedSensitiveFinancialRecords() {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "customer_sensitive", name: "Sensitive Customer Name" }]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{ id: "invoice_sensitive", invoiceNumber: "INV-SECRET-9000", invoiceTotal: 999999 }]));
}

function renderSnapshot(subscriptionPlanState, props = {}) {
  return render(<FinancialSnapshotScreen subscriptionPlanState={subscriptionPlanState} {...props} />);
}

describe("Financial Snapshot subscription gate", () => {
  beforeEach(() => localStorage.clear());

  test.each([
    ["Free", { plan: "free", status: "free" }],
    ["Solo", { plan: "solo", status: "active" }],
    ["canceled Solo", { plan: "solo", status: "canceled" }],
    ["canceled Pro", { plan: "pro", status: "canceled" }],
  ])("%s receives sample-only preview rather than stored financial data", async (_label, state) => {
    seedSensitiveFinancialRecords();
    await act(async () => { renderSnapshot(state); });
    expect(screen.getByTestId("financial-snapshot-locked-preview")).toBeInTheDocument();
    expect(screen.getByText("Unlock Financial Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Preview shown with sample data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade in Company Profile" })).toBeInTheDocument();
    expect(screen.queryByText("Sensitive Customer Name")).toBeNull();
    expect(screen.queryByText("INV-SECRET-9000")).toBeNull();
  });

  test("upgrade CTA opens Company Profile through the supplied route callback", async () => {
    const onOpenCompanyProfile = jest.fn();
    await act(async () => { renderSnapshot({ plan: "free", status: "free" }, { onOpenCompanyProfile }); });
    screen.getByRole("button", { name: "Upgrade in Company Profile" }).click();
    expect(onOpenCompanyProfile).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["Pro", { plan: "pro", status: "active" }],
    ["Business", { plan: "business", status: "active" }],
  ])("%s mounts the unchanged real Snapshot metrics", async (_label, state) => {
    await act(async () => { renderSnapshot(state); });
    expect(screen.queryByTestId("financial-snapshot-locked-preview")).toBeNull();
    expect(screen.getByLabelText("Time range")).toBeInTheDocument();
    expect(screen.getByText("Revenue (invoices)")).toBeInTheDocument();
  });
});
