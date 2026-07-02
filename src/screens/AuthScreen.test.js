import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";

let mockSharedSession = null;
let mockSharedConfigured = true;
const mockSessionListeners = new Set();

function mockSetSharedSession(next) {
  mockSharedSession = next;
  mockSessionListeners.forEach((fn) => fn(next));
}

let mockSignInImpl = async (email) => ({ ok: true, session: { user: { email } } });
let mockSignUpImpl = async (email) => ({ ok: true, session: { user: { email } } });
let mockResetImpl = async () => ({ ok: true });

jest.mock("../lib/useSupabaseAuth", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () => {
      const [session, setSession] = ReactLib.useState(() => mockSharedSession);
      const [authBusy, setAuthBusy] = ReactLib.useState(false);
      const [errorMessage, setErrorMessage] = ReactLib.useState("");
      const [infoMessage, setInfoMessage] = ReactLib.useState("");

      ReactLib.useEffect(() => {
        mockSessionListeners.add(setSession);
        return () => mockSessionListeners.delete(setSession);
      }, []);

      const signInWithPassword = async (email, password) => {
        setAuthBusy(true);
        setErrorMessage("");
        setInfoMessage("");
        const result = await mockSignInImpl(email, password);
        if (result.ok) {
          mockSetSharedSession(result.session || { user: { email } });
        } else {
          setErrorMessage(result.error || "Unable to sign in with password.");
        }
        setAuthBusy(false);
        return result;
      };

      const signUpWithPassword = async (email, password) => {
        setAuthBusy(true);
        setErrorMessage("");
        setInfoMessage("");
        const result = await mockSignUpImpl(email, password);
        if (result.ok) {
          if (result.session) {
            mockSetSharedSession(result.session);
          } else {
            setInfoMessage(result.infoMessage || `Check ${email} to confirm your account.`);
          }
        } else {
          setErrorMessage(result.error || "Unable to create account.");
        }
        setAuthBusy(false);
        return result;
      };

      const resetPasswordForEmail = async (email) => {
        setAuthBusy(true);
        setErrorMessage("");
        setInfoMessage("");
        const result = await mockResetImpl(email);
        if (result.ok) {
          setInfoMessage(result.infoMessage || `Check ${email} for a password reset link.`);
        } else {
          setErrorMessage(result.error || "Unable to send password reset email.");
        }
        setAuthBusy(false);
        return result;
      };

      const signOut = async () => {
        setAuthBusy(true);
        mockSetSharedSession(null);
        setInfoMessage("Signed out.");
        setAuthBusy(false);
        return { ok: true };
      };

      return {
        configured: mockSharedConfigured,
        missingEnvKeys: [],
        loading: false,
        authBusy,
        session,
        user: session?.user || null,
        userEmail: String(session?.user?.email || ""),
        errorMessage,
        infoMessage,
        signInWithPassword,
        signUpWithPassword,
        resetPasswordForEmail,
        signOut,
      };
    },
  };
});

import App from "../App";
import AuthScreen from "./AuthScreen";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function seedBaselineLocalData() {
  seedCompanyProfile();
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
}

function buildAuthProp(overrides = {}) {
  return {
    authBusy: false,
    errorMessage: "",
    infoMessage: "",
    signInWithPassword: jest.fn(async () => ({ ok: true })),
    signUpWithPassword: jest.fn(async () => ({ ok: true })),
    resetPasswordForEmail: jest.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  mockSharedSession = null;
  mockSharedConfigured = true;
  mockSessionListeners.clear();
  mockSignInImpl = async (email) => ({ ok: true, session: { user: { email } } });
  mockSignUpImpl = async (email) => ({ ok: true, session: { user: { email } } });
  mockResetImpl = async () => ({ ok: true });
});

describe("App-level auth gating", () => {
  test("no session renders AuthScreen", async () => {
    seedBaselineLocalData();
    render(<App />);

    expect(await screen.findByText(/Sign in to sync your company/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoices")).not.toBeInTheDocument();
  });

  test("existing session renders current app shell", async () => {
    seedBaselineLocalData();
    mockSharedSession = { user: { email: "owner@example.com" } };

    render(<App />);

    expect(await screen.findByLabelText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to sync your company/i)).not.toBeInTheDocument();
  });

  test("sign-in success renders app shell", async () => {
    seedBaselineLocalData();
    render(<App />);

    await screen.findByText(/Sign in to sync your company/i);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign In$/i }));

    expect(await screen.findByLabelText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to sync your company/i)).not.toBeInTheDocument();
  });

  test("sign-in failure shows a readable error and stays on AuthScreen", async () => {
    mockSignInImpl = async () => ({ ok: false, error: "Invalid login credentials" });
    seedBaselineLocalData();
    render(<App />);

    await screen.findByText(/Sign in to sync your company/i);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign In$/i }));

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoices")).not.toBeInTheDocument();
  });

  test("returning to AuthScreen when the session clears (sign-out path)", async () => {
    seedBaselineLocalData();
    mockSharedSession = { user: { email: "owner@example.com" } };

    render(<App />);

    expect(await screen.findByLabelText("Invoices")).toBeInTheDocument();

    await act(async () => {
      mockSetSharedSession(null);
    });

    expect(await screen.findByText(/Sign in to sync your company/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoices")).not.toBeInTheDocument();
  });
});

describe("AuthScreen standalone", () => {
  test("shows Create Account and Forgot Password affordances when supported", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    expect(screen.getByRole("button", { name: /Create Account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Forgot Password\?/i })).toBeInTheDocument();
  });

  test("hides Create Account and Forgot Password when not supported", () => {
    render(
      <AuthScreen
        auth={buildAuthProp({ signUpWithPassword: undefined, resetPasswordForEmail: undefined })}
      />
    );

    expect(screen.queryByRole("button", { name: /Create Account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Forgot Password\?/i })).not.toBeInTheDocument();
  });

  test("create account success switches to signed-in state via signUpWithPassword", async () => {
    const signUpWithPassword = jest.fn(async () => ({ ok: true }));
    render(<AuthScreen auth={buildAuthProp({ signUpWithPassword })} />);

    fireEvent.click(screen.getByRole("button", { name: /Create Account/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create Account$/i }));

    await waitFor(() => {
      expect(signUpWithPassword).toHaveBeenCalledWith("new@example.com", "new-password");
    });
  });

  test("create account failure shows a readable error", async () => {
    const signUpWithPassword = jest.fn(async () => ({ ok: false }));
    const { rerender } = render(
      <AuthScreen auth={buildAuthProp({ signUpWithPassword, errorMessage: "" })} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Create Account/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create Account$/i }));

    await waitFor(() => expect(signUpWithPassword).toHaveBeenCalled());

    rerender(
      <AuthScreen
        auth={buildAuthProp({ signUpWithPassword, errorMessage: "Password should be at least 6 characters." })}
      />
    );

    expect(screen.getByText("Password should be at least 6 characters.")).toBeInTheDocument();
  });

  test("forgot-password success shows a readable confirmation", async () => {
    const resetPasswordForEmail = jest.fn(async () => ({ ok: true }));
    const { rerender } = render(
      <AuthScreen auth={buildAuthProp({ resetPasswordForEmail })} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Forgot Password\?/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send Reset Email/i }));

    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith("owner@example.com");
    });

    rerender(
      <AuthScreen
        auth={buildAuthProp({
          resetPasswordForEmail,
          infoMessage: "Check owner@example.com for a password reset link.",
        })}
      />
    );

    expect(screen.getByText("Check owner@example.com for a password reset link.")).toBeInTheDocument();
  });

  test("forgot-password failure shows a readable error", async () => {
    const resetPasswordForEmail = jest.fn(async () => ({ ok: false }));
    const { rerender } = render(
      <AuthScreen auth={buildAuthProp({ resetPasswordForEmail })} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Forgot Password\?/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "unknown@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send Reset Email/i }));

    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());

    rerender(
      <AuthScreen
        auth={buildAuthProp({
          resetPasswordForEmail,
          errorMessage: "Unable to send password reset email.",
        })}
      />
    );

    expect(screen.getByText("Unable to send password reset email.")).toBeInTheDocument();
  });

  test("shows a busy label while an auth action is in flight", () => {
    render(<AuthScreen auth={buildAuthProp({ authBusy: true })} />);

    expect(screen.getByRole("button", { name: /Signing In\.\.\./i })).toBeDisabled();
  });
});
