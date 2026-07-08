import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  AUDIT_EVENT_RETENTION_MAX_BYTES,
  AUDIT_EVENT_RETENTION_MAX_COUNT,
  AUDIT_STORE_SCHEMA_VERSION,
  appendAuditEvent,
  buildAuditStorePayload,
  createStoredAuditEvent,
  readStoredAuditEvents,
  trimAuditEvents,
  writeStoredAuditEvents,
} from "./auditStore";

describe("auditStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("readStoredAuditEvents returns [] on empty or malformed storage", () => {
    expect(readStoredAuditEvents()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.AUDIT_EVENTS, "{bad json");
    expect(readStoredAuditEvents()).toEqual([]);
  });

  test("appendAuditEvent stores a normalized event", () => {
    const event = createStoredAuditEvent("invoice.created", {
      id: "evt-1",
      createdAt: 1710000000000,
      targetType: "invoice",
      targetId: "inv-1",
      metadata: {
        invoiceId: "inv-1",
        projectId: "proj-1",
      },
    });

    appendAuditEvent(event);

    expect(readStoredAuditEvents()).toEqual([
      expect.objectContaining({
        id: "evt-1",
        type: "invoice.created",
        targetId: "inv-1",
        createdAt: 1710000000000,
        metadata: {
          invoiceId: "inv-1",
          projectId: "proj-1",
        },
      }),
    ]);
  });

  test("appendAuditEvent dedupes by id", () => {
    const event = createStoredAuditEvent("invoice.created", {
      id: "evt-dup",
      createdAt: 1710000000000,
      targetType: "invoice",
      targetId: "inv-1",
    });

    appendAuditEvent(event);
    appendAuditEvent(event);

    expect(readStoredAuditEvents()).toHaveLength(1);
  });

  test("trimAuditEvents enforces max count", () => {
    const events = Array.from({ length: AUDIT_EVENT_RETENTION_MAX_COUNT + 5 }, (_, index) => (
      createStoredAuditEvent("invoice.created", {
        id: `evt-${index}`,
        createdAt: 1710000000000 + index,
        targetType: "invoice",
        targetId: `inv-${index}`,
      })
    ));

    const trimmed = trimAuditEvents(events);

    expect(trimmed).toHaveLength(AUDIT_EVENT_RETENTION_MAX_COUNT);
    expect(trimmed[0].id).toBe("evt-5");
    expect(trimmed[trimmed.length - 1].id).toBe(`evt-${AUDIT_EVENT_RETENTION_MAX_COUNT + 4}`);
  });

  test("trimAuditEvents enforces approximate byte cap", () => {
    const events = Array.from({ length: 8 }, (_, index) => (
      createStoredAuditEvent("invoice.created", {
        id: `evt-byte-${index}`,
        createdAt: 1710000000000 + index,
        targetType: "invoice",
        targetId: `inv-${index}`,
        metadata: {
          invoiceId: `inv-${index}`,
          projectId: `proj-${index}`,
          safeDigest: "x".repeat(40000),
        },
      })
    ));

    const trimmed = trimAuditEvents(events);
    const payloadSize = JSON.stringify(buildAuditStorePayload(trimmed)).length;

    expect(trimmed.length).toBeLessThan(events.length);
    expect(payloadSize).toBeLessThanOrEqual(AUDIT_EVENT_RETENTION_MAX_BYTES);
  });

  test("write/read roundtrip preserves schemaVersion and events", () => {
    const events = [
      createStoredAuditEvent("project.archived", {
        id: "evt-roundtrip",
        createdAt: 1710000000000,
        targetType: "project",
        targetId: "proj-1",
        metadata: {
          projectId: "proj-1",
          previousStatus: "active",
          nextStatus: "archived",
        },
      }),
    ];

    writeStoredAuditEvents(events);

    const storedPayload = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS));
    expect(storedPayload.schemaVersion).toBe(AUDIT_STORE_SCHEMA_VERSION);
    expect(storedPayload.events).toHaveLength(1);
    expect(readStoredAuditEvents()).toEqual([
      expect.objectContaining({
        id: "evt-roundtrip",
        type: "project.archived",
      }),
    ]);
  });

  test("createStoredAuditEvent supports deterministic id and timestamp injection", () => {
    expect(createStoredAuditEvent("diagnostic_bundle.exported", {
      id: "evt-deterministic",
      createdAt: 1710000000000,
      targetType: "diagnostic_bundle",
      targetId: "SUP-1",
      metadata: {
        bundleSchemaVersion: "1.0.0",
        supportId: "SUP-1",
        issueCount: 0,
      },
    })).toEqual(expect.objectContaining({
      id: "evt-deterministic",
      type: "diagnostic_bundle.exported",
      createdAt: 1710000000000,
      metadata: {
        bundleSchemaVersion: "1.0.0",
        supportId: "SUP-1",
        issueCount: 0,
      },
    }));
  });
});
