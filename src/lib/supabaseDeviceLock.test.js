const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  LOCAL_DEVICE_ID_KEY,
  checkCurrentDeviceAccess,
  claimActiveDevice,
  ensureCurrentDeviceCanWriteCloud,
  ensureCurrentDeviceCanApplyLocalRestore,
  ensureCurrentDeviceCanMutateBusinessData,
  DEVICE_LOCK_LOST_CODE,
  DEVICE_LOCK_CHANGED_EVENT,
  DEVICE_LEASE_CONFLICT_CODE,
  heartbeatActiveDevice,
  buildDeviceFence,
  fencesMatch,
  deviceFenceFromState,
  ensureDeviceFenceStillCurrent,
} = require("./supabaseDeviceLock");
const { isCloudAutoBackupPaused, readCloudAutoBackupPauseState } = require("./cloudBackupQueue");
const { STORAGE_KEYS } = require("../constants/storageKeys");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

// Chain-length agnostic, and it actually ENFORCES the compare-and-set predicates
// the production update now sends. A mock that ignored them could not tell a real
// CAS from the old unconditional overwrite.
function resolveJsonPredicate(row, column) {
  const jsonMatch = String(column).match(/^setting_value->>(.+)$/);
  if (jsonMatch) {
    const value = row?.setting_value?.[jsonMatch[1]];
    return value === undefined || value === null ? "" : String(value);
  }
  if (column === "id") return String(row?.id ?? "");
  return undefined;
}

function createMockClient() {
  let row = null;
  const updateCalls = [];

  const select = jest.fn(() => {
    const builder = {
      eq: jest.fn(() => builder),
      then: undefined,
    };
    // The read chain ends by being awaited, so make the builder thenable.
    const promise = Promise.resolve({ data: row ? [row] : [], error: null });
    builder.then = promise.then.bind(promise);
    builder.catch = promise.catch.bind(promise);
    return builder;
  });

  const update = jest.fn((payload) => {
    const predicates = [];
    const builder = {
      eq: jest.fn((column, value) => {
        predicates.push([column, value]);
        return builder;
      }),
      select: jest.fn(async () => {
        updateCalls.push({ payload, predicates: [...predicates] });
        // Every predicate that maps onto the stored row must match, exactly as
        // PostgREST would filter it.
        const matches = predicates.every(([column, value]) => {
          const actual = resolveJsonPredicate(row, column);
          if (actual === undefined) return true; // company_id / scope / key
          return actual === String(value);
        });
        if (!row || !matches) return { data: [], error: null };
        row = { id: row.id, setting_value: payload.setting_value };
        return { data: [row], error: null };
      }),
    };
    return builder;
  });

  const insert = jest.fn((payload) => ({
    select: jest.fn(async () => {
      if (row) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      row = { id: payload.id || "device_lock_row_1", setting_value: payload.setting_value };
      return { data: [row], error: null };
    }),
  }));

  return {
    from: jest.fn((table) => {
      if (table !== "app_settings") throw new Error(`Unexpected table: ${table}`);
      return { select, update, insert };
    }),
    getRow: () => row,
    setRow: (value) => {
      row = value;
    },
    getUpdateCalls: () => updateCalls,
    insert,
    update,
  };
}

function createHeartbeatRaceClient({ firstDeviceId = "device_a", secondDeviceId = "device_b" } = {}) {
  let selectCallCount = 0;

  const selectEq3 = jest.fn(async () => {
    selectCallCount += 1;
    const activeDeviceId = selectCallCount === 1 ? firstDeviceId : secondDeviceId;
    return {
      data: [{
        id: "device_lock_row_1",
        setting_value: {
          activeDeviceId,
          activeDeviceName: activeDeviceId === firstDeviceId ? "Chrome on Mac" : "Safari on iPad",
        },
      }],
      error: null,
    };
  });
  const selectEq2 = jest.fn(() => ({ eq: selectEq3 }));
  const selectEq1 = jest.fn(() => ({ eq: selectEq2 }));
  const select = jest.fn(() => ({ eq: selectEq1 }));
  const update = jest.fn(() => {
    throw new Error("heartbeat should not update once another device is active");
  });
  const insert = jest.fn(() => {
    throw new Error("insert should not be called in heartbeat race test");
  });

  return {
    from: jest.fn(() => ({ select, update, insert })),
  };
}

describe("supabaseDeviceLock", () => {
  const configured = true;
  const user = { id: "user_1", email: "owner@example.com" };
  const company = { id: "company_1", name: "Field Pocket" };

  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    localStorage.clear();
  });

  test("first signed-in device claims active status when no active device exists", async () => {
    const storage = createStorage();
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage,
    });

    expect(result.isActive).toBe(true);
    expect(result.isLocked).toBe(false);
    expect(storage.getItem(LOCAL_DEVICE_ID_KEY)).toBeTruthy();
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.getRow().setting_value.activeDeviceId).toBe(storage.getItem(LOCAL_DEVICE_ID_KEY));
  });

  test("second device stays locked until takeover is explicit", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceAStorage,
    });

    const result = await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceBStorage,
    });

    expect(result.isLocked).toBe(true);
    expect(result.isActive).toBe(false);
    expect(result.activeDeviceState.activeDeviceId).toBe(deviceAStorage.getItem(LOCAL_DEVICE_ID_KEY));
  });

  test("takeover switches the active device and locks the prior device on next check", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceAStorage,
    });

    const takeover = await claimActiveDevice({
      configured,
      user,
      company,
      storage: deviceBStorage,
      force: true,
    });

    expect(takeover.ok).toBe(true);
    expect(takeover.takeover).toBe(true);
    expect(client.getRow().setting_value.activeDeviceId).toBe(deviceBStorage.getItem(LOCAL_DEVICE_ID_KEY));

    const deviceAResult = await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceAStorage,
      claimIfMissing: false,
      heartbeatIfActive: false,
    });

    expect(deviceAResult.isLocked).toBe(true);
    expect(deviceAResult.activeDeviceState.activeDeviceId).toBe(deviceBStorage.getItem(LOCAL_DEVICE_ID_KEY));
  });

  // Gate 16G: the winning device must NOT pause itself. localStorage is
  // browser-local, so this pause could never reach the browser being taken
  // over; it only ever deadlocked the new active device, because the pause
  // blocks the very backup that would clear it.
  test("a successful forced takeover no longer pauses the winning device", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceAStorage,
    });

    expect(isCloudAutoBackupPaused()).toBe(false);

    const takeover = await claimActiveDevice({
      configured,
      user,
      company,
      storage: deviceBStorage,
      force: true,
    });

    // The claim still succeeds and is still reported as a takeover...
    expect(takeover.ok).toBe(true);
    expect(takeover.claimed).toBe(true);
    expect(takeover.takeover).toBe(true);
    // ...but the winner is left able to back up.
    expect(isCloudAutoBackupPaused()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE)).toBeNull();
  });

  test("the takeover event still fires and the new device stays active while the old device is locked out", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({ configured, user, company, storage: deviceAStorage });

    const events = [];
    const onChange = (event) => events.push(event.detail);
    window.addEventListener(DEVICE_LOCK_CHANGED_EVENT, onChange);
    try {
      const takeover = await claimActiveDevice({ configured, user, company, storage: deviceBStorage, force: true });
      expect(takeover.ok).toBe(true);

      // 2. The takeover event still fires.
      expect(events.some((detail) => detail?.action === "takeover")).toBe(true);

      // 3. The new device is the active device.
      const deviceB = await checkCurrentDeviceAccess({ configured, user, company, storage: deviceBStorage });
      expect(deviceB.isActive).toBe(true);
      expect(deviceB.isLocked).toBe(false);

      // 4. The stale previous device still fails its active-device check.
      const deviceA = await checkCurrentDeviceAccess({ configured, user, company, storage: deviceAStorage });
      expect(deviceA.isActive).toBe(false);
      expect(deviceA.isLocked).toBe(true);
    } finally {
      window.removeEventListener(DEVICE_LOCK_CHANGED_EVENT, onChange);
    }
  });

  // 5/6: the losing device still pauses itself locally when a real guard
  // observes the lock loss -- those protections are untouched.
  test("the losing device still pauses locally when the restore guard sees the lock loss", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({ configured, user, company, storage: deviceAStorage });
    await claimActiveDevice({ configured, user, company, storage: deviceBStorage, force: true });
    expect(isCloudAutoBackupPaused()).toBe(false);

    const blocked = await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage: deviceAStorage, reason: "restore" });

    expect(blocked.ok).toBe(false);
    expect(blocked.deviceLockLost).toBe(true);
    expect(readCloudAutoBackupPauseState()).toEqual(expect.objectContaining({ paused: true, reason: "device_lock_lost_during_restore" }));
  });

  test("the losing device still pauses locally when the mutation guard sees the lock loss", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({ configured, user, company, storage: deviceAStorage });
    await claimActiveDevice({ configured, user, company, storage: deviceBStorage, force: true });
    expect(isCloudAutoBackupPaused()).toBe(false);

    const blocked = await ensureCurrentDeviceCanMutateBusinessData({ configured, user, company, storage: deviceAStorage, reason: "local_save" });

    expect(blocked.ok).toBe(false);
    expect(readCloudAutoBackupPauseState()).toEqual(expect.objectContaining({ paused: true, reason: "device_lock_lost_during_mutation" }));
  });

  test("locked devices are blocked from cloud writes", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);
    const deviceAStorage = createStorage();
    const deviceBStorage = createStorage();

    await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage: deviceAStorage,
    });

    const result = await ensureCurrentDeviceCanWriteCloud({
      configured,
      user,
      company,
      storage: deviceBStorage,
    });

    expect(result.ok).toBe(false);
    expect(result.access.isLocked).toBe(true);
  });

  test("fresh restore guard dispatches lock loss and pauses backup when another device owns the workspace", async () => {
    const client = createMockClient();
    client.setRow({
      id: "device_lock_row_1",
      setting_value: { activeDeviceId: "device_a", activeDeviceName: "Chrome on Mac" },
    });
    mockGetSupabaseClient.mockReturnValue(client);
    const storage = createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_b" });
    const onLockChanged = jest.fn();
    window.addEventListener(DEVICE_LOCK_CHANGED_EVENT, onLockChanged);
    try {
      const result = await ensureCurrentDeviceCanApplyLocalRestore({
        configured,
        user,
        company,
        storage,
        reason: "before_local_restore_apply",
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(DEVICE_LOCK_LOST_CODE);
      expect(result.deviceLockLost).toBe(true);
      expect(isCloudAutoBackupPaused()).toBe(true);
      expect(onLockChanged).toHaveBeenCalledWith(expect.objectContaining({
        detail: expect.objectContaining({ action: "restore_blocked", locked: true }),
      }));
    } finally {
      window.removeEventListener(DEVICE_LOCK_CHANGED_EVENT, onLockChanged);
    }
  });

  test("fresh business-mutation guard returns the typed save-stopped lock result", async () => {
    const client = createMockClient();
    client.setRow({
      id: "device_lock_row_1",
      setting_value: { activeDeviceId: "device_a", activeDeviceName: "Chrome on Mac" },
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await ensureCurrentDeviceCanMutateBusinessData({
      configured,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_b" }),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(DEVICE_LOCK_LOST_CODE);
    expect(result.userMessage).toBe("Save stopped because EstiPaid was switched to another device.");
  });

  test("heartbeat race returns locked when another device takes over between reads", async () => {
    const storage = createStorage({
      [LOCAL_DEVICE_ID_KEY]: "device_a",
    });
    const client = createHeartbeatRaceClient();
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await checkCurrentDeviceAccess({
      configured,
      user,
      company,
      storage,
      claimIfMissing: false,
      heartbeatIfActive: true,
    });

    expect(result.status).toBe("locked");
    expect(result.isLocked).toBe(true);
    expect(result.isActive).toBe(false);
    expect(result.activeDeviceState.activeDeviceId).toBe("device_b");
  });
});

// ---------------------------------------------------------------------------
// A. ACTIVE-DEVICE COMPARE-AND-SET
//
// The old write was read -> unconditional UPDATE by row id. A heartbeat that
// prepared its update before a takeover could land afterwards, reclaim ownership
// and move lockVersion backwards. These prove it cannot.
// ---------------------------------------------------------------------------

// Lets a test change the stored row BETWEEN the read and the update, which is
// exactly the TOCTOU window the CAS closes.
function createRaceClient({ initialRow, onAfterRead = () => {} }) {
  let row = initialRow;
  let reads = 0;

  const select = jest.fn(() => {
    const builder = { eq: jest.fn(() => builder) };
    const promise = Promise.resolve().then(() => {
      reads += 1;
      const snapshot = row ? { id: row.id, setting_value: { ...row.setting_value } } : null;
      onAfterRead(reads, (next) => { row = next; });
      return { data: snapshot ? [snapshot] : [], error: null };
    });
    builder.then = promise.then.bind(promise);
    builder.catch = promise.catch.bind(promise);
    return builder;
  });

  const update = jest.fn((payload) => {
    const predicates = [];
    const builder = {
      eq: jest.fn((column, value) => { predicates.push([column, value]); return builder; }),
      select: jest.fn(async () => {
        const matches = predicates.every(([column, value]) => {
          const actual = resolveJsonPredicate(row, column);
          if (actual === undefined) return true;
          return actual === String(value);
        });
        if (!row || !matches) return { data: [], error: null };
        row = { id: row.id, setting_value: payload.setting_value };
        return { data: [row], error: null };
      }),
    };
    return builder;
  });

  return {
    from: jest.fn(() => ({ select, update, insert: jest.fn() })),
    getRow: () => row,
  };
}

function lockRow({ deviceId, lockVersion, id = "device_lock_row_1" }) {
  return {
    id,
    setting_value: {
      schema: "estipaid.device_lock",
      version: 1,
      activeDeviceId: deviceId,
      activeDeviceName: deviceId,
      lockVersion,
    },
  };
}

describe("active-device compare-and-set", () => {
  const user = { id: "user_1", email: "owner@example.com" };
  const company = { id: "company_1" };

  it("a stale heartbeat cannot overwrite a newer takeover", async () => {
    // A reads itself at v5; B takes over at v6 before A's update lands.
    const client = createRaceClient({
      initialRow: lockRow({ deviceId: "device_a", lockVersion: 5 }),
      onAfterRead: (reads, setRow) => {
        if (reads === 1) setRow(lockRow({ deviceId: "device_b", lockVersion: 6 }));
      },
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await heartbeatActiveDevice({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
    });

    expect(result.ok).toBe(false);
    // B still owns the workspace; A did not reclaim it.
    expect(client.getRow().setting_value.activeDeviceId).toBe("device_b");
    expect(client.getRow().setting_value.lockVersion).toBe(6);
  });

  it("a stale heartbeat cannot move lockVersion backwards", async () => {
    const client = createRaceClient({
      initialRow: lockRow({ deviceId: "device_a", lockVersion: 5 }),
      onAfterRead: (reads, setRow) => {
        if (reads === 1) setRow(lockRow({ deviceId: "device_b", lockVersion: 9 }));
      },
    });
    mockGetSupabaseClient.mockReturnValue(client);

    await heartbeatActiveDevice({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
    });

    expect(client.getRow().setting_value.lockVersion).toBe(9);
  });

  it("two simultaneous forced takeovers produce exactly one winner", async () => {
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_owner", lockVersion: 3 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const [first, second] = await Promise.all([
      claimActiveDevice({
        configured: true, user, company, force: true,
        storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_b" }),
      }),
      claimActiveDevice({
        configured: true, user, company, force: true,
        storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_c" }),
      }),
    ]);

    const winners = [first, second].filter((entry) => entry.ok);
    const losers = [first, second].filter((entry) => !entry.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].code).toBe(DEVICE_LEASE_CONFLICT_CODE);
    // The stored row belongs to the winner and advanced exactly one generation.
    expect(client.getRow().setting_value.lockVersion).toBe(4);
  });

  it("an insert race leaves one owner and the loser adopts it", async () => {
    const client = createMockClient();
    mockGetSupabaseClient.mockReturnValue(client);

    const [first, second] = await Promise.all([
      claimActiveDevice({
        configured: true, user, company,
        storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_b" }),
      }),
      claimActiveDevice({
        configured: true, user, company,
        storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_c" }),
      }),
    ]);

    const winners = [first, second].filter((entry) => entry.ok);
    expect(winners).toHaveLength(1);
    const loser = [first, second].find((entry) => !entry.ok);
    // The loser re-read and reports the real owner rather than blindly retrying.
    expect(loser.code).toBe(DEVICE_LEASE_CONFLICT_CODE);
    expect(loser.activeDeviceState?.activeDeviceId).toBe(
      client.getRow().setting_value.activeDeviceId
    );
  });

  it("a lost compare-and-set reports the actual current owner", async () => {
    const client = createRaceClient({
      initialRow: lockRow({ deviceId: "device_a", lockVersion: 2 }),
      onAfterRead: (reads, setRow) => {
        if (reads === 1) setRow(lockRow({ deviceId: "device_z", lockVersion: 3 }));
      },
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await heartbeatActiveDevice({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
    });

    expect(result.ok).toBe(false);
    expect(result.activeDeviceState?.activeDeviceId).toBe("device_z");
  });

  it("a malformed lock payload fails closed instead of granting ownership", async () => {
    const client = createMockClient();
    client.setRow({ id: "device_lock_row_1", setting_value: "not-an-object" });
    mockGetSupabaseClient.mockReturnValue(client);

    const access = await checkCurrentDeviceAccess({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
      claimIfMissing: false,
      heartbeatIfActive: false,
    });

    // A malformed row has no activeDeviceId, so this device is not active.
    expect(access.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. LEASE FENCING
// ---------------------------------------------------------------------------

describe("device lease fencing", () => {
  const user = { id: "user_1", email: "owner@example.com" };
  const company = { id: "company_1" };

  it("builds and compares fences by company, device and generation", () => {
    const fence = buildDeviceFence({ companyId: "c1", deviceId: "d1", lockVersion: 5 });
    expect(fence).toEqual({ companyId: "c1", deviceId: "d1", lockVersion: 5 });
    expect(fencesMatch(fence, buildDeviceFence({ companyId: "c1", deviceId: "d1", lockVersion: 5 }))).toBe(true);
    expect(fencesMatch(fence, buildDeviceFence({ companyId: "c1", deviceId: "d1", lockVersion: 6 }))).toBe(false);
    expect(fencesMatch(fence, buildDeviceFence({ companyId: "c1", deviceId: "d2", lockVersion: 5 }))).toBe(false);
    expect(fencesMatch(fence, null)).toBe(false);
    expect(buildDeviceFence({ companyId: "c1", deviceId: "d1", lockVersion: "nope" })).toBeNull();
  });

  it("rejects an operation that started under an older generation of the SAME device", async () => {
    // A starts at generation 5.
    const startFence = buildDeviceFence({ companyId: "company_1", deviceId: "device_a", lockVersion: 5 });

    // B took over (6), then A took it back (7). A is active again -- but the work
    // that began at 5 must still fail.
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_a", lockVersion: 7 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await ensureDeviceFenceStillCurrent({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
      fence: startFence,
      reason: "backup",
    });

    expect(result.ok).toBe(false);
    expect(result.deviceLockLost).toBe(true);
    expect(result.currentFence.lockVersion).toBe(7);
  });

  it("accepts an operation whose generation is still current", async () => {
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_a", lockVersion: 5 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await ensureDeviceFenceStillCurrent({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
      fence: buildDeviceFence({ companyId: "company_1", deviceId: "device_a", lockVersion: 5 }),
    });

    expect(result.ok).toBe(true);
  });

  it("rejects when another device now owns the lease", async () => {
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_b", lockVersion: 6 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await ensureDeviceFenceStillCurrent({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
      fence: buildDeviceFence({ companyId: "company_1", deviceId: "device_a", lockVersion: 5 }),
    });

    expect(result.ok).toBe(false);
    expect(result.deviceLockLost).toBe(true);
    expect(result.currentFence).toBeNull();
  });

  it("fails closed when no start fence was captured", async () => {
    const result = await ensureDeviceFenceStillCurrent({
      configured: true, user, company, fence: null,
    });
    expect(result.ok).toBe(false);
  });

  it("a heartbeat by the same owner leaves the generation stable", async () => {
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_a", lockVersion: 4 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const before = client.getRow().setting_value.lockVersion;
    const result = await heartbeatActiveDevice({
      configured: true,
      user,
      company,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_a" }),
    });

    expect(result.ok).toBe(true);
    expect(client.getRow().setting_value.lockVersion).toBe(before);
    expect(result.fence.lockVersion).toBe(before);
  });

  it("ownership transfer advances the generation monotonically", async () => {
    const client = createMockClient();
    client.setRow(lockRow({ deviceId: "device_a", lockVersion: 4 }));
    mockGetSupabaseClient.mockReturnValue(client);

    const takeover = await claimActiveDevice({
      configured: true, user, company, force: true,
      storage: createStorage({ [LOCAL_DEVICE_ID_KEY]: "device_b" }),
    });

    expect(takeover.ok).toBe(true);
    expect(takeover.fence.lockVersion).toBe(5);
    expect(client.getRow().setting_value.lockVersion).toBe(5);
  });

  it("derives no fence for a device that does not own the lease", () => {
    expect(deviceFenceFromState({
      companyId: "c1",
      deviceId: "device_a",
      activeDeviceState: { activeDeviceId: "device_b", lockVersion: 2 },
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OPERATION START-FENCE COMPARATOR
//
// This is the check the fenced multi-stage operations call at their commit
// boundary. Their previous completion guard asked only "is this device active
// now?", which A(v5) -> B(v6) -> A(v7) satisfies: the original device regained
// the lock under a NEWER generation, so a stale in-flight run still published.
// ---------------------------------------------------------------------------
describe("operation start-fence comparator", () => {
  const { operationFenceStillCurrent, buildStaleOperationResult } = require("./supabaseDeviceLock");
  const fenceAt = (lockVersion) => ({ companyId: "company_1", deviceId: "device_a", lockVersion });
  const accessAt = (lockVersion) => ({ ok: true, access: { isActive: true, isLocked: false, fence: fenceAt(lockVersion) } });

  it("accepts a completion under the SAME generation the run started with", () => {
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: accessAt(5) })).toBe(true);
  });

  it("rejects A5 -> B6 -> A7: same device, newer generation", () => {
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: accessAt(7) })).toBe(false);
  });

  it("rejects a completion owned by a different device", () => {
    const otherDevice = { ok: true, access: { fence: { companyId: "company_1", deviceId: "device_b", lockVersion: 5 } } };
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: otherDevice })).toBe(false);
  });

  it("rejects a completion for a different workspace", () => {
    const otherCompany = { ok: true, access: { fence: { companyId: "company_2", deviceId: "device_a", lockVersion: 5 } } };
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: otherCompany })).toBe(false);
  });

  it("fails closed when the run never captured a start fence", () => {
    expect(operationFenceStillCurrent({ startFence: null, completionAccess: accessAt(5) })).toBe(false);
  });

  it("fails closed when the completion read carries no fence", () => {
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: { ok: true, access: {} } })).toBe(false);
  });

  it("accepts a fence supplied directly rather than nested under access", () => {
    expect(operationFenceStillCurrent({ startFence: fenceAt(5), completionAccess: { fence: fenceAt(5) } })).toBe(true);
  });

  it("produces a typed lock-lost result for a stale operation", () => {
    const stale = buildStaleOperationResult("backup");
    expect(stale.ok).toBe(false);
    expect(stale.deviceLockLost).toBe(true);
    expect(stale.code).toBe(DEVICE_LOCK_LOST_CODE);
    expect(stale.userMessage).toMatch(/switched to another device/i);
  });
});
