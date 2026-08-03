import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import VaultAccessGate from "./VaultAccessGate";

const capability = (state, code = "", message = "") => ({ state, code, message });
const renderGate = (props = {}) => render(<VaultAccessGate capability={capability("locked")} refresh={jest.fn()} {...props} />);

test("checking renders branded passwordless progress", () => {
  renderGate({ checking: true });
  expect(screen.getByRole("status", { name: "Opening secure local vault" })).toBeInTheDocument();
  expect(screen.getByText(/No additional password is required/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
});

test("setup-required stays in automatic progress and never asks for a password", () => {
  renderGate({ capability: capability("setup_required") });
  expect(screen.getByText(/preparing this device’s encrypted local vault/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByText(/Local Data Password/i)).not.toBeInTheDocument();
});

test("locked view reopens with the device key", () => {
  const refresh = jest.fn();
  renderGate({ refresh });
  expect(screen.getByText(/device’s secure key/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue to EstiPaid" }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("locked storage failure stays generic and leaks no raw message", () => {
  renderGate({ capability: capability("locked", "STORAGE_OPERATION_FAILED", "raw stack and key details") });
  expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t open the local encrypted vault/i);
  expect(document.body.textContent).not.toContain("raw stack and key details");
});

test("damaged, unsupported, and recovery-required states fail closed without destructive controls", () => {
  const { rerender } = renderGate({ capability: capability("damaged", "RECORD_CORRUPT") });
  expect(screen.getByText(/cannot be opened safely/i)).toBeInTheDocument();

  rerender(<VaultAccessGate capability={capability("unsupported", "UNSUPPORTED_ENVIRONMENT")} />);
  expect(screen.getByText(/secure browser storage required/i)).toBeInTheDocument();

  rerender(<VaultAccessGate capability={capability("reset_required", "DEVICE_KEY_MISSING")} />);
  expect(screen.getByText(/secure key is no longer available/i)).toBeInTheDocument();
  expect(screen.getByText(/Cloud-synced data remains recoverable/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /reset|delete|erase/i })).not.toBeInTheDocument();
});

test("the gate contains no password field or password copy in any normal state", () => {
  const { rerender } = renderGate({ checking: true });
  [
    capability("setup_required"),
    capability("locked"),
    capability("damaged"),
    capability("unsupported"),
    capability("reset_required"),
  ].forEach((nextCapability) => {
    rerender(<VaultAccessGate capability={nextCapability} refresh={jest.fn()} />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Local Data Password|login password/i);
  });
});

test("the gate performs no storage, network, or event operation", () => {
  const local = jest.spyOn(Storage.prototype, "getItem");
  const session = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  try {
    renderGate({ capability: capability("damaged", "RECORD_CORRUPT", "secret metadata") });
    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("secret metadata");
  } finally {
    local.mockRestore(); session.mockRestore(); dispatch.mockRestore(); fetch.mockRestore();
  }
});
