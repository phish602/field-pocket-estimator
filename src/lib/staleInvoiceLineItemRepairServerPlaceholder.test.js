// Server-side proof for the SECOND stale invoice-child class: obsolete
// semantically-empty placeholder rows. The server re-proves every row itself and
// never trusts the browser's classification.

const {
  REPAIR_VERSION,
  repairStaleInvoiceLineItemDuplicates,
} = require("../../server/staleInvoiceLineItemRepair");

const PARENT_LEGACY_ID = "sample_invoice_vega_final_payment";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  invoice: "10000000-0000-4000-8000-000000000003",
  canonical0: "10000000-0000-4000-8000-000000000004",
  canonical1: "10000000-0000-4000-8000-000000000005",
  blankLabor: "10000000-0000-4000-8000-000000000006",
  blankMaterial: "10000000-0000-4000-8000-000000000007",
  payment1: "10000000-0000-4000-8000-000000000008",
  payment2: "10000000-0000-4000-8000-000000000009",
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseLine = (id, index, extra = {}) => ({
  id,
  company_id: ids.company,
  invoice_id: ids.invoice,
  legacy_local_id: `invoice:${PARENT_LEGACY_ID}:line:${index}`,
  sort_order: index,
  description: null,
  quantity: null,
  unit: null,
  unit_price: null,
  total_price: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const canonicalLine = (id, index, kind) => baseLine(id, index, {
  description: kind === "labor" ? "Technician" : "Panel",
  quantity: "1.00",
  unit_price: "50.00",
  total_price: "50.00",
  metadata: { kind },
});

const blankLine = (id, index, kind) => baseLine(id, index, { sort_order: 0, description: "", metadata: { kind } });

function fixture(overrides = {}) {
  return {
    auth: { data: { user: { id: ids.owner } }, error: null },
    memberships: [{ company_id: ids.company, user_id: ids.owner, role: "owner", status: "active", archived_at: null, deleted_at: null }],
    locks: [{ company_id: ids.company, setting_scope: "company", setting_key: "active_device_lock", setting_value: { activeDeviceId: "device-safe", activeUserId: ids.owner, activeDeviceRevokedAt: null } }],
    invoices: [{
      id: ids.invoice, company_id: ids.company, customer_id: null, project_id: null, estimate_id: null,
      source_estimate_legacy_id: null, legacy_local_id: PARENT_LEGACY_ID, invoice_number: "INV-2604", estimate_number: null,
      status: "sent", payment_status: "unpaid", invoice_date: "2026-01-01", due_date: null, total_amount: "100.00",
      amount_paid: "0", balance_remaining: "100", notes: null, terms: null, created_by: ids.owner, updated_by: ids.owner,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
      archived_at: null, archived_by: null, deleted_at: null, deleted_by: null,
    }],
    lineItems: [
      canonicalLine(ids.canonical0, 0, "labor"),
      canonicalLine(ids.canonical1, 1, "material"),
      blankLine(ids.blankLabor, 2, "labor"),
      blankLine(ids.blankMaterial, 3, "material"),
    ],
    payments: [
      { id: ids.payment1, invoice_id: ids.invoice, company_id: ids.company },
      { id: ids.payment2, invoice_id: ids.invoice, company_id: ids.company },
    ],
    auditEvents: [],
    ...overrides,
  };
}

function serviceRoleMock(seed = {}, behavior = {}) {
  const state = clone(seed);
  const trace = [];
  const supported = new Set(["company_users", "app_settings", "invoices", "invoice_line_items", "invoice_payments", "audit_events"]);
  const rowsFor = (table) => ({
    company_users: state.memberships, app_settings: state.locks, invoices: state.invoices,
    invoice_line_items: state.lineItems, invoice_payments: state.payments, audit_events: state.auditEvents,
  })[table];
  const matches = (row, filters) => filters.every((filter) => (filter.kind === "eq"
    ? row[filter.column] === filter.value
    : filter.values.includes(row[filter.column])));
  const client = {
    auth: { getUser: jest.fn(async () => state.auth) },
    from: jest.fn((table) => {
      if (!supported.has(table)) throw new Error(`unsupported table ${table}`);
      const operation = { table, kind: "read", filters: [], selected: null, payload: null, options: null };
      const builder = {
        select(columns) { operation.selected = columns; return builder; },
        eq(column, value) { operation.filters.push({ kind: "eq", column, value }); return builder; },
        in(column, values) { operation.filters.push({ kind: "in", column, values }); return builder; },
        insert(payload) { operation.kind = "insert"; operation.payload = payload; return builder; },
        delete() { operation.kind = "delete"; return builder; },
        upsert(payload, options) { operation.kind = "upsert"; operation.payload = payload; operation.options = options; return builder; },
        then(resolve, reject) {
          try { return Promise.resolve(execute(operation)).then(resolve, reject); } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      const execute = (query) => {
        trace.push({ table, operation: query.kind, payload: clone(query.payload) });
        if (query.kind === "read") return { data: clone(rowsFor(table).filter((row) => matches(row, query.filters))), error: null };
        if (query.kind === "insert") {
          const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
          state.auditEvents.push(...clone(payload));
          return { data: query.selected ? clone(payload).map((row, index) => ({ ...row, id: `audit-${index}` })) : null, error: null };
        }
        if (query.kind === "delete") {
          const deleted = state.lineItems.filter((row) => matches(row, query.filters));
          state.lineItems = state.lineItems.filter((row) => !matches(row, query.filters));
          if (behavior.afterDelete) behavior.afterDelete(state);
          return { data: query.selected ? clone(deleted).map((row) => ({ id: row.id })) : null, error: null };
        }
        if (query.kind === "upsert") {
          const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
          payload.forEach((row) => {
            state.lineItems = state.lineItems.filter((entry) => entry.id !== row.id);
            state.lineItems.push(clone(row));
          });
          return { data: query.selected ? clone(payload) : null, error: null };
        }
        throw new Error(`unsupported operation ${query.kind}`);
      };
      return builder;
    }),
  };
  return { client, state, trace };
}

const request = (mock, overrides = {}) => repairStaleInvoiceLineItemDuplicates({
  adminClient: mock.client,
  companyId: ids.company,
  deviceId: "device-safe",
  staleRowIds: [ids.blankLabor, ids.blankMaterial],
  accessToken: "test-access-token",
  ...overrides,
});

const mutations = (mock) => mock.trace.filter((entry) => ["insert", "delete", "upsert"].includes(entry.operation));

describe("TEST 6 - server accepts the exact placeholder proof", () => {
  test("blank same-parent placeholders are quarantined and deleted, leaving everything else intact", async () => {
    const mock = serviceRoleMock(fixture());
    const result = await request(mock);

    expect(result).toEqual({ ok: true, status: 200, repaired: 2, repairVersion: REPAIR_VERSION });

    // Audit quarantine written for each row, labelled with the correct proof type.
    expect(mock.state.auditEvents).toHaveLength(2);
    mock.state.auditEvents.forEach((event) => {
      expect(event.event_type).toBe("cloud_repair.stale_invoice_line_item_duplicate_quarantined");
      expect(event.payload.proofType).toBe("empty_placeholder");
      expect(event.payload.stale).toBeTruthy();
    });

    // Exactly the two stale rows are gone; both canonical children survive.
    const remainingIds = mock.state.lineItems.map((row) => row.id).sort();
    expect(remainingIds).toEqual([ids.canonical0, ids.canonical1].sort());

    // Invoice parent and payments untouched.
    expect(mock.state.invoices).toHaveLength(1);
    expect(mock.state.invoices[0].legacy_local_id).toBe(PARENT_LEGACY_ID);
    expect(mock.state.payments.map((row) => row.id).sort()).toEqual([ids.payment1, ids.payment2].sort());
  });

  test("null and {} metadata placeholders are also proven", async () => {
    const seed = fixture();
    seed.lineItems[2] = { ...seed.lineItems[2], metadata: null };
    seed.lineItems[3] = { ...seed.lineItems[3], metadata: {} };
    const mock = serviceRoleMock(seed);

    const result = await request(mock);
    expect(result.ok).toBe(true);
    expect(mock.state.lineItems).toHaveLength(2);
  });

  test("existing authorization gates still apply to placeholder repairs", async () => {
    const unauthorized = serviceRoleMock(fixture({
      memberships: [{ company_id: ids.company, user_id: ids.owner, role: "member", status: "active", archived_at: null, deleted_at: null }],
    }));
    expect(await request(unauthorized)).toEqual({ ok: false, status: 403, error: "Forbidden." });
    expect(mutations(unauthorized)).toHaveLength(0);
    expect(unauthorized.state.lineItems).toHaveLength(4);

    const wrongDevice = serviceRoleMock(fixture());
    expect(await request(wrongDevice, { deviceId: "device-other" })).toEqual({ ok: false, status: 403, error: "Forbidden." });
    expect(mutations(wrongDevice)).toHaveLength(0);
    expect(wrongDevice.state.lineItems).toHaveLength(4);
  });
});

describe("TEST 7 - server refuses a meaningful row", () => {
  test.each([
    ["a description", { description: "Technician" }],
    ["a quantity", { quantity: "1.00" }],
    ["an explicit zero quantity", { quantity: 0 }],
    ["an explicit zero unit_price", { unit_price: 0 }],
    ["an explicit zero total_price", { total_price: 0 }],
    ["metadata.hours 0", { metadata: { kind: "labor", hours: 0 } }],
    ["metadata.unit_cost 0", { metadata: { kind: "material", unit_cost: 0 } }],
    ["an unknown metadata key", { metadata: { kind: "labor", note: "x" } }],
    ["an unsupported kind", { metadata: { kind: "warranty_credit" } }],
  ])("refuses the whole batch when one candidate carries %s", async (_label, override) => {
    const seed = fixture();
    seed.lineItems[2] = { ...seed.lineItems[2], ...override };
    const mock = serviceRoleMock(seed);

    const result = await request(mock);

    expect(result).toEqual({ ok: false, status: 409, error: "Repair refused." });
    // No archive, no delete -- the safe row in the same batch is not deleted either.
    expect(mutations(mock)).toHaveLength(0);
    expect(mock.state.lineItems).toHaveLength(4);
    expect(mock.state.auditEvents).toHaveLength(0);
  });

  test("refuses a blank row whose parent segment does not match the invoice identity", async () => {
    const seed = fixture();
    seed.lineItems[2] = { ...seed.lineItems[2], legacy_local_id: "invoice:some_other_invoice:line:2" };
    const mock = serviceRoleMock(seed);

    expect(await request(mock)).toEqual({ ok: false, status: 409, error: "Repair refused." });
    expect(mutations(mock)).toHaveLength(0);
    expect(mock.state.lineItems).toHaveLength(4);
  });

  test("refuses a blank row whose legacy id is not deterministic", async () => {
    const seed = fixture();
    seed.lineItems[2] = { ...seed.lineItems[2], legacy_local_id: "not-a-deterministic-id" };
    const mock = serviceRoleMock(seed);

    expect(await request(mock)).toEqual({ ok: false, status: 409, error: "Repair refused." });
    expect(mock.state.lineItems).toHaveLength(4);
  });
});

describe("TEST 8 - compensation remains intact", () => {
  test("a post-delete verification failure restores the deleted placeholders exactly", async () => {
    // Force verification to fail by mutating a surviving canonical row after the
    // delete, so the "canonical rows unchanged" check cannot pass.
    const mock = serviceRoleMock(fixture(), {
      afterDelete: (state) => {
        state.lineItems = state.lineItems.map((row) => (
          row.id === ids.canonical0 ? { ...row, unit_price: "999.00" } : row
        ));
      },
    });

    const result = await request(mock);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);

    // Both stale rows were restored byte-for-byte.
    const restored = mock.state.lineItems.filter((row) => [ids.blankLabor, ids.blankMaterial].includes(row.id));
    expect(restored).toHaveLength(2);
    const original = fixture().lineItems.filter((row) => [ids.blankLabor, ids.blankMaterial].includes(row.id));
    original.forEach((before) => {
      expect(restored.find((after) => after.id === before.id)).toEqual(before);
    });

    // A compensation audit event was recorded alongside the quarantine events.
    expect(mock.state.auditEvents.some((event) => event.event_type === "cloud_repair.stale_invoice_line_item_duplicate_compensated")).toBe(true);
  });
});
