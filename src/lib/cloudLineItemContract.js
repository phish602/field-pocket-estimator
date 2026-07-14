// @ts-nocheck
/* eslint-disable */

// Single source of truth for the cloud line-item child contract shared by the
// migration writer, the cloud verifier, and the convergence evidence check.
// Before this module the three derived line-item identity independently and
// disagreed: the writer sanitized the parent id and used a whole-parent stable
// index, while the verifier/convergence used the raw parent id and each item's
// sort_order. With overlapping per-category sort orders (labor + materials both
// starting at 0) that divergence made correctly-written children look like
// cloud-only extras. Centralizing identity here guarantees all three agree.
//
// IMPORTANT distinction, preserved exactly:
//  - the STABLE INDEX drives the deterministic legacy_local_id;
//  - the PERSISTED sort_order keeps the writer's original behavior (finite
//    source sort_order when present, otherwise array position) and may
//    legitimately differ from the identity index.
//
// Entity kind mapping, preserved from the existing contract:
//  - estimate line items carry kind in the line_role column;
//  - invoice line items carry kind inside metadata.kind.

const asText = (value) => String(value == null ? "" : value).trim();

export const CLOUD_LINE_ITEM_ENTITY_TYPES = ["estimate", "invoice"];

export function sanitizeLineItemParentSegment(value, fallback = "parent") {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

// Choose one index basis for the WHOLE parent: prefer sort_order only when every
// item has a finite, mutually-unique sort_order; otherwise fall back to array
// position. Mixing the two within one parent could let a sort_order collide with
// another item's array index, so the choice is made once per parent. This is the
// deterministic legacy_local_id index -- NOT the persisted sort_order column.
export function computeStableLineItemIndexes(items) {
  const list = Array.isArray(items) ? items : [];
  const sortOrders = list.map((item) => {
    const raw = item?.sort_order;
    if (raw === null || raw === undefined || raw === "") return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  });
  const allDefined = sortOrders.every((value) => value !== null);
  const allUnique = allDefined && new Set(sortOrders).size === sortOrders.length;
  if (allDefined && allUnique) return sortOrders;
  return list.map((_, index) => index);
}

export function buildLineItemLegacyId(entityType, parentLegacyId, stableIndex) {
  return `${entityType}:${sanitizeLineItemParentSegment(parentLegacyId)}:line:${stableIndex}`;
}

// Persisted sort_order retains the writer's original behavior: the finite source
// sort_order when present, otherwise the array position. Never rewritten to equal
// the identity index.
export function resolveLineItemSortOrder(item, index) {
  return Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index;
}

export function buildLineItemMetadata(item, { includeKind = false } = {}) {
  const metadata = {};
  const unitCost = item?.unit_cost;
  if (unitCost !== null && unitCost !== undefined && unitCost !== "") {
    const nextCost = Number(unitCost);
    if (Number.isFinite(nextCost)) metadata.unit_cost = nextCost;
  }
  if (includeKind) {
    const kind = asText(item?.kind);
    if (kind) metadata.kind = kind;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

// Parses the deterministic stable index out of a `${entityType}:${parent}:line:${n}`
// legacy id. Returns null when the id does not follow the contract, so callers
// can fall back safely instead of guessing.
export function parseLineItemStableIndex(legacyLocalId) {
  const match = /:line:(-?\d+)$/.exec(asText(legacyLocalId));
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

// Deterministic restore ordering for line items sharing one parent: prefer the
// canonical legacy_local_id stable index; fall back to finite sort_order, then
// the legacy id, then the original fetched position. Never relies on unspecified
// Supabase row order. `row.__fetchPos` (if set) is the original fetched index.
export function compareRestoredLineItemOrder(a, b) {
  const ai = parseLineItemStableIndex(a?.legacy_local_id);
  const bi = parseLineItemStableIndex(b?.legacy_local_id);
  if (ai !== null && bi !== null && ai !== bi) return ai - bi;
  if (ai !== null && bi === null) return -1;
  if (ai === null && bi !== null) return 1;
  const as = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : Number.POSITIVE_INFINITY;
  const bs = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : Number.POSITIVE_INFINITY;
  if (as !== bs) return as - bs;
  const al = asText(a?.legacy_local_id);
  const bl = asText(b?.legacy_local_id);
  if (al !== bl) return al < bl ? -1 : 1;
  return (Number(a?.__fetchPos) || 0) - (Number(b?.__fetchPos) || 0);
}

export function lineItemIncludesLineRole(entityType) { return entityType === "estimate"; }
export function lineItemIncludesKind(entityType) { return entityType === "invoice"; }

// The complete canonical child contract row (minus legacy_local_id) used by BOTH
// the verifier's "expected" row and the writer's persisted payload. parentColumn
// is "estimate_id" | "invoice_id"; pass it (with parentCloudId) for the verifier,
// or omit it for identity-only evidence comparisons.
export function buildLineItemContractRow({ entityType, item, index, parentColumn = "", parentCloudId = "" }) {
  const metadata = buildLineItemMetadata(item, { includeKind: lineItemIncludesKind(entityType) });
  const row = {
    sort_order: resolveLineItemSortOrder(item, index),
    description: item?.description ?? null,
    quantity: item?.quantity ?? null,
    unit: item?.unit ?? null,
    unit_price: item?.unit_price ?? null,
    total_price: item?.total ?? null,
    metadata: metadata ?? null,
  };
  if (parentColumn) row[parentColumn] = parentCloudId ?? null;
  if (lineItemIncludesLineRole(entityType)) row.line_role = item?.kind ?? null;
  return row;
}

// Builds every child row for one parent with deterministic legacy ids and
// whole-parent stable indexing. Returns { rows, duplicateIds, stableIndexes }.
// This is the shared expected/persisted child-contract construction consumed by
// the writer, verifier, and convergence evidence check.
export function buildParentLineItemContract({ entityType, parentLegacyId, parentCloudId = "", parentColumn = "", items }) {
  const list = Array.isArray(items) ? items : [];
  const stableIndexes = computeStableLineItemIndexes(list);
  const rows = [];
  const duplicateIds = [];
  const seen = new Set();
  list.forEach((item, index) => {
    const legacy_local_id = buildLineItemLegacyId(entityType, parentLegacyId, stableIndexes[index]);
    if (seen.has(legacy_local_id)) duplicateIds.push(legacy_local_id);
    else seen.add(legacy_local_id);
    rows.push({
      legacy_local_id,
      ...buildLineItemContractRow({ entityType, item, index, parentColumn, parentCloudId }),
    });
  });
  return { rows, duplicateIds, stableIndexes };
}
