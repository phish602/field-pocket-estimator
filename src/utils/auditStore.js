// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { createAuditEvent, normalizeAuditEvent } from "./auditLog";

export const AUDIT_STORE_SCHEMA_VERSION = "1.0.0";
export const AUDIT_EVENT_RETENTION_MAX_COUNT = 250;
export const AUDIT_EVENT_RETENTION_MAX_BYTES = 256 * 1024;

function canUseStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isValidAuditEvent(event) {
  return !!String(event?.id || "").trim()
    && !!String(event?.type || "").trim()
    && Number.isFinite(Number(event?.createdAt))
    && Number(event.createdAt) > 0;
}

function normalizeAuditEvents(events = []) {
  const normalized = asArray(events)
    .map((event, index) => ({
      event: normalizeAuditEvent(event),
      index,
    }))
    .filter(({ event }) => isValidAuditEvent(event))
    .sort((a, b) => {
      const timeDelta = Number(a.event.createdAt || 0) - Number(b.event.createdAt || 0);
      if (timeDelta !== 0) return timeDelta;
      return a.index - b.index;
    });

  const seen = new Set();
  return normalized.reduce((accumulator, entry) => {
    if (seen.has(entry.event.id)) return accumulator;
    seen.add(entry.event.id);
    accumulator.push(entry.event);
    return accumulator;
  }, []);
}

function serializePayload(events = [], updatedAt = Date.now()) {
  return JSON.stringify({
    schemaVersion: AUDIT_STORE_SCHEMA_VERSION,
    events,
    updatedAt,
  });
}

export function trimAuditEvents(events = []) {
  let trimmed = normalizeAuditEvents(events);

  if (trimmed.length > AUDIT_EVENT_RETENTION_MAX_COUNT) {
    trimmed = trimmed.slice(trimmed.length - AUDIT_EVENT_RETENTION_MAX_COUNT);
  }

  while (trimmed.length > 0) {
    const serialized = serializePayload(trimmed);
    if (serialized.length <= AUDIT_EVENT_RETENTION_MAX_BYTES) break;
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

export function buildAuditStorePayload(events = []) {
  const trimmed = trimAuditEvents(events);
  return {
    schemaVersion: AUDIT_STORE_SCHEMA_VERSION,
    events: trimmed,
    updatedAt: Date.now(),
  };
}

export function readStoredAuditEvents() {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return trimAuditEvents(parsed);
    }
    return trimAuditEvents(parsed?.events);
  } catch {
    return [];
  }
}

export function writeStoredAuditEvents(events) {
  const payload = buildAuditStorePayload(events);
  if (!canUseStorage()) return payload.events;
  try {
    localStorage.setItem(STORAGE_KEYS.AUDIT_EVENTS, JSON.stringify(payload));
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: {
          key: STORAGE_KEYS.AUDIT_EVENTS,
          value: JSON.stringify(payload),
        },
      }));
    } catch {}
  } catch {}
  return payload.events;
}

export function appendAuditEvent(event) {
  return appendAuditEvents([event]);
}

export function appendAuditEvents(events) {
  const nextEvents = [...readStoredAuditEvents(), ...asArray(events)];
  return writeStoredAuditEvents(nextEvents);
}

export function createStoredAuditEvent(type, options = {}) {
  const event = normalizeAuditEvent(createAuditEvent(type, options));
  return isValidAuditEvent(event) ? event : null;
}
