const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  LOCAL_DEVICE_ID_KEY,
  checkCurrentDeviceAccess,
  claimActiveDevice,
  ensureCurrentDeviceCanWriteCloud,
} = require("./supabaseDeviceLock");

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

describe("supabaseDeviceLock", () => {
  const configured = true;
  const user = { id: "user_1", email: "owner@example.com" };
  const company = { id: "company_1", name: "Field Pocket" };

  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
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
});
