import {
  DEFAULT_SAVE_LOAD_MODE,
  SAVE_LOAD_MODES,
  isBackendMode,
  isLocalStorageMode,
  normalizeSaveLoadMode,
  resolveSaveLoadMode,
} from "./saveLoadMode";

describe("saveLoadMode", () => {
  test("default mode is localStorage", () => {
    expect(DEFAULT_SAVE_LOAD_MODE).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(resolveSaveLoadMode()).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
  });

  test("unknown missing or empty modes normalize to localStorage", () => {
    expect(normalizeSaveLoadMode()).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(normalizeSaveLoadMode(null)).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(normalizeSaveLoadMode("")).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(normalizeSaveLoadMode("invalid")).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(resolveSaveLoadMode({ mode: "   " })).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
  });

  test("backend mode is explicit only", () => {
    expect(normalizeSaveLoadMode("backend")).toBe(SAVE_LOAD_MODES.BACKEND);
    expect(isBackendMode("backend")).toBe(true);
    expect(isBackendMode("localStorage")).toBe(false);
  });

  test("localStorage mode helper is true only for localStorage", () => {
    expect(isLocalStorageMode("localStorage")).toBe(true);
    expect(isLocalStorageMode("backend")).toBe(false);
    expect(isLocalStorageMode("disabled")).toBe(false);
  });
});
