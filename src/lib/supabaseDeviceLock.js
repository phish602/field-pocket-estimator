import { getSupabaseClient } from "./supabaseClient";
import { pauseCloudAutoBackup } from "./cloudBackupQueue";

export const DEVICE_LOCK_ROW_KEY = "active_device_lock";
export const DEVICE_LOCK_SCHEMA = "estipaid.device_lock";
export const DEVICE_LOCK_VERSION = 1;
export const LOCAL_DEVICE_ID_KEY = "estipaid-device-id-v1";
export const DEVICE_LOCK_CHANGED_EVENT = "estipaid:device-lock-changed";
export const DEVICE_LOCK_LOST_CODE = "device_lock_lost";
export const DEVICE_LOCKED_CODE = "device_locked";
export const DEVICE_LOCK_LOST_RESTORE_MESSAGE =
  "Recovery stopped because EstiPaid was switched to another device.";
export const DEVICE_LOCK_STOPPED_MESSAGES = {
  backup: "Backup stopped because EstiPaid was switched to another device.",
  restore: DEVICE_LOCK_LOST_RESTORE_MESSAGE,
  replace_cloud: "Cloud replace stopped because EstiPaid was switched to another device.",
  local_save: "Save stopped because EstiPaid was switched to another device.",
  cloud_write: "Cloud write stopped because EstiPaid was switched to another device.",
};

export const DEVICE_LOCK_EXPLANATION =
  "This device is locked because EstiPaid is active on another device. To unlock it, switch EstiPaid to this device. The other device will be locked, and you should restore the latest cloud backup here before working.";

export const DEVICE_LOCK_POST_SWITCH_WARNING =
  "For the safest setup, restore the latest cloud backup before creating or editing estimates and invoices.";

function asText(value) {
  return String(value || "").trim();
}

export function getDeviceLockStoppedMessage(reason = "cloud_write") {
  return DEVICE_LOCK_STOPPED_MESSAGES[asText(reason)] || DEVICE_LOCK_STOPPED_MESSAGES.cloud_write;
}

function asIsoString(value) {
  const raw = asText(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function buildRowId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `device_lock_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function getNavigatorBrand() {
  try {
    const uaDataBrands = Array.isArray(navigator?.userAgentData?.brands)
      ? navigator.userAgentData.brands
      : [];
    const preferredBrand = uaDataBrands.find((entry) => !/not.?a.?brand/i.test(asText(entry?.brand)));
    if (preferredBrand) return asText(preferredBrand.brand);
  } catch {}

  const ua = asText(typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return "Safari";
  if (/firefox\//i.test(ua)) return "Firefox";
  return "";
}

function getNavigatorPlatform() {
  try {
    const platform = asText(navigator?.userAgentData?.platform || navigator?.platform);
    if (!platform) return "";
    if (/mac/i.test(platform)) return "Mac";
    if (/iphone|ipad|ios/i.test(platform)) return "iPhone";
    if (/android/i.test(platform)) return "Android";
    if (/win/i.test(platform)) return "Windows";
    if (/linux/i.test(platform)) return "Linux";
    return platform;
  } catch {
    return "";
  }
}

function normalizeDeviceLockValue(value) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const activeDeviceId = asText(payload.activeDeviceId);
  const activeDeviceName = asText(payload.activeDeviceName) || "This device";
  const activeDeviceUserAgent = asText(payload.activeDeviceUserAgent);
  const activeDeviceLastSeenAt = asIsoString(payload.activeDeviceLastSeenAt);
  const activeDeviceClaimedAt = asIsoString(payload.activeDeviceClaimedAt);
  const activeDeviceRevokedAt = asIsoString(payload.activeDeviceRevokedAt);
  const activeUserId = asText(payload.activeUserId);
  const activeUserEmail = asText(payload.activeUserEmail);
  const lockVersion = Number.isFinite(Number(payload.lockVersion))
    ? Number(payload.lockVersion)
    : 1;

  return {
    schema: DEVICE_LOCK_SCHEMA,
    version: DEVICE_LOCK_VERSION,
    activeDeviceId,
    activeDeviceName,
    activeDeviceUserAgent,
    activeDeviceLastSeenAt,
    activeDeviceClaimedAt,
    activeDeviceRevokedAt,
    activeUserId,
    activeUserEmail,
    lockVersion,
  };
}

function buildDeviceLockValue({ deviceId, deviceName, userId, userEmail, previousValue = null } = {}) {
  const now = new Date().toISOString();
  const previous = normalizeDeviceLockValue(previousValue);
  const sameDevice = asText(previous.activeDeviceId) === asText(deviceId);
  const nextLockVersion = sameDevice
    ? Number(previous.lockVersion || 1)
    : Number(previous.lockVersion || 0) + 1;
  return {
    schema: DEVICE_LOCK_SCHEMA,
    version: DEVICE_LOCK_VERSION,
    activeDeviceId: asText(deviceId),
    activeDeviceName: asText(deviceName) || "This device",
    activeDeviceUserAgent: asText(typeof navigator !== "undefined" ? navigator.userAgent : ""),
    activeDeviceLastSeenAt: now,
    activeDeviceClaimedAt: sameDevice ? asText(previous.activeDeviceClaimedAt) || now : now,
    activeDeviceRevokedAt: "",
    activeUserId: asText(userId),
    activeUserEmail: asText(userEmail),
    lockVersion: nextLockVersion > 0 ? nextLockVersion : 1,
  };
}

function readFromStorage(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeToStorage(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

async function readDeviceLockRows(client, companyId) {
  try {
    const response = await client
      .from("app_settings")
      .select("id, setting_value")
      .eq("company_id", companyId)
      .eq("setting_scope", "company")
      .eq("setting_key", DEVICE_LOCK_ROW_KEY);

    if (response?.error) {
      return { rows: null, error: response.error };
    }

    return { rows: Array.isArray(response?.data) ? response.data : [], error: null };
  } catch (error) {
    return { rows: null, error };
  }
}

export function dispatchDeviceLockChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(DEVICE_LOCK_CHANGED_EVENT, { detail }));
  } catch {}
}

export function getCurrentDeviceLabel() {
  const browser = getNavigatorBrand();
  const platform = getNavigatorPlatform();
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return `Browser on ${platform}`;
  return "This device";
}

export function getOrCreateLocalDeviceId(storage = localStorage) {
  const existing = asText(readFromStorage(storage, LOCAL_DEVICE_ID_KEY));
  if (existing) return existing;

  const nextId = buildRowId();
  writeToStorage(storage, LOCAL_DEVICE_ID_KEY, nextId);
  return asText(readFromStorage(storage, LOCAL_DEVICE_ID_KEY)) || nextId;
}

export async function readActiveDeviceState({
  client = getSupabaseClient(),
  companyId = "",
} = {}) {
  const normalizedCompanyId = asText(companyId);
  if (!client?.from || !normalizedCompanyId) {
    return {
      ok: false,
      row: null,
      value: null,
      error: "Missing device-lock prerequisites.",
    };
  }

  const { rows, error } = await readDeviceLockRows(client, normalizedCompanyId);
  if (error) {
    return {
      ok: false,
      row: null,
      value: null,
      error: asText(error?.message) || "Unable to read active device state.",
    };
  }

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return {
    ok: true,
    row,
    value: row ? normalizeDeviceLockValue(row.setting_value) : null,
    duplicateRows: Array.isArray(rows) ? rows.length > 1 : false,
    error: Array.isArray(rows) && rows.length > 1
      ? "Multiple active-device rows were found for this workspace."
      : "",
  };
}

async function writeActiveDeviceState({
  client = getSupabaseClient(),
  companyId = "",
  userId = "",
  userEmail = "",
  rowId = "",
  previousValue = null,
  deviceId = "",
  deviceName = "",
} = {}) {
  const normalizedCompanyId = asText(companyId);
  const normalizedUserId = asText(userId);
  const normalizedDeviceId = asText(deviceId);
  if (!client?.from || !normalizedCompanyId || !normalizedUserId || !normalizedDeviceId) {
    return {
      ok: false,
      row: null,
      value: null,
      error: "Missing device-lock write prerequisites.",
    };
  }

  const payload = buildDeviceLockValue({
    deviceId: normalizedDeviceId,
    deviceName,
    userId: normalizedUserId,
    userEmail,
    previousValue,
  });
  const timestamp = new Date().toISOString();

  try {
    if (asText(rowId)) {
      const response = await client
        .from("app_settings")
        .update({
          setting_value: payload,
          updated_at: timestamp,
          updated_by: normalizedUserId,
        })
        .eq("id", asText(rowId))
        .eq("company_id", normalizedCompanyId)
        .select("id, setting_value");

      if (response?.error) {
        return {
          ok: false,
          row: null,
          value: null,
          error: asText(response.error?.message) || "Unable to update active device state.",
        };
      }

      return {
        ok: true,
        row: Array.isArray(response?.data) ? response.data[0] || null : null,
        value: payload,
        action: "updated",
      };
    }

    const response = await client
      .from("app_settings")
      .insert({
        id: buildRowId(),
        company_id: normalizedCompanyId,
        user_id: null,
        setting_scope: "company",
        setting_key: DEVICE_LOCK_ROW_KEY,
        setting_value: payload,
        legacy_local_id: DEVICE_LOCK_ROW_KEY,
        created_by: normalizedUserId,
        updated_by: normalizedUserId,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select("id, setting_value");

    if (response?.error) {
      return {
        ok: false,
        row: null,
        value: null,
        error: asText(response.error?.message) || "Unable to create active device state.",
      };
    }

    return {
      ok: true,
      row: Array.isArray(response?.data) ? response.data[0] || null : null,
      value: payload,
      action: "inserted",
    };
  } catch (error) {
    return {
      ok: false,
      row: null,
      value: null,
      error: asText(error?.message) || "Unable to store active device state.",
    };
  }
}

export async function claimActiveDevice({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
  force = false,
} = {}) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  const userEmail = asText(user?.email);

  if (!configured || !userId) {
    return {
      ok: false,
      claimed: false,
      error: "Sign in before switching devices.",
    };
  }

  if (!companyId) {
    return {
      ok: false,
      claimed: false,
      error: "Create or join a cloud workspace before switching devices.",
    };
  }

  const client = getSupabaseClient();
  if (!client?.from) {
    return {
      ok: false,
      claimed: false,
      error: "Supabase is not configured.",
    };
  }

  const deviceId = getOrCreateLocalDeviceId(storage);
  const deviceName = getCurrentDeviceLabel();
  const readResult = await readActiveDeviceState({ client, companyId });
  if (!readResult.ok) {
    return {
      ok: false,
      claimed: false,
      error: readResult.error,
    };
  }

  if (readResult.duplicateRows) {
    return {
      ok: false,
      claimed: false,
      error: readResult.error,
    };
  }

  const activeDeviceId = asText(readResult.value?.activeDeviceId);
  if (activeDeviceId && activeDeviceId !== deviceId && !force) {
    return {
      ok: false,
      claimed: false,
      lockedByOtherDevice: true,
      error: "This workspace is active on another device.",
      activeDeviceState: readResult.value,
      localDeviceId: deviceId,
      localDeviceName: deviceName,
    };
  }

  const writeResult = await writeActiveDeviceState({
    client,
    companyId,
    userId,
    userEmail,
    rowId: asText(readResult.row?.id),
    previousValue: readResult.value,
    deviceId,
    deviceName,
  });

  if (!writeResult.ok) {
    return {
      ok: false,
      claimed: false,
      error: writeResult.error,
      localDeviceId: deviceId,
      localDeviceName: deviceName,
    };
  }

  dispatchDeviceLockChanged({
    companyId,
    activeDeviceId: deviceId,
    action: force && activeDeviceId && activeDeviceId !== deviceId ? "takeover" : "claim",
  });

  if (force && activeDeviceId && activeDeviceId !== deviceId) {
    pauseCloudAutoBackup("device_takeover");
  }

  return {
    ok: true,
    claimed: true,
    takeover: Boolean(force && activeDeviceId && activeDeviceId !== deviceId),
    activeDeviceState: writeResult.value,
    localDeviceId: deviceId,
    localDeviceName: deviceName,
  };
}

export async function heartbeatActiveDevice({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
} = {}) {
  const deviceId = getOrCreateLocalDeviceId(storage);
  const readResult = await readActiveDeviceState({
    client: getSupabaseClient(),
    companyId: asText(company?.id),
  });

  if (!readResult.ok || !readResult.value || asText(readResult.value.activeDeviceId) !== deviceId) {
    return {
      ok: false,
      active: false,
      activeDeviceState: readResult.value || null,
      error: readResult.error || "This device is not active.",
    };
  }

  const writeResult = await writeActiveDeviceState({
    companyId: asText(company?.id),
    userId: asText(user?.id),
    userEmail: asText(user?.email),
    rowId: asText(readResult.row?.id),
    previousValue: readResult.value,
    deviceId,
    deviceName: getCurrentDeviceLabel(),
  });

  return {
    ok: Boolean(writeResult.ok),
    active: Boolean(writeResult.ok),
    activeDeviceState: writeResult.value,
    error: writeResult.error || "",
  };
}

export async function checkCurrentDeviceAccess({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
  claimIfMissing = true,
  heartbeatIfActive = true,
} = {}) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  const client = getSupabaseClient();
  const localDeviceId = getOrCreateLocalDeviceId(storage);
  const localDeviceName = getCurrentDeviceLabel();

  if (!configured || !userId) {
    return {
      ready: true,
      status: "signed_out",
      isLocked: false,
      isActive: false,
      localDeviceId,
      localDeviceName,
      activeDeviceState: null,
      reason: "",
      error: "",
    };
  }

  if (!companyId || !client?.from) {
    return {
      ready: true,
      status: "no_workspace",
      isLocked: false,
      isActive: false,
      localDeviceId,
      localDeviceName,
      activeDeviceState: null,
      reason: "",
      error: "",
    };
  }

  const readResult = await readActiveDeviceState({ client, companyId });
  if (!readResult.ok) {
    return {
      ready: true,
      status: "error",
      isLocked: false,
      isActive: false,
      localDeviceId,
      localDeviceName,
      activeDeviceState: null,
      reason: "",
      error: readResult.error,
    };
  }

  if (readResult.duplicateRows) {
    return {
      ready: true,
      status: "error",
      isLocked: true,
      isActive: false,
      localDeviceId,
      localDeviceName,
      activeDeviceState: readResult.value,
      reason: DEVICE_LOCK_EXPLANATION,
      error: readResult.error,
    };
  }

  if (!readResult.value?.activeDeviceId) {
    if (!claimIfMissing) {
      return {
        ready: true,
        status: "available",
        isLocked: false,
        isActive: false,
        localDeviceId,
        localDeviceName,
        activeDeviceState: null,
        reason: "",
        error: "",
      };
    }

    return claimActiveDevice({
      configured,
      user,
      company,
      storage,
      force: false,
    }).then((result) => ({
      ready: true,
      status: result.ok ? "active" : "error",
      isLocked: false,
      isActive: Boolean(result.ok),
      localDeviceId,
      localDeviceName,
      activeDeviceState: result.activeDeviceState || null,
      reason: "",
      error: result.error || "",
    }));
  }

  if (asText(readResult.value.activeDeviceId) === localDeviceId) {
    if (heartbeatIfActive) {
      const heartbeatResult = await heartbeatActiveDevice({
        configured,
        user,
        company,
        storage,
      });
      const latestActiveDeviceId = asText(heartbeatResult.activeDeviceState?.activeDeviceId);
      if (!heartbeatResult.ok && latestActiveDeviceId && latestActiveDeviceId !== localDeviceId) {
        return {
          ready: true,
          status: "locked",
          isLocked: true,
          isActive: false,
          localDeviceId,
          localDeviceName,
          activeDeviceState: heartbeatResult.activeDeviceState || readResult.value,
          reason: DEVICE_LOCK_EXPLANATION,
          error: "",
        };
      }
      return {
        ready: true,
        status: heartbeatResult.ok ? "active" : "error",
        isLocked: false,
        isActive: Boolean(heartbeatResult.ok),
        localDeviceId,
        localDeviceName,
        activeDeviceState: heartbeatResult.activeDeviceState || readResult.value,
        reason: "",
        error: heartbeatResult.error || "",
      };
    }

    return {
      ready: true,
      status: "active",
      isLocked: false,
      isActive: true,
      localDeviceId,
      localDeviceName,
      activeDeviceState: readResult.value,
      reason: "",
      error: "",
    };
  }

  return {
    ready: true,
    status: "locked",
    isLocked: true,
    isActive: false,
    localDeviceId,
    localDeviceName,
    activeDeviceState: readResult.value,
    reason: DEVICE_LOCK_EXPLANATION,
    error: "",
  };
}

export async function ensureCurrentDeviceCanWriteCloud({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
  reason = "cloud_write",
  claimIfMissing = true,
} = {}) {
  const access = await checkCurrentDeviceAccess({
    configured,
    user,
    company,
    storage,
    claimIfMissing,
    heartbeatIfActive: false,
  });

  if (access.isLocked || !access.isActive) {
    const normalizedReason = asText(reason) || "cloud_write";
    const deviceLockLost = Boolean(access.isLocked || access.status === "locked");
    if (deviceLockLost) pauseCloudAutoBackup("device_lock_lost_during_mutation");
    dispatchDeviceLockChanged({
      companyId: asText(company?.id),
      activeDeviceId: asText(access.activeDeviceState?.activeDeviceId),
      action: "write_blocked",
      reason: normalizedReason,
      locked: true,
    });
    return {
      ok: false,
      access,
      code: deviceLockLost ? DEVICE_LOCK_LOST_CODE : DEVICE_LOCKED_CODE,
      reason: normalizedReason,
      deviceLockLost,
      userMessage: deviceLockLost
        ? getDeviceLockStoppedMessage(normalizedReason)
        : "Unable to verify that this device is active before writing cloud data.",
      error: deviceLockLost
        ? getDeviceLockStoppedMessage(normalizedReason)
        : "Unable to verify that this device is active before writing cloud data.",
    };
  }

  return {
    ok: true,
    access,
    code: "",
    reason: asText(reason) || "cloud_write",
    deviceLockLost: false,
    userMessage: "",
    error: "",
  };
}

// Restore must never claim an unowned device while it is mid-flight. Each
// call is a fresh active-device read and only confirms present ownership.
export async function ensureCurrentDeviceCanApplyLocalRestore({
  configured = false,
  user = null,
  company = null,
  storage = localStorage,
  reason = "restore",
} = {}) {
  const access = await checkCurrentDeviceAccess({
    configured,
    user,
    company,
    storage,
    claimIfMissing: false,
    heartbeatIfActive: false,
  });

  if (access.isLocked || access.status === "locked") {
    // A stale auto-backup worker must stay paused while the app shell catches
    // up to the lock-loss event.
    pauseCloudAutoBackup("device_lock_lost_during_restore");
    dispatchDeviceLockChanged({
      companyId: asText(company?.id),
      activeDeviceId: asText(access.activeDeviceState?.activeDeviceId),
      action: "restore_blocked",
      reason: asText(reason) || "restore",
      locked: true,
    });
    return {
      ok: false,
      code: DEVICE_LOCK_LOST_CODE,
      deviceLockLost: true,
      access,
      reason: asText(reason) || "restore",
      userMessage: getDeviceLockStoppedMessage(reason),
      error: getDeviceLockStoppedMessage(reason),
    };
  }

  if (!access.isActive) {
    return {
      ok: false,
      code: "device_access_unverified",
      deviceLockLost: false,
      access,
      error: access.error || "Unable to verify that this device is still active before applying restore data.",
    };
  }

  return { ok: true, code: "", deviceLockLost: false, access, error: "" };
}
