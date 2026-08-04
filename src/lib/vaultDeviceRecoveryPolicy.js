export const VAULT_DEVICE_RECOVERY_ACTIONS = Object.freeze({
  BLOCK: "block",
  REVIEW: "review",
  RESET_LOCAL_VAULT: "reset_local_vault",
});

export const VAULT_DEVICE_RECOVERY_CODES = Object.freeze({
  IDENTITY_UNAVAILABLE: "IDENTITY_UNAVAILABLE",
  RECOVERY_NOT_REQUIRED: "RECOVERY_NOT_REQUIRED",
  RECOVERY_REASON_UNSUPPORTED: "RECOVERY_REASON_UNSUPPORTED",
  CLOUD_PREVIEW_REQUIRED: "CLOUD_PREVIEW_REQUIRED",
  CLOUD_RESTORE_INELIGIBLE: "CLOUD_RESTORE_INELIGIBLE",
  CLOUD_PREVIEW_NOT_READ_ONLY: "CLOUD_PREVIEW_NOT_READ_ONLY",
  CLOUD_PREVIEW_BLOCKED: "CLOUD_PREVIEW_BLOCKED",
  CLOUD_PREVIEW_PROOF_INVALID: "CLOUD_PREVIEW_PROOF_INVALID",
  DEVICE_OWNERSHIP_REQUIRED: "DEVICE_OWNERSHIP_REQUIRED",
  DEVICE_IDENTITY_MISMATCH: "DEVICE_IDENTITY_MISMATCH",
  DEVICE_NOT_ACTIVE: "DEVICE_NOT_ACTIVE",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  CONFIRMATION_STALE: "CONFIRMATION_STALE",
  CONFIRMATION_WORKSPACE_MISMATCH: "CONFIRMATION_WORKSPACE_MISMATCH",
});

const RECOVERABLE_CAPABILITY_CODES = new Set([
  "DEVICE_KEY_MISSING",
  "DEVICE_KEY_MISMATCH",
]);

const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
const PROOF = /^[A-Za-z0-9_-]{24,128}$/;

function asText(value) {
  return String(value || "").trim();
}

function frozenResult(action, code = "") {
  return Object.freeze({
    action,
    code,
    destructive: action === VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT,
  });
}

function block(code) {
  return frozenResult(VAULT_DEVICE_RECOVERY_ACTIONS.BLOCK, code);
}

function review() {
  return frozenResult(
    VAULT_DEVICE_RECOVERY_ACTIONS.REVIEW,
    VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED
  );
}

function identityIsValid(identity) {
  return Boolean(
    asText(identity?.userId)
    && asText(identity?.companyId)
    && WORKSPACE_TAG.test(asText(identity?.workspaceTag))
  );
}

function previewProofIsValid(value) {
  return PROOF.test(asText(value));
}

function ownershipMatches(identity, ownership) {
  const localDeviceId = asText(ownership?.localDeviceId);
  const activeDeviceId = asText(ownership?.activeDeviceId);

  return Boolean(
    ownership?.ok === true
    && ownership?.active === true
    && asText(ownership?.userId) === asText(identity?.userId)
    && asText(ownership?.companyId) === asText(identity?.companyId)
    && localDeviceId
    && activeDeviceId
    && localDeviceId === activeDeviceId
  );
}

/**
 * Pure authorization boundary for destructive device-key-loss recovery.
 *
 * This function performs no reads, writes, deletion, key generation, cloud
 * access, navigation, or event dispatch. It only decides whether an external
 * orchestrator may proceed to the workspace-local reset step.
 */
export function resolveVaultDeviceRecoveryPlan({
  identity = null,
  capability = null,
  cloudPreview = null,
  deviceOwnership = null,
  confirmation = null,
} = {}) {
  if (!identityIsValid(identity)) {
    return block(VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE);
  }

  if (asText(capability?.state) !== "reset_required") {
    return block(VAULT_DEVICE_RECOVERY_CODES.RECOVERY_NOT_REQUIRED);
  }

  if (!RECOVERABLE_CAPABILITY_CODES.has(asText(capability?.code))) {
    return block(VAULT_DEVICE_RECOVERY_CODES.RECOVERY_REASON_UNSUPPORTED);
  }

  if (!cloudPreview || typeof cloudPreview !== "object") {
    return block(VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_REQUIRED);
  }

  if (
    asText(cloudPreview.status) !== "eligible"
    || cloudPreview.eligible !== true
  ) {
    return block(VAULT_DEVICE_RECOVERY_CODES.CLOUD_RESTORE_INELIGIBLE);
  }

  if (cloudPreview.noWritesPerformed !== true) {
    return block(VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_NOT_READ_ONLY);
  }

  if (
    !Array.isArray(cloudPreview.blockers)
    || cloudPreview.blockers.length !== 0
  ) {
    return block(VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_BLOCKED);
  }

  if (!previewProofIsValid(cloudPreview.proof)) {
    return block(VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_PROOF_INVALID);
  }

  if (!deviceOwnership || typeof deviceOwnership !== "object") {
    return block(VAULT_DEVICE_RECOVERY_CODES.DEVICE_OWNERSHIP_REQUIRED);
  }

  if (
    asText(deviceOwnership.userId) !== asText(identity.userId)
    || asText(deviceOwnership.companyId) !== asText(identity.companyId)
  ) {
    return block(VAULT_DEVICE_RECOVERY_CODES.DEVICE_IDENTITY_MISMATCH);
  }

  if (!ownershipMatches(identity, deviceOwnership)) {
    return block(VAULT_DEVICE_RECOVERY_CODES.DEVICE_NOT_ACTIVE);
  }

  if (confirmation?.accepted !== true) {
    return review();
  }

  if (
    asText(confirmation.workspaceTag) !== asText(identity.workspaceTag)
  ) {
    return block(
      VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_WORKSPACE_MISMATCH
    );
  }

  if (
    !previewProofIsValid(confirmation.proof)
    || asText(confirmation.proof) !== asText(cloudPreview.proof)
  ) {
    return block(VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_STALE);
  }

  return frozenResult(
    VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT
  );
}
