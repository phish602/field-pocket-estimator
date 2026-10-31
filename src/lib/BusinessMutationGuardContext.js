import { createContext, useCallback, useContext, useMemo } from "react";
import { ensureCurrentDeviceCanMutateBusinessData, getDeviceLockStoppedMessage } from "./supabaseDeviceLock";
import {
  BROWSER_SURFACE_INACTIVE_CODE,
  BROWSER_SURFACE_INACTIVE_MESSAGE,
  isBrowserSurfaceActive,
} from "./browserSurfaceAuthority";

const BusinessMutationGuardContext = createContext({
  canMutateBusinessDataSync: () => true,
  ensureCanMutateBusinessData: async () => ({ ok: true, offline: true }),
});

// A browser takeover is NOT the physical device losing its lease: it is local,
// needs no network, and is undone by using this tab again. It therefore carries
// its own code and never sets deviceLockLost, which downstream cloud handling
// reads as a device-ownership event.
function browserSurfaceBlockedResult(reason) {
  return {
    ok: false,
    code: BROWSER_SURFACE_INACTIVE_CODE,
    reason,
    deviceLockLost: false,
    userMessage: BROWSER_SURFACE_INACTIVE_MESSAGE,
    error: BROWSER_SURFACE_INACTIVE_MESSAGE,
  };
}

function blockedResult() {
  return {
    ok: false,
    code: "device_locked",
    reason: "local_save",
    deviceLockLost: true,
    userMessage: getDeviceLockStoppedMessage("local_save"),
    error: getDeviceLockStoppedMessage("local_save"),
  };
}

export function BusinessMutationGuardProvider({
  configured = false,
  user = null,
  company = null,
  deviceLock = null,
  browserSurface = null,
  storage = localStorage,
  children,
}) {
  // Which BROWSER SURFACE may act, checked before any cloud/device question.
  // Unlike device ownership this is device-local, so it is provable offline and
  // is enforced there too. When App has not supplied the hook state, the module
  // answers directly: a document that never installed browser authority has no
  // arbitration to enforce, while a document that HAS installed it is enforced
  // strictly.
  const hasBrowserSurfaceAuthority = useCallback(() => (
    browserSurface
      ? browserSurface.ready === true && browserSurface.isActive === true
      : isBrowserSurfaceActive()
  ), [browserSurface]);

  // POSITIVE operational authority. "Not explicitly locked" was never proof:
  // loading, unresolved, error and inactive states must not pass.
  const hasOperationalAuthority = useCallback(() => Boolean(
    deviceLock
    && deviceLock.ready === true
    && deviceLock.loading !== true
    && deviceLock.isActive === true
    && deviceLock.isLocked === false
  ), [deviceLock]);

  const canMutateBusinessDataSync = useCallback(() => {
    // Browser authority first: an inactive tab may not write, online or offline.
    if (!hasBrowserSurfaceAuthority()) return false;
    // Preserve offline / signed-out / no-workspace local use exactly as before:
    // there is no cloud ownership to prove, so nothing may be gated on it.
    if (!configured || !user?.id || !company?.id) return true;
    return hasOperationalAuthority();
  }, [company?.id, configured, hasBrowserSurfaceAuthority, hasOperationalAuthority, user?.id]);

  const ensureCanMutateBusinessData = useCallback(async (reason = "local_save") => {
    if (!hasBrowserSurfaceAuthority()) return browserSurfaceBlockedResult(reason);
    // Preserve offline and no-workspace local use. Cloud device ownership has
    // no source of truth in either situation, so it must not falsely lock UI.
    if (!configured || !user?.id || !company?.id) {
      return { ok: true, offline: true, reason };
    }
    if (!hasOperationalAuthority()) return blockedResult();

    // The async boundary independently re-proves ownership against the shared
    // record, so a lease lost between render and save still fails closed.
    return ensureCurrentDeviceCanMutateBusinessData({
      configured,
      user,
      company,
      storage,
      reason,
      claimIfMissing: false,
    });
  }, [company, configured, hasBrowserSurfaceAuthority, hasOperationalAuthority, storage, user]);

  const value = useMemo(() => ({
    canMutateBusinessDataSync,
    ensureCanMutateBusinessData,
  }), [canMutateBusinessDataSync, ensureCanMutateBusinessData]);

  return <BusinessMutationGuardContext.Provider value={value}>{children}</BusinessMutationGuardContext.Provider>;
}

export function useBusinessMutationGuard() {
  return useContext(BusinessMutationGuardContext);
}
