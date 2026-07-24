const mockGetSupabaseClient = jest.fn();
const mockEnsureCurrentDeviceCanWriteCloud = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

jest.mock("./supabaseDeviceLock", () => ({
  ensureCurrentDeviceCanWriteCloud: (...args) => mockEnsureCurrentDeviceCanWriteCloud(...args),
}));

const { STORAGE_KEYS } = require("../constants/storageKeys");
const {
  buildSupabaseAppRestoreBundle,
  readSupabaseAppRestoreBundle,
  updateSupabaseAppRestoreBundle,
  APP_RESTORE_BUNDLE_STATUS,
  SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY,
} = require("./supabaseAppRestoreBundle");

function buildStorageSnapshot(overrides = {}) {
  const values = {
    [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify({
      companyName: "AAS Property Care",
      phone: "5551234567",
      logoDataUrl: "data:image/png;base64,abc123",
    }),
    [STORAGE_KEYS.SETTINGS]: JSON.stringify({
      pdf: { includeLogo: true },
      pricing: { defaultMarkupPct: 12 },
    }),
    [STORAGE_KEYS.SCOPE_TEMPLATES]: JSON.stringify([
      { id: "tmpl_1", name: "Roof", scopeText: "Repair roof" },
    ]),
    ...overrides,
  };
  return {
    getItem: jest.fn((key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null)),
  };
}

function createEmptySessionStorage() {
  const values = new Map();
  return {
    getItem: jest.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: jest.fn((key, value) => values.set(key, value)),
  };
}

function reorderJson(value) {
  if (Array.isArray(value)) return value.map(reorderJson);
  if (value && typeof value === "object") {
    return Object.keys(value).reverse().reduce((result, key) => {
      result[key] = reorderJson(value[key]);
      return result;
    }, {});
  }
  return value;
}

function createMockClient({
  existingRows = [],
  selectError = null,
  updateError = null,
  insertError = null,
  updateResponse = null,
  insertResponse = null,
} = {}) {
  const selectEq3 = jest.fn(async () => (
    selectError ? { data: null, error: selectError } : { data: existingRows, error: null }
  ));
  const selectEq2 = jest.fn(() => ({ eq: selectEq3 }));
  const selectEq1 = jest.fn(() => ({ eq: selectEq2 }));
  const select = jest.fn(() => ({ eq: selectEq1 }));

  let updatePayload = null;
  const updateSelect = jest.fn(async () => {
    if (updateError) return { data: null, error: updateError };
    if (typeof updateResponse === "function") return updateResponse(updatePayload);
    if (updateResponse) return updateResponse;
    return { data: [{ id: "bundle_row_1", setting_value: updatePayload?.setting_value }], error: null };
  });
  const updateEq2 = jest.fn(() => ({ select: updateSelect }));
  const updateEq1 = jest.fn(() => ({ eq: updateEq2 }));
  const update = jest.fn((payload) => {
    updatePayload = payload;
    return { eq: updateEq1 };
  });

  let insertPayload = null;
  const insertSelect = jest.fn(async () => {
    if (insertError) return { data: null, error: insertError };
    if (typeof insertResponse === "function") return insertResponse(insertPayload);
    if (insertResponse) return insertResponse;
    return { data: [{ id: "bundle_row_new", setting_value: insertPayload?.setting_value }], error: null };
  });
  const insert = jest.fn((payload) => {
    insertPayload = payload;
    return { select: insertSelect };
  });

  const from = jest.fn((table) => {
    if (table !== "app_settings") throw new Error(`Unexpected table: ${table}`);
    return {
      select,
      update,
      insert,
    };
  });

  return {
    from,
    select,
    selectEq1,
    selectEq2,
    selectEq3,
    update,
    updateEq1,
    updateEq2,
    updateSelect,
    insert,
    insertSelect,
  };
}

describe("supabaseAppRestoreBundle", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue({ ok: true, access: { isActive: true, isLocked: false }, error: "" });
  });

  test("bundle builder reads only company profile, settings, and scope templates keys", () => {
    const snapshot = buildStorageSnapshot({
      "estipaid-customers-v1": JSON.stringify([{ id: "cust_1" }]),
    });

    const result = buildSupabaseAppRestoreBundle(snapshot);

    expect(snapshot.getItem.mock.calls.map(([key]) => key)).toEqual([
      STORAGE_KEYS.COMPANY_PROFILE,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCOPE_TEMPLATES,
    ]);
    expect(result.readKeys).toEqual([
      STORAGE_KEYS.COMPANY_PROFILE,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCOPE_TEMPLATES,
    ]);
    expect(result.bundle.companyProfile.companyName).toBe("AAS Property Care");
    expect(result.bundle.settings.pricing.defaultMarkupPct).toBe(12);
    expect(result.bundle.scopeTemplates).toHaveLength(1);
  });

  test("bundle captures logoDataUrl inside company profile", () => {
    const result = buildSupabaseAppRestoreBundle(buildStorageSnapshot());

    expect(result.bundle.companyProfile.logoDataUrl).toBe("data:image/png;base64,abc123");
    expect(result.captureSummary.logoDataUrlCaptured).toBe(true);
  });

  test("a mocked second session restores the latest saved profile and replacement logo from the captured bundle", async () => {
    const firstSession = buildStorageSnapshot({
      [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify({
        companyName: "Desert Ridge Updated",
        phone: "6025550147",
        logoDataUrl: "data:image/png;base64,replacement-logo",
      }),
    });
    const captured = buildSupabaseAppRestoreBundle(firstSession).bundle;
    const client = createMockClient({
      existingRows: [{ id: "bundle_row_1", setting_value: captured }],
    });
    const secondSession = createEmptySessionStorage();

    const restored = await readSupabaseAppRestoreBundle({ client, companyId: "company_1" });
    secondSession.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(restored.bundle.companyProfile));

    expect(restored.status).toBe("available");
    expect(JSON.parse(secondSession.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual(expect.objectContaining({
      companyName: "Desert Ridge Updated",
      logoDataUrl: "data:image/png;base64,replacement-logo",
    }));
  });

  test("a mocked second session does not resurrect a removed logo", async () => {
    const firstSession = buildStorageSnapshot({
      [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify({
        companyName: "Desert Ridge Updated",
        phone: "6025550147",
        logoDataUrl: "",
      }),
    });
    const captured = buildSupabaseAppRestoreBundle(firstSession).bundle;
    const client = createMockClient({
      existingRows: [{ id: "bundle_row_1", setting_value: captured }],
    });
    const secondSession = createEmptySessionStorage();

    const restored = await readSupabaseAppRestoreBundle({ client, companyId: "company_1" });
    secondSession.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(restored.bundle.companyProfile));

    expect(JSON.parse(secondSession.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual(expect.objectContaining({
      companyName: "Desert Ridge Updated",
      logoDataUrl: "",
    }));
    expect(restored.captureSummary.logoDataUrlCaptured).toBe(false);
  });

  test("bundle stores null for missing keys instead of inventing data", () => {
    const result = buildSupabaseAppRestoreBundle(buildStorageSnapshot({
      [STORAGE_KEYS.SETTINGS]: null,
      [STORAGE_KEYS.SCOPE_TEMPLATES]: null,
    }));

    expect(result.bundle.settings).toBeNull();
    expect(result.bundle.scopeTemplates).toBeNull();
    expect(result.captureSummary.settingsCaptured).toBe(false);
    expect(result.captureSummary.scopeTemplatesCaptured).toBe(false);
  });

  test("bundle update blocks when signed out, unconfigured, or no workspace", async () => {
    const snapshot = buildStorageSnapshot();

    const signedOut = await updateSupabaseAppRestoreBundle({
      storageSnapshot: snapshot,
      configured: false,
      user: null,
      company: null,
    });
    const noWorkspace = await updateSupabaseAppRestoreBundle({
      storageSnapshot: snapshot,
      configured: true,
      user: { id: "user_1" },
      company: null,
    });

    expect(signedOut.status).toBe(APP_RESTORE_BUNDLE_STATUS.SIGNED_OUT);
    expect(noWorkspace.status).toBe(APP_RESTORE_BUNDLE_STATUS.NO_WORKSPACE);
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  test("bundle update performs no localStorage writes", async () => {
    const client = createMockClient({ existingRows: [] });
    mockGetSupabaseClient.mockReturnValue(client);

    const snapshot = buildStorageSnapshot();
    snapshot.setItem = jest.fn();

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: snapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
    });

    expect(result.status).toBe(APP_RESTORE_BUNDLE_STATUS.COMPLETED);
    expect(snapshot.setItem).not.toHaveBeenCalled();
  });

  test("bundle update rejects when a fresh device-lock check says this device is locked", async () => {
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue({
      ok: false,
      access: { isLocked: true, isActive: false },
      error: "This device is locked because EstiPaid is active on another device.",
    });

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
    });

    expect(result.status).toBe(APP_RESTORE_BUNDLE_STATUS.ERROR);
    expect(result.error).toMatch(/locked/i);
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  test("bundle update aborts before Supabase insert when a takeover happens after bundle capture", async () => {
    const client = createMockClient({ existingRows: [] });
    mockGetSupabaseClient.mockReturnValue(client);
    mockEnsureCurrentDeviceCanWriteCloud
      .mockResolvedValueOnce({ ok: true, access: { isActive: true, isLocked: false }, error: "" })
      .mockResolvedValueOnce({
        ok: false,
        code: "device_lock_lost",
        deviceLockLost: true,
        userMessage: "Backup stopped because EstiPaid was switched to another device.",
        error: "Backup stopped because EstiPaid was switched to another device.",
      });

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(), configured: true, user: { id: "user_1" }, company: { id: "company_1" }, role: "owner",
    });

    expect(result.status).toBe(APP_RESTORE_BUNDLE_STATUS.ERROR);
    expect(result.deviceLockLost).toBe(true);
    expect(client.insert).not.toHaveBeenCalled();
  });

  test("bundle update writes only the app restore bundle to Supabase and does not touch business tables", async () => {
    const client = createMockClient({ existingRows: [] });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
    });

    expect(result.status).toBe(APP_RESTORE_BUNDLE_STATUS.COMPLETED);
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["app_settings", "app_settings"]);
    expect(client.insert).toHaveBeenCalledTimes(1);
    const insertPayload = client.insert.mock.calls[0][0];
    expect(insertPayload).toEqual(expect.objectContaining({
      company_id: "company_1",
      user_id: null,
      setting_scope: "company",
      setting_key: SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY,
      setting_value: expect.objectContaining({
        schema: "estipaid.app.restore_bundle",
        companyProfile: expect.any(Object),
        settings: expect.any(Object),
        scopeTemplates: expect.any(Array),
      }),
    }));
  });

  test("bundle update reuses the existing app_settings row when one already exists", async () => {
    const client = createMockClient({
      existingRows: [{ id: "bundle_row_1", setting_value: { schema: "old" } }],
      updateResponse: (payload) => ({
        data: [{ id: "bundle_row_1", setting_value: reorderJson(payload.setting_value) }],
        error: null,
      }),
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
    });

    expect(result.status).toBe(APP_RESTORE_BUNDLE_STATUS.COMPLETED);
    expect(result.bundleAction).toBe("updated");
    expect(client.update.mock.calls[0][0]).toEqual(expect.objectContaining({
      setting_value: expect.objectContaining({ schema: "estipaid.app.restore_bundle" }),
    }));
  });

  test.each([
    ["no rows", () => ({ data: [], error: null }), /exactly one returned row/i],
    ["multiple rows", (payload) => ({ data: [{ id: "bundle_row_1", setting_value: payload.setting_value }, { id: "bundle_row_2", setting_value: payload.setting_value }], error: null }), /exactly one returned row/i],
    ["the wrong row", (payload) => ({ data: [{ id: "bundle_row_2", setting_value: payload.setting_value }], error: null }), /ID did not match/i],
    ["a missing bundle", () => ({ data: [{ id: "bundle_row_1" }], error: null }), /missing setting_value/i],
    ["a stale or mismatched bundle", (payload) => ({ data: [{ id: "bundle_row_1", setting_value: { ...payload.setting_value, companyProfile: { ...payload.setting_value.companyProfile, companyName: "Stale company" } } }], error: null }), /did not match/i],
  ])("bundle update rejects %s returned by Supabase", async (_label, updateResponse, error) => {
    const client = createMockClient({
      existingRows: [{ id: "bundle_row_1", setting_value: { schema: "old" } }],
      updateResponse,
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(), configured: true, user: { id: "user_1" }, company: { id: "company_1" }, role: "owner",
    });

    expect(result).toEqual(expect.objectContaining({
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      code: "app_restore_bundle_write_unverified",
    }));
    expect(result.error).toMatch(error);
  });

  test("bundle insert rejects a returned row without a valid ID", async () => {
    const client = createMockClient({
      insertResponse: (payload) => ({ data: [{ id: "", setting_value: payload.setting_value }], error: null }),
    });
    mockGetSupabaseClient.mockReturnValue(client);

    const result = await updateSupabaseAppRestoreBundle({
      storageSnapshot: buildStorageSnapshot(), configured: true, user: { id: "user_1" }, company: { id: "company_1" }, role: "owner",
    });

    expect(result).toEqual(expect.objectContaining({
      status: APP_RESTORE_BUNDLE_STATUS.ERROR,
      bundleUpdated: false,
      code: "app_restore_bundle_write_unverified",
    }));
    expect(result.error).toMatch(/no valid ID/i);
  });

  test("readSupabaseAppRestoreBundle returns a valid stored bundle summary", async () => {
    const client = createMockClient({
      existingRows: [{
        id: "bundle_row_1",
        setting_value: {
          schema: "estipaid.app.restore_bundle",
          version: 1,
          capturedFrom: "localStorage",
          companyProfile: { companyName: "AAS", logoDataUrl: "data:image/png;base64,abc123" },
          settings: { pdf: { includeLogo: true } },
          scopeTemplates: [{ id: "tmpl_1" }],
        },
      }],
    });

    const result = await readSupabaseAppRestoreBundle({ client, companyId: "company_1" });

    expect(result.status).toBe("available");
    expect(result.captureSummary.companyProfileCaptured).toBe(true);
    expect(result.captureSummary.logoDataUrlCaptured).toBe(true);
    expect(result.captureSummary.settingsCaptured).toBe(true);
    expect(result.captureSummary.scopeTemplatesCaptured).toBe(true);
  });
});
