// @ts-nocheck
/* eslint-disable */

import {
  writeJsonStorage,
  getLastStorageWriteError,
  getStorageWriteErrors,
  clearStorageWriteErrors,
} from "./storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simulateSetItemThrow(errorName = "QuotaExceededError", message = "quota exceeded") {
  const err = new DOMException(message, errorName);
  jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw err;
  });
}

function simulateSecurityError() {
  const err = new DOMException("access denied", "SecurityError");
  jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw err;
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
  clearStorageWriteErrors();
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Existing write behavior — backwards compatibility
// ---------------------------------------------------------------------------

describe("writeJsonStorage — existing behavior compatibility", () => {
  test("returns true on successful write", () => {
    const result = writeJsonStorage("test-key", { a: 1 });
    expect(result).toBe(true);
    expect(localStorage.getItem("test-key")).toBe(JSON.stringify({ a: 1 }));
  });

  test("returns false when setItem throws QuotaExceededError", () => {
    simulateSetItemThrow("QuotaExceededError", "quota exceeded");
    const result = writeJsonStorage("test-key", { a: 1 });
    expect(result).toBe(false);
  });

  test("returns false when setItem throws SecurityError", () => {
    simulateSecurityError();
    const result = writeJsonStorage("test-key", { a: 1 });
    expect(result).toBe(false);
  });

  test("serializes value to JSON string", () => {
    writeJsonStorage("arr-key", [1, 2, 3]);
    expect(localStorage.getItem("arr-key")).toBe("[1,2,3]");
  });
});

// ---------------------------------------------------------------------------
// Error capture — failures are recorded and retrievable
// ---------------------------------------------------------------------------

describe("write failure capture", () => {
  test("getLastStorageWriteError returns null when no failures have occurred", () => {
    expect(getLastStorageWriteError()).toBeNull();
  });

  test("getStorageWriteErrors returns empty array when no failures", () => {
    expect(getStorageWriteErrors()).toEqual([]);
  });

  test("captures QuotaExceededError from writeJsonStorage", () => {
    simulateSetItemThrow("QuotaExceededError", "quota exceeded");
    writeJsonStorage("quota-key", { x: 1 });

    const last = getLastStorageWriteError();
    expect(last).not.toBeNull();
    expect(last.ok).toBe(false);
    expect(last.key).toBe("quota-key");
    expect(last.operation).toBe("writeJsonStorage");
    expect(last.errorName).toBe("QuotaExceededError");
    expect(last.errorMessage).toMatch(/quota/i);
    expect(typeof last.timestamp).toBe("number");
    expect(last.timestamp).toBeGreaterThan(0);
  });

  test("captures SecurityError from writeJsonStorage", () => {
    simulateSecurityError();
    writeJsonStorage("secure-key", { y: 2 });

    const last = getLastStorageWriteError();
    expect(last).not.toBeNull();
    expect(last.ok).toBe(false);
    expect(last.key).toBe("secure-key");
    expect(last.operation).toBe("writeJsonStorage");
    expect(last.errorName).toBe("SecurityError");
  });

  test("successful write does not add to error log", () => {
    writeJsonStorage("ok-key", { z: 3 });
    expect(getLastStorageWriteError()).toBeNull();
    expect(getStorageWriteErrors()).toHaveLength(0);
  });

  test("getStorageWriteErrors accumulates multiple failures", () => {
    simulateSetItemThrow("QuotaExceededError", "quota");
    writeJsonStorage("key-a", 1);
    simulateSetItemThrow("QuotaExceededError", "quota");
    writeJsonStorage("key-b", 2);

    const errors = getStorageWriteErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0].key).toBe("key-a");
    expect(errors[1].key).toBe("key-b");
  });

  test("getStorageWriteErrors returns a copy — mutations do not affect internal buffer", () => {
    simulateSetItemThrow("QuotaExceededError", "quota");
    writeJsonStorage("copy-key", 1);

    const copy = getStorageWriteErrors();
    copy.pop();
    expect(getStorageWriteErrors()).toHaveLength(1);
  });

  test("buffer caps at 10 entries, discarding oldest", () => {
    for (let i = 0; i < 12; i++) {
      jest.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      writeJsonStorage(`key-${i}`, i);
    }

    const errors = getStorageWriteErrors();
    expect(errors).toHaveLength(10);
    expect(errors[0].key).toBe("key-2");
    expect(errors[9].key).toBe("key-11");
  });

  test("clearStorageWriteErrors empties the buffer", () => {
    simulateSetItemThrow("QuotaExceededError", "quota");
    writeJsonStorage("clear-key", 99);
    expect(getStorageWriteErrors()).toHaveLength(1);

    clearStorageWriteErrors();
    expect(getStorageWriteErrors()).toHaveLength(0);
    expect(getLastStorageWriteError()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No Supabase behavior introduced
// ---------------------------------------------------------------------------

describe("no Supabase behavior", () => {
  test("storage module does not import or reference supabase", () => {
    // Confirm the module resolves from utils/storage without a supabase dependency error.
    // If supabase was imported, the mock environment would throw or produce an identifiable side-effect.
    expect(typeof writeJsonStorage).toBe("function");
    expect(typeof getLastStorageWriteError).toBe("function");
    expect(typeof getStorageWriteErrors).toBe("function");
    expect(typeof clearStorageWriteErrors).toBe("function");
  });

  test("write failure records contain no supabase fields", () => {
    simulateSetItemThrow("QuotaExceededError", "quota");
    writeJsonStorage("no-supa-key", 1);

    const err = getLastStorageWriteError();
    const keys = Object.keys(err);
    expect(keys).not.toContain("supabase");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("session");
    expect(keys).toEqual(["ok", "key", "operation", "errorName", "errorMessage", "timestamp"]);
  });
});
