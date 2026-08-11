const { repairProvenStaleInvoiceLineItemDuplicates } = require("./staleInvoiceLineItemRepairClient");

const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const version = "server-stale-invoice-line-item-repair-v1";
function authClient(session = { data: { session: { access_token: "browser-access-token" } } }) {
  return { auth: { getSession: jest.fn(async () => session) }, from: jest.fn(() => { throw new Error("direct database access is forbidden"); }) };
}
function successResponse(body = { ok: true, repaired: 2, repairVersion: version }) { return { ok: true, json: jest.fn(async () => body) }; }
function call(overrides = {}) {
  const client = overrides.client === undefined ? authClient() : overrides.client;
  const fetchImpl = overrides.fetchImpl || jest.fn(async () => successResponse());
  return { client, fetchImpl, result: repairProvenStaleInvoiceLineItemDuplicates({ client, companyId: "company", deviceId: "device", staleRowIds: [first, second], fetchImpl, ...overrides }) };
}

describe("stale invoice line item repair browser client", () => {
  test.each([
    ["no client", { client: null }], ["no getSession", { client: { auth: {} } }], ["no company", { companyId: "" }],
    ["no device", { deviceId: "" }], ["empty ids", { staleRowIds: [] }], ["bad UUID", { staleRowIds: ["bad"] }],
    ["more than 100 unique ids", { staleRowIds: Array.from({ length: 101 }, (_, index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`) }],
  ])("%s fails closed before requesting", async (_name, overrides) => {
    const fetchImpl = jest.fn(); const result = await repairProvenStaleInvoiceLineItemDuplicates({ fetchImpl, ...overrides });
    expect(result).toEqual({ ok: false, error: "Repair unavailable." }); expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("deduplicates valid UUIDs and makes the one approved POST", async () => {
    const client = authClient(); const fetchImpl = jest.fn(async () => successResponse({ ok: true, repaired: 1, repairVersion: version }));
    const result = await repairProvenStaleInvoiceLineItemDuplicates({ client, companyId: "company", deviceId: "device", staleRowIds: [first, first], fetchImpl });
    expect(result).toEqual({ ok: true, repaired: 1, repairVersion: version }); expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/cloud/repair-stale-invoice-line-items", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer browser-access-token", "Content-Type": "application/json" } }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ companyId: "company", deviceId: "device", staleRowIds: [first] });
  });

  test.each([
    ["missing session", { data: { session: null } }], ["missing token", { data: { session: {} } }],
  ])("%s fails closed", async (_name, session) => {
    const client = authClient(session); const fetchImpl = jest.fn(); const result = await repairProvenStaleInvoiceLineItemDuplicates({ client, companyId: "company", deviceId: "device", staleRowIds: [first], fetchImpl });
    expect(result.ok).toBe(false); expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ["ok is false", { ok: false, repaired: 1, repairVersion: version }], ["fractional count", { ok: true, repaired: 1.5, repairVersion: version }],
    ["negative count", { ok: true, repaired: -1, repairVersion: version }], ["wrong version", { ok: true, repaired: 1, repairVersion: "other" }],
    ["extra field", { ok: true, repaired: 1, repairVersion: version, rows: [] }],
  ])("malformed success response (%s) fails closed", async (_name, body) => {
    const { result } = call({ fetchImpl: jest.fn(async () => successResponse(body)) }); expect((await result).ok).toBe(false);
  });

  test.each([
    ["non JSON", async () => ({ ok: false, status: 500, json: async () => { throw new Error("not JSON"); } }), "repair_unavailable"],
    ["network failure", async () => { throw new Error("network"); }, "repair_unreachable"], ["400", async () => ({ ok: false, status: 400, json: async () => ({ code: "invalid_request" }) }), "invalid_request"],
    ["401", async () => ({ ok: false, status: 401, json: async () => ({ code: "unauthorized" }) }), "unauthorized"], ["403", async () => ({ ok: false, status: 403, json: async () => ({ code: "forbidden" }) }), "forbidden"],
    ["409", async () => ({ ok: false, status: 409, json: async () => ({ code: "repair_refused" }) }), "repair_refused"], ["500", async () => ({ ok: false, status: 500, json: async () => ({ code: "repair_unavailable" }) }), "repair_unavailable"],
  ])("%s response is normalized safely", async (_name, resolveResponse, failureCode) => {
    const fetchImpl = jest.fn(resolveResponse);
    const { result } = call({ fetchImpl }); expect(await result).toEqual({ ok: false, error: "Repair unavailable.", failureCode });
  });

  test("does not expose tokens, log, mutate directly, or retry", async () => {
    const client = authClient(); const fetchImpl = jest.fn(async () => { throw new Error("fail"); }); const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await repairProvenStaleInvoiceLineItemDuplicates({ client, companyId: "company", deviceId: "device", staleRowIds: [first], fetchImpl });
    expect(result).toEqual({ ok: false, error: "Repair unavailable.", failureCode: "repair_unreachable" }); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(client.from).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
