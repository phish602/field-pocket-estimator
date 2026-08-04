import {
  VAULT_DEVICE_RECOVERY_COORDINATOR_CODES,
  VAULT_DEVICE_RECOVERY_COORDINATOR_STATES,
  executePreparedCurrentDeviceRecoveryReset,
  prepareCurrentDeviceRecovery,
  resumeCurrentDeviceRecoveryReset,
} from "./vaultDeviceRecoveryCoordinator";
import {
  VAULT_DEVICE_RECOVERY_CODES,
} from "./vaultDeviceRecoveryPolicy";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const WORKSPACE_TAG = "A".repeat(43);

let proofCounter = 0;

function nextProof() {
  proofCounter += 1;

  return `recovery-proof-${String(proofCounter).padStart(
    24,
    "0"
  )}`;
}

function capability() {
  return {
    state: "reset_required",
    code: "DEVICE_KEY_MISSING",
  };
}

function preview(overrides = {}) {
  return {
    restoreVersion: "supabase-cloud-restore-v1",
    status: "eligible",
    eligible: true,
    partial: false,
    cloudCounts: {
      customers: 1,
      projects: 1,
      estimates: 1,
      invoices: 1,
      invoice_payments: 0,
      estimate_line_items: 1,
      invoice_line_items: 1,
    },
    localCounts: {
      customers: 0,
      projects: 0,
      estimates: 0,
      invoices: 0,
    },
    blockers: [],
    notices: [],
    appBundleAvailable: true,
    appBundleSummary: {
      companyProfileCaptured: true,
      logoDataUrlCaptured: false,
      settingsCaptured: true,
      scopeTemplatesCaptured: true,
    },
    recoveryEligibleForPartialLocalSnapshot: false,
    noWritesPerformed: true,
    ...overrides,
  };
}

function deviceVerification(activeDeviceId = "device-1") {
  return {
    ok: true,
    code: "",
    deviceLockLost: false,
    access: {
      isActive: true,
      isLocked: false,
      status: "active",
      localDeviceId: "device-1",
      activeDeviceState: {
        activeDeviceId,
      },
    },
    error: "",
  };
}

function resetSuccess() {
  return {
    state: "ready_for_activation",
    code: "",
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: true,
    runtimeCatalogCreated: true,
  };
}

function dependencies(overrides = {}) {
  return {
    deriveWorkspaceTag: jest.fn()
      .mockResolvedValue(WORKSPACE_TAG),

    preview: jest.fn()
      .mockResolvedValue(preview()),

    verifyDevice: jest.fn()
      .mockResolvedValue(deviceVerification()),

    executeReset: jest.fn()
      .mockResolvedValue(resetSuccess()),

    createProof: jest.fn(() => nextProof()),

    clock: jest.fn(() => 1000),

    withRecoveryLease: jest.fn(async ({ operation }) => ({
      acquired: true,
      code: "",
      value: await operation(),
    })),

    ...overrides,
  };
}

function prepareInput(overrides = {}) {
  return {
    configured: true,
    user: {
      id: USER_ID,
      email: "user@example.com",
    },
    company: {
      id: COMPANY_ID,
      name: "Example Company",
    },
    capability: capability(),
    storage: {},
    ...overrides,
  };
}

function executeInput(proof, overrides = {}) {
  return {
    proof,
    accepted: true,
    configured: true,
    user: {
      id: USER_ID,
      email: "user@example.com",
    },
    company: {
      id: COMPANY_ID,
      name: "Example Company",
    },
    capability: capability(),
    storage: {},
    ...overrides,
  };
}

test("prepares a short-lived review without performing local reset", async () => {
  const local = dependencies();

  const result = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_STATES.REVIEW
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED
  );

  expect(result.proof).toMatch(
    /^[A-Za-z0-9_-]{24,128}$/
  );

  expect(result.expiresAt).toBe(
    new Date(301000).toISOString()
  );

  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.verifyDevice).toHaveBeenCalledTimes(1);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("refreshes cloud and device evidence before one local reset", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(result).toEqual(resetSuccess());

  expect(local.deriveWorkspaceTag).toHaveBeenCalledTimes(3);
  expect(local.preview).toHaveBeenCalledTimes(2);
  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
  expect(local.executeReset).toHaveBeenCalledTimes(1);

  const resetInput = local.executeReset.mock.calls[0][0];

  expect(resetInput.identity).toEqual({
    userId: USER_ID,
    companyId: COMPANY_ID,
    workspaceTag: WORKSPACE_TAG,
  });

  expect(resetInput.cloudPreview.proof)
    .toBe(prepared.proof);

  expect(resetInput.confirmation).toEqual({
    accepted: true,
    workspaceTag: WORKSPACE_TAG,
    proof: prepared.proof,
  });
});

test("ignores caller-supplied recovery evidence", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, {
      identity: {
        userId: "attacker",
        companyId: "attacker",
        workspaceTag: "B".repeat(43),
      },
      cloudPreview: {
        status: "eligible",
        eligible: true,
      },
      deviceOwnership: {
        ok: true,
        active: true,
      },
      confirmation: {
        accepted: true,
      },
      dependencies: {
        deleteWorkspaceVault: jest.fn(),
      },
    }),
    local
  );

  const resetInput = local.executeReset.mock.calls[0][0];

  expect(resetInput.identity.userId).toBe(USER_ID);
  expect(resetInput.identity.companyId).toBe(COMPANY_ID);
  expect(resetInput.identity.workspaceTag).toBe(WORKSPACE_TAG);
});

test("blocks without consuming the proof when cloud evidence changes", async () => {
  const local = dependencies({
    preview: jest.fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(preview({
        cloudCounts: {
          ...preview().cloudCounts,
          customers: 2,
        },
      })),
  });

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREVIEW_CHANGED
  );

  expect(local.executeReset).not.toHaveBeenCalled();

  const replay = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(replay.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREVIEW_CHANGED
  );
});

test("blocks when active-device ownership changes", async () => {
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerification("device-1"))
      .mockResolvedValueOnce(deviceVerification("device-2")),
  });

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED
  );

  expect(local.executeReset).not.toHaveBeenCalled();
});

test("blocks when the vault capability changed after review", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, {
      capability: {
        state: "unlocked",
        code: "",
      },
    }),
    local
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.CAPABILITY_CHANGED
  );

  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("blocks an expired proof before refreshing evidence", async () => {
  const local = dependencies({
    clock: jest.fn()
      .mockReturnValueOnce(1000)
      .mockReturnValue(301001),
  });

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.PREPARATION_EXPIRED
  );

  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("blocks when the authenticated workspace changes", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const result = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, {
      company: {
        id: "company-2",
      },
    }),
    local
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED
  );

  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("identity and capability revalidation failures retain the prepared proof", async () => {
  const local = dependencies();
  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);

  expect((await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, { company: { id: "company-2" } }),
    local
  )).code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.IDENTITY_CHANGED);

  expect((await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, { capability: { state: "unlocked", code: "" } }),
    local
  )).code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.CAPABILITY_CHANGED);

  expect(await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  )).toEqual(resetSuccess());
});

test("device verification failure retains the prepared proof", async () => {
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerification("device-1"))
      .mockResolvedValueOnce(deviceVerification("device-2"))
      .mockResolvedValueOnce(deviceVerification("device-1")),
  });
  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  expect((await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  )).code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  )).toEqual(resetSuccess());
});

test("an unaccepted review remains available for a later accepted click", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const declined = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof, {
      accepted: false,
    }),
    local
  );

  expect(declined.code).toBe(
    VAULT_DEVICE_RECOVERY_CODES.CONFIRMATION_REQUIRED
  );

  expect(local.executeReset).not.toHaveBeenCalled();

  const accepted = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(accepted).toEqual(resetSuccess());
  expect(local.executeReset).toHaveBeenCalledTimes(1);
});

test("a successful recovery proof cannot be replayed", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  const replay = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );

  expect(replay.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES
      .PREPARATION_ALREADY_USED
  );

  expect(local.executeReset).toHaveBeenCalledTimes(1);
});

test("an ineligible cloud preview never reaches device verification", async () => {
  const local = dependencies({
    preview: jest.fn().mockResolvedValue(
      preview({
        status: "no_cloud_data",
        eligible: false,
        cloudCounts: {
          customers: 0,
          projects: 0,
          estimates: 0,
          invoices: 0,
          invoice_payments: 0,
          estimate_line_items: 0,
          invoice_line_items: 0,
        },
      })
    ),
  });

  const result = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_STATES.BLOCKED
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_CODES.CLOUD_RESTORE_INELIGIBLE
  );

  expect(local.verifyDevice).not.toHaveBeenCalled();
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("public coordinator results expose no workspace identity", async () => {
  const local = dependencies();

  const prepared = await prepareCurrentDeviceRecovery(
    prepareInput(),
    local
  );

  const serialized = JSON.stringify(prepared);

  expect(serialized).not.toContain(USER_ID);
  expect(serialized).not.toContain(COMPANY_ID);
  expect(serialized).not.toContain(WORKSPACE_TAG);
  expect(prepared).not.toHaveProperty("identity");
  expect(prepared).not.toHaveProperty("deviceOwnership");
});

test("a busy cross-tab lease performs no reset and leaves the proof retryable", async () => {
  const local = dependencies({
    withRecoveryLease: jest.fn(async () => ({
      acquired: false,
      code: "RECOVERY_BUSY",
      value: null,
    })),
  });
  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);

  const busy = await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  );
  expect(busy.code).toBe(
    VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.RECOVERY_BUSY
  );
  expect(local.executeReset).not.toHaveBeenCalled();

  local.withRecoveryLease.mockImplementation(async ({ operation }) => ({
    acquired: true,
    code: "",
    value: await operation(),
  }));
  expect((await executePreparedCurrentDeviceRecoveryReset(
    executeInput(prepared.proof),
    local
  )).state).toBe("ready_for_activation");
  expect(local.executeReset).toHaveBeenCalledTimes(1);
});

test("final cloud and device refresh execute while the recovery lease is held", async () => {
  let held = false;
  const local = dependencies({
    withRecoveryLease: jest.fn(async ({ operation }) => {
      held = true;
      try {
        return { acquired: true, code: "", value: await operation() };
      } finally {
        held = false;
      }
    }),
    preview: jest.fn()
      .mockResolvedValueOnce(preview())
      .mockImplementationOnce(async () => {
        expect(held).toBe(true);
        return preview();
      }),
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerification())
      .mockImplementationOnce(async () => {
        expect(held).toBe(true);
        return deviceVerification();
      }),
  });
  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);
  expect(local.preview).toHaveBeenCalledTimes(2);
  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
});

test("continuation refreshes evidence under lease and cannot authorize an initial reset", async () => {
  let held = false;
  const local = dependencies({
    withRecoveryLease: jest.fn(async ({ operation }) => {
      held = true;
      try {
        return { acquired: true, code: "", value: await operation() };
      } finally {
        held = false;
      }
    }),
    preview: jest.fn(async () => {
      expect(held).toBe(true);
      return preview();
    }),
    verifyDevice: jest.fn(async () => {
      expect(held).toBe(true);
      return deviceVerification();
    }),
  });
  const result = await resumeCurrentDeviceRecoveryReset(
    prepareInput(),
    local
  );
  expect(result).toEqual(resetSuccess());
  expect(local.executeReset).toHaveBeenCalledWith(
    expect.objectContaining({ continuation: true })
  );
});
