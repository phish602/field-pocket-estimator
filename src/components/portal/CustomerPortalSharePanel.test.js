import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import CustomerPortalSharePanel, { CustomerPortalDeliveryStatus } from "./CustomerPortalSharePanel";

describe("CustomerPortalSharePanel", () => {
  test("renders estimate portal copy with staged actions and no side effects", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const fetchSpy = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy;

    render(<CustomerPortalSharePanel documentType="estimate" defaultExpanded />);

    expect(screen.getByText("Send to Customer")).toBeInTheDocument();
    expect(screen.getByText("Share a secure estimate link for approval or requested changes.")).toBeInTheDocument();
    expect(screen.getByText("Approve Estimate")).toBeInTheDocument();
    expect(screen.getByText("Request Changes")).toBeInTheDocument();
    expect(screen.getByText("Expires in 7 days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy secure link/i })).toBeDisabled();
    expect(screen.getByLabelText("Allow customer comments")).toBeDisabled();
    expect(screen.getByText("Secure customer links will be enabled after the portal backend is connected.")).toBeInTheDocument();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    global.fetch = originalFetch;
    setItemSpy.mockRestore();
  });

  test("renders invoice acknowledgment copy and never claims invoice approval", () => {
    render(<CustomerPortalSharePanel documentType="invoice" defaultExpanded />);

    expect(screen.getByText("Share a secure invoice link for customer acknowledgment.")).toBeInTheDocument();
    expect(screen.getByText("Acknowledge Invoice")).toBeInTheDocument();
    expect(screen.queryByText("Approve Invoice")).not.toBeInTheDocument();
  });

  test("opens from the Send to Customer button", () => {
    render(<CustomerPortalSharePanel documentType="estimate" />);

    const toggle = screen.getByRole("button", { name: /send to customer/i });
    expect(screen.queryByText("Approve Estimate")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByText("Approve Estimate")).toBeInTheDocument();
  });
});

describe("CustomerPortalDeliveryStatus", () => {
  test("truthfully exposes future secure delivery without an enabled send action", () => {
    render(<CustomerPortalDeliveryStatus documentType="estimate" />);

    expect(screen.getByText("Send to Customer")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText(/portal backend is connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send to customer/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-customer-delivery="coming-soon"]')).toHaveAttribute("data-document-type", "estimate");
  });

  test("uses localized Spanish delivery status for Invoice", () => {
    render(<CustomerPortalDeliveryStatus documentType="invoice" lang="es" />);

    expect(screen.getByText("Enviar al cliente")).toBeInTheDocument();
    expect(screen.getByText("Próximamente")).toBeInTheDocument();
    expect(document.querySelector('[data-customer-delivery="coming-soon"]')).toHaveAttribute("data-document-type", "invoice");
  });
});
