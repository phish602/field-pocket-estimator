import { AUDIT_EVENT_TYPES, createAuditEvent, createSupportId, normalizeAuditEvent } from "./auditLog";

describe("auditLog utilities", () => {
  test("creates deterministic audit events when id and timestamp are injected", () => {
    const event = createAuditEvent(AUDIT_EVENT_TYPES["invoice.status_changed"], {
      id: "evt-123",
      createdAt: 1710000000000,
      actorId: "user-1",
      actorRole: "admin",
      targetType: "invoice",
      targetId: "inv-9",
      relatedIds: ["proj-1", "proj-1", null],
      source: "support",
      reason: "manual_review",
      beforeHash: "before",
      afterHash: "after",
      metadata: { note: "ok" },
    });

    expect(event).toEqual({
      id: "evt-123",
      type: "invoice.status_changed",
      actorId: "user-1",
      actorRole: "admin",
      targetType: "invoice",
      targetId: "inv-9",
      relatedIds: ["proj-1"],
      source: "support",
      reason: "manual_review",
      beforeHash: "before",
      afterHash: "after",
      createdAt: 1710000000000,
      metadata: { note: "ok" },
    });
  });

  test("normalizes legacy audit event shapes", () => {
    expect(normalizeAuditEvent({
      id: "evt-2",
      type: "health.check_run",
      actorId: "support",
      relatedIds: "bad",
      createdAt: "1710000000000",
    })).toEqual({
      id: "evt-2",
      type: "health.check_run",
      actorId: "support",
      actorRole: "",
      targetType: "",
      targetId: "",
      relatedIds: [],
      source: "",
      reason: "",
      beforeHash: "",
      afterHash: "",
      createdAt: 1710000000000,
      metadata: {},
    });
  });

  test("builds support ids with a prefix", () => {
    const id = createSupportId("SUP", { nowTs: 1710000000000, randomValue: "abc123" });
    expect(id.startsWith("SUP-")).toBe(true);
    expect(id).toContain("abc123");
  });
});

