import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function seedSubscriptionState(state) {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({
    source: "local_dev",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...state,
  }));
}

describe("CompanyProfileScreen subscription plan display", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("shows Free by default and does not offer a plan editor", async () => {
    await act(async () => {
      render(<CompanyProfileScreen />);
    });

    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Status: Free · PDF exports include EstiPaid branding. Upgrade to remove it.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/plan/i)).toBeNull();
  });

  test("shows trusted active Pro state without trusting Company Profile plan fields", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ plan: "team" }));
    seedSubscriptionState({ plan: "pro", status: "active" });

    await act(async () => {
      render(<CompanyProfileScreen />);
    });

    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Status: Active · Custom PDF branding enabled — no EstiPaid watermark.")).toBeInTheDocument();
  });

  test("saving Company Profile does not overwrite subscription state", async () => {
    const subscriptionState = { plan: "team", status: "active" };
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({
      companyName: "Desert Ridge",
      phone: "6025550100",
      addressLine1: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
    }));
    seedSubscriptionState(subscriptionState);
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      render(<CompanyProfileScreen />);
    });
    await act(async () => {
      fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Updated Ridge" } });
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      await Promise.resolve();
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE))).toMatchObject(subscriptionState);
    confirmSpy.mockRestore();
  });
});
