import { VAULT_COMPATIBILITY_GUARD_KEY } from "./vaultCompatibilityGuard";
import {
  VAULT_COMPATIBILITY_GUARD_VALUES,
  writeVaultCompatibilityGuard,
} from "./vaultCompatibilityGuardWriter";

function storage(initial = null) {
  let value = initial;
  return {
    getItem: jest.fn(() => value),
    setItem: jest.fn((key, next) => { if (key === VAULT_COMPATIBILITY_GUARD_KEY) value = next; }),
  };
}

test("writer persists only canonical device-global guard values and verifies read-back", () => {
  const target = storage();
  expect(VAULT_COMPATIBILITY_GUARD_VALUES).toEqual({
    transition: '{"version":1,"state":"transition"}',
    authoritative: '{"version":1,"state":"authoritative"}',
  });
  expect(writeVaultCompatibilityGuard({ state: "transition", storage: target })).toBe(true);
  expect(target.setItem).toHaveBeenCalledWith(VAULT_COMPATIBILITY_GUARD_KEY, VAULT_COMPATIBILITY_GUARD_VALUES.transition);
  expect(writeVaultCompatibilityGuard({ state: "authoritative", storage: target })).toBe(true);
  expect(target.setItem).toHaveBeenLastCalledWith(VAULT_COMPATIBILITY_GUARD_KEY, VAULT_COMPATIBILITY_GUARD_VALUES.authoritative);
});

test("writer fails closed for unsupported state, write failure, or failed read-back", () => {
  expect(writeVaultCompatibilityGuard({ state: "absent", storage: storage() })).toBe(false);
  expect(writeVaultCompatibilityGuard({ state: "transition", storage: {
    getItem: () => null, setItem: () => { throw new Error("storage failure"); },
  } })).toBe(false);
  expect(writeVaultCompatibilityGuard({ state: "transition", storage: {
    getItem: () => null, setItem: () => undefined,
  } })).toBe(false);
});
