const {
  REPAIR_VERSION,
  repairStaleInvoiceLineItemDuplicates,
} = require("../../server/staleInvoiceLineItemRepair");

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  invoice: "10000000-0000-4000-8000-000000000003",
  canonical1: "10000000-0000-4000-8000-000000000004",
  stale1: "10000000-0000-4000-8000-000000000005",
  canonical2: "10000000-0000-4000-8000-000000000006",
  stale2: "10000000-0000-4000-8000-000000000007",
  payment1: "10000000-0000-4000-8000-000000000008",
  payment2: "10000000-0000-4000-8000-000000000009",
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const line = (id, legacy, sortOrder, extra = {}) => ({
  id, company_id: ids.company, invoice_id: ids.invoice, legacy_local_id: legacy, sort_order: sortOrder,
  description: `Work ${sortOrder}`, quantity: "2.00", unit: "ea", unit_price: "10.00", total_price: "20.00",
  metadata: { source: "fixture", sortOrder }, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", ...extra,
});

function fixture(overrides = {}) {
  const current = line(ids.canonical1, "invoice:local-current:line:0", 0);
  const stale = line(ids.stale1, "invoice:local-previous:line:0", 0);
  const current2 = line(ids.canonical2, "invoice:local-current:line:1", 1);
  const stale2 = line(ids.stale2, "invoice:local-previous:line:1", 1);
  return {
    auth: { data: { user: { id: ids.owner } }, error: null },
    memberships: [{ company_id: ids.company, user_id: ids.owner, role: "owner", status: "active", archived_at: null, deleted_at: null }],
    locks: [{ company_id: ids.company, setting_scope: "company", setting_key: "active_device_lock", setting_value: { activeDeviceId: "device-safe", activeUserId: ids.owner, activeDeviceRevokedAt: null } }],
    invoices: [{ id: ids.invoice, company_id: ids.company, customer_id: null, project_id: null, estimate_id: null, source_estimate_legacy_id: null, legacy_local_id: "local-current", invoice_number: "TEST-100", estimate_number: null, status: "sent", payment_status: "unpaid", invoice_date: "2026-01-01", due_date: null, total_amount: "40.00", amount_paid: "0", balance_remaining: "40", notes: null, terms: null, created_by: ids.owner, updated_by: ids.owner, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", archived_at: null, archived_by: null, deleted_at: null, deleted_by: null }],
    lineItems: [current, stale, current2, stale2],
    payments: [{ id: ids.payment1, invoice_id: ids.invoice, company_id: ids.company }, { id: ids.payment2, invoice_id: ids.invoice, company_id: ids.company }],
    auditEvents: [],
    ...overrides,
  };
}

function serviceRoleMock(seed = {}, behavior = {}) {
  const state = clone(seed);
  const trace = [];
  const supported = new Set(["company_users", "app_settings", "invoices", "invoice_line_items", "invoice_payments", "audit_events"]);
  const rowsFor = (table) => ({ company_users: state.memberships, app_settings: state.locks, invoices: state.invoices, invoice_line_items: state.lineItems, invoice_payments: state.payments, audit_events: state.auditEvents })[table];
  const matches = (row, filters) => filters.every((filter) => filter.kind === "eq" ? row[filter.column] === filter.value : filter.values.includes(row[filter.column]));
  const client = {
    auth: { getUser: jest.fn(async (token) => {
      trace.push({ table: "auth", operation: "getUser", token });
      return state.auth;
    }) },
    from: jest.fn((table) => {
      if (!supported.has(table)) throw new Error(`unsupported table ${table}`);
      const operation = { table, kind: "read", filters: [], selected: null, payload: null, options: null };
      const builder = {
        select(columns) { operation.selected = columns; return builder; },
        eq(column, value) { operation.filters.push({ kind: "eq", column, value }); return builder; },
        in(column, values) { if (!Array.isArray(values)) throw new Error("in requires an array"); operation.filters.push({ kind: "in", column, values }); return builder; },
        insert(payload) { operation.kind = "insert"; operation.payload = payload; return builder; },
        delete() { operation.kind = "delete"; return builder; },
        upsert(payload, options) { operation.kind = "upsert"; operation.payload = payload; operation.options = options; return builder; },
        then(resolve, reject) {
          try { return Promise.resolve(execute(operation)).then(resolve, reject); } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      const execute = (query) => {
        trace.push({ table, operation: query.kind, filters: clone(query.filters), selected: query.selected, payload: clone(query.payload) });
        if (behavior.throwOn?.[`${table}:${query.kind}`]) throw new Error("database failure");
        if (query.kind === "read") return { data: clone(rowsFor(table).filter((row) => matches(row, query.filters))), error: behavior.errors?.[`${table}:read`] || null };
        if (query.kind === "insert") {
          if (behavior.errors?.[`${table}:insert`]) return { data: null, error: behavior.errors[`${table}:insert`] };
          const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
          state.auditEvents.push(...clone(payload));
          const returned = behavior.auditReturnedCount == null ? payload : payload.slice(0, behavior.auditReturnedCount);
          return { data: query.selected ? clone(returned).map((row, index) => ({ ...row, id: `audit-${index}` })) : null, error: null };
        }
        if (query.kind === "delete") {
          if (behavior.errors?.[`${table}:delete`]) return { data: null, error: behavior.errors[`${table}:delete`] };
          const deleted = state.lineItems.filter((row) => matches(row, query.filters));
          state.lineItems = state.lineItems.filter((row) => !matches(row, query.filters));
          if (behavior.afterDelete) behavior.afterDelete(state);
          const returned = behavior.deleteReturnedCount == null ? deleted : deleted.slice(0, behavior.deleteReturnedCount);
          return { data: query.selected ? clone(returned).map((row) => ({ id: row.id })) : null, error: null };
        }
        if (query.kind === "upsert") {
          if (behavior.errors?.[`${table}:upsert`]) return { data: null, error: behavior.errors[`${table}:upsert`] };
          if (query.options?.onConflict !== "id") throw new Error("only exact-id compensation is supported");
          const payload = Array.isArray(query.payload) ? query.payload : [query.payload];
          payload.forEach((row) => { state.lineItems = state.lineItems.filter((entry) => entry.id !== row.id); state.lineItems.push(clone(row)); });
          const returned = behavior.restoreReturnedCount == null ? payload : payload.slice(0, behavior.restoreReturnedCount);
          return { data: query.selected ? clone(returned) : null, error: null };
        }
        throw new Error(`unsupported operation ${query.kind}`);
      };
      return builder;
    }),
  };
  return { client, state, trace };
}

function request(mock, overrides = {}) {
  return repairStaleInvoiceLineItemDuplicates({ adminClient: mock.client, companyId: ids.company, deviceId: "device-safe", staleRowIds: [ids.stale1, ids.stale2], accessToken: "test-access-token", ...overrides });
}
function mutationTrace(mock) { return mock.trace.filter((entry) => ["insert", "delete", "upsert"].includes(entry.operation)); }

describe("server stale invoice line item repair", () => {
  test.each([
    [{ companyId: "" }, {}], [{ deviceId: "" }, {}], [{ staleRowIds: [] }, {}],
    [{ staleRowIds: [ids.stale1, ids.stale1] }, {}], [{ staleRowIds: ["not-a-uuid"] }, {}],
    [{ staleRowIds: Array.from({ length: 101 }, (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`) }, {}],
  ])("invalid requests fail before mutation", async (overrides) => {
    const mock = serviceRoleMock(fixture());
    const result = await request(mock, overrides);
    expect(result.ok).toBe(false); expect(mutationTrace(mock)).toEqual([]);
  });

  test("missing server configuration performs no mutation", async () => {
    const result = await repairStaleInvoiceLineItemDuplicates({ companyId: ids.company, deviceId: "device-safe", staleRowIds: [ids.stale1], accessToken: "token", env: {} });
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid repair request." });
  });

  test.each([
    ["missing token", { accessToken: "" }, 400], ["invalid auth", {}, 401, (data) => { data.auth = { user: null, error: { message: "bad" } }; }],
    ["missing membership", {}, 403, (data) => { data.memberships = []; }], ["inactive membership", {}, 403, (data) => { data.memberships[0].status = "inactive"; }],
    ["member role", {}, 403, (data) => { data.memberships[0].role = "member"; }], ["missing device lock", {}, 403, (data) => { data.locks = []; }],
    ["wrong device", {}, 403, (data) => { data.locks[0].setting_value.activeDeviceId = "other"; }], ["revoked device", {}, 403, (data) => { data.locks[0].setting_value.activeDeviceRevokedAt = "2026-01-02"; }],
  ])("%s denies before mutation", async (...params) => {
    const [_name, overrides, status, mutate] = params;
    const data = fixture(); if (typeof mutate === "function") mutate(data); const mock = serviceRoleMock(data);
    const result = await request(mock, overrides); expect(result.status).toBe(status); expect(mutationTrace(mock)).toEqual([]);
  });

  test.each([
    ["missing stale row", (data) => { data.lineItems = data.lineItems.filter((row) => row.id !== ids.stale2); }],
    ["missing parent", (data) => { data.invoices = []; }],
    ["bad stale key", (data) => { data.lineItems.find((row) => row.id === ids.stale1).legacy_local_id = "bad"; }],
    ["current child", (data) => { data.lineItems.find((row) => row.id === ids.stale1).legacy_local_id = "invoice:local-current:line:0"; }],
    ["missing canonical", (data) => { data.lineItems = data.lineItems.filter((row) => row.id !== ids.canonical1); }],
    ["price mismatch", (data) => { data.lineItems.find((row) => row.id === ids.stale1).unit_price = "11"; }],
    ["metadata mismatch", (data) => { data.lineItems.find((row) => row.id === ids.stale1).metadata = { changed: true }; }],
  ])("proof refusal: %s performs no mutation", async (_name, mutate) => {
    const data = fixture(); mutate(data); const mock = serviceRoleMock(data); const result = await request(mock);
    expect(result.status).toBe(409); expect(mutationTrace(mock)).toEqual([]);
  });

  test("numeric strings and reordered metadata are equivalent", async () => {
    const data = fixture(); const stale = data.lineItems.find((row) => row.id === ids.stale1); stale.quantity = 2; stale.metadata = { sortOrder: 0, source: "fixture" };
    const mock = serviceRoleMock(data); const result = await request(mock);
    expect(result).toEqual({ ok: true, status: 200, repaired: 2, repairVersion: REPAIR_VERSION });
  });

  test("archives complete snapshots before exact company-scoped deletion", async () => {
    const mock = serviceRoleMock(fixture()); const result = await request(mock);
    expect(result.ok).toBe(true);
    const archive = mock.trace.find((entry) => entry.table === "audit_events" && entry.operation === "insert");
    const deletion = mock.trace.find((entry) => entry.table === "invoice_line_items" && entry.operation === "delete");
    expect(mock.trace.indexOf(archive)).toBeLessThan(mock.trace.indexOf(deletion));
    expect(archive.payload).toHaveLength(2); expect(archive.payload[0].payload.stale).toMatchObject({ id: ids.stale1, metadata: { source: "fixture" } });
    expect(deletion.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "company_id", value: ids.company }, { kind: "in", column: "id", values: [ids.stale1, ids.stale2] }]));
    expect(mock.state.lineItems.map((row) => row.id)).toEqual(expect.arrayContaining([ids.canonical1, ids.canonical2]));
  });

  test.each([
    ["archive error", { errors: { "audit_events:insert": { message: "no" } } }],
    ["archive count mismatch", { auditReturnedCount: 1 }], ["delete error", { errors: { "invoice_line_items:delete": { message: "no" } } }],
    ["delete returned mismatch", { deleteReturnedCount: 1 }],
  ])("%s never reports success", async (_name, behavior) => {
    const mock = serviceRoleMock(fixture(), behavior); const result = await request(mock);
    expect(result.ok).toBe(false); expect(result).not.toHaveProperty("data");
    if (_name.startsWith("archive")) expect(mock.trace.some((entry) => entry.operation === "delete")).toBe(false);
  });

  test.each([
    ["stale survives", (state) => { state.lineItems.push(line(ids.stale1, "invoice:local-previous:line:0", 0)); }],
    ["canonical disappears", (state) => { state.lineItems = state.lineItems.filter((row) => row.id !== ids.canonical1); }],
    ["canonical changes", (state) => { state.lineItems.find((row) => row.id === ids.canonical1).quantity = "99"; }],
    ["parent disappears", (state) => { state.invoices = []; }],
    ["parent changes", (state) => { state.invoices[0].status = "paid"; }],
    ["payment disappears", (state) => { state.payments.pop(); }],
    ["payment identity changes", (state) => { state.payments[1].id = "10000000-0000-4000-8000-000000000099"; }],
  ])("post-delete verification failure: %s compensates complete stale rows", async (_name, afterDelete) => {
    const original = fixture(); const mock = serviceRoleMock(original, { afterDelete }); const result = await request(mock);
    expect(result.ok).toBe(false); expect(result.error).not.toMatch(/Work|20\.00|token/i);
    const restore = mock.trace.find((entry) => entry.operation === "upsert");
    expect(restore.payload).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.stale1, created_at: "2026-01-01T00:00:00.000Z", metadata: { source: "fixture", sortOrder: 0 } })]));
    expect(mock.state.lineItems.map((row) => row.id)).toEqual(expect.arrayContaining([ids.stale1, ids.stale2]));
    expect(mock.trace.some((entry) => entry.table === "audit_events" && entry.operation === "insert" && entry.payload?.[0]?.event_type?.includes("compensated"))).toBe(true);
  });

  test.each([
    ["restore error", { afterDelete: () => {}, errors: { "invoice_line_items:upsert": { message: "no" } } }],
    ["partial restore", { afterDelete: () => {}, restoreReturnedCount: 1 }],
  ])("compensation failure is a generic critical failure", async (_name, behavior) => {
    behavior.afterDelete = (state) => { state.lineItems = state.lineItems.filter((row) => row.id !== ids.canonical1); };
    const mock = serviceRoleMock(fixture(), behavior); const result = await request(mock);
    expect(result).toEqual({ ok: false, status: 500, error: "Critical repair failure." });
  });

  test("never mutates invoices or payments and never performs parent-wide deletion", async () => {
    const mock = serviceRoleMock(fixture()); await request(mock);
    expect(mock.trace.filter((entry) => ["invoices", "invoice_payments"].includes(entry.table) && ["delete", "upsert"].includes(entry.operation))).toEqual([]);
    const deletion = mock.trace.find((entry) => entry.operation === "delete");
    expect(deletion.filters.some((filter) => filter.column === "invoice_id")).toBe(false);
  });
});
