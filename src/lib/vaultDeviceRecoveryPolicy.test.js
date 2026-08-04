import {
  VAULT_DEVICE_RECOVERY_ACTIONS,
  VAULT_DEVICE_RECOVERY_CODES,
  resolveVaultDeviceRecoveryPlan,
} from "./vaultDeviceRecoveryPolicy";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const WORKSPACE_TAG = "A".repeat(43);
const PROOF = "preview-proof-0123456789ABCDE";

function eligibleInput(overrides = {}) {
  return {
    identity: {
      userId: USER_ID,
      companyId: COMPANY_ID,
      workspaceTag: WORKSPACE_TAG,
    },
    capability: {
      state: "reset_required",
      code: "DEVICE_KEY_MISSING",
    },
    cloudPreview: {
      status: "eligible",
      eligible: true,
      noWritesPerformed: true,
      blockers: [],
      proof: PROOF,
    },
    deviceOwnership: {
      ok: true,
      active: true,
      userId: USER_ID,
      companyId: COMPANY_ID,
      localDeviceId: "device-1",
      activeDeviceId: "device-1",
    },
    confirmation: {
      accepted: true,
      workspaceTag: WORKSPACE_TAG,
      proof: PROOF,
    },
    ...overrides,
  };
}

function expectBlocked(result, code) {
  expect(result).toEqual({
    action: VAULT_DEVICE_RECOVERY_ACTIONS.BLOCK,
    code,
    destructive: false,
  });
  expect(Object.isFrozen(result)).toBe(true);
}

test("authorizes only the exact confirmed recovery snapshot", () => {
  const result = resolveVaultDeviceRecoveryPlan(eligibleInput());

  expect(result).toEqual({
    action: VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT,
    code: "",
    destructive: true,
  });
  expect(Object.isFrozen(result)).toBe(true);
});

test("accepts device-key mismatch as a recoverable reason", () => {
  const input = eligibleInput();
  input.capability.code = "DEVICE_KEY_MISMATCH";

  expect(resolveVaultDeviceRecoveryPlan(input).action)
    .toBe(VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT);
});

test("blocks an invalid workspace identity", () => {
  const input = eligibleInput();
  input.identity.workspaceTag = "invalid";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.IDENTITY_UNAVAILABLE
  );
});

test("blocks when recovery is not required", () => {
  const input = eligibleInput();
  input.capability.state = "locked";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.RECOVERY_NOT_REQUIRED
  );
});

test("blocks unsupported reset reasons", () => {
  const input = eligibleInput();
  input.capability.code = "RECORD_CORRUPT";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.RECOVERY_REASON_UNSUPPORTED
  );
});

test("requires a cloud preview", () => {
  const input = eligibleInput({ cloudPreview: null });

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_REQUIRED
  );
});

test("blocks an ineligible cloud restore", () => {
  const input = eligibleInput();
  input.cloudPreview.status = "no_cloud_data";
  input.cloudPreview.eligible = false;

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_RESTORE_INELIGIBLE
  );
});

test("requires the preview to prove that it performed no writes", () => {
  const input = eligibleInput();
  input.cloudPreview.noWritesPerformed = false;

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_NOT_READ_ONLY
  );
});

test("blocks any preview containing restore blockers", () => {
  const input = eligibleInput();
  input.cloudPreview.blockers = [{ code: "missing_restore_payload" }];

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_BLOCKED
  );
});

test("requires a valid opaque preview proof", () => {
  const input = eligibleInput();
  input.cloudPreview.proof = "short";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_PREVIEW_PROOF_INVALID
  );
});

test("requires an explicit device-ownership result", () => {
  const input = eligibleInput({ deviceOwnership: null });

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.DEVICE_OWNERSHIP_REQUIRED
  );
});

test("blocks ownership for a different user or company", () => {
  const input = eligibleInput();
  input.deviceOwnership.companyId = "company-2";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.DEVICE_IDENTITY_MISMATCH
  );
});

test("blocks when this browser is not the active device", () => {
  const input = eligibleInput();
  input.deviceOwnership.activeDeviceId = "device-2";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.DEVICE_NOT_ACTIVE
  );
});

test("returns review instead of authorizing an unconfirmed reset", () => {
  const input = eligibleInput();
  input.confirmation.accepted = false;

  expect(resolveVaultDeviceRecoveryPlan(input)).toEqual({
    action: VAULT_DEVICE_RECOVERY_ACTIONS.REVIEW,
    code: VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED,
    destructive: false,
  });
});

test("blocks confirmation for another workspace", () => {
  const input = eligibleInput();
  input.confirmation.workspaceTag = "B".repeat(43);

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_WORKSPACE_MISMATCH
  );
});

test("blocks confirmation when the preview proof changed", () => {
  const input = eligibleInput();
  input.confirmation.proof = "another-preview-proof-123456789";

  expectBlocked(
    resolveVaultDeviceRecoveryPlan(input),
    VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_STALE
  );
});

test("does not mutate any supplied recovery evidence", () => {
  const input = eligibleInput();
  const before = JSON.stringify(input);

  resolveVaultDeviceRecoveryPlan(input);

  expect(JSON.stringify(input)).toBe(before);
});
