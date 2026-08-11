// Regression guard for the invoice_line_items "doubling" transition.
//
// A cloud-restored invoice is THIN: mapCloudInvoiceToLocal produces
// { id, ..., lineItems: [...] } with NO structured labor.lines / materials.items.
// normalizeInvoiceRecord partitions those thin lineItems back into their own
// canonical sections BY PERSISTED KIND, but must NOT leave the same children
// behind in a generic lineItems/items array -- otherwise the backend line-item
// derivation (labor.lines + materials.items + lineItems) counts every child
// twice and a pristine 16-child workspace presents 32 device-side children,
// which the cloud convergence engine correctly refuses to reconcile (protected
// data_mismatch).
//
// NOTE: an earlier revision of this file asserted that every thin child lands in
// materials.items. That expectation was wrong and is what let labor be repriced
// as material (qty x priceEach instead of qty x hours x rate). The kind-aware
// expectations below replace it.

import { buildDevSampleDataset } from "./devSampleData";
import { normalizeInvoiceRecord } from "./invoices";
import { mapLocalInvoiceToBackendInvoice } from "./backendDataMapper";
import { buildParentLineItemContract } from "../lib/cloudLineItemContract";
import { mapCloudInvoiceLineItem } from "../lib/supabaseCloudRestore";

function deriveChildRows(invoice) {
  const backend = mapLocalInvoiceToBackendInvoice(invoice, {});
  return buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: backend.legacy_local_id || invoice.id,
    parentColumn: "invoice_id",
    items: backend.line_items,
  }).rows;
}

// Rebuild the exact thin invoice shape a cloud restore produces: the invoice's
// authoritative id plus its children as generic lineItems (restored shape),
// with NO structured labor/material sections.
function buildThinRestoredInvoice(structuredInvoice) {
  const backend = mapLocalInvoiceToBackendInvoice(structuredInvoice, {});
  const contract = buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: backend.legacy_local_id || structuredInvoice.id,
    parentColumn: "invoice_id",
    items: backend.line_items,
  });
  // Map each cloud row back through the real restore mapper so the thin
  // lineItems match production exactly.
  const restoredChildren = contract.rows.map((row, index) => mapCloudInvoiceLineItem({
    legacy_local_id: row.legacy_local_id,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unit_price: row.unit_price,
    total_price: row.total,
    sort_order: row.sort_order ?? index,
    metadata: row.metadata || {},
  }));
  return {
    id: structuredInvoice.id,
    invoiceNumber: structuredInvoice.invoiceNumber || "",
    sourceEstimateId: structuredInvoice.sourceEstimateId || "",
    status: structuredInvoice.status || "sent",
    invoiceTotal: structuredInvoice.invoiceTotal ?? structuredInvoice.total ?? 0,
    date: structuredInvoice.date || "",
    lineItems: restoredChildren,
    payments: [],
  };
}

describe("thin cloud-restored invoice line-item normalization", () => {
  const { invoices } = buildDevSampleDataset();

  test("normalizing a thin restored invoice does not duplicate its children", () => {
    invoices.forEach((structured) => {
      const baseline = deriveChildRows(structured);
      const thin = buildThinRestoredInvoice(structured);

      const normalized = normalizeInvoiceRecord(thin);
      const afterRestore = deriveChildRows(normalized);

      // Same number of children as the structured original -- never doubled.
      expect(afterRestore.length).toBe(baseline.length);
      // Deterministic identities preserved.
      expect(afterRestore.map((r) => r.legacy_local_id)).toEqual(
        baseline.map((r) => r.legacy_local_id)
      );
      // The generic thin arrays must not survive to be counted a second time.
      const genericLeftover = (Array.isArray(normalized.lineItems) ? normalized.lineItems.length : 0)
        + (Array.isArray(normalized.items) ? normalized.items.length : 0)
        + (Array.isArray(normalized.invoiceLineItems) ? normalized.invoiceLineItems.length : 0);
      expect(genericLeftover).toBe(0);
      // Each child stays in the section it was persisted from -- labor children
      // land in labor.lines, material children in materials.items. No child
      // crosses categories.
      const kindCounts = (rows) => rows.reduce((out, row) => {
        const kind = String(row?.metadata?.kind || "").trim() || "unknown";
        out[kind] = (out[kind] || 0) + 1;
        return out;
      }, {});
      expect(kindCounts(afterRestore)).toEqual(kindCounts(baseline));
      expect((normalized.labor?.lines || []).length)
        .toBe((structured.labor?.lines || []).filter((line) => (
          String(line?.role || "").trim() || line?.hours !== "" || line?.rate !== ""
        )).length);
      // Invoice identity is unchanged by the restore/normalize transition.
      expect(normalized.id).toBe(structured.id);
    });
  });

  test("re-normalizing (reopen/save cycle) stays deterministic and does not grow children", () => {
    const structured = invoices[0];
    const thin = buildThinRestoredInvoice(structured);

    const once = normalizeInvoiceRecord(thin);
    const twice = normalizeInvoiceRecord(once);
    const thrice = normalizeInvoiceRecord(twice);

    const c1 = deriveChildRows(once).map((r) => r.legacy_local_id);
    const c2 = deriveChildRows(twice).map((r) => r.legacy_local_id);
    const c3 = deriveChildRows(thrice).map((r) => r.legacy_local_id);

    expect(c2).toEqual(c1);
    expect(c3).toEqual(c1);
    expect(once.id).toBe(structured.id);
    expect(thrice.id).toBe(structured.id);
  });
});
