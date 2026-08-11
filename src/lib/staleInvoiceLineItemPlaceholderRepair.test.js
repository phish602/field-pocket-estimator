// Focused coverage for the SECOND proven stale invoice-child class:
// obsolete semantically-empty placeholder rows left in the cloud by an older
// writer that persisted the estimator's blank UI rows.
//
// The corrected invoice mapper refuses to persist a row with no business
// content, so those cloud rows are extra relative to the current canonical
// payload. The original planner only proved wrong-parent duplicates with an
// exact canonical twin, so it sent these to unresolvedExtraRows and the repair
// never ran -- leaving a permanent data_mismatch.

import {
  isProvenEmptyInvoiceLineItemPlaceholder,
  isEmptyInvoiceLineItemMetadata,
} from "./staleInvoiceLineItemProof";
import { planProvenStaleInvoiceLineItems } from "./supabaseMigrationWriter";

const CLOUD_INVOICE_UUID_PREFIX = "11111111-1111-4111-8111-";

function cloudInvoiceUuid(index) {
  return `${CLOUD_INVOICE_UUID_PREFIX}${String(index).padStart(12, "0")}`;
}

function rowUuid(index) {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function canonicalRow({ id, parent, index, invoiceCloudId, kind }) {
  return {
    id,
    legacy_local_id: `invoice:${parent}:line:${index}`,
    invoice_id: invoiceCloudId,
    sort_order: index,
    description: kind === "labor" ? "Technician" : "Panel",
    quantity: 1,
    unit: null,
    unit_price: 50,
    total_price: null,
    metadata: { kind },
  };
}

function blankPlaceholderRow({ id, parent, index, invoiceCloudId, kind }) {
  return {
    id,
    legacy_local_id: `invoice:${parent}:line:${index}`,
    invoice_id: invoiceCloudId,
    sort_order: 0,
    description: "",
    quantity: null,
    unit: null,
    unit_price: null,
    total_price: null,
    metadata: { kind },
  };
}

const payloadFor = (parent, index) => ({ legacy_local_id: `invoice:${parent}:line:${index}` });

describe("TEST 1 - exact empty placeholder predicate", () => {
  const base = {
    description: null,
    quantity: null,
    unit: null,
    unit_price: null,
    total_price: null,
  };

  test("a blank labor placeholder is proven empty", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata: { kind: "labor" } })).toBe(true);
  });

  test("a blank material placeholder is proven empty", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata: { kind: "material" } })).toBe(true);
  });

  test("empty-string business fields are also absent", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({
      description: "", quantity: "", unit: "", unit_price: "", total_price: "", metadata: { kind: "labor" },
    })).toBe(true);
  });

  test("null and {} metadata are accepted", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata: null })).toBe(true);
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata: {} })).toBe(true);
    expect(isEmptyInvoiceLineItemMetadata(undefined)).toBe(true);
  });

  // ZERO IS DATA. Every one of these must be refused.
  test.each([
    ["quantity 0", { quantity: 0 }],
    ["unit_price 0", { unit_price: 0 }],
    ["total_price 0", { total_price: 0 }],
  ])("%s is NOT empty", (_label, override) => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, ...override, metadata: { kind: "labor" } })).toBe(false);
  });

  test.each([
    ["metadata.hours 0", { kind: "labor", hours: 0 }],
    ["metadata.unit_cost 0", { kind: "material", unit_cost: 0 }],
    ["metadata.markup 0", { kind: "labor", markup: 0 }],
    ["unknown extra metadata key", { kind: "labor", somethingElse: "x" }],
    ["economics without kind", { hours: 14 }],
    ["unknown kind", { kind: "warranty_credit" }],
    ["empty kind", { kind: "" }],
  ])("%s is NOT empty", (_label, metadata) => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata })).toBe(false);
  });

  test("a description alone disqualifies the row", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, description: "Technician", metadata: { kind: "labor" } })).toBe(false);
  });

  test("array metadata fails closed", () => {
    expect(isProvenEmptyInvoiceLineItemPlaceholder({ ...base, metadata: [] })).toBe(false);
  });
});

describe("TEST 2 - writer classifies a same-parent placeholder as proven stale", () => {
  const parent = "sample_invoice_alpha";
  const invoiceCloudId = cloudInvoiceUuid(1);
  const existing = [
    canonicalRow({ id: rowUuid(1), parent, index: 0, invoiceCloudId, kind: "labor" }),
    canonicalRow({ id: rowUuid(2), parent, index: 1, invoiceCloudId, kind: "material" }),
    blankPlaceholderRow({ id: rowUuid(3), parent, index: 2, invoiceCloudId, kind: "labor" }),
    blankPlaceholderRow({ id: rowUuid(4), parent, index: 3, invoiceCloudId, kind: "material" }),
  ];
  const payloads = [payloadFor(parent, 0), payloadFor(parent, 1)];
  const confirmed = new Map([[parent, invoiceCloudId]]);

  test("both blank rows are proven stale with no exact twin required", () => {
    const plan = planProvenStaleInvoiceLineItems(existing, payloads, confirmed);

    expect(plan.provenStalePlaceholderRows).toHaveLength(2);
    expect(plan.provenStaleDuplicateRows).toHaveLength(0);
    expect(plan.unresolvedExtraRows).toHaveLength(0);
    expect(plan.provenStaleRows.map((row) => row.legacy_local_id)).toEqual([
      `invoice:${parent}:line:2`,
      `invoice:${parent}:line:3`,
    ]);
    expect(plan.counts.provenStale).toBe(2);
    expect(plan.counts.provenStalePlaceholder).toBe(2);
    expect(plan.counts.unresolvedExtra).toBe(0);
  });
});

describe("TEST 3 - meaningful same-parent extras are refused", () => {
  const parent = "sample_invoice_alpha";
  const invoiceCloudId = cloudInvoiceUuid(1);
  const payloads = [payloadFor(parent, 0), payloadFor(parent, 1)];
  const confirmed = new Map([[parent, invoiceCloudId]]);
  const base = () => [
    canonicalRow({ id: rowUuid(1), parent, index: 0, invoiceCloudId, kind: "labor" }),
    canonicalRow({ id: rowUuid(2), parent, index: 1, invoiceCloudId, kind: "material" }),
  ];

  test.each([
    ["description", { description: "Technician" }],
    ["quantity", { quantity: 1 }],
    ["unit_price", { unit_price: 50 }],
    ["total_price", { total_price: 700 }],
    ["metadata.hours", { metadata: { kind: "labor", hours: 14 } }],
    ["explicit zero quantity", { quantity: 0 }],
    ["explicit zero unit_price", { unit_price: 0 }],
  ])("an extra carrying %s stays unresolved and is never repaired", (_label, override) => {
    const meaningful = { ...blankPlaceholderRow({ id: rowUuid(3), parent, index: 2, invoiceCloudId, kind: "labor" }), ...override };
    const plan = planProvenStaleInvoiceLineItems([...base(), meaningful], payloads, confirmed);

    expect(plan.provenStaleRows).toHaveLength(0);
    expect(plan.provenStalePlaceholderRows).toHaveLength(0);
    expect(plan.unresolvedExtraRows.map((row) => row.id)).toEqual([rowUuid(3)]);
  });

  test("an extra attached to an unconfirmed parent stays unresolved", () => {
    const orphan = blankPlaceholderRow({ id: rowUuid(9), parent: "unknown_parent", index: 2, invoiceCloudId: cloudInvoiceUuid(99), kind: "labor" });
    const plan = planProvenStaleInvoiceLineItems([...base(), orphan], payloads, confirmed);
    expect(plan.provenStaleRows).toHaveLength(0);
    expect(plan.unresolvedExtraRows).toHaveLength(1);
  });

  test("a blank row whose parent segment does not match its invoice identity stays unresolved", () => {
    const wrongSegment = blankPlaceholderRow({ id: rowUuid(8), parent: "some_other_invoice", index: 2, invoiceCloudId, kind: "labor" });
    const plan = planProvenStaleInvoiceLineItems([...base(), wrongSegment], payloads, confirmed);
    expect(plan.provenStalePlaceholderRows).toHaveLength(0);
    expect(plan.unresolvedExtraRows).toHaveLength(1);
  });
});

describe("TEST 4 - the existing wrong-parent duplicate proof still works", () => {
  test("a wrong-parent duplicate with an exact canonical twin is still proven stale as a duplicate", () => {
    const parent = "sample_invoice_alpha";
    const invoiceCloudId = cloudInvoiceUuid(1);
    const canonical = canonicalRow({ id: rowUuid(1), parent, index: 0, invoiceCloudId, kind: "labor" });
    const staleTwin = {
      ...canonical,
      id: rowUuid(2),
      legacy_local_id: "invoice:old_legacy_parent:line:0",
    };
    const plan = planProvenStaleInvoiceLineItems(
      [canonical, staleTwin],
      [payloadFor(parent, 0)],
      new Map([[parent, invoiceCloudId]])
    );

    expect(plan.provenStaleDuplicateRows.map((row) => row.id)).toEqual([rowUuid(2)]);
    expect(plan.provenStalePlaceholderRows).toHaveLength(0);
    expect(plan.canonicalRows.map((row) => row.id)).toEqual([rowUuid(1)]);
    expect(plan.unresolvedExtraRows).toHaveLength(0);
  });
});

describe("TEST 5 - the exact 41 -> 25 fixture", () => {
  // Reproduces the paired-export pattern: 8 older/sample invoices each carrying
  // two canonical children plus one blank labor and one blank material
  // placeholder, plus one modern invoice with 9 valid canonical children.
  const SAMPLE_PARENTS = [
    "sample_invoice_vega_final_payment",
    "sample_invoice_hilton_final_punch_draft",
    "sample_invoice_hilton_progress_draw",
    "sample_invoice_hilton_mobilization_deposit",
    "sample_invoice_copper_state_after_hours_punch",
    "sample_invoice_sonoran_signage_add",
    "sample_invoice_sonoran_mobilization",
    "sample_invoice_copper_state_turn_cycle_one",
  ];
  const MODERN_PARENT = "inv_modern_current";

  function buildFixture() {
    const existing = [];
    const payloads = [];
    const confirmed = new Map();
    let rowSeq = 1;

    SAMPLE_PARENTS.forEach((parent, parentIndex) => {
      const invoiceCloudId = cloudInvoiceUuid(parentIndex + 1);
      confirmed.set(parent, invoiceCloudId);
      [0, 1].forEach((index) => {
        existing.push(canonicalRow({
          id: rowUuid(rowSeq++), parent, index, invoiceCloudId, kind: index === 0 ? "labor" : "material",
        }));
        payloads.push(payloadFor(parent, index));
      });
      existing.push(blankPlaceholderRow({ id: rowUuid(rowSeq++), parent, index: 2, invoiceCloudId, kind: "labor" }));
      existing.push(blankPlaceholderRow({ id: rowUuid(rowSeq++), parent, index: 3, invoiceCloudId, kind: "material" }));
    });

    const modernCloudId = cloudInvoiceUuid(90);
    confirmed.set(MODERN_PARENT, modernCloudId);
    for (let index = 0; index < 9; index += 1) {
      existing.push(canonicalRow({
        id: rowUuid(rowSeq++), parent: MODERN_PARENT, index, invoiceCloudId: modernCloudId, kind: index % 2 === 0 ? "labor" : "material",
      }));
      payloads.push(payloadFor(MODERN_PARENT, index));
    }
    return { existing, payloads, confirmed };
  }

  test("classifies 41 cloud rows against 25 canonical rows as 16 proven placeholders and 0 unresolved", () => {
    const { existing, payloads, confirmed } = buildFixture();

    expect(existing).toHaveLength(41);
    expect(payloads).toHaveLength(25);

    const plan = planProvenStaleInvoiceLineItems(existing, payloads, confirmed);

    expect(plan.counts.existing).toBe(41);
    expect(plan.counts.canonical).toBe(25);
    expect(plan.counts.provenStale).toBe(16);
    expect(plan.counts.provenStalePlaceholder).toBe(16);
    expect(plan.counts.provenStaleDuplicate).toBe(0);
    expect(plan.counts.unresolvedExtra).toBe(0);

    // The EXACT expected stale identities, not just a count.
    const expectedLegacyIds = SAMPLE_PARENTS.flatMap((parent) => [
      `invoice:${parent}:line:2`,
      `invoice:${parent}:line:3`,
    ]).sort();
    expect(plan.provenStaleRows.map((row) => row.legacy_local_id).sort()).toEqual(expectedLegacyIds);

    // Every canonical row survives classification untouched.
    const staleIds = new Set(plan.provenStaleRows.map((row) => row.id));
    const survivors = existing.filter((row) => !staleIds.has(row.id));
    expect(survivors).toHaveLength(25);
  });

  test("a single meaningful extra anywhere in the fixture blocks that row from repair", () => {
    const { existing, payloads, confirmed } = buildFixture();
    const meaningfulIndex = existing.findIndex((row) => row.legacy_local_id.endsWith(":line:2"));
    existing[meaningfulIndex] = { ...existing[meaningfulIndex], quantity: 0 };

    const plan = planProvenStaleInvoiceLineItems(existing, payloads, confirmed);

    expect(plan.counts.provenStalePlaceholder).toBe(15);
    expect(plan.counts.unresolvedExtra).toBe(1);
    expect(plan.provenStaleRows.map((row) => row.id)).not.toContain(existing[meaningfulIndex].id);
  });
});
