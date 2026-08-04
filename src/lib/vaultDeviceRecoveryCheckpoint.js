const VERSION = 1;
const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
const FIELDS = ["phase", "version", "workspaceTag"];
const PHASES = Object.freeze([
  "vault_deleted",
  "device_key_removed",
  "replacement_vault_provisioned",
  "runtime_initialized",
  "cloud_restore_committed",
]);
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export const VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES = Object.freeze({
  INVALID: "RECOVERY_CHECKPOINT_INVALID",
  CONFLICT: "RECOVERY_CHECKPOINT_CONFLICT",
  STORAGE: "RECOVERY_CHECKPOINT_STORAGE",
});

export const VAULT_DEVICE_RECOVERY_CHECKPOINT_PHASES = Object.freeze(
  [...PHASES]
);

function keyFor(workspaceTag) {
  return `estipaid-vault-device-recovery-v1:${workspaceTag}`;
}

function exactCheckpoint(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) return null;

  const names = Object.getOwnPropertyNames(value).sort();
  if (names.join(",") !== FIELDS.join(",")) return null;

  for (const name of names) {
    if (FORBIDDEN.has(name)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) return null;
  }

  if (
    value.version !== VERSION
    || !WORKSPACE_TAG.test(value.workspaceTag)
    || !PHASES.includes(value.phase)
  ) return null;

  return Object.freeze({
    version: VERSION,
    workspaceTag: value.workspaceTag,
    phase: value.phase,
  });
}

export function readVaultDeviceRecoveryCheckpoint({
  storage = null,
  workspaceTag = "",
} = {}) {
  if (!storage || typeof storage.getItem !== "function" || !WORKSPACE_TAG.test(workspaceTag)) {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.STORAGE, checkpoint: null });
  }
  try {
    const raw = storage.getItem(keyFor(workspaceTag));
    if (raw === null) return Object.freeze({ ok: true, code: "", checkpoint: null });
    if (typeof raw !== "string") throw new Error("INVALID");
    const checkpoint = exactCheckpoint(JSON.parse(raw));
    if (!checkpoint || checkpoint.workspaceTag !== workspaceTag) throw new Error("INVALID");
    return Object.freeze({ ok: true, code: "", checkpoint });
  } catch {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.INVALID, checkpoint: null });
  }
}

export function writeVaultDeviceRecoveryCheckpoint({
  storage = null,
  workspaceTag = "",
  phase = "",
} = {}) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function"
    || !WORKSPACE_TAG.test(workspaceTag) || !PHASES.includes(phase)) {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.STORAGE });
  }
  const current = readVaultDeviceRecoveryCheckpoint({ storage, workspaceTag });
  if (!current.ok) return Object.freeze({ ok: false, code: current.code });
  const currentIndex = current.checkpoint ? PHASES.indexOf(current.checkpoint.phase) : -1;
  const nextIndex = PHASES.indexOf(phase);
  if (nextIndex !== currentIndex + 1 && nextIndex !== currentIndex) {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.CONFLICT });
  }
  try {
    storage.setItem(keyFor(workspaceTag), JSON.stringify({
      version: VERSION,
      workspaceTag,
      phase,
    }));
    return Object.freeze({ ok: true, code: "" });
  } catch {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.STORAGE });
  }
}

export function clearVaultDeviceRecoveryCheckpoint({
  storage = null,
  workspaceTag = "",
} = {}) {
  if (!storage || typeof storage.removeItem !== "function" || !WORKSPACE_TAG.test(workspaceTag)) {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.STORAGE });
  }
  try {
    storage.removeItem(keyFor(workspaceTag));
    return Object.freeze({ ok: true, code: "" });
  } catch {
    return Object.freeze({ ok: false, code: VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.STORAGE });
  }
}
