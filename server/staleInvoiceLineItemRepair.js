const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPAIR_VERSION = "server-stale-invoice-line-item-repair-v1";
const LINE_ITEM_COLUMNS = "id,company_id,invoice_id,legacy_local_id,sort_order,description,quantity,unit,unit_price,total_price,metadata,created_at,updated_at";
const INVOICE_COLUMNS = "id,company_id,customer_id,project_id,estimate_id,source_estimate_legacy_id,legacy_local_id,invoice_number,estimate_number,status,payment_status,invoice_date,due_date,total_amount,amount_paid,balance_remaining,notes,terms,created_by,updated_by,created_at,updated_at,archived_at,archived_by,deleted_at,deleted_by";

const text = (value) => String(value || "").trim();
const accessTokenFromAuthorization = (value) => (/^Bearer\s+(.+)$/i.exec(text(value)) || [])[1] || "";

// EXACT canonical values only -- never substring or hostname matching, so
// "http://localhost.attacker.example:54321" can never be accepted.
const APPROVED_LOCAL_SUPABASE_URLS = Object.freeze([
  "http://127.0.0.1:54321",
  "http://127.0.0.1:54321/",
  "http://localhost:54321",
  "http://localhost:54321/",
]);

function isApprovedLocalSupabaseUrl(value) {
  return APPROVED_LOCAL_SUPABASE_URLS.includes(text(value));
}

// Returns { ok: true, client } or { ok: false, code }. The codes are fixed
// non-sensitive tokens; no URL, key or token is ever carried out of here.
//
// requireLocalSupabase is opt-in and used ONLY by the local dev bridge. The
// deployed production API route keeps its normal configuration and may continue
// to use hosted Supabase.
function resolveServiceClient({ env = process.env, adminClient, requireLocalSupabase = false } = {}) {
  if (adminClient) return { ok: true, client: adminClient };
  const url = text(env.SUPABASE_URL);
  const key = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return { ok: false, code: "runtime_not_configured" };
  if (requireLocalSupabase && !isApprovedLocalSupabaseUrl(url)) return { ok: false, code: "local_supabase_required" };
  return {
    ok: true,
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

function parseDeterministicLineId(value) {
  const match = /^invoice:([^:]+):line:(\d+)$/.exec(text(value));
  return match ? { parent: match[1], index: Number(match[2]) } : null;
}

function normalize(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") return Object.keys(value).sort().reduce((result, key) => {
    result[key] = normalize(value[key]);
    return result;
  }, {});
  return value;
}

function semanticallySameLineItem(left, right) {
  const fields = ["company_id", "invoice_id", "sort_order", "description", "quantity", "unit", "unit_price", "total_price", "metadata"];
  return JSON.stringify(fields.map((field) => normalize(left?.[field]))) === JSON.stringify(fields.map((field) => normalize(right?.[field])));
}

function semanticallySameRow(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

// Mirrors the shared client contract's parent-segment sanitizer. Reimplemented
// here on purpose: the server must be able to prove a deletion without trusting
// or importing anything the browser controls.
function sanitizeParentSegment(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "parent";
}

const BUSINESS_FIELDS = ["description", "quantity", "unit", "unit_price", "total_price"];
// "invoice" is the historical generic section tag from an older writer, proven
// structural in the same way labor/material are. Independently re-listed here --
// the server never imports the browser's contract -- and it grants NO leniency:
// the emptiness and identity proofs below still have to pass on their own.
const PLACEHOLDER_KINDS = ["labor", "material", "invoice"];

// Explicit zero is DATA. Only null / undefined / "" are absent, so a $0 line, a
// 0-quantity line or a 0-hour line is never treated as an empty placeholder.
const isAbsent = (value) => value === null || value === undefined || value === "";

function hasOnlyStructuralMetadata(metadata) {
  if (metadata === null || metadata === undefined) return true;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const keys = Object.keys(metadata);
  if (keys.length === 0) return true;
  // Exactly the structural kind and nothing else. Any unknown key -- and any
  // economic key such as hours / unit_cost / markup, even valued 0 -- fails.
  if (keys.length !== 1 || keys[0] !== "kind") return false;
  return PLACEHOLDER_KINDS.includes(text(metadata.kind));
}

function isEmptyPlaceholderRow(row) {
  if (!row || typeof row !== "object") return false;
  if (!BUSINESS_FIELDS.every((field) => isAbsent(row[field]))) return false;
  return hasOnlyStructuralMetadata(row.metadata);
}

// `reason` is an optional fixed, non-sensitive diagnostic token (never a URL,
// key, token or business value) so the caller can tell a runtime/configuration
// problem apart from a safety refusal.
function safeFailure(status, error, reason) {
  return reason ? { ok: false, status, error, reason } : { ok: false, status, error };
}

async function repairStaleInvoiceLineItemDuplicates({ companyId, deviceId, staleRowIds, accessToken, env, adminClient, requireLocalSupabase = false } = {}) {
  const ids = Array.isArray(staleRowIds) ? staleRowIds.map(text) : [];
  // A MALFORMED REQUEST and an UNCONFIGURED SERVER are different failures.
  // Collapsing both into 400 is exactly why a green test suite told us nothing
  // about the real runtime: a server with no admin credentials looked like a bad
  // request from the caller.
  if (!text(companyId) || !text(deviceId) || !text(accessToken)
    || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => !UUID.test(id))) {
    return safeFailure(400, "Invalid repair request.");
  }
  const resolved = resolveServiceClient({ env, adminClient, requireLocalSupabase });
  if (!resolved.ok) return safeFailure(503, "Repair unavailable.", resolved.code);
  const client = resolved.client;

  try {
    const userResult = await client.auth.getUser(accessToken);
    const actorId = text(userResult?.data?.user?.id);
    if (userResult?.error || !actorId) return safeFailure(401, "Unauthorized.");

    const membership = await client.from("company_users")
      .select("company_id,user_id,role,status,archived_at,deleted_at")
      .eq("company_id", companyId).eq("user_id", actorId);
    const eligibleMemberships = (membership.data || []).filter((row) => row.status === "active"
      && !row.archived_at && !row.deleted_at && ["owner", "admin"].includes(text(row.role).toLowerCase()));
    if (membership.error || eligibleMemberships.length !== 1) return safeFailure(403, "Forbidden.");

    const lockResult = await client.from("app_settings").select("setting_value")
      .eq("company_id", companyId).eq("setting_scope", "company").eq("setting_key", "active_device_lock");
    const locks = lockResult.data || [];
    const activeLock = locks[0]?.setting_value;
    if (lockResult.error || locks.length !== 1 || activeLock?.activeDeviceId !== deviceId
      || activeLock?.activeUserId !== actorId || activeLock?.activeDeviceRevokedAt) {
      return safeFailure(403, "Forbidden.");
    }

    const staleResult = await client.from("invoice_line_items").select(LINE_ITEM_COLUMNS)
      .eq("company_id", companyId).in("id", ids);
    const staleRows = staleResult.data || [];
    if (staleResult.error || staleRows.length !== ids.length) return safeFailure(409, "Repair refused.");

    const invoiceIds = [...new Set(staleRows.map((row) => row.invoice_id))];
    const invoiceResult = await client.from("invoices").select(INVOICE_COLUMNS)
      .eq("company_id", companyId).in("id", invoiceIds);
    const invoices = invoiceResult.data || [];
    if (invoiceResult.error || invoices.length !== invoiceIds.length) return safeFailure(409, "Repair refused.");
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));

    const allChildrenResult = await client.from("invoice_line_items").select(LINE_ITEM_COLUMNS)
      .eq("company_id", companyId).in("invoice_id", invoiceIds);
    const allChildren = allChildrenResult.data || [];
    if (allChildrenResult.error) return safeFailure(500, "Repair unavailable.");

    const paymentResult = await client.from("invoice_payments").select("id,invoice_id")
      .eq("company_id", companyId).in("invoice_id", invoiceIds);
    if (paymentResult.error) return safeFailure(500, "Repair unavailable.");
    const paymentIdsBefore = (paymentResult.data || []).map((row) => row.id).sort();
    const canonicalBefore = allChildren.filter((row) => !ids.includes(row.id));

    // PROOF CLASS A (unchanged): wrong-parent deterministic duplicate whose exact
    // canonical twin still exists at the same stable index under the real parent.
    const provesExactTwin = (staleRow) => {
      const staleKey = parseDeterministicLineId(staleRow.legacy_local_id);
      const invoice = invoiceById.get(staleRow.invoice_id);
      if (!staleKey || !invoice?.legacy_local_id || staleKey.parent === invoice.legacy_local_id) return false;
      const twins = allChildren.filter((candidate) => {
        const candidateKey = parseDeterministicLineId(candidate.legacy_local_id);
        return candidate.id !== staleRow.id && candidate.invoice_id === staleRow.invoice_id
          && candidateKey?.parent === invoice.legacy_local_id && candidateKey.index === staleKey.index;
      });
      return twins.length === 1 && semanticallySameLineItem(staleRow, twins[0]);
    };

    // PROOF CLASS B (new): same-parent obsolete blank placeholder. Independently
    // proven here from the row itself -- the server never needs the browser's
    // canonical payload, because a row with NO business content can never be a
    // canonical child under the corrected writer contract.
    const provesEmptyPlaceholder = (staleRow) => {
      const staleKey = parseDeterministicLineId(staleRow.legacy_local_id);
      const invoice = invoiceById.get(staleRow.invoice_id);
      if (!staleKey || !invoice || !text(invoice.legacy_local_id)) return false;
      if (text(invoice.company_id) !== text(companyId) || invoice.id !== staleRow.invoice_id) return false;
      if (staleKey.parent !== sanitizeParentSegment(invoice.legacy_local_id)) return false;
      return isEmptyPlaceholderRow(staleRow);
    };

    // Every requested row must independently satisfy ONE of the two proofs. A
    // single unprovable row refuses the whole batch -- the batch is never
    // silently narrowed or broadened.
    const proofTypeByRowId = new Map();
    const allRowsProven = staleRows.every((staleRow) => {
      if (provesExactTwin(staleRow)) { proofTypeByRowId.set(staleRow.id, "duplicate_exact_twin"); return true; }
      if (provesEmptyPlaceholder(staleRow)) { proofTypeByRowId.set(staleRow.id, "empty_placeholder"); return true; }
      return false;
    });
    if (!allRowsProven) return safeFailure(409, "Repair refused.");

    const repairId = randomUUID();
    const archiveRows = staleRows.map((staleRow) => ({
      company_id: companyId,
      actor_id: actorId,
      legacy_local_id: staleRow.legacy_local_id,
      event_type: "cloud_repair.stale_invoice_line_item_duplicate_quarantined",
      entity_type: "invoice_line_item",
      entity_id: staleRow.id,
      // proofType keeps the audit trail honest: a blank placeholder is archived
      // as a placeholder, never mislabelled as a duplicate.
      payload: { version: 1, repairId, deviceId, proofType: proofTypeByRowId.get(staleRow.id), stale: staleRow },
    }));
    const archiveResult = await client.from("audit_events").insert(archiveRows).select("id");
    if (archiveResult.error || (archiveResult.data && archiveResult.data.length !== staleRows.length)) {
      return safeFailure(500, "Repair unavailable.");
    }

    const deleteResult = await client.from("invoice_line_items").delete().eq("company_id", companyId).in("id", ids).select("id");
    const deletedIds = (deleteResult.data || []).map((row) => row.id).sort();
    if (deleteResult.error || deletedIds.length !== ids.length || JSON.stringify(deletedIds) !== JSON.stringify([...ids].sort())) {
      return safeFailure(500, "Repair unavailable.");
    }

    const postChildren = await client.from("invoice_line_items").select(LINE_ITEM_COLUMNS)
      .eq("company_id", companyId).in("invoice_id", invoiceIds);
    const postInvoices = await client.from("invoices").select(INVOICE_COLUMNS)
      .eq("company_id", companyId).in("id", invoiceIds);
    const postPayments = await client.from("invoice_payments").select("id,invoice_id")
      .eq("company_id", companyId).in("invoice_id", invoiceIds);
    const postChildRows = postChildren.data || [];
    const postInvoiceRows = postInvoices.data || [];
    const paymentIdsAfter = (postPayments.data || []).map((row) => row.id).sort();
    const verified = !postChildren.error && !postInvoices.error && !postPayments.error
      && !postChildRows.some((row) => ids.includes(row.id))
      && canonicalBefore.every((before) => postChildRows.some((after) => after.id === before.id && semanticallySameLineItem(before, after)))
      && invoices.every((before) => postInvoiceRows.some((after) => after.id === before.id && semanticallySameRow(before, after)))
      && JSON.stringify(paymentIdsBefore) === JSON.stringify(paymentIdsAfter);
    if (verified) return { ok: true, status: 200, repaired: ids.length, repairVersion: REPAIR_VERSION };

    const restoreResult = await client.from("invoice_line_items").upsert(staleRows, { onConflict: "id" }).select(LINE_ITEM_COLUMNS);
    const restored = restoreResult.data || [];
    const restoredExactly = !restoreResult.error && restored.length === staleRows.length
      && staleRows.every((before) => restored.some((after) => after.id === before.id && semanticallySameRow(before, after)));
    if (!restoredExactly) return safeFailure(500, "Critical repair failure.");
    const restoreRead = await client.from("invoice_line_items").select(LINE_ITEM_COLUMNS)
      .eq("company_id", companyId).in("id", ids);
    const restoredReadExactly = !restoreRead.error && (restoreRead.data || []).length === staleRows.length
      && staleRows.every((before) => (restoreRead.data || []).some((after) => after.id === before.id && semanticallySameRow(before, after)));
    if (!restoredReadExactly) return safeFailure(500, "Critical repair failure.");
    await client.from("audit_events").insert([{
      company_id: companyId, actor_id: actorId, event_type: "cloud_repair.stale_invoice_line_item_duplicate_compensated",
      entity_type: "invoice_line_item", entity_id: staleRows[0].id,
      payload: { version: 1, repairId, restoredCount: staleRows.length },
    }]).select("id");
    return safeFailure(500, "Repair unavailable.");
  } catch {
    return safeFailure(500, "Repair unavailable.");
  }
}

function createExpressStaleInvoiceLineItemRepairHandler(options = {}) {
  const operation = options.repairOperation || repairStaleInvoiceLineItemDuplicates;
  return async (req, res) => {
    if (req.method && req.method !== "POST") return res.status(405).json({ code: "method_not_allowed", message: "Method not allowed." });
    let result;
    try {
      result = await operation({
        companyId: req.body?.companyId,
        deviceId: req.body?.deviceId,
        staleRowIds: req.body?.staleRowIds,
        accessToken: accessTokenFromAuthorization(req.headers?.authorization),
        env: options.env,
        adminClient: options.adminClient,
        requireLocalSupabase: options.requireLocalSupabase === true,
      });
    } catch {
      return res.status(500).json({ code: "repair_unavailable", message: "Repair unavailable." });
    }
    if (result.ok) return res.status(200).json({ ok: true, repaired: result.repaired, repairVersion: result.repairVersion });
    const status = Number.isInteger(result.status) ? result.status : 500;
    const code = status === 400 ? "invalid_request"
      : status === 401 ? "unauthorized"
        : status === 403 ? "forbidden"
          : status === 409 ? "repair_refused"
            : "repair_unavailable";
    return res.status(status).json({ code, message: result.error || "Repair unavailable." });
  };
}

module.exports = {
  REPAIR_VERSION,
  APPROVED_LOCAL_SUPABASE_URLS,
  isApprovedLocalSupabaseUrl,
  resolveServiceClient,
  repairStaleInvoiceLineItemDuplicates,
  createExpressStaleInvoiceLineItemRepairHandler,
  accessTokenFromAuthorization,
  parseDeterministicLineId,
  semanticallySameLineItem,
  semanticallySameRow,
};
