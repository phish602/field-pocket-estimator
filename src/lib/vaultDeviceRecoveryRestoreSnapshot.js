import { STORAGE_KEYS } from "../constants/storageKeys";

export const VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES =
  Object.freeze({
    BLOCKED: "blocked",
    READY: "ready",
  });

export const VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES =
  Object.freeze({
    SNAPSHOT_REQUIRED: "SNAPSHOT_REQUIRED",
    SNAPSHOT_NOT_READY: "SNAPSHOT_NOT_READY",
    SNAPSHOT_NOT_READ_ONLY: "SNAPSHOT_NOT_READ_ONLY",
    MAPPED_PAYLOAD_INVALID: "MAPPED_PAYLOAD_INVALID",
    VALUE_NOT_SERIALIZABLE: "VALUE_NOT_SERIALIZABLE",
    PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  });

const MAX_DEPTH = 64;
const MAX_NODES = 100000;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const compiledSnapshots = new WeakSet();

const FORBIDDEN_PROPERTY_NAMES = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

const CORE_FIELDS = Object.freeze([
  "customers",
  "projects",
  "estimates",
  "invoices",
]);

const OPTIONAL_FIELDS = Object.freeze([
  "companyProfile",
  "settings",
  "scopeTemplates",
]);

const FIELD_TO_STORAGE_KEY = Object.freeze({
  customers: STORAGE_KEYS.CUSTOMERS,
  projects: STORAGE_KEYS.PROJECTS,
  estimates: STORAGE_KEYS.ESTIMATES,
  invoices: STORAGE_KEYS.INVOICES,
  companyProfile: STORAGE_KEYS.COMPANY_PROFILE,
  settings: STORAGE_KEYS.SETTINGS,
  scopeTemplates: STORAGE_KEYS.SCOPE_TEMPLATES,
});

function blocked(code) {
  return Object.freeze({
    state: VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES.BLOCKED,
    code,
    entryCount: 0,
    totalBytes: 0,
    entries: Object.freeze([]),
    noWritesPerformed: true,
  });
}

function plainObject(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function cloneJsonValue(value, context, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new TypeError("Recovery value exceeds maximum depth.");
  }

  context.nodes += 1;

  if (context.nodes > MAX_NODES) {
    throw new TypeError("Recovery value exceeds maximum nodes.");
  }

  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Recovery number must be finite.");
    }

    return value;
  }

  if (Array.isArray(value)) {
    const names = Object.getOwnPropertyNames(value);

    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError("Sparse recovery arrays are not allowed.");
      }
    }

    const allowedNames = new Set([
      "length",
      ...value.map((unused, index) => String(index)),
    ]);

    if (names.some((name) => !allowedNames.has(name))) {
      throw new TypeError("Recovery arrays cannot carry extra properties.");
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Recovery arrays cannot carry symbols.");
    }

    return value.map((entry) => (
      cloneJsonValue(entry, context, depth + 1)
    ));
  }

  if (!plainObject(value)) {
    throw new TypeError("Recovery objects must be plain JSON objects.");
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Recovery objects cannot carry symbols.");
  }

  const clone = {};

  for (const name of Object.getOwnPropertyNames(value).sort()) {
    if (FORBIDDEN_PROPERTY_NAMES.has(name)) {
      throw new TypeError("Recovery object contains a forbidden property.");
    }

    const descriptor =
      Object.getOwnPropertyDescriptor(value, name);

    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      throw new TypeError(
        "Recovery objects must contain enumerable data properties only."
      );
    }

    if (descriptor.value === undefined) {
      throw new TypeError(
        "Recovery objects cannot contain undefined values."
      );
    }

    clone[name] = cloneJsonValue(
      descriptor.value,
      context,
      depth + 1
    );
  }

  return clone;
}

function serializeField(value) {
  const cloned = cloneJsonValue(
    value,
    { nodes: 0 }
  );

  const serialized = JSON.stringify(cloned);

  if (typeof serialized !== "string") {
    throw new TypeError("Recovery value could not be serialized.");
  }

  return serialized;
}

function validMappedPayload(mapped) {
  if (!plainObject(mapped)) return false;

  if (
    CORE_FIELDS.some(
      (field) => !Array.isArray(mapped[field])
    )
  ) {
    return false;
  }

  if (
    mapped.companyProfile !== null
    && mapped.companyProfile !== undefined
    && !plainObject(mapped.companyProfile)
  ) {
    return false;
  }

  if (
    mapped.settings !== null
    && mapped.settings !== undefined
    && !plainObject(mapped.settings)
  ) {
    return false;
  }

  if (
    mapped.scopeTemplates !== null
    && mapped.scopeTemplates !== undefined
    && !Array.isArray(mapped.scopeTemplates)
  ) {
    return false;
  }

  return true;
}

/**
 * Compiles a verified read-only Supabase convergence snapshot into the exact
 * logical-key/value batch that will later be committed atomically into the
 * replacement encrypted runtime.
 *
 * This function performs no cloud reads, local writes, encryption, key access,
 * queue mutation, event dispatch, navigation, or IndexedDB access.
 */
export function compileVaultDeviceRecoveryRestoreSnapshot({
  cloudSnapshot = null,
} = {}) {
  if (
    !cloudSnapshot
    || typeof cloudSnapshot !== "object"
  ) {
    return blocked(
      VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
        .SNAPSHOT_REQUIRED
    );
  }

  if (
    cloudSnapshot.ok !== true
    || String(cloudSnapshot.status || "").trim()
      !== "ready"
  ) {
    return blocked(
      VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
        .SNAPSHOT_NOT_READY
    );
  }

  if (cloudSnapshot.noWritesPerformed !== true) {
    return blocked(
      VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
        .SNAPSHOT_NOT_READ_ONLY
    );
  }

  const mapped = cloudSnapshot.mapped;

  if (!validMappedPayload(mapped)) {
    return blocked(
      VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
        .MAPPED_PAYLOAD_INVALID
    );
  }

  const fields = [
    ...CORE_FIELDS,
    ...OPTIONAL_FIELDS.filter(
      (field) =>
        mapped[field] !== null
        && mapped[field] !== undefined
    ),
  ];

  const entries = [];
  let totalBytes = 0;

  try {
    for (const field of fields) {
      const logicalKey = FIELD_TO_STORAGE_KEY[field];
      const value = serializeField(mapped[field]);
      const byteLength =
        new TextEncoder().encode(value).length;

      totalBytes += byteLength;

      if (totalBytes > MAX_TOTAL_BYTES) {
        return blocked(
          VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
            .PAYLOAD_TOO_LARGE
        );
      }

      entries.push(Object.freeze({
        logicalKey,
        value,
        byteLength,
      }));
    }
  } catch {
    return blocked(
      VAULT_DEVICE_RECOVERY_SNAPSHOT_CODES
        .VALUE_NOT_SERIALIZABLE
    );
  }

  entries.sort(
    (left, right) =>
      left.logicalKey.localeCompare(right.logicalKey)
  );

  const compiled = Object.freeze({
    state: VAULT_DEVICE_RECOVERY_SNAPSHOT_STATES.READY,
    code: "",
    entryCount: entries.length,
    totalBytes,
    entries: Object.freeze(entries),
    noWritesPerformed: true,
  });

  compiledSnapshots.add(compiled);
  return compiled;
}

// Identity-only provenance. The registry is deliberately module-private and
// never serialized, attached to a snapshot, or exposed as a capability.
export function isCompiledVaultDeviceRecoveryRestoreSnapshot(snapshot) {
  return compiledSnapshots.has(snapshot);
}
