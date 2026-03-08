// @ts-nocheck
/* eslint-disable */

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STATE, STORAGE_KEY } from "./defaultState";
import { DEFAULT_SETTINGS, loadSettings } from "../utils/settings";

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    // last resort shallow clone
    if (Array.isArray(obj)) return obj.map((x) => deepClone(x));
    if (obj && typeof obj === "object") {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
      return out;
    }
    return obj;
  }
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeDefaults(base, patch) {
  if (Array.isArray(base)) {
    // base arrays are treated as templates; prefer patch if provided and is array
    return Array.isArray(patch) ? patch : base;
  }
  if (!isPlainObject(base)) return patch !== undefined ? patch : base;

  const out = { ...base };
  if (isPlainObject(patch)) {
    for (const k of Object.keys(patch)) {
      const bv = base[k];
      const pv = patch[k];
      out[k] = mergeDefaults(bv, pv);
    }
  }
  return out;
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function stripInternalNotesForPersistence(state) {
  const next = { ...(state || {}) };
  const uiDocType = next?.ui?.docType === "invoice" ? "invoice" : "estimate";
  if (uiDocType === "invoice") {
    next.scopeNotes = "";
    next.tradeInsert = { key: "", text: "" };
  }
  return next;
}

function applyDefaultInternalNotesForNewEstimate(state) {
  const next = deepClone(state || DEFAULT_STATE);
  const uiDocType = next?.ui?.docType === "invoice" ? "invoice" : "estimate";
  if (uiDocType !== "estimate") return next;
  if (String(next?.scopeNotes || "").trim()) return next;
  let defaultNote = "";
  try {
    const settings = loadSettings();
    defaultNote = String(
      settings?.docDefaults?.defaultInternalNotesEstimate
      ?? DEFAULT_SETTINGS?.docDefaults?.defaultInternalNotesEstimate
      ?? ""
    ).trim();
  } catch {
    defaultNote = String(DEFAULT_SETTINGS?.docDefaults?.defaultInternalNotesEstimate || "").trim();
  }
  if (!defaultNote) return next;
  next.scopeNotes = defaultNote;
  return next;
}

function setByPath(obj, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return obj;

  const root = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  let cur = root;

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    const last = i === parts.length - 1;

    if (last) {
      cur[key] = value;
    } else {
      const nextVal = cur[key];
      const next =
        Array.isArray(nextVal) ? nextVal.slice() : isPlainObject(nextVal) ? { ...nextVal } : {};
      cur[key] = next;
      cur = next;
    }
  }

  return root;
}

export function useEstimatorState(options = {}) {
  const saveTimerRef = useRef(null);
  const lastSerializedRef = useRef("");
  const persistDraft = options?.persistDraft !== false;

  const [state, setState] = useState(() => {
    const base = deepClone(DEFAULT_STATE);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const loaded = raw ? safeParse(raw) : null;
      if (loaded && typeof loaded === "object") {
        return mergeDefaults(base, loaded);
      }
    } catch {}
    return applyDefaultInternalNotesForNewEstimate(base);
  });

  // Debounced autosave to STORAGE_KEY
  useEffect(() => {
    try {
      if (!state || typeof state !== "object") return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (!persistDraft) return;

      saveTimerRef.current = setTimeout(() => {
        try {
          const next = stripInternalNotesForPersistence(state);
          next.meta = { ...(next.meta || {}), lastSavedAt: Date.now() };

          const serialized = JSON.stringify(next);
          if (serialized === lastSerializedRef.current) return;

          localStorage.setItem(STORAGE_KEY, serialized);
          lastSerializedRef.current = serialized;

          // Keep in-memory meta in sync (only if it actually changed)
          if (Number(state?.meta?.lastSavedAt || 0) !== Number(next.meta.lastSavedAt || 0)) {
            setState(next);
          }
        } catch {}
      }, 350);

      return () => {
        try {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        } catch {}
      };
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistDraft, state]);

  // patch(path, value)
  const patch = (path, value) => {
    setState((prev) => setByPath(prev, path, value));
  };

  // ---- Labor helpers ----
  const addLaborLine = () => {
    setState((prev) => {
      const next = deepClone(prev);
      const lines = Array.isArray(next?.labor?.lines) ? next.labor.lines : [];
      lines.push({ id: uid("l_"), role: "", hours: "", rate: "", trueRateInternal: "" });
      next.labor = { ...(next.labor || {}), lines };
      return next;
    });
  };

  const dupLaborLine = (id) => {
    setState((prev) => {
      const next = deepClone(prev);
      const lines = Array.isArray(next?.labor?.lines) ? next.labor.lines : [];
      const idx = lines.findIndex((x) => String(x?.id) === String(id));
      if (idx < 0) return prev;
      const copy = { ...(lines[idx] || {}) };
      copy.id = uid("l_");
      lines.splice(idx + 1, 0, copy);
      next.labor = { ...(next.labor || {}), lines };
      return next;
    });
  };

  const removeLaborLine = (id) => {
    setState((prev) => {
      const next = deepClone(prev);
      const lines = Array.isArray(next?.labor?.lines) ? next.labor.lines : [];
      const filtered = lines.filter((x) => String(x?.id) !== String(id));
      next.labor = { ...(next.labor || {}), lines: filtered.length ? filtered : [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }] };
      return next;
    });
  };

  const updateLaborLine = (id, patchObj) => {
    setState((prev) => {
      const next = deepClone(prev);
      const lines = Array.isArray(next?.labor?.lines) ? next.labor.lines : [];
      const idx = lines.findIndex((x) => String(x?.id) === String(id));
      if (idx < 0) return prev;
      lines[idx] = { ...(lines[idx] || {}), ...(patchObj || {}) };
      next.labor = { ...(next.labor || {}), lines };
      return next;
    });
  };

  // ---- Materials helpers ----
  const addMaterialItem = () => {
    setState((prev) => {
      const next = deepClone(prev);
      const items = Array.isArray(next?.materials?.items) ? next.materials.items : [];
      items.push({ id: uid("m_"), desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" });
      next.materials = { ...(next.materials || {}), items };
      return next;
    });
  };

  const dupMaterialItem = (id) => {
    setState((prev) => {
      const next = deepClone(prev);
      const items = Array.isArray(next?.materials?.items) ? next.materials.items : [];
      const idx = items.findIndex((x) => String(x?.id) === String(id));
      if (idx < 0) return prev;
      const copy = { ...(items[idx] || {}) };
      copy.id = uid("m_");
      items.splice(idx + 1, 0, copy);
      next.materials = { ...(next.materials || {}), items };
      return next;
    });
  };

  const removeMaterialItem = (id) => {
    setState((prev) => {
      const next = deepClone(prev);
      const items = Array.isArray(next?.materials?.items) ? next.materials.items : [];
      const filtered = items.filter((x) => String(x?.id) !== String(id));
      next.materials = { ...(next.materials || {}), items: filtered.length ? filtered : [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }] };
      return next;
    });
  };

  const updateMaterialItem = (id, patchObj) => {
    setState((prev) => {
      const next = deepClone(prev);
      const items = Array.isArray(next?.materials?.items) ? next.materials.items : [];
      const idx = items.findIndex((x) => String(x?.id) === String(id));
      if (idx < 0) return prev;
      items[idx] = { ...(items[idx] || {}), ...(patchObj || {}) };
      next.materials = { ...(next.materials || {}), items };
      return next;
    });
  };

  const saveNow = (metaPatch = null, saveOptions = null) => {
    try {
      const next = stripInternalNotesForPersistence(state);
      const extraMeta = metaPatch && typeof metaPatch === "object" ? metaPatch : {};
      const persistOverride = saveOptions && typeof saveOptions === "object"
        ? saveOptions.persistDraft
        : undefined;
      const shouldPersistDraft = persistOverride === undefined ? persistDraft : persistOverride !== false;
      next.meta = { ...(next.meta || {}), ...extraMeta, lastSavedAt: Date.now() };
      const serialized = JSON.stringify(next);
      if (shouldPersistDraft) {
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSerializedRef.current = serialized;
      }
      setState(next);
      return next;
    } catch {
      return null;
    }
  };

  const clearAll = () => {
    if (persistDraft) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
    setState(applyDefaultInternalNotesForNewEstimate(DEFAULT_STATE));
  };

  const replaceState = (nextState, replaceOptions = null) => {
    try {
      const base = deepClone(DEFAULT_STATE);
      const merged = mergeDefaults(base, deepClone(nextState || {}));
      setState(merged);

      const persistNow = !!replaceOptions?.persistNow;
      const persistOverride = replaceOptions && typeof replaceOptions === "object"
        ? replaceOptions.persistDraft
        : undefined;
      const shouldPersistDraft = persistOverride === undefined ? persistDraft : persistOverride !== false;
      if (persistNow && shouldPersistDraft) {
        const persisted = stripInternalNotesForPersistence(merged);
        persisted.meta = { ...(persisted.meta || {}), lastSavedAt: Date.now() };
        const serialized = JSON.stringify(persisted);
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSerializedRef.current = serialized;
      }
      return merged;
    } catch {
      return null;
    }
  };

  return {
    state,
    patch,
    addLaborLine,
    dupLaborLine,
    removeLaborLine,
    updateLaborLine,
    addMaterialItem,
    dupMaterialItem,
    removeMaterialItem,
    updateMaterialItem,
    saveNow,
    replaceState,
    clearAll,
  };
}

export default useEstimatorState;
