import React from "react";
import { render, screen } from "@testing-library/react";
import VaultCompatibilityGate from "./VaultCompatibilityGate";

test.each([
  ["checking", "Checking secure local data"],
  ["transition-blocked", "Secure transition in progress"],
  ["other-workspace-transition", "Another workspace transition is pending"],
  ["authoritative-blocked", "Secure vault state detected"],
  ["corrupt-blocked", "Secure local data could not be verified"],
  ["storage-blocked", "Secure local storage unavailable"],
])("compatibility gate safely renders %s", (state, heading) => {
  render(<VaultCompatibilityGate state={state} />);
  expect(screen.getByText(heading)).toBeInTheDocument();
  expect(screen.getByLabelText("Local data compatibility access")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
