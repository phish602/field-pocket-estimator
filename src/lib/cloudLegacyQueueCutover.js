// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  CLOUD_BACKUP_QUEUE_PURPOSE,
  CLOUD_BACKUP_STATUS,
  isLegacyCompatibilityQueue,
  readCloudBackupQueueState,
} from "./cloudBackupQueue";
import {
  appendCloudMutationRecords,
  CLOUD_MUTATION_ENTITY,
  CLOUD_MUTATION_OPERATION,
  readCloudMutationLedger,
} from "./cloudMutationLedger";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { cloudSyncEqual, readCloudSyncBaseline } from "./cloudSyncBaseline";
import { buildImmutableAppRestoreBundleMutation } from "./businessCloudMutationOwners";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import { hasEmptyCoreBusinessSnapshot } from "./cloudOperationOwnership";

const asText = (value) => String(value || "").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

const FAMILY_ENTITY = Object.freeze({
  customers: CLOUD_MUTATION_ENTITY.CUSTOMER,
  projects: CLOUD_MUTATION_ENTITY.PROJECT,
  estimates: CLOUD_MUTATION_ENTITY.ESTIMATE,
  invoices: CLOUD_MUTATION_ENTITY.INVOICE,
});

// The schema holds these families together with ON DELETE RESTRICT foreign keys
// (project/estimate/invoice -> customer, estimate/invoice -> project, invoice ->
// estimate). One family order therefore cannot serve both operations: an UPSERT
// needs its parents to exist first, while a DELETE needs its dependents gone
// first. Emitting a customer delete ahead of the project, estimate, and invoice
// deletes that reference it makes a correct, baseline-proven delete fail on a
// foreign key. Which mutations qualify is decided below and is unchanged -- only
// the order they are emitted in comes from here.
const UPSERT_FAMILY_ORDER = Object.freeze(["customers", "projects", "estimates", "invoices"]);
const DELETE_FAMILY_ORDER = Object.freeze(["invoices", "estimates", "projects", "customers"]);

function byId(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.id), row]).filter(([id]) => Boolean(id)));
}

export function buildLegacyCompatibilityMaterializationMutations({ snapshot = {}, baseline = null, companyId = "" } = {}) {
  const mutations = [];
  const baselineSnapshots = baseline?.snapshots && typeof baseline.snapshots === "object" ? baseline.snapshots : null;

  // Parent-first: a dependent upsert can only land once its parent row exists.
  UPSERT_FAMILY_ORDER.forEach((family) => {
    const entityType = FAMILY_ENTITY[family];
    const currentById = byId(snapshot?.[family]);
    const baselineById = byId(baselineSnapshots?.[family]);
    currentById.forEach((record, documentId) => {
      const previous = baselineById.get(documentId);
      if (previous && cloudSyncEqual(previous, record)) return;
      mutations.push({
        companyId: asText(companyId), entityType, documentId,
        operation: CLOUD_MUTATION_OPERATION.UPSERT,
        reason: "legacy_compatibility_cutover",
        source: "materializeLegacyCompatibilityQueue",
        payload: clone(record),
      });
    });
  });

  // Child-first, and ONLY for a record the verified baseline proved existed and
  // that is now absent locally. Without a usable baseline nothing is inferred.
  if (baselineSnapshots) {
    DELETE_FAMILY_ORDER.forEach((family) => {
      const entityType = FAMILY_ENTITY[family];
      const currentById = byId(snapshot?.[family]);
      const baselineById = byId(baselineSnapshots?.[family]);
      baselineById.forEach((_record, documentId) => {
        if (currentById.has(documentId)) return;
        mutations.push({
          companyId: asText(companyId), entityType, documentId,
          operation: CLOUD_MUTATION_OPERATION.DELETE,
          reason: "legacy_compatibility_proven_delete",
          source: "materializeLegacyCompatibilityQueue",
          payload: { id: documentId, legacyLocalId: documentId, baselineVerifiedAt: baseline?.verifiedAt || null },
        });
      });
    });
  }

  const bundleChanged = !baselineSnapshots || !cloudSyncEqual(
    { companyProfile: baselineSnapshots.companyProfile ?? null, settings: baselineSnapshots.settings ?? null, scopeTemplates: baselineSnapshots.scopeTemplates ?? [] },
    { companyProfile: snapshot.companyProfile ?? null, settings: snapshot.settings ?? null, scopeTemplates: snapshot.scopeTemplates ?? [] }
  );
  if (bundleChanged) {
    mutations.push(buildImmutableAppRestoreBundleMutation({
      writes: [
        { key: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify(snapshot.companyProfile ?? null) },
        { key: STORAGE_KEYS.SETTINGS, value: JSON.stringify(snapshot.settings ?? null) },
        { key: STORAGE_KEYS.SCOPE_TEMPLATES, value: JSON.stringify(snapshot.scopeTemplates ?? []) },
      ], companyId,
      reason: "legacy_compatibility_app_bundle_cutover",
      source: "materializeLegacyCompatibilityQueue",
    }));
  }
  return Object.freeze(mutations);
}

export async function materializeLegacyCompatibilityQueue({ storage = localStorage, companyId = "" } = {}) {
  const queue = readCloudBackupQueueState();
  if (!queue?.pending || !isLegacyCompatibilityQueue(queue)) return { ok: true, materialized: false, code: "legacy_queue_not_pending", queue };
  const revision = Number(queue.localMutationRevision || 0);
  if (Number(queue.compatibilityMaterializedRevision) === revision) return { ok: true, materialized: false, code: "legacy_generation_already_materialized", queue };
  const { snapshot } = buildLocalSnapshotFromStorage(storage);
  const baseline = readCloudSyncBaseline(companyId, storage);
  if (hasEmptyCoreBusinessSnapshot(snapshot) && !baseline?.snapshots) {
    return { ok: false, materialized: false, code: "empty_legacy_deletion_unproven", queue };
  }
  const mutations = buildLegacyCompatibilityMaterializationMutations({ snapshot, baseline, companyId });
  const ledgerAppend = appendCloudMutationRecords(readCloudMutationLedger(storage), mutations);
  const at = Date.now();
  const evidence = {
    sourceSchemaVersion: queue.schemaVersion,
    revision,
    status: queue.status,
    reasons: Array.isArray(queue.reasons) ? [...queue.reasons] : [],
    domains: Array.isArray(queue.domains) ? [...queue.domains] : [],
    documentId: asText(queue.documentId),
    lastError: asText(queue.lastError),
    lastErrorCode: asText(queue.lastErrorCode),
    reviewOrigin: asText(queue.reviewOrigin),
    lastQueuedAt: Number(queue.lastQueuedAt || 0) || null,
    materializedMutationCount: mutations.length,
  };
  const retired = {
    ...queue,
    pending: false,
    status: CLOUD_BACKUP_STATUS.CLEAN,
    purpose: CLOUD_BACKUP_QUEUE_PURPOSE.LEGACY_COMPATIBILITY,
    compatibilityMaterializedRevision: revision,
    compatibilityMaterializedAt: at,
    legacyCompatibilityEvidence: evidence,
    syncingRevision: null,
    nextRetryAt: null,
    retryCount: 0,
    updatedAt: at,
  };
  await runtimeCommitAtomicRecords([
    { logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(ledgerAppend.ledger) },
    { logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify(retired) },
  ]);
  return { ok: true, materialized: true, code: "", queue: retired, mutations: ledgerAppend.appended };
}
