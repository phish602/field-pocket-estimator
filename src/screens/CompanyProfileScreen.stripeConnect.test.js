import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_COMPANY_PROFILE } from "../utils/storage";

function readStoredProfile() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE) || "{}");
}

describe("CompanyProfileScreen Stripe Connect", () => {
  const originalFetch = global.fetch;
  const originalOpen = window.open;
  const originalAlert = window.alert;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    jest.useRealTimers();
  });

  test("DEFAULT_COMPANY_PROFILE includes stripeAccountId", () => {
    expect(DEFAULT_COMPANY_PROFILE.stripeAccountId).toBe("");
  });

  test("renders Stripe Payments section with Connect Stripe button", () => {
    render(<CompanyProfileScreen />);

    expect(screen.getByText("STRIPE PAYMENTS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Stripe/i })).toBeInTheDocument();
  });

  test("Connect Stripe stores stripeAccountId in company profile before redirect", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          stripeAccountId: "acct_test_connect_123",
          accountLinkUrl: "https://connect.stripe.com/setup/test-link",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          stripeAccountId: "acct_test_connect_123",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        }),
      });

    render(<CompanyProfileScreen />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Connect Stripe/i }));
    });

    await waitFor(() => {
      expect(readStoredProfile().stripeAccountId).toBe("acct_test_connect_123");
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/stripe/connect/create-account-link",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(window.open).toHaveBeenCalledWith("https://connect.stripe.com/setup/test-link", "_self");
  });

  test("existing stripeAccountId loads and shows Stripe status", async () => {
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        ...DEFAULT_COMPANY_PROFILE,
        companyName: "Desert Ridge",
        stripeAccountId: "acct_existing_123",
      }),
    );
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        stripeAccountId: "acct_existing_123",
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
      }),
    });

    render(<CompanyProfileScreen />);

    expect(await screen.findByTestId("stripe-account-id")).toHaveTextContent("acct_existing_123");
    await waitFor(() => {
      expect(screen.getByText(/Charges enabled:/i)).toHaveTextContent("Yes");
    });
    expect(screen.getByText(/Payouts enabled:/i)).toHaveTextContent("No");
    expect(screen.getByText(/Details submitted:/i)).toHaveTextContent("Yes");
    expect(screen.getByRole("button", { name: /Continue Stripe Setup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh Stripe Status/i })).toBeInTheDocument();
  });

  test("Refresh Stripe Status updates enabled and disabled flags", async () => {
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        ...DEFAULT_COMPANY_PROFILE,
        companyName: "Desert Ridge",
        stripeAccountId: "acct_refresh_123",
      }),
    );
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          stripeAccountId: "acct_refresh_123",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          stripeAccountId: "acct_refresh_123",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
      });

    render(<CompanyProfileScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Charges enabled:/i)).toHaveTextContent("No");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Refresh Stripe Status/i })).toBeEnabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Refresh Stripe Status/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Charges enabled:/i)).toHaveTextContent("Yes");
    });
    expect(screen.getByText(/Payouts enabled:/i)).toHaveTextContent("Yes");
    expect(screen.getByText(/Details submitted:/i)).toHaveTextContent("Yes");
  });
});
