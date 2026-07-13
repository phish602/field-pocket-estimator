// @ts-nocheck
/* eslint-disable */

import { useEffect, useRef } from "react";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } from "./supabaseCloudConvergence";
import { getOrCreateLocalDeviceId } from "./supabaseDeviceLock";

const asText = (value) => String(value || "").trim();
function online() { try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch { return true; } }

export default function useCloudAutoConvergence({ configured = false, user = null, company = null, deviceLock = null } = {}) {
  const attemptedRef = useRef(new Set());
  useEffect(() => {
    let disposed = false;
    const run = async () => {
      if (!configured || !user?.id || !company?.id || deviceLock?.isLocked || !online()) return;
      const queue = readCloudBackupQueueState();
      const attemptId = [company.id, user.id, getOrCreateLocalDeviceId(localStorage), Number(queue?.localMutationRevision || 0)].join(":");
      if (attemptedRef.current.has(attemptId) || disposed) return;
      attemptedRef.current.add(attemptId);
      const recovered = recoverInterruptedCloudConvergence({ storage: localStorage });
      if (!recovered.ok || disposed || !acquireCloudBackupRunLock()) return;
      try {
        await runSupabaseCloudConvergence({ storage: localStorage, configured, user, company });
      } finally {
        releaseCloudBackupRunLock();
      }
    };
    const timer = setTimeout(run, 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [configured, user?.id, company?.id, deviceLock?.isLocked]);
}
