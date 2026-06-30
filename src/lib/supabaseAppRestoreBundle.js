import { getSupabaseClient } from "./supabaseClient";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const SUPABASE_APP_RESTORE_BUNDLE_SCHEMA = "estipaid.app.restore_bundle";
export const SUPABASE_APP_RESTORE_BUNDLE_VERSION = 1;
export const SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY = "app_restore_bundle";

export const APP_RESTORE_BUNDLE_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  ROLE_NOT_ALLOWED: "role_not_allowed",
  COMPLETED: "completed",
  ERROR: "error",
};

const COMPANY_MANAGE_ROLES = new Set(["owner", "admin"]);

function asText(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildNotice(level, code, message, details = {}) {
  return { level, code, message, details };
}

function readFromSnapshot(snapshot, key) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (typeof snapshot.getItem === "function") {
    const value = snapshot.getItem(key);
    return value === undefined ? null : value;
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return null;
  const value = snapshot[key];
  return value === undefined ? null : value;
}

function safeParseJson(raw) {
  try {
    return { value: JSON.parse(raw), error: null };
  } catch (error) {
    return { value: null, error: String(error?.message || "JSON parse error") };
  }
}

function createRowId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `app_restore_bundle_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function parseSnapshotEntry(storageSnapshot, key, expectedShape, notices) {
  const raw = readFromSnapshot(storageSnapshot, key);
  if (raw === null) {
    notices.push(buildNotice("info", `missing_local_key:${key}`, `Local key "${key}" is missing and will be captured as null.`));
    return null;
  }

  const { value, error } = safeParseJson(raw);
  if (error) {
    notices.push(buildNotice("warning", `invalid_local_json:${key}`, `Local key "${key}" contains invalid JSON and will be captured as null.`));
    return null;
  }

  if (expectedShape === "object" && !isPlainObject(value)) {
    notices.push(buildNotice("warning", `unsupported_local_shape:${key}`, `Local key "${key}" was expected to be an object and will be captured as null.`));
    return null;
  }

  if (expectedShape === "array" && !Array.isArray(value)) {
    notices.push(buildNotice("warning", `unsupported_local_shape:${key}`, `Local key "${key}" was expected to be an array and will be captured as null.`));
    return null;
  }

  return value;
}

export function buildSupabaseAppRestoreBundle(storageSnapshot) {
  const notices = [];
  const companyProfile = parseSnapshotEntry(storageSnapshot, STORAGE_KEYS.COMPANY_PROFILE, "object", notices);
  const settings = parseSnapshotEntry(storageSnapshot, STORAGE_KEYS.SETTINGS, "object", notices);
  const scopeTemplates = parseSnapshotEntry(storageSnapshot, STORAGE_KEYS.SCOPE_TEMPLATES, "array", notices);

  const bundle = {
    schema: SUPABASE_APP_RESTORE_BUNDLE_SCHEMA,
    version: SUPABASE_APP_RESTORE_BUNDLE_VERSION,
    capturedFrom: "localStorage",
    companyProfile,
    settings,
    scopeTemplates,
  };

  return {
    bundle,
    notices,
    captureSummary: {
      companyProfileCaptured: isPlainObject(companyProfile),
      logoDataUrlCaptured: Boolean(asText(companyProfile?.logoDataUrl)),
      settingsCaptured: isPlainObject(settings),
      scopeTemplatesCaptured: Array.isArray(scopeTemplates),
    },
    readKeys: [
      STORAGE_KEYS.COMPANY_PROFILE,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCOPE_TEMPLATES,
    ],
  };
}

export function validateSupabaseAppRestoreBundle(bundle) {
  const normalized = isPlainObject(bundle) ? bundle : null;
  if (!normalized) {
    return {
      valid: false,
      reason: "Bundle payload is not an object.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (asText(normalized.schema) !== SUPABASE_APP_RESTORE_BUNDLE_SCHEMA) {
    return {
      valid: false,
      reason: "Bundle schema does not match EstiPaid app restore bundle.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (Number(normalized.version) !== SUPABASE_APP_RESTORE_BUNDLE_VERSION) {
    return {
      valid: false,
      reason: "Bundle version is not supported.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  const companyProfile = normalized.companyProfile;
  const settings = normalized.settings;
  const scopeTemplates = normalized.scopeTemplates;

  if (!(companyProfile === null || isPlainObject(companyProfile))) {
    return {
      valid: false,
      reason: "Bundle companyProfile must be an object or null.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (!(settings === null || isPlainObject(settings))) {
    return {
      valid: false,
      reason: "Bundle settings must be an object or null.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (!(scopeTemplates === null || Array.isArray(scopeTemplates))) {
    return {
      valid: false,
      reason: "Bundle scopeTemplates must be an array or null.",
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  return {
    valid: true,
    reason: "",
    captureSummary: {
      companyProfileCaptured: isPlainObject(companyProfile),
      logoDataUrlCaptured: Boolean(asText(companyProfile?.logoDataUrl)),
      settingsCaptured: isPlainObject(settings),
      scopeTemplatesCaptured: Array.isArray(scopeTemplates),
    },
  };
}

async function readExistingBundleRows(client, companyId) {
  try {
    const response = await client
      .from("app_settings")
      .select("id, setting_value")
      .eq("company_id", companyId)
      .eq("setting_scope", "company")
      .eq("setting_key", SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY);

    if (response?.error) {
      return { rows: null, error: response.error };
    }

    return { rows: Array.isArray(response?.data) ? response.data : [], error: null };
  } catch (error) {
    return { rows: null, error };
  }
}

export async function readSupabaseAppRestoreBundle({ client, companyId } = {}) {
  if (!client?.from || !asText(companyId)) {
    return {
      status: "missing",
      bundle: null,
      notices: [],
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  const { rows, error } = await readExistingBundleRows(client, companyId);
  if (error) {
    return {
      status: "error",
      bundle: null,
      notices: [buildNotice("warning", "app_restore_bundle_read_failed", "Unable to read the app restore bundle from Supabase.")],
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (!rows || rows.length === 0) {
    return {
      status: "missing",
      bundle: null,
      notices: [],
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  if (rows.length > 1) {
    return {
      status: "error",
      bundle: null,
      notices: [buildNotice("warning", "app_restore_bundle_duplicate_rows", "Multiple app restore bundle rows were found in Supabase. Restore bundle usage is blocked until the duplicate rows are cleaned up.")],
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }

  const bundle = rows[0]?.setting_value ?? null;
  const validation = validateSupabaseAppRestoreBundle(bundle);
  if (!validation.valid) {
    return {
      status: "invalid",
      bundle: null,
      notices: [buildNotice("warning", "app_restore_bundle_invalid", validation.reason || "App restore bundle is invalid.")],
      captureSummary: validation.captureSummary,
    };
  }

  return {
    status: "available",
    bundle,
    notices: [],
    captureSummary: validation.captureSummary,
  };
}

export async function updateSupabaseAppRestoreBundle({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
} = {}) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  const normalizedRole = asText(role).toLowerCase();

  if (!configured || !userId) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.SIGNED_OUT,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
      notices: [],
      error: "Sign in to Supabase before updating the app restore bundle.",
    };
  }

  if (!companyId) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.NO_WORKSPACE,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
      notices: [],
      error: "Create or join a cloud workspace before updating the app restore bundle.",
    };
  }

  if (normalizedRole && !COMPANY_MANAGE_ROLES.has(normalizedRole)) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.ROLE_NOT_ALLOWED,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
      notices: [],
      error: "Only owner or admin roles can update the app restore bundle.",
    };
  }

  const client = getSupabaseClient();
  if (!client?.from) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
      notices: [],
      error: "Supabase is not configured.",
    };
  }

  const { bundle, notices, captureSummary } = buildSupabaseAppRestoreBundle(storageSnapshot);
  const { rows, error } = await readExistingBundleRows(client, companyId);
  if (error) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary,
      notices,
      error: "Unable to read the existing app restore bundle row from Supabase.",
    };
  }

  if (Array.isArray(rows) && rows.length > 1) {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary,
      notices: [
        ...notices,
        buildNotice("warning", "app_restore_bundle_duplicate_rows", "Multiple app restore bundle rows were found in Supabase. Update is blocked until the duplicate rows are cleaned up."),
      ],
      error: "Multiple app restore bundle rows exist for this workspace.",
    };
  }

  const timestamp = new Date().toISOString();
  try {
    if (Array.isArray(rows) && rows.length === 1) {
      const response = await client
        .from("app_settings")
        .update({
          setting_value: bundle,
          updated_at: timestamp,
        })
        .eq("id", rows[0].id)
        .eq("company_id", companyId)
        .select("id, setting_value");

      if (response?.error) {
        return {
          status: APP_RESTORE_BUNDLE_STATUS.ERROR,
          bundleUpdated: false,
          noLocalDataChanged: true,
          captureSummary,
          notices,
          error: "Unable to update the app restore bundle in Supabase.",
        };
      }

      return {
        status: APP_RESTORE_BUNDLE_STATUS.COMPLETED,
        bundleUpdated: true,
        bundleAction: "updated",
        noLocalDataChanged: true,
        captureSummary,
        notices,
        bundle,
      };
    }

    const response = await client
      .from("app_settings")
      .insert({
        id: createRowId(),
        company_id: companyId,
        user_id: null,
        setting_scope: "company",
        setting_key: SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY,
        setting_value: bundle,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select("id, setting_value");

    if (response?.error) {
      return {
        status: APP_RESTORE_BUNDLE_STATUS.ERROR,
        bundleUpdated: false,
        noLocalDataChanged: true,
        captureSummary,
        notices,
        error: "Unable to create the app restore bundle in Supabase.",
      };
    }

    return {
      status: APP_RESTORE_BUNDLE_STATUS.COMPLETED,
      bundleUpdated: true,
      bundleAction: "inserted",
      noLocalDataChanged: true,
      captureSummary,
      notices,
      bundle,
    };
  } catch {
    return {
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      noLocalDataChanged: true,
      captureSummary,
      notices,
      error: "Unable to store the app restore bundle in Supabase.",
    };
  }
}
