/* global globalThis */

import {
  previewSupabaseCloudRestore,
} from "./supabaseCloudRestore";
import {
  ensureCurrentDeviceCanApplyLocalRestore,
} from "./supabaseDeviceLock";
import {
  executeCurrentDeviceRecoveryReset,
} from "./vaultDeviceRecoveryService";
import {
  VAULT_DEVICE_RECOVERY_ACTIONS,
  VAULT_DEVICE_RECOVERY_CODES,
  resolveVaultDeviceRecoveryPlan,
} from "./vaultDeviceRecoveryPolicy";
import {
  deriveWorkspaceVaultTag,
} from "./vaultSession";
import {
  VAULT_DEVICE_RECOVERY_LEASE_CODES,
  withVaultDeviceRecoveryLease,
} from "./vaultDeviceRecoveryLease";

export const VAULT_DEVICE_RECOVERY_COORDINATOR_STATES = Object.freeze({
  BLOCKED: "blocked",
  REVIEW: "review",
});

export const VAULT_DEVICE_RECOVERY_COORDINATOR_CODES = Object.freeze({
  PREPARATION_REQUIRED: "PREPARATION_REQUIRED",
  PREPARATION_EXPIRED: "PREPARATION_EXPIRED",
  PREPARATION_ALREADY_USED: "PREPARATION_ALREADY_USED",
  PREPARATION_FAILED: "PREPARATION_FAILED",
  IDENTITY_CHANGED: "IDENTITY_CHANGED",
  CAPABILITY_CHANGED: "CAPABILITY_CHANGED",
  PREVIEW_CHANGED: "PREVIEW_CHANGED",
  OWNERSHIP_CHANGED: "OWNERSHIP_CHANGED",
  EVIDENCE_REFRESH_FAILED: "EVIDENCE_REFRESH_FAILED",
  RESET_EXECUTION_FAILED: "RESET_EXECUTION_FAILED",
  RECOVERY_BUSY: "RECOVERY_BUSY",
  RECOVERY_LOCK_UNAVAILABLE: "RECOVERY_LOCK_UNAVAILABLE",
});

const PREPARATION_TTL_MS = 5 * 60 * 1000;
const PROOF = /^[A-Za-z0-9_-]{24,128}$/;
const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;

const preparedIntents = new Map();
const consumedProofs = new Map();

function asText(value) {
  return String(value || "").trim();
}

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined"
      ? localStorage
      : null;
  } catch {
    return null;
  }
}

function frozenPreparation({
  state,
  code = "",
  proof = "",
  expiresAt = "",
  cloudCounts = null,
  appBundleSummary = null,
} = {}) {
  return Object.freeze({
    state,
    code,
    proof,
    expiresAt,
    cloudCounts: cloudCounts
      ? Object.freeze({ ...cloudCounts })
      : null,
    appBundleSummary: appBundleSummary
      ? Object.freeze({ ...appBundleSummary })
      : null,
  });
}

function blockedPreparation(code) {
  return frozenPreparation({
    state: VAULT_DEVICE_RECOVERY_COORDINATOR_STATES.BLOCKED,
    code,
  });
}

function blockedExecution(code) {
  return Object.freeze({
    state: "blocked",
    code,
    destructive: false,
    deleted: false,
    deviceKeyRemoved: false,
    vaultCreated: false,
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (
    value
    && typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

function previewFingerprint(preview) {
  const blockers = Array.isArray(preview?.blockers)
    ? preview.blockers
      .map((blocker) => asText(blocker?.code))
      .filter(Boolean)
      .sort()
    : [];

  return JSON.stringify(canonicalize({
    restoreVersion: asText(preview?.restoreVersion),
    status: asText(preview?.status),
    eligible: preview?.eligible === true,
    partial: preview?.partial === true,
    noWritesPerformed: preview?.noWritesPerformed === true,
    cloudCounts: preview?.cloudCounts || null,
    localCounts: preview?.localCounts || null,
    blockers,
    appBundleAvailable: preview?.appBundleAvailable === true,
    appBundleSummary: preview?.appBundleSummary || null,
    recoveryEligibleForPartialLocalSnapshot:
      preview?.recoveryEligibleForPartialLocalSnapshot === true,
  }));
}

function buildDeviceOwnership(identity, verification) {
  const access = verification?.access || {};

  return {
    ok: verification?.ok === true,
    active: access?.isActive === true && access?.isLocked !== true,
    userId: asText(identity?.userId),
    companyId: asText(identity?.companyId),
    localDeviceId: asText(access?.localDeviceId),
    activeDeviceId: asText(
      access?.activeDeviceState?.activeDeviceId
    ),
  };
}

function ownershipFingerprint(ownership) {
  return JSON.stringify(canonicalize({
    ok: ownership?.ok === true,
    active: ownership?.active === true,
    localDeviceId: asText(ownership?.localDeviceId),
    activeDeviceId: asText(ownership?.activeDeviceId),
  }));
}

function capabilityFingerprint(capability) {
  return JSON.stringify({
    state: asText(capability?.state),
    code: asText(capability?.code),
  });
}

function createOpaqueProof() {
  const cryptoApi = globalThis?.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    const value = asText(cryptoApi.randomUUID());

    if (PROOF.test(value)) return value;
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);

    const value = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    if (PROOF.test(value)) return value;
  }

  throw new Error("Secure recovery proof generation is unavailable.");
}

function currentMilliseconds(clock) {
  const value = Number(clock());

  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new Error("Recovery clock is unavailable.");
  }

  return value;
}

function pruneExpiredEntries(now) {
  preparedIntents.forEach((intent, proof) => {
    if (Number(intent?.expiresAtMs || 0) <= now) {
      preparedIntents.delete(proof);
    }
  });

  consumedProofs.forEach((expiresAtMs, proof) => {
    if (Number(expiresAtMs || 0) <= now) {
      consumedProofs.delete(proof);
    }
  });
}

function buildDependencies(overrides) {
  const testOverrides = (
    process.env.NODE_ENV === "test"
    && overrides
    && typeof overrides === "object"
    && Object.getPrototypeOf(overrides) === Object.prototype
  )
    ? overrides
    : null;

  return Object.freeze({
    preview: testOverrides
      && typeof testOverrides.preview === "function"
      ? testOverrides.preview
      : (input) => previewSupabaseCloudRestore(input),

    verifyDevice: testOverrides
      && typeof testOverrides.verifyDevice === "function"
      ? testOverrides.verifyDevice
      : (input) => ensureCurrentDeviceCanApplyLocalRestore(input),

    deriveWorkspaceTag: testOverrides
      && typeof testOverrides.deriveWorkspaceTag === "function"
      ? testOverrides.deriveWorkspaceTag
      : ({ userId, companyId }) => (
        deriveWorkspaceVaultTag(userId, companyId)
      ),

    executeReset: testOverrides
      && typeof testOverrides.executeReset === "function"
      ? testOverrides.executeReset
      : (input) => executeCurrentDeviceRecoveryReset(input),

    createProof: testOverrides
      && typeof testOverrides.createProof === "function"
      ? testOverrides.createProof
      : createOpaqueProof,

    clock: testOverrides
      && typeof testOverrides.clock === "function"
      ? testOverrides.clock
      : Date.now,

    withRecoveryLease: testOverrides
      && typeof testOverrides.withRecoveryLease === "function"
      ? testOverrides.withRecoveryLease
      : withVaultDeviceRecoveryLease,
  });
}

export async function prepareCurrentDeviceRecovery({
  configured = false,
  user = null,
  company = null,
  capability = null,
  storage = defaultStorage(),
} = {}, overrides) {
  const dependencies = buildDependencies(overrides);
  const userId = asText(user?.id);
  const companyId = asText(company?.id);

  if (!configured || !userId || !companyId) {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE
    );
  }

  let workspaceTag;

  try {
    workspaceTag = asText(
      await dependencies.deriveWorkspaceTag({
        userId,
        companyId,
      })
    );
  } catch {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE
    );
  }

  if (!WORKSPACE_TAG.test(workspaceTag)) {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE
    );
  }

  const identity = {
    userId,
    companyId,
    workspaceTag,
  };

  let preview;

  try {
    preview = await dependencies.preview({
      storageSnapshot: storage,
      configured,
      user,
      company,
      allowPartialLocalSnapshot: false,
    });
  } catch {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
        .EVIDENCE_REFRESH_FAILED
    );
  }

  let proof;

  try {
    proof = asText(dependencies.createProof());

    if (!PROOF.test(proof)) {
      throw new Error("Invalid recovery proof.");
    }
  } catch {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_FAILED
    );
  }

  const cloudPreview = {
    ...(preview && typeof preview === "object" ? preview : {}),
    proof,
  };

  const preliminaryPlan = resolveVaultDeviceRecoveryPlan({
    identity,
    capability,
    cloudPreview,
    deviceOwnership: null,
    confirmation: null,
  });

  if (
    preliminaryPlan.action === VAULT_DEVICE_RECOVERY_ACTIONS.BLOCK
    && preliminaryPlan.code
      !== VAULT_DEVICE_RECOVERY_CODES.DEVICE_OWNERSHIP_REQUIRED
  ) {
    return blockedPreparation(preliminaryPlan.code);
  }

  let verification;

  try {
    verification = await dependencies.verifyDevice({
      configured,
      user,
      company,
      storage,
      reason: "prepare_device_key_recovery",
    });
  } catch {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
        .EVIDENCE_REFRESH_FAILED
    );
  }

  const deviceOwnership = buildDeviceOwnership(
    identity,
    verification
  );

  const plan = resolveVaultDeviceRecoveryPlan({
    identity,
    capability,
    cloudPreview,
    deviceOwnership,
    confirmation: null,
  });

  if (plan.action !== VAULT_DEVICE_RECOVERY_ACTIONS.REVIEW) {
    return blockedPreparation(plan.code);
  }

  let now;

  try {
    now = currentMilliseconds(dependencies.clock);
  } catch {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_FAILED
    );
  }

  pruneExpiredEntries(now);

  if (
    preparedIntents.has(proof)
    || consumedProofs.has(proof)
  ) {
    return blockedPreparation(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_FAILED
    );
  }

  const expiresAtMs = now + PREPARATION_TTL_MS;

  preparedIntents.set(proof, Object.freeze({
    proof,
    userId,
    companyId,
    workspaceTag,
    capabilityFingerprint: capabilityFingerprint(capability),
    previewFingerprint: previewFingerprint(preview),
    ownershipFingerprint: ownershipFingerprint(deviceOwnership),
    expiresAtMs,
  }));

  return frozenPreparation({
    state: VAULT_DEVICE_RECOVERY_COORDINATOR_STATES.REVIEW,
    code: VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED,
    proof,
    expiresAt: new Date(expiresAtMs).toISOString(),
    cloudCounts: preview?.cloudCounts || null,
    appBundleSummary: preview?.appBundleSummary || null,
  });
}

export async function executePreparedCurrentDeviceRecoveryReset({
  proof = "",
  accepted = false,
  configured = false,
  user = null,
  company = null,
  capability = null,
  storage = defaultStorage(),
} = {}, overrides) {
  const dependencies = buildDependencies(overrides);
  const normalizedProof = asText(proof);

  if (!PROOF.test(normalizedProof)) {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
        .PREPARATION_REQUIRED
    );
  }

  let now;

  try {
    now = currentMilliseconds(dependencies.clock);
  } catch {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_FAILED
    );
  }

  const intent = preparedIntents.get(normalizedProof);

  if (!intent) {
    return blockedExecution(
      consumedProofs.has(normalizedProof)
        ? VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
          .PREPARATION_ALREADY_USED
        : VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
          .PREPARATION_REQUIRED
    );
  }

  if (Number(intent.expiresAtMs || 0) <= now) {
    preparedIntents.delete(normalizedProof);
    consumedProofs.set(normalizedProof, now + PREPARATION_TTL_MS);

    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_EXPIRED
    );
  }

  if (accepted !== true) {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED
    );
  }

  const userId = asText(user?.id);
  const companyId = asText(company?.id);

  if (
    !configured
    || userId !== intent.userId
    || companyId !== intent.companyId
  ) {
    preparedIntents.delete(normalizedProof);
    consumedProofs.set(normalizedProof, intent.expiresAtMs);

    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED
    );
  }

  if (
    capabilityFingerprint(capability)
      !== intent.capabilityFingerprint
  ) {
    preparedIntents.delete(normalizedProof);
    consumedProofs.set(normalizedProof, intent.expiresAtMs);

    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.CAPABILITY_CHANGED
    );
  }

  let requestedWorkspaceTag;

  try {
    requestedWorkspaceTag = asText(
      await dependencies.deriveWorkspaceTag({
        userId,
        companyId,
      })
    );
  } catch {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
        .EVIDENCE_REFRESH_FAILED
    );
  }

  if (
    requestedWorkspaceTag !== intent.workspaceTag
    || !WORKSPACE_TAG.test(requestedWorkspaceTag)
  ) {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED
    );
  }

  try {
    const lease = await dependencies.withRecoveryLease({
      workspaceTag: requestedWorkspaceTag,
      operation: async () => {
        let workspaceTag;
        let preview;
        let verification;

        try {
          // Every authorization fact is refreshed after the exclusive lease is
          // held and before the executor can cross the destructive boundary.
          workspaceTag = asText(await dependencies.deriveWorkspaceTag({
            userId,
            companyId,
          }));
          preview = await dependencies.preview({
            storageSnapshot: storage,
            configured,
            user,
            company,
            allowPartialLocalSnapshot: false,
          });
          verification = await dependencies.verifyDevice({
            configured,
            user,
            company,
            storage,
            reason: "before_device_key_recovery_reset",
          });
        } catch {
          return blockedExecution(
            VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.EVIDENCE_REFRESH_FAILED
          );
        }

        if (workspaceTag !== intent.workspaceTag || !WORKSPACE_TAG.test(workspaceTag)) {
          return blockedExecution(
            VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED
          );
        }

        if (previewFingerprint(preview) !== intent.previewFingerprint) {
          return blockedExecution(
            VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREVIEW_CHANGED
          );
        }

        const identity = { userId, companyId, workspaceTag };
        const deviceOwnership = buildDeviceOwnership(identity, verification);
        if (ownershipFingerprint(deviceOwnership) !== intent.ownershipFingerprint) {
          return blockedExecution(
            VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED
          );
        }

        const cloudPreview = {
          ...(preview && typeof preview === "object" ? preview : {}),
          proof: normalizedProof,
        };
        const confirmation = {
          accepted: true,
          workspaceTag,
          proof: normalizedProof,
        };
        const finalPlan = resolveVaultDeviceRecoveryPlan({
          identity,
          capability,
          cloudPreview,
          deviceOwnership,
          confirmation,
        });

        if (finalPlan.action !== VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT) {
          return blockedExecution(finalPlan.code);
        }

        // A proof is consumed only by the held-lock execution that has passed
        // the final fresh authorization and is about to invoke local reset.
        preparedIntents.delete(normalizedProof);
        consumedProofs.set(normalizedProof, intent.expiresAtMs);

        try {
          const result = await dependencies.executeReset({
            identity,
            capability,
            cloudPreview,
            deviceOwnership,
            confirmation,
          });
          return result && typeof result === "object"
            ? result
            : blockedExecution(
              VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED
            );
        } catch {
          return blockedExecution(
            VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED
          );
        }
      },
    });

    if (!lease || lease.acquired !== true) {
      const code = lease?.code === VAULT_DEVICE_RECOVERY_LEASE_CODES.BUSY
        ? VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_BUSY
        : VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_LOCK_UNAVAILABLE;
      return blockedExecution(
        code
      );
    }
    return lease.value && typeof lease.value === "object"
      ? lease.value
      : blockedExecution(
        VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED
      );
  } catch {
    return blockedExecution(
      VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_LOCK_UNAVAILABLE
    );
  }
}

/**
 * Continues only an already-checkpointed local reset. It never creates an
 * initial destructive authorization: the executor rejects this path unless a
 * valid continuation checkpoint already exists.
 */
export async function resumeCurrentDeviceRecoveryReset({
  configured = false,
  user = null,
  company = null,
  capability = null,
  storage = defaultStorage(),
} = {}, overrides) {
  const dependencies = buildDependencies(overrides);
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  if (!configured || !userId || !companyId) {
    return blockedExecution(VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE);
  }

  let requestedWorkspaceTag;
  try {
    requestedWorkspaceTag = asText(await dependencies.deriveWorkspaceTag({
      userId,
      companyId,
    }));
  } catch {
    return blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.EVIDENCE_REFRESH_FAILED);
  }
  if (!WORKSPACE_TAG.test(requestedWorkspaceTag)) {
    return blockedExecution(VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE);
  }

  const lease = await dependencies.withRecoveryLease({
    workspaceTag: requestedWorkspaceTag,
    operation: async () => {
      let workspaceTag;
      let preview;
      let verification;
      let proof;
      try {
        workspaceTag = asText(await dependencies.deriveWorkspaceTag({ userId, companyId }));
        preview = await dependencies.preview({
          storageSnapshot: storage,
          configured,
          user,
          company,
          allowPartialLocalSnapshot: false,
        });
        verification = await dependencies.verifyDevice({
          configured,
          user,
          company,
          storage,
          reason: "resume_device_key_recovery",
        });
        proof = asText(dependencies.createProof());
      } catch {
        return blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.EVIDENCE_REFRESH_FAILED);
      }
      if (!WORKSPACE_TAG.test(workspaceTag) || workspaceTag !== requestedWorkspaceTag || !PROOF.test(proof)) {
        return blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED);
      }
      const identity = { userId, companyId, workspaceTag };
      const deviceOwnership = buildDeviceOwnership(identity, verification);
      const cloudPreview = {
        ...(preview && typeof preview === "object" ? preview : {}),
        proof,
      };
      const confirmation = { accepted: true, workspaceTag, proof };
      const plan = resolveVaultDeviceRecoveryPlan({
        identity,
        capability,
        cloudPreview,
        deviceOwnership,
        confirmation,
      });
      if (plan.action !== VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT) {
        return blockedExecution(plan.code);
      }
      try {
        const result = await dependencies.executeReset({
          identity,
          capability,
          cloudPreview,
          deviceOwnership,
          confirmation,
          continuation: true,
        });
        return result && typeof result === "object"
          ? result
          : blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED);
      } catch {
        return blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED);
      }
    },
  });

  if (!lease || lease.acquired !== true) {
    return blockedExecution(
      lease?.code === VAULT_DEVICE_RECOVERY_LEASE_CODES.BUSY
        ? VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_BUSY
        : VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_LOCK_UNAVAILABLE
    );
  }
  return lease.value && typeof lease.value === "object"
    ? lease.value
    : blockedExecution(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RESET_EXECUTION_FAILED);
}
