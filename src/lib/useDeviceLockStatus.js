import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkCurrentDeviceAccess,
  claimActiveDevice,
  DEVICE_LOCK_CHANGED_EVENT,
} from "./supabaseDeviceLock";

function buildIdleState() {
  return {
    loading: true,
    ready: false,
    status: "idle",
    isLocked: false,
    isActive: false,
    activeDeviceState: null,
    localDeviceId: "",
    localDeviceName: "This device",
    reason: "",
    error: "",
  };
}

export default function useDeviceLockStatus({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
  enabled = true,
} = {}) {
  const [state, setState] = useState(buildIdleState);
  const refreshPromiseRef = useRef(null);
  const mountedRef = useRef(false);

  const refresh = useCallback(async ({ claimIfMissing = true, heartbeatIfActive = true } = {}) => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    if (!enabled) {
      const idle = buildIdleState();
      const disabledState = { ...idle, ready: true };
      setState(disabledState);
      return disabledState;
    }

    setState((current) => ({
      ...current,
      loading: Boolean(configured && user?.id && company?.id),
    }));

    const pendingRefresh = (async () => {
      const next = await checkCurrentDeviceAccess({
        configured,
        user,
        company,
        storage,
        claimIfMissing,
        heartbeatIfActive,
      });

      if (mountedRef.current) {
        setState({
          loading: false,
          ...next,
        });
      }
      return next;
    })();

    refreshPromiseRef.current = pendingRefresh;

    try {
      return await pendingRefresh;
    } finally {
      if (refreshPromiseRef.current === pendingRefresh) {
        refreshPromiseRef.current = null;
      }
    }
  }, [company, configured, enabled, storage, user]);

  const takeover = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const result = await claimActiveDevice({
      configured,
      user,
      company,
      storage,
      force: true,
    });

    if (!result.ok) {
      const next = {
        ...buildIdleState(),
        loading: false,
        ready: true,
        status: "error",
        isLocked: true,
        isActive: false,
        activeDeviceState: result.activeDeviceState || null,
        localDeviceId: result.localDeviceId || "",
        localDeviceName: result.localDeviceName || "This device",
        error: result.error || "Unable to switch devices.",
      };
      setState(next);
      return { ok: false, state: next };
    }

    const next = await refresh({ claimIfMissing: false, heartbeatIfActive: false });
    return {
      ok: true,
      takeover: Boolean(result.takeover),
      state: next,
    };
  }, [company, configured, refresh, storage, user]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;

    refresh();

    const onVisibilityChange = () => {
      try {
        if (document.visibilityState !== "visible") return;
      } catch {
        return;
      }
      if (active) refresh();
    };

    const onDeviceLockChanged = () => {
      if (active) refresh({ claimIfMissing: false, heartbeatIfActive: false });
    };

    const onOnline = () => {
      if (active) refresh({ claimIfMissing: false, heartbeatIfActive: false });
    };

    const intervalId = setInterval(() => {
      if (active) refresh({ claimIfMissing: false, heartbeatIfActive: true });
    }, 30000);

    try {
      window.addEventListener("focus", onVisibilityChange);
      window.addEventListener("pageshow", onVisibilityChange);
      window.addEventListener("online", onOnline);
      window.addEventListener(DEVICE_LOCK_CHANGED_EVENT, onDeviceLockChanged);
      document.addEventListener("visibilitychange", onVisibilityChange);
    } catch {}

    return () => {
      active = false;
      mountedRef.current = false;
      clearInterval(intervalId);
      try {
        window.removeEventListener("focus", onVisibilityChange);
        window.removeEventListener("pageshow", onVisibilityChange);
        window.removeEventListener("online", onOnline);
        window.removeEventListener(DEVICE_LOCK_CHANGED_EVENT, onDeviceLockChanged);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      } catch {}
    };
  }, [refresh]);

  return {
    ...state,
    refresh,
    takeover,
  };
}
