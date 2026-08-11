import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import BuilderCommandBar from "./BuilderCommandBar";

function renderBar(overrides = {}) {
  const handlers = {
    onBack: jest.fn(),
    onNext: jest.fn(),
    onReviewSave: jest.fn(),
    onClear: jest.fn(),
  };
  const props = {
    lang: "en",
    docType: "estimate",
    totalLabel: "Estimate Total",
    totalValue: "$1,250.00",
    customerName: "Acme Roofing",
    projectName: "Lobby Refresh",
    saveStatus: "Unsaved changes",
    financialItems: [
      { id: "labor", label: "Labor", value: "$700.00" },
      { id: "materials", label: "Materials", value: "$450.00" },
      { id: "charges", label: "Charges", value: "$100.00" },
    ],
    isFirstStep: false,
    isLastStep: false,
    ...handlers,
    ...overrides,
  };
  return { handlers, props, ...render(<BuilderCommandBar {...props} />) };
}

const bar = () => screen.getByRole("group", { name: "Builder actions" });

describe("BuilderCommandBar structure", () => {
  test("renders exactly one labelled command region", () => {
    renderBar();
    expect(screen.getAllByRole("group", { name: /Builder actions|Acciones del generador/ })).toHaveLength(1);
    expect(document.querySelectorAll(".pe-command-bar")).toHaveLength(1);
  });

  test("holds every builder action in that one region", () => {
    renderBar();
    const region = bar();
    ["Clear", "Review & Save", "Back", "Next"].forEach((name) => {
      expect(within(region).getByRole("button", { name })).toBeInTheDocument();
    });
  });

  test("renders the primary progression wording as explicit visible text", () => {
    renderBar();
    expect(document.querySelector(".pe-command-next-label")).toHaveTextContent("Next");
  });

  test("renders no duplicate of any action", () => {
    renderBar();
    ["Clear", "Review & Save", "Back", "Next"].forEach((name) => {
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    });
  });
});

describe("BuilderCommandBar document labels", () => {
  test("estimate mode renders current document and customer/project context", () => {
    renderBar();
    const context = document.querySelector(".pe-command-context");
    expect(within(context).getByText("Estimate")).toBeInTheDocument();
    expect(within(context).getByText("Acme Roofing")).toBeInTheDocument();
    expect(within(context).getByText("Lobby Refresh")).toBeInTheDocument();
    expect(within(context).queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(within(document.querySelector(".pe-command-bar-status")).getByText("Unsaved changes")).toBeInTheDocument();
    expect(context).toHaveAttribute("data-command-priority", "medium");
  });

  test("omits empty customer and project placeholders while retaining the total", () => {
    renderBar({ customerName: "", projectName: "" });
    expect(document.querySelector(".pe-command-context")).toBeNull();
    expect(screen.queryByText("Customer not selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Project not set")).not.toBeInTheDocument();
    expect(screen.getByText("Estimate Total")).toBeInTheDocument();
  });

  test("estimate mode shows the shared finalization entry and total", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.getByText("Estimate Total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Estimate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save & Exit" })).not.toBeInTheDocument();
  });

  test("invoice mode uses the same finalization entry and invoice total", () => {
    renderBar({ docType: "invoice", totalLabel: "Invoice Total" });
    const context = document.querySelector(".pe-command-context");
    expect(within(context).getByText("Invoice")).toBeInTheDocument();
    expect(within(context).getByText("Acme Roofing")).toBeInTheDocument();
    expect(within(context).getByText("Lobby Refresh")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.getByText("Invoice Total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Estimate" })).not.toBeInTheDocument();
  });

  test("an edit-mode clear label overrides the default wording", () => {
    renderBar({ clearLabel: "Cancel Edit" });
    expect(screen.getByRole("button", { name: "Cancel Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });
});

describe("BuilderCommandBar total", () => {
  test("renders supplied financial metadata verbatim without calculating it", () => {
    renderBar({
      totalValue: "$999.99",
      financialItems: [
        { id: "labor", label: "Labor", value: "$111.11" },
        { id: "materials", label: "Materials", value: "$222.22" },
        { id: "charges", label: "Charges", value: "$333.33" },
      ],
    });
    const summary = screen.getByLabelText("Live financial summary");
    expect(within(summary).getByText("$111.11")).toBeInTheDocument();
    expect(within(summary).getByText("$222.22")).toBeInTheDocument();
    expect(within(summary).getByText("$333.33")).toBeInTheDocument();
    expect(screen.getByText("$999.99")).toBeInTheDocument();
  });

  test("displays the supplied value verbatim and computes nothing", () => {
    // A value inconsistent with any plausible arithmetic proves pass-through.
    renderBar({ totalValue: "$9,999.99" });
    expect(screen.getByText("$9,999.99")).toBeInTheDocument();
  });

  test("keeps the long-standing .pe-total hook for existing selectors", () => {
    renderBar();
    const total = document.querySelector(".pe-total");
    expect(total).not.toBeNull();
    expect(total).toHaveClass("pe-command-total");
    expect(total).toHaveAttribute("data-command-priority", "always");
    expect(within(total).getByText("Estimate Total")).toBeInTheDocument();
    expect(within(total).getByText("$1,250.00")).toBeInTheDocument();
    expect(total.querySelector(".pe-command-total-label")).not.toBeNull();
    expect(total.querySelector(".pe-command-total-value")).not.toBeNull();
  });

  test("marks the detailed financial breakdown as wide-only presentation", () => {
    renderBar();
    expect(document.querySelector(".pe-command-financials")).toHaveAttribute("data-command-priority", "wide");
  });

  test("the compact total can be withheld on Review", () => {
    renderBar({ showTotal: false, isLastStep: true });
    expect(screen.queryByText("Estimate Total")).not.toBeInTheDocument();
    expect(document.querySelector(".pe-total")).toBeNull();
    expect(document.querySelector(".pe-command-context")).toBeNull();
    expect(document.querySelector(".pe-command-financials")).toBeNull();
  });
});

describe("BuilderCommandBar navigation state", () => {
  test("the first step omits Back but keeps every other action", () => {
    renderBar({ isFirstStep: true });
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  test("a disabled primary action keeps its explicit readable label", () => {
    const { handlers } = renderBar({ nextDisabled: true });
    const next = screen.getByRole("button", { name: "Next" });

    expect(next).toBeDisabled();
    expect(next).toHaveClass("pe-command-next");
    expect(within(next).getByText("Next", { selector: ".pe-command-next-label" })).toBeVisible();

    fireEvent.click(next);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  test("Review omits Next while keeping Back and the document actions", () => {
    renderBar({ isLastStep: true, showTotal: false });
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });
});

describe("BuilderCommandBar app chrome visibility", () => {
  test("hides and reveals from the shell-owned visibility signal", () => {
    const { props, rerender } = renderBar({ shellChromeVisible: false });
    const dock = document.querySelector(".pe-command-bar");
    expect(dock).toHaveClass("is-shell-hidden");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "false");
    expect(dock).toHaveAttribute("aria-hidden", "true");

    rerender(<BuilderCommandBar {...props} shellChromeVisible />);
    expect(dock).toHaveClass("is-shell-visible");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "true");
    expect(dock).not.toHaveAttribute("aria-hidden");
  });
});

describe("BuilderCommandBar handlers", () => {
  test("each control invokes its supplied handler exactly once", () => {
    const { handlers } = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onReviewSave).toHaveBeenCalledTimes(1);
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  test("clicking one action never triggers another", () => {
    const { handlers } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onReviewSave).not.toHaveBeenCalled();
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  test("every control is a semantic button", () => {
    renderBar();
    within(bar()).getAllByRole("button").forEach((node) => {
      expect(node.tagName).toBe("BUTTON");
      expect(node).toHaveAttribute("type", "button");
    });
  });
});

describe("BuilderCommandBar bilingual chrome", () => {
  test("Spanish translates navigation, document and destructive labels", () => {
    renderBar({
      lang: "es",
      totalLabel: "Total del estimado",
    });

    expect(screen.getByRole("group", { name: "Acciones del generador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atrás" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();
    expect(document.querySelector(".pe-command-next-label")).toHaveTextContent("Siguiente");
    expect(screen.getByRole("button", { name: "Revisar y guardar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
    expect(screen.getByText("Total del estimado")).toBeInTheDocument();
  });

  test("disabled Spanish progression remains labelled Siguiente", () => {
    renderBar({ lang: "es", nextDisabled: true });
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();
    expect(within(next).getByText("Siguiente", { selector: ".pe-command-next-label" })).toBeVisible();
  });

  test("Spanish invoice mode falls back to the invoice total wording", () => {
    renderBar({ lang: "es", docType: "invoice", totalLabel: undefined });
    expect(screen.getByText("Total de la factura")).toBeInTheDocument();
  });

  test("a supplied status slot renders inside the region", () => {
    renderBar({ statusSlot: <span data-testid="cloud-status">Saved</span> });
    const status = document.querySelector(".pe-command-bar-status");
    expect(within(status).getByTestId("cloud-status")).toBeInTheDocument();
    expect(within(status).queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(status).toHaveAttribute("data-command-priority", "always");
  });
});
