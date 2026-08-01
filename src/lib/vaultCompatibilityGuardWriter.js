import {
  VAULT_COMPATIBILITY_GUARD_KEY,
  verifyVaultCompatibilityGuardValue,
} from "./vaultCompatibilityGuard";

const VALUES = Object.freeze({
  transition: '{"version":1,"state":"transition"}',
  authoritative: '{"version":1,"state":"authoritative"}',
});

export const VAULT_COMPATIBILITY_GUARD_VALUES = VALUES;

export function writeVaultCompatibilityGuard({ state, storage } = {}) {
  const rawValue = VALUES[state];
  if (!rawValue || !storage || typeof storage.getItem !== "function") return false;
  try {
    if (storage.getItem(VAULT_COMPATIBILITY_GUARD_KEY) === rawValue) {
      return verifyVaultCompatibilityGuardValue(rawValue).state === state;
    }
    if (typeof storage.setVaultCompatibilityGuardValue === "function") {
      if (storage.setVaultCompatibilityGuardValue(rawValue) !== rawValue) return false;
    } else if (typeof storage.setItem === "function") {
      storage.setItem(VAULT_COMPATIBILITY_GUARD_KEY, rawValue);
    } else {
      return false;
    }
    return storage.getItem(VAULT_COMPATIBILITY_GUARD_KEY) === rawValue
      && verifyVaultCompatibilityGuardValue(rawValue).state === state;
  } catch {
    return false;
  }
}
