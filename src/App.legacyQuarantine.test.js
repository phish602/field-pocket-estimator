const LEGACY = {
  "field-pocket-language": "es",
  "field-pocket-theme": "dark",
  "field-pocket-profile-v1": JSON.stringify({ company: "Legacy Field Pocket BVW" }),
  "field-pocket-customers-v1": JSON.stringify([{ customer: "Legacy Field Pocket Customer" }]),
  "field-pocket-estimates": JSON.stringify([{ amount: "20508" }]),
  "field-pocket-invoices-v1": JSON.stringify([{ amount: "20508" }]),
};

test("importing App performs zero legacy storage operations", () => {
  jest.resetModules();
  localStorage.clear();
  Object.entries(LEGACY).forEach(([key, value]) => localStorage.setItem(key, value));
  const getItem = jest.spyOn(Storage.prototype, "getItem");
  const setItem = jest.spyOn(Storage.prototype, "setItem");
  const removeItem = jest.spyOn(Storage.prototype, "removeItem");
  const clear = jest.spyOn(Storage.prototype, "clear");
  try {
    jest.isolateModules(() => { require("./App"); });
    const legacyCalls = (spy) => spy.mock.calls.filter(([key]) => typeof key === "string" && key.startsWith("field-pocket-"));
    expect(legacyCalls(getItem)).toHaveLength(0); expect(legacyCalls(setItem)).toHaveLength(0); expect(legacyCalls(removeItem)).toHaveLength(0); expect(clear).not.toHaveBeenCalled();
    Object.entries(LEGACY).forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value));
    expect(localStorage.getItem("estipaid-storage-migrated-v1")).toBeNull();
  } finally { getItem.mockRestore(); setItem.mockRestore(); removeItem.mockRestore(); clear.mockRestore(); }
});
