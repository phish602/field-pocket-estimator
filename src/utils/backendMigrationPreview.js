// @ts-nocheck
/* eslint-disable */

import {
  BACKEND_MAPPING_VERSION,
  createBackendMappingContext,
  mapLocalSnapshotToBackendDraft,
} from "./backendDataMapper";

export const BACKEND_MIGRATION_PREVIEW_VERSION = "backend-migration-preview-v1";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clonePlain(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => clonePlain(entry));
    if (isPlainObject(value)) {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = clonePlain(value[key]);
      });
      return next;
    }
    return value;
  }
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function classifyWarning(warning = {}) {
  const code = String(warning?.code || "");
  const severity = String(warning?.severity || "").toLowerCase();

  if (code === "missing_company_id" || code === "missing_user_id") return "blocker";
  if (code.startsWith("duplicate_local_id:")) return "blocker";
  if (code.endsWith("_missing_id") || code.includes("missing_id")) return "blocker";
  if (code.startsWith("project_customer_ref_missing:")) return "needsReview";
  if (code.startsWith("invoice_source_estimate_missing:")) return "needsReview";
  if (code.startsWith("invoice_payment_missing_amount:")) return "needsReview";
  if (code.startsWith("document_number_collision:")) return "needsReview";
  if (severity === "error") return "blocker";
  if (severity === "warning") return "needsReview";
  return "informational";
}

function buildWarningsBySeverity(warnings = []) {
  const grouped = {
    blocker: [],
    needsReview: [],
    informational: [],
  };

  warnings.forEach((warning) => {
    const previewSeverity = classifyWarning(warning);
    grouped[previewSeverity].push({
      ...clonePlain(warning),
      previewSeverity,
    });
  });

  return grouped;
}

function buildEntityCounts(draft = {}) {
  return {
    companies: countArray(draft?.companies),
    customers: countArray(draft?.customers),
    projects: countArray(draft?.projects),
    estimates: countArray(draft?.estimates),
    invoices: countArray(draft?.invoices),
    invoicePayments: countArray(draft?.invoicePayments),
    scopeTemplates: countArray(draft?.scopeTemplates),
    settings: draft?.settings ? 1 : 0,
    auditEvents: countArray(draft?.auditEvents),
  };
}

export function createBackendMigrationPreview(localSnapshot = {}, contextInput = {}) {
  const context = createBackendMappingContext(contextInput);
  const draft = mapLocalSnapshotToBackendDraft(localSnapshot, context);
  const sourceWarnings = Array.isArray(draft?.warnings) ? draft.warnings : [];
  const warnings = sourceWarnings.map((warning) => clonePlain(warning));
  const warningsBySeverity = buildWarningsBySeverity(warnings);
  const warningSummary = {
    blocker: warningsBySeverity.blocker.length,
    needsReview: warningsBySeverity.needsReview.length,
    informational: warningsBySeverity.informational.length,
    total: warnings.length,
  };

  return {
    mappingVersion: BACKEND_MAPPING_VERSION,
    generatedAtIso: context.generatedAt,
    entityCounts: buildEntityCounts(draft),
    warningSummary,
    warningsBySeverity,
    hasBlockers: warningSummary.blocker > 0,
    canProceed: warningSummary.blocker === 0,
    draft: {
      ...clonePlain(draft),
      warnings,
    },
  };
}
