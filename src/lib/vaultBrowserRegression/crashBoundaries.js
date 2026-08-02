// ISO-15I -- TEST-ONLY durable crash/restart boundary map for the real-browser
// vault regression harness. Statically unreachable from every Production entry.
//
// A boundary is a point at which the browser is really reloaded or the browser
// session is really closed and reopened. This module owns only the boundary
// vocabulary and the deterministic checkpoint counter; the actual interruption
// and the actual restart are performed by the browser harness and its driver.

export class HarnessInterrupt extends Error {
  constructor(boundary) {
    super("Harness interruption.");
    this.name = "HarnessInterrupt";
    this.boundary = boundary;
  }
}

// Ordered exactly as the ISO-15I crash/restart matrix requires. `mechanism`
// records how forward progress is stopped: `suspend` leaves the runtime awaiting
// forever (the browser is then reloaded or closed out from under it); `latch`
// is used at synchronous read/delete positions where an await is impossible, and
// poisons every later dependency call so no further durable work can occur.
export const CRASH_BOUNDARIES = Object.freeze([
  Object.freeze({ index: 1, label: "before-prepared-created", mechanism: "suspend" }),
  Object.freeze({ index: 2, label: "after-prepared-created", mechanism: "suspend" }),
  Object.freeze({ index: 3, label: "during-transition-guard-write", mechanism: "latch" }),
  Object.freeze({ index: 4, label: "after-transition-guard-readback", mechanism: "latch" }),
  Object.freeze({ index: 5, label: "after-prepared-to-guarded", mechanism: "suspend" }),
  Object.freeze({ index: 6, label: "during-source-inventory", mechanism: "latch" }),
  Object.freeze({ index: 7, label: "before-manifest-commit", mechanism: "suspend" }),
  Object.freeze({ index: 8, label: "after-manifest-commit", mechanism: "suspend" }),
  Object.freeze({ index: 9, label: "during-first-record-write", mechanism: "suspend" }),
  Object.freeze({ index: 10, label: "during-middle-record-write", mechanism: "suspend" }),
  Object.freeze({ index: 11, label: "before-copying-to-verifying", mechanism: "suspend" }),
  Object.freeze({ index: 12, label: "during-encrypted-verification", mechanism: "suspend" }),
  Object.freeze({ index: 13, label: "after-verification-before-source-recheck", mechanism: "latch" }),
  Object.freeze({ index: 14, label: "during-live-source-recheck", mechanism: "latch" }),
  Object.freeze({ index: 15, label: "before-verifying-to-cleaning", mechanism: "suspend" }),
  Object.freeze({ index: 16, label: "after-verifying-to-cleaning", mechanism: "suspend" }),
  Object.freeze({ index: 17, label: "during-authoritative-guard-write", mechanism: "latch" }),
  Object.freeze({ index: 18, label: "after-authoritative-guard-verification", mechanism: "latch" }),
  Object.freeze({ index: 19, label: "before-first-plaintext-deletion", mechanism: "latch" }),
  Object.freeze({ index: 20, label: "during-middle-plaintext-deletion", mechanism: "latch" }),
  Object.freeze({ index: 21, label: "after-deletions-before-cleanup-verification", mechanism: "latch" }),
  Object.freeze({ index: 22, label: "after-cleanup-verification-before-cleaning-to-authoritative", mechanism: "suspend" }),
  Object.freeze({ index: 23, label: "after-cleaning-to-authoritative", mechanism: "suspend" }),
  Object.freeze({ index: 24, label: "before-transition-deletion", mechanism: "suspend" }),
  Object.freeze({ index: 25, label: "after-transition-deletion", mechanism: "suspend" }),
]);

export const CRASH_BOUNDARY_LABELS = Object.freeze(CRASH_BOUNDARIES.map((boundary) => boundary.label));

export function crashBoundary(label) {
  return CRASH_BOUNDARIES.find((boundary) => boundary.label === label) || null;
}

// The "middle" of an n-step loop: never the first step, never past the last.
export function middleStep(total) {
  if (!Number.isSafeInteger(total) || total < 1) return 1;
  return Math.max(1, Math.min(total, Math.ceil(total / 2)));
}

// Deterministic per-hook, per-stage counters plus the trip mechanism. `record`
// persists the sanitized boundary marker; `suspend` produces the never-settling
// promise. Both are injected so this module stays pure and unit-testable.
export function createCheckpointController({
  crashAt = null,
  record = () => {},
  suspend = () => new Promise(() => {}),
} = {}) {
  let stage = "start";
  let tripped = null;
  const counters = new Map();

  const marker = (label) => Object.freeze({ boundary: label, stage, counters: counters.size });

  return Object.freeze({
    setStage(value) { stage = String(value); },
    currentStage: () => stage,
    trippedAt: () => tripped,
    isLatched: () => Boolean(tripped),
    count(hook) {
      const key = `${hook}@${stage}`;
      const value = (counters.get(key) || 0) + 1;
      counters.set(key, value);
      return value;
    },
    armed(label) {
      return crashAt === label && !tripped;
    },
    // Synchronous positions: record, latch, and throw. Every later dependency
    // call observes `isLatched()` and refuses to do durable work.
    tripSync(label) {
      tripped = label;
      record(marker(label));
      throw new HarnessInterrupt(label);
    },
    // Asynchronous positions: record and never settle. The runtime is still
    // suspended inside the operation when the browser is reloaded or closed.
    tripAsync(label) {
      tripped = label;
      record(marker(label));
      return suspend();
    },
    latchedSuspend() {
      return suspend();
    },
  });
}
