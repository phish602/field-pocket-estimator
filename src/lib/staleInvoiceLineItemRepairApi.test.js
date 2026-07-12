const { createExpressStaleInvoiceLineItemRepairHandler } = require("../../server/staleInvoiceLineItemRepair");
const deployedHandler = require("../../api/cloud/repair-stale-invoice-line-items");

function responseMock() {
  const response = { statusCode: null, body: null, sends: 0 };
  response.status = jest.fn((status) => { response.statusCode = status; return response; });
  response.json = jest.fn((body) => { response.sends += 1; response.body = body; return response; });
  return response;
}
function invoke(operation, request = {}) {
  const handler = createExpressStaleInvoiceLineItemRepairHandler({ repairOperation: operation });
  const response = responseMock();
  return handler({ method: "POST", headers: { authorization: "Bearer browser-token" }, body: { companyId: "company", deviceId: "device", staleRowIds: ["row"] }, ...request }, response).then(() => response);
}

describe("stale invoice line item repair API", () => {
  test("the deployed API exports a request handler", () => expect(typeof deployedHandler).toBe("function"));

  test.each(["GET", "PUT", "PATCH", "DELETE"])("%s is rejected without invoking repair", async (method) => {
    const operation = jest.fn(); const response = await invoke(operation, { method });
    expect(operation).not.toHaveBeenCalled(); expect(response.statusCode).toBe(405); expect(response.body).toEqual({ code: "method_not_allowed", message: "Method not allowed." });
  });

  test("POST calls the repair operation with only approved inputs", async () => {
    const operation = jest.fn(async () => ({ ok: true, repaired: 2, repairVersion: "server-stale-invoice-line-item-repair-v1" }));
    const response = await invoke(operation, { body: { companyId: "company", deviceId: "device", staleRowIds: ["row"], destructiveOverride: true, table: "invoices" } });
    expect(response.statusCode).toBe(200);
    expect(operation).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company", deviceId: "device", staleRowIds: ["row"], accessToken: "browser-token" }));
    expect(Object.keys(operation.mock.calls[0][0]).sort()).toEqual(["accessToken", "adminClient", "companyId", "deviceId", "env", "staleRowIds"]);
  });

  test.each([
    [400, "invalid_request"], [401, "unauthorized"], [403, "forbidden"], [409, "repair_refused"], [500, "repair_unavailable"],
  ])("safe failure status %i has a count-safe body", async (status, code) => {
    const response = await invoke(async () => ({ ok: false, status, error: "safe message" }));
    expect(response.statusCode).toBe(status); expect(response.body).toEqual({ code, message: "safe message" });
    expect(Object.keys(response.body).sort()).toEqual(["code", "message"]);
  });

  test("missing bearer token reaches the established safe contract", async () => {
    const operation = jest.fn(async (input) => input.accessToken ? { ok: true, repaired: 1, repairVersion: "server-stale-invoice-line-item-repair-v1" } : { ok: false, status: 401, error: "Unauthorized." });
    const response = await invoke(operation, { headers: {} });
    expect(response.statusCode).toBe(401); expect(response.body).toEqual({ code: "unauthorized", message: "Unauthorized." });
  });

  test("successful repair returns exactly the public count-safe contract", async () => {
    const response = await invoke(async () => ({ ok: true, repaired: 6, repairVersion: "server-stale-invoice-line-item-repair-v1", rows: [{ secret: true }] }));
    expect(response.statusCode).toBe(200); expect(response.body).toEqual({ ok: true, repaired: 6, repairVersion: "server-stale-invoice-line-item-repair-v1" });
    expect(Object.keys(response.body).sort()).toEqual(["ok", "repairVersion", "repaired"]);
  });

  test("handler sends exactly one response", async () => {
    const response = await invoke(async () => ({ ok: false, status: 500, error: "Repair unavailable." }));
    expect(response.sends).toBe(1); expect(response.status).toHaveBeenCalledTimes(1); expect(response.json).toHaveBeenCalledTimes(1);
  });

  test("an unexpected operation failure maps safely to 500", async () => {
    const response = await invoke(async () => { throw new Error("database details must not escape"); });
    expect(response.statusCode).toBe(500); expect(response.body).toEqual({ code: "repair_unavailable", message: "Repair unavailable." });
  });

  test("API response never reflects secrets, UUIDs, or business data", async () => {
    const response = await invoke(async () => ({ ok: false, status: 500, error: "Repair unavailable.", data: { bearer: "browser-token", invoice: "private", price: 100 } }));
    expect(JSON.stringify(response.body)).not.toMatch(/browser-token|private|price|invoice/i);
  });
});
