// @ts-nocheck
/* eslint-disable */

const AUDIT_EVENT_TYPE_LIST = [
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "project.created",
  "project.updated",
  "project.archived",
  "project.restored",
  "estimate.created",
  "estimate.updated",
  "estimate.approved",
  "estimate.converted_to_invoice",
  "invoice.created",
  "invoice.updated",
  "invoice.status_changed",
  "invoice.payment_added",
  "invoice.payment_synced",
  "invoice.voided",
  "link.broken_detected",
  "link.repaired",
  "orphan.detected",
  "health.check_run",
  "diagnostic_bundle.exported",
  "repair.previewed",
  "repair.applied",
  "migration.backfilled",
];

export const AUDIT_EVENT_TYPES = Object.freeze(
  AUDIT_EVENT_TYPE_LIST.reduce((acc, type) => {
    acc[type] = type;
    return acc;
  }, {})
);

function asText(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toTimestamp(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toStableHash(input = "") {
  let hash = 2166136261;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeRelatedIds(value) {
  return [...new Set(
    asArray(value)
      .map((entry) => asText(entry))
      .filter(Boolean)
  )];
}

export function createSupportId(prefix = "SUP", options = {}) {
  const cleanPrefix = asText(prefix, "SUP").replace(/\s+/g, "-") || "SUP";
  const nowTs = toTimestamp(options?.nowTs, Date.now());
  const timePart = Math.max(0, nowTs).toString(36);
  if (options?.id) return asText(options.id);
  if (options?.randomValue !== undefined && options?.randomValue !== null) {
    const randomPart = String(options.randomValue).replace(/[^a-z0-9]/gi, "").toLowerCase() || "0";
    return `${cleanPrefix}-${timePart}-${randomPart}`;
  }
  const entropy = options?.seed !== undefined && options?.seed !== null
    ? toStableHash(`${cleanPrefix}:${timePart}:${String(options.seed)}`)
    : Math.random().toString(36).slice(2, 8);
  return `${cleanPrefix}-${timePart}-${entropy}`;
}

export function createAuditEvent(type, options = {}) {
  const normalizedType = asText(type);
  const nowTs = toTimestamp(options?.createdAt ?? options?.nowTs, Date.now());
  const eventId = asText(options?.id) || createSupportId(options?.idPrefix || "AUD", {
    nowTs,
    randomValue: options?.randomValue,
    seed: `${normalizedType}:${options?.targetType || ""}:${options?.targetId || ""}`,
  });

  return normalizeAuditEvent({
    id: eventId,
    type: normalizedType,
    actorId: asText(options?.actorId),
    actorRole: asText(options?.actorRole),
    targetType: asText(options?.targetType),
    targetId: asText(options?.targetId),
    relatedIds: normalizeRelatedIds(options?.relatedIds),
    source: asText(options?.source),
    reason: asText(options?.reason),
    beforeHash: asText(options?.beforeHash),
    afterHash: asText(options?.afterHash),
    createdAt: nowTs,
    metadata: asObject(options?.metadata),
  });
}

export function normalizeAuditEvent(event) {
  const source = event && typeof event === "object" ? event : {};
  const createdAt = toTimestamp(source?.createdAt ?? source?.ts ?? source?.timestamp, 0);
  return {
    id: asText(source?.id),
    type: asText(source?.type),
    actorId: asText(source?.actorId || source?.userId),
    actorRole: asText(source?.actorRole || source?.role),
    targetType: asText(source?.targetType),
    targetId: asText(source?.targetId),
    relatedIds: normalizeRelatedIds(source?.relatedIds),
    source: asText(source?.source),
    reason: asText(source?.reason),
    beforeHash: asText(source?.beforeHash),
    afterHash: asText(source?.afterHash),
    createdAt,
    metadata: asObject(source?.metadata),
  };
}

