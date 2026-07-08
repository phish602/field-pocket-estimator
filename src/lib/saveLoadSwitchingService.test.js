import { SAVE_LOAD_MODES } from "./saveLoadMode";
import { createSaveLoadSwitchingService } from "./saveLoadSwitchingService";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("saveLoadSwitchingService", () => {
  test("imports without throwing", () => {
    expect(() => require("./saveLoadSwitchingService")).not.toThrow();
  });

  test("default status uses localStorage fallback", () => {
    const service = createSaveLoadSwitchingService();
    const status = service.getStatus();

    expect(status.activeMode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(status.requestedMode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(status.fallbackMode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
  });

  test("missing or unconfigured backend does not crash and stays on fallback", () => {
    const service = createSaveLoadSwitchingService({
      mode: SAVE_LOAD_MODES.BACKEND,
      enableBackendMode: true,
      backendAdapter: {
        getBackendAdapterStatus: () => ({
          isConfigured: false,
          canRead: false,
          canWrite: false,
          reason: "missing config",
          missingKeys: ["REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY"],
        }),
      },
    });

    const status = service.getStatus();
    expect(status.activeMode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(status.isBackendConfigured).toBe(false);
    expect(service.shouldUseLocalStorageFallback()).toBe(true);
  });

  test("blocked backend save returns controlled fallback result", () => {
    const adapter = {
      getBackendAdapterStatus: () => ({ isConfigured: true, canRead: true, canWrite: false, reason: "guarded", missingKeys: [] }),
      prepareBackendDraft: () => ({ mappedDraft: { id: "draft_1" }, warnings: [] }),
      writeToBackend: () => ({ ok: false, blocked: true, reason: "not approved" }),
      readFromBackend: () => ({ ok: false, blocked: true, reason: "not approved" }),
    };
    const service = createSaveLoadSwitchingService({
      mode: SAVE_LOAD_MODES.BACKEND,
      enableBackendMode: true,
      backendAdapter: adapter,
    });

    const result = service.saveDraft({ id: "local_1", items: [] }, { companyId: "company_1" });

    expect(result.mode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(result.fallbackUsed).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.autoMigrationPerformed).toBe(false);
  });

  test("blocked backend load returns controlled fallback result", () => {
    const adapter = {
      getBackendAdapterStatus: () => ({ isConfigured: true, canRead: true, canWrite: false, reason: "guarded", missingKeys: [] }),
      readFromBackend: () => ({ ok: false, blocked: true, reason: "not approved" }),
      writeToBackend: () => ({ ok: false, blocked: true, reason: "not approved" }),
    };
    const service = createSaveLoadSwitchingService({
      mode: SAVE_LOAD_MODES.BACKEND,
      enableBackendMode: true,
      backendAdapter: adapter,
    });

    const result = service.loadDrafts({ projectId: "proj_1" }, { companyId: "company_1" });

    expect(result.mode).toBe(SAVE_LOAD_MODES.LOCAL_STORAGE);
    expect(result.fallbackUsed).toBe(true);
    expect(result.blocked).toBe(true);
    expect(result.autoMigrationPerformed).toBe(false);
  });

  test("service does not mutate input snapshot", () => {
    const service = createSaveLoadSwitchingService();
    const snapshot = {
      id: "snap_1",
      customers: [{ id: "cust_1" }],
    };
    const before = clone(snapshot);

    const result = service.prepareSavePayload(snapshot, { companyId: "company_1" });

    expect(result.ok).toBe(true);
    expect(snapshot).toEqual(before);
  });

  test("no automatic localStorage migration occurs", () => {
    const service = createSaveLoadSwitchingService();

    const saveResult = service.saveDraft({ id: "draft_1" }, {});
    const loadResult = service.loadDrafts({}, {});

    expect(saveResult.autoMigrationPerformed).toBe(false);
    expect(loadResult.autoMigrationPerformed).toBe(false);
  });

  test("service source does not import disallowed modules", () => {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "saveLoadSwitchingService.js");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).not.toMatch(/from\s+["']\.\.\/pdf/);
    expect(source).not.toMatch(/from\s+["']\.\.\/.*aiAssist/i);
    expect(source).not.toMatch(/from\s+["']\.\.\/utils\/backendMigration/);
    expect(source).not.toMatch(/from\s+["']\.\.\/App["']/);
  });
});
