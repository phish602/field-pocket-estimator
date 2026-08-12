// @ts-nocheck
/* eslint-disable */

// ONE client-side definition of "semantically empty invoice child", shared by
// the migration writer's stale-row planner and the cloud verifier so the two can
// never disagree about which cloud rows are safe to repair.
//
// This is a PROOF, not a heuristic. It answers a single question: does this
// cloud invoice_line_items row carry any business or economic content at all?
// If it carries none, it cannot be a canonical child -- the corrected invoice
// mapper refuses to persist a row with no business content -- so a cloud row in
// that shape is provably obsolete UI scaffolding left behind by an older writer.
//
// The server re-proves this independently (server/staleInvoiceLineItemRepair.js)
// and never trusts this module. That duplication is deliberate: the browser is
// not authorized to be the only proof of a deletion.

// Explicit zero is DATA, never emptiness. A $0 line, a 0-quantity line and a
// 0-hour line are all real business records a user may have entered on purpose.
// Only null / undefined / "" count as absent.
function isAbsent(value) {
  return value === null || value === undefined || value === "";
}

// The business columns of the shared line-item contract. A placeholder must have
// none of them. sort_order is deliberately NOT here: it is structural position,
// not content, and every row has one.
export const INVOICE_LINE_ITEM_BUSINESS_FIELDS = [
  "description",
  "quantity",
  "unit",
  "unit_price",
  "total_price",
];

// The only metadata a blank estimator row can legitimately carry is its
// structural section classification. Anything else -- hours, unit_cost, markup,
// or any key this proof does not recognize -- is economic state and disqualifies
// the row, even when its numeric value is 0.
//
// "invoice" is the HISTORICAL generic section tag written by an older writer that
// did not yet split blank scaffolding into labor/material. It is structural for
// exactly the same reason the other two are: it names a section, carries no
// economic value, and the corrected mapper refuses to persist a generic invoice
// row with no business content. Recognizing the kind changes NOTHING about the
// emptiness requirements below -- a `kind:"invoice"` row still has to clear every
// business-field and metadata-shape check before it can be called a placeholder.
export const PLACEHOLDER_INVOICE_CHILD_KINDS = ["labor", "material", "invoice"];

export function isPlaceholderInvoiceChildKind(kind) {
  return PLACEHOLDER_INVOICE_CHILD_KINDS.includes(String(kind == null ? "" : kind).trim());
}

export function isEmptyInvoiceLineItemMetadata(metadata) {
  if (metadata === null || metadata === undefined) return true;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const keys = Object.keys(metadata);
  if (keys.length === 0) return true;
  // Exactly one key, and it must be the structural kind. An unknown extra key of
  // any kind fails closed.
  if (keys.length !== 1 || keys[0] !== "kind") return false;
  return isPlaceholderInvoiceChildKind(metadata.kind);
}

// True only when EVERY business field is absent and metadata carries nothing but
// a supported structural kind. Fails closed on anything unrecognized.
export function isProvenEmptyInvoiceLineItemPlaceholder(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (!INVOICE_LINE_ITEM_BUSINESS_FIELDS.every((field) => isAbsent(row[field]))) return false;
  return isEmptyInvoiceLineItemMetadata(row.metadata);
}

export default isProvenEmptyInvoiceLineItemPlaceholder;
