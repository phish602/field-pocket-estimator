import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES,
  VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES,
  compileVaultDeviceRecoveryRestoreSnapshot,
  isCompiledVaultDeviceRecoveryRestoreSnapshot,
} from "./vaultDeviceRecoveryRestoreSnapshot";

function mapped(overrides = {}) {
  return {
    customers: [
      {
        id: "customer-1",
        fullName: "Synthetic Customer",
      },
    ],
    projects: [
      {
        id: "project-1",
        customerId: "customer-1",
        projectName: "Synthetic Project",
      },
    ],
    estimates: [
      {
        id: "estimate-1",
        total: 100,
      },
    ],
    invoices: [
      {
        id: "invoice-1",
        invoiceTotal: 100,
      },
    ],
    companyProfile: {
      companyName: "Synthetic Company",
    },
    settings: {
      language: "en",
    },
    scopeTemplates: [
      {
        id: "template-1",
        name: "Synthetic Template",
      },
    ],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    ok: true,
    status: "ready",
    noWritesPerformed: true,
    mapped: mapped(),
    ...overrides,
  };
}

function expectBlocked(result, code) {
  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES.BLOCKED,
    code,
    entryCount: 0,
    totalBytes: 0,
    entries: [],
    noWritesPerformed: true,
  });

  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.entries)).toBe(true);
}

test("compiles the exact cloud restore payload into logical vault entries", () => {
  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot(),
    });

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES.READY
  );

  expect(result.code).toBe("");
  expect(result.noWritesPerformed).toBe(true);
  expect(result.entryCount).toBe(7);
  expect(result.totalBytes).toBeGreaterThan(0);

  expect(
    result.entries.map((entry) => entry.logicalKey)
  ).toEqual([
    STORAGE_KEYS.COMPANY_PROFILE,
    STORAGE_KEYS.CUSTOMERS,
    STORAGE_KEYS.ESTIMATES,
    STORAGE_KEYS.INVOICES,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.SCOPE_TEMPLATES,
    STORAGE_KEYS.SETTINGS,
  ].sort());

  for (const entry of result.entries) {
    expect(typeof entry.value).toBe("string");
    expect(entry.byteLength).toBeGreaterThan(0);
    expect(JSON.parse(entry.value)).toBeDefined();
    expect(Object.isFrozen(entry)).toBe(true);
  }

  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.entries)).toBe(true);
});

test("always includes all four core business collections", () => {
  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          customers: [],
          projects: [],
          estimates: [],
          invoices: [],
          companyProfile: null,
          settings: null,
          scopeTemplates: null,
        }),
      }),
    });

  expect(
    result.entries.map((entry) => entry.logicalKey)
  ).toEqual([
    STORAGE_KEYS.CUSTOMERS,
    STORAGE_KEYS.ESTIMATES,
    STORAGE_KEYS.INVOICES,
    STORAGE_KEYS.PROJECTS,
  ].sort());

  result.entries.forEach((entry) => {
    expect(entry.value).toBe("[]");
  });
});

test("omits optional sections that were not captured in cloud", () => {
  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          companyProfile: null,
          settings: null,
          scopeTemplates: null,
        }),
      }),
    });

  const keys =
    result.entries.map((entry) => entry.logicalKey);

  expect(keys).not.toContain(
    STORAGE_KEYS.COMPANY_PROFILE
  );

  expect(keys).not.toContain(
    STORAGE_KEYS.SETTINGS
  );

  expect(keys).not.toContain(
    STORAGE_KEYS.SCOPE_TEMPLATES
  );
});

test("requires a successful ready cloud snapshot", () => {
  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: null,
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .SNAPSHOT_REQUIRED
  );

  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        ok: false,
        status: "invalid",
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .SNAPSHOT_NOT_READY
  );
});

test("requires explicit proof that the cloud snapshot performed no writes", () => {
  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        noWritesPerformed: false,
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .SNAPSHOT_NOT_READ_ONLY
  );
});

test("rejects malformed core collections", () => {
  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          customers: {},
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .MAPPED_PAYLOAD_INVALID
  );
});

test("rejects malformed optional sections", () => {
  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          settings: [],
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .MAPPED_PAYLOAD_INVALID
  );

  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          scopeTemplates: {},
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .MAPPED_PAYLOAD_INVALID
  );
});

test("rejects accessors instead of executing them", () => {
  const dangerous = {};

  Object.defineProperty(
    dangerous,
    "secret",
    {
      enumerable: true,
      get() {
        throw new Error("Accessor must not execute.");
      },
    }
  );

  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          settings: dangerous,
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .VALUE_NOT_SERIALIZABLE
  );
});

test("rejects forbidden prototype-shaped property names", () => {
  const settings = Object.create(null);

  Object.defineProperty(
    settings,
    "__proto__",
    {
      enumerable: true,
      value: {
        polluted: true,
      },
    }
  );

  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: {
          ...mapped(),
          settings,
        },
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .MAPPED_PAYLOAD_INVALID
  );
});

test("rejects non-finite numbers and undefined values", () => {
  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          settings: {
            threshold: Number.POSITIVE_INFINITY,
          },
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .VALUE_NOT_SERIALIZABLE
  );

  expectBlocked(
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: mapped({
          settings: {
            language: undefined,
          },
        }),
      }),
    }),
    VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
      .VALUE_NOT_SERIALIZABLE
  );
});

test("does not mutate the supplied cloud snapshot", () => {
  const supplied = snapshot();
  const before = JSON.stringify(supplied);

  compileVaultDeviceRecoveryRestoreSnapshot({
    cloudSnapshot: supplied,
  });

  expect(JSON.stringify(supplied)).toBe(before);
});

test("performs no storage or cloud operation", () => {
  const setItem = jest.fn();
  const removeItem = jest.fn();
  const from = jest.fn();

  const supplied = snapshot({
    storage: {
      setItem,
      removeItem,
    },
    client: {
      from,
    },
  });

  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: supplied,
    });

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES.READY
  );

  expect(setItem).not.toHaveBeenCalled();
  expect(removeItem).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
});

test("records non-enumerable compiler-owned identity provenance only", () => {
  const compiled = compileVaultDeviceRecoveryRestoreSnapshot({
    cloudSnapshot: snapshot(),
  });
  const manual = Object.freeze({
    state: compiled.state,
    code: compiled.code,
    entryCount: compiled.entryCount,
    totalBytes: compiled.totalBytes,
    entries: compiled.entries,
    noWritesPerformed: compiled.noWritesPerformed,
  });

  expect(isCompiledVaultDeviceRecoveryRestoreSnapshot(compiled)).toBe(true);
  expect(isCompiledVaultDeviceRecoveryRestoreSnapshot(manual)).toBe(false);
  expect(isCompiledVaultDeviceRecoveryRestoreSnapshot({ ...compiled })).toBe(false);
  expect(isCompiledVaultDeviceRecoveryRestoreSnapshot(
    JSON.parse(JSON.stringify(compiled))
  )).toBe(false);
  expect(Object.getOwnPropertySymbols(compiled)).toEqual([]);
  expect(Object.getOwnPropertyNames(compiled).sort()).toEqual([
    "code", "entries", "entryCount", "noWritesPerformed", "state", "totalBytes",
  ]);
});

test("returns only approved recovery storage keys", () => {
  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: snapshot({
        mapped: {
          ...mapped(),
          attackerControlledKey: {
            value: "ignored",
          },
        },
      }),
    });

  expect(
    result.entries.map((entry) => entry.logicalKey)
  ).toEqual([
    STORAGE_KEYS.COMPANY_PROFILE,
    STORAGE_KEYS.CUSTOMERS,
    STORAGE_KEYS.ESTIMATES,
    STORAGE_KEYS.INVOICES,
    STORAGE_KEYS.PROJECTS,
    STORAGE_KEYS.SCOPE_TEMPLATES,
    STORAGE_KEYS.SETTINGS,
  ].sort());
});
