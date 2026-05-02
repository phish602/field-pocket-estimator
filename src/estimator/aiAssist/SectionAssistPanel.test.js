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
