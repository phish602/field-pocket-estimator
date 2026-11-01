import React from "react";
import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import * as workspaceStorage from "../lib/accountScopedLocalStorage";
import * as convergence from "../lib/supabaseCloudConvergence";
import { getHistoricalWorkspaceBaselineCandidates } from "../lib/cloudMutationLedger";
import { isInactiveWorkspaceBaselineQueue } from "../lib/cloudBackupQueue";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../lib/vaultCompatibilityGuard";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { executeSupabaseCloudRestore, exportSupabaseCloudBackupArtifact, previewSupabaseCloudRestore, CLOUD_BACKUP_EXPORT_STATUS, CLOUD_RESTORE_STATUS } from "../lib/supabaseCloudRestore";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
import { triggerCloudBackupExportDownload } from "../lib/cloudBackupExportDownload";

jest.mock("../lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useCloudBackupStatus", () => {
  const actual = jest.requireActual("../lib/useCloudBackupStatus");
  return { ...actual, __esModule: true, default: jest.fn() };
});
jest.mock("../lib/supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("../lib/supabaseCloudOnboarding");
  return { ...actual, checkSupabaseCloudOnboardingStatus: jest.fn() };
});
jest.mock("../lib/supabaseCloudRestore", () => {
  const actual = jest.requireActual("../lib/supabaseCloudRestore");
  return { ...actual, executeSupabaseCloudRestore: jest.fn(), previewSupabaseCloudRestore: jest.fn(), exportSupabaseCloudBackupArtifact: jest.fn() };
});
jest.mock("../lib/localStorageExportDownload", () => ({ triggerLocalStorageExportDownload: jest.fn() }));
jest.mock("../lib/cloudBackupExportDownload", () => ({ triggerCloudBackupExportDownload: jest.fn() }));

function cloudStatus(overrides = {}) {
  return {
    productState: CLOUD_PRODUCT_STATE.CLOUD_OK,
    productStatus: { state: CLOUD_PRODUCT_STATE.CLOUD_OK, pendingReason: "", lastSuccessfulBackupAt: null },
    decision: {},
    onboardingStatus: null,
    restorePreviewLoading: false,
    refreshCloudStatus: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  useSupabaseAuth.mockReturnValue({ configured: true, missingEnvKeys: [], loading: false, authBusy: false, user: { id: "user-1" }, userEmail: "owner@example.com", errorMessage: "", signOut: jest.fn() });
  useSupabaseAccount.mockReturnValue({ companyUser: { id: "membership-1" }, company: { id: "company-1", name: "BVW Contracting" }, role: "owner", loading: false, error: "", hasCompany: true, refresh: jest.fn() });
  useDeviceLockStatus.mockReturnValue({ ready: true, loading: false, isLocked: false, isActive: true });
  useSupabaseWorkspaceBootstrap.mockReturnValue({ createWorkspace: jest.fn(), creating: false, error: "", success: "" });
  useCloudBackupStatus.mockReturnValue(cloudStatus());
});

test("keeps normal account, vault, template, report, and local danger-zone controls", () => {
  const lockNow = jest.fn();
  render(<AdvancedSettingsScreen onVaultLockNow={lockNow} snapshotAvailable />);
  expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  expect(screen.getByText("BVW Contracting")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lock Now" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Templates" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Snapshot" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear EstiPaid local data" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Lock Now" }));
  expect(lockNow).toHaveBeenCalledTimes(1);
});

test("clearing local business data preserves device-global vault authority", () => {
  localStorage.setItem(VAULT_COMPATIBILITY_GUARD_KEY, "guard-evidence");
  localStorage.setItem("estipaid-customers", "[{\"id\":\"customer-1\"}]");
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<AdvancedSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Clear EstiPaid local data" }));
  expect(localStorage.getItem(VAULT_COMPATIBILITY_GUARD_KEY)).toBe("guard-evidence");
  expect(localStorage.getItem("estipaid-customers")).toBeNull();
});

test("fresh-device restore remains available and uses the guarded restore flow", async () => {
  const prepare = jest.fn();
  useCloudBackupStatus.mockReturnValue(cloudStatus({ onboardingStatus: { status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE } }));
  previewSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.ELIGIBLE, eligible: true });
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP });
  render(<AdvancedSettingsScreen onPrepareCloudRestore={prepare} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restore Cloud to This Device" }));
  fireEvent.click(await screen.findByRole("button", { name: "Restore Data" }));
  await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({ prepareSecureRestore: prepare }));
  expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(1);
});

describe("read-only recovery tools", () => {
  const BUSINESS_KEYS = [STORAGE_KEYS.CUSTOMERS, STORAGE_KEYS.PROJECTS, STORAGE_KEYS.ESTIMATES, STORAGE_KEYS.INVOICES];
  const businessSnapshot = () => BUSINESS_KEYS.map((key) => localStorage.getItem(key));

  test("keeps the three read-only recovery tools and none of the retired developer controls", () => {
    render(<AdvancedSettingsScreen />);
    expect(screen.getByText("Recovery Tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Cloud Backup JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download This Device Backup JSON" })).toBeInTheDocument();
    const rendered = document.body.textContent || "";
    ["Developer Tools", "Export Raw App Data", "Import Backup JSON"].forEach((copy) => expect(rendered).not.toContain(copy));
    expect(rendered).not.toMatch(/sample[\s-]data/i);
    expect(document.body.innerHTML).not.toContain("type=\"file\"");
  });

  test("the not-configured hint points at Recovery Tools, not a removed section", () => {
    useSupabaseAuth.mockReturnValue({ configured: false, missingEnvKeys: ["REACT_APP_SUPABASE_URL"], loading: false, authBusy: false, user: null, userEmail: "", errorMessage: "", signOut: jest.fn() });
    render(<AdvancedSettingsScreen />);
    expect(screen.getByText("Download This Device Backup JSON in Recovery Tools before any future migration or cloud-write step.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Developer Tools");
  });

  test("device and cloud backup downloads use the existing exporters and write no business data", async () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, "[{\"id\":\"customer-1\"}]");
    const before = businessSnapshot();
    triggerLocalStorageExportDownload.mockReturnValue({ filename: "device-backup.json" });
    const artifact = { counts: { customers: 1, projects: 2, estimates: 3, invoices: 4 } };
    exportSupabaseCloudBackupArtifact.mockResolvedValue({ status: CLOUD_BACKUP_EXPORT_STATUS.EXPORTED, artifact });
    triggerCloudBackupExportDownload.mockReturnValue({ filename: "cloud-backup.json", artifact });
    render(<AdvancedSettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Download This Device Backup JSON" }));
    expect(triggerLocalStorageExportDownload).toHaveBeenCalledWith(expect.objectContaining({ storageSnapshot: localStorage }));
    expect(await screen.findByText("This device backup JSON downloaded: device-backup.json")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download Cloud Backup JSON" }));
    expect(await screen.findByText("Cloud backup JSON downloaded: cloud-backup.json (1 customers, 2 projects, 3 estimates, 4 invoices).")).toBeInTheDocument();
    expect(exportSupabaseCloudBackupArtifact).toHaveBeenCalledWith({ configured: true, user: { id: "user-1" }, company: { id: "company-1", name: "BVW Contracting" } });
    expect(triggerCloudBackupExportDownload).toHaveBeenCalledWith(expect.objectContaining({ artifact }));
    expect(businessSnapshot()).toEqual(before);
  });

  test("diagnostics export downloads a redacted bundle and writes no business data", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, "[{\"id\":\"customer-1\",\"name\":\"SECRET_CUSTOMER_NAME\"}]");
    const before = businessSnapshot();
    const createObjectURL = jest.fn(() => "blob:diagnostics");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: jest.fn() });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<AdvancedSettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Export Diagnostics" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Diagnostics JSON exported.")).toBeInTheDocument();
    expect(businessSnapshot()).toEqual(before);
  });

  test("recovery tools follow the shared Spanish dictionary", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    render(<AdvancedSettingsScreen />);
    expect(screen.getByText("Herramientas de recuperación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar diagnóstico" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar JSON de respaldo en la nube" })).toBeInTheDocument();
  });
});

describe("development sync diagnostic", () => {
  const originalEnvironment = process.env.NODE_ENV;
  const secrets = ["SECRET_CUSTOMER_NAME", "SECRET_PROJECT_NAME", "SECRET_EMAIL", "SECRET_TOKEN"];
  const payload = { customer: secrets[0], project: secrets[1], email: secrets[2], token: secrets[3] };
  function failedLedger() {
    return {
      lastVerifiedAt: 1234, lastAcknowledgedRevision: 6,
      entries: [{
        mutationId: "private-mutation-id", documentId: "private-document-id", companyId: "private-company-id",
        revision: 7, status: "needs_attention", entityType: "invoice", operation: "upsert",
        retryCount: 3, lastErrorCode: "invoice_mutation_failed", nextRetryAt: 4567, payload,
      }],
    };
  }
  function show(overrides = {}) {
    const state = cloudStatus({
      productState: "sync_issue", displayState: "failed", chipState: "failed", chipAction: "retry",
      decision: {}, ...overrides,
    });
    useCloudBackupStatus.mockReturnValue(state);
    render(<AdvancedSettingsScreen />);
    return screen.getByRole("region", { name: "Development Sync Diagnostic" });
  }
  beforeEach(() => {
    process.env.NODE_ENV = "development";
    jest.clearAllMocks();
  });
  afterEach(() => { process.env.NODE_ENV = originalEnvironment; });

  test("development shows the exact failed ledger owner and safe metadata", () => {
    const panel = show({ decision: { ledgerFailed: true, screenState: "backup_failed" }, mutationLedger: failedLedger() });
    [
      "productState: sync_issue", "displayState: failed", "chipState: failed", "chipAction: retry",
      "decision.screenState: backup_failed", "decision.ledgerFailed: true",
      "mutationLedger.activeCount: 1", "mutationLedger.lastVerifiedAt: 1234",
      "mutationLedger.lastAcknowledgedRevision: 6", "mutation.status: needs_attention",
      "mutation.entityType: invoice", "mutation.operation: upsert", "mutation.revision: 7",
      "mutation.retryCount: 3", "mutation.lastErrorCode: invoice_mutation_failed", "mutation.nextRetryAt: 4567",
    ].forEach(text => expect(panel).toHaveTextContent(text));
    secrets.forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test("queue unresolved shows current safe queue values without actions or retries", () => {
    const retry = jest.fn();
    const panel = show({
      decision: { queueUnresolved: true, queueLegacyCompatibility: true },
      queueState: { pending: true, status: "needs_attention", purpose: "legacy_compatibility",
        lastErrorCode: "known_test_code", retryCount: 3, reviewOrigin: "current_sync_failure",
        lastVerifiedAt: 123, lastSuccessfulBackupAt: 456, payload },
      retry,
    });
    ["decision.queueUnresolved: true", "queueState.pending: true", "queueState.status: needs_attention",
      "queueState.purpose: legacy_compatibility", "queueState.lastErrorCode: known_test_code",
      "queueState.retryCount: 3", "queueState.reviewOrigin: current_sync_failure",
      "queueState.lastVerifiedAt: 123", "queueState.lastSuccessfulBackupAt: 456",
    ].forEach(text => expect(panel).toHaveTextContent(text));
    expect(panel.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /repair|retry/i })).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  test("mismatch shows live flags and verification counts without identity arrays", () => {
    const panel = show({
      decision: { mismatch: true, cloudOnlyRowsDetected: true },
      onboardingStatus: { status: "local_cloud_mismatch", code: "verification_mismatch",
        reason: "cloud_only_rows", payload,
        verification: { ok: false, allMatched: false,
          tableResults: [{ table: "invoices", missingLegacyIds: ["private-local-id"], extraLegacyIds: ["private-cloud-id"] }] } },
    });
    ["decision.mismatch: true", "decision.cloudOnlyRowsDetected: true",
      "onboardingStatus.status: local_cloud_mismatch", "onboardingStatus.code: verification_mismatch",
      "onboardingStatus.reason: cloud_only_rows", "verification.ok: false", "verification.allMatched: false",
      "verification.tableResults[0].table: invoices", "verification.tableResults[0].missingLegacyIds.length: 1",
      "verification.tableResults[0].extraLegacyIds.length: 1",
    ].forEach(text => expect(panel).toHaveTextContent(text));
    expect(panel).not.toHaveTextContent("private-local-id");
    expect(panel).not.toHaveTextContent("private-cloud-id");
  });

  test("local blocker shows codes and summary counts without details", () => {
    const blocker = { code: "empty_estimates_with_invoices", details: payload };
    const panel = show({ decision: { firstBlocker: blocker, cloudUnrestorable: true, verifiedCurrent: false },
      localIntegrity: { blockers: [blocker], summary: { blockersCount: 1, warningsCount: 2, repairsAvailableCount: 3 } } });
    ["decision.firstBlocker.code: empty_estimates_with_invoices",
      "localIntegrity.firstBlocker.code: empty_estimates_with_invoices",
      "decision.cloudUnrestorable: true", "decision.verifiedCurrent: false",
      "localIntegrity.blockersCount: 1", "localIntegrity.warningsCount: 2", "localIntegrity.repairsAvailableCount: 3",
    ].forEach(text => expect(panel).toHaveTextContent(text));
    secrets.forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test("device lock and convergence show safe codes and counts without identifiers", () => {
    const panel = show({
      deviceLock: { isLocked: true, code: "device_not_active", localDeviceId: "private-device-id", token: secrets[3] },
      convergenceResult: { status: "mismatch", code: "verification_mismatch", payload,
        mismatch: { repairableMismatchOnly: true, repairTypes: ["estimate_restore_payload"],
          repairDocumentIds: ["private-document-id"] } },
    });
    ["deviceLock.isLocked: true", "deviceLock.code: device_not_active", "convergenceResult.status: mismatch",
      "convergenceResult.code: verification_mismatch", "convergenceResult.mismatch.repairableMismatchOnly: true",
      "convergenceResult.mismatch.repairTypes: estimate_restore_payload",
      "convergenceResult.mismatch.repairDocumentIds.length: 1",
    ].forEach(text => expect(panel).toHaveTextContent(text));
    expect(panel).not.toHaveTextContent("private-device-id");
    expect(panel).not.toHaveTextContent("private-document-id");
  });

  test("production hides diagnostic and retains the contractor sync message", () => {
    process.env.NODE_ENV = "production";
    const eligibility = jest.spyOn(convergence, "getHistoricalWorkspaceBaselineEligibility");
    const templateCapture = jest.spyOn(convergence, "readHistoricalTemplateCaptureStatus");
    const reads = jest.spyOn(Storage.prototype, "getItem");
    useCloudBackupStatus.mockReturnValue(cloudStatus({ productState: "sync_issue", decision: { ledgerFailed: true }, mutationLedger: failedLedger() }));
    render(<AdvancedSettingsScreen />);
    expect(screen.queryByRole("region", { name: "Development Sync Diagnostic" })).not.toBeInTheDocument();
    expect(screen.getByText("Sync issue")).toBeInTheDocument();
    expect(screen.getByText("EstiPaid is having trouble syncing. Your changes are saved on this device and EstiPaid will retry automatically.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("invoice_mutation_failed");
    expect(document.body).not.toHaveTextContent("activeMutations[");
    expect(document.body).not.toHaveTextContent("historicalBaselineEligible");
    expect(document.body).not.toHaveTextContent("historicalBundleProof");
    expect(document.body).not.toHaveTextContent("persistedQueue");
    expect(eligibility).not.toHaveBeenCalled();
    expect(templateCapture).not.toHaveBeenCalled();
    expect(reads.mock.calls.filter(([key]) => [STORAGE_KEYS.CLOUD_MUTATION_LEDGER, STORAGE_KEYS.CLOUD_BACKUP_QUEUE,
      STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL].includes(key))).toEqual([]);
  });

  test("render is read only across retry, queue, ledger, cloud, restore, repair, storage and vault owners", () => {
    const targets = [
      ["../lib/cloudBackupQueue", ["markCloudBackupDirty", "clearCloudBackupDirty", "markCloudBackupSyncing", "applyCloudBackupResultToQueue"]],
      ["../lib/cloudMutationLedger", ["requeueCloudMutationForManualRetry", "requeueCloudMutationForAutomaticRetry", "recordCloudMutationFailure", "buildWorkspaceBaselineRetiredLedger", "reconcileSupersededParentMissingMutations"]],
      ["../lib/useCloudAutoBackup", ["requestCloudAutoBackupRun"]],
      ["../lib/supabaseCloudMutationWriter", ["runSupabaseCloudMutationWrite"]],
      ["../lib/supabaseCloudConvergence", ["requestCloudConvergence", "runSupabaseCloudConvergence", "recoverInterruptedCloudConvergence"]],
      ["../lib/supabaseCloudVerification", ["runSupabaseCloudVerification"]],
      ["../lib/localDataIntegrity", ["repairStoredLocalDataIntegrity", "applySafeLocalDataRepairs"]],
      ["../lib/vaultRuntimeStore", ["runtimeCommitAtomicRecords", "runtimeSetItem", "runtimeRemoveItem"]],
    ];
    const spies = targets.flatMap(([path, names]) => {
      const module = require(path);
      return names.map(name => jest.spyOn(module, name).mockImplementation(jest.fn()));
    });
    const writes = ["setItem", "removeItem", "clear"].map(name => jest.spyOn(Storage.prototype, name));
    const indexedWrites = ["put", "add", "delete", "clear"].map(name => jest.spyOn(IDBObjectStore.prototype, name));
    const refresh = jest.fn();
    const panel = show({ mutationLedger: failedLedger(), decision: { ledgerFailed: true }, refreshCloudStatus: refresh });
    expect(panel.querySelector("button, input, select, a")).toBeNull();
    [...spies, ...writes, ...indexedWrites, refresh, executeSupabaseCloudRestore,
      previewSupabaseCloudRestore, checkSupabaseCloudOnboardingStatus].forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  test("payloads, identities, messages and unsafe code values are redacted", () => {
    const panel = show({
      queueState: { status: "needs_attention", payload, lastError: secrets[0], lastErrorCode: secrets[3], userId: "private-user-id" },
      mutationLedger: failedLedger(),
      decision: { firstBlocker: { code: "empty_estimates_with_invoices", details: payload }, payload },
      onboardingStatus: { status: "local_cloud_mismatch", reason: secrets[2], payload },
      localIntegrity: { blockers: [{ code: "empty_estimates_with_invoices", details: payload }], payload },
      restorePreview: { payload },
    });
    [...secrets, "private-user-id", "private-document-id", "private-company-id", "private-mutation-id",
      "[object Object]"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
    expect(panel).toHaveTextContent("queueState.lastErrorCode: unavailable");
    expect(panel).toHaveTextContent("onboardingStatus.reason: unavailable");
    expect(panel).toHaveTextContent("workerRunning: unavailable");
  });

  test("all active persisted entries expose only the requested scalars and identity-match booleans", () => {
    jest.spyOn(workspaceStorage, "getActiveAccountWorkspaceIdentity").mockReturnValue({ userId: "private-current-user", companyId: "private-current-company" });
    const entries = [
      { ...failedLedger().entries[0], mutationId: "private-mutation-a", documentId: "private-document-a", companyId: "private-current-company",
        entityType: "estimate", lastErrorCode: "projects_parent_missing", createdAt: 100, lastAttemptAt: 200, nextRetryAt: null, retryCount: 298,
        payload: { ...payload, id: "private-document-a", amount: 9384007, address: "PRIVATE_ADDRESS", notes: "PRIVATE_NOTES" } },
      { ...failedLedger().entries[0], mutationId: "private-mutation-b", documentId: "private-document-b", companyId: "private-other-company",
        entityType: "customer", status: "pending", createdAt: 101, lastAttemptAt: null, nextRetryAt: 500,
        payload: { ...payload, id: "private-different-payload-id" } },
      { ...failedLedger().entries[0], mutationId: "private-mutation-c", documentId: "private-document-c", companyId: "",
        entityType: "project", status: "retry_wait", createdAt: 102, lastAttemptAt: 202, nextRetryAt: 501, payload },
      { ...failedLedger().entries[0], mutationId: "private-mutation-d", documentId: "private-document-d", companyId: "private-current-company",
        operation: "delete", status: "syncing", createdAt: 103, lastAttemptAt: 203, nextRetryAt: null,
        payload: { ...payload, id: "private-document-d", company_id: "private-other-company" } },
      { ...failedLedger().entries[0], status: "acknowledged", retryCount: 987654 },
      { ...failedLedger().entries[0], status: "retired", retryCount: 987655 },
    ];
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({ entries }));
    const panel = show({ mutationLedger: failedLedger() });
    expect(panel).toHaveTextContent("mutationLedger.activeEntriesSource: persisted");
    expect(panel).toHaveTextContent("mutationLedger.activeEntriesCount: 4");
    entries.slice(0, 4).forEach((entry, index) => {
      ["entityType", "operation", "status", "lastErrorCode", "createdAt", "lastAttemptAt", "nextRetryAt", "retryCount"]
        .forEach(key => expect(panel).toHaveTextContent(`activeMutations[${index}].${key}: ${String(entry[key])}`));
    });
    expect(panel).not.toHaveTextContent("activeMutations[4]");
    expect(panel).not.toHaveTextContent("987654"); expect(panel).not.toHaveTextContent("987655");
    ["true", "false", "unavailable", "true"].forEach((value, index) => expect(panel).toHaveTextContent(`activeMutations[${index}].documentIdEqualsPayloadId: ${value}`));
    ["true", "false", "unavailable", "false"].forEach((value, index) => expect(panel).toHaveTextContent(`activeMutations[${index}].companyIdentityMatchesCurrentWorkspace: ${value}`));
    [...secrets, "private-current-user", "private-current-company", "private-other-company", "private-document", "private-mutation",
      "private-different-payload-id", "PRIVATE_ADDRESS", "PRIVATE_NOTES", "9384007", "payload.id:", "mutationId:", "documentId:", "companyId:", "userId:", "[object Object]", "{\"entries\""]
      .forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test("queue metadata includes persisted review provenance without normalizing or rewriting it", () => {
    const queue = { schemaVersion: "4.0.0", pending: false, status: "clean", purpose: "legacy_compatibility",
      reviewOrigin: "current_sync_failure", syncingRevision: null, nextRetryAt: null, createdAt: 100, updatedAt: 200,
      lastQueuedAt: 120, lastAttemptAt: 150, compatibilityMaterializedAt: 180, payload, companyId: "private-queue-company" };
    const serialized = JSON.stringify(queue);
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, serialized);
    const writes = jest.spyOn(Storage.prototype, "setItem");
    const panel = show({ queueState: { ...queue, reviewOrigin: "" } });
    ["schemaVersion", "reviewOrigin", "syncingRevision", "nextRetryAt", "createdAt", "updatedAt", "lastQueuedAt", "lastAttemptAt", "compatibilityMaterializedAt"]
      .forEach(key => expect(panel).toHaveTextContent(`persistedQueue.${key}: ${String(queue[key])}`));
    expect(panel).toHaveTextContent("persistedQueue.readAvailable: true");
    expect(panel).toHaveTextContent("queueState.schemaVersion: 4.0.0");
    expect(panel).toHaveTextContent("queueState.syncingRevision: null");
    expect(panel).not.toHaveTextContent("private-queue-company");
    secrets.forEach(secret => expect(panel).not.toHaveTextContent(secret));
    expect(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBe(serialized);
    expect(writes).not.toHaveBeenCalled();
  });

  test.each([false, true])("operational record presence is boolean-only, present=%s", present => {
    if (present) {
      localStorage.setItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, JSON.stringify({ token: secrets[3], payload }));
      localStorage.setItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, JSON.stringify({ businessName: secrets[0] }));
      localStorage.setItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, "null");
    }
    const panel = show();
    ["cloudAutoBackupPausePresent", "partialRecoveryStatusPresent", "convergenceJournalPresent"]
      .forEach(key => {
        const row = [...panel.querySelectorAll("div")].find(node => node.children.length === 0 && node.textContent.startsWith(`${key}:`));
        expect(row.textContent).toBe(`${key}: ${String(present)}`);
      });
    expect(panel).toHaveTextContent("operationalPresenceReadAvailable: true");
    secrets.forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test("classification values come from the existing read-only production predicates", () => {
    jest.spyOn(workspaceStorage, "getActiveAccountWorkspaceIdentity").mockReturnValue({ companyId: "private-current-company" });
    const ledger = failedLedger();
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
    const queue = { schemaVersion: "4.0.0", pending: false, status: "clean", purpose: "legacy_compatibility", reviewOrigin: "current_sync_failure" };
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(queue));
    const eligibility = jest.spyOn(convergence, "getHistoricalWorkspaceBaselineEligibility");
    const expectedBaseline = convergence.canVerifyHistoricalWorkspaceResidue({ storage: localStorage, companyId: "private-current-company" });
    const expectedShape = getHistoricalWorkspaceBaselineCandidates(ledger, { companyId: "private-current-company", before: Date.now() }).length > 0;
    const expectedQueue = isInactiveWorkspaceBaselineQueue(queue, { companyId: "private-current-company", before: Date.now() });
    const before = [localStorage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER), localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)];
    const panel = show();
    expect(eligibility).toHaveBeenCalledWith({ storage: localStorage, companyId: "private-current-company" });
    expect(panel).toHaveTextContent(`historicalBaselineEligible: ${expectedBaseline}`);
    const explanation = convergence.getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: "private-current-company" });
    expect(panel).toHaveTextContent(`historicalBaselineEligibilityCode: ${explanation.code}`);
    expect(panel).toHaveTextContent(`historicalBaselineEligibilityFamily: ${explanation.family}`);
    expect(panel).toHaveTextContent(`historicalFailureShapeEligible: ${expectedShape}`);
    expect(panel).toHaveTextContent(`inactiveWorkspaceBaselineQueue: ${expectedQueue}`);
    expect(panel).toHaveTextContent("hasCurrentDurableLedgerWork: true");
    expect(panel).toHaveTextContent("hasPendingLocalBackup: false");
    expect(panel).toHaveTextContent("hasUnacknowledgedDelete: false");
    expect([localStorage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER), localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)]).toEqual(before);
  });

  test("unavailable identities and malformed persisted records never reveal values or throw", () => {
    jest.spyOn(workspaceStorage, "getActiveAccountWorkspaceIdentity").mockReturnValue({});
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, "{invalid-secret-json");
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, "{invalid-secret-queue");
    const panel = show({ mutationLedger: failedLedger() });
    expect(panel).toHaveTextContent("activeMutations[0].companyIdentityMatchesCurrentWorkspace: unavailable");
    expect(panel).toHaveTextContent("activeMutations[0].documentIdEqualsPayloadId: unavailable");
    expect(panel).toHaveTextContent("persistedQueue.schemaVersion: unavailable");
    expect(panel).toHaveTextContent("historicalBaselineEligible: unavailable");
    expect(panel).not.toHaveTextContent("invalid-secret");
  });

  test.each(["audit_events", "settings", "scope_templates"])("the existing classifier supplies sanitized %s rejection evidence only", family => {
    jest.spyOn(workspaceStorage, "getActiveAccountWorkspaceIdentity").mockReturnValue({ companyId: "private-current-company" });
    const eligibility = jest.spyOn(convergence, "getHistoricalWorkspaceBaselineEligibility")
      .mockReturnValue({ eligible: false, code: "workspace_artifact_unsupported_shape", family });
    const writes = ["setItem", "removeItem", "clear"].map(name => jest.spyOn(Storage.prototype, name));
    const panel = show();
    expect(eligibility).toHaveBeenCalledWith({ storage: localStorage, companyId: "private-current-company" });
    expect(panel).toHaveTextContent("historicalBaselineEligible: false");
    expect(panel).toHaveTextContent("historicalBaselineEligibilityCode: workspace_artifact_unsupported_shape");
    expect(panel).toHaveTextContent(`historicalBaselineEligibilityFamily: ${family}`);
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    [...secrets, "private-current-company", "private-document-id"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test("bundle proof shows exact safe gates, family, shapes and match booleans read only", () => {
    const writes = ["setItem", "removeItem", "clear"].map(name => jest.spyOn(Storage.prototype, name));
    const panel = show({ convergenceResult: { status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
      code: "settings_mismatch", family: "settings", snapshotAvailable: true, supplementalStatus: "available",
      companyProfileMatched: true, settingsMatched: false, scopeTemplatesMatched: true, localShape: "object", cloudShape: "object",
      payload, companyId: "private-company-id", mutationId: "private-mutation-id",
    } } });
    ["code: settings_mismatch", "family: settings", "snapshotAvailable: true", "supplementalStatus: available",
      "companyProfileMatched: true", "settingsMatched: false", "scopeTemplatesMatched: true", "localShape: object", "cloudShape: object"]
      .forEach(value => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${value}`));
    [...secrets, "private-company-id", "private-mutation-id"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    expect(panel.querySelector("button, input, select, a")).toBeNull();
  });

  test("bundle proof unavailable checks and unsafe values never disclose error or business content", () => {
    const panel = show({ convergenceResult: { status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
      code: secrets[0], family: "private-document-id", snapshotAvailable: null, supplementalStatus: { payload },
      companyProfileMatched: null, settingsMatched: null, scopeTemplatesMatched: null, localShape: payload, cloudShape: secrets[3], payload,
    } } });
    ["code", "family", "snapshotAvailable", "supplementalStatus", "companyProfileMatched", "settingsMatched", "scopeTemplatesMatched", "localShape", "cloudShape"]
      .forEach(key => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${key}: unavailable`));
    [...secrets, "private-document-id", "[object Object]"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
  });

  test.each([
    ["cloud_snapshot_unavailable", false, "unavailable"],
    ["app_restore_bundle_missing", true, "missing"],
    ["app_restore_bundle_invalid", true, "invalid"],
    ["app_restore_bundle_error", true, "error"],
    ["app_restore_bundle_unavailable", true, "unavailable"],
  ])("%s remains distinguishable from an evaluated content mismatch", (code, snapshotAvailable, supplementalStatus) => {
    const result = convergence.buildSafeConvergenceResult({ status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
      code, family: "none", snapshotAvailable, supplementalStatus,
      companyProfileMatched: null, settingsMatched: null, scopeTemplatesMatched: null,
      localShape: "unavailable", cloudShape: "unavailable",
    } });
    const panel = show({ convergenceResult: result });
    [`code: ${code}`, "family: none", `snapshotAvailable: ${snapshotAvailable}`, `supplementalStatus: ${supplementalStatus}`,
      "companyProfileMatched: unavailable", "settingsMatched: unavailable", "scopeTemplatesMatched: unavailable"]
      .forEach(value => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${value}`));
    expect(panel).not.toHaveTextContent("settings_mismatch");
  });

  test("completed bundle matching displays the existing successful proof without initiating remediation", () => {
    const result = convergence.buildSafeConvergenceResult({ ok: true, status: "matched", historicalBundleProof: {
      code: "matched", family: "none", snapshotAvailable: true, supplementalStatus: "available",
      companyProfileMatched: true, settingsMatched: true, scopeTemplatesMatched: true,
      localShape: "unavailable", cloudShape: "unavailable",
    } });
    const panel = show({ convergenceResult: result });
    ["code: matched", "family: none", "supplementalStatus: available", "companyProfileMatched: true", "settingsMatched: true", "scopeTemplatesMatched: true"]
      .forEach(value => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${value}`));
    expect(panel.querySelector("button, input, select, a")).toBeNull();
  });

  test("both portable families expose independent classifications without keys, content, identifiers or actions", () => {
    const flags = { localOnlyFields: false, cloudOnlyFields: false, differentValues: false, orderingDifference: false,
      localOnlyRecords: false, cloudOnlyRecords: false, serializationOnly: false, phoneFormattingEquivalent: false,
      collectionOrderEquivalent: false, unsupportedShape: false, identityIssue: false };
    const profile = { ...flags, classification: "mixed_difference", localOnlyFields: true, differentValues: true };
    const templates = { ...flags, classification: "ordering_difference", orderingDifference: true };
    const result = convergence.buildSafeConvergenceResult({ status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
      code: "company_profile_mismatch", family: "company_profile", companyProfileMatched: false, scopeTemplatesMatched: false,
      companyProfileDifference: { ...profile, PRIVATE_FIELD_NAME: secrets[0], payload, companyId: "private-company-id" },
      scopeTemplatesDifference: { ...templates, templateId: "private-template-id", payload },
    } });
    const writes = ["setItem", "removeItem", "clear"].map(name => jest.spyOn(Storage.prototype, name));
    const panel = show({ convergenceResult: result });
    [["companyProfileDifference", profile], ["scopeTemplatesDifference", templates]].forEach(([family, detail]) => {
      Object.entries(detail).forEach(([key, value]) => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${family}.${key}: ${value}`));
    });
    [...secrets, "PRIVATE_FIELD_NAME", "private-company-id", "private-template-id", "[object Object]"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    expect(panel.querySelector("button, input, select, a")).toBeNull();
  });

  test("unavailable family classifications remain unavailable rather than implying a match", () => {
    const panel = show({ convergenceResult: { status: "skipped", code: "workspace_bundle_not_matched" } });
    ["companyProfileDifference", "scopeTemplatesDifference"].forEach(family => {
      ["classification", "localOnlyFields", "cloudOnlyFields", "differentValues", "orderingDifference", "localOnlyRecords", "cloudOnlyRecords",
        "serializationOnly", "phoneFormattingEquivalent", "collectionOrderEquivalent", "unsupportedShape", "identityIssue"]
        .forEach(key => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.${family}.${key}: unavailable`));
    });
  });

  test("precise profile field keys and template capture status are visible without private values or sensitive key names", () => {
    const result = convergence.buildSafeConvergenceResult({ status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
      companyProfileDifference: { classification: "cloud_only_fields", cloudOnlyFields: true,
        localOnlyFieldKeys: [], cloudOnlyFieldKeys: ["attn", "terms", "accessToken", "encryptedContents", "PRIVATE_USER_KEY"], differingFieldKeys: ["phone"],
        payload, values: secrets, companyId: "private-company-id" },
      scopeTemplateCapture: { localStatus: "captured_empty", cloudStatus: "uncaptured_null", historicalNullReason: "not_recorded_in_bundle" },
    } });
    localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, "[]");
    const writes = ["setItem", "removeItem", "clear"].map(name => jest.spyOn(Storage.prototype, name));
    const panel = show({ convergenceResult: result });
    ["localOnlyFieldKeys: none", "cloudOnlyFieldKeys: attn, terms", "differingFieldKeys: phone", "redactedFieldKeyCount: 3"]
      .forEach(value => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.companyProfileDifference.${value}`));
    ["localStatus: captured_empty", "cloudStatus: uncaptured_null", "historicalNullReason: not_recorded_in_bundle"]
      .forEach(value => expect(panel).toHaveTextContent(`convergenceResult.historicalBundleProof.scopeTemplateCapture.${value}`));
    expect(panel).toHaveTextContent("scopeTemplateCurrentLocalCaptureStatus: captured_empty");
    [...secrets, "accessToken", "encryptedContents", "PRIVATE_USER_KEY", "private-company-id", "[object Object]"].forEach(secret => expect(panel).not.toHaveTextContent(secret));
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
  });

  test("profile field renderer independently rejects unsafe keys and unavailable fields stay unavailable", () => {
    const panel = show({ convergenceResult: { historicalBundleProof: { companyProfileDifference: {
      cloudOnlyFieldKeys: ["attn", "password", "PRIVATE_FIELD_WITH_BUSINESS_VALUE", "stripeAccountId"],
    } } } });
    expect(panel).toHaveTextContent("companyProfileDifference.cloudOnlyFieldKeys: attn");
    expect(panel).toHaveTextContent("companyProfileDifference.localOnlyFieldKeys: unavailable");
    ["password", "PRIVATE_FIELD_WITH_BUSINESS_VALUE", "stripeAccountId"].forEach(value => expect(panel).not.toHaveTextContent(value));
  });

  test.each([[null, "missing_source_storage"], ["{broken", "malformed_stored_data"], ["null", "unsupported_storage_shape"], ["[]", "captured_empty"]])(
    "current local template capture is independently reported without stored content", (raw, status) => {
      if (raw != null) localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, raw);
      const panel = show();
      expect(panel).toHaveTextContent(`scopeTemplateCurrentLocalCaptureStatus: ${status}`);
    }
  );
});
