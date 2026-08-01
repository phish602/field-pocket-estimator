import { migrateLegacyStorageNamespace } from "./storage";

const LEGACY = {
  "field-pocket-language": "es",
  "field-pocket-profile-v1": JSON.stringify({ companyName: "Legacy Field Pocket BVW" }),
  "field-pocket-customers-v1": JSON.stringify([{ name: "Legacy Field Pocket Customer" }]),
  "field-pocket-estimates": JSON.stringify([{ amount: "20508" }]),
  "field-pocket-invoices-v1": JSON.stringify([{ amount: "20508" }]),
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test("unauthorized legacy migration is a complete storage no-op", () => {
  Object.entries(LEGACY).forEach(([key, value]) => localStorage.setItem(key, value));
  const getItem = jest.spyOn(Storage.prototype, "getItem");
  const setItem = jest.spyOn(Storage.prototype, "setItem");
  const removeItem = jest.spyOn(Storage.prototype, "removeItem");
  const key = jest.spyOn(Storage.prototype, "key");
  try {
    expect(migrateLegacyStorageNamespace({ storage: localStorage })).toEqual(expect.objectContaining({ reason: "recovery_not_authorized" }));
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
    Object.entries(LEGACY).forEach(([legacyKey, value]) => expect(localStorage.getItem(legacyKey)).toBe(value));
  } finally { getItem.mockRestore(); setItem.mockRestore(); removeItem.mockRestore(); key.mockRestore(); }
});

test("authorized recovery touches only the explicitly supplied storage", () => {
  const makeStorage = (values) => {
    const map = new Map(Object.entries(values));
    return { map, get length() { return map.size; }, key: jest.fn((index) => Array.from(map.keys())[index] || null), getItem: jest.fn((key) => map.has(key) ? map.get(key) : null), setItem: jest.fn((key, value) => map.set(String(key), String(value))), removeItem: jest.fn((key) => map.delete(String(key))) };
  };
  const recoveryStorage = makeStorage({ "field-pocket-language": "es", "field-pocket-customers-v1": "[]" });
  localStorage.setItem("field-pocket-language", "window-only");
  const windowGet = jest.spyOn(Storage.prototype, "getItem");
  const windowSet = jest.spyOn(Storage.prototype, "setItem");
  const windowRemove = jest.spyOn(Storage.prototype, "removeItem");
  const windowKey = jest.spyOn(Storage.prototype, "key");
  try {
    expect(migrateLegacyStorageNamespace({ storage: recoveryStorage, authorizedRecovery: true })).toEqual(expect.objectContaining({ ok: true }));
    expect(recoveryStorage.getItem).toHaveBeenCalled();
    expect(windowGet).not.toHaveBeenCalled(); expect(windowSet).not.toHaveBeenCalled(); expect(windowRemove).not.toHaveBeenCalled(); expect(windowKey).not.toHaveBeenCalled();
    expect(localStorage.getItem("field-pocket-language")).toBe("window-only");
  } finally {
    windowGet.mockRestore(); windowSet.mockRestore(); windowRemove.mockRestore(); windowKey.mockRestore();
  }
});
