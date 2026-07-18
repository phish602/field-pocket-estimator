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
    rememberedEmail: "",
    clearRememberedAccount: jest.fn(),
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

    expect(await screen.findByText(/Sign in to back up and restore your company/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoices")).not.toBeInTheDocument();
  });

  test("existing session renders current app shell", async () => {
    seedBaselineLocalData();
    mockSharedSession = { user: { email: "owner@example.com" } };

    render(<App />);

    expect(await screen.findByLabelText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to back up and restore your company/i)).not.toBeInTheDocument();
  });

  test("sign-in success renders app shell", async () => {
    seedBaselineLocalData();
    render(<App />);

    await screen.findByText(/Sign in to back up and restore your company/i);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign In$/i }));

    expect(await screen.findByLabelText("Invoices")).toBeInTheDocument();
    expect(screen.queryByText(/Sign in to back up and restore your company/i)).not.toBeInTheDocument();
  });

  test("sign-in failure shows a readable error and stays on AuthScreen", async () => {
    mockSignInImpl = async () => ({ ok: false, error: "Invalid login credentials" });
    seedBaselineLocalData();
    render(<App />);

    await screen.findByText(/Sign in to back up and restore your company/i);

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

    expect(await screen.findByText(/Sign in to back up and restore your company/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invoices")).not.toBeInTheDocument();
  });
});

describe("AuthScreen standalone", () => {
  test("renders a polished login screen with brand, heading, and explainer", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    expect(screen.getByAltText("EstiPaid")).toBeInTheDocument();
    expect(screen.getAllByText("Sign In").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Sign in to back up and restore your company/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  test("shows Create Account and Forgot Password affordances when supported", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    expect(screen.getByRole("button", { name: /Create Account/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Forgot Password\?/i })).toBeInTheDocument();
  });

  test("shows remembered-account copy instead of stale signed-in copy when signed out", () => {
    render(
      <AuthScreen
        auth={buildAuthProp({
          rememberedEmail: "owner@example.com",
          infoMessage: "",
        })}
      />
    );

    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getByText(/Last used account:/i)).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/i)).not.toBeInTheDocument();
  });

  test("use different account clears remembered-account block from view", () => {
    const clearRememberedAccount = jest.fn();
    const { rerender } = render(
      <AuthScreen
        auth={buildAuthProp({
          rememberedEmail: "owner@example.com",
          clearRememberedAccount,
        })}
      />
    );

    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Use Different Account/i }));

    expect(clearRememberedAccount).toHaveBeenCalledTimes(1);

    rerender(
      <AuthScreen
        auth={buildAuthProp({
          rememberedEmail: "",
          clearRememberedAccount,
        })}
      />
    );

    expect(screen.queryByText(/Welcome back/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last used account:/i)).not.toBeInTheDocument();
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

  test("email and password fields expose password-manager-friendly autocomplete attributes", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");

    fireEvent.click(screen.getByRole("button", { name: /Create Account/i }));

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");

    fireEvent.click(screen.getByRole("button", { name: /Back to Sign In/i }));
    fireEvent.click(screen.getByRole("button", { name: /Forgot Password\?/i }));
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
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

  test("Sign In is the primary submit action", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    const submitButtons = screen.getAllByRole("button", { name: /^Sign In$/i });
    expect(submitButtons).toHaveLength(1);
    expect(submitButtons[0]).toHaveAttribute("type", "submit");

    const otherButtons = screen.getAllByRole("button").filter((btn) => btn !== submitButtons[0]);
    otherButtons.forEach((btn) => {
      expect(btn).toHaveAttribute("type", "button");
    });
  });

  test("keyboard form submit (Enter/Go) still calls signInWithPassword", () => {
    const signInWithPassword = jest.fn(async () => ({ ok: true }));
    const { container } = render(<AuthScreen auth={buildAuthProp({ signInWithPassword })} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });

    fireEvent.submit(container.querySelector("form"));

    expect(signInWithPassword).toHaveBeenCalledWith("owner@example.com", "correct-password");
  });
});

// Phase 2.1 -- password-recovery completion UI.
describe("AuthScreen password recovery", () => {
  // A VERIFIED recovery session (pending + ready) is what unlocks the form.
  const buildRecoveryProp = (overrides = {}) =>
    buildAuthProp({
      passwordRecoveryPending: true,
      passwordRecoveryReady: true,
      passwordRecoveryComplete: false,
      updatePassword: jest.fn(async () => ({ ok: true })),
      completePasswordRecovery: jest.fn(),
      abandonPasswordRecovery: jest.fn(),
      ...overrides,
    });

  const fillRecoveryFields = (next, confirm) => {
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: next } });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: confirm } });
  };

  test("renders the set-new-password form instead of the sign-in card", () => {
    render(<AuthScreen auth={buildRecoveryProp()} />);

    expect(screen.getByText("Set A New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm New Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Update Password$/i })).toHaveAttribute("type", "submit");
    // The normal sign-in fields are not present during recovery.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  test("a valid submission calls updatePassword exactly once", async () => {
    const updatePassword = jest.fn(async () => ({ ok: true }));
    render(<AuthScreen auth={buildRecoveryProp({ updatePassword })} />);

    fillRecoveryFields("brand-new-password", "brand-new-password");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Update Password$/i }));
    });

    expect(updatePassword).toHaveBeenCalledTimes(1);
    expect(updatePassword).toHaveBeenCalledWith("brand-new-password");
  });

  test.each([
    ["empty fields", "", "", /Enter and confirm your new password/i],
    ["a too-short password", "abc12", "abc12", /at least 6 characters/i],
    ["mismatched confirmation", "brand-new-password", "different-password", /Both passwords must match/i],
  ])("%s makes zero updatePassword calls and shows a readable message", async (_label, next, confirm, pattern) => {
    const updatePassword = jest.fn(async () => ({ ok: true }));
    render(<AuthScreen auth={buildRecoveryProp({ updatePassword })} />);

    fillRecoveryFields(next, confirm);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Update Password$/i }));
    });

    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  test("a provider failure keeps the form available for retry", () => {
    render(
      <AuthScreen
        auth={buildRecoveryProp({ errorMessage: "New password should be different from the old password." })}
      />
    );

    expect(
      screen.getByText("New password should be different from the old password.")
    ).toBeInTheDocument();
    // Still on the recovery form, so the user can try again.
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Update Password$/i })).toBeInTheDocument();
  });

  test("shows a busy label while the update is in flight", () => {
    render(<AuthScreen auth={buildRecoveryProp({ authBusy: true })} />);

    expect(screen.getByRole("button", { name: /Updating Password\.\.\./i })).toBeDisabled();
  });

  test("success shows the confirmation and only the explicit continuation finishes recovery", () => {
    const completePasswordRecovery = jest.fn();
    render(
      <AuthScreen auth={buildRecoveryProp({ passwordRecoveryComplete: true, completePasswordRecovery })} />
    );

    expect(screen.getByText("Password Updated")).toBeInTheDocument();
    expect(screen.getByText("Password updated.")).toBeInTheDocument();
    // The form is replaced by the confirmation.
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: /Continue to EstiPaid/i });
    expect(completePasswordRecovery).not.toHaveBeenCalled();

    fireEvent.click(continueButton);
    expect(completePasswordRecovery).toHaveBeenCalledTimes(1);
  });

  test("no recovery state renders the normal sign-in card unchanged", () => {
    render(<AuthScreen auth={buildAuthProp()} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(screen.queryByText("Set A New Password")).not.toBeInTheDocument();
  });

  // Recovery intent WITHOUT a verified recovery session.
  test("an unverified/expired recovery shows Back to Sign In and no actionable form", () => {
    const updatePassword = jest.fn(async () => ({ ok: true }));
    render(
      <AuthScreen auth={buildRecoveryProp({ passwordRecoveryReady: false, updatePassword })} />
    );

    expect(screen.getByText("Reset Link Not Valid")).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument();
    // No way to attempt an update.
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Update Password$/i })).not.toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Back to Sign In/i })).toBeInTheDocument();
  });

  test("Back to Sign In abandons recovery without ever calling updatePassword", () => {
    const abandonPasswordRecovery = jest.fn();
    const updatePassword = jest.fn(async () => ({ ok: true }));
    render(
      <AuthScreen
        auth={buildRecoveryProp({ passwordRecoveryReady: false, abandonPasswordRecovery, updatePassword })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Back to Sign In/i }));

    expect(abandonPasswordRecovery).toHaveBeenCalledTimes(1);
    expect(updatePassword).not.toHaveBeenCalled();
  });
});
