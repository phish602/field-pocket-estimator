// @ts-nocheck
/* eslint-disable */

export const EXPORT_ARTIFACT_VERSION = "localstorage-export-artifact-v1";

// Migration-critical keys — all must be present for a clean migration pass.
// Key names mirror src/constants/storageKeys.js and src/utils/storageKeys.js.
const MIGRATION_KEYS = {
  COMPANY_PROFILE: "estipaid-company-profile-v1",
  CUSTOMERS: "estipaid-customers-v1",
  PROJECTS: "estipaid-projects-v1",
  ESTIMATES: "estipaid-estimates-v1",
  INVOICES: "estipaid-invoices-v1",
  SETTINGS: "estipaid-settings-v1",
  SCOPE_TEMPLATES: "estipaid-scope-templates-v1",
  AUDIT_EVENTS: "estipaid-audit-events-v1",
};

// Migration keys whose value is a plain object, not an array.
const OBJECT_SHAPE_KEYS = new Set(["COMPANY_PROFILE", "SETTINGS"]);

// Supporting keys captured for completeness but not required for migration.
const SUPPORTING_KEYS = {
  LANG: "estipaid-lang",
  ESTIMATOR_STATE: "estipaid-estimator-v1",
  ESTIMATE_DRAFT: "estipaid-estimate-draft-v1",
  PENDING_CUSTOMER_USE: "estipaid-pending-customer-use-v1",
  PENDING_CUSTOMER_CREATE: "estipaid-pending-customer-create-v1",
  PENDING_CUSTOMER_EDIT: "estipaid-pending-customer-edit-v1",
  CUSTOMER_EDIT_TARGET: "estipaid-customer-edit-target-v1",
  RESTORE_DRAFT_ON_CREATE: "estipaid-restore-draft-on-create-v1",
  SELECTED_CUSTOMER_ID: "estipaid-selectedCustomerId-v1",
  SELECTED_CUSTOMER_SNAP: "estipaid-selectedCustomerSnap-v1",
  CUSTOMER_RECENTS: "estipaid-customer-recent-v1",
  STRIPE_CHECKOUT_SESSIONS: "estipaid-stripe-checkout-sessions-v1",
  STRIPE_CHECKOUT_CREATE_LOCKS: "estipaid-stripe-checkout-create-locks-v1",
  CUSTOM_LABOR_ROLES: "estipaid-custom-labor-roles-v1",
  JOB_LEARNING_REVIEWED_CANDIDATES: "estipaid-job-learning-reviewed-candidates-v1",
  JOB_LEARNING_EVENTS: "estipaid-job-learning-events-v1",
};

// SCREAMING_SNAKE_CASE -> camelCase
function toCamel(keyName) {
  return keyName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Reads from a plain key/value object or a localStorage-like object (has .getItem).
// Never reads from window.localStorage.
function readFromSnapshot(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (typeof snapshot.getItem === "function") {
    const v = snapshot.getItem(key);
    return v === undefined ? null : v;
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return null;
  const v = snapshot[key];
  return v === undefined ? null : v;
}

function safeParse(raw) {
  try {
    return { value: JSON.parse(raw), error: null };
  } catch (err) {
    return { value: null, error: String(err?.message || "JSON parse error") };
  }
}

function buildWarning(code, key, message, severity) {
  return { code, key, message, severity };
}

function parseMigrationEntry(snapshot, keyName, key, warnings) {
  const raw = readFromSnapshot(snapshot, key);

  if (raw === null) {
    warnings.push(buildWarning(
      `missing_key:${key}`,
      key,
      `Migration key "${key}" (${keyName}) is not present in the snapshot.`,
      "warning"
    ));
    return { present: false };
  }

  const { value, error } = safeParse(raw);

  if (error !== null) {
    warnings.push(buildWarning(
      `invalid_json:${key}`,
      key,
      `Migration key "${key}" (${keyName}) contains invalid JSON: ${error}`,
      "error"
    ));
    return { present: true, parsed: null, parseError: error };
  }

  const expectsArray = !OBJECT_SHAPE_KEYS.has(keyName);
  const expectsObject = OBJECT_SHAPE_KEYS.has(keyName);

  if (expectsArray) {
    if (!Array.isArray(value)) {
      warnings.push(buildWarning(
        `unsupported_shape:${key}`,
        key,
        `Migration key "${key}" (${keyName}) was expected to be an array but contains ${value === null ? "null" : typeof value}.`,
        "warning"
      ));
    } else if (value.length === 0) {
      warnings.push(buildWarning(
        `empty_dataset:${key}`,
        key,
        `Migration key "${key}" (${keyName}) is an empty array. No records will be migrated for this entity.`,
        "info"
      ));
    }
  }

  if (expectsObject) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      warnings.push(buildWarning(
        `unsupported_shape:${key}`,
        key,
        `Migration key "${key}" (${keyName}) was expected to be an object but contains ${Array.isArray(value) ? "array" : String(typeof value)}.`,
        "warning"
      ));
    }
  }

  const count = Array.isArray(value) ? value.length : null;
  return { present: true, parsed: value, count };
}

function parseSupportingEntry(snapshot, keyName, key, warnings) {
  const raw = readFromSnapshot(snapshot, key);
  if (raw === null) {
    return { present: false };
  }

  // Keys that look like JSON get parsed; plain strings (e.g. lang="en") are captured as-is.
  const trimmed = String(raw).trim();
  const looksLikeJson = (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed === "null" ||
    trimmed === "true" ||
    trimmed === "false" ||
    /^-?\d/.test(trimmed)
  );

  if (!looksLikeJson) {
    return { present: true, parsed: raw };
  }

  const { value, error } = safeParse(raw);
  if (error !== null) {
    warnings.push(buildWarning(
      `invalid_json:${key}`,
      key,
      `Supporting key "${key}" (${keyName}) appears to contain JSON but could not be parsed: ${error}`,
      "warning"
    ));
    return { present: true, parsed: null, parseError: error };
  }

  return { present: true, parsed: value };
}

/**
 * Builds a read-only export artifact from a localStorage snapshot.
 *
 * @param {Object} storageSnapshot - Plain key/value object or localStorage-like object with .getItem().
 *   Never pass window.localStorage from production app code — operator use only.
 * @param {Object} [options]
 * @param {string} [options.createdAt] - ISO timestamp for deterministic testing.
 * @returns {Object} JSON-safe artifact. Does not mutate input.
 */
export function buildLocalStorageExportArtifact(storageSnapshot, options) {
  const warnings = [];
  const migrationKeysFound = [];
  const migrationKeysMissing = [];
  const supportingKeysFound = [];
  const migrationData = {};
  const supportingData = {};

  for (const [keyName, key] of Object.entries(MIGRATION_KEYS)) {
    const entry = parseMigrationEntry(storageSnapshot, keyName, key, warnings);
    migrationData[toCamel(keyName)] = entry;
    if (entry.present) {
      migrationKeysFound.push(key);
    } else {
      migrationKeysMissing.push(key);
    }
  }

  for (const [keyName, key] of Object.entries(SUPPORTING_KEYS)) {
    const entry = parseSupportingEntry(storageSnapshot, keyName, key, warnings);
    supportingData[toCamel(keyName)] = entry;
    if (entry.present) {
      supportingKeysFound.push(key);
    }
  }

  const createdAt = (options && options.createdAt) ? options.createdAt : new Date().toISOString();

  const cp = migrationData.companyProfile ? migrationData.companyProfile.parsed : null;
  const customers = migrationData.customers ? migrationData.customers.parsed : null;
  const projects = migrationData.projects ? migrationData.projects.parsed : null;
  const estimates = migrationData.estimates ? migrationData.estimates.parsed : null;
  const invoices = migrationData.invoices ? migrationData.invoices.parsed : null;
  const scopeTemplates = migrationData.scopeTemplates ? migrationData.scopeTemplates.parsed : null;
  const auditEvents = migrationData.auditEvents ? migrationData.auditEvents.parsed : null;

  const parseErrorCount = warnings.filter((w) => w.severity === "error").length;
  const warningCount = warnings.filter((w) => w.severity === "warning").length;

  const migrationReadiness = {
    hasCompanyProfile: cp !== null && cp !== undefined && typeof cp === "object" && !Array.isArray(cp) && Object.keys(cp).length > 0,
    hasCustomers: Array.isArray(customers) && customers.length > 0,
    customerCount: Array.isArray(customers) ? customers.length : 0,
    projectCount: Array.isArray(projects) ? projects.length : 0,
    estimateCount: Array.isArray(estimates) ? estimates.length : 0,
    invoiceCount: Array.isArray(invoices) ? invoices.length : 0,
    scopeTemplateCount: Array.isArray(scopeTemplates) ? scopeTemplates.length : 0,
    auditEventCount: Array.isArray(auditEvents) ? auditEvents.length : 0,
    missingMigrationKeys: migrationKeysMissing,
    parseErrorCount,
    warningCount,
    ready: parseErrorCount === 0 && migrationKeysMissing.length === 0,
  };

  return {
    artifactVersion: EXPORT_ARTIFACT_VERSION,
    createdAt,
    source: "localStorage",
    app: "EstiPaid",
    storageKeysFound: [...migrationKeysFound, ...supportingKeysFound],
    storageKeysMissing: migrationKeysMissing,
    parsedData: {
      migration: migrationData,
      supporting: supportingData,
    },
    parseWarnings: warnings,
    migrationReadiness,
  };
}

/**
 * Serializes an artifact to pretty-printed JSON.
 */
export function serializeArtifact(artifact) {
  return JSON.stringify(artifact, null, 2);
}

/**
 * Builds a safe export filename from an ISO timestamp.
 * Format: estipaid-localstorage-export-YYYYMMDD-HHMMSS.json
 */
export function buildArtifactFilename(createdAt) {
  const d = createdAt ? new Date(createdAt) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `estipaid-localstorage-export-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
}
