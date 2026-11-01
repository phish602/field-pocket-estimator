import { renderHook, waitFor } from "@testing-library/react";
import {
  appendCloudMutationRecords,
  createEmptyCloudMutationLedger,
  readCloudMutationLedger,
} from "./cloudMutationLedger";
import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { deriveCloudProductStatus, CLOUD_PRODUCT_STATE } from "./useCloudBackupStatus";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { ensureCurrentDeviceCanWriteCloud, operationFenceStillCurrent } from "./supabaseDeviceLock";
import { buildTargetEstimatePersistencePayloads } from "./supabaseMigrationWriter";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import useCloudAutoBackup from "./useCloudAutoBackup";
import useCloudAutoConvergence from "./useCloudAutoConvergence";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import { runSupabaseCloudOnboardingBackup } from "./supabaseCloudOnboarding";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } from "./supabaseCloudConvergence";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";

let mockClient;

jest.mock("./supabaseClient", () => ({ getSupabaseClient: () => mockClient }));
jest.mock("./supabaseCloudOnboarding", () => ({
  ...jest.requireActual("./supabaseCloudOnboarding"),
  checkSupabaseCloudOnboardingStatus: jest.fn(),
  runSupabaseCloudOnboardingBackup: jest.fn(),
}));
jest.mock("./supabaseCloudConvergence", () => ({
  ...jest.requireActual("./supabaseCloudConvergence"),
  runSupabaseCloudConvergence: jest.fn(),
  recoverInterruptedCloudConvergence: jest.fn(),
}));
jest.mock("./vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: jest.fn(async (records) => {
    records.forEach(({ logicalKey, value }) => globalThis.localStorage.setItem(logicalKey, value));
    return { ok: true };
  }),
}));
jest.mock("./supabaseDeviceLock", () => ({
  ensureCurrentDeviceCanWriteCloud: jest.fn(async () => ({
    ok: true,
    access: { fence: { companyId: "company-1", deviceId: "device-1", lockVersion: 5 } },
  })),
  ensureCurrentDeviceCanApplyLocalRestore: jest.fn(),
  ensureDeviceFenceStillCurrent: jest.fn(),
  operationFenceStillCurrent: jest.fn(() => true),
  buildStaleOperationResult: jest.fn(() => ({ ok: false, code: "device_generation_changed", deviceLockLost: true })),
  getOrCreateLocalDeviceId: jest.fn(() => "device-1"),
}));
jest.mock("./supabaseMigrationWriter", () => ({
  buildTargetInvoicePersistencePayloads: jest.fn(),
  buildTargetEstimatePersistencePayloads: jest.fn(({ estimateId = null }) => ({
    mappedEstimate: { customer_legacy_local_id: "customer-1", project_legacy_local_id: "project-1" },
    estimatePayload: {
      company_id: "company-1",
      legacy_local_id: "estimate-2606",
      customer_id: "customer-cloud",
      project_id: "project-cloud",
      estimate_number: "EST-2606",
      status: "draft",
      total_amount: 6000,
      notes: null,
      terms: null,
      converted_invoice_legacy_id: null,
      restore_payload: {
        version: 1,
        estimate: {
          id: "estimate-2606",
          estimateNumber: "EST-2606",
          total: 6000,
          materials: { items: [{ id: "material-1", priceEach: 2000 }] },
        },
      },
      restore_payload_version: "1.0.0",
    },
    lineItemPayloads: estimateId ? [{
      company_id: "company-1",
      legacy_local_id: "estimate:estimate-2606:line:0",
      estimate_id: estimateId,
      sort_order: 0,
      line_role: "material",
      description: "Fixtures",
      quantity: 1,
      unit: null,
      unit_price: 2000,
      total_price: null,
      metadata: null,
    }] : [],
    lineItemIssues: [],
  })),
}));

function createSupabaseClient() {
  const operations = [];
  const rows = {
    customers: [{ id: "customer-cloud", company_id: "company-1", legacy_local_id: "customer-1" }],
    projects: [{ id: "project-cloud", company_id: "company-1", legacy_local_id: "project-1" }],
    estimates: [{ id: "estimate-cloud", company_id: "company-1", legacy_local_id: "estimate-2606" }],
    estimate_line_items: [
      { id: "expected-line", company_id: "company-1", estimate_id: "estimate-cloud", legacy_local_id: "estimate:estimate-2606:line:0" },
      { id: "stale-target-line", company_id: "company-1", estimate_id: "estimate-cloud", legacy_local_id: "estimate:estimate-2606:line:99" },
      { id: "unrelated-line", company_id: "company-1", estimate_id: "unrelated-estimate", legacy_local_id: "estimate:unrelated:line:0" },
    ],
    invoices: [{ id: "invoice-unrelated", company_id: "company-1", legacy_local_id: "invoice-unrelated" }],
    invoice_line_items: [{ id: "invoice-line-unrelated", company_id: "company-1", invoice_id: "invoice-unrelated" }],
    invoice_payments: [{ id: "payment-unrelated", company_id: "company-1", invoice_id: "invoice-unrelated" }],
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.mode = "select";
      this.filters = [];
      this.payload = null;
    }
    select() { return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    in(column, values) { this.filters.push([column, values]); return this; }
    upsert(payload) { this.mode = "upsert"; this.payload = payload; return this; }
    delete() { this.mode = "delete"; return this; }
    filtered() {
      return rows[this.table].filter((row) => this.filters.every(([column, value]) => (
        Array.isArray(value) ? value.includes(row[column]) : row[column] === value
      )));
    }
    execute() {
      operations.push({ table: this.table, mode: this.mode, filters: [...this.filters], payload: this.payload });
      if (this.mode === "upsert") {
        const data = this.payload.map((payload) => {
          const existing = rows[this.table].find((row) => row.company_id === payload.company_id && row.legacy_local_id === payload.legacy_local_id);
          const id = existing?.id || `${this.table}-${rows[this.table].length + 1}`;
          const next = { ...(existing || {}), ...payload, id };
          if (existing) Object.assign(existing, next); else rows[this.table].push(next);
          return { id, legacy_local_id: payload.legacy_local_id };
        });
        return { data, error: null };
      }
      if (this.mode === "delete") {
        const deleted = this.filtered();
        rows[this.table] = rows[this.table].filter((row) => !deleted.includes(row));
        return { data: deleted.map((row) => ({ id: row.id })), error: null };
      }
      return { data: this.filtered().map((row) => ({ ...row })), error: null };
    }
    maybeSingle() {
      const result = this.execute();
      return Promise.resolve({ ...result, data: result.data[0] || null });
    }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }

  return { client: { from: (table) => new Query(table) }, rows, operations };
}

beforeEach(() => {
  localStorage.clear();
  resetCloudOperationRunLockForTests();
  runSupabaseCloudOnboardingBackup.mockReset();
  runSupabaseCloudConvergence.mockReset();
  recoverInterruptedCloudConvergence.mockReset();
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: true, recovered: false });
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => globalThis.localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
  ensureCurrentDeviceCanWriteCloud.mockResolvedValue({
    ok: true,
    access: { fence: { companyId: "company-1", deviceId: "device-1", lockVersion: 5 } },
  });
  operationFenceStillCurrent.mockReturnValue(true);
  buildTargetEstimatePersistencePayloads.mockImplementation(({ estimateId = null }) => ({
    mappedEstimate: { customer_legacy_local_id: "customer-1", project_legacy_local_id: "project-1" },
    estimatePayload: {
      company_id: "company-1",
      legacy_local_id: "estimate-2606",
      customer_id: "customer-cloud",
      project_id: "project-cloud",
      estimate_number: "EST-2606",
      status: "draft",
      total_amount: 6000,
      notes: null,
      terms: null,
      converted_invoice_legacy_id: null,
      restore_payload: {
        version: 1,
        estimate: {
          id: "estimate-2606",
          estimateNumber: "EST-2606",
          total: 6000,
          materials: { items: [{ id: "material-1", priceEach: 2000 }] },
        },
      },
      restore_payload_version: "1.0.0",
    },
    lineItemPayloads: estimateId ? [{
      company_id: "company-1",
      legacy_local_id: "estimate:estimate-2606:line:0",
      estimate_id: estimateId,
      sort_order: 0,
      line_role: "material",
      description: "Fixtures",
      quantity: 1,
      unit: null,
      unit_price: 2000,
      total_price: null,
      metadata: null,
    }] : [],
    lineItemIssues: [],
  }));
  const fixture = createSupabaseClient();
  mockClient = fixture.client;
  mockClient.fixture = fixture;
});

test("EST-2606 +$1,000 closes automatically through real target cleanup, verification, acknowledgement, and queue supersession", async () => {
  const currentEstimate = {
    id: "estimate-2606", estimateNumber: "EST-2606", customerId: "customer-1", projectId: "project-1",
    total: 6000, materials: { items: [{ id: "material-1", priceEach: 2000 }] },
  };
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([currentEstimate]));
  const baselineSnapshot = buildLocalSnapshotFromStorage(localStorage).snapshot;
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE, JSON.stringify({
    version: 1, companyId: "company-1", verifiedAt: "2026-08-24T00:00:00.000Z", snapshots: baselineSnapshot,
  }));
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "3.0.0",
    pending: true,
    status: "conflict",
    reviewOrigin: "current_sync_failure",
    lastError: "Old whole-workspace mismatch",
    lastErrorCode: "data_mismatch",
    documentId: "estimate-2606",
    companyId: "company-1",
    domains: ["customers", "projects", "estimates"],
    lastQueuedAt: 1000,
    localMutationRevision: 8,
    syncingRevision: null,
    reasons: ["legacy_estimate_save"],
    severity: "normal",
    priority: "normal",
  }));
  const unrelatedHistory = { entries: [{ family: "customers", id: "historical-customer" }] };
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, JSON.stringify(unrelatedHistory));
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: "company-1",
    entityType: "estimate",
    documentId: "estimate-2606",
    createdAt: 2000,
    payload: {
      id: "estimate-2606",
      estimateNumber: "EST-2606",
      total: 6000,
      materials: { items: [{ id: "material-1", priceEach: 2000 }] },
    },
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));

  const actorProps = {
    configured: true, user: { id: "user-1" }, company: { id: "company-1" },
  };
  const { unmount } = renderHook(() => {
    useCloudAutoConvergence({ ...actorProps, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } });
    return useCloudAutoBackup({ enabled: true, ...actorProps, role: "owner", immediateDelayMs: 1, normalDelayMs: 1 });
  });

  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
  expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged");
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: "clean" }));
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
    purpose: "legacy_compatibility",
    compatibilityMaterializedRevision: 8,
    legacyCompatibilityEvidence: expect.objectContaining({ materializedMutationCount: 0 }),
  }));
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  const { operations, rows } = mockClient.fixture;
  expect(operations.filter((operation) => operation.mode === "upsert").map((operation) => operation.table)).toEqual([
    "estimates",
    "estimate_line_items",
  ]);
  expect(operations.filter((operation) => operation.mode === "delete")).toEqual([
    expect.objectContaining({
      table: "estimate_line_items",
      filters: expect.arrayContaining([
        ["company_id", "company-1"],
        ["estimate_id", "estimate-cloud"],
        ["id", ["stale-target-line"]],
      ]),
    }),
  ]);
  expect(rows.estimate_line_items.some((row) => row.id === "stale-target-line")).toBe(false);
  expect(rows.estimate_line_items.some((row) => row.id === "unrelated-line")).toBe(true);
  expect(rows.invoices).toEqual([{ id: "invoice-unrelated", company_id: "company-1", legacy_local_id: "invoice-unrelated" }]);
  expect(rows.invoice_payments).toEqual([{ id: "payment-unrelated", company_id: "company-1", invoice_id: "invoice-unrelated" }]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT))).toEqual(unrelatedHistory);
  expect(deriveCloudProductStatus({
    connected: true,
    queueState: readCloudBackupQueueState(),
    mutationLedger: readCloudMutationLedger(),
    decision: { verifiedCurrent: true },
  }).state).toBe(CLOUD_PRODUCT_STATE.CLOUD_OK);
  unmount();
});

test("old mixed queue alone materializes one baseline-different target once and the real worker drains it without onboarding", async () => {
  const currentEstimate = {
    id: "estimate-2606", estimateNumber: "EST-2606", customerId: "customer-1", projectId: "project-1",
    total: 6000, materials: { items: [{ id: "material-1", priceEach: 2000 }] },
  };
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([currentEstimate]));
  const currentSnapshot = buildLocalSnapshotFromStorage(localStorage).snapshot;
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE, JSON.stringify({
    version: 1,
    companyId: "company-1",
    verifiedAt: "2026-08-24T00:00:00.000Z",
    snapshots: { ...currentSnapshot, estimates: [{ ...currentEstimate, total: 5000 }] },
  }));
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "3.0.0", pending: true, status: "needs_attention",
    reviewOrigin: "current_sync_failure", lastError: "Old whole-workspace mismatch", lastErrorCode: "data_mismatch",
    documentId: "estimate-2606", companyId: "company-1", domains: ["customers", "projects", "estimates"],
    lastQueuedAt: 1000, localMutationRevision: 12, reasons: ["legacy_mixed_generation"], severity: "normal", priority: "normal",
  }));

  const actorProps = { configured: true, user: { id: "user-1" }, company: { id: "company-1" } };
  const { unmount } = renderHook(() => {
    useCloudAutoConvergence({ ...actorProps, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } });
    return useCloudAutoBackup({ enabled: true, ...actorProps, role: "owner", immediateDelayMs: 1, normalDelayMs: 1 });
  });

  await waitFor(() => expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({ entityType: "estimate", documentId: "estimate-2606", status: "acknowledged" }),
  ]));
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
    pending: false, purpose: "legacy_compatibility", compatibilityMaterializedRevision: 12,
    legacyCompatibilityEvidence: expect.objectContaining({ materializedMutationCount: 1 }),
  }));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  expect(mockClient.fixture.operations.filter((operation) => operation.mode === "upsert").map((operation) => operation.table)).toEqual(["estimates", "estimate_line_items"]);
  unmount();
});
