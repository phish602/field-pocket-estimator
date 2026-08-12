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

// ---------------------------------------------------------------------------
// SHARED CLIENT INVOICE-CHILD SEMANTICS
//
// These primitives answer questions that the mapper, the stale-placeholder
// proof, the writer's stale planner and the cloud verifier all used to answer
// separately -- with their own copies of the same regex, the same absence rule
// and the same field lists. Divergence between those copies is exactly how a
// correctly-written child can start looking like a cloud-only extra, so the
// client now has ONE owner for each of them.
//
// The SERVER deliberately does NOT consume these (see
// server/staleInvoiceLineItemRepair.js). Its destructive proof reimplements
// every one of them on purpose: the browser must never be the only authority
// behind a deletion. That duplication is a security boundary, not drift.
// ---------------------------------------------------------------------------

// Absence has exactly one definition. Explicit numeric 0 is DATA, never
// emptiness: a $0 line, a 0-quantity line and a 0-hour line are all real
// business records a user may have entered on purpose. Only null / undefined /
// "" count as absent.
export function isAbsentLineItemValue(value) {
  return value === null || value === undefined || value === "";
}

// Keys on a MAPPED child (local projection) that carry no business meaning on
// their own: implementation/default scaffolding the estimator UI attaches to
// every row it renders, including the blank placeholder rows DEFAULT_STATE
// seeds.
export const LINE_ITEM_STRUCTURAL_KEYS = Object.freeze(["kind", "legacy_local_id", "sort_order"]);

// A mapped row is a real business child only when at least one non-structural
// key survived the caller's empty-value prune. Because that prune uses the
// absence rule above, an explicit 0 keeps the row real.
export function hasBusinessLineItemContent(mapped) {
  if (!mapped || typeof mapped !== "object" || Array.isArray(mapped)) return false;
  return Object.keys(mapped).some((key) => !LINE_ITEM_STRUCTURAL_KEYS.includes(key));
}

// The business COLUMNS of a persisted cloud invoice_line_items row. sort_order
// is deliberately absent: it is structural position, not content, and every row
// has one.
export const INVOICE_CHILD_BUSINESS_COLUMNS = Object.freeze([
  "description",
  "quantity",
  "unit",
  "unit_price",
  "total_price",
]);

// The only metadata a blank estimator row can legitimately carry is its
// structural section classification. "invoice" is the HISTORICAL generic
// section tag written by an older writer that did not yet split blank
// scaffolding into labor/material. Anything else -- hours, unit_cost, markup,
// or any unrecognized key -- is economic state, even when its value is 0.
export const INVOICE_CHILD_STRUCTURAL_KINDS = Object.freeze(["labor", "material", "invoice"]);

export function isInvoiceChildStructuralKind(kind) {
  return INVOICE_CHILD_STRUCTURAL_KINDS.includes(asText(kind));
}

// The STRICT deterministic invoice-child identity: `invoice:<parent>:line:<n>`
// with a non-negative index. Returns null when the id does not follow the
// contract so callers fail closed instead of guessing.
export function parseInvoiceChildLegacyId(value) {
  const match = /^invoice:([^:]+):line:(\d+)$/.exec(asText(value));
  return match ? { parentSegment: match[1], stableIndex: Number(match[2]) } : null;
}

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

// A cloud-restored child already carries the canonical identity that was used
// to persist it. Keep that identity when it belongs to this exact parent and
// entity type. In particular, filtering an obsolete blank sibling must never
// renumber a real recovered child from `line:2` to `line:0` on its next
// cloud-verification/backup pass.
function recoveredCanonicalLineItemIndex({ entityType, parentLegacyId, item }) {
  const legacyId = asText(item?.legacy_local_id || item?.legacyLocalId || item?.id);
  const expectedPrefix = `${entityType}:${sanitizeLineItemParentSegment(parentLegacyId)}:line:`;
  if (!legacyId.startsWith(expectedPrefix)) return null;
  const stableIndex = parseLineItemStableIndex(legacyId);
  return stableIndex !== null && legacyId === `${expectedPrefix}${stableIndex}` ? stableIndex : null;
}

// Persisted sort_order retains the writer's original behavior: the finite source
// sort_order when present, otherwise the array position. Never rewritten to equal
// the identity index.
export function resolveLineItemSortOrder(item, index) {
  return Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index;
}

export function buildLineItemMetadata(item, { includeKind = false, includeSemantics = false } = {}) {
  const metadata = {};
  const unitCost = item?.unit_cost;
  if (unitCost !== null && unitCost !== undefined && unitCost !== "") {
    const nextCost = Number(unitCost);
    if (Number.isFinite(nextCost)) metadata.unit_cost = nextCost;
  }
  // Labor is qty x hours x rate, but invoice_line_items has no hours column, so
  // quantity + unit_price alone cannot reproduce the total: a restored labor row
  // silently collapses to qty x rate. hours rides in the existing metadata JSON
  // contract -- no schema change, no second persistence system.
  if (includeSemantics) {
    const hours = item?.hours;
    if (hours !== null && hours !== undefined && hours !== "") {
      const nextHours = Number(hours);
      if (Number.isFinite(nextHours)) metadata.hours = nextHours;
    }
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
// Only invoices reconstruct their builder state FROM their child rows, so only
// invoices need the semantic economics carried in metadata. Estimates restore
// from their verbatim restore_payload (see mapCloudEstimateToLocal), so adding
// these to estimate children would change already-persisted estimate evidence
// for no restore benefit.
export function lineItemIncludesSemantics(entityType) { return entityType === "invoice"; }

// The complete canonical child contract row (minus legacy_local_id) used by BOTH
// the verifier's "expected" row and the writer's persisted payload. parentColumn
// is "estimate_id" | "invoice_id"; pass it (with parentCloudId) for the verifier,
// or omit it for identity-only evidence comparisons.
export function buildLineItemContractRow({ entityType, item, index, parentColumn = "", parentCloudId = "" }) {
  const metadata = buildLineItemMetadata(item, {
    includeKind: lineItemIncludesKind(entityType),
    includeSemantics: lineItemIncludesSemantics(entityType),
  });
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
  const derivedStableIndexes = computeStableLineItemIndexes(list);
  const stableIndexes = list.map((item, index) => {
    const recoveredIndex = recoveredCanonicalLineItemIndex({ entityType, parentLegacyId, item });
    return recoveredIndex === null ? derivedStableIndexes[index] : recoveredIndex;
  });
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
