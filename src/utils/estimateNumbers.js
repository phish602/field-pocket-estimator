// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const ESTIMATE_PREFIX = "EST-";

function asText(value) {
  return String(value || "").trim();
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => clone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = clone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function readSnapshotValue(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (typeof snapshot.getItem === "function") {
    const value = snapshot.getItem(key);
    return value === undefined ? null : value;
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return null;
  const value = snapshot[key];
  return value === undefined ? null : value;
}

function readStoredEstimateEntries(snapshot) {
  try {
    const raw = readSnapshotValue(snapshot, ESTIMATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function extractEstimateNumber(record) {
  return asText(
    record?.estimateNumber
    || record?.docNumber
    || record?.documentNumber
    || record?.documentNo
    || record?.number
    || record?.job?.docNumber
  );
}

function estimateNumberKey(value) {
  return asText(value).toUpperCase();
}

function collectTakenEstimateNumbers(records) {
  const taken = new Set();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const number = extractEstimateNumber(record);
    if (number) taken.add(estimateNumberKey(number));
  });
  return taken;
}

function readHighestEstimateSequence(records) {
  let max = 0;
  (Array.isArray(records) ? records : []).forEach((record) => {
    const raw = extractEstimateNumber(record);
    if (!raw) return;
    const match = raw.match(/(\d+)(?!.*\d)/);
    if (!match) return;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > max) max = parsed;
  });
  return max;
}

export function generateNextEstimateNumber(estimates) {
  const records = Array.isArray(estimates) ? estimates.filter(Boolean) : [];
  const taken = collectTakenEstimateNumbers(records);
  let nextSequence = readHighestEstimateSequence(records);

  while (true) {
    nextSequence += 1;
    const candidate = `${ESTIMATE_PREFIX}${String(nextSequence).padStart(4, "0")}`;
    if (!taken.has(estimateNumberKey(candidate))) {
      return candidate;
    }
  }
}

export function repairMissingEstimateNumbers(records) {
  const sourceRecords = Array.isArray(records) ? records.filter(Boolean) : [];
  const taken = collectTakenEstimateNumbers(sourceRecords);
  let nextSequence = readHighestEstimateSequence(sourceRecords);
  const repairs = [];
  let changed = false;

  const nextRecords = sourceRecords.map((record, index) => {
    const currentNumber = extractEstimateNumber(record);
    if (currentNumber) return record;

    let repairedNumber = "";
    while (!repairedNumber) {
      nextSequence += 1;
      const candidate = `${ESTIMATE_PREFIX}${String(nextSequence).padStart(4, "0")}`;
      if (taken.has(estimateNumberKey(candidate))) continue;
      repairedNumber = candidate;
      taken.add(estimateNumberKey(candidate));
    }

    changed = true;
    const nextRecord = clone(record || {});
    nextRecord.estimateNumber = repairedNumber;
    nextRecord.job = {
      ...(nextRecord?.job || {}),
      docNumber: repairedNumber,
    };
    repairs.push({
      legacyLocalId: asText(nextRecord?.id) || `estimate_${index + 1}`,
      estimateNumber: repairedNumber,
    });
    return nextRecord;
  });

  return {
    estimates: nextRecords,
    repairs,
    changed,
  };
}

export function repairStoredEstimateNumbers(storageSnapshot) {
  const storedEntries = readStoredEstimateEntries(storageSnapshot);
  const estimateRecords = storedEntries.filter(
    (entry) => asText(entry?.docType || "estimate").toLowerCase() !== "invoice"
  );
  const legacyInvoiceRecords = storedEntries.filter(
    (entry) => asText(entry?.docType).toLowerCase() === "invoice"
  );
  const repaired = repairMissingEstimateNumbers(estimateRecords);

  if (
    repaired.changed
    && storageSnapshot
    && typeof storageSnapshot.setItem === "function"
  ) {
    storageSnapshot.setItem(
      ESTIMATES_KEY,
      JSON.stringify([...(Array.isArray(repaired.estimates) ? repaired.estimates : []), ...legacyInvoiceRecords])
    );
    try {
      window.dispatchEvent(new Event("estipaid:estimates-changed"));
    } catch {}
  }

  return repaired;
}
