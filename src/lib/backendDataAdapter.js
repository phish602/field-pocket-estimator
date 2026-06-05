import {
  collectBackendMappingWarnings,
  createBackendMappingContext,
  mapLocalSnapshotToBackendDraft,
} from "../utils/backendDataMapper";
import {
  isSupabaseConfigured,
  supabase,
  supabaseEnv,
} from "./supabaseClient";

export const BACKEND_ADAPTER_ENTITY_COVERAGE = [
  "company_profile",
  "customers",
  "projects",
  "estimates",
  "estimate_line_items",
  "invoices",
  "invoice_line_items",
  "invoice_payments",
  "scope_templates",
  "app_settings",
  "audit_events",
  "migration_batches",
  "migration_write_results",
];

const REQUIRED_BACKEND_ENTITY_ORDER = [
  "company_profile",
  "customers",
  "projects",
  "estimates",
  "estimate_line_items",
  "invoices",
  "invoice_line_items",
  "invoice_payments",
  "scope_templates",
  "app_settings",
  "audit_events",
  "migration_batches",
  "migration_write_results",
];

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function buildBlockedResult(operation) {
  return {
    ok: false,
    blocked: true,
    operation,
    reason: "Backend data adapter execution is not approved in this phase.",
  };
}

export function getBackendAdapterStatus() {
  if (!isSupabaseConfigured) {
    return {
      isConfigured: false,
      canRead: false,
      canWrite: false,
      reason: "Supabase public runtime env is missing or placeholder-only.",
      missingKeys: Array.isArray(supabaseEnv?.missingKeys) ? [...supabaseEnv.missingKeys] : [],
    };
  }

  return {
    isConfigured: true,
    canRead: Boolean(supabase),
    canWrite: false,
    reason: "Configured for adapter scaffolding only. Writes remain blocked.",
    missingKeys: [],
  };
}

export function getRequiredBackendEntityOrder() {
  return [...REQUIRED_BACKEND_ENTITY_ORDER];
}

export function mapLocalSnapshotForBackend(localSnapshot = {}, context = {}) {
  const safeSnapshot = cloneValue(localSnapshot) || {};
  const safeContext = cloneValue(context) || {};

  const mappedDraft = mapLocalSnapshotToBackendDraft(safeSnapshot, safeContext);

  return {
    ok: true,
    mappedDraft,
    warnings: Array.isArray(mappedDraft?.warnings) ? mappedDraft.warnings : [],
  };
}

export function collectBackendAdapterWarnings(localSnapshot = {}, context = {}) {
  const safeSnapshot = cloneValue(localSnapshot) || {};
  const safeContext = cloneValue(context) || {};

  const mappingWarnings = collectBackendMappingWarnings(safeSnapshot, safeContext);
  const adapterStatus = getBackendAdapterStatus();
  const adapterWarnings = adapterStatus.isConfigured
    ? []
    : [
        {
          code: "backend_adapter_unconfigured",
          severity: "warning",
          entityType: "adapter",
          entityId: "",
          message: adapterStatus.reason,
          evidence: {
            missingKeys: adapterStatus.missingKeys,
          },
        },
      ];

  return [...mappingWarnings, ...adapterWarnings];
}

export function prepareBackendDraft(localSnapshot = {}, context = {}) {
  const safeContext = cloneValue(context) || {};
  const mappingContext = createBackendMappingContext(safeContext);
  const status = getBackendAdapterStatus();
  const mapped = mapLocalSnapshotForBackend(localSnapshot, mappingContext);
  const warnings = collectBackendAdapterWarnings(localSnapshot, mappingContext);

  return {
    ok: true,
    status,
    mappingContext,
    mappedDraft: mapped.mappedDraft,
    warnings,
  };
}

export function createNoopBackendWritePlan(mappedDraft = null) {
  const warningCount = Array.isArray(mappedDraft?.warnings) ? mappedDraft.warnings.length : 0;

  return {
    ok: true,
    mode: "noop",
    blocked: true,
    reason: "Backend writes are blocked until a separate approval gate.",
    requiredEntityOrder: getRequiredBackendEntityOrder(),
    summary: {
      warningCount,
      hasDraft: Boolean(mappedDraft),
    },
    steps: [],
  };
}

export function createBackendDataAdapter(options = {}) {
  const adapterLabel = String(options?.adapterLabel || "backend-data-adapter").trim() || "backend-data-adapter";

  return {
    adapterLabel,
    entityCoverage: [...BACKEND_ADAPTER_ENTITY_COVERAGE],
    getBackendAdapterStatus,
    getRequiredBackendEntityOrder,
    collectBackendAdapterWarnings,
    mapLocalSnapshotForBackend,
    prepareBackendDraft,
    createNoopBackendWritePlan,
    readFromBackend: () => buildBlockedResult("readFromBackend"),
    writeToBackend: () => buildBlockedResult("writeToBackend"),
  };
}

export const backendDataAdapter = createBackendDataAdapter();

export default backendDataAdapter;
