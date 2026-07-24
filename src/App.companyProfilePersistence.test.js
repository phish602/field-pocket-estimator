import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const PROFILE = {
  companyName: "Desert Ridge",
  phone: "6025550147",
  addressLine1: "123 Main St",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
  logoDataUrl: "data:image/png;base64,old-logo",
};

function shellAction(action) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action } }));
  });
}

describe("App Company Profile dirty-navigation integration", () => {
  let originalConfirm;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(PROFILE));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    localStorage.clear();
  });

  test("a successful Company Profile save clears the shell dirty-navigation block", async () => {
    render(<App />);
    shellAction("openCompanyProfile");
    expect(await screen.findByRole("heading", { name: "Company Profile" })).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Updated Ridge" } });
    await waitFor(() => {
      shellAction("goEstimatesTab");
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual(expect.objectContaining({ companyName: "Updated Ridge" })));

    shellAction("goEstimatesTab");
    await waitFor(() => expect(screen.getByRole("heading", { name: /Saved Estimates/i })).toBeInTheDocument());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
