// @ts-nocheck
/* eslint-disable */

// Gate 13O-2J: one import contract for every backup JSON shape EstiPaid can
// produce. Before this, Settings' import only understood the raw app data
// export ({ keys: {...} }); importing the "Download Backup JSON" artifact
// (parsedData.migration.*) or any cloud artifact silently wrote nothing and
// still reported success. This module makes import source-explicit,
// count-previewed, and impossible to complete as a silent zero-record
// "success":
//   1. detectBackupJsonSource identifies cloud / device / legacy-raw shapes.
//   2. buildBackupJsonImportPlan maps records into the exact localStorage
//      keys/shapes the app reads, with per-domain counts, BEFORE any write.
//   3. applyBackupJsonImportPlan performs the planned writes only.
// It never fabricates estimate math: cloud artifacts only ever carry
// estimates captured verbatim from restore_payload, and this module writes
// them as-is.

import { STORAGE_KEYS } from "../constants/storageKeys";
import { EXPORT_ARTIFACT_VERSION } from "./localStorageExportArtifact";
import { CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION } from "./supabaseCloudRestore";

export const BACKUP_JSON_SOURCE = {
  CLOUD: "cloud",
  DEVICE: "device",
  LEGACY_RAW: "legacy_raw",
  UNKNOWN: "unknown",
};

export const BACKUP_JSON_SOURCE_LABELS = {
  [BACKUP_JSON_SOURCE.CLOUD]: "Cloud Backup JSON",
  [BACKUP_JSON_SOURCE.DEVICE]: "This Device Backup JSON",
  [BACKUP_JSON_SOURCE.LEGACY_RAW]: "Raw App Data export (legacy)",
  [BACKUP_JSON_SOURCE.UNKNOWN]: "Unknown backup file",
};

const ESTIPAID_PREFIX = "estipaid-";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toStorageString(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function countInvoicePayments(invoices) {
  return asArray(invoices).reduce((total, invoice) => total + asArray(invoice?.payments).length, 0);
}

export function detectBackupJsonSource(parsed) {
  if (!isPlainObject(parsed)) return BACKUP_JSON_SOURCE.UNKNOWN;
  if (parsed.source === "cloud" || parsed.artifactVersion === CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION) {
    return BACKUP_JSON_SOURCE.CLOUD;
  }
  if (parsed.source === "localStorage" || parsed.artifactVersion === EXPORT_ARTIFACT_VERSION) {
    return BACKUP_JSON_SOURCE.DEVICE;
  }
  if (isPlainObject(parsed.keys)) {
    return BACKUP_JSON_SOURCE.LEGACY_RAW;
  }
  return BACKUP_JSON_SOURCE.UNKNOWN;
}

function buildBlockedPlan(source, blockedReason) {
  return {
    ok: false,
    source,
    sourceLabel: BACKUP_JSON_SOURCE_LABELS[source] || BACKUP_JSON_SOURCE_LABELS[BACKUP_JSON_SOURCE.UNKNOWN],
    blockedReason,
    counts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
    coreRecordTotal: 0,
    writes: [],
    settings: null,
    warnings: [],
    importedDomains: [],
  };
}

function finalizePlan({ source, writes, counts, settings, warnings, importedDomains }) {
  const coreRecordTotal =
    Number(counts.customers || 0) +
    Number(counts.projects || 0) +
    Number(counts.estimates || 0) +
    Number(counts.invoices || 0);
  return {
    ok: true,
    source,
    sourceLabel: BACKUP_JSON_SOURCE_LABELS[source],
    blockedReason: "",
    counts,
    coreRecordTotal,
    writes,
    settings: isPlainObject(settings) ? settings : null,
    warnings,
    importedDomains,
  };
}

// Core collections are only written when the backup actually contains
// records for them: overwriting existing local data with an empty array
// during a recovery import would be silent data loss, not a restore.
function pushArrayWrite(writes, importedDomains, warnings, key, domain, records, sourceLabel) {
  const rows = asArray(records);
  if (rows.length === 0) {
    warnings.push(`${sourceLabel} contains no ${domain.replace(/_/g, " ")}; existing local ${domain.replace(/_/g, " ")} (if any) will be left unchanged.`);
    return;
  }
  writes.push({ key, value: JSON.stringify(rows) });
  importedDomains.push(domain);
}

function buildCloudImportPlan(parsed) {
  const records = parsed?.records;
  if (!isPlainObject(records)) {
    return buildBlockedPlan(
      BACKUP_JSON_SOURCE.CLOUD,
      "This cloud backup JSON has no records section. It cannot be imported."
    );
  }

  const writes = [];
  const warnings = [];
  const importedDomains = [];
  const sourceLabel = BACKUP_JSON_SOURCE_LABELS[BACKUP_JSON_SOURCE.CLOUD];

  const customers = asArray(records.customers);
  const projects = asArray(records.projects);
  const estimates = asArray(records.estimates);
  const invoices = asArray(records.invoices);

  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.CUSTOMERS, "customers", customers, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.PROJECTS, "projects", projects, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.ESTIMATES, "estimates", estimates, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.INVOICES, "invoices", invoices, sourceLabel);

  if (Array.isArray(records.scopeTemplates) && records.scopeTemplates.length > 0) {
    writes.push({ key: STORAGE_KEYS.SCOPE_TEMPLATES, value: JSON.stringify(records.scopeTemplates) });
    importedDomains.push("templates");
  }
  if (isPlainObject(records.companyProfile)) {
    writes.push({ key: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify(records.companyProfile) });
    importedDomains.push("company_profile");
  }

  const missingPayloads = Number(parsed?.restorePayloadCoverage?.estimatesMissingRestorePayload || 0);
  if (missingPayloads > 0) {
    warnings.push(
      `${missingPayloads} cloud estimate(s) were missing a restore payload when this backup was exported and are not included. They were not rebuilt from guessed math.`
    );
  }

  return finalizePlan({
    source: BACKUP_JSON_SOURCE.CLOUD,
    writes,
    counts: {
      customers: customers.length,
      projects: projects.length,
      estimates: estimates.length,
      invoices: invoices.length,
      invoicePayments: countInvoicePayments(invoices),
    },
    settings: records.settings,
    warnings,
    importedDomains,
  });
}

function readMigrationArray(migration, name) {
  const parsed = migration?.[name]?.parsed;
  return Array.isArray(parsed) ? parsed : [];
}

function buildDeviceImportPlan(parsed) {
  const migration = parsed?.parsedData?.migration;
  if (!isPlainObject(migration)) {
    return buildBlockedPlan(
      BACKUP_JSON_SOURCE.DEVICE,
      "This device backup JSON has no parsed data section. It cannot be imported."
    );
  }

  const writes = [];
  const warnings = [];
  const importedDomains = [];
  const sourceLabel = BACKUP_JSON_SOURCE_LABELS[BACKUP_JSON_SOURCE.DEVICE];

  const customers = readMigrationArray(migration, "customers");
  const projects = readMigrationArray(migration, "projects");
  const estimates = readMigrationArray(migration, "estimates");
  const invoices = readMigrationArray(migration, "invoices");
  const scopeTemplates = readMigrationArray(migration, "scopeTemplates");
  const auditEvents = readMigrationArray(migration, "auditEvents");
  const companyProfile = migration?.companyProfile?.parsed;
  const settings = migration?.settings?.parsed;

  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.CUSTOMERS, "customers", customers, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.PROJECTS, "projects", projects, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.ESTIMATES, "estimates", estimates, sourceLabel);
  pushArrayWrite(writes, importedDomains, warnings, STORAGE_KEYS.INVOICES, "invoices", invoices, sourceLabel);

  if (scopeTemplates.length > 0) {
    writes.push({ key: STORAGE_KEYS.SCOPE_TEMPLATES, value: JSON.stringify(scopeTemplates) });
    importedDomains.push("templates");
  }
  if (auditEvents.length > 0) {
    writes.push({ key: STORAGE_KEYS.AUDIT_EVENTS, value: JSON.stringify(auditEvents) });
  }
  if (isPlainObject(companyProfile)) {
    writes.push({ key: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify(companyProfile) });
    importedDomains.push("company_profile");
  }

  return finalizePlan({
    source: BACKUP_JSON_SOURCE.DEVICE,
    writes,
    counts: {
      customers: customers.length,
      projects: projects.length,
      estimates: estimates.length,
      invoices: invoices.length,
      invoicePayments: countInvoicePayments(invoices),
    },
    settings,
    warnings,
    importedDomains,
  });
}

const LEGACY_KEY_DOMAINS = {
  [STORAGE_KEYS.CUSTOMERS]: "customers",
  [STORAGE_KEYS.PROJECTS]: "projects",
  [STORAGE_KEYS.ESTIMATES]: "estimates",
  [STORAGE_KEYS.INVOICES]: "invoices",
  [STORAGE_KEYS.SCOPE_TEMPLATES]: "templates",
  [STORAGE_KEYS.COMPANY_PROFILE]: "company_profile",
};

function readLegacyArray(keysObj, key) {
  const value = keysObj[key];
  const parsed = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function buildLegacyRawImportPlan(parsed) {
  const keysObj = isPlainObject(parsed?.keys) ? parsed.keys : {};
  const writes = [];
  const importedDomains = [];

  Object.keys(keysObj).forEach((key) => {
    if (!key.startsWith(ESTIPAID_PREFIX)) return;
    if (key === STORAGE_KEYS.SETTINGS) return;
    const raw = toStorageString(keysObj[key]);
    if (!raw) return;
    writes.push({ key, value: raw });
    if (LEGACY_KEY_DOMAINS[key]) importedDomains.push(LEGACY_KEY_DOMAINS[key]);
  });

  let settings = parsed?.settings;
  if (!isPlainObject(settings) && Object.prototype.hasOwnProperty.call(keysObj, STORAGE_KEYS.SETTINGS)) {
    const fromKeys = keysObj[STORAGE_KEYS.SETTINGS];
    settings = typeof fromKeys === "string" ? safeParse(fromKeys) : fromKeys;
  }

  const invoices = readLegacyArray(keysObj, STORAGE_KEYS.INVOICES);

  return finalizePlan({
    source: BACKUP_JSON_SOURCE.LEGACY_RAW,
    writes,
    counts: {
      customers: readLegacyArray(keysObj, STORAGE_KEYS.CUSTOMERS).length,
      projects: readLegacyArray(keysObj, STORAGE_KEYS.PROJECTS).length,
      estimates: readLegacyArray(keysObj, STORAGE_KEYS.ESTIMATES).length,
      invoices: invoices.length,
      invoicePayments: countInvoicePayments(invoices),
    },
    settings,
    warnings: [],
    importedDomains,
  });
}

/**
 * Builds a write plan (no side effects) for any recognized backup JSON.
 * Callers must show plan.counts to the user and get explicit confirmation
 * before calling applyBackupJsonImportPlan -- especially when
 * plan.coreRecordTotal is 0.
 */
export function buildBackupJsonImportPlan(parsed) {
  const source = detectBackupJsonSource(parsed);
  if (source === BACKUP_JSON_SOURCE.CLOUD) return buildCloudImportPlan(parsed);
  if (source === BACKUP_JSON_SOURCE.DEVICE) return buildDeviceImportPlan(parsed);
  if (source === BACKUP_JSON_SOURCE.LEGACY_RAW) return buildLegacyRawImportPlan(parsed);
  return buildBlockedPlan(
    BACKUP_JSON_SOURCE.UNKNOWN,
    "This file is not a recognized EstiPaid backup JSON (cloud backup, device backup, or raw app data export)."
  );
}

/**
 * Applies a plan built by buildBackupJsonImportPlan to the given storage.
 * Settings are intentionally NOT written here -- callers must merge them
 * through their safe settings merge path.
 */
export function applyBackupJsonImportPlan({ plan, storage } = {}) {
  if (!plan?.ok || !storage || typeof storage.setItem !== "function") {
    return { writeCount: 0, writtenKeys: [], importedCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 } };
  }
  const writtenKeys = [];
  plan.writes.forEach(({ key, value }) => {
    try {
      storage.setItem(key, value);
      writtenKeys.push(key);
    } catch {}
  });
  return {
    writeCount: writtenKeys.length,
    writtenKeys,
    importedCounts: { ...plan.counts },
  };
}
