import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";

describe("AdvancedSettingsScreen diagnostics export", () => {
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let appendChildSpy;
  let clickSpy;
  let setItemSpy;
  let capturedBlob = null;

  function readBlobText(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read blob"));
      reader.readAsText(blob);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        id: "company_1",
        companyName: "Field Pocket",
        email: "support@fieldpocket.example",
        phone: "555-123-4567",
        address: "123 Main St",
        notes: "Internal support note",
      }),
    );
    localStorage.setItem(
      STORAGE_KEYS.CUSTOMERS,
      JSON.stringify([
        {
          id: "cust_1",
          name: "Acme Co",
          email: "customer@example.com",
          phone: "555-000-0000",
          address: "10 Market St",
        },
      ]),
    );
    localStorage.setItem(
      STORAGE_KEYS.PROJECTS,
      JSON.stringify([{ id: "proj_1", customerId: "cust_1", name: "Roof Repair" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.ESTIMATES,
      JSON.stringify([{ id: "est_1", projectId: "proj_1", status: "approved" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.INVOICES,
      JSON.stringify([{ id: "inv_1", projectId: "proj_1", invoiceTotal: 100, amountPaid: 25, balanceRemaining: 75 }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.SCOPE_TEMPLATES,
      JSON.stringify([{ id: "tmpl_1", name: "Support scope", scopeNotes: "Hidden notes" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.AUDIT_EVENTS,
      JSON.stringify({
        schemaVersion: "1.0.0",
        updatedAt: 1710000000000,
        events: [
          {
            id: "evt_existing",
            type: "invoice.created",
            targetType: "invoice",
            targetId: "inv_1",
            createdAt: 1710000000000,
            metadata: {
              invoiceId: "inv_1",
              projectId: "proj_1",
            },
          },
        ],
      }),
    );

    capturedBlob = null;
    jest.useFakeTimers();

    if (typeof URL.createObjectURL !== "function") {
      URL.createObjectURL = jest.fn();
    }
    if (typeof URL.revokeObjectURL !== "function") {
      URL.revokeObjectURL = jest.fn();
    }

    createObjectURLSpy = jest.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob;
      return "blob:diagnostics";
    });
    revokeObjectURLSpy = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    appendChildSpy = jest.spyOn(document.body, "appendChild");
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setItemSpy = jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
    localStorage.clear();
    capturedBlob = null;
    createObjectURLSpy = null;
    revokeObjectURLSpy = null;
    appendChildSpy = null;
    clickSpy = null;
    setItemSpy = null;
  });

  test("exports a redacted support bundle with read-only data", async () => {
    render(<AdvancedSettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /export diagnostics json/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics JSON exported.");
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob).toBeTruthy();

    const appendedAnchor = appendChildSpy.mock.calls
      .map(([node]) => node)
      .find((node) => node?.tagName === "A");
    expect(appendedAnchor).toBeTruthy();
    expect(appendedAnchor.download).toMatch(/^estipaid-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);

    const payload = JSON.parse(await readBlobText(capturedBlob));
    expect(payload.bundleMeta.routeContext).toBe("advanced_settings");
    expect(payload.recordInventory.customers.count).toBe(1);
    expect(payload.recordInventory.projects.count).toBe(1);
    expect(payload.recordInventory.estimates.count).toBe(1);
    expect(payload.recordInventory.invoices.count).toBe(1);
    expect(payload.recordInventory.auditEvents.count).toBe(1);
    expect(payload.sourceSnapshots.companyProfile.email).toBe("[redacted]");
    expect(payload.sourceSnapshots.companyProfile.notes).toBe("[redacted]");
    expect(payload.sourceSnapshots.customers[0].address).toBe("[redacted]");
    expect(payload.sourceSnapshots.scopeTemplates[0].scopeNotes).toBe("[redacted]");
    expect(payload.sourceSnapshots.invoices[0].invoiceTotal).toBe(100);
    expect(payload.sourceSnapshots.auditEvents).toEqual([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
    ]);
    expect(payload.recentEvents).toEqual([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
    ]);

    const storedAuditEvents = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS) || "{}");
    expect(storedAuditEvents.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
      expect.objectContaining({
        type: "diagnostic_bundle.exported",
        targetType: "diagnostic_bundle",
        source: "advanced_settings",
        reason: "manual_export",
      }),
    ]));
    expect(setItemSpy).toHaveBeenCalledWith(
      STORAGE_KEYS.AUDIT_EVENTS,
      expect.stringContaining("\"diagnostic_bundle.exported\""),
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:diagnostics");
  });
});
