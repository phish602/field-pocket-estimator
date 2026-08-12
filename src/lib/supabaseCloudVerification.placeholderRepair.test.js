// Verification must be able to say "this mismatch is safely repairable" so the
// existing recovery flow can act. It stays READ-ONLY and never marks a mismatch
// as matched.

const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  runSupabaseCloudVerification,
  STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR,
} = require("./supabaseCloudVerification");
const { mapLocalSnapshotToBackendDraft } = require("../utils/backendDataMapper");
const { buildParentLineItemContract } = require("./cloudLineItemContract");

const PARENTS = [
  "sample_invoice_vega_final_payment",
  "sample_invoice_hilton_final_punch_draft",
  "sample_invoice_hilton_progress_draw",
  "sample_invoice_hilton_mobilization_deposit",
  "sample_invoice_copper_state_after_hours_punch",
  "sample_invoice_sonoran_signage_add",
  "sample_invoice_sonoran_mobilization",
  "sample_invoice_copper_state_turn_cycle_one",
];
const MODERN = "inv_modern_current";

// Local invoices built so the corrected mapper emits exactly 2 canonical children
// for each sample invoice and 9 for the modern one -> 25 canonical children.
function localInvoices() {
  const sample = PARENTS.map((id, index) => ({
    id,
    customerId: "cust_1",
    projectId: "proj_1",
    invoiceNumber: `INV-26${String(index).padStart(2, "0")}`,
    invoiceTotal: 100,
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [{ id: `${id}_l0`, role: "Technician", qty: 1, hours: 2, rate: 25 }] },
    materials: { markupPct: 0, blanketCost: "", items: [{ id: `${id}_m0`, desc: "Panel", qty: 1, priceEach: 50 }] },
    ui: { docType: "invoice", materialsMode: "itemized" },
  }));
  const modern = {
    id: MODERN,
    customerId: "cust_1",
    projectId: "proj_1",
    invoiceNumber: "INV-2700",
    invoiceTotal: 900,
    labor: {
      hazardPct: 0, riskPct: 0, multiplier: 1,
      lines: Array.from({ length: 4 }, (_, index) => ({ id: `mod_l${index}`, role: `Tech ${index}`, qty: 1, hours: 1, rate: 100 })),
    },
    materials: {
      markupPct: 0, blanketCost: "",
      items: Array.from({ length: 5 }, (_, index) => ({ id: `mod_m${index}`, desc: `Part ${index}`, qty: 1, priceEach: 100 })),
    },
    ui: { docType: "invoice", materialsMode: "itemized" },
  };
  return [...sample, modern];
}

function buildStorageSnapshot() {
  const invoices = localInvoices();
  return {
    getItem(key) {
      const values = {
        "estipaid-company-profile-v1": JSON.stringify({ id: "local_company", companyName: "AAS Property Care" }),
        "estipaid-customers-v1": JSON.stringify([{ id: "cust_1", name: "Acme Co" }]),
        "estipaid-projects-v1": JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]),
        "estipaid-estimates-v1": JSON.stringify([]),
        "estipaid-invoices-v1": JSON.stringify(invoices),
        "estipaid-settings-v1": JSON.stringify({}),
        "estipaid-scope-templates-v1": JSON.stringify([]),
        "estipaid-audit-events-v1": JSON.stringify([]),
        "estipaid-cloud-partial-recovery-status-v1": null,
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

const cloudInvoiceId = (legacyId) => `db_${legacyId}`;

// Canonical cloud rows are DERIVED from the same shared contract the verifier
// builds its expectations from, so "matched" here means genuinely matched rather
// than a hand-guessed shape that happens to line up.
function canonicalCloudChildren() {
  const draft = mapLocalSnapshotToBackendDraft(
    {
      companyProfile: { id: "local_company", companyName: "AAS Property Care" },
      customers: [{ id: "cust_1", name: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [],
      invoices: localInvoices(),
      settings: {},
      scopeTemplates: [],
      auditEvents: [],
    },
    { companyId: "company_1", userId: "user_1" }
  );
  return draft.invoices.flatMap((invoice) => buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: invoice.legacy_local_id,
    parentCloudId: cloudInvoiceId(invoice.legacy_local_id),
    parentColumn: "invoice_id",
    items: invoice.line_items,
  }).rows.map((row) => ({ id: `row_${row.legacy_local_id}`, ...row })));
}

function blankCloudChild(parent, index, kind) {
  return {
    id: `row_${parent}_${index}`,
    legacy_local_id: `invoice:${parent}:line:${index}`,
    invoice_id: cloudInvoiceId(parent),
    sort_order: 0,
    description: "",
    quantity: null,
    unit: null,
    unit_price: null,
    total_price: null,
    metadata: { kind },
  };
}

// Build cloud rows from the verifier's OWN expected contract so the canonical
// rows genuinely match, then append the 16 stale blanks.
function buildCloudRows({ staleOverrides = {} } = {}) {
  const invoices = localInvoices().map((invoice) => ({ id: cloudInvoiceId(invoice.id), legacy_local_id: invoice.id }));
  const children = canonicalCloudChildren();
  const stale = [];
  PARENTS.forEach((parent) => {
    stale.push(blankCloudChild(parent, 2, "labor"));
    stale.push(blankCloudChild(parent, 3, "material"));
  });
  Object.entries(staleOverrides).forEach(([legacyId, override]) => {
    const target = stale.find((row) => row.legacy_local_id === legacyId);
    if (target) Object.assign(target, override);
  });
  return {
    customers: [{ id: "db_cust_1", legacy_local_id: "cust_1" }],
    projects: [{ id: "db_proj_1", legacy_local_id: "proj_1" }],
    estimates: [],
    invoices,
    invoice_payments: [],
    estimate_line_items: [],
    invoice_line_items: [...children, ...stale],
  };
}

function createMockClient(rowsByTable) {
  const from = jest.fn((table) => {
    const eq = jest.fn(async () => ({ data: rowsByTable[table] || [], error: null }));
    return { select: jest.fn(() => ({ eq })) };
  });
  return { from };
}

async function run(rowsByTable) {
  mockGetSupabaseClient.mockReturnValue(createMockClient(rowsByTable));
  return runSupabaseCloudVerification({
    storageSnapshot: buildStorageSnapshot(),
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "AAS Property Care" },
  });
}

beforeEach(() => {
  mockGetSupabaseClient.mockReset();
});

describe("TEST 9 - verification reports an available repair", () => {
  test("25 canonical vs 41 cloud children with 16 proven blanks is repairable-only", async () => {
    const rows = buildCloudRows();
    expect(rows.invoice_line_items).toHaveLength(41);

    const result = await run(rows);

    expect(result.ok).toBe(true);
    expect(result.localCounts.invoiceLineItems).toBe(25);
    // The mismatch is still a mismatch -- nothing is silently accepted.
    expect(result.allMatched).toBe(false);

    expect(result.availableRepairs).toHaveLength(1);
    const repair = result.availableRepairs[0];
    expect(repair.type).toBe(STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR);
    expect(repair.table).toBe("invoice_line_items");
    expect(repair.count).toBe(16);
    expect(repair.rowIds).toHaveLength(16);
    expect(repair.legacyIds).toEqual(
      PARENTS.flatMap((parent) => [`invoice:${parent}:line:2`, `invoice:${parent}:line:3`]).sort()
    );

    expect(result.repairableMismatchOnly).toBe(true);

    // The repair descriptor carries no business data.
    expect(Object.keys(repair).sort()).toEqual(["count", "legacyIds", "rowIds", "table", "type"]);

    // Verification performed no writes.
    expect(result.noWritesPerformed).toBe(true);
  });

  test("a fully matched cloud offers no repairs and is not repairable-only", async () => {
    const rows = buildCloudRows();
    const staleLegacyIds = new Set(PARENTS.flatMap((parent) => [`invoice:${parent}:line:2`, `invoice:${parent}:line:3`]));
    rows.invoice_line_items = rows.invoice_line_items.filter((row) => !staleLegacyIds.has(row.legacy_local_id));
    expect(rows.invoice_line_items).toHaveLength(25);

    const result = await run(rows);

    expect(result.allMatched).toBe(true);
    expect(result.availableRepairs).toEqual([]);
    expect(result.repairableMismatchOnly).toBe(false);
  });
});

// The shape observed in Production: 19 semantically-blank historical children,
// 17 carrying the generic kind:"invoice" tag and 2 carrying kind:"material".
// Synthetic rows only -- no Production business payload is reproduced here.
const PRODUCTION_SHAPED_STALE_KINDS = Array.from({ length: 19 }, (_, index) => (index < 17 ? "invoice" : "material"));

// Blanks sit at indices that never collide with canonical children: samples carry
// canonical 0..1 and blanks at 2..3, the modern invoice carries canonical 0..8 and
// blanks at 9..11.
function productionShapedStaleSlots() {
  const slots = [];
  PARENTS.forEach((parent) => { slots.push([parent, 2], [parent, 3]); });
  [9, 10, 11].forEach((index) => slots.push([MODERN, index]));
  return slots.slice(0, PRODUCTION_SHAPED_STALE_KINDS.length);
}

function buildProductionShapedCloudRows({ staleOverrides = {} } = {}) {
  const rows = buildCloudRows();
  const canonical = canonicalCloudChildren();
  const stale = productionShapedStaleSlots().map(([parent, index], slot) => (
    blankCloudChild(parent, index, PRODUCTION_SHAPED_STALE_KINDS[slot])
  ));
  Object.entries(staleOverrides).forEach(([legacyId, override]) => {
    const target = stale.find((row) => row.legacy_local_id === legacyId);
    if (target) Object.assign(target, override);
  });
  return { ...rows, invoice_line_items: [...canonical, ...stale] };
}

describe("TEST 17 - the Production-shaped 17 invoice + 2 material mismatch", () => {
  test("19 blank historical children are reported as one repairable-only repair", async () => {
    const rows = buildProductionShapedCloudRows();
    const stale = rows.invoice_line_items.filter((row) => row.description === "");
    expect(stale).toHaveLength(19);
    expect(stale.filter((row) => row.metadata.kind === "invoice")).toHaveLength(17);
    expect(stale.filter((row) => row.metadata.kind === "material")).toHaveLength(2);
    expect(rows.invoice_line_items).toHaveLength(44);

    const result = await run(rows);

    expect(result.ok).toBe(true);
    expect(result.localCounts.invoiceLineItems).toBe(25);
    // Still a genuine mismatch -- nothing is silently accepted.
    expect(result.allMatched).toBe(false);

    expect(result.availableRepairs).toHaveLength(1);
    const repair = result.availableRepairs[0];
    expect(repair.type).toBe(STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR);
    expect(repair.table).toBe("invoice_line_items");
    // All 19 classified repairable, zero unresolved extras.
    expect(repair.count).toBe(19);
    expect(repair.rowIds).toHaveLength(19);
    expect(repair.legacyIds.sort()).toEqual(
      productionShapedStaleSlots().map(([parent, index]) => `invoice:${parent}:line:${index}`).sort()
    );

    expect(result.repairableMismatchOnly).toBe(true);
    expect(result.noWritesPerformed).toBe(true);
  });

  test.each([
    ["a description", { description: "Technician" }],
    ["an explicit zero quantity", { quantity: 0 }],
    ["an explicit zero unit_price", { unit_price: 0 }],
    ["an explicit zero total_price", { total_price: 0 }],
    ["metadata.hours 0", { metadata: { kind: "invoice", hours: 0 } }],
    ["an unknown metadata key", { metadata: { kind: "invoice", note: "x" } }],
  ])("one kind:\"invoice\" row carrying %s blocks the repairable verdict", async (_label, override) => {
    const rows = buildProductionShapedCloudRows({
      staleOverrides: { [`invoice:${PARENTS[0]}:line:2`]: override },
    });

    const result = await run(rows);

    expect(result.allMatched).toBe(false);
    expect(result.repairableMismatchOnly).toBe(false);
    expect(result.availableRepairs[0].count).toBe(18);
    expect(result.availableRepairs[0].legacyIds).not.toContain(`invoice:${PARENTS[0]}:line:2`);
  });
});

describe("TEST 10 - mixed unsafe mismatch is never repairable-only", () => {
  test.each([
    ["a description", { description: "Technician" }],
    ["an explicit zero quantity", { quantity: 0 }],
    ["an explicit zero unit_price", { unit_price: 0 }],
    ["metadata.hours", { metadata: { kind: "labor", hours: 14 } }],
  ])("15 safe blanks plus one extra carrying %s blocks the repairable verdict", async (_label, override) => {
    const rows = buildCloudRows({
      staleOverrides: { [`invoice:${PARENTS[0]}:line:2`]: override },
    });

    const result = await run(rows);

    expect(result.allMatched).toBe(false);
    expect(result.repairableMismatchOnly).toBe(false);
    // The 15 provable blanks are still reported, but the meaningful row is never
    // among them and the mismatch is not auto-resolvable.
    expect(result.availableRepairs[0].count).toBe(15);
    expect(result.availableRepairs[0].legacyIds).not.toContain(`invoice:${PARENTS[0]}:line:2`);
  });

  test("a cloud child missing from the cloud entirely blocks the repairable verdict", async () => {
    const rows = buildCloudRows();
    rows.invoice_line_items = rows.invoice_line_items.filter((row) => row.legacy_local_id !== `invoice:${MODERN}:line:0`);

    const result = await run(rows);

    expect(result.repairableMismatchOnly).toBe(false);
  });

  test("a mismatch in another table blocks the repairable verdict", async () => {
    const rows = buildCloudRows();
    rows.customers = [];

    const result = await run(rows);

    expect(result.repairableMismatchOnly).toBe(false);
  });

  test("a semantic drift among expected invoice children blocks the repairable verdict", async () => {
    const rows = buildCloudRows();
    const target = rows.invoice_line_items.find((row) => row.legacy_local_id === `invoice:${PARENTS[0]}:line:0`);
    target.unit_price = 9999;

    const result = await run(rows);

    expect(result.repairableMismatchOnly).toBe(false);
  });
});
