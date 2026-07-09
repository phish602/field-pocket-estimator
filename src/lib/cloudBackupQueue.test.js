import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  markCloudBackupDirty,
  readCloudBackupQueueState,
  clearCloudBackupDirty,
  buildBackupDirtyEvent,
  recordCloudBackupAttemptFailure,
  pauseCloudAutoBackup,
  readCloudAutoBackupPauseState,
  isCloudAutoBackupPaused,
  CLOUD_BACKUP_SEVERITY,
  CLOUD_BACKUP_PRIORITY,
  CLOUD_BACKUP_STATUS,
} from "./cloudBackupQueue";

beforeEach(() => {
  localStorage.clear();
});

describe("buildBackupDirtyEvent", () => {
  test("normalizes a raw input into a well-shaped event with defaults", () => {
    const event = buildBackupDirtyEvent({ reason: "project_saved", domains: ["projects"] });

    expect(event).toEqual(
      expect.objectContaining({
        reason: "project_saved",
        domains: ["projects"],
        severity: CLOUD_BACKUP_SEVERITY.NORMAL,
        priority: CLOUD_BACKUP_PRIORITY.NORMAL,
      })
    );
    expect(event.createdAt).toEqual(expect.any(Number));
  });

  test("defaults money-critical events to immediate priority", () => {
    const event = buildBackupDirtyEvent({ reason: "invoice_saved", severity: "money_critical" });
    expect(event.priority).toBe(CLOUD_BACKUP_PRIORITY.IMMEDIATE);
  });

  test("falls back to a safe reason when none is provided", () => {
    const event = buildBackupDirtyEvent({});
    expect(event.reason).toBe("unspecified_mutation");
    expect(event.domains).toEqual([]);
  });
});

describe("markCloudBackupDirty", () => {
  test("creates persistent pending queue state", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.PENDING);
    expect(state.reasons).toContain("project_saved");
    expect(state.domains).toContain("projects");
    expect(state.createdAt).toEqual(expect.any(Number));
    expect(state.updatedAt).toEqual(expect.any(Number));
  });

  test("state survives a fresh read-after-write (persisted to localStorage)", () => {
    markCloudBackupDirty({ reason: "customer_saved", domains: ["customers"] });

    const raw = localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    expect(raw).toEqual(expect.any(String));

    const reReadState = readCloudBackupQueueState();
    expect(reReadState.pending).toBe(true);
    expect(reReadState.domains).toContain("customers");
  });

  test("multiple events merge reasons and domains instead of overwriting", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
    markCloudBackupDirty({ reason: "customer_saved", domains: ["customers"] });
    markCloudBackupDirty({ reason: "estimate_saved", domains: ["estimates"] });

    const state = readCloudBackupQueueState();
    expect(state.reasons).toEqual(["project_saved", "customer_saved", "estimate_saved"]);
    expect(state.domains).toEqual(["projects", "customers", "estimates"]);
  });

  test("does not duplicate the same reason or domain across repeated events", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });

    const state = readCloudBackupQueueState();
    expect(state.reasons).toEqual(["project_saved"]);
    expect(state.domains).toEqual(["projects"]);
  });

  test("highest severity wins across merged events", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "low" });
    markCloudBackupDirty({ reason: "invoice_saved", domains: ["invoices"], severity: "money_critical" });
    markCloudBackupDirty({ reason: "template_saved", domains: ["templates"], severity: "normal" });

    const state = readCloudBackupQueueState();
    expect(state.severity).toBe(CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL);
  });

  test("highest severity wins regardless of event order (low arriving after money_critical)", () => {
    markCloudBackupDirty({ reason: "invoice_saved", domains: ["invoices"], severity: "money_critical" });
    markCloudBackupDirty({ reason: "search_noop", domains: ["projects"], severity: "low" });

    const state = readCloudBackupQueueState();
    expect(state.severity).toBe(CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL);
  });

  test("money-critical events raise priority to immediate", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "low" });
    markCloudBackupDirty({ reason: "invoice_saved", domains: ["invoices"], severity: "money_critical" });

    const state = readCloudBackupQueueState();
    expect(state.priority).toBe(CLOUD_BACKUP_PRIORITY.IMMEDIATE);
  });

  test("preserves createdAt across multiple pending events but always advances updatedAt", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
    const first = readCloudBackupQueueState();

    markCloudBackupDirty({ reason: "customer_saved", domains: ["customers"] });
    const second = readCloudBackupQueueState();

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  test("does not store any raw user document payload in queue metadata", () => {
    markCloudBackupDirty({
      reason: "estimate_saved",
      domains: ["estimates"],
      documentId: "est_123",
      source: "estimate_form",
    });

    const raw = localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    const parsed = JSON.parse(raw);

    // Only small metadata fields should ever be present -- no nested
    // objects, arrays of records, customer/estimate/invoice field names,
    // or anything resembling a full saved document.
    const allowedKeys = new Set([
      "schemaVersion", "pending", "status", "reasons", "domains", "severity",
      "priority", "createdAt", "updatedAt", "attempts", "lastAttemptAt",
      "lastError", "lastSuccessfulBackupAt", "source", "documentId", "localFingerprint",
    ]);
    Object.keys(parsed).forEach((key) => expect(allowedKeys.has(key)).toBe(true));
    expect(typeof parsed.documentId).toBe("string");
    expect(typeof parsed.source).toBe("string");
  });

  test("localStorage failure does not throw into the caller", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(() => {
      markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
    }).not.toThrow();

    setItemSpy.mockRestore();
  });

  test("a fresh local change clears a takeover auto-backup pause", () => {
    pauseCloudAutoBackup("device_takeover");

    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });

    expect(isCloudAutoBackupPaused()).toBe(false);
    expect(readCloudAutoBackupPauseState()).toEqual({
      paused: false,
      reason: "",
      pausedAt: null,
    });
  });

  test("is safe to call repeatedly when localStorage is entirely unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage disabled");
      },
    });

    expect(() => {
      markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
      readCloudBackupQueueState();
      clearCloudBackupDirty("noop");
    }).not.toThrow();

    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    }
  });
});

describe("readCloudBackupQueueState", () => {
  test("returns a fully-shaped default state when nothing has been written yet", () => {
    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(false);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.CURRENT);
    expect(state.reasons).toEqual([]);
    expect(state.domains).toEqual([]);
  });

  test("recovers safely from corrupted queue JSON", () => {
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, "{not valid json");
    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(false);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.CURRENT);
  });
});

describe("clearCloudBackupDirty", () => {
  test("clears pending state safely and records a successful backup timestamp", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "money_critical" });
    expect(readCloudBackupQueueState().pending).toBe(true);

    clearCloudBackupDirty("manual_backup_success");

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(false);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.CURRENT);
    expect(state.reasons).toEqual([]);
    expect(state.domains).toEqual([]);
    expect(state.severity).toBe(CLOUD_BACKUP_SEVERITY.LOW);
    expect(state.lastSuccessfulBackupAt).toEqual(expect.any(Number));
  });

  test("is a safe no-op when the queue is already current", () => {
    expect(readCloudBackupQueueState().pending).toBe(false);
    expect(() => clearCloudBackupDirty("cloud_restore_success")).not.toThrow();
    expect(readCloudBackupQueueState().pending).toBe(false);
  });

  test("localStorage failure does not throw into the caller", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    expect(() => clearCloudBackupDirty("manual_backup_success")).not.toThrow();

    setItemSpy.mockRestore();
  });

  test("successful backup clears any takeover auto-backup pause", () => {
    pauseCloudAutoBackup("device_takeover");
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });

    pauseCloudAutoBackup("device_takeover");
    clearCloudBackupDirty("manual_backup_success");

    expect(isCloudAutoBackupPaused()).toBe(false);
  });
});

describe("pauseCloudAutoBackup", () => {
  test("persists a takeover pause with reason metadata", () => {
    pauseCloudAutoBackup("device_takeover");

    expect(isCloudAutoBackupPaused()).toBe(true);
    expect(readCloudAutoBackupPauseState()).toEqual(expect.objectContaining({
      paused: true,
      reason: "device_takeover",
      pausedAt: expect.any(Number),
    }));
  });
});

describe("recordCloudBackupAttemptFailure", () => {
  test("increments attempts and records the last error without clearing pending", () => {
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"] });

    recordCloudBackupAttemptFailure("Network unreachable");

    const state = readCloudBackupQueueState();
    expect(state.pending).toBe(true);
    expect(state.status).toBe(CLOUD_BACKUP_STATUS.FAILED);
    expect(state.attempts).toBe(1);
    expect(state.lastError).toBe("Network unreachable");
    expect(state.lastAttemptAt).toEqual(expect.any(Number));
  });
});
