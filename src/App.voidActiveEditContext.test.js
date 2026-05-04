import React from "react";
import { act, render } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const PROFILE_RETURN_TARGET_KEY = "estipaid-profile-return-target-v1";

function createInvoice(overrides = {}) {
  return {
    id: "inv_test",
    docType: "invoice",
    invoiceNumber: "INV-1001",
    customerName: "Test Customer",
    status: "draft",
    ...overrides,
  };
}

function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function seedProfileReturnTarget(target) {
  localStorage.setItem(PROFILE_RETURN_TARGET_KEY, JSON.stringify(target));
}

function readEditInvoiceTarget() {
  return localStorage.getItem(EDIT_INVOICE_TARGET_KEY);
}

describe("App void active edit context guard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("profile return target with void invoice edit context is blocked", () => {
    const voidInvoice = createInvoice({ id: "inv_void", status: "void" });
    seedInvoices([voidInvoice]);
    seedProfileReturnTarget({
      route: "create",
      intent: "invoice",
      editContext: { type: "invoice", id: "inv_void" },
    });

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event("estipaid:profile-save-return"));
    });

    expect(readEditInvoiceTarget()).toBeNull();
  });

  test("profile return target with missing invoice edit context is cleared", () => {
    seedInvoices([]);
    seedProfileReturnTarget({
      route: "create",
      intent: "invoice",
      editContext: { type: "invoice", id: "inv_missing" },
    });

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event("estipaid:profile-save-return"));
    });

    expect(readEditInvoiceTarget()).toBeNull();
  });
});
