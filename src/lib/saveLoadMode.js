export const SAVE_LOAD_MODES = Object.freeze({
  LOCAL_STORAGE: "localStorage",
  BACKEND: "backend",
  DISABLED: "disabled",
});

export const DEFAULT_SAVE_LOAD_MODE = SAVE_LOAD_MODES.LOCAL_STORAGE;

export function normalizeSaveLoadMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  if (!normalized) return DEFAULT_SAVE_LOAD_MODE;

  if (normalized === SAVE_LOAD_MODES.BACKEND) return SAVE_LOAD_MODES.BACKEND;
  if (normalized === SAVE_LOAD_MODES.DISABLED) return SAVE_LOAD_MODES.DISABLED;
  if (normalized === SAVE_LOAD_MODES.LOCAL_STORAGE) return SAVE_LOAD_MODES.LOCAL_STORAGE;

  return DEFAULT_SAVE_LOAD_MODE;
}

export function isBackendMode(mode) {
  return normalizeSaveLoadMode(mode) === SAVE_LOAD_MODES.BACKEND;
}

export function isLocalStorageMode(mode) {
  return normalizeSaveLoadMode(mode) === SAVE_LOAD_MODES.LOCAL_STORAGE;
}

export function resolveSaveLoadMode(options = {}) {
  const requestedMode = options && typeof options === "object"
    ? options.mode ?? options.requestedMode
    : undefined;

  return normalizeSaveLoadMode(requestedMode);
}
