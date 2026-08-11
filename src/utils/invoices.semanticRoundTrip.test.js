// Semantic invoice round-trip regression coverage.
//
// The confirmed regression: a saved invoice reopened as a DIFFERENT semantic
// invoice. Labor children were folded into materials.items by the thin-restore
// normalizer, and the backend mapper never persisted labor hours. A technician
// billed qty 1 x 14 hours x $50 ($700) came back as a material priced
// qty 1 x $50 ($50).
//
// These tests exercise the real path end to end:
//   estimator state
//     -> mapLocalInvoiceToBackendInvoice   (persistence normalization)
//     -> buildParentLineItemContract       (canonical cloud child rows)
//     -> mapCloudInvoiceLineItem           (restore representation)
//     -> normalizeInvoiceRecord            (hydration back into sections)
//     -> computeTotals                     (the one calculation engine)

import { computeTotals } from "../estimator/engine";
import { normalizeInvoiceRecord } from "./invoices";
import { mapLocalInvoiceToBackendInvoice } from "./backendDataMapper";
import { buildParentLineItemContract } from "../lib/cloudLineItemContract";
import { mapCloudInvoiceLineItem } from "../lib/supabaseCloudRestore";

const INVOICE_ID = "inv_round_trip_1";

function childRows(invoice) {
  const backend = mapLocalInvoiceToBackendInvoice(invoice, {});
  return buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: backend.legacy_local_id || invoice.id,
    parentColumn: "invoice_id",
    items: backend.line_items,
  }).rows;
}

// One complete semantic cycle: serialize the invoice to its canonical cloud
// child rows, restore those rows the way a cloud restore does (a THIN invoice
// whose children arrive only as generic lineItems), then normalize back.
function roundTrip(invoice) {
  const rows = childRows(invoice);
  const restoredChildren = rows.map((row, index) => mapCloudInvoiceLineItem({
    legacy_local_id: row.legacy_local_id,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unit_price: row.unit_price,
    total_price: row.total_price,
    sort_order: row.sort_order ?? index,
    metadata: row.metadata || {},
  }));
  return normalizeInvoiceRecord({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber || "",
    status: invoice.status || "sent",
    date: invoice.date || "2026-08-10",
    // Deliberately NOT carrying invoiceTotal/financials: the economics must be
    // reconstructible from the children alone, never masked by a cached parent
    // total.
    lineItems: restoredChildren,
    payments: [],
  });
}

function buildTechnicianInvoice(extra = {}) {
  return {
    id: INVOICE_ID,
    invoiceNumber: "INV-9001",
    status: "sent",
    date: "2026-08-10",
    docType: "invoice",
    ui: { docType: "invoice", materialsMode: "itemized" },
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [
        { id: "labor_tech", role: "Technician", qty: 1, hours: 14, rate: 50, trueRateInternal: "" },
      ],
    },
    materials: { markupPct: 0, blanketCost: "", items: [] },
    additionalCharges: { items: [] },
    ...extra,
  };
}

describe("labor semantic restore", () => {
  test("Technician qty 1 x 14h x $50 stays Labor and recomputes to $700", () => {
    const original = buildTechnicianInvoice();
    expect(computeTotals(original).totalRevenue).toBe(700);

    const restored = roundTrip(original);

    expect(restored.labor.lines).toHaveLength(1);
    const line = restored.labor.lines[0];
    expect(line.role).toBe("Technician");
    expect(Number(line.qty)).toBe(1);
    expect(Number(line.hours)).toBe(14);
    expect(Number(line.rate)).toBe(50);

    // Never reclassified as a material.
    expect(restored.materials.items).toHaveLength(0);
    expect(
      restored.materials.items.some((item) => /technician/i.test(String(item?.desc || "")))
    ).toBe(false);

    // The engine reproduces the economics from the children alone.
    expect(computeTotals(restored).totalRevenue).toBe(700);
  });

  test("$700 survives three complete semantic round trips", () => {
    let current = buildTechnicianInvoice();
    const seenChildIds = [];

    for (let cycle = 0; cycle < 3; cycle += 1) {
      current = roundTrip(current);
      seenChildIds.push(childRows(current).map((row) => row.legacy_local_id));

      expect(current.id).toBe(INVOICE_ID);
      expect(current.labor.lines).toHaveLength(1);
      expect(current.materials.items).toHaveLength(0);
      expect(current.labor.lines[0].role).toBe("Technician");
      expect(Number(current.labor.lines[0].hours)).toBe(14);
      expect(Number(current.labor.lines[0].rate)).toBe(50);
      expect(computeTotals(current).totalRevenue).toBe(700);
    }

    // Child identity is stable across cycles, not regenerated each time.
    expect(seenChildIds[1]).toEqual(seenChildIds[0]);
    expect(seenChildIds[2]).toEqual(seenChildIds[0]);
  });

  test("the restored total is not borrowed from a stored parent total", () => {
    const restored = roundTrip(buildTechnicianInvoice());
    // Blank the cached parent economics entirely, then recompute.
    const stripped = {
      ...restored,
      invoiceTotal: 0,
      total: 0,
      financials: {},
      totals: {},
      materials: { ...restored.materials, blanketCost: "" },
    };
    expect(computeTotals(stripped).totalRevenue).toBe(700);
  });
});

describe("mixed labor / material restore", () => {
  const mixed = buildTechnicianInvoice({
    ui: { docType: "invoice", materialsMode: "itemized" },
    materials: {
      markupPct: 0,
      blanketCost: "",
      items: [
        { id: "mat_conduit", desc: "Conduit", qty: 10, priceEach: 12, unitCostInternal: 7, costInternal: "" },
        { id: "mat_fixture", desc: "LED fixture", qty: 3, priceEach: 145, unitCostInternal: 85, costInternal: "" },
      ],
    },
  });

  test("1 labor + 2 materials normalizes to exactly 1 labor row and 2 material rows", () => {
    const restored = roundTrip(mixed);

    expect(restored.labor.lines).toHaveLength(1);
    expect(restored.materials.items).toHaveLength(2);

    expect(restored.labor.lines[0].role).toBe("Technician");
    expect(restored.materials.items.map((item) => item.desc).sort())
      .toEqual(["Conduit", "LED fixture"]);

    // No cross-category movement in either direction.
    expect(restored.materials.items.some((item) => item.desc === "Technician")).toBe(false);
    expect(restored.labor.lines.some((line) => line.role === "Conduit")).toBe(false);
  });

  test("section counts stay 1 labor / 2 materials for three cycles", () => {
    let current = mixed;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      current = roundTrip(current);
      expect(current.labor.lines).toHaveLength(1);
      expect(current.materials.items).toHaveLength(2);
      expect(childRows(current)).toHaveLength(3);
    }
  });

  test("material economics survive the round trip", () => {
    const restored = roundTrip(mixed);
    const conduit = restored.materials.items.find((item) => item.desc === "Conduit");
    expect(Number(conduit.qty)).toBe(10);
    expect(Number(conduit.priceEach)).toBe(12);
    expect(Number(conduit.unitCostInternal)).toBe(7);

    // 700 labor + (10 x 12) + (3 x 145) = 700 + 120 + 435
    expect(computeTotals(restored).totalRevenue).toBe(1255);
  });

  test("no generic duplicate copy survives alongside the structured sections", () => {
    const restored = roundTrip(mixed);
    expect(restored.lineItems).toBeUndefined();
    expect(restored.invoiceLineItems).toBeUndefined();
    expect(restored.items).toBeUndefined();
    // 3 children in, 3 children out -- never doubled.
    expect(childRows(restored)).toHaveLength(3);
  });
});

// The divergence convergence was correctly reporting as data_mismatch: the same
// invoice serialized to a DIFFERENT set of canonical child rows after a local
// round trip. Semantic stability here is what removes the mismatch at its
// source, without touching or weakening convergence.
describe("canonical child rows are identical before and after a local round trip", () => {
  const cases = [
    ["labor only", buildTechnicianInvoice()],
    ["labor + materials", buildTechnicianInvoice({
      materials: {
        markupPct: 0,
        blanketCost: "",
        items: [
          { id: "mat_conduit", desc: "Conduit", qty: 10, priceEach: 12, unitCostInternal: 7, costInternal: "" },
          { id: "mat_fixture", desc: "LED fixture", qty: 3, priceEach: 145, unitCostInternal: 85, costInternal: "" },
        ],
      },
    })],
  ];

  test.each(cases)("%s produces byte-identical child rows for three cycles", (_label, invoice) => {
    const baseline = childRows(invoice);
    let current = invoice;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      current = roundTrip(current);
      expect(childRows(current)).toEqual(baseline);
    }
  });
});

describe("unknown and legacy thin rows", () => {
  test("an unrecognized kind keeps its kind instead of being rewritten as a material", () => {
    const restored = normalizeInvoiceRecord({
      id: "inv_unknown_kind",
      invoiceNumber: "INV-9100",
      lineItems: [
        { id: "x1", description: "Legacy widget", quantity: 2, price: 10, kind: "warranty_credit", sort_order: 0 },
      ],
    });
    const surfaced = restored.materials.items[0];
    expect(surfaced.desc).toBe("Legacy widget");
    // Rendered through the narrowest existing container, but its persisted
    // semantic kind is retained, so serialization re-emits it unchanged.
    expect(surfaced.kind).toBe("warranty_credit");
    expect(childRows(restored)[0].metadata.kind).toBe("warranty_credit");
  });

  test("kind-less pre-contract legacy rows keep the historical material fallback", () => {
    const restored = normalizeInvoiceRecord({
      id: "inv_legacy",
      invoiceNumber: "INV-9101",
      lineItems: [
        { id: "legacy_1", description: "Service call", quantity: 1, price: 125 },
      ],
    });
    expect(restored.materials.items).toHaveLength(1);
    expect(restored.materials.items[0].desc).toBe("Service call");
    expect(restored.materials.items[0].priceEach).toBe(125);
    // No labor section is invented for a record that never had one.
    expect(restored.labor?.lines ?? []).toHaveLength(0);
  });
});

describe("blank placeholder rows are not persisted as canonical children", () => {
  test("the default blank labor and material rows create no backend children", () => {
    const blank = {
      id: "inv_blank",
      invoiceNumber: "INV-9200",
      docType: "invoice",
      ui: { docType: "invoice", materialsMode: "itemized" },
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }],
      },
      materials: {
        markupPct: 0,
        blanketCost: "",
        items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
      },
      additionalCharges: { items: [] },
    };

    expect(mapLocalInvoiceToBackendInvoice(blank, {}).line_items).toHaveLength(0);
    expect(childRows(blank)).toHaveLength(0);
  });

  test("a legitimate explicit zero-valued row IS persisted", () => {
    const zeroed = {
      id: "inv_zero",
      invoiceNumber: "INV-9201",
      docType: "invoice",
      ui: { docType: "invoice", materialsMode: "itemized" },
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l_zero", role: "Warranty visit", qty: 1, hours: 0, rate: 0, trueRateInternal: "" }],
      },
      materials: {
        markupPct: 0,
        blanketCost: "",
        items: [{ id: "m_zero", desc: "Comped part", qty: 1, priceEach: 0, unitCostInternal: "", costInternal: "" }],
      },
      additionalCharges: { items: [] },
    };

    const items = mapLocalInvoiceToBackendInvoice(zeroed, {}).line_items;
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("labor");
    expect(items[0].description).toBe("Warranty visit");
    expect(items[1].kind).toBe("material");
    expect(items[1].description).toBe("Comped part");
  });

  test("repeated saves of a builder holding blank rows never grow the child count", () => {
    const withBlanks = buildTechnicianInvoice({
      ui: { docType: "invoice", materialsMode: "itemized" },
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [
          { id: "labor_tech", role: "Technician", qty: 1, hours: 14, rate: 50, trueRateInternal: "" },
          { id: "l2", role: "", hours: "", rate: "", trueRateInternal: "" },
        ],
      },
      materials: {
        markupPct: 0,
        blanketCost: "",
        items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
      },
    });

    expect(childRows(withBlanks)).toHaveLength(1);

    let current = withBlanks;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      current = roundTrip(current);
      expect(childRows(current)).toHaveLength(1);
      expect(current.labor.lines).toHaveLength(1);
      expect(computeTotals(current).totalRevenue).toBe(700);
    }
  });
});
