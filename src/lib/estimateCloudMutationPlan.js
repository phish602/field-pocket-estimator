// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitAtomicCloudQueuedBusinessMutation } from "./cloudBackupQueue";
import { CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION } from "./cloudMutationLedger";
import { cloudSyncEqual } from "./cloudSyncBaseline";
import { normalizeEstimateContract, normalizeProjectContract } from "./supabaseCloudConvergence";

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

function readProjectList(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("invalid_staged_projects");
  return parsed.filter(Boolean);
}

// A document save can stage the project list in the same atomic commit (the
// builder creates or updates the document's project). That staged list is what
// gets stored, so it must be covered by project mutations exactly as a direct
// project save would be. Equality is the persisted cloud project contract, so a
// save that only advances a project's local activity clock queues nothing.
// Upserts run ahead of the documents that reference them; deletes run after.
export function buildStagedProjectCloudMutationPlan(writes = [], event = {}) {
  const projectWrite = [...(Array.isArray(writes) ? writes : [])].reverse().find((write) => write?.key === STORAGE_KEYS.PROJECTS);
  if (!projectWrite) return Object.freeze({ upserts: Object.freeze([]), deletes: Object.freeze([]) });
  const previous = readProjectList(localStorage.getItem(STORAGE_KEYS.PROJECTS));
  const next = readProjectList(projectWrite.value);
  const previousById = new Map(previous.map((project) => [asText(project?.id), project]).filter(([id]) => Boolean(id)));
  const nextIds = new Set(next.map((project) => asText(project?.id)).filter(Boolean));
  const base = {
    companyId: asText(event?.companyId),
    entityType: CLOUD_MUTATION_ENTITY.PROJECT,
    source: asText(event?.source) || "commitStoredProjects",
  };
  const upserts = next.flatMap((project) => {
    const documentId = asText(project?.id);
    if (!documentId) return [];
    const before = previousById.get(documentId);
    if (before && cloudSyncEqual(normalizeProjectContract(before), normalizeProjectContract(project))) return [];
    return [{ ...base, documentId, operation: CLOUD_MUTATION_OPERATION.UPSERT, reason: asText(event?.projectReason) || "project_data_saved", payload: clone(project) }];
  });
  const deletes = [...previousById.keys()].flatMap((documentId) => {
    if (nextIds.has(documentId)) return [];
    return [{ ...base, documentId, operation: CLOUD_MUTATION_OPERATION.DELETE, reason: "project_data_saved_deleted", payload: { id: documentId, legacyLocalId: documentId } }];
  });
  return Object.freeze({ upserts: Object.freeze(upserts), deletes: Object.freeze(deletes) });
}

export async function commitStoredEstimateCollectionMutation({
  previousEstimates = [],
  nextEstimates = [],
  writes = [],
  event = {},
} = {}) {
  const plan = buildEstimateCloudMutationPlan(previousEstimates, nextEstimates, event);
  const stagedWrites = Array.isArray(writes) ? writes : [];
  const projectPlan = buildStagedProjectCloudMutationPlan(stagedWrites, event);
  const ledgerMutations = [...projectPlan.upserts, ...plan.mutations, ...projectPlan.deletes];
  const allWritesAlreadyStored = stagedWrites.every((write) => {
    try { return localStorage.getItem(write?.key) === write?.value; } catch { return false; }
  });
  if (!ledgerMutations.length && !plan.deletionDetected && allWritesAlreadyStored) {
    return Object.freeze({ ok: true, noOp: true, ledgerBacked: false, mutations: Object.freeze([]), keys: Object.freeze([]) });
  }
  return commitAtomicCloudQueuedBusinessMutation({
    writes: stagedWrites,
    event,
    ledgerMutations,
    skipGlobalQueue: true,
  });
}
