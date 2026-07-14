import {
  sanitizeLineItemParentSegment,
  computeStableLineItemIndexes,
  buildLineItemLegacyId,
  resolveLineItemSortOrder,
  buildLineItemMetadata,
  buildLineItemContractRow,
  buildParentLineItemContract,
  lineItemIncludesLineRole,
  lineItemIncludesKind,
} from "./cloudLineItemContract";

describe("cloudLineItemContract identity", () => {
  test("sanitizes the parent segment (lowercase, safe chars, trimmed)", () => {
    expect(sanitizeLineItemParentSegment("Est-2609 #A")).toBe("est-2609_a");
    expect(sanitizeLineItemParentSegment("")).toBe("parent");
    expect(sanitizeLineItemParentSegment("___")).toBe("parent");
  });

  test("deterministic legacy id uses the sanitized parent + stable index", () => {
    expect(buildLineItemLegacyId("estimate", "EST-1", 3)).toBe("estimate:est-1:line:3");
    expect(buildLineItemLegacyId("invoice", "inv_1", 0)).toBe("invoice:inv_1:line:0");
  });

  test("stable index prefers unique finite sort orders and falls back to position", () => {
    // All present and unique -> use sort_order values.
    expect(computeStableLineItemIndexes([{ sort_order: 5 }, { sort_order: 2 }])).toEqual([5, 2]);
    // Duplicate sort orders -> positional fallback for the whole parent.
    expect(computeStableLineItemIndexes([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 0 }, { sort_order: 1 }]))
      .toEqual([0, 1, 2, 3]);
    // Incomplete sort orders -> positional fallback.
    expect(computeStableLineItemIndexes([{ sort_order: 0 }, {}])).toEqual([0, 1]);
  });

  test("persisted sort_order keeps the source value, distinct from the identity index", () => {
    // Overlapping per-category sort orders (labor 0,1 then materials 0,1).
    const items = [
      { sort_order: 0, kind: "labor" }, { sort_order: 1, kind: "labor" },
      { sort_order: 0, kind: "material" }, { sort_order: 1, kind: "material" },
    ];
    const stable = computeStableLineItemIndexes(items); // positional: 0,1,2,3
    expect(stable).toEqual([0, 1, 2, 3]);
    // But the persisted sort_order stays as the source value.
    expect(items.map((item, index) => resolveLineItemSortOrder(item, index))).toEqual([0, 1, 0, 1]);
  });

  test("metadata carries unit_cost, and kind only for invoices", () => {
    expect(buildLineItemMetadata({ unit_cost: 42 })).toEqual({ unit_cost: 42 });
    expect(buildLineItemMetadata({ unit_cost: 42, kind: "material" }, { includeKind: true })).toEqual({ unit_cost: 42, kind: "material" });
    expect(buildLineItemMetadata({ unit_cost: 42, kind: "material" }, { includeKind: false })).toEqual({ unit_cost: 42 });
    expect(buildLineItemMetadata({})).toBeNull();
  });

  test("entity kind routing: estimate uses line_role, invoice uses metadata.kind", () => {
    expect(lineItemIncludesLineRole("estimate")).toBe(true);
    expect(lineItemIncludesLineRole("invoice")).toBe(false);
    expect(lineItemIncludesKind("invoice")).toBe(true);
    expect(lineItemIncludesKind("estimate")).toBe(false);

    const estRow = buildLineItemContractRow({ entityType: "estimate", item: { unit_cost: 5, kind: "labor", description: "L" }, index: 0, parentColumn: "estimate_id", parentCloudId: "E1" });
    expect(estRow).toMatchObject({ estimate_id: "E1", line_role: "labor", metadata: { unit_cost: 5 } });
    expect(estRow.metadata).not.toHaveProperty("kind");

    const invRow = buildLineItemContractRow({ entityType: "invoice", item: { unit_cost: 5, kind: "material", description: "M" }, index: 0, parentColumn: "invoice_id", parentCloudId: "I1" });
    expect(invRow).toMatchObject({ invoice_id: "I1", metadata: { unit_cost: 5, kind: "material" } });
    expect(invRow).not.toHaveProperty("line_role");
  });
});

describe("cloudLineItemContract whole-parent construction", () => {
  test("overlapping per-category sort orders yield unique identity ids but keep source sort_order", () => {
    const items = [
      { sort_order: 0, kind: "labor", description: "Labor A", quantity: 1, unit_price: 10, total: 10 },
      { sort_order: 1, kind: "labor", description: "Labor B", quantity: 1, unit_price: 20, total: 20 },
      { sort_order: 0, kind: "material", description: "Mat A", quantity: 1, unit_price: 5, total: 5 },
      { sort_order: 1, kind: "material", description: "Mat B", quantity: 1, unit_price: 6, total: 6 },
    ];
    const { rows, duplicateIds } = buildParentLineItemContract({ entityType: "estimate", parentLegacyId: "EST-9", parentCloudId: "cloud-est-9", parentColumn: "estimate_id", items });
    expect(duplicateIds).toEqual([]);
    // Identity ids are unique via positional fallback.
    expect(rows.map((r) => r.legacy_local_id)).toEqual([
      "estimate:est-9:line:0", "estimate:est-9:line:1", "estimate:est-9:line:2", "estimate:est-9:line:3",
    ]);
    // Persisted sort_order retains the overlapping source values.
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 0, 1]);
    // Estimate rows carry line_role.
    expect(rows.map((r) => r.line_role)).toEqual(["labor", "labor", "material", "material"]);
  });

  test("colliding sanitized parents across parents are reported as duplicates by the caller pattern", () => {
    // Two items in one parent can never collide (unique stable index), so
    // duplicateIds is empty within a single parent.
    const { duplicateIds } = buildParentLineItemContract({ entityType: "invoice", parentLegacyId: "inv_1", parentCloudId: "c", parentColumn: "invoice_id", items: [{}, {}] });
    expect(duplicateIds).toEqual([]);
  });
});

describe("cloudLineItemContract deterministic restore ordering", () => {
  const { parseLineItemStableIndex, compareRestoredLineItemOrder } = require("./cloudLineItemContract");

  test("parses the stable index from a canonical legacy id, null otherwise", () => {
    expect(parseLineItemStableIndex("invoice:inv-1:line:3")).toBe(3);
    expect(parseLineItemStableIndex("estimate:est-1:line:0")).toBe(0);
    expect(parseLineItemStableIndex("weird-id")).toBeNull();
    expect(parseLineItemStableIndex("")).toBeNull();
    expect(parseLineItemStableIndex(null)).toBeNull();
  });

  test("orders by stable index first, regardless of overlapping sort_order", () => {
    const rows = [
      { legacy_local_id: "invoice:i:line:2", sort_order: 0, __fetchPos: 0 },
      { legacy_local_id: "invoice:i:line:0", sort_order: 0, __fetchPos: 1 },
      { legacy_local_id: "invoice:i:line:1", sort_order: 1, __fetchPos: 2 },
    ];
    expect(rows.slice().sort(compareRestoredLineItemOrder).map((r) => r.legacy_local_id))
      .toEqual(["invoice:i:line:0", "invoice:i:line:1", "invoice:i:line:2"]);
  });

  test("falls back to finite sort_order, then legacy id, then fetched position when the id is unparseable", () => {
    const rows = [
      { legacy_local_id: "zzz", sort_order: 5, __fetchPos: 0 },
      { legacy_local_id: "aaa", sort_order: 2, __fetchPos: 1 },
      { legacy_local_id: "bbb", __fetchPos: 2 }, // missing sort_order -> last
    ];
    expect(rows.slice().sort(compareRestoredLineItemOrder).map((r) => r.legacy_local_id)).toEqual(["aaa", "zzz", "bbb"]);
    // Same sort_order and unparseable ids -> tie broken by legacy id then position.
    const tied = [
      { legacy_local_id: "b", sort_order: 1, __fetchPos: 1 },
      { legacy_local_id: "a", sort_order: 1, __fetchPos: 0 },
    ];
    expect(tied.slice().sort(compareRestoredLineItemOrder).map((r) => r.legacy_local_id)).toEqual(["a", "b"]);
  });
});
