// ISO-15F1 -- a device-global, read-only compatibility guard. This module
// deliberately exposes no writer: bridge builds can only observe and enforce.
export const VAULT_COMPATIBILITY_GUARD_KEY = "estipaid-vault-guard-v1";

const BLOCKED_MESSAGE = "Secure local data access could not be verified.";
const ABSENT = Object.freeze({ state: "absent", code: "", message: "" });
const TRANSITION = Object.freeze({ state: "transition", code: "", message: "" });
const AUTHORITATIVE = Object.freeze({ state: "authoritative", code: "", message: "" });

function blocked(code) {
  return Object.freeze({ state: "blocked", code, message: BLOCKED_MESSAGE });
}

function strictGuardObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== 2 || Object.getOwnPropertySymbols(value).length !== 0) return null;
    if (!names.includes("version") || !names.includes("state")) return null;
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || descriptor.enumerable !== true || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
    }
    if (value.version !== 1) return null;
    if (value.state === "transition") return TRANSITION;
    if (value.state === "authoritative") return AUTHORITATIVE;
  } catch {
    return null;
  }
  return null;
}

// Accepts a raw storage string (the production path) or a supplied value for
// strict validation tests. It never reads or writes browser storage itself.
export function verifyVaultCompatibilityGuardValue(rawValue) {
  if (rawValue === null) return ABSENT;
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return strictGuardObject(parsed) || blocked("INVALID_GUARD");
  } catch {
    return blocked("INVALID_GUARD");
  }
}

export function readVaultCompatibilityGuard() {
  try {
    if (typeof window === "undefined" || !window.localStorage || typeof window.localStorage.getItem !== "function") {
      return blocked("STORAGE_UNAVAILABLE");
    }
    const rawValue = window.localStorage.getItem(VAULT_COMPATIBILITY_GUARD_KEY);
    if (rawValue === null) return ABSENT;
    if (typeof rawValue !== "string") return blocked("INVALID_GUARD");
    return verifyVaultCompatibilityGuardValue(rawValue);
  } catch {
    return blocked("STORAGE_UNAVAILABLE");
  }
}
