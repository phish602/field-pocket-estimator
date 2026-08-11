import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SectionMaterials from "./SectionMaterials";

function buildProps(overrides = {}) {
  return {
    t: (key) => key,
    lang: "en",
    styles: {},
    bottomActionsStyle: {},
    headerIcon: <span />,
    money: { format: (value) => `$${Number(value || 0).toFixed(2)}` },
    collapseMs: 0,
    materialsMode: "itemized",
    setMaterialsMode: jest.fn(),
    materialsOpen: true,
    setMaterialsOpen: jest.fn(),
    itemizedCollapsedSummary: "1 item",
    materialsCost: "0",
    setMaterialsCost: jest.fn(),
    normalizeMoneyInput: (value) => value,
    materialsMarkupPct: "0",
    setMaterialsMarkupPct: jest.fn(),
    materialsBlanketDescription: "",
    setMaterialsBlanketDescription: jest.fn(),
    normalizePercentInput: (value) => String(value ?? ""),
    normalizedMarkupPct: 0,
    lockMarkupToGlobal: false,
    globalMarkupPct: 0,
    animateMaterialsTotal: false,
    materialsBilled: 25,
    materialItems: [{ id: "mat_1", desc: "Drywall", note: "", qty: 1, charge: 25, markupPct: 0 }],
    materialLineTotalsById: new Map([["mat_1", 25]]),
    updateMaterialItem: jest.fn(),
    removeMaterialItem: jest.fn(),
    showInternalCostFields: false,
    lockInternalCostFields: false,
    newMaterialItemIds: {},
    itemizedMaterialsTotal: 25,
    addMaterialItem: jest.fn(),
    trashIcon: <span>trash</span>,
    ...overrides,
  };
}

describe("SectionMaterials disclosure defaults", () => {
  test("itemized material notes load open even when empty", () => {
    render(<SectionMaterials {...buildProps()} />);

    expect(screen.getByRole("button", { name: "Hide note" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("materialNotePlaceholder")).toBeInTheDocument();
  });

  test("a manually collapsed material note stays collapsed on rerender", () => {
    const props = buildProps();
    const view = render(<SectionMaterials {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide note" }));
    expect(screen.getByRole("button", { name: "+ Add note" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByPlaceholderText("materialNotePlaceholder")).not.toBeInTheDocument();

    view.rerender(<SectionMaterials {...props} />);
    expect(screen.getByRole("button", { name: "+ Add note" })).toHaveAttribute("aria-expanded", "false");
  });
});
