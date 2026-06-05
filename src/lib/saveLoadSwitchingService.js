import {
  DEFAULT_SAVE_LOAD_MODE,
  SAVE_LOAD_MODES,
  isBackendMode,
  resolveSaveLoadMode,
} from "./saveLoadMode";
import { createBackendDataAdapter } from "./backendDataAdapter";

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function createResult(base = {}) {
  return {
    ok: true,
    mode: DEFAULT_SAVE_LOAD_MODE,
    fallbackUsed: false,
    blocked: false,
    reason: "",
    warnings: [],
    autoMigrationPerformed: false,
    ...base,
  };
}

function createModeState(requestedMode, backendFeatureEnabled, backendStatus) {
  const fallbackMode = SAVE_LOAD_MODES.LOCAL_STORAGE;
  const configured = Boolean(backendStatus && backendStatus.isConfigured);

  if (!isBackendMode(requestedMode)) {
    return {
      activeMode: SAVE_LOAD_MODES.LOCAL_STORAGE,
      requestedMode,
      isBackendConfigured: configured,
      isBackendEnabled: false,
      fallbackMode,
      reason: requestedMode === SAVE_LOAD_MODES.DISABLED
        ? "Save/load switching is disabled; localStorage fallback remains active."
        : "localStorage is the default active save/load mode.",
    };
  }

  if (!backendFeatureEnabled) {
    return {
      activeMode: SAVE_LOAD_MODES.LOCAL_STORAGE,
      requestedMode,
      isBackendConfigured: configured,
      isBackendEnabled: false,
      fallbackMode,
      reason: "Backend mode requested but feature flag is disabled; using localStorage fallback.",
    };
  }

  if (!configured) {
    return {
      activeMode: SAVE_LOAD_MODES.LOCAL_STORAGE,
      requestedMode,
      isBackendConfigured: false,
      isBackendEnabled: false,
      fallbackMode,
      reason: "Backend mode requested but Supabase is unconfigured; using localStorage fallback.",
    };
  }

  return {
    activeMode: SAVE_LOAD_MODES.BACKEND,
    requestedMode,
    isBackendConfigured: true,
    isBackendEnabled: true,
    fallbackMode,
    reason: "Backend mode enabled via explicit feature flag.",
  };
}

export function createSaveLoadSwitchingService(options = {}) {
  const requestedMode = resolveSaveLoadMode({ mode: options.mode });
  const backendFeatureEnabled = options && typeof options === "object" && options.enableBackendMode === true;
  const adapter = options.backendAdapter || createBackendDataAdapter({ adapterLabel: "save-load-switching-service" });

  function getBackendStatus() {
    if (!adapter || typeof adapter.getBackendAdapterStatus !== "function") {
      return {
        isConfigured: false,
        canRead: false,
        canWrite: false,
        reason: "Backend adapter status is unavailable.",
        missingKeys: [],
      };
    }
    const status = adapter.getBackendAdapterStatus();
    return {
      isConfigured: Boolean(status && status.isConfigured),
      canRead: Boolean(status && status.canRead),
      canWrite: Boolean(status && status.canWrite),
      reason: String((status && status.reason) || ""),
      missingKeys: Array.isArray(status && status.missingKeys) ? [...status.missingKeys] : [],
    };
  }

  function resolveMode(modeOptions = {}) {
    const nextRequestedMode = resolveSaveLoadMode({ mode: modeOptions.mode ?? requestedMode });
    const backendStatus = getBackendStatus();

    return createModeState(nextRequestedMode, backendFeatureEnabled, backendStatus);
  }

  function getStatus() {
    const modeState = resolveMode();
    return {
      ...modeState,
    };
  }

  function shouldUseBackend(modeOptions = {}) {
    const modeState = resolveMode(modeOptions);
    return modeState.activeMode === SAVE_LOAD_MODES.BACKEND;
  }

  function shouldUseLocalStorageFallback(modeOptions = {}) {
    return !shouldUseBackend(modeOptions);
  }

  function prepareSavePayload(localSnapshot = {}, context = {}) {
    const modeState = resolveMode();
    const safeSnapshot = cloneValue(localSnapshot) || {};
    const safeContext = cloneValue(context) || {};
    const warnings = [];

    if (!modeState.isBackendEnabled) {
      warnings.push({
        code: "local_storage_fallback_active",
        severity: "info",
        message: modeState.reason,
      });
    }

    let backendDraft = null;
    if (modeState.isBackendEnabled && typeof adapter.prepareBackendDraft === "function") {
      const prepared = adapter.prepareBackendDraft(safeSnapshot, safeContext);
      backendDraft = prepared && prepared.mappedDraft ? prepared.mappedDraft : null;
      if (Array.isArray(prepared && prepared.warnings) && prepared.warnings.length) {
        warnings.push(...prepared.warnings);
      }
    }

    return createResult({
      mode: modeState.activeMode,
      fallbackUsed: modeState.activeMode !== SAVE_LOAD_MODES.BACKEND,
      reason: modeState.reason,
      warnings,
      payload: {
        localSnapshot: safeSnapshot,
        context: safeContext,
        backendDraft,
      },
    });
  }

  function prepareLoadRequest(query = {}, context = {}) {
    const modeState = resolveMode();
    const safeQuery = cloneValue(query) || {};
    const safeContext = cloneValue(context) || {};

    return createResult({
      mode: modeState.activeMode,
      fallbackUsed: modeState.activeMode !== SAVE_LOAD_MODES.BACKEND,
      reason: modeState.reason,
      payload: {
        query: safeQuery,
        context: safeContext,
      },
    });
  }

  function saveDraft(localSnapshot = {}, context = {}) {
    const prepared = prepareSavePayload(localSnapshot, context);

    if (prepared.mode !== SAVE_LOAD_MODES.BACKEND) {
      return {
        ...prepared,
        data: {
          savedTo: SAVE_LOAD_MODES.LOCAL_STORAGE,
          snapshot: cloneValue(prepared.payload.localSnapshot),
        },
      };
    }

    const backendResult = typeof adapter.writeToBackend === "function"
      ? adapter.writeToBackend(prepared.payload.backendDraft, prepared.payload.context)
      : { ok: false, blocked: true, reason: "Backend write method is unavailable." };

    if (!backendResult || backendResult.blocked || backendResult.ok === false) {
      return createResult({
        mode: SAVE_LOAD_MODES.LOCAL_STORAGE,
        fallbackUsed: true,
        blocked: true,
        reason: String((backendResult && backendResult.reason) || "Backend write is blocked or unavailable."),
        warnings: prepared.warnings,
        data: {
          savedTo: SAVE_LOAD_MODES.LOCAL_STORAGE,
          snapshot: cloneValue(prepared.payload.localSnapshot),
        },
      });
    }

    return createResult({
      mode: SAVE_LOAD_MODES.BACKEND,
      fallbackUsed: false,
      reason: "Backend save completed through explicitly enabled backend mode.",
      warnings: prepared.warnings,
      data: backendResult,
    });
  }

  function loadDrafts(query = {}, context = {}) {
    const prepared = prepareLoadRequest(query, context);

    if (prepared.mode !== SAVE_LOAD_MODES.BACKEND) {
      return {
        ...prepared,
        data: {
          loadedFrom: SAVE_LOAD_MODES.LOCAL_STORAGE,
          drafts: [],
          query: cloneValue(prepared.payload.query),
        },
      };
    }

    const backendResult = typeof adapter.readFromBackend === "function"
      ? adapter.readFromBackend(prepared.payload.query, prepared.payload.context)
      : { ok: false, blocked: true, reason: "Backend read method is unavailable." };

    if (!backendResult || backendResult.blocked || backendResult.ok === false) {
      return createResult({
        mode: SAVE_LOAD_MODES.LOCAL_STORAGE,
        fallbackUsed: true,
        blocked: true,
        reason: String((backendResult && backendResult.reason) || "Backend read is blocked or unavailable."),
        data: {
          loadedFrom: SAVE_LOAD_MODES.LOCAL_STORAGE,
          drafts: [],
          query: cloneValue(prepared.payload.query),
        },
      });
    }

    return createResult({
      mode: SAVE_LOAD_MODES.BACKEND,
      fallbackUsed: false,
      reason: "Backend load completed through explicitly enabled backend mode.",
      data: backendResult,
    });
  }

  return {
    getStatus,
    resolveMode,
    shouldUseBackend,
    shouldUseLocalStorageFallback,
    prepareSavePayload,
    prepareLoadRequest,
    saveDraft,
    loadDrafts,
  };
}

export const saveLoadSwitchingService = createSaveLoadSwitchingService();

export default saveLoadSwitchingService;
