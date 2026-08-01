// ISO-15E3 -- non-secret, per-workspace idle-lock preference. The active
// account-scoped localStorage facade supplies the namespace; this module never
// stores identity, unlock state, time data, or cryptographic material.

export const VAULT_IDLE_LOCK_MINUTES = Object.freeze([5, 15, 30, 60]);
export const DEFAULT_VAULT_IDLE_LOCK_MINUTES = 30;

const STORAGE_KEY = "estipaid-vault-idle-lock-minutes";

function isAllowed(value) {
  return typeof value === "number"
    && Number.isInteger(value)
    && VAULT_IDLE_LOCK_MINUTES.includes(value);
}

function storageForPreference() {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

export function readVaultIdleLockMinutes() {
  try {
    const raw = storageForPreference()?.getItem(STORAGE_KEY);
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return DEFAULT_VAULT_IDLE_LOCK_MINUTES;
    const minutes = Number(raw);
    return isAllowed(minutes) ? minutes : DEFAULT_VAULT_IDLE_LOCK_MINUTES;
  } catch {
    return DEFAULT_VAULT_IDLE_LOCK_MINUTES;
  }
}

export function writeVaultIdleLockMinutes(minutes) {
  if (!isAllowed(minutes)) return { ok: false };
  try {
    const storage = storageForPreference();
    if (!storage) return { ok: false };
    storage.setItem(STORAGE_KEY, String(minutes));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
