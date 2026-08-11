function text(value) { return String(value || "").trim(); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPAIR_VERSION = "server-stale-invoice-line-item-repair-v1";

// Fixed, non-sensitive server failure codes only. Anything unrecognized collapses
// to a generic token so no server-supplied string can ever leak through.
const SAFE_SERVER_FAILURE_CODES = ["invalid_request", "unauthorized", "forbidden", "repair_refused", "repair_unavailable"];

function safeFailureCode(response, body) {
  const code = text(body?.code);
  if (SAFE_SERVER_FAILURE_CODES.includes(code)) return code;
  return Number(response?.status) === 200 ? "repair_response_invalid" : "repair_unavailable";
}

export async function repairProvenStaleInvoiceLineItemDuplicates({ client, companyId, deviceId, staleRowIds, fetchImpl = fetch } = {}) {
  const ids = [...new Set((Array.isArray(staleRowIds) ? staleRowIds : []).map(text))];
  if (!text(companyId) || !text(deviceId) || ids.length < 1 || ids.length > 100 || ids.some((id) => !UUID.test(id)) || !client?.auth?.getSession || typeof fetchImpl !== "function") return { ok: false, error: "Repair unavailable." };
  try {
    const session = await client.auth.getSession();
    const token = text(session?.data?.session?.access_token);
    if (!token) return { ok: false, error: "Repair unavailable." };
    const response = await fetchImpl("/api/cloud/repair-stale-invoice-line-items", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: text(companyId), deviceId: text(deviceId), staleRowIds: ids }) });
    const body = await response.json().catch(() => null);
    const expectedFields = ["ok", "repaired", "repairVersion"];
    if (!response.ok || !body || typeof body !== "object" || Object.keys(body).length !== expectedFields.length
      || !expectedFields.every((field) => Object.prototype.hasOwnProperty.call(body, field))
      || body.ok !== true || !Number.isInteger(body.repaired) || body.repaired < 0 || body.repairVersion !== REPAIR_VERSION) {
      // Keep the user-facing message unchanged, but preserve the server's safe
      // failure code so the writer can tell "the repair runtime is not available"
      // apart from "the safety proof refused these rows". Only fixed server codes
      // are echoed -- never a message, URL, key or business value.
      return { ok: false, error: "Repair unavailable.", failureCode: safeFailureCode(response, body) };
    }
    return { ok: true, repaired: body.repaired, repairVersion: REPAIR_VERSION };
  } catch { return { ok: false, error: "Repair unavailable.", failureCode: "repair_unreachable" }; }
}
