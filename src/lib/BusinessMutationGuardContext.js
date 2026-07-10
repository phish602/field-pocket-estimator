import { createContext, useCallback, useContext, useMemo } from "react";
import { ensureCurrentDeviceCanMutateBusinessData, getDeviceLockStoppedMessage } from "./supabaseDeviceLock";

const BusinessMutationGuardContext = createContext({
  canMutateBusinessDataSync: () => true,
  ensureCanMutateBusinessData: async () => ({ ok: true, offline: true }),
});

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
  storage = localStorage,
  children,
}) {
  const canMutateBusinessDataSync = useCallback(() => {
    if (!configured || !user?.id || !company?.id) return true;
    return !deviceLock?.isLocked;
  }, [company?.id, configured, deviceLock?.isLocked, user?.id]);

  const ensureCanMutateBusinessData = useCallback(async (reason = "local_save") => {
    // Preserve offline and no-workspace local use. Cloud device ownership has
    // no source of truth in either situation, so it must not falsely lock UI.
    if (!configured || !user?.id || !company?.id) {
      return { ok: true, offline: true, reason };
    }
    if (deviceLock?.isLocked) return blockedResult();

    return ensureCurrentDeviceCanMutateBusinessData({
      configured,
      user,
      company,
      storage,
      reason,
      claimIfMissing: false,
    });
  }, [company, configured, deviceLock?.isLocked, storage, user]);

  const value = useMemo(() => ({
    canMutateBusinessDataSync,
    ensureCanMutateBusinessData,
  }), [canMutateBusinessDataSync, ensureCanMutateBusinessData]);

  return <BusinessMutationGuardContext.Provider value={value}>{children}</BusinessMutationGuardContext.Provider>;
}

export function useBusinessMutationGuard() {
  return useContext(BusinessMutationGuardContext);
}
