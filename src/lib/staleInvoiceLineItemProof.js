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

// Absence, the business-column list and the recognized structural kinds are NOT
// defined here any more: they are shared client invoice-child semantics owned by
// cloudLineItemContract, so the mapper that decides what to persist and this
// proof that decides what was never canonical can never drift apart.
import {
  isAbsentLineItemValue as isAbsent,
  INVOICE_CHILD_BUSINESS_COLUMNS,
  INVOICE_CHILD_STRUCTURAL_KINDS,
  isInvoiceChildStructuralKind,
} from "./cloudLineItemContract";

// Preserved export names for existing consumers; the contract is the owner.
export const INVOICE_LINE_ITEM_BUSINESS_FIELDS = INVOICE_CHILD_BUSINESS_COLUMNS;
export const PLACEHOLDER_INVOICE_CHILD_KINDS = INVOICE_CHILD_STRUCTURAL_KINDS;
export const isPlaceholderInvoiceChildKind = isInvoiceChildStructuralKind;

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
