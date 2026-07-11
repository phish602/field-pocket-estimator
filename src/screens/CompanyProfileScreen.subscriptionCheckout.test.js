import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

function seedSubscriptionState(state) {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ source: "local_dev", updatedAt: "2026-07-11T00:00:00.000Z", ...state }));
}

describe("CompanyProfileScreen subscription Checkout entry", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  beforeEach(() => {
    localStorage.clear();
    window.open = jest.fn(() => ({}));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
  });

  test("shows both upgrade actions for Free without an editable plan selector", async () => {
    await act(async () => { render(<CompanyProfileScreen />); });
    expect(screen.getByRole("button", { name: "Upgrade to Pro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Team" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/plan/i)).toBeNull();
  });

  test("requests Pro Checkout with the authenticated company context only and does not mutate plan storage", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ checkoutUrl: "https://checkout.stripe.test/session" }) }));
    await act(async () => {
      render(<CompanyProfileScreen supabaseConfigured companyId="company_1" accessToken="token_1" />);
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" })); });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith("/api/stripe/create-subscription-checkout", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer token_1" }),
      body: JSON.stringify({ plan: "pro", companyId: "company_1" }),
    }));
    expect(window.open).toHaveBeenCalledWith("https://checkout.stripe.test/session", "_self");
    expect(localStorage.getItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE)).toBeNull();
  });

  test("shows current Pro state without Free upgrade copy and offers only Team", async () => {
    seedSubscriptionState({ plan: "pro", status: "active" });
    await act(async () => { render(<CompanyProfileScreen />); });
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
    expect(screen.queryByText(/PDF exports include EstiPaid branding/i)).toBeNull();
  });
});
