import { useEffect, useRef } from "react";
import {
  DEFAULT_VAULT_IDLE_LOCK_MINUTES,
  VAULT_IDLE_LOCK_MINUTES,
} from "./vaultIdleLockSettings";

const MINUTE_MS = 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"];

function validMinutes(value) {
  return VAULT_IDLE_LOCK_MINUTES.includes(value)
    ? value
    : DEFAULT_VAULT_IDLE_LOCK_MINUTES;
}

// Keeps the deadline only in memory. It intentionally knows nothing about the
// vault runtime: expiration delegates exclusively to the supplied callback.
export default function useVaultIdleLock({ enabled = false, minutes, onLock } = {}) {
  const timerRef = useRef(null);
  const deadlineRef = useRef(null);
  const lockedRef = useRef(false);
  const onLockRef = useRef(onLock);

  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      clearTimer();
      deadlineRef.current = null;
      lockedRef.current = false;
      return undefined;
    }

    const durationMs = validMinutes(minutes) * MINUTE_MS;
    let disposed = false;

    const expire = () => {
      if (disposed || lockedRef.current) return;
      lockedRef.current = true;
      deadlineRef.current = null;
      clearTimer();
      if (typeof onLockRef.current === "function") onLockRef.current();
    };

    const schedule = () => {
      clearTimer();
      if (disposed || lockedRef.current || deadlineRef.current === null) return;
      const remaining = deadlineRef.current - Date.now();
      if (remaining <= 0) {
        expire();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (deadlineRef.current === null || Date.now() >= deadlineRef.current) expire();
        else schedule();
      }, remaining);
    };

    const evaluateThenReset = () => {
      if (lockedRef.current) return;
      if (deadlineRef.current !== null && Date.now() >= deadlineRef.current) {
        expire();
        return;
      }
      deadlineRef.current = Date.now() + durationMs;
      schedule();
    };

    const evaluateExistingDeadline = () => {
      if (lockedRef.current || deadlineRef.current === null) return;
      if (Date.now() >= deadlineRef.current) expire();
      else schedule();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") evaluateExistingDeadline();
    };

    lockedRef.current = false;
    deadlineRef.current = Date.now() + durationMs;
    schedule();
    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, evaluateThenReset));
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", evaluateExistingDeadline);

    return () => {
      disposed = true;
      clearTimer();
      deadlineRef.current = null;
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, evaluateThenReset));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", evaluateExistingDeadline);
    };
  }, [enabled, minutes]);
}
