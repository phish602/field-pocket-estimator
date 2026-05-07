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
  const originalConfirm = window.confirm;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    global.fetch = jest.fn();
    window.open = jest.fn(() => ({}));
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    global.fetch = originalFetch;
    window.open = originalOpen;
    window.alert = originalAlert;
    window.confirm = originalConfirm;
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

  test("Disconnect Stripe button appears when stripeAccountId exists", async () => {
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        ...DEFAULT_COMPANY_PROFILE,
        stripeAccountId: "acct_existing_123",
      }),
    );
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        stripeAccountId: "acct_existing_123",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      }),
    });

    render(<CompanyProfileScreen />);

    expect(await screen.findByTestId("stripe-account-id")).toHaveTextContent("acct_existing_123");
    expect(screen.getByRole("button", { name: /Disconnect Stripe/i })).toBeInTheDocument();
  });

  test("canceling Stripe disconnect leaves stripeAccountId and checkout sessions intact", async () => {
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        ...DEFAULT_COMPANY_PROFILE,
        companyName: "Desert Ridge",
        stripeAccountId: "acct_existing_123",
      }),
    );
    localStorage.setItem(
      STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS,
      JSON.stringify([{ invoiceId: "inv_1", sessionId: "cs_old_123", stripeAccountId: "acct_existing_123" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.INVOICES,
      JSON.stringify([{ id: "inv_1", invoiceNumber: "INV-1", payments: [{ id: "pay_1", method: "stripe", amount: 100 }] }]),
    );
    window.confirm = jest.fn(() => false);
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Disconnect Stripe/i }));
    });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Online payment links created for the old Stripe account will no longer be usable from EstiPaid."));
    expect(readStoredProfile().stripeAccountId).toBe("acct_existing_123");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS) || "[]")).toEqual([
      { invoiceId: "inv_1", sessionId: "cs_old_123", stripeAccountId: "acct_existing_123" },
    ]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]")).toEqual([
      { id: "inv_1", invoiceNumber: "INV-1", payments: [{ id: "pay_1", method: "stripe", amount: 100 }] },
    ]);
  });

  test("confirming Stripe disconnect clears stripeAccountId and stale checkout sessions without touching invoices", async () => {
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        ...DEFAULT_COMPANY_PROFILE,
        companyName: "Desert Ridge",
        stripeAccountId: "acct_existing_123",
      }),
    );
    localStorage.setItem(
      STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS,
      JSON.stringify([{ invoiceId: "inv_1", sessionId: "cs_old_123", stripeAccountId: "acct_existing_123" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.INVOICES,
      JSON.stringify([{ id: "inv_1", invoiceNumber: "INV-1", payments: [{ id: "pay_1", method: "stripe", amount: 100 }] }]),
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Disconnect Stripe/i }));
    });

    expect(readStoredProfile().stripeAccountId).toBe("");
    expect(localStorage.getItem(STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]")).toEqual([
      { id: "inv_1", invoiceNumber: "INV-1", payments: [{ id: "pay_1", method: "stripe", amount: 100 }] },
    ]);
    expect(screen.queryByTestId("stripe-account-id")).toBeNull();
    expect(screen.getByRole("button", { name: /Connect Stripe/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh Stripe Status/i })).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("does not refresh Stripe status without stripeAccountId", () => {
    render(<CompanyProfileScreen />);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Connect Stripe/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refresh Stripe Status/i })).toBeNull();
  });
});
