// @ts-nocheck
/* eslint-disable */

import {
  buildJobLearningSnapshotFromStore,
  summarizeJobLearningSnapshot,
} from "./jobLearningSnapshot";
import {
  clearJobLearningEvents,
  readJobLearningEvents,
} from "./jobLearningStore";

const DEV_CONSOLE_KEY = "__ESTIPAID_JOB_LEARNING__";

function isDevelopment() {
  return process.env.NODE_ENV === "development";
}

export function installDevJobLearningConsole() {
  if (!isDevelopment()) return null;
  if (typeof window === "undefined") return null;

  const api = Object.freeze({
    snapshot() {
      return buildJobLearningSnapshotFromStore();
    },
    summary() {
      return summarizeJobLearningSnapshot(buildJobLearningSnapshotFromStore());
    },
    events() {
      return readJobLearningEvents();
    },
    clearEvents() {
      if (!isDevelopment()) return [];
      clearJobLearningEvents();
      return readJobLearningEvents();
    },
  });

  try {
    Object.defineProperty(window, DEV_CONSOLE_KEY, {
      value: api,
      writable: false,
      configurable: true,
      enumerable: false,
    });
  } catch {
    return null;
  }

  return api;
}
