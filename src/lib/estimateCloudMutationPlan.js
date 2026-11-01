// @ts-nocheck
/* eslint-disable */

import { commitAtomicCloudQueuedBusinessMutation } from "./cloudBackupQueue";
import { CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION } from "./cloudMutationLedger";
import { cloudSyncEqual } from "./cloudSyncBaseline";
import { normalizeEstimateContract } from "./supabaseCloudConvergence";

const asText = (value) => String(value || "").trim();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function estimateRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .filter((record) => String(record?.docType || "estimate").toLowerCase() !== "invoice");
}

// Both estimate save owners delegate to this one diff contract. It reuses the
// canonical estimate cloud contract, including the exact accepted local
// document carried by restore_payload, so no second estimate-equality
// vocabulary is introduced.
export function buildEstimateCloudMutationPlan(previousEstimates, nextEstimates, event = {}) {
  const previous = estimateRecords(previousEstimates);
  const next = estimateRecords(nextEstimates);
  const previousById = new Map(previous.map((estimate) => [asText(estimate?.id), estimate]).filter(([id]) => Boolean(id)));
  const nextIds = new Set(next.map((estimate) => asText(estimate?.id)).filter(Boolean));
  const deletionMutations = previous.flatMap((estimate) => {
    const documentId = asText(estimate?.id);
    if (!documentId || nextIds.has(documentId)) return [];
    return [{
      companyId: asText(event?.companyId),
      entityType: CLOUD_MUTATION_ENTITY.ESTIMATE,
      documentId,
      operation: CLOUD_MUTATION_OPERATION.DELETE,
      reason: asText(event?.reason) || "estimate_deleted",
      source: asText(event?.source) || "commitStoredEstimates",
      payload: { id: documentId, legacyLocalId: documentId },
    }];
  });
  const upsertMutations = next.flatMap((estimate) => {
    const documentId = asText(estimate?.id);
    if (!documentId) return [];
    const before = previousById.get(documentId);
    if (before && cloudSyncEqual(normalizeEstimateContract(before), normalizeEstimateContract(estimate))) return [];
    return [{
      companyId: asText(event?.companyId),
      entityType: CLOUD_MUTATION_ENTITY.ESTIMATE,
      documentId,
      operation: CLOUD_MUTATION_OPERATION.UPSERT,
      reason: asText(event?.reason) || "estimate_data_saved",
      source: asText(event?.source) || "commitStoredEstimates",
      payload: clone(estimate),
    }];
  });
  const mutations = [...deletionMutations, ...upsertMutations];
  const deletionDetected = deletionMutations.length > 0;
  return Object.freeze({ previous, next, deletionDetected, mutations: Object.freeze(mutations) });
}

export async function commitStoredEstimateCollectionMutation({
  previousEstimates = [],
  nextEstimates = [],
  writes = [],
  event = {},
} = {}) {
  const plan = buildEstimateCloudMutationPlan(previousEstimates, nextEstimates, event);
  const stagedWrites = Array.isArray(writes) ? writes : [];
  const allWritesAlreadyStored = stagedWrites.every((write) => {
    try { return localStorage.getItem(write?.key) === write?.value; } catch { return false; }
  });
  if (!plan.mutations.length && !plan.deletionDetected && allWritesAlreadyStored) {
    return Object.freeze({ ok: true, noOp: true, ledgerBacked: false, mutations: Object.freeze([]), keys: Object.freeze([]) });
  }
  return commitAtomicCloudQueuedBusinessMutation({
    writes: stagedWrites,
    event,
    ledgerMutations: plan.mutations,
    skipGlobalQueue: true,
  });
}
