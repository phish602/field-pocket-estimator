// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "./storageKeys";

const JOB_LEARNING_EVENTS_KEY = STORAGE_KEYS.JOB_LEARNING_EVENTS;
const MAX_JOB_LEARNING_EVENTS = 250;

function getStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function clonePlainEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    return null;
  }
}

function normalizeEventList(value) {
  const list = Array.isArray(value) ? value : [];
  const next = [];
  for (const item of list) {
    const cloned = clonePlainEvent(item);
    if (!cloned) continue;
    next.push(cloned);
  }
  return next.slice(-MAX_JOB_LEARNING_EVENTS);
}

export function readJobLearningEvents() {
  try {
    const storage = getStorage();
    if (!storage) return [];
    const raw = storage.getItem(JOB_LEARNING_EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeEventList(parsed);
  } catch {
    return [];
  }
}

export function appendJobLearningEvent(event) {
  try {
    const nextEvent = clonePlainEvent(event);
    if (!nextEvent) return readJobLearningEvents();
    const current = readJobLearningEvents();
    const next = [...current, nextEvent].slice(-MAX_JOB_LEARNING_EVENTS);
    const storage = getStorage();
    if (!storage) return next;
    storage.setItem(JOB_LEARNING_EVENTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return readJobLearningEvents();
  }
}

export function clearJobLearningEvents() {
  try {
    const storage = getStorage();
    if (!storage) return [];
    storage.removeItem(JOB_LEARNING_EVENTS_KEY);
    return [];
  } catch {
    return [];
  }
}
