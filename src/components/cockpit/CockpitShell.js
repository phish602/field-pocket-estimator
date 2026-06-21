import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../../constants/storageKeys";
import { STORAGE_KEY } from "../../estimator/defaultState";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../utils/settings";
import CommandPanel from "./CommandPanel";
import MobileSnapshotBar from "./MobileSnapshotBar";
import { deriveEstimateCockpitReadiness } from "./estimateCockpitReadiness";
import { buildEstimateCockpitTotals } from "./estimateCockpitTotals";
import "./CockpitShell.css";

function readStorageValue(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildFallbackState(docType) {
  return {
    ui: {
      docType: docType === "invoice" ? "invoice" : "estimate",
      materialsMode: "itemized",
    },
  };
}

export default function CockpitShell({ children, desiredDocType = "estimate" }) {
  const [draftRaw, setDraftRaw] = useState(() => readStorageValue(STORAGE_KEY));
  const [settingsRaw, setSettingsRaw] = useState(() => readStorageValue(STORAGE_KEYS.SETTINGS));

  useEffect(() => {
    const refreshDraft = () => {
      const next = readStorageValue(STORAGE_KEY);
      setDraftRaw((current) => (current === next ? current : next));
    };

    const refreshSettings = () => {
      const next = readStorageValue(STORAGE_KEYS.SETTINGS);
      setSettingsRaw((current) => (current === next ? current : next));
    };

    const handleStorage = (event) => {
      if (!event?.key || event.key === STORAGE_KEY) refreshDraft();
      if (!event?.key || event.key === STORAGE_KEYS.SETTINGS) refreshSettings();
    };

    const handleLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === STORAGE_KEY) refreshDraft();
      if (!event?.detail?.key || event.detail.key === STORAGE_KEYS.SETTINGS) refreshSettings();
    };

    const pollId = window.setInterval(refreshDraft, 1000);

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pe-localstorage", handleLocalStorage);
    window.addEventListener("estipaid:settings-changed", refreshSettings);
    document.addEventListener("visibilitychange", refreshDraft);

    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pe-localstorage", handleLocalStorage);
      window.removeEventListener("estipaid:settings-changed", refreshSettings);
      document.removeEventListener("visibilitychange", refreshDraft);
    };
  }, []);

  const estimateState = useMemo(() => {
    const parsed = safeParse(draftRaw);
    return parsed && typeof parsed === "object"
      ? parsed
      : buildFallbackState(desiredDocType);
  }, [desiredDocType, draftRaw]);

  const settings = useMemo(() => {
    const parsed = safeParse(settingsRaw);
    return normalizeSettings(parsed || DEFAULT_SETTINGS);
  }, [settingsRaw]);

  const totals = useMemo(
    () => buildEstimateCockpitTotals(estimateState, settings),
    [estimateState, settings]
  );

  const readiness = useMemo(
    () => deriveEstimateCockpitReadiness(estimateState, totals),
    [estimateState, totals]
  );

  return (
    <div className="pe-cockpit-shell">
      <div className="pe-cockpit-shell__frame">
        <div className="pe-cockpit-shell__builder">{children}</div>
        <div className="pe-cockpit-shell__desktop-rail">
          <CommandPanel totals={totals} readiness={readiness} />
        </div>
      </div>
      <MobileSnapshotBar totals={totals} readiness={readiness} />
    </div>
  );
}

