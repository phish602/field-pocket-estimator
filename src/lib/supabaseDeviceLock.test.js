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
  DEVICE_LOCK_LOST_CODE,
  DEVICE_LOCK_CHANGED_EVENT,
} = require("./supabaseDeviceLock");
const { isCloudAutoBackupPaused } = require("./cloudBackupQueue");

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

function createMockClient() {
  let row = null;
  let pendingUpdate = null;
  let pendingInsert = null;

  const selectEq3 = jest.fn(async () => ({ data: row ? [row] : [], error: null }));
  const selectEq2 = jest.fn(() => ({ eq: selectEq3 }));
  const selectEq1 = jest.fn(() => ({ eq: selectEq2 }));
  const select = jest.fn(() => ({ eq: selectEq1 }));

  const updateSelect = jest.fn(async () => {
    row = {
      id: row?.id || "device_lock_row_1",
      setting_value: pendingUpdate,
    };
    return { data: [row], error: null };
  });
  const updateEq2 = jest.fn(() => ({ select: updateSelect }));
  const updateEq1 = jest.fn(() => ({ eq: updateEq2 }));
  const update = jest.fn((payload) => {
    pendingUpdate = payload.setting_value;
    return { eq: updateEq1 };
  });

  const insertSelect = jest.fn(async () => {
    row = {
      id: "device_lock_row_1",
      setting_value: pendingInsert.setting_value,
    };
    return { data: [row], error: null };
  });
  const insert = jest.fn((payload) => {
    pendingInsert = payload;
    return { select: insertSelect };
  });

  return {
    from: jest.fn((table) => {
      if (table !== "app_settings") throw new Error(`Unexpected table: ${table}`);
      return { select, update, insert };
    }),
    getRow: () => row,
    setRow: (value) => {
      row = value;
    },
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

  test("takeover pauses automatic backup on the newly active device", async () => {
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

    expect(takeover.ok).toBe(true);
    expect(isCloudAutoBackupPaused()).toBe(true);
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
