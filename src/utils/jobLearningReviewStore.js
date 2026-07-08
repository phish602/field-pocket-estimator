// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

const REVIEW_KEY = STORAGE_KEYS.JOB_LEARNING_REVIEWED_CANDIDATES || "estipaid-job-learning-reviewed-candidates-v1";
const VALID_REVIEW_STATES = Object.freeze({
  approved: true,
  rejected: true,
  needs_changes: true,
});

const EMPTY_ARRAY = Object.freeze([]);

function getStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clonePlain(value) {
  if (!isPlainObject(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function safeString(value) {
  return String(value ?? "").trim();
}

function normalizeSnapshot(value) {
  const cloned = clonePlain(value);
  if (!cloned) return {};
  const next = { ...cloned };
  delete next.approvedForRuntime;
  delete next.reusable;
  delete next.reviewedBy;
  delete next.reviewedAt;
  delete next.timestamp;
  delete next.createdAt;
  delete next.updatedAt;
  return next;
}

function normalizeStoredList(value) {
  const list = Array.isArray(value) ? value : [];
  const next = [];
  for (let i = 0; i < list.length; i += 1) {
    const normalized = normalizeReviewedCandidateRecord(list[i]);
    if (normalized) next.push(normalized);
  }
  next.sort((a, b) => a.candidateFingerprint.localeCompare(b.candidateFingerprint));
  return next;
}

function dedupeByFingerprint(list) {
  const map = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!entry || typeof entry.candidateFingerprint !== "string") continue;
    map.set(entry.candidateFingerprint, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.candidateFingerprint.localeCompare(b.candidateFingerprint));
}

export function normalizeReviewedCandidateRecord(record) {
  if (!isPlainObject(record)) return null;
  if (record.approvedForRuntime === true) return null;
  if (record.reusable === true) return null;

  const candidateFingerprint = safeString(record.candidateFingerprint || record.fingerprint);
  const assistTraceId = safeString(record.assistTraceId);
  const reviewState = safeString(record.reviewState);
  if (!candidateFingerprint || !assistTraceId) return null;
  if (!VALID_REVIEW_STATES[reviewState]) return null;

  return Object.freeze({
    schemaVersion: 1,
    candidateFingerprint,
    assistTraceId,
    reviewState,
    candidateDraftSnapshot: Object.freeze(normalizeSnapshot(record.candidateDraftSnapshot || record.candidateDraft || record.snapshot)),
    sourceEvidence: Object.freeze(normalizeSnapshot(record.sourceEvidence || record.evidence)),
    reviewNotes: safeString(record.reviewNotes),
  });
}

export function readReviewedJobLearningCandidates() {
  try {
    const storage = getStorage();
    if (!storage) return EMPTY_ARRAY;
    const raw = storage.getItem(REVIEW_KEY);
    if (!raw) return EMPTY_ARRAY;
    const parsed = JSON.parse(raw);
    return normalizeStoredList(parsed);
  } catch {
    return EMPTY_ARRAY;
  }
}

export function writeReviewedJobLearningCandidates(next) {
  try {
    const normalized = dedupeByFingerprint(normalizeStoredList(Array.isArray(next) ? next : EMPTY_ARRAY));
    const storage = getStorage();
    if (!storage) return normalized;
    storage.setItem(REVIEW_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return readReviewedJobLearningCandidates();
  }
}

export function upsertReviewedJobLearningCandidate(record) {
  try {
    const normalized = normalizeReviewedCandidateRecord(record);
    if (!normalized) return readReviewedJobLearningCandidates();
    const current = readReviewedJobLearningCandidates().filter(
      (entry) => entry.candidateFingerprint !== normalized.candidateFingerprint
    );
    return writeReviewedJobLearningCandidates([...current, normalized]);
  } catch {
    return readReviewedJobLearningCandidates();
  }
}

export function deleteReviewedJobLearningCandidate(fingerprintOrTraceId) {
  try {
    const key = safeString(fingerprintOrTraceId);
    if (!key) return readReviewedJobLearningCandidates();
    const next = readReviewedJobLearningCandidates().filter(
      (entry) => entry.candidateFingerprint !== key && entry.assistTraceId !== key
    );
    return writeReviewedJobLearningCandidates(next);
  } catch {
    return readReviewedJobLearningCandidates();
  }
}
