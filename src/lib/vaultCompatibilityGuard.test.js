import * as guard from "./vaultCompatibilityGuard";

const TRANSITION = '{"version":1,"state":"transition"}';
const AUTHORITATIVE = '{"version":1,"state":"authoritative"}';

beforeEach(() => localStorage.clear());

test("guard exposes exactly the read-only public contract", () => {
  expect(Object.keys(guard).sort()).toEqual([
    "VAULT_COMPATIBILITY_GUARD_KEY", "readVaultCompatibilityGuard", "verifyVaultCompatibilityGuardValue",
  ]);
  expect(guard.VAULT_COMPATIBILITY_GUARD_KEY).toBe("estipaid-vault-guard-v1");
});

test("genuinely missing guard is absent and valid canonical values are accepted", () => {
  expect(guard.readVaultCompatibilityGuard()).toEqual({ state: "absent", code: "", message: "" });
  localStorage.setItem(guard.VAULT_COMPATIBILITY_GUARD_KEY, TRANSITION);
  expect(guard.readVaultCompatibilityGuard().state).toBe("transition");
  localStorage.setItem(guard.VAULT_COMPATIBILITY_GUARD_KEY, '{"state":"authoritative","version":1}');
  expect(guard.readVaultCompatibilityGuard().state).toBe("authoritative");
  expect(guard.verifyVaultCompatibilityGuardValue(AUTHORITATIVE).state).toBe("authoritative");
});

test.each([
  ["empty", ""], ["malformed", "{"], ["null", "null"], ["array", "[]"], ["primitive", "1"],
  ["missing version", '{"state":"transition"}'], ["missing state", '{"version":1}'],
  ["unknown version", '{"version":2,"state":"transition"}'], ["unknown state", '{"version":1,"state":"other"}'],
  ["extra field", '{"version":1,"state":"transition","extra":true}'],
])("%s guard value fails closed", (_name, value) => {
  expect(guard.verifyVaultCompatibilityGuardValue(value)).toEqual(expect.objectContaining({ state: "blocked" }));
});

test("custom prototypes, null prototypes, accessors, symbols, and hidden fields fail closed", () => {
  const custom = Object.create({ inherited: true }); custom.version = 1; custom.state = "transition";
  const nullPrototype = Object.assign(Object.create(null), { version: 1, state: "transition" });
  const accessor = { version: 1 }; Object.defineProperty(accessor, "state", { enumerable: true, get: () => "transition" });
  const symbol = { version: 1, state: "transition", [Symbol("extra")]: true };
  const hidden = { version: 1, state: "transition" }; Object.defineProperty(hidden, "extra", { value: true });
  [custom, nullPrototype, accessor, symbol, hidden].forEach((value) => expect(guard.verifyVaultCompatibilityGuardValue(value).state).toBe("blocked"));
});

test("storage failures are blocked without exposing raw value, exception, or cause", () => {
  const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("secret storage detail"); });
  try {
    const result = guard.readVaultCompatibilityGuard();
    expect(result).toEqual({ state: "blocked", code: "STORAGE_UNAVAILABLE", message: "Secure local data access could not be verified." });
    expect(JSON.stringify(result)).not.toMatch(/secret|cause|stack/i);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  } finally { spy.mockRestore(); }
});

test("guard module never writes browser storage", () => {
  const setItem = jest.spyOn(Storage.prototype, "setItem");
  const removeItem = jest.spyOn(Storage.prototype, "removeItem");
  const clear = jest.spyOn(Storage.prototype, "clear");
  try {
    guard.readVaultCompatibilityGuard();
    guard.verifyVaultCompatibilityGuardValue(TRANSITION);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  } finally { setItem.mockRestore(); removeItem.mockRestore(); clear.mockRestore(); }
});
