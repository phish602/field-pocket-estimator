// Integration coverage proving that real, exported low-level storage-write
// helpers -- the stable choke points every screen ultimately calls through
// -- correctly mark the automatic cloud backup queue dirty. This is
// deliberately not UI-rendering-based: these writer functions are the
// stable integration point, and every screen (Projects, Invoices,
// Templates, Settings, and the estimate/invoice-conversion paths that also
// funnel through writeStoredInvoices) is proven covered by testing them
// directly rather than re-testing each screen's UI.

import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { writeStoredProjects } from "../utils/projects";
import { writeStoredInvoices } from "../utils/invoices";
import { writeStoredScopeTemplates } from "../utils/scopeTemplates";
import { saveSettings, DEFAULT_SETTINGS } from "../utils/settings";

beforeEach(() => {
  localStorage.clear();
});

describe("project mutations mark cloud backup dirty", () => {
  test("writeStoredProjects (create/update/status-change/delete choke point) marks dirty", () => {
    expect(readCloudBackupQueueState().pending).toBe(false);

    writeStoredProjects([
      { id: "proj_1", projectName: "Roof Repair", status: "active", updatedAt: Date.now() },
    ]);

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toContain("projects");
    expect(state.reasons).toContain("project_data_saved");
  });
});

describe("invoice and invoice-payment mutations mark cloud backup dirty", () => {
  test("writeStoredInvoices (create/update/status-change/delete/payment choke point) marks dirty at money_critical severity", () => {
    expect(readCloudBackupQueueState().pending).toBe(false);

    writeStoredInvoices([
      {
        id: "inv_1",
        invoiceNumber: "INV-1001",
        status: "sent",
        invoiceTotal: 500,
        amountPaid: 0,
        balanceRemaining: 500,
        payments: [],
      },
    ]);

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toEqual(expect.arrayContaining(["invoices", "invoice_payments"]));
    expect(state.severity).toBe("money_critical");
  });

  test("recording a manual payment (which re-writes the invoice array) also marks dirty", () => {
    writeStoredInvoices([
      { id: "inv_2", invoiceNumber: "INV-1002", status: "sent", invoiceTotal: 500, amountPaid: 0, balanceRemaining: 500, payments: [] },
    ]);
    localStorage.clear();
    expect(readCloudBackupQueueState().pending).toBe(false);

    // Simulates what addManualInvoicePayment + persistInvoices do: re-save
    // the invoice array with a new payment appended.
    writeStoredInvoices([
      {
        id: "inv_2",
        invoiceNumber: "INV-1002",
        status: "sent",
        invoiceTotal: 500,
        amountPaid: 200,
        balanceRemaining: 300,
        payments: [{ id: "pay_1", amount: 200, method: "cash" }],
      },
    ]);

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toContain("invoice_payments");
  });
});

describe("template mutations mark cloud backup dirty", () => {
  test("writeStoredScopeTemplates (save/rename/delete choke point) marks dirty", () => {
    expect(readCloudBackupQueueState().pending).toBe(false);

    writeStoredScopeTemplates([
      { id: "tpl_1", name: "Bathroom Remodel", scopeNotes: "Standard bathroom scope." },
    ]);

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toContain("templates");
  });
});

describe("settings mutations mark cloud backup dirty", () => {
  test("saveSettings marks dirty only when the write actually succeeds", () => {
    expect(readCloudBackupQueueState().pending).toBe(false);

    const ok = saveSettings({ ...DEFAULT_SETTINGS, pricing: { ...DEFAULT_SETTINGS.pricing, defaultMarkupPct: 15 } });

    expect(ok).toBe(true);
    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toContain("app_settings");
  });

  test("saveSettings does not mark dirty when localStorage.setItem fails", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    const ok = saveSettings(DEFAULT_SETTINGS);

    expect(ok).toBe(false);
    setItemSpy.mockRestore();
    expect(readCloudBackupQueueState().pending).toBe(false);
  });
});

describe("multiple domains accumulate into one merged pending queue", () => {
  test("saving a project then an invoice keeps both domains and raises severity to money_critical", () => {
    writeStoredProjects([{ id: "proj_2", projectName: "Kitchen", status: "active", updatedAt: Date.now() }]);
    writeStoredInvoices([{ id: "inv_3", invoiceNumber: "INV-1003", status: "draft", invoiceTotal: 0, amountPaid: 0, balanceRemaining: 0, payments: [] }]);

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.domains).toEqual(expect.arrayContaining(["projects", "invoices"]));
    expect(state.severity).toBe("money_critical");
  });
});
