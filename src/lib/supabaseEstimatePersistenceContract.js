// @ts-nocheck
/* eslint-disable */

// The single source of truth for the estimate fields the cloud writer actually
// persists. `mapLocalEstimateToBackendEstimate` produces a *backend draft* --
// a rich object carrying approved_total, grand_total, total, margins, timeline
// fields and line items. The Supabase `estimates` table stores a much narrower
// projection of that draft, and it collapses the three total candidates into a
// single `total_amount` column.
//
// Convergence evidence used to compare raw persisted rows straight against the
// backend draft, which asserted columns the writer never writes (total_amount)
// and demanded columns the writer never persists (approved_total). Both the
// writer and the evidence verifier now project through this contract, so the
// two can no longer drift apart.
//
// Relationship fields stay in legacy-id terms here: resolving them to cloud
// UUIDs needs the writer's per-run id maps, and the convergence snapshot
// resolves persisted UUIDs back to legacy ids before comparing.

const asText = (value) => String(value || "").trim();

// The writer-owned estimate columns, in table order. Anything absent from this
// list is either not written by mapEstimatePayloads (approved_total,
// grand_total, total, margins) or is not derivable from the backend draft alone
// (company_id, customer_id, project_id, restore_payload, audit columns).
export const PERSISTED_ESTIMATE_CONTRACT_FIELDS = Object.freeze([
  "legacy_local_id",
  "customer_legacy_local_id",
  "project_legacy_local_id",
  "estimate_number",
  "status",
  "total_amount",
  "notes",
  "terms",
  "converted_invoice_legacy_local_id",
]);

// The exact total rule the writer applies. The backend draft deletes null and
// empty values, so an absent approved_total falls through to grand_total, then
// total, then null.
export function persistedEstimateTotalAmount(backendEstimate) {
  return backendEstimate?.approved_total ?? backendEstimate?.grand_total ?? backendEstimate?.total ?? null;
}

export function buildPersistedEstimateContract(backendEstimate) {
  const estimate = backendEstimate && typeof backendEstimate === "object" ? backendEstimate : {};
  return {
    legacy_local_id: asText(estimate?.legacy_local_id),
    customer_legacy_local_id: asText(estimate?.customer_legacy_local_id),
    project_legacy_local_id: asText(estimate?.project_legacy_local_id),
    estimate_number: estimate?.estimate_number || null,
    status: estimate?.status || "pending",
    total_amount: persistedEstimateTotalAmount(estimate),
    notes: estimate?.notes || null,
    terms: estimate?.terms || null,
    converted_invoice_legacy_local_id: estimate?.converted_invoice_legacy_local_id || null,
  };
}
