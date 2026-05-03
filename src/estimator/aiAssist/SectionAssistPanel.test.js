import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import SectionAssistPanel from "./SectionAssistPanel";
import { laborAssistConfig } from "./adapters/labor";
import { scopeAssistConfig } from "./adapters/scope";
import { materialsAssistConfig } from "./adapters/materials";

function renderOpenPanel(config, onSubmit = jest.fn()) {
  const onClose = jest.fn();
  render(
    <SectionAssistPanel
      config={config}
      assistState={{ phase: "open", input: "", suggestedPrompts: [] }}
      onSubmit={onSubmit}
      onAccept={jest.fn()}
      onClose={onClose}
    />
  );
  return { onSubmit, onClose };
}

function renderLaborReview(laborLines) {
  const onClose = jest.fn();
  const onAccept = jest.fn();
  render(
    <SectionAssistPanel
      config={laborAssistConfig}
      assistState={{ phase: "review", result: { writes: { laborLines } } }}
      onSubmit={jest.fn()}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
  return { onClose, onAccept };
}

describe("SectionAssistPanel blank submit behavior", () => {
  test("allows blank submit for labor", () => {
    const onSubmit = jest.fn();
    renderOpenPanel(laborAssistConfig, onSubmit);

    fireEvent.click(screen.getByRole("button", { name: laborAssistConfig.generateLabel }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  test("blocks blank submit for scope", () => {
    const onSubmit = jest.fn();
    renderOpenPanel(scopeAssistConfig, onSubmit);

    fireEvent.click(screen.getByRole("button", { name: scopeAssistConfig.generateLabel }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("blocks blank submit for materials", () => {
    const onSubmit = jest.fn();
    renderOpenPanel(materialsAssistConfig, onSubmit);

    fireEvent.click(screen.getByRole("button", { name: materialsAssistConfig.generateLabel }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("SectionAssistPanel labor review qty visibility", () => {
  test("shows qty tag when qty is greater than 1", () => {
    renderLaborReview([
      { id: "l1", label: "Foreman", hours: "8", rate: "65", qty: "2" },
    ]);

    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("Foreman")).toBeInTheDocument();
    expect(screen.getByText("8 hrs · $65/hr")).toBeInTheDocument();
  });

  test("hides qty tag when qty is 1", () => {
    renderLaborReview([
      { id: "l1", label: "Foreman", hours: "8", rate: "65", qty: "1" },
    ]);

    expect(screen.queryByText("×1")).not.toBeInTheDocument();
    expect(screen.getByText("Foreman")).toBeInTheDocument();
  });

  test("hides qty tag when qty is missing", () => {
    renderLaborReview([
      { id: "l1", label: "Foreman", hours: "8", rate: "65" },
    ]);

    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
    expect(screen.getByText("Foreman")).toBeInTheDocument();
  });
});
