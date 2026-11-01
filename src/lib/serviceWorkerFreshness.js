import {
  getCloudMutationLedgerSummary,
  readCloudMutationLedger,
} from "./cloudMutationLedger";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const CLIENT_FRESHNESS_EVENT = "estipaid:client-update-available";
export const CLIENT_FRESHNESS_NOTICE_ID = "estipaid-client-freshness-notice";
export const CLIENT_FRESHNESS_RELOAD_KEY = "estipaid-client-freshness-reload-v1";

const CLOUD_BACKUP_RUNNING_EVENT = "estipaid:cloud-auto-backup-running";
const PROFILE_DIRTY_EVENT = "estipaid:user-profile-dirty";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_LOOP_WINDOW_MS = 2 * 60 * 1000;

// EST-0002 proved that a still-running pre-release bundle could execute an old
// persistence contract after a newer hashed bundle was already in Production.
// The deployed CRA asset manifest is therefore the freshness authority here.

function asText(value) {
  return String(value ?? "").trim();
}

function normalizeAssetPath(value, baseHref) {
  const text = asText(value);
  if (!text) return "";
  try {
    const url = new URL(text, baseHref);
    return url.pathname;
  } catch {
    return text.split("?")[0].split("#")[0];
  }
}

function manifestMainAsset(manifest) {
  const direct = asText(manifest?.files?.["main.js"]);
  if (direct) return direct;
  return (Array.isArray(manifest?.entrypoints) ? manifest.entrypoints : [])
    .map(asText)
    .find((entry) => /(^|\/)static\/js\/main\.[^/]+\.js$/.test(entry)) || "";
}

export function getRunningMainAssetPath({ documentRef = document, locationRef = window.location } = {}) {
  const scripts = Array.from(documentRef?.querySelectorAll?.("script[src]") || []);
  const mainScript = scripts.find((script) => {
    const path = normalizeAssetPath(script?.src || script?.getAttribute?.("src"), locationRef?.href);
    return /(^|\/)static\/js\/main(?:\.[^/]+)?\.js$/.test(path);
  });
  return mainScript
    ? normalizeAssetPath(mainScript.src || mainScript.getAttribute?.("src"), locationRef?.href)
    : "";
}

export async function checkClientFreshness({
  fetchImpl = window.fetch.bind(window),
  documentRef = document,
  locationRef = window.location,
  navigatorRef = navigator,
  now = Date.now,
} = {}) {
  if (navigatorRef?.onLine === false) return { status: "offline" };

  const runningAsset = getRunningMainAssetPath({ documentRef, locationRef });
  if (!runningAsset) return { status: "unsupported", reason: "running_asset_not_found" };

  try {
    const manifestUrl = new URL("/asset-manifest.json", locationRef?.origin || locationRef?.href);
    manifestUrl.searchParams.set("estipaid_freshness", String(now()));
    const response = await fetchImpl(manifestUrl.toString(), {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
    if (!response?.ok) return { status: "unavailable", reason: `manifest_http_${response?.status || 0}` };

    const manifest = await response.json();
    const deployedAsset = normalizeAssetPath(manifestMainAsset(manifest), locationRef?.href);
    if (!deployedAsset) return { status: "unavailable", reason: "manifest_main_asset_missing" };
    return {
      status: runningAsset === deployedAsset ? "current" : "outdated",
      runningAsset,
      deployedAsset,
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "manifest_network_failed",
      error: asText(error?.message),
    };
  }
}

function registrationScriptUrls(registration) {
  return [registration?.installing, registration?.waiting, registration?.active]
    .map((worker) => asText(worker?.scriptURL))
    .filter(Boolean);
}

function isEstiPaidWorkerRegistration(registration, locationRef) {
  return registrationScriptUrls(registration).some((scriptUrl) => {
    try {
      const url = new URL(scriptUrl, locationRef?.href);
      return url.origin === locationRef?.origin && url.pathname === "/sw.js";
    } catch {
      return false;
    }
  });
}

export async function updateExistingEstiPaidServiceWorkers({
  serviceWorkerContainer = navigator?.serviceWorker,
  locationRef = window.location,
} = {}) {
  if (!serviceWorkerContainer?.getRegistrations) return { status: "unsupported", checked: 0, updated: 0 };
  try {
    const registrations = await serviceWorkerContainer.getRegistrations();
    const matched = (Array.isArray(registrations) ? registrations : [])
      .filter((registration) => isEstiPaidWorkerRegistration(registration, locationRef));
    const results = await Promise.allSettled(matched.map((registration) => registration.update()));
    return {
      status: "checked",
      checked: matched.length,
      updated: results.filter((result) => result.status === "fulfilled").length,
    };
  } catch (error) {
    return { status: "unavailable", checked: 0, updated: 0, error: asText(error?.message) };
  }
}

export function hasPendingCloudWork() {
  try {
    const ledger = getCloudMutationLedgerSummary(readCloudMutationLedger());
    const rawQueue = localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    const queue = rawQueue ? JSON.parse(rawQueue) : null;
    return Boolean(
      ledger?.hasUnacknowledged
      || queue?.pending
      || (queue?.syncingRevision !== null && queue?.syncingRevision !== undefined)
      || (queue?.status && queue.status !== "clean")
    );
  } catch {
    // If protected state cannot be read, do not declare a reload safe.
    return true;
  }
}

function hasBeforeUnloadProtection(windowRef) {
  try {
    const event = new windowRef.Event("beforeunload", { cancelable: true });
    const allowed = windowRef.dispatchEvent(event);
    return !allowed || event.defaultPrevented;
  } catch {
    return true;
  }
}

export function collectReloadBlockers({
  windowRef = window,
  cloudBackupRunning = false,
  profileDirty = false,
  pendingWorkCheck = hasPendingCloudWork,
} = {}) {
  const blockers = [];
  if (profileDirty) blockers.push("unsaved_profile");
  if (cloudBackupRunning) blockers.push("cloud_sync_running");
  if (pendingWorkCheck()) blockers.push("pending_cloud_work");
  if (hasBeforeUnloadProtection(windowRef)) blockers.push("unsaved_changes");
  return Array.from(new Set(blockers));
}

function readReloadMarker(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(CLIENT_FRESHNESS_RELOAD_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeReloadMarker(storage, marker) {
  try {
    storage?.setItem?.(CLIENT_FRESHNESS_RELOAD_KEY, JSON.stringify(marker));
    return true;
  } catch {
    return false;
  }
}

function removeReloadMarker(storage) {
  try {
    storage?.removeItem?.(CLIENT_FRESHNESS_RELOAD_KEY);
  } catch {}
}

export function isReloadLoopProtected({ targetAsset, storage = sessionStorage, now = Date.now } = {}) {
  const marker = readReloadMarker(storage);
  return Boolean(
    marker
    && marker.targetAsset === targetAsset
    && Number(marker.at) > 0
    && now() - Number(marker.at) < RELOAD_LOOP_WINDOW_MS
  );
}

function ensureUpdateNotice({ documentRef, onReload }) {
  let notice = documentRef.getElementById(CLIENT_FRESHNESS_NOTICE_ID);
  if (notice) return notice;

  notice = documentRef.createElement("section");
  notice.id = CLIENT_FRESHNESS_NOTICE_ID;
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  Object.assign(notice.style, {
    position: "fixed",
    left: "16px",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    maxWidth: "720px",
    margin: "0 auto",
    padding: "14px 16px",
    border: "1px solid rgba(96, 165, 250, 0.6)",
    borderRadius: "12px",
    background: "#111827",
    color: "#f9fafb",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
    font: "600 14px/1.4 system-ui, sans-serif",
  });

  const message = documentRef.createElement("span");
  message.setAttribute("data-client-freshness-message", "true");
  message.textContent = "A newer EstiPaid version is available. Save your work, then reload safely.";

  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = "Reload safely";
  button.setAttribute("data-client-freshness-reload", "true");
  Object.assign(button.style, {
    marginLeft: "14px",
    padding: "8px 12px",
    border: "0",
    borderRadius: "8px",
    background: "#60a5fa",
    color: "#0f172a",
    font: "700 14px system-ui, sans-serif",
    cursor: "pointer",
  });
  button.addEventListener("click", onReload);

  notice.append(message, button);
  documentRef.body?.appendChild(notice);
  return notice;
}

function setNoticeMessage(notice, message) {
  const target = notice?.querySelector?.("[data-client-freshness-message]");
  if (target) target.textContent = message;
}

export function createClientFreshnessController({
  windowRef = window,
  documentRef = document,
  navigatorRef = navigator,
  locationRef = window.location,
  fetchImpl = window.fetch.bind(window),
  serviceWorkerContainer = navigator?.serviceWorker,
  sessionStorageRef = window.sessionStorage,
  pendingWorkCheck = hasPendingCloudWork,
  reload = () => window.location.reload(),
  now = Date.now,
} = {}) {
  let cloudBackupRunning = false;
  let profileDirty = false;
  let deployedAsset = "";
  let announcedAsset = "";
  let notice = null;
  let checking = null;

  const onCloudBackupRunning = (event) => {
    cloudBackupRunning = Boolean(event?.detail?.running);
  };
  const onProfileDirty = (event) => {
    profileDirty = Boolean(event?.detail?.dirty);
  };

  const attemptReload = () => {
    if (!deployedAsset) return { status: "not_outdated", reloaded: false };
    const blockers = collectReloadBlockers({
      windowRef,
      cloudBackupRunning,
      profileDirty,
      pendingWorkCheck,
    });
    if (blockers.length) {
      setNoticeMessage(
        notice,
        "Update ready. Finish saving and syncing your current work, then choose Reload safely again."
      );
      return { status: "blocked", blockers, reloaded: false };
    }
    if (isReloadLoopProtected({ targetAsset: deployedAsset, storage: sessionStorageRef, now })) {
      setNoticeMessage(notice, "Update detected, but automatic repeat reload was stopped. Reload this tab manually when ready.");
      return { status: "loop_protected", reloaded: false };
    }
    writeReloadMarker(sessionStorageRef, { targetAsset: deployedAsset, at: now() });
    reload();
    return { status: "reloading", reloaded: true };
  };

  const checkNow = async () => {
    if (checking) return checking;
    checking = checkClientFreshness({ fetchImpl, documentRef, locationRef, navigatorRef, now })
      .then((result) => {
        if (result.status === "current") {
          deployedAsset = "";
          announcedAsset = "";
          notice?.remove?.();
          notice = null;
          removeReloadMarker(sessionStorageRef);
          return result;
        }
        if (result.status !== "outdated") return result;

        deployedAsset = result.deployedAsset;
        notice = ensureUpdateNotice({ documentRef, onReload: attemptReload });
        if (announcedAsset !== deployedAsset) {
          announcedAsset = deployedAsset;
          windowRef.dispatchEvent(new windowRef.CustomEvent(CLIENT_FRESHNESS_EVENT, {
            detail: {
              runningAsset: result.runningAsset,
              deployedAsset: result.deployedAsset,
            },
          }));
        }
        return result;
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  };

  const start = () => {
    windowRef.addEventListener(CLOUD_BACKUP_RUNNING_EVENT, onCloudBackupRunning);
    windowRef.addEventListener(PROFILE_DIRTY_EVENT, onProfileDirty);
    updateExistingEstiPaidServiceWorkers({ serviceWorkerContainer, locationRef });
    return checkNow();
  };

  const stop = () => {
    windowRef.removeEventListener(CLOUD_BACKUP_RUNNING_EVENT, onCloudBackupRunning);
    windowRef.removeEventListener(PROFILE_DIRTY_EVENT, onProfileDirty);
  };

  return { start, stop, checkNow, attemptReload };
}

export function startClientFreshnessMonitoring(options = {}) {
  const windowRef = options.windowRef || window;
  const documentRef = options.documentRef || document;
  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS;
  const controller = createClientFreshnessController({ ...options, windowRef, documentRef });

  const onOnline = () => controller.checkNow();
  const onVisibilityChange = () => {
    if (documentRef.visibilityState === "visible") controller.checkNow();
  };
  const onControllerChange = () => controller.checkNow();

  windowRef.addEventListener("online", onOnline);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  options.serviceWorkerContainer?.addEventListener?.("controllerchange", onControllerChange);
  const interval = windowRef.setInterval(() => controller.checkNow(), intervalMs);
  controller.start();

  return {
    checkNow: controller.checkNow,
    attemptReload: controller.attemptReload,
    stop() {
      windowRef.clearInterval(interval);
      windowRef.removeEventListener("online", onOnline);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      options.serviceWorkerContainer?.removeEventListener?.("controllerchange", onControllerChange);
      controller.stop();
    },
  };
}
