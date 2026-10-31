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
  // Three ownership reads: prepare, under-lease refresh, and the commit-boundary
  // re-proof taken after the async snapshot step and before the reset itself.
  expect(local.verifyDevice).toHaveBeenCalledTimes(3);
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
      // prepare, first execution's refresh (a different device, so blocked),
      // then the second execution's refresh AND its commit-boundary re-proof.
      .mockResolvedValueOnce(deviceVerification("device-1"))
      .mockResolvedValueOnce(deviceVerification("device-2"))
      .mockResolvedValueOnce(deviceVerification("device-1"))
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
      })
      // The commit-boundary re-proof must also happen under the held lease.
      .mockImplementationOnce(async () => {
        expect(held).toBe(true);
        return deviceVerification();
      }),
  });
  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);
  expect(local.preview).toHaveBeenCalledTimes(2);
  // Prepare, under-lease refresh, and the commit-boundary re-proof.
  expect(local.verifyDevice).toHaveBeenCalledTimes(3);
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
    // A production-authorized device always carries its lease generation, and
    // the continuation commit boundary now requires one. Every call asserts the
    // lease is held, so this also proves the commit-boundary proof is taken
    // inside the recovery lease.
    verifyDevice: jest.fn(async () => {
      expect(held).toBe(true);
      return deviceVerificationAt(5);
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

// START-FENCE: the ownership fingerprint compared before the destructive vault
// reset described WHICH device owned the workspace, not WHICH GENERATION. That
// makes A(v5) -> B(v6) -> A(v7) fingerprint-identical to A(v5): the reset would
// still run, against a workspace the newer generation has already touched.
// Wiping the local vault is unrecoverable, so the generation is now part of the
// fingerprint AND re-proved immediately before the reset call.
function deviceVerificationAt(lockVersion, activeDeviceId = "device-1") {
  return {
    ok: true,
    code: "",
    deviceLockLost: false,
    access: {
      isActive: true,
      isLocked: false,
      status: "active",
      localDeviceId: "device-1",
      activeDeviceState: { activeDeviceId, lockVersion },
      fence: { companyId: "company-1", deviceId: activeDeviceId, lockVersion },
    },
    error: "",
  };
}

test("recovery START fence: a same-owner heartbeat keeps the same generation and still resets", async () => {
  // A heartbeat by the current owner does not advance lockVersion.
  const local = dependencies({
    verifyDevice: jest.fn().mockResolvedValue(deviceVerificationAt(5)),
  });

  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  const result = await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);

  expect(result).toEqual(resetSuccess());
  expect(local.executeReset).toHaveBeenCalledTimes(1);
});

test("recovery START fence: A(v5) -> B(v6) -> A(v7) cannot reset the local vault", async () => {
  // Same device id at both reads -- only the generation differs, which is
  // exactly what the old fingerprint could not see.
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(7)),
  });

  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  const result = await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);

  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  // FORBIDDEN: the unrecoverable local wipe.
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("recovery START fence: a generation change after the snapshot step still blocks the reset", async () => {
  // The under-lease refresh agrees, so the run reaches the snapshot/preview
  // step and would previously have gone straight into executeReset. The
  // commit-boundary re-proof is the only thing that stops it.
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(7)),
  });

  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  const result = await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);

  // It genuinely reached the boundary: the third ownership read happened.
  expect(local.verifyDevice).toHaveBeenCalledTimes(3);
  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("recovery START fence: a takeover by another device cannot reset the local vault", async () => {
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(6, "device-2")),
  });

  const prepared = await prepareCurrentDeviceRecovery(prepareInput(), local);
  const result = await executePreparedCurrentDeviceRecoveryReset(executeInput(prepared.proof), local);

  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(local.executeReset).not.toHaveBeenCalled();
});

// START-FENCE (continuation): resumeCurrentDeviceRecoveryReset awaits either
// prepareFinalSnapshot or the preview fallback AFTER its initial device
// authorization, then calls the second destructive executeReset. Without a
// re-proof at that boundary, A(v5) -> B(v6) -> A(v7) reaches the wipe with an
// ownership object describing an operation that no longer owns the workspace.
// Both evidence branches converge on one guard, so these prove that guard.
function resumeSnapshot() {
  return { ok: true, code: "", authorizationPreview: preview() };
}

test("continuation START fence: a stable generation reaches the reset exactly once", async () => {
  const local = dependencies({
    verifyDevice: jest.fn().mockResolvedValue(deviceVerificationAt(5)),
  });

  const result = await resumeCurrentDeviceRecoveryReset(prepareInput(), local);

  expect(result).toEqual(resetSuccess());
  // The async continuation evidence step ran, and so did the commit-boundary
  // proof after it -- two ownership reads, one reset.
  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
  expect(local.executeReset).toHaveBeenCalledTimes(1);
});

test("continuation START fence: A(v5) -> B(v6) -> A(v7) never invokes executeReset", async () => {
  // Same device id at both reads. Only the generation differs, which is exactly
  // what an ownership check without lockVersion cannot see.
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(7)),
  });

  const result = await resumeCurrentDeviceRecoveryReset(prepareInput(), local);

  // It genuinely reached the post-await commit boundary.
  expect(local.preview).toHaveBeenCalledTimes(1);
  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  // FORBIDDEN: the unrecoverable local vault wipe.
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("continuation START fence: a takeover by another device never invokes executeReset", async () => {
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(6, "device-2")),
  });

  const result = await resumeCurrentDeviceRecoveryReset(prepareInput(), local);

  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("continuation START fence: an unprovable generation fails closed", async () => {
  // Ownership that carries no lockVersion proves nothing about the generation.
  // Matching absence against absence must not read as continuous ownership.
  const local = dependencies({
    verifyDevice: jest.fn().mockResolvedValue(deviceVerification()),
  });

  const result = await resumeCurrentDeviceRecoveryReset(prepareInput(), local);

  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("continuation START fence: the prepareFinalSnapshot branch passes through the same guard", async () => {
  // The other evidence branch. prepareFinalSnapshot replaces the preview call
  // entirely, so proving preview was never used proves this test took that
  // branch -- and it is stopped by the same commit-boundary proof.
  const prepareFinalSnapshot = jest.fn(async () => resumeSnapshot());
  const local = dependencies({
    verifyDevice: jest.fn()
      .mockResolvedValueOnce(deviceVerificationAt(5))
      .mockResolvedValue(deviceVerificationAt(7)),
  });

  const result = await resumeCurrentDeviceRecoveryReset(
    prepareInput({ prepareFinalSnapshot }),
    local
  );

  expect(prepareFinalSnapshot).toHaveBeenCalledTimes(1);
  expect(local.preview).not.toHaveBeenCalled();
  expect(local.verifyDevice).toHaveBeenCalledTimes(2);
  expect(result.code).toBe(VAULT_DEVICE_RECOVERY_COORDINATOR_CODES.OWNERSHIP_CHANGED);
  expect(local.executeReset).not.toHaveBeenCalled();
});

test("continuation START fence: the prepareFinalSnapshot branch still resets at a stable generation", async () => {
  // The positive control for that branch: without it, the test above would
  // also pass on a continuation that never reached the boundary at all.
  const prepareFinalSnapshot = jest.fn(async () => resumeSnapshot());
  const local = dependencies({
    verifyDevice: jest.fn().mockResolvedValue(deviceVerificationAt(5)),
  });

  const result = await resumeCurrentDeviceRecoveryReset(
    prepareInput({ prepareFinalSnapshot }),
    local
  );

  expect(result).toEqual(resetSuccess());
  expect(local.executeReset).toHaveBeenCalledTimes(1);
});
