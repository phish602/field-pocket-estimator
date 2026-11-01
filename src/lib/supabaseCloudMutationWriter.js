// @ts-nocheck
/* eslint-disable */

import { getSupabaseClient } from "./supabaseClient";
import {
  buildStaleOperationResult,
  ensureCurrentDeviceCanWriteCloud,
  operationFenceStillCurrent,
} from "./supabaseDeviceLock";
import {
  buildTargetCustomerPersistencePayload,
  buildTargetEstimatePersistencePayloads,
  buildTargetInvoicePersistencePayloads,
  buildTargetProjectPersistencePayload,
} from "./supabaseMigrationWriter";
import {
  comparePersistedCloudSemanticContract,
  samePersistedEstimateLineItemContract,
  samePersistedInvoiceLineItemContract,
} from "./supabaseCloudVerification";
import { CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION } from "./cloudMutationLedger";
import {
  APP_RESTORE_BUNDLE_STATUS,
  readSupabaseAppRestoreBundle,
  updateSupabaseAppRestoreBundle,
  validateSupabaseAppRestoreBundle,
} from "./supabaseAppRestoreBundle";
import { cloudSyncEqual } from "./cloudSyncBaseline";

const asText = (value) => String(value || "").trim();

function failed(code, error, extra = {}) {
  return { ok: false, verified: false, code, error: asText(error) || code, ...extra };
}

async function findParent(client, table, companyId, legacyLocalId) {
  const legacyId = asText(legacyLocalId);
  if (!legacyId) return { ok: true, id: null };
  const response = await client
    .from(table)
    .select("id, legacy_local_id")
    .eq("company_id", companyId)
    .eq("legacy_local_id", legacyId)
    .maybeSingle();
  if (response?.error) return failed(`${table}_lookup_failed`, response.error?.message);
  if (!response?.data?.id) return failed(`${table}_parent_missing`, `Referenced ${table} row was not found.`);
  return { ok: true, id: asText(response.data.id) };
}

async function upsertRows(client, table, rows, columns = "id, legacy_local_id") {
  if (!Array.isArray(rows) || rows.length === 0) return { data: [], error: null };
  return client.from(table).upsert(rows, { onConflict: "company_id,legacy_local_id" }).select(columns);
}

function exactExpectedRows(expectedRows, cloudRows, comparator) {
  const cloudByLegacyId = new Map((Array.isArray(cloudRows) ? cloudRows : [])
    .map((row) => [asText(row?.legacy_local_id), row]));
  const failures = [];
  (Array.isArray(expectedRows) ? expectedRows : []).forEach((expected) => {
    const legacyId = asText(expected?.legacy_local_id);
    const cloud = cloudByLegacyId.get(legacyId);
    if (!cloud) {
      failures.push({ legacyLocalId: legacyId, missing: true });
      return;
    }
    const mismatch = comparator(expected, cloud);
    if (Array.isArray(mismatch) ? mismatch.length > 0 : !mismatch) {
      failures.push({ legacyLocalId: legacyId, mismatchedFields: Array.isArray(mismatch) ? mismatch : ["semantic_contract"] });
    }
  });
  return failures;
}

function exactTargetRows(expectedRows, cloudRows, comparator) {
  const failures = exactExpectedRows(expectedRows, cloudRows, comparator);
  const expectedIds = new Set((Array.isArray(expectedRows) ? expectedRows : []).map((row) => asText(row?.legacy_local_id)).filter(Boolean));
  const cloudCounts = new Map();
  (Array.isArray(cloudRows) ? cloudRows : []).forEach((row) => {
    const legacyId = asText(row?.legacy_local_id);
    cloudCounts.set(legacyId, Number(cloudCounts.get(legacyId) || 0) + 1);
    if (!expectedIds.has(legacyId)) failures.push({ legacyLocalId: legacyId, unexpected: true });
  });
  cloudCounts.forEach((count, legacyId) => {
    if (expectedIds.has(legacyId) && count !== 1) failures.push({ legacyLocalId: legacyId, duplicateCount: count });
  });
  return failures;
}

async function createMutationFence({ configured, user, company, storageSnapshot, reason }) {
  const start = await ensureCurrentDeviceCanWriteCloud({
    configured, user, company, storage: storageSnapshot, reason, claimIfMissing: false,
  });
  if (!start?.ok) return { ok: false, result: failed(start?.code || "device_not_active", start?.error, { deviceLockLost: Boolean(start?.deviceLockLost) }) };
  const startFence = start?.access?.fence || null;
  return {
    ok: true,
    async ensure() {
      const completion = await ensureCurrentDeviceCanWriteCloud({
        configured, user, company, storage: storageSnapshot, reason, claimIfMissing: false,
      });
      if (!completion?.ok) return completion;
      return operationFenceStillCurrent({ startFence, completionAccess: completion })
        ? completion
        : { ...buildStaleOperationResult(reason), deviceLockLost: true };
    },
  };
}

async function lookupExactTarget(client, table, companyId, documentId, columns = "id, legacy_local_id") {
  const response = await client.from(table)
    .select(columns)
    .eq("company_id", companyId)
    .eq("legacy_local_id", documentId)
    .maybeSingle();
  if (response?.error) return failed(`${table}_lookup_failed`, response.error?.message);
  return { ok: true, row: response?.data || null };
}

async function deleteExactRows({ client, table, companyId, filters = [], expectedIds = [], failureCode }) {
  if (!expectedIds.length) return { ok: true, deletedIds: [] };
  let query = client.from(table).delete().eq("company_id", companyId);
  filters.forEach(([column, value]) => { query = query.eq(column, value); });
  query = query.in("id", expectedIds).select("id");
  const response = await query;
  const returned = new Set((Array.isArray(response?.data) ? response.data : []).map((row) => asText(row?.id)).filter(Boolean));
  if (response?.error || expectedIds.some((id) => !returned.has(asText(id)))) {
    return failed(failureCode, response?.error?.message || `Exact ${table} deletion could not be verified.`);
  }
  return { ok: true, deletedIds: [...returned] };
}

async function runCustomerMutationWrite({ mutation, configured = false, user = null, company = null, storageSnapshot = localStorage } = {}) {
  const client = getSupabaseClient();
  const companyId = asText(company?.id); const userId = asText(user?.id);
  const customer = mutation?.payload; const documentId = asText(mutation?.documentId || customer?.id);
  if (!configured || !client?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (!customer || !documentId || asText(customer?.id) !== documentId) return failed("invalid_customer_mutation", "Customer mutation payload is invalid.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "Customer mutation belongs to a different workspace.");
  const fence = await createMutationFence({ configured, user, company, storageSnapshot, reason: "customer_mutation" });
  if (!fence.ok) return fence.result;
  try {
    const payloads = buildTargetCustomerPersistencePayload({ customer, companyId, userId });
    const current = await fence.ensure();
    if (!current?.ok) return failed(current?.code || "device_generation_changed", current?.error, { deviceLockLost: true });
    const write = await upsertRows(client, "customers", [payloads.customerPayload]);
    if (write?.error) return failed("customer_write_failed", write.error?.message);
    const read = await client.from("customers")
      .select("id, legacy_local_id, display_name, company_name, contact_name, phone, email, billing_address, customer_type, customer_status")
      .eq("company_id", companyId).eq("legacy_local_id", documentId).maybeSingle();
    if (read?.error || !read?.data) return failed("customer_verification_read_failed", read?.error?.message || "Target customer was not found after write.");
    const mismatch = comparePersistedCloudSemanticContract("customers", payloads.customerPayload, read.data);
    if (mismatch.length) return failed("target_verification_failed", "Target customer mutation did not match after cloud write.", { verification: { customerMismatch: mismatch } });
    const completion = await fence.ensure();
    if (!completion?.ok) return failed(completion?.code || "device_generation_changed", completion?.error, { deviceLockLost: true });
    return { ok: true, verified: true, verifiedAt: Date.now(), mutationId: asText(mutation?.mutationId), revision: Number(mutation?.revision || 0), documentId, cloudCustomerId: asText(read.data.id), written: { customers: 1 } };
  } catch (error) { return failed("customer_mutation_unexpected_error", error?.message || "Customer mutation failed."); }
}

async function runProjectMutationWrite({ mutation, configured = false, user = null, company = null, storageSnapshot = localStorage } = {}) {
  const client = getSupabaseClient();
  const companyId = asText(company?.id); const userId = asText(user?.id);
  const project = mutation?.payload; const documentId = asText(mutation?.documentId || project?.id);
  if (!configured || !client?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (!project || !documentId || asText(project?.id) !== documentId) return failed("invalid_project_mutation", "Project mutation payload is invalid.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "Project mutation belongs to a different workspace.");
  const fence = await createMutationFence({ configured, user, company, storageSnapshot, reason: "project_mutation" });
  if (!fence.ok) return fence.result;
  try {
    const mapped = buildTargetProjectPersistencePayload({ project, companyId, userId }).mappedProject;
    const parent = await findParent(client, "customers", companyId, mapped?.customer_legacy_local_id);
    if (!parent.ok) return parent;
    const payloads = buildTargetProjectPersistencePayload({ project, companyId, userId, customerId: parent.id });
    const current = await fence.ensure();
    if (!current?.ok) return failed(current?.code || "device_generation_changed", current?.error, { deviceLockLost: true });
    const write = await upsertRows(client, "projects", [payloads.projectPayload]);
    if (write?.error) return failed("project_write_failed", write.error?.message);
    const read = await client.from("projects")
      .select("id, legacy_local_id, customer_id, project_number, project_name, site_address, status, notes, scope_summary")
      .eq("company_id", companyId).eq("legacy_local_id", documentId).maybeSingle();
    if (read?.error || !read?.data) return failed("project_verification_read_failed", read?.error?.message || "Target project was not found after write.");
    const mismatch = comparePersistedCloudSemanticContract("projects", payloads.projectPayload, read.data);
    if (mismatch.length) return failed("target_verification_failed", "Target project mutation did not match after cloud write.", { verification: { projectMismatch: mismatch } });
    const completion = await fence.ensure();
    if (!completion?.ok) return failed(completion?.code || "device_generation_changed", completion?.error, { deviceLockLost: true });
    return { ok: true, verified: true, verifiedAt: Date.now(), mutationId: asText(mutation?.mutationId), revision: Number(mutation?.revision || 0), documentId, cloudProjectId: asText(read.data.id), written: { projects: 1 } };
  } catch (error) { return failed("project_mutation_unexpected_error", error?.message || "Project mutation failed."); }
}

async function runInvoiceMutationWrite({
  mutation,
  configured = false,
  user = null,
  company = null,
  storageSnapshot = localStorage,
} = {}) {
  const client = getSupabaseClient();
  const companyId = asText(company?.id);
  const userId = asText(user?.id);
  const invoice = mutation?.payload;
  const documentId = asText(mutation?.documentId || invoice?.id);
  if (!configured || !client?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (!invoice || !documentId || asText(invoice?.id) !== documentId) return failed("invalid_invoice_mutation", "Invoice mutation payload is invalid.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "Invoice mutation belongs to a different workspace.");

  const startAccess = await ensureCurrentDeviceCanWriteCloud({
    configured, user, company, storage: storageSnapshot, reason: "invoice_mutation", claimIfMissing: false,
  });
  if (!startAccess?.ok) return failed(startAccess?.code || "device_not_active", startAccess?.error, { deviceLockLost: Boolean(startAccess?.deviceLockLost) });
  const startFence = startAccess?.access?.fence || null;
  const ensureFence = async () => {
    const access = await ensureCurrentDeviceCanWriteCloud({
      configured, user, company, storage: storageSnapshot, reason: "invoice_mutation", claimIfMissing: false,
    });
    if (!access?.ok) return access;
    return operationFenceStillCurrent({ startFence, completionAccess: access })
      ? access
      : { ...buildStaleOperationResult("invoice_mutation"), deviceLockLost: true };
  };

  try {
    // Build once to discover the existing stable parent identities. These are
    // exact key lookups, never whole-table reads and never parent rewrites.
    const initial = buildTargetInvoicePersistencePayloads({ invoice, companyId, userId });
    const mapped = initial.mappedInvoice;
    const parentResults = await Promise.all([
      findParent(client, "customers", companyId, mapped.customer_legacy_local_id),
      findParent(client, "projects", companyId, mapped.project_legacy_local_id),
      findParent(client, "estimates", companyId, mapped.source_estimate_legacy_local_id),
    ]);
    const parentFailure = parentResults.find((result) => !result.ok);
    if (parentFailure) return parentFailure;

    const payloadsBeforeInvoice = buildTargetInvoicePersistencePayloads({
      invoice, companyId, userId,
      customerId: parentResults[0].id,
      projectId: parentResults[1].id,
      estimateId: parentResults[2].id,
    });
    const fenceBeforeInvoice = await ensureFence();
    if (!fenceBeforeInvoice?.ok) return failed(fenceBeforeInvoice?.code || "device_generation_changed", fenceBeforeInvoice?.error, { deviceLockLost: true });
    const invoiceWrite = await upsertRows(client, "invoices", [payloadsBeforeInvoice.invoicePayload], "id, legacy_local_id");
    if (invoiceWrite?.error || !invoiceWrite?.data?.[0]?.id) return failed("invoice_write_failed", invoiceWrite?.error?.message || "Invoice upsert did not return its cloud id.");
    const invoiceId = asText(invoiceWrite.data[0].id);

    const payloads = buildTargetInvoicePersistencePayloads({
      invoice, companyId, userId,
      customerId: parentResults[0].id,
      projectId: parentResults[1].id,
      estimateId: parentResults[2].id,
      invoiceId,
    });
    if (payloads.lineItemIssues.some((notice) => notice?.level === "error")) return failed("invoice_line_item_mapping_failed", "Invoice line items could not be mapped safely.");

    const fenceBeforeLines = await ensureFence();
    if (!fenceBeforeLines?.ok) return failed(fenceBeforeLines?.code || "device_generation_changed", fenceBeforeLines?.error, { deviceLockLost: true });
    const lineWrite = await upsertRows(client, "invoice_line_items", payloads.lineItemPayloads);
    if (lineWrite?.error) return failed("invoice_line_items_write_failed", lineWrite.error?.message);

    const fenceBeforePayments = await ensureFence();
    if (!fenceBeforePayments?.ok) return failed(fenceBeforePayments?.code || "device_generation_changed", fenceBeforePayments?.error, { deviceLockLost: true });
    const paymentWrite = await upsertRows(client, "invoice_payments", payloads.paymentPayloads);
    if (paymentWrite?.error) return failed("invoice_payments_write_failed", paymentWrite.error?.message);

    const [targetLinesBeforeCleanup, targetPaymentsBeforeCleanup] = await Promise.all([
      client.from("invoice_line_items").select("id, legacy_local_id, invoice_id, company_id")
        .eq("company_id", companyId).eq("invoice_id", invoiceId),
      client.from("invoice_payments").select("id, legacy_local_id, invoice_id, company_id")
        .eq("company_id", companyId).eq("invoice_id", invoiceId),
    ]);
    if (targetLinesBeforeCleanup?.error) return failed("invoice_line_items_verification_read_failed", targetLinesBeforeCleanup.error?.message);
    if (targetPaymentsBeforeCleanup?.error) return failed("invoice_payments_verification_read_failed", targetPaymentsBeforeCleanup.error?.message);
    const expectedLineIds = new Set(payloads.lineItemPayloads.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
    const expectedPaymentIds = new Set(payloads.paymentPayloads.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
    const staleLineIds = (Array.isArray(targetLinesBeforeCleanup?.data) ? targetLinesBeforeCleanup.data : [])
      .filter((row) => !expectedLineIds.has(asText(row?.legacy_local_id))).map((row) => asText(row?.id)).filter(Boolean);
    const stalePaymentIds = (Array.isArray(targetPaymentsBeforeCleanup?.data) ? targetPaymentsBeforeCleanup.data : [])
      .filter((row) => !expectedPaymentIds.has(asText(row?.legacy_local_id))).map((row) => asText(row?.id)).filter(Boolean);
    if (staleLineIds.length || stalePaymentIds.length) {
      const fenceBeforeCleanup = await ensureFence();
      if (!fenceBeforeCleanup?.ok) return failed(fenceBeforeCleanup?.code || "device_generation_changed", fenceBeforeCleanup?.error, { deviceLockLost: true });
    }
    const lineCleanup = await deleteExactRows({ client, table: "invoice_line_items", companyId, filters: [["invoice_id", invoiceId]], expectedIds: staleLineIds, failureCode: "invoice_line_items_target_cleanup_failed" });
    if (!lineCleanup.ok) return lineCleanup;
    const paymentCleanup = await deleteExactRows({ client, table: "invoice_payments", companyId, filters: [["invoice_id", invoiceId]], expectedIds: stalePaymentIds, failureCode: "invoice_payments_target_cleanup_failed" });
    if (!paymentCleanup.ok) return paymentCleanup;

    const invoiceRead = await client.from("invoices")
      .select("id, legacy_local_id, customer_id, project_id, estimate_id, source_estimate_legacy_id, invoice_number, estimate_number, status, payment_status, invoice_date, due_date, total_amount, amount_paid, balance_remaining, notes, terms")
      .eq("company_id", companyId).eq("legacy_local_id", documentId).maybeSingle();
    if (invoiceRead?.error || !invoiceRead?.data) return failed("invoice_verification_read_failed", invoiceRead?.error?.message || "Target invoice was not found after write.");
    const invoiceMismatch = comparePersistedCloudSemanticContract("invoices", payloads.invoicePayload, invoiceRead.data);

    const lineRead = await client.from("invoice_line_items")
      .select("id, legacy_local_id, invoice_id, sort_order, description, quantity, unit, unit_price, total_price, metadata")
      .eq("company_id", companyId).eq("invoice_id", invoiceId);
    if (lineRead?.error) return failed("invoice_line_items_verification_read_failed", lineRead.error?.message);
    const lineFailures = exactTargetRows(payloads.lineItemPayloads, lineRead?.data, samePersistedInvoiceLineItemContract);

    const paymentRead = await client.from("invoice_payments")
      .select("id, legacy_local_id, invoice_id, amount, method, status, paid_at")
      .eq("company_id", companyId).eq("invoice_id", invoiceId);
    if (paymentRead?.error) return failed("invoice_payments_verification_read_failed", paymentRead.error?.message);
    const paymentFailures = exactTargetRows(payloads.paymentPayloads, paymentRead?.data, (expected, cloud) => (
      comparePersistedCloudSemanticContract("invoice_payments", expected, cloud)
    ));

    if (invoiceMismatch.length || lineFailures.length || paymentFailures.length) {
      return failed("target_verification_failed", "Target invoice mutation did not match after cloud write.", {
        verification: { invoiceMismatch, lineFailures, paymentFailures },
      });
    }
    const completionAccess = await ensureFence();
    if (!completionAccess?.ok) return failed(completionAccess?.code || "device_generation_changed", completionAccess?.error, { deviceLockLost: true });
    return {
      ok: true,
      verified: true,
      verifiedAt: Date.now(),
      mutationId: asText(mutation?.mutationId),
      revision: Number(mutation?.revision || 0),
      documentId,
      cloudInvoiceId: invoiceId,
      written: { invoices: 1, invoiceLineItems: payloads.lineItemPayloads.length, invoicePayments: payloads.paymentPayloads.length },
      cleaned: { invoiceLineItems: staleLineIds.length, invoicePayments: stalePaymentIds.length },
    };
  } catch (error) {
    return failed("invoice_mutation_unexpected_error", error?.message || "Invoice mutation failed.");
  }
}

async function runEstimateMutationWrite({
  mutation,
  configured = false,
  user = null,
  company = null,
  storageSnapshot = localStorage,
} = {}) {
  const client = getSupabaseClient();
  const companyId = asText(company?.id);
  const userId = asText(user?.id);
  const estimate = mutation?.payload;
  const documentId = asText(mutation?.documentId || estimate?.id);
  if (!configured || !client?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (!estimate || !documentId || asText(estimate?.id) !== documentId) return failed("invalid_estimate_mutation", "Estimate mutation payload is invalid.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "Estimate mutation belongs to a different workspace.");

  const startAccess = await ensureCurrentDeviceCanWriteCloud({
    configured, user, company, storage: storageSnapshot, reason: "estimate_mutation", claimIfMissing: false,
  });
  if (!startAccess?.ok) return failed(startAccess?.code || "device_not_active", startAccess?.error, { deviceLockLost: Boolean(startAccess?.deviceLockLost) });
  const startFence = startAccess?.access?.fence || null;
  const ensureFence = async () => {
    const access = await ensureCurrentDeviceCanWriteCloud({
      configured, user, company, storage: storageSnapshot, reason: "estimate_mutation", claimIfMissing: false,
    });
    if (!access?.ok) return access;
    return operationFenceStillCurrent({ startFence, completionAccess: access })
      ? access
      : { ...buildStaleOperationResult("estimate_mutation"), deviceLockLost: true };
  };

  try {
    const initial = buildTargetEstimatePersistencePayloads({ estimate, companyId, userId });
    const mapped = initial.mappedEstimate;
    const parentResults = await Promise.all([
      findParent(client, "customers", companyId, mapped.customer_legacy_local_id),
      findParent(client, "projects", companyId, mapped.project_legacy_local_id),
    ]);
    const parentFailure = parentResults.find((result) => !result.ok);
    if (parentFailure) return parentFailure;

    const payloadsBeforeEstimate = buildTargetEstimatePersistencePayloads({
      estimate,
      companyId,
      userId,
      customerId: parentResults[0].id,
      projectId: parentResults[1].id,
    });
    const fenceBeforeEstimate = await ensureFence();
    if (!fenceBeforeEstimate?.ok) return failed(fenceBeforeEstimate?.code || "device_generation_changed", fenceBeforeEstimate?.error, { deviceLockLost: true });
    const estimateWrite = await upsertRows(client, "estimates", [payloadsBeforeEstimate.estimatePayload], "id, legacy_local_id");
    if (estimateWrite?.error || !estimateWrite?.data?.[0]?.id) return failed("estimate_write_failed", estimateWrite?.error?.message || "Estimate upsert did not return its cloud id.");
    const estimateId = asText(estimateWrite.data[0].id);

    const payloads = buildTargetEstimatePersistencePayloads({
      estimate,
      companyId,
      userId,
      customerId: parentResults[0].id,
      projectId: parentResults[1].id,
      estimateId,
    });
    if (payloads.lineItemIssues.some((notice) => notice?.level === "error")) return failed("estimate_line_item_mapping_failed", "Estimate line items could not be mapped safely.");

    const fenceBeforeLines = await ensureFence();
    if (!fenceBeforeLines?.ok) return failed(fenceBeforeLines?.code || "device_generation_changed", fenceBeforeLines?.error, { deviceLockLost: true });
    const lineWrite = await upsertRows(client, "estimate_line_items", payloads.lineItemPayloads);
    if (lineWrite?.error) return failed("estimate_line_items_write_failed", lineWrite.error?.message);

    const targetLinesBeforeCleanup = await client.from("estimate_line_items")
      .select("id, legacy_local_id, estimate_id, company_id")
      .eq("company_id", companyId).eq("estimate_id", estimateId);
    if (targetLinesBeforeCleanup?.error) {
      return failed("estimate_line_items_verification_read_failed", targetLinesBeforeCleanup.error?.message);
    }
    const expectedLineIds = new Set(payloads.lineItemPayloads.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
    const staleTargetRowIds = (Array.isArray(targetLinesBeforeCleanup?.data) ? targetLinesBeforeCleanup.data : [])
      .filter((row) => !expectedLineIds.has(asText(row?.legacy_local_id)))
      .map((row) => asText(row?.id))
      .filter(Boolean);
    if (staleTargetRowIds.length > 0) {
      const fenceBeforeCleanup = await ensureFence();
      if (!fenceBeforeCleanup?.ok) {
        return failed(fenceBeforeCleanup?.code || "device_generation_changed", fenceBeforeCleanup?.error, { deviceLockLost: true });
      }
      const cleanup = await client.from("estimate_line_items")
        .delete()
        .eq("company_id", companyId)
        .eq("estimate_id", estimateId)
        .in("id", staleTargetRowIds)
        .select("id");
      const deletedIds = new Set((Array.isArray(cleanup?.data) ? cleanup.data : []).map((row) => asText(row?.id)).filter(Boolean));
      if (cleanup?.error || staleTargetRowIds.some((id) => !deletedIds.has(id))) {
        return failed(
          "estimate_line_items_target_cleanup_failed",
          cleanup?.error?.message || "Target estimate line-item cleanup could not be verified."
        );
      }
    }

    const estimateRead = await client.from("estimates")
      .select("id, legacy_local_id, customer_id, project_id, estimate_number, estimate_date, status, total_amount, notes, terms, converted_invoice_legacy_id, restore_payload, restore_payload_version")
      .eq("company_id", companyId).eq("legacy_local_id", documentId).maybeSingle();
    if (estimateRead?.error || !estimateRead?.data) return failed("estimate_verification_read_failed", estimateRead?.error?.message || "Target estimate was not found after write.");
    const estimateMismatch = comparePersistedCloudSemanticContract("estimates", payloads.estimatePayload, estimateRead.data);

    const lineRead = await client.from("estimate_line_items")
      .select("id, legacy_local_id, estimate_id, sort_order, line_role, description, quantity, unit, unit_price, total_price, metadata")
      .eq("company_id", companyId).eq("estimate_id", estimateId);
    if (lineRead?.error) return failed("estimate_line_items_verification_read_failed", lineRead.error?.message);
    const lineFailures = exactTargetRows(payloads.lineItemPayloads, lineRead?.data, samePersistedEstimateLineItemContract);

    if (estimateMismatch.length || lineFailures.length) {
      return failed("target_verification_failed", "Target estimate mutation did not match after cloud write.", {
        verification: { estimateMismatch, lineFailures },
      });
    }
    const completionAccess = await ensureFence();
    if (!completionAccess?.ok) return failed(completionAccess?.code || "device_generation_changed", completionAccess?.error, { deviceLockLost: true });
    return {
      ok: true,
      verified: true,
      verifiedAt: Date.now(),
      mutationId: asText(mutation?.mutationId),
      revision: Number(mutation?.revision || 0),
      documentId,
      cloudEstimateId: estimateId,
      written: { estimates: 1, estimateLineItems: payloads.lineItemPayloads.length },
      cleaned: { estimateLineItems: staleTargetRowIds.length },
    };
  } catch (error) {
    return failed("estimate_mutation_unexpected_error", error?.message || "Estimate mutation failed.");
  }
}

async function runDeleteMutationWrite({ mutation, configured = false, user = null, company = null, storageSnapshot = localStorage } = {}) {
  const client = getSupabaseClient();
  const companyId = asText(company?.id); const userId = asText(user?.id);
  const documentId = asText(mutation?.documentId || mutation?.payload?.legacyLocalId || mutation?.payload?.id);
  const tableByEntity = {
    [CLOUD_MUTATION_ENTITY.CUSTOMER]: "customers",
    [CLOUD_MUTATION_ENTITY.PROJECT]: "projects",
    [CLOUD_MUTATION_ENTITY.ESTIMATE]: "estimates",
    [CLOUD_MUTATION_ENTITY.INVOICE]: "invoices",
  };
  const table = tableByEntity[mutation?.entityType];
  if (!configured || !client?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (!table || !documentId) return failed("unsupported_cloud_mutation", "Cloud mutation is not supported.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "Delete mutation belongs to a different workspace.");
  const fence = await createMutationFence({ configured, user, company, storageSnapshot, reason: `${mutation.entityType}_delete_mutation` });
  if (!fence.ok) return fence.result;
  try {
    const lookup = await lookupExactTarget(client, table, companyId, documentId);
    if (!lookup.ok) return lookup;
    const targetId = asText(lookup?.row?.id);
    const childConfig = mutation.entityType === CLOUD_MUTATION_ENTITY.ESTIMATE
      ? [["estimate_line_items", "estimate_id", "estimate_line_items_delete_failed"]]
      : mutation.entityType === CLOUD_MUTATION_ENTITY.INVOICE
        ? [
          ["invoice_line_items", "invoice_id", "invoice_line_items_delete_failed"],
          ["invoice_payments", "invoice_id", "invoice_payments_delete_failed"],
        ]
        : [];
    const deletedChildren = {};

    if (targetId) {
      for (const [childTable, parentColumn, failureCode] of childConfig) {
        const rows = await client.from(childTable).select("id")
          .eq("company_id", companyId).eq(parentColumn, targetId);
        if (rows?.error) return failed(`${childTable}_verification_read_failed`, rows.error?.message);
        const ids = (Array.isArray(rows?.data) ? rows.data : []).map((row) => asText(row?.id)).filter(Boolean);
        const current = await fence.ensure();
        if (!current?.ok) return failed(current?.code || "device_generation_changed", current?.error, { deviceLockLost: true });
        const removed = await deleteExactRows({ client, table: childTable, companyId, filters: [[parentColumn, targetId]], expectedIds: ids, failureCode });
        if (!removed.ok) return removed;
        deletedChildren[childTable] = ids.length;
      }
      const current = await fence.ensure();
      if (!current?.ok) return failed(current?.code || "device_generation_changed", current?.error, { deviceLockLost: true });
      const parentDelete = await deleteExactRows({ client, table, companyId, expectedIds: [targetId], failureCode: `${table}_delete_failed` });
      if (!parentDelete.ok) return parentDelete;
    }

    const parentRead = await lookupExactTarget(client, table, companyId, documentId);
    if (!parentRead.ok) return parentRead;
    if (parentRead.row) return failed("target_delete_verification_failed", `Target ${table} row still exists after delete.`);
    if (targetId) {
      for (const [childTable, parentColumn] of childConfig) {
        const rows = await client.from(childTable).select("id")
          .eq("company_id", companyId).eq(parentColumn, targetId);
        if (rows?.error || (Array.isArray(rows?.data) && rows.data.length > 0)) {
          return failed("target_delete_verification_failed", `Target ${childTable} rows still exist after delete.`);
        }
      }
    }
    const completion = await fence.ensure();
    if (!completion?.ok) return failed(completion?.code || "device_generation_changed", completion?.error, { deviceLockLost: true });
    return { ok: true, verified: true, verifiedAt: Date.now(), mutationId: asText(mutation?.mutationId), revision: Number(mutation?.revision || 0), documentId, deleted: { [table]: targetId ? 1 : 0, ...deletedChildren } };
  } catch (error) { return failed(`${mutation?.entityType || "target"}_delete_unexpected_error`, error?.message || "Target delete mutation failed."); }
}

async function runAppRestoreBundleMutationWrite({ mutation, configured = false, user = null, company = null, storageSnapshot = localStorage } = {}) {
  const companyId = asText(company?.id); const userId = asText(user?.id);
  const bundle = mutation?.payload?.bundle;
  if (!configured || !getSupabaseClient()?.from) return failed("supabase_not_configured", "Supabase is not configured.");
  if (!companyId || !userId) return failed("cloud_identity_missing", "Cloud account or workspace is unavailable.");
  if (asText(mutation?.companyId) && asText(mutation.companyId) !== companyId) return failed("mutation_company_mismatch", "App restore bundle mutation belongs to a different workspace.");
  const validation = validateSupabaseAppRestoreBundle(bundle);
  if (!validation.valid) return failed("invalid_app_restore_bundle_mutation", validation.reason);
  const write = await updateSupabaseAppRestoreBundle({
    storageSnapshot,
    proposedBundle: bundle,
    configured,
    user,
    company,
    role: "",
  });
  if (write?.status !== APP_RESTORE_BUNDLE_STATUS.COMPLETED || !write?.bundleUpdated) {
    return failed(write?.code || "app_restore_bundle_write_failed", write?.error || "App restore bundle write failed.", { deviceLockLost: Boolean(write?.deviceLockLost) });
  }
  const read = await readSupabaseAppRestoreBundle({ client: getSupabaseClient(), companyId });
  if (read?.status !== "available" || !cloudSyncEqual(read.bundle, bundle)) {
    return failed("app_restore_bundle_verification_failed", "App restore bundle did not match after cloud reread.");
  }
  return { ok: true, verified: true, verifiedAt: Date.now(), mutationId: asText(mutation?.mutationId), revision: Number(mutation?.revision || 0), documentId: asText(mutation?.documentId), written: { appRestoreBundle: 1 } };
}

export async function runSupabaseCloudMutationWrite(options = {}) {
  const entityType = options?.mutation?.entityType;
  const operation = options?.mutation?.operation || CLOUD_MUTATION_OPERATION.UPSERT;
  if (operation === CLOUD_MUTATION_OPERATION.DELETE) {
    if ([CLOUD_MUTATION_ENTITY.CUSTOMER, CLOUD_MUTATION_ENTITY.PROJECT, CLOUD_MUTATION_ENTITY.ESTIMATE, CLOUD_MUTATION_ENTITY.INVOICE].includes(entityType)) {
      return runDeleteMutationWrite(options);
    }
    return failed("unsupported_cloud_mutation", "Cloud mutation is not supported.");
  }
  if (operation !== CLOUD_MUTATION_OPERATION.UPSERT) return failed("unsupported_cloud_mutation", "Cloud mutation is not supported.");
  if (entityType === CLOUD_MUTATION_ENTITY.CUSTOMER) return runCustomerMutationWrite(options);
  if (entityType === CLOUD_MUTATION_ENTITY.PROJECT) return runProjectMutationWrite(options);
  if (entityType === CLOUD_MUTATION_ENTITY.ESTIMATE) return runEstimateMutationWrite(options);
  if (entityType === CLOUD_MUTATION_ENTITY.INVOICE) return runInvoiceMutationWrite(options);
  if (entityType === CLOUD_MUTATION_ENTITY.APP_RESTORE_BUNDLE) return runAppRestoreBundleMutationWrite(options);
  return failed("unsupported_cloud_mutation", "Cloud mutation is not supported.");
}
