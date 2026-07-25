import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  activateCompanyStorageNamespace,
  companyStorageIsolationInternals,
  deactivateCompanyStorageNamespace,
  importLegacyCompanyStorage,
  inspectLegacyCompanyData,
  installCompanyStorageIsolation,
  prepareCompanyStorage,
  startWithEmptyCompanyStorage,
} from "./companyStorageIsolation";

const {
  COMPANY_SCOPE_PREFIX,
  COMPANY_READY_PREFIX,
  LEGACY_OWNER_KEY,
  rawGetItem,
  rawRemoveItem,
  rawSetItem,
} = companyStorageIsolationInternals;

function clearRawStorage() {
  deactivateCompanyStorageNamespace();
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  keys.forEach((key) => rawRemoveItem(key));
  rawRemoveItem(LEGACY_OWNER_KEY);
}

describe("companyStorageIsolation", () => {
  beforeAll(() => {
    installCompanyStorageIsolation();
  });

  beforeEach(() => {
    clearRawStorage();
  });

  test("keeps the same EstiPaid key separate for two companies", () => {
    activateCompanyStorageNamespace("company-a");
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "a-customer" }]));

    activateCompanyStorageNamespace("company-b");
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "b-customer" }]));

    activateCompanyStorageNamespace("company-a");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([{ id: "a-customer" }]);

    activateCompanyStorageNamespace("company-b");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([{ id: "b-customer" }]);
  });

  test("requires an explicit decision before legacy data is attached", () => {
    deactivateCompanyStorageNamespace();
    rawSetItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Legacy Company" }));
    rawSetItem(STORAGE_KEYS.INVOICES, JSON.stringify([{ id: "invoice-1" }]));

    const inspection = inspectLegacyCompanyData();
    expect(inspection.exists).toBe(true);
    expect(inspection.companyName).toBe("Legacy Company");

    const result = prepareCompanyStorage("company-new");
    expect(result.status).toBe("decision_required");
    expect(rawGetItem(`${COMPANY_SCOPE_PREFIX}company-new:${STORAGE_KEYS.INVOICES}`)).toBeNull();
  });

  test("imports legacy data only into the company the user approves", () => {
    deactivateCompanyStorageNamespace();
    rawSetItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Legacy Company" }));
    rawSetItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "estimate-1" }]));

    const result = importLegacyCompanyStorage("company-a");
    expect(result.status).toBe("ready");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([{ id: "estimate-1" }]);
    expect(rawGetItem(LEGACY_OWNER_KEY)).toBe("company-a");

    const secondCompany = prepareCompanyStorage("company-b");
    expect(secondCompany.status).toBe("ready");
    expect(secondCompany.legacyOwnedByAnotherCompany).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATES)).toBeNull();
  });

  test("starting empty never deletes the unscoped legacy data", () => {
    deactivateCompanyStorageNamespace();
    rawSetItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "legacy-project" }]));

    const result = startWithEmptyCompanyStorage("company-empty");
    expect(result.status).toBe("ready");
    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBeNull();

    deactivateCompanyStorageNamespace();
    expect(rawGetItem(STORAGE_KEYS.PROJECTS)).toBe(JSON.stringify([{ id: "legacy-project" }]));
    expect(rawGetItem(`${COMPANY_READY_PREFIX}company-empty`)).toBe("1");
  });
});
