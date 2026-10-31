import { STORAGE_KEYS } from "../constants/storageKeys";
import { markCloudBackupDirty, readCloudBackupQueueState } from "./cloudBackupQueue";
import { readCloudMutationLedger } from "./cloudMutationLedger";
import {
  buildLegacyCompatibilityMaterializationMutations,
  materializeLegacyCompatibilityQueue,
} from "./cloudLegacyQueueCutover";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";

jest.mock("./vaultRuntimeStore", () => ({ runtimeCommitAtomicRecords: jest.fn() }));

const snapshot = (overrides = {}) => ({
  companyProfile: { companyName: "BVW" },
  settings: { pricing: { defaultMarkupPct: 10 } },
  scopeTemplates: [],
  customers: [{ id: "customer-1", name: "Current" }],
  projects: [{ id: "project-1", customerId: "customer-1" }],
  estimates: [{ id: "estimate-1", projectId: "project-1", customerId: "customer-1" }],
  invoices: [{ id: "invoice-1", projectId: "project-1", customerId: "customer-1" }],
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("verified baseline materializes only semantic differences and baseline-proven deletes", () => {
  const current = snapshot();
  const baseline = {
    verifiedAt: "2026-08-24T00:00:00.000Z",
    snapshots: snapshot({
      customers: [
        { id: "customer-1", name: "Before" },
        { id: "customer-deleted", name: "Proven prior row" },
      ],
    }),
  };
  const mutations = buildLegacyCompatibilityMaterializationMutations({ snapshot: current, baseline, companyId: "company-1" });
  expect(mutations).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityType: "customer", documentId: "customer-1", operation: "upsert" }),
    expect.objectContaining({ entityType: "customer", documentId: "customer-deleted", operation: "delete" }),
  ]));
  expect(mutations.filter((entry) => entry.entityType === "project")).toHaveLength(0);
  expect(mutations.filter((entry) => entry.operation === "delete")).toHaveLength(1);
});

test("without a baseline materialization emits current exact-target upserts and no deletes", () => {
  const mutations = buildLegacyCompatibilityMaterializationMutations({ snapshot: snapshot(), baseline: null, companyId: "company-1" });
  expect(mutations.some((entry) => entry.operation === "delete")).toBe(false);
  expect(mutations.map((entry) => entry.entityType)).toEqual([
    "customer",
    "project",
    "estimate",
    "invoice",
    "app_restore_bundle",
  ]);
});

test("one legacy generation is durably expanded once and its evidence is retained", async () => {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "BVW" }));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ pricing: { defaultMarkupPct: 10 } }));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, "[]");
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "customer-1", name: "Current" }]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "project-1", customerId: "customer-1" }]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "estimate-1", projectId: "project-1", customerId: "customer-1" }]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{ id: "invoice-1", projectId: "project-1", customerId: "customer-1" }]));
  const queued = markCloudBackupDirty({ reason: "legacy_mixed_generation", companyId: "company-1" });
  const legacyRaw = { ...queued, schemaVersion: "3.0.0" };
  delete legacyRaw.purpose;
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(legacyRaw));

  const first = await materializeLegacyCompatibilityQueue({ storage: localStorage, companyId: "company-1" });
  const second = await materializeLegacyCompatibilityQueue({ storage: localStorage, companyId: "company-1" });

  expect(first).toEqual(expect.objectContaining({ ok: true, materialized: true }));
  expect(second).toEqual(expect.objectContaining({ ok: true, materialized: false, code: "legacy_queue_not_pending" }));
  expect(readCloudMutationLedger().entries).toHaveLength(5);
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
    pending: false,
    compatibilityMaterializedRevision: queued.localMutationRevision,
    legacyCompatibilityEvidence: expect.objectContaining({
      revision: queued.localMutationRevision,
      reasons: expect.arrayContaining(["legacy_mixed_generation"]),
      materializedMutationCount: 5,
    }),
  }));
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
});

// The schema keeps these families together with ON DELETE RESTRICT foreign keys,
// so materialization order is a correctness property, not a cosmetic one: a
// customer delete emitted ahead of the project/estimate/invoice deletes that
// reference it fails on a foreign key even though every one of those deletes is
// baseline-proven and correct.
const RELATED_BASELINE = {
  companyProfile: { companyName: "BVW" },
  settings: { pricing: { defaultMarkupPct: 10 } },
  scopeTemplates: [],
  customers: [{ id: "customer-1", name: "Proven prior customer" }],
  projects: [{ id: "project-1", customerId: "customer-1" }],
  estimates: [{ id: "estimate-1", projectId: "project-1", customerId: "customer-1" }],
  invoices: [{ id: "invoice-1", estimateId: "estimate-1", projectId: "project-1", customerId: "customer-1" }],
};

const emptyBusinessSnapshot = (overrides = {}) => ({
  companyProfile: { companyName: "BVW" },
  settings: { pricing: { defaultMarkupPct: 10 } },
  scopeTemplates: [],
  customers: [],
  projects: [],
  estimates: [],
  invoices: [],
  ...overrides,
});

const businessOnly = (mutations) => mutations.filter((entry) => entry.entityType !== "app_restore_bundle");

test("a fully proven family deletion is materialized child-first so no RESTRICT parent goes early", () => {
  const mutations = buildLegacyCompatibilityMaterializationMutations({
    snapshot: emptyBusinessSnapshot(),
    baseline: { verifiedAt: "2026-08-24T00:00:00.000Z", snapshots: RELATED_BASELINE },
    companyId: "company-1",
  });

  const deletes = businessOnly(mutations).filter((entry) => entry.operation === "delete");
  expect(deletes.map((entry) => [entry.entityType, entry.documentId])).toEqual([
    ["invoice", "invoice-1"],
    ["estimate", "estimate-1"],
    ["project", "project-1"],
    ["customer", "customer-1"],
  ]);
  // Still proof-gated: every delete names an exact record the verified baseline
  // held and the local snapshot no longer has.
  deletes.forEach((entry) => {
    expect(entry.reason).toBe("legacy_compatibility_proven_delete");
    expect(entry.payload.baselineVerifiedAt).toBe("2026-08-24T00:00:00.000Z");
  });
});

test("mixed work materializes every upsert parent-first, then every proven delete child-first", () => {
  const current = emptyBusinessSnapshot({
    customers: [{ id: "customer-2", name: "Current" }],
    projects: [{ id: "project-2", customerId: "customer-2" }],
    estimates: [{ id: "estimate-2", projectId: "project-2", customerId: "customer-2" }],
    invoices: [{ id: "invoice-2", estimateId: "estimate-2", projectId: "project-2", customerId: "customer-2" }],
  });

  const mutations = buildLegacyCompatibilityMaterializationMutations({
    snapshot: current,
    baseline: { verifiedAt: "2026-08-24T00:00:00.000Z", snapshots: RELATED_BASELINE },
    companyId: "company-1",
  });

  expect(businessOnly(mutations).map((entry) => [entry.operation, entry.entityType, entry.documentId])).toEqual([
    ["upsert", "customer", "customer-2"],
    ["upsert", "project", "project-2"],
    ["upsert", "estimate", "estimate-2"],
    ["upsert", "invoice", "invoice-2"],
    ["delete", "invoice", "invoice-1"],
    ["delete", "estimate", "estimate-1"],
    ["delete", "project", "project-1"],
    ["delete", "customer", "customer-1"],
  ]);
});

test("ordering never invents a delete: no usable baseline still emits upserts only", () => {
  const mutations = buildLegacyCompatibilityMaterializationMutations({
    snapshot: emptyBusinessSnapshot({ customers: [{ id: "customer-2", name: "Current" }] }),
    baseline: null,
    companyId: "company-1",
  });

  expect(mutations.some((entry) => entry.operation === "delete")).toBe(false);
  expect(businessOnly(mutations).map((entry) => [entry.operation, entry.documentId])).toEqual([
    ["upsert", "customer-2"],
  ]);
});
