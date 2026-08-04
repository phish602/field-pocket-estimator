import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import VaultRecoveryGate from "./VaultRecoveryGate";

const review = {
  state: "review",
  pending: false,
  retryable: false,
  counts: { customers: 2, projects: 3, estimates: 4, invoices: 5 },
  confirm: jest.fn(),
  retry: jest.fn(),
};

test("renders the required English review copy with one recovery action", () => {
  render(<VaultRecoveryGate recovery={review} onSignOut={jest.fn()} />);
  expect(screen.getByRole("heading", { name: "Your business data can be recovered" })).toBeInTheDocument();
  expect(screen.getByText("Changes that never finished syncing from this device may not be recoverable.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recover business data" })).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(3);
});

test("switches the contractor-facing copy to Spanish without persistence", () => {
  render(<VaultRecoveryGate recovery={review} onSignOut={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("heading", { name: "Los datos de tu negocio se pueden recuperar" })).toBeInTheDocument();
  expect(screen.getByText("Es posible que no se puedan recuperar los cambios de este dispositivo que nunca terminaron de sincronizarse.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recuperar datos del negocio" })).toBeInTheDocument();
});

test("renders recovering copy in both languages with no enabled action", () => {
  render(<VaultRecoveryGate recovery={{ state: "recovering", pending: true }} onSignOut={jest.fn()} />);
  expect(screen.getByRole("heading", { name: "Recovering your business data" })).toBeInTheDocument();
  expect(screen.getByText(/Keep EstiPaid open\./)).toBeInTheDocument();
  // Recovery is in flight: no sign-out escape hatch and no primary action.
  expect(screen.getAllByRole("button")).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("heading", { name: "Recuperando los datos de tu negocio" })).toBeInTheDocument();
  expect(screen.getByText(/Mantén EstiPaid abierto\./)).toBeInTheDocument();
});

test("renders paused copy in both languages with a retry action", () => {
  const retry = jest.fn();
  render(<VaultRecoveryGate recovery={{ state: "paused", retryable: true, retry }} onSignOut={jest.fn()} />);
  expect(screen.getByRole("heading", { name: "Recovery paused" })).toBeInTheDocument();
  expect(screen.getByText("Your cloud backup was not replaced. Check your connection and try again.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Change language" }));
  expect(screen.getByRole("heading", { name: "Recuperación pausada" })).toBeInTheDocument();
  expect(screen.getByText("Tu copia de seguridad en la nube no fue reemplazada. Revisa tu conexión y vuelve a intentarlo.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toBeInTheDocument();
});

test("uses status and alert semantics without exposing technical recovery terms", () => {
  const { rerender } = render(<VaultRecoveryGate recovery={{ state: "checking" }} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  rerender(<VaultRecoveryGate recovery={{ state: "blocked", retryable: true, retry: jest.fn() }} />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  ["vault", "checkpoint", "Supabase", "IndexedDB", "Web Lock"].forEach((term) => {
    expect(document.body.textContent).not.toContain(term);
  });
});
