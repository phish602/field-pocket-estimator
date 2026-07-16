// Gate 17A: Company Profile subscription presentation is server-authoritative.
//
// The previous implementation re-read SUBSCRIPTION_PLAN_STATE from localStorage
// (including via a storage event listener), so writing that key moved the
// displayed plan. On a production host the label must now follow the server
// alone.
//
// SCOPE: presentation + subscription authority. Local PDF generation is not
// protected by Gate 17A (see Gate 17B).

import React from "react";
import { act, render, screen } from "@testing-library/react";

import CompanyProfileScreen from "./CompanyProfileScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { resolveCompanyEntitlements } from "../lib/companyEntitlementsApi";

jest.mock("../lib/companyEntitlementsApi", () => {
  const actual = jest.requireActual("../lib/companyEntitlementsApi");
  return { ...actual, resolveCompanyEntitlements: jest.fn() };
});

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "session-token";

const serverState = (plan, status = "active", source = "stripe") => ({
  version: 1, plan, status, source, resolvedAt: "2026-07-16T00:00:00.000Z", expiresAt: null,
  entitlements: {}, loading: false, ok: plan !== "free" || status === "free",
});

// jsdom defaults to localhost, which legitimately permits dev fallback. These
// tests must prove PRODUCTION behavior, so point the host at the real domain.
function setHostname(hostname) {
  delete window.location;
  window.location = { hostname, href: `https://${hostname}/`, origin: `https://${hostname}` };
}

const originalLocation = window.location;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  setHostname("www.estipaid.com");
});

afterAll(() => {
  delete window.location;
  window.location = originalLocation;
});

const renderProfile = async () => {
  await act(async () => {
    render(<CompanyProfileScreen supabaseConfigured companyId={COMPANY_ID} accessToken={TOKEN} />);
  });
};

test("a tampered local Business plan does not change the label when the server says Free", async () => {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ plan: "business", status: "active", source: "admin" }));
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({ plan: "business", status: "active", source: "stripe" }));
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ plan: "business" }));
  resolveCompanyEntitlements.mockResolvedValue(serverState("free", "free", "none"));

  await renderProfile();

  expect(screen.getByText("Free")).toBeInTheDocument();
  expect(screen.queryByText("Business")).toBeNull();
});

test("a storage event carrying a Business plan cannot move the label on production", async () => {
  resolveCompanyEntitlements.mockResolvedValue(serverState("free", "free", "none"));
  await renderProfile();
  expect(screen.getByText("Free")).toBeInTheDocument();

  // The old listener re-read local state on this exact event.
  await act(async () => {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ plan: "business", status: "active", source: "admin" }));
    window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, value: "x" } }));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE }));
  });

  expect(screen.getByText("Free")).toBeInTheDocument();
  expect(screen.queryByText("Business")).toBeNull();
});

test("the server-resolved plan is what the label shows", async () => {
  resolveCompanyEntitlements.mockResolvedValue(serverState("pro"));
  await renderProfile();
  expect(screen.getByText("Pro")).toBeInTheDocument();
  expect(resolveCompanyEntitlements).toHaveBeenCalledWith({ accessToken: TOKEN, companyId: COMPANY_ID });
});

test("an internal_comp Business grant displays Business", async () => {
  resolveCompanyEntitlements.mockResolvedValue(serverState("business", "active", "internal_comp"));
  await renderProfile();
  expect(screen.getByText("Business")).toBeInTheDocument();
});

test("a failed resolution presents Free even with a paid local value", async () => {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ plan: "business", status: "active", source: "admin" }));
  resolveCompanyEntitlements.mockResolvedValue({ ...serverState("free", "free", "none"), ok: false, code: "server_error" });
  await renderProfile();
  expect(screen.getByText("Free")).toBeInTheDocument();
});

test("without an access token the production host does not fall back to local state", async () => {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ plan: "business", status: "active", source: "admin" }));
  await act(async () => {
    render(<CompanyProfileScreen supabaseConfigured companyId={COMPANY_ID} accessToken="" />);
  });
  expect(screen.getByText("Free")).toBeInTheDocument();
  expect(resolveCompanyEntitlements).not.toHaveBeenCalled();
});
