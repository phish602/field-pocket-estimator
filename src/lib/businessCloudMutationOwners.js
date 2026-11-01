// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitAtomicCloudQueuedBusinessMutation } from "./cloudBackupQueue";
import {
  CLOUD_MUTATION_ENTITY,
  CLOUD_MUTATION_OPERATION,
} from "./cloudMutationLedger";
import { cloudSyncEqual } from "./cloudSyncBaseline";
import { getActiveAccountWorkspaceIdentity } from "./accountScopedLocalStorage";
import {
  buildSupabaseAppRestoreBundle,
  SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY,
  validateSupabaseAppRestoreBundle,
} from "./supabaseAppRestoreBundle";

const asText = (value) => String(value || "").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

export function resolveCloudMutationCompanyId(companyId = "") {
  return asText(companyId) || asText(getActiveAccountWorkspaceIdentity()?.companyId);
}

export function buildCollectionCloudMutationPlan({
  previous = [],
  next = [],
  entityType,
  companyId = "",
  reason = "business_data_saved",
  source = "canonical_business_commit",
} = {}) {
  if (![CLOUD_MUTATION_ENTITY.CUSTOMER, CLOUD_MUTATION_ENTITY.PROJECT].includes(entityType)) {
    throw new Error("unsupported_collection_mutation_owner");
  }
  const before = Array.isArray(previous) ? previous.filter(Boolean) : [];
  const after = Array.isArray(next) ? next.filter(Boolean) : [];
  const beforeById = new Map(before.map((record) => [asText(record?.id), record]).filter(([id]) => Boolean(id)));
  const afterById = new Map(after.map((record) => [asText(record?.id), record]).filter(([id]) => Boolean(id)));
  const workspaceId = resolveCloudMutationCompanyId(companyId);
  const mutations = [];

  afterById.forEach((record, documentId) => {
    const prior = beforeById.get(documentId);
    if (prior && cloudSyncEqual(prior, record)) return;
    mutations.push({
      companyId: workspaceId,
      entityType,
      documentId,
      operation: CLOUD_MUTATION_OPERATION.UPSERT,
      reason,
      source,
      payload: clone(record),
    });
  });

  beforeById.forEach((record, documentId) => {
    if (afterById.has(documentId)) return;
    mutations.push({
      companyId: workspaceId,
      entityType,
      documentId,
      operation: CLOUD_MUTATION_OPERATION.DELETE,
      reason: `${reason}_deleted`,
      source,
      payload: { id: documentId, legacyLocalId: documentId },
    });
  });

  return Object.freeze({ previous: before, next: after, mutations: Object.freeze(mutations) });
}

async function commitCollection({ previous, next, storageKey, entityType, event = {} }) {
  const reason = asText(event?.reason) || `${entityType}_data_saved`;
  const source = asText(event?.source) || `commitStored${entityType}`;
  const plan = buildCollectionCloudMutationPlan({
    previous,
    next,
    entityType,
    companyId: event?.companyId,
    reason,
    source,
  });
  const serialized = JSON.stringify(plan.next);
  if (!plan.mutations.length && localStorage.getItem(storageKey) === serialized) {
    return Object.freeze({ ok: true, noOp: true, ledgerBacked: false, mutations: Object.freeze([]), records: plan.next });
  }
  const committed = await commitAtomicCloudQueuedBusinessMutation({
    writes: [{ key: storageKey, value: serialized }],
    event: { ...event, reason, source },
    ledgerMutations: plan.mutations,
    skipGlobalQueue: true,
  });
  return Object.freeze({ ...committed, records: plan.next });
}

export function commitStoredCustomerCollectionMutation({ previousCustomers = [], nextCustomers = [], event = {} } = {}) {
  return commitCollection({
    previous: previousCustomers,
    next: nextCustomers,
    storageKey: STORAGE_KEYS.CUSTOMERS,
    entityType: CLOUD_MUTATION_ENTITY.CUSTOMER,
    event: { reason: "customer_data_saved", source: "commitStoredCustomers", ...event },
  });
}

export function commitStoredProjectCollectionMutation({ previousProjects = [], nextProjects = [], event = {} } = {}) {
  return commitCollection({
    previous: previousProjects,
    next: nextProjects,
    storageKey: STORAGE_KEYS.PROJECTS,
    entityType: CLOUD_MUTATION_ENTITY.PROJECT,
    event: { reason: "project_data_saved", source: "commitStoredProjects", ...event },
  });
}

function overlayStorage(writes = [], storage = localStorage) {
  const byKey = new Map((Array.isArray(writes) ? writes : []).map((write) => [asText(write?.key), write?.value]));
  return {
    getItem(key) {
      return byKey.has(key) ? byKey.get(key) : storage?.getItem?.(key) ?? null;
    },
  };
}

export function buildImmutableAppRestoreBundleMutation({ writes = [], companyId = "", reason = "app_restore_bundle_saved", source = "commitAppRestoreBundle" } = {}) {
  const captured = buildSupabaseAppRestoreBundle(overlayStorage(writes));
  const validation = validateSupabaseAppRestoreBundle(captured.bundle);
  if (!validation.valid) throw new Error("invalid_app_restore_bundle_mutation");
  return Object.freeze({
    companyId: resolveCloudMutationCompanyId(companyId),
    entityType: CLOUD_MUTATION_ENTITY.APP_RESTORE_BUNDLE,
    documentId: SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY,
    operation: CLOUD_MUTATION_OPERATION.UPSERT,
    reason,
    source,
    payload: Object.freeze({ bundle: clone(captured.bundle) }),
  });
}

export async function commitAppRestoreBundleBusinessMutation({ writes = [], event = {} } = {}) {
  const staged = Array.isArray(writes) ? writes : [];
  if (!staged.length) throw new Error("invalid_app_restore_bundle_business_write");
  const mutation = buildImmutableAppRestoreBundleMutation({
    writes: staged,
    companyId: event?.companyId,
    reason: asText(event?.reason) || "app_restore_bundle_saved",
    source: asText(event?.source) || "commitAppRestoreBundle",
  });
  return commitAtomicCloudQueuedBusinessMutation({
    writes: staged,
    event,
    ledgerMutations: [mutation],
    skipGlobalQueue: true,
  });
}
