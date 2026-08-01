import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import VaultAccessGate from "./VaultAccessGate";

const capability = (state, code = "", message = "") => ({ state, code, message });
const renderGate = (props = {}) => render(<VaultAccessGate capability={capability("locked")} setup={jest.fn()} unlock={jest.fn()} {...props} />);

test("checking renders branded progress and never renders shell content", () => {
  renderGate({ checking: true });
  expect(screen.getByRole("status", { name: "Opening secure local vault" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
});

test("setup includes the full password disclosure and requires acknowledgement", () => {
  const setup = jest.fn();
  renderGate({ capability: capability("setup_required"), setup });
  expect(screen.getByText(/separate from your EstiPaid account\/login password/i)).toBeInTheDocument();
  expect(screen.getByText(/no recovery codes/i)).toBeInTheDocument();
  expect(screen.getAllByText(/cannot recover/i)).toHaveLength(2);
  expect(screen.getByText(/destructive local reset/i)).toBeInTheDocument();
  expect(screen.getByText(/permanently lose/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set Local Data Password" })).toBeDisabled();
  expect(screen.getByLabelText("Local Data Password").value).toBe("");
  expect(setup).not.toHaveBeenCalled();
});

test("setup reads an uncontrolled password on submit and clears the field immediately", async () => {
  let release;
  const setup = jest.fn(() => new Promise((resolve) => { release = resolve; }));
  renderGate({ capability: capability("setup_required"), setup });
  fireEvent.click(screen.getByRole("checkbox"));
  const input = screen.getByLabelText("Local Data Password");
  fireEvent.change(input, { target: { value: "setup-password" } });
  fireEvent.submit(input.closest("form"));
  expect(input.value).toBe("");
  expect(setup).toHaveBeenCalledWith("setup-password");
  await act(async () => { release(); });
});

test("empty setup password is rejected safely", () => {
  renderGate({ capability: capability("setup_required") });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Set Local Data Password" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a Local Data Password to continue.");
});

test("locked view distinguishes the Local Data Password from the login password", () => {
  renderGate();
  expect(screen.getByText(/not your EstiPaid login password/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Local Data Password")).toHaveAttribute("autocomplete", "current-password");
});

test("unlock clears its uncontrolled password field and invokes the supplied callback", async () => {
  const unlock = jest.fn();
  renderGate({ unlock });
  const input = screen.getByLabelText("Local Data Password");
  fireEvent.change(input, { target: { value: "unlock-password" } });
  await act(async () => { fireEvent.submit(input.closest("form")); });
  expect(input.value).toBe("");
  expect(unlock).toHaveBeenCalledWith("unlock-password");
});

test("empty unlock password is rejected safely and pending prevents duplicate submits", () => {
  const unlock = jest.fn(() => new Promise(() => {}));
  const pendingView = renderGate({ unlock });
  const input = screen.getByLabelText("Local Data Password");
  fireEvent.change(input, { target: { value: "unlock-password" } });
  fireEvent.submit(input.closest("form"));
  expect(screen.getByRole("button", { name: /opening secure vault/i })).toBeDisabled();
  expect(unlock).toHaveBeenCalledTimes(1);
  pendingView.unmount();
  renderGate();
  fireEvent.click(screen.getByRole("button", { name: "Unlock Local Data" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a Local Data Password to continue.");
});

test("wrong-password and tampered authentication failures render the identical safe text", () => {
  const first = renderGate({ capability: capability("locked", "AUTHENTICATION_FAILED", "wrong password") });
  const firstText = screen.getByRole("alert").textContent;
  first.unmount();
  renderGate({ capability: capability("locked", "AUTHENTICATION_FAILED", "tampered sentinel") });
  expect(screen.getByRole("alert")).toHaveTextContent(firstText);
  expect(firstText).toBe("The Local Data Password is incorrect or the local vault is damaged.");
});

test("damaged, unsupported KDF/environment, storage, and reset-required states remain distinct and fail closed", () => {
  const { rerender } = renderGate({ capability: capability("damaged", "RECORD_CORRUPT", "metadata") });
  expect(screen.getByText(/cannot be opened safely/i)).toBeInTheDocument();
  rerender(<VaultAccessGate capability={capability("unsupported", "UNSUPPORTED_KDF_POLICY")} />);
  expect(screen.getByText(/cannot initialize the required/i)).toBeInTheDocument();
  rerender(<VaultAccessGate capability={capability("unsupported", "UNSUPPORTED_ENVIRONMENT")} />);
  expect(screen.getByText(/secure browser features/i)).toBeInTheDocument();
  rerender(<VaultAccessGate capability={capability("locked", "STORAGE_OPERATION_FAILED", "raw stack")} unlock={jest.fn()} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t open the local encrypted vault/i);
  expect(screen.queryByText(/raw stack/i)).not.toBeInTheDocument();
  rerender(<VaultAccessGate capability={capability("reset_required")} />);
  expect(screen.getByText(/Local reset is required/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
});

test("the gate performs no storage, network, or event operation", () => {
  const local = jest.spyOn(Storage.prototype, "getItem");
  const session = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  try {
    renderGate({ capability: capability("damaged", "RECORD_CORRUPT", "secret metadata") });
    expect(local).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("secret metadata");
  } finally {
    local.mockRestore(); session.mockRestore(); dispatch.mockRestore(); fetch.mockRestore();
  }
});
