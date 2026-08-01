import {
  DEFAULT_VAULT_IDLE_LOCK_MINUTES,
  VAULT_IDLE_LOCK_MINUTES,
  readVaultIdleLockMinutes,
  writeVaultIdleLockMinutes,
} from "./vaultIdleLockSettings";

const KEY = "estipaid-vault-idle-lock-minutes";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test("exports the exact immutable idle-lock policy", () => {
  expect(VAULT_IDLE_LOCK_MINUTES).toEqual([5, 15, 30, 60]);
  expect(Object.isFrozen(VAULT_IDLE_LOCK_MINUTES)).toBe(true);
  expect(DEFAULT_VAULT_IDLE_LOCK_MINUTES).toBe(30);
});

test.each([5, 15, 30, 60])("round trips the allowed non-secret %s minute preference", (minutes) => {
  expect(writeVaultIdleLockMinutes(minutes)).toEqual({ ok: true });
  expect(localStorage.getItem(KEY)).toBe(String(minutes));
  expect(readVaultIdleLockMinutes()).toBe(minutes);
});

test("missing, malformed, and unsupported preferences safely default to 30 minutes", () => {
  expect(readVaultIdleLockMinutes()).toBe(30);
  ["", "30.0", "abc", "0", "90", "-5"].forEach((value) => {
    localStorage.setItem(KEY, value);
    expect(readVaultIdleLockMinutes()).toBe(30);
  });
});

test("storage read failure safely defaults to 30 minutes", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
  expect(readVaultIdleLockMinutes()).toBe(30);
});

test("invalid writes are rejected without writing a preference", () => {
  [undefined, null, 0, 1, 10, 90, "30", 30.5].forEach((value) => {
    expect(writeVaultIdleLockMinutes(value)).toEqual({ ok: false });
  });
  expect(localStorage.getItem(KEY)).toBeNull();
});

test("storage write failure is non-throwing and exposes no raw error", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota secret"); });
  expect(writeVaultIdleLockMinutes(30)).toEqual({ ok: false });
});

test("preference storage writes only the permitted numeric duration", () => {
  const setItem = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  try {
    writeVaultIdleLockMinutes(15);
    expect(setItem).toHaveBeenCalledWith(KEY, "15");
    expect(JSON.stringify(setItem.mock.calls)).not.toMatch(/password|kek|dek|cryptokey|metadata/i);
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    setItem.mockRestore();
    dispatch.mockRestore();
    fetch.mockRestore();
  }
});
