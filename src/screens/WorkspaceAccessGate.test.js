import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The bootstrap hook is the single owner of company/membership creation. It is
// mocked so these tests cover the gate's presentation and submission guarding
// without creating a second onboarding path.
let mockBootstrapState;
const mockCreateWorkspace = jest.fn();

jest.mock("../lib/useSupabaseWorkspaceBootstrap", () => ({
  __esModule: true,
  default: () => mockBootstrapState,
}));

import WorkspaceAccessGate from "./WorkspaceAccessGate";

function buildAuth(overrides = {}) {
  return { configured: true, user: { id: "user-1" }, signOut: jest.fn(), ...overrides };
}

function buildAccount(overrides = {}) {
  return { membership: null, error: "", refresh: jest.fn(), ...overrides };
}

beforeEach(() => {
  mockCreateWorkspace.mockClear();
  mockBootstrapState = { creating: false, error: "", createWorkspace: mockCreateWorkspace };
});

describe("WorkspaceAccessGate first-run company setup", () => {
  test("renders a guided setup form with the company field and hint", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create My Workspace" })).toBeInTheDocument();
    expect(screen.getByText(/only thing we need/i)).toBeInTheDocument();
    expect(screen.getByText(/appears on your estimates, invoices, and PDFs/i)).toBeInTheDocument();
  });

  test("blocks an empty submission and never calls the bootstrap hook", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    const form = document.querySelector("form");
    fireEvent.submit(form);

    expect(screen.getByText("Enter your company name to continue.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveAttribute("aria-invalid", "true");
    expect(mockCreateWorkspace).not.toHaveBeenCalled();
  });

  test("submission stays reachable while the field is empty", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    // A disabled button would also suppress the browser's implicit Enter
    // submission, so the inline message below could never be reached and the
    // screen would appear to do nothing at all.
    expect(screen.getByRole("button", { name: "Create My Workspace" })).not.toBeDisabled();

    fireEvent.submit(document.querySelector("form"));

    expect(screen.getByText("Enter your company name to continue.")).toBeInTheDocument();
  });

  test("raw backend failure text never reaches the setup screen", () => {
    const { rerender } = render(
      <WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />
    );

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Valley Roofing" } });

    mockBootstrapState = {
      creating: false,
      error: "TypeError: Failed to fetch",
      createWorkspace: mockCreateWorkspace,
    };
    rerender(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t create your workspace. Please try again.");
    expect(alert).not.toHaveTextContent(/TypeError/);
    // The retry must still start from what was already typed.
    expect(screen.getByLabelText("Company name")).toHaveValue("Valley Roofing");
  });

  test("a whitespace-only company name is rejected before creation", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "   " } });
    fireEvent.submit(document.querySelector("form"));

    expect(mockCreateWorkspace).not.toHaveBeenCalled();
  });

  test("a valid name creates the workspace exactly once with a trimmed value", async () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "  Valley Roofing  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create My Workspace" }));

    await waitFor(() => expect(mockCreateWorkspace).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkspace).toHaveBeenCalledWith("Valley Roofing");
  });

  test("repeated submits cannot create a duplicate company", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Valley Roofing" } });
    const form = document.querySelector("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // The in-flight guard holds until the hook reports creating/completion, so
    // a double tap or Enter+click cannot produce a second company.
    expect(mockCreateWorkspace).toHaveBeenCalledTimes(1);
  });

  test("the typed company name survives the creating transition", () => {
    const { rerender } = render(
      <WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />
    );

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Valley Roofing" } });

    mockBootstrapState = { creating: true, error: "", createWorkspace: mockCreateWorkspace };
    rerender(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    // The form stays mounted while creating, so the entered value is not lost
    // and is still present if creation fails.
    expect(screen.getByLabelText("Company name")).toHaveValue("Valley Roofing");
    expect(screen.getByRole("button", { name: /Creating your workspace/i })).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("a bootstrap error is surfaced and the entered value is retained", () => {
    const { rerender } = render(
      <WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />
    );

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Valley Roofing" } });

    mockBootstrapState = {
      creating: false,
      error: "We couldn’t create your workspace.",
      createWorkspace: mockCreateWorkspace,
    };
    rerender(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t create your workspace.");
    expect(screen.getByLabelText("Company name")).toHaveValue("Valley Roofing");
  });

  test("setup copy can be switched to Spanish in memory only", () => {
    render(<WorkspaceAccessGate state="setup" auth={buildAuth()} account={buildAccount()} />);

    fireEvent.click(screen.getByRole("button", { name: "Change language" }));

    expect(screen.getByLabelText("Nombre de la compañía")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crear Mi Espacio de Trabajo" })
    ).toBeInTheDocument();
  });
});

describe("WorkspaceAccessGate non-setup states", () => {
  test("loading and activating present a stable announced progress surface", () => {
    const { rerender } = render(
      <WorkspaceAccessGate state="loading" auth={buildAuth()} account={buildAccount()} />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Opening your workspace/i)).toBeInTheDocument();

    rerender(<WorkspaceAccessGate state="activating" auth={buildAuth()} account={buildAccount()} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Setting up your workspace/i)).toBeInTheDocument();
  });

  test("account-error keeps retry and sign-out available and shows the account error", () => {
    const account = buildAccount({ error: "Membership lookup failed." });
    const auth = buildAuth();
    render(<WorkspaceAccessGate state="account-error" auth={auth} account={account} />);

    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(account.refresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("alert")).toHaveTextContent("Membership lookup failed.");
  });

  test("account-error sanitizes raw backend text before showing it", () => {
    const account = buildAccount({
      error: 'PGRST116: JSON object requested, multiple (or no) rows returned',
    });
    render(<WorkspaceAccessGate state="account-error" auth={buildAuth()} account={account} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(alert).not.toHaveTextContent(/PGRST/);
  });

  test("activation-error preserves the sign-out escape hatch", () => {
    const auth = buildAuth();
    render(<WorkspaceAccessGate state="activation-error" auth={auth} account={buildAccount()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  test("configuration-error stays fail-closed with a retry only", () => {
    render(<WorkspaceAccessGate state="configuration-error" auth={buildAuth()} account={buildAccount()} />);

    expect(screen.getByText(/couldn’t start securely/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  });
});
