import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import ProjectDetailScreen from "./ProjectDetailScreen";

const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";
const PROJECTS_KEY = "estipaid-projects-v1";
const INVOICES_KEY = "estipaid-invoices-v1";

function makeProject(overrides = {}) {
  return {
    id: "proj_void_guard",
    name: "Guard Test Project",
    projectName: "Guard Test Project",
    status: "active",
    customerId: "",
    customerName: "",
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
    ...overrides,
  };
}

function makeInvoice(overrides = {}) {
  return {
    id: "inv_base",
    docType: "invoice",
    projectId: "proj_void_guard",
    invoiceNumber: "INV-BASE",
    invoiceTotal: 500,
    total: 500,
    status: "sent",
    paymentStatus: "unpaid",
    amountPaid: 0,
    balanceRemaining: 500,
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
    ...overrides,
  };
}

function seed({ project, invoices }) {
  localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, project.id);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify([project]));
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
}

function renderScreen(props = {}) {
  render(
    <ProjectDetailScreen
      onBack={jest.fn()}
      onOpenInvoice={jest.fn()}
      {...props}
    />
  );
}

describe("ProjectDetailScreen void invoice open guard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("clicking a void invoice card does not call onOpenInvoice", () => {
    const project = makeProject();
    const voidInvoice = makeInvoice({
      id: "inv_void",
      invoiceNumber: "INV-VOID-1",
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });

    seed({ project, invoices: [voidInvoice] });

    const onOpenInvoice = jest.fn();
    renderScreen({ onOpenInvoice });

    const card = screen.getByText(/Invoice #INV-VOID-1/i).closest("button");
    fireEvent.click(card);

    expect(onOpenInvoice).not.toHaveBeenCalled();
  });

  test("clicking a non-void invoice card calls onOpenInvoice with the invoice", () => {
    const project = makeProject();
    const sentInvoice = makeInvoice({
      id: "inv_sent",
      invoiceNumber: "INV-SENT-1",
      status: "sent",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 500,
    });

    seed({ project, invoices: [sentInvoice] });

    const onOpenInvoice = jest.fn();
    renderScreen({ onOpenInvoice });

    const card = screen.getByText(/Invoice #INV-SENT-1/i).closest("button");
    fireEvent.click(card);

    expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    expect(onOpenInvoice.mock.calls[0][0]).toMatchObject({ id: "inv_sent" });
  });

  test("void invoice card remains visible in the project detail list", () => {
    const project = makeProject();
    const voidInvoice = makeInvoice({
      id: "inv_void_visible",
      invoiceNumber: "INV-VOID-VISIBLE",
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });

    seed({ project, invoices: [voidInvoice] });

    renderScreen({ onOpenInvoice: jest.fn() });

    expect(screen.getByText(/Invoice #INV-VOID-VISIBLE/i)).toBeInTheDocument();
  });

  test("void invoice does not block a non-void invoice card in the same list from calling onOpenInvoice", () => {
    const project = makeProject();
    const voidInvoice = makeInvoice({
      id: "inv_void_mixed",
      invoiceNumber: "INV-VOID-MIXED",
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const activeInvoice = makeInvoice({
      id: "inv_active_mixed",
      invoiceNumber: "INV-ACTIVE-MIXED",
      status: "sent",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 500,
    });

    seed({ project, invoices: [voidInvoice, activeInvoice] });

    const onOpenInvoice = jest.fn();
    renderScreen({ onOpenInvoice });

    // Void card: no call
    fireEvent.click(screen.getByText(/Invoice #INV-VOID-MIXED/i).closest("button"));
    expect(onOpenInvoice).not.toHaveBeenCalled();

    // Active card: one call
    fireEvent.click(screen.getByText(/Invoice #INV-ACTIVE-MIXED/i).closest("button"));
    expect(onOpenInvoice).toHaveBeenCalledTimes(1);
    expect(onOpenInvoice.mock.calls[0][0]).toMatchObject({ id: "inv_active_mixed" });
  });
});
