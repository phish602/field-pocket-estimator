import {
  normalizeCustomLaborRoleList,
  readStoredCustomLaborRoles,
  findSavedCustomLaborRoleLabel,
  getLegacyLaborRoleLabel,
  resolveLaborRoleSelectValue,
} from "./customLaborRoles";

const PRESET_MAP = new Map([
  ["foreman", { key: "foreman", label: "Foreman" }],
  ["journeyman", { key: "journeyman", label: "Journeyman" }],
]);

describe("custom labor roles utility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("normalizeCustomLaborRoleList handles malformed/non-array input safely", () => {
    expect(normalizeCustomLaborRoleList(null, { presetByNormalizedLabel: PRESET_MAP })).toEqual([]);
    expect(normalizeCustomLaborRoleList({ label: "Painter" }, { presetByNormalizedLabel: PRESET_MAP })).toEqual([]);
    expect(normalizeCustomLaborRoleList("Painter", { presetByNormalizedLabel: PRESET_MAP })).toEqual([]);
  });

  test("normalizeCustomLaborRoleList dedupes labels and excludes presets", () => {
    const result = normalizeCustomLaborRoleList(
      [
        "  PIPE fitter  ",
        { label: "pipe fitter" },
        { label: " Foreman " },
        { label: "" },
        "Welder",
      ],
      { presetByNormalizedLabel: PRESET_MAP }
    );
    expect(result).toEqual(["PIPE fitter", "Welder"]);
  });

  test("findSavedCustomLaborRoleLabel returns saved canonical label by normalized match", () => {
    const saved = ["Pipe Fitter", "Welder"];
    expect(findSavedCustomLaborRoleLabel(" pipe fitter ", saved)).toBe("Pipe Fitter");
    expect(findSavedCustomLaborRoleLabel("WELDER", saved)).toBe("Welder");
    expect(findSavedCustomLaborRoleLabel("Foreman", saved)).toBe("");
  });

  test("getLegacyLaborRoleLabel preserves legacy behavior for preset and saved labels", () => {
    const options = { presetByNormalizedLabel: PRESET_MAP };
    const saved = ["Pipe Fitter"];
    expect(getLegacyLaborRoleLabel("Foreman", saved, options)).toBe("");
    expect(getLegacyLaborRoleLabel("Pipe Fitter", saved, options)).toBe("");
    expect(getLegacyLaborRoleLabel("Custom Legacy Role", saved, options)).toBe("Custom Legacy Role");
  });

  test("resolveLaborRoleSelectValue resolves preset/custom/manual values", () => {
    const options = { presetByNormalizedLabel: PRESET_MAP };
    const saved = ["Pipe Fitter"];
    expect(resolveLaborRoleSelectValue("foreman", saved, options)).toBe("Foreman");
    expect(resolveLaborRoleSelectValue(" pipe fitter ", saved, options)).toBe("Pipe Fitter");
    expect(resolveLaborRoleSelectValue("Unlisted Role", saved, options)).toBe("Unlisted Role");
  });

  test("readStoredCustomLaborRoles tolerates malformed storage payload", () => {
    localStorage.setItem("custom-labor-role-test", "{invalid json");
    expect(readStoredCustomLaborRoles({ storageKey: "custom-labor-role-test", presetByNormalizedLabel: PRESET_MAP })).toEqual([]);
  });
});
