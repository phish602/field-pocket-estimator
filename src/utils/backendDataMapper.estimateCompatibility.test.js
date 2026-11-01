// Containment guard for the Invoice persistence repair.
//
// The Invoice repair changed the SHARED extractDocumentLineItems mapper (new
// estimator field reads, and a semantic placeholder filter). Those changes are
// required for Invoices, but Estimate canonical child serialization must remain
// exactly what it was before the repair.
//
// PRE_REPAIR_* below is a verbatim copy of extractDocumentLineItems as it exists
// at the base commit 58b4ce5390d529a776bfe5129aeec3c29ef72c3d. It is the oracle:
// current Estimate output must equal it, field for field, row for row.
//
// Lane 2 intentionally adds only the estimator's material fidelity fields to
// Estimate children. This file keeps the pre-repair projection as an oracle and
// layers those exact authorized material fields on top, so labor, generic rows,
// placeholders, identities and ordering cannot drift accidentally.

import { DEFAULT_STATE } from "../estimator/defaultState";
import { mapLocalEstimateToBackendEstimate, mapLocalInvoiceToBackendInvoice } from "./backendDataMapper";
import { buildParentLineItemContract } from "../lib/cloudLineItemContract";

// ---------------------------------------------------------------------------
// Verbatim pre-repair mapper (base commit). Do not modify to make a test pass.
// ---------------------------------------------------------------------------
const preRepairAsText = (value) => String(value ?? "").trim();

function preRepairPickText(...values) {
  for (const value of values) {
    const text = preRepairAsText(value);
    if (text) return text;
  }
  return "";
}

function preRepairToNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const next = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : null;
}

function preRepairBuildLegacyLocalId(record) {
  return preRepairAsText(record?.id || record?.legacy_local_id || record?.legacyLocalId || "");
}

function PRE_REPAIR_extractDocumentLineItems(record = {}, kind = "") {
  const items = [];
  const laborLines = Array.isArray(record?.labor?.lines) ? record.labor.lines : (Array.isArray(record?.laborLines) ? record.laborLines : []);
  const materialItems = Array.isArray(record?.materials?.items) ? record.materials.items : (Array.isArray(record?.materialItems) ? record.materialItems : []);
  const genericItems = Array.isArray(record?.lineItems) ? record.lineItems : (Array.isArray(record?.items) ? record.items : []);

  const mapItem = (item = {}, itemKind = "", index = 0) => {
    const explicitKind = preRepairPickText(item?.kind);
    const explicitSortOrder = item?.sort_order ?? item?.sortOrder;
    const hasExplicitSortOrder = explicitSortOrder !== null && explicitSortOrder !== undefined && explicitSortOrder !== "" && Number.isFinite(Number(explicitSortOrder));
    const mapped = {
      kind: explicitKind || itemKind || kind || "line_item",
      legacy_local_id: preRepairBuildLegacyLocalId(item),
      description: preRepairPickText(item?.description, item?.name, item?.title, item?.label, item?.notes, item?.text),
      quantity: preRepairToNumberOrNull(item?.quantity ?? item?.qty ?? item?.count),
      unit: preRepairPickText(item?.unit, item?.units, item?.uom),
      unit_price: preRepairToNumberOrNull(item?.unitPrice ?? item?.rate ?? item?.price),
      unit_cost: preRepairToNumberOrNull(item?.unitCost ?? item?.cost ?? item?.costInternal ?? item?.internalCost ?? item?.trueRateInternal),
      total: preRepairToNumberOrNull(item?.total ?? item?.amount),
      sort_order: hasExplicitSortOrder ? Number(explicitSortOrder) : index,
    };
    Object.keys(mapped).forEach((key) => {
      if (mapped[key] === null || mapped[key] === "" || mapped[key] === undefined) delete mapped[key];
    });
    if (Object.keys(mapped).length === 0) return null;
    return mapped;
  };

  laborLines.forEach((item, index) => {
    const mapped = mapItem(item, "labor", index);
    if (mapped) items.push(mapped);
  });
  materialItems.forEach((item, index) => {
    const mapped = mapItem(item, "material", index);
    if (mapped) items.push(mapped);
  });
  genericItems.forEach((item, index) => {
    const mapped = mapItem(item, kind || "line_item", index);
    if (mapped) items.push(mapped);
  });

  return items;
}

function pickPreRepairNumber(...values) {
  for (const value of values) {
    const next = preRepairToNumberOrNull(value);
    if (next !== null) return next;
  }
  return null;
}

function expectedEstimateLineItems(record = {}) {
  const expected = PRE_REPAIR_extractDocumentLineItems(record, "estimate");
  const laborLines = Array.isArray(record?.labor?.lines) ? record.labor.lines : (Array.isArray(record?.laborLines) ? record.laborLines : []);
  const materialItems = Array.isArray(record?.materials?.items) ? record.materials.items : (Array.isArray(record?.materialItems) ? record.materialItems : []);

  materialItems.forEach((item, index) => {
    const mapped = expected[laborLines.length + index];
    if (!mapped || mapped.kind !== "material") return;
    const description = preRepairPickText(item?.description, item?.desc, item?.name, item?.title, item?.label, item?.notes, item?.text);
    const unitPrice = pickPreRepairNumber(item?.unitPrice, item?.rate, item?.price, item?.priceEach);
    const unitCost = pickPreRepairNumber(item?.unitCost, item?.cost, item?.unitCostInternal, item?.costInternal, item?.internalCost, item?.trueRateInternal);
    const total = pickPreRepairNumber(item?.total, item?.amount);
    if (description) mapped.description = description;
    if (unitPrice !== null) mapped.unit_price = unitPrice;
    if (unitCost !== null) mapped.unit_cost = unitCost;
    if (total !== null) mapped.total = total;
  });

  return expected;
}

// ---------------------------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value));

function estimateWith(overrides = {}) {
  return {
    id: "est_compat_1",
    estimateNumber: "EST-4001",
    docType: "estimate",
    status: "pending",
    customerName: "Compatibility Customer",
    ui: { docType: "estimate", materialsMode: "itemized" },
    ...overrides,
  };
}

const POPULATED_LABOR = {
  id: "est_labor_1",
  role: "Electrician",
  label: "Electrician",
  qty: "2",
  hours: "40",
  rate: "145.75",
  trueRateInternal: "60",
  markupPct: "10",
};

const POPULATED_MATERIAL = {
  id: "est_material_1",
  desc: "Vanity light",
  qty: "2",
  unitCostInternal: "70",
  costInternal: "140",
  priceEach: "135",
};

const BLANK_LABOR = clone(DEFAULT_STATE.labor.lines[0]);
const BLANK_MATERIAL = clone(DEFAULT_STATE.materials.items[0]);

const FIXTURES = [
  ["estimate labor only", estimateWith({
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR] },
  })],
  ["estimate material only", estimateWith({
    materials: { markupPct: 0, blanketCost: "", items: [POPULATED_MATERIAL] },
  })],
  ["estimate labor + material", estimateWith({
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR] },
    materials: { markupPct: 0, blanketCost: "", items: [POPULATED_MATERIAL] },
  })],
  ["estimate blank/default rows", estimateWith({
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [clone(BLANK_LABOR)] },
    materials: { markupPct: 0, blanketCost: "", items: [clone(BLANK_MATERIAL)] },
  })],
  ["estimate populated + blank rows mixed", estimateWith({
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR, clone(BLANK_LABOR)] },
    materials: { markupPct: 0, blanketCost: "", items: [POPULATED_MATERIAL, clone(BLANK_MATERIAL)] },
  })],
  ["estimate with generic lineItems", estimateWith({
    lineItems: [
      { id: "generic_1", description: "Mobilization", quantity: 1, price: 250 },
      { id: "generic_2", description: "", quantity: null },
    ],
  })],
  ["estimate with additional charges present", estimateWith({
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR] },
    additionalCharges: { items: [{ id: "est_ac_1", desc: "Permit", qty: 1, priceEach: 95 }] },
  })],
];

describe("Estimate child serialization changes only for authorized material fidelity", () => {
  test.each(FIXTURES)("%s produces canonical children with only the material fidelity extension", (_label, estimate) => {
    const expected = expectedEstimateLineItems(estimate);
    const actual = mapLocalEstimateToBackendEstimate(estimate, {}).line_items;
    expect(actual).toEqual(expected);
  });

  test.each(FIXTURES)("%s produces canonical child rows with stable identities and ordering", (_label, estimate) => {
    const rowsFor = (items) => buildParentLineItemContract({
      entityType: "estimate",
      parentLegacyId: estimate.id,
      parentColumn: "estimate_id",
      items,
    }).rows;

    const expected = rowsFor(expectedEstimateLineItems(estimate));
    const actual = rowsFor(mapLocalEstimateToBackendEstimate(estimate, {}).line_items);
    expect(actual).toEqual(expected);
  });

  test("no estimate child gains an hours metadata field", () => {
    const estimate = estimateWith({
      labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR] },
    });
    const rows = buildParentLineItemContract({
      entityType: "estimate",
      parentLegacyId: estimate.id,
      parentColumn: "estimate_id",
      items: mapLocalEstimateToBackendEstimate(estimate, {}).line_items,
    }).rows;
    rows.forEach((row) => {
      expect(row.metadata?.hours).toBeUndefined();
    });
  });

  test("estimate blank default rows still serialize exactly as they did pre-repair", () => {
    const estimate = estimateWith({
      labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [clone(BLANK_LABOR)] },
      materials: { markupPct: 0, blanketCost: "", items: [clone(BLANK_MATERIAL)] },
    });
    const expected = expectedEstimateLineItems(estimate);
    const actual = mapLocalEstimateToBackendEstimate(estimate, {}).line_items;

    // Pre-repair kept these rows (they retain kind/legacy_local_id/sort_order).
    // The Invoice placeholder filter must NOT have leaked into Estimates.
    expect(expected).toHaveLength(2);
    expect(actual).toEqual(expected);
  });
});

describe("the Invoice repair behavior is still active for invoices", () => {
  const invoiceBase = {
    id: "inv_compat_1",
    invoiceNumber: "INV-4001",
    docType: "invoice",
    ui: { docType: "invoice", materialsMode: "itemized" },
  };

  test("invoice children DO read role/desc/priceEach/unitCostInternal", () => {
    const invoice = {
      ...invoiceBase,
      labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [POPULATED_LABOR] },
      materials: { markupPct: 0, blanketCost: "", items: [POPULATED_MATERIAL] },
    };
    const items = mapLocalInvoiceToBackendInvoice(invoice, {}).line_items;

    const labor = items.find((item) => item.kind === "labor");
    expect(labor.description).toBe("Electrician");
    expect(labor.hours).toBe(40);

    const material = items.find((item) => item.kind === "material");
    expect(material.description).toBe("Vanity light");
    expect(material.unit_price).toBe(135);
    expect(material.unit_cost).toBe(70);

    // Estimate labor remains on its prior projection, while estimate material
    // now reads the same saved material economics required by Lane 2.
    const estimateItems = mapLocalEstimateToBackendEstimate({ ...invoiceBase, ...invoice }, {}).line_items;
    expect(estimateItems.find((item) => item.kind === "labor").description).toBe("Electrician");
    expect(estimateItems.find((item) => item.kind === "material")).toEqual(expect.objectContaining({
      description: "Vanity light",
      unit_price: 135,
      unit_cost: 70,
    }));
  });

  test("invoice blank placeholders are still rejected while estimate keeps them", () => {
    const blankSections = {
      labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [clone(BLANK_LABOR)] },
      materials: { markupPct: 0, blanketCost: "", items: [clone(BLANK_MATERIAL)] },
    };
    expect(mapLocalInvoiceToBackendInvoice({ ...invoiceBase, ...blankSections }, {}).line_items).toHaveLength(0);
    expect(mapLocalEstimateToBackendEstimate(estimateWith(blankSections), {}).line_items).toHaveLength(2);
  });
});
