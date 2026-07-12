// @ts-nocheck
/* eslint-disable */

// Pure identity-reconciliation planning for the cloud backup writer. This
// deliberately contains no Supabase or storage access: callers provide the
// current local draft and company-scoped cloud rows, inspect the plan, then
// decide which explicitly-safe re-keys to apply under the device lock.

export const CLOUD_IDENTITY_OUTCOME = Object.freeze({
  EXACT_MATCH: "exact_match",
  SAFE_RECONCILIATION: "safe_reconciliation",
  AMBIGUOUS: "ambiguous",
  LOCAL_ONLY: "local_only",
  CLOUD_ONLY: "cloud_only",
  PROTECTED_CONFLICT: "protected_conflict",
});

function asText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return asText(value).toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return normalizeText(value);
}

function normalizePhone(value) {
  return asText(value).replace(/[^0-9]/g, "");
}

function normalizeNumber(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function rows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}

function legacyId(row) {
  return asText(row?.legacy_local_id || row?.legacyLocalId || row?.id);
}

function cloudId(row) {
  return asText(row?.id);
}

function uniqueByKey(candidates, key) {
  const normalized = asText(key);
  if (!normalized) return [];
  return rows(candidates).filter((row) => asText(row?.__identityKey) === normalized);
}

function indexByLegacyId(records) {
  return new Map(rows(records).map((row) => [legacyId(row), row]).filter(([id]) => Boolean(id)));
}

function addPlanItem(target, outcome, item) {
  target[outcome].push({ outcome, ...item });
}

function customerSignals(row) {
  return {
    email: normalizeEmail(row?.email),
    phone: normalizePhone(row?.phone),
    company: normalizeText(row?.company_name || row?.companyName),
    display: normalizeText(row?.display_name || row?.displayName || row?.name || row?.fullName),
    contact: normalizeText(row?.contact_name || row?.contactName),
  };
}

function customersCorroborate(local, cloud) {
  const left = customerSignals(local);
  const right = customerSignals(cloud);
  const matchingEmail = Boolean(left.email && left.email === right.email);
  const matchingPhone = Boolean(left.phone && left.phone === right.phone);
  const matchingNameOrCompany = Boolean(
    (left.company && left.company === right.company)
    || (left.display && left.display === right.display)
    || (left.contact && left.contact === right.contact)
  );
  // Never use a name by itself. A unique email/phone needs a corroborating
  // contact/company/display signal, unless both email and phone agree.
  return (matchingEmail && matchingPhone) || ((matchingEmail || matchingPhone) && matchingNameOrCompany);
}

function customerCandidates(local, cloudOnly) {
  const localSignals = customerSignals(local);
  return rows(cloudOnly).filter((cloud) => {
    const cloudSignals = customerSignals(cloud);
    const emailMatch = Boolean(localSignals.email && localSignals.email === cloudSignals.email);
    const phoneMatch = Boolean(localSignals.phone && localSignals.phone === cloudSignals.phone);
    return (emailMatch || phoneMatch) && customersCorroborate(local, cloud);
  });
}

function relationshipCompatible(localLegacyId, cloudUuid, resolvedCloudIds) {
  const localId = asText(localLegacyId);
  if (!localId || !cloudUuid) return true;
  const resolved = asText(resolvedCloudIds.get(localId));
  return !resolved || resolved === asText(cloudUuid);
}

function amountToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

function normalizePaymentMethodText(value) {
  return asText(value).toLowerCase();
}

function normalizePaymentStatusText(value) {
  return asText(value).toLowerCase();
}

function paidAtEpochMs(value) {
  const raw = asText(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

// Pure, deterministic financial-identity fingerprint for a single payment.
// Returns { ok: false, missing: [...] } when ANY required identity field is
// absent, so a payment that cannot be uniquely identified is never
// auto-reconciled by amount alone.
//
// The composite is intentionally strict: parent invoice UUID + amount in
// integer cents + normalized method + normalized status + paid_at as an exact
// epoch. Both sides derive these from the same mapper, so equal payments
// produce byte-identical fingerprints. Mutable UI metadata is never included.
//
// created_at is deliberately EXCLUDED: the writer (mapInvoicePaymentPayloads)
// does not persist created_at, so the cloud row's created_at is the database
// `default now()` insert time, not the app payment createdAt. The two sides are
// not comparable, so created_at is not reliable corroboration here.
export function buildPaymentIdentityFingerprint(payment, parentInvoiceUuid) {
  const parent = asText(parentInvoiceUuid);
  const amountCents = amountToCents(payment?.amount);
  const method = normalizePaymentMethodText(payment?.method);
  const status = normalizePaymentStatusText(payment?.status);
  const paidAtMs = paidAtEpochMs(payment?.paid_at);
  const missing = [];
  if (!parent) missing.push("parent_invoice");
  if (amountCents === null) missing.push("amount");
  if (!method) missing.push("method");
  if (!status) missing.push("status");
  if (paidAtMs === null) missing.push("paid_at");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    parent,
    amountCents,
    method,
    status,
    paidAtMs,
    key: `${parent}|${amountCents}|${method}|${status}|${paidAtMs}`,
  };
}

function oneToOneNumberCandidate(local, cloudOnly, column) {
  const value = normalizeNumber(local?.[column]);
  if (!value) return [];
  return rows(cloudOnly).filter((cloud) => normalizeNumber(cloud?.[column]) === value);
}

function makeCorePlan(entityType, localRows, cloudRows, {
  secondaryColumn = "",
  candidateFinder = null,
  compatible = () => true,
  childTable = "",
  bindings = null,
  bindingContradicts = () => false,
} = {}, resolvedCloudIds = new Map()) {
  const result = {
    exact_match: [],
    safe_reconciliation: [],
    ambiguous: [],
    local_only: [],
    cloud_only: [],
    protected_conflict: [],
    binding_diagnostics: [],
  };
  const bindingMap = bindings instanceof Map ? bindings : new Map(Object.entries(bindings || {}));
  const getBoundUuid = (row) => asText(bindingMap.get(legacyId(row)));
  const localByLegacy = indexByLegacyId(localRows);
  const cloudByLegacy = indexByLegacyId(cloudRows);
  const unmatchedLocal = rows(localRows).filter((row) => !cloudByLegacy.has(legacyId(row)));
  const unmatchedCloud = rows(cloudRows).filter((row) => !localByLegacy.has(legacyId(row)));

  rows(localRows).forEach((local) => {
    const matchedCloud = cloudByLegacy.get(legacyId(local));
    if (!matchedCloud) return;
    addPlanItem(result, CLOUD_IDENTITY_OUTCOME.EXACT_MATCH, {
      entityType,
      cloudUuid: cloudId(matchedCloud),
      currentLocalLegacyId: legacyId(local),
      oldCloudLegacyId: legacyId(matchedCloud),
      stableIdentifier: "legacy_local_id",
    });
  });

  // Durable-binding pass. A valid cloud-asset-UUID binding is the strongest
  // identity signal after a legacy-id exact match: it re-keys the preserved
  // cloud row for a drifted local id WITHOUT relying on business-number
  // inference. A binding whose cloud row is missing, duplicated, or contradicts
  // the current business identifier never wins -- it falls through to the
  // existing planner.
  const bindingReconciledLocalIds = new Set();
  const bindingReconciledCloudUuids = new Set();
  const localBindCountByUuid = new Map();
  rows(localRows).forEach((local) => {
    const uuid = getBoundUuid(local);
    if (uuid) localBindCountByUuid.set(uuid, (localBindCountByUuid.get(uuid) || 0) + 1);
  });
  const unmatchedCloudByUuid = new Map(unmatchedCloud.map((cloud) => [cloudId(cloud), cloud]));
  unmatchedLocal.forEach((local) => {
    const boundUuid = getBoundUuid(local);
    if (!boundUuid) return;
    const cloud = unmatchedCloudByUuid.get(boundUuid);
    if (!cloud) {
      result.binding_diagnostics.push({ entityType, currentLocalLegacyId: legacyId(local), reason: "binding_missing_cloud_row" });
      return;
    }
    if ((localBindCountByUuid.get(boundUuid) || 0) > 1) {
      result.binding_diagnostics.push({ entityType, currentLocalLegacyId: legacyId(local), reason: "binding_duplicate_local_claim" });
      return;
    }
    if (bindingContradicts(local, cloud, resolvedCloudIds)) {
      result.binding_diagnostics.push({ entityType, currentLocalLegacyId: legacyId(local), reason: "binding_conflict" });
      return;
    }
    addPlanItem(result, CLOUD_IDENTITY_OUTCOME.SAFE_RECONCILIATION, {
      entityType,
      cloudUuid: cloudId(cloud),
      oldCloudLegacyId: legacyId(cloud),
      currentLocalLegacyId: legacyId(local),
      stableIdentifier: "asset_binding",
      parentIdentities: {},
      confidenceRule: "durable cloud asset UUID binding",
      dependentChildOperations: childTable ? [{ action: "rebuild_matched_parent_children", table: childTable, parentUuid: cloudId(cloud) }] : [],
    });
    resolvedCloudIds.set(legacyId(local), cloudId(cloud));
    bindingReconciledLocalIds.add(legacyId(local));
    bindingReconciledCloudUuids.add(cloudId(cloud));
  });

  const remainingUnmatchedCloud = unmatchedCloud.filter((cloud) => !bindingReconciledCloudUuids.has(cloudId(cloud)));

  unmatchedLocal.forEach((local) => {
    if (bindingReconciledLocalIds.has(legacyId(local))) return;
    const candidates = candidateFinder
      ? candidateFinder(local, remainingUnmatchedCloud)
      : oneToOneNumberCandidate(local, remainingUnmatchedCloud, secondaryColumn);
    const compatibleCandidates = candidates.filter((cloud) => compatible(local, cloud, resolvedCloudIds));
    if (compatibleCandidates.length === 1) {
      const cloud = compatibleCandidates[0];
      const reconciliation = {
        entityType,
        cloudUuid: cloudId(cloud),
        oldCloudLegacyId: legacyId(cloud),
        currentLocalLegacyId: legacyId(local),
        stableIdentifier: secondaryColumn || "corroborated_contact",
        parentIdentities: {},
        confidenceRule: entityType === "customer"
          ? "unique normalized email-or-phone with corroborating customer identity"
          : `unique ${secondaryColumn} with compatible resolved parent identities`,
        dependentChildOperations: childTable ? [{ action: "rebuild_matched_parent_children", table: childTable, parentUuid: cloudId(cloud) }] : [],
      };
      addPlanItem(result, CLOUD_IDENTITY_OUTCOME.SAFE_RECONCILIATION, reconciliation);
      resolvedCloudIds.set(legacyId(local), cloudId(cloud));
      return;
    }
    if (candidates.length > 1 || (candidates.length === 1 && compatibleCandidates.length === 0)) {
      addPlanItem(result, CLOUD_IDENTITY_OUTCOME.AMBIGUOUS, {
        entityType,
        currentLocalLegacyId: legacyId(local),
        stableIdentifier: secondaryColumn || "corroborated_contact",
        candidateCloudUuids: candidates.map(cloudId).filter(Boolean),
        reason: candidates.length > 1 ? "multiple_candidates" : "parent_relationship_conflict",
      });
      return;
    }
    addPlanItem(result, CLOUD_IDENTITY_OUTCOME.LOCAL_ONLY, {
      entityType,
      currentLocalLegacyId: legacyId(local),
    });
  });

  unmatchedCloud.forEach((cloud) => {
    const matched = result.safe_reconciliation.some((entry) => entry.cloudUuid === cloudId(cloud));
    if (matched) return;
    addPlanItem(result, CLOUD_IDENTITY_OUTCOME.CLOUD_ONLY, {
      entityType,
      cloudUuid: cloudId(cloud),
      oldCloudLegacyId: legacyId(cloud),
    });
  });

  return result;
}

function mergePlans(target, source) {
  Object.values(CLOUD_IDENTITY_OUTCOME).forEach((outcome) => {
    target[outcome].push(...rows(source?.[outcome]));
  });
}

/**
 * Builds a no-I/O plan. The caller must pass cloud rows containing the
 * secondary identifiers and UUID foreign keys used below.
 */
export function buildCloudIdentityReconciliationPlan({ draft = {}, cloudRowsByTable = {}, assetBindings = {} } = {}) {
  const result = {
    exactMatches: [],
    reconciliations: [],
    localOnly: [],
    cloudOnly: [],
    ambiguous: [],
    protectedConflicts: [],
    bindingDiagnostics: [],
    byEntity: {},
  };
  const resolvedCustomerIds = new Map();
  const resolvedProjectIds = new Map();
  const resolvedEstimateIds = new Map();
  const resolvedInvoiceIds = new Map();

  const bindingMapFor = (entityType) => {
    const table = assetBindings && typeof assetBindings === "object" ? assetBindings[entityType] : null;
    return new Map(Object.entries(table || {}).map(([legacy, uuid]) => [asText(legacy), asText(uuid)]));
  };
  const numberContradicts = (column) => (local, cloud) => {
    const left = normalizeNumber(local?.[column]);
    const right = normalizeNumber(cloud?.[column]);
    return Boolean(left && right && left !== right);
  };
  const customerBindingContradicts = (local, cloud) => {
    const left = customerSignals(local);
    const right = customerSignals(cloud);
    const bothHaveSignals = (left.email || left.phone) && (right.email || right.phone);
    return Boolean(bothHaveSignals && !customersCorroborate(local, cloud));
  };

  const customerPlan = makeCorePlan("customer", draft.customers, cloudRowsByTable.customers, {
    candidateFinder: customerCandidates,
    secondaryColumn: "corroborated_contact",
    bindings: bindingMapFor("customer"),
    bindingContradicts: customerBindingContradicts,
  }, resolvedCustomerIds);
  rows(customerPlan.exact_match).forEach((entry) => resolvedCustomerIds.set(entry.currentLocalLegacyId, entry.cloudUuid));
  rows(customerPlan.safe_reconciliation).forEach((entry) => resolvedCustomerIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const projectPlan = makeCorePlan("project", draft.projects, cloudRowsByTable.projects, {
    secondaryColumn: "project_number",
    compatible: (local, cloud) => relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds),
    bindings: bindingMapFor("project"),
    bindingContradicts: (local, cloud) => (
      numberContradicts("project_number")(local, cloud)
      || !relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
    ),
  }, resolvedProjectIds);
  rows(projectPlan.exact_match).forEach((entry) => resolvedProjectIds.set(entry.currentLocalLegacyId, entry.cloudUuid));
  rows(projectPlan.safe_reconciliation).forEach((entry) => resolvedProjectIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const estimatePlan = makeCorePlan("estimate", draft.estimates, cloudRowsByTable.estimates, {
    secondaryColumn: "estimate_number",
    compatible: (local, cloud) => (
      relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      && relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
    ),
    childTable: "estimate_line_items",
    bindings: bindingMapFor("estimate"),
    bindingContradicts: (local, cloud) => (
      numberContradicts("estimate_number")(local, cloud)
      || !relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      || !relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
    ),
  }, resolvedEstimateIds);
  rows(estimatePlan.exact_match).forEach((entry) => resolvedEstimateIds.set(entry.currentLocalLegacyId, entry.cloudUuid));
  rows(estimatePlan.safe_reconciliation).forEach((entry) => resolvedEstimateIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const invoicePlan = makeCorePlan("invoice", draft.invoices, cloudRowsByTable.invoices, {
    secondaryColumn: "invoice_number",
    compatible: (local, cloud) => (
      relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      && relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
      && relationshipCompatible(local?.source_estimate_legacy_local_id, cloud?.estimate_id || cloud?.source_estimate_id, resolvedEstimateIds)
    ),
    childTable: "invoice_line_items",
    bindings: bindingMapFor("invoice"),
    bindingContradicts: (local, cloud) => (
      numberContradicts("invoice_number")(local, cloud)
      || !relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      || !relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
      || !relationshipCompatible(local?.source_estimate_legacy_local_id, cloud?.estimate_id || cloud?.source_estimate_id, resolvedEstimateIds)
    ),
  }, resolvedInvoiceIds);
  rows(invoicePlan.exact_match).forEach((entry) => resolvedInvoiceIds.set(entry.currentLocalLegacyId, entry.cloudUuid));
  rows(invoicePlan.safe_reconciliation).forEach((entry) => resolvedInvoiceIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  // Payment identity is financial history. A drifted payment is only ever
  // reconciled when its parent invoice was independently proven to be the same
  // record (exact match or safe reconciliation) AND the payment is an
  // unambiguous 1:1 match under that preserved invoice UUID whose FULL financial
  // fingerprint is present and identical on both sides -- amount (cents),
  // normalized method, normalized status, and paid_at. Amount alone never
  // reconciles: two distinct payments on one invoice can share an amount. Any
  // missing, ambiguous, or conflicting identity field stays a protected
  // conflict. A reconciliation re-keys ONLY the cloud payment's
  // legacy_local_id; the cloud UUID, invoice_id, amount, method, status, and
  // paid_at are all preserved untouched.
  const paymentLocalByLegacy = indexByLegacyId(draft.invoicePayments);
  const paymentCloudByLegacy = indexByLegacyId(cloudRowsByTable.invoice_payments);
  rows(draft.invoicePayments).forEach((payment) => {
    const cloud = paymentCloudByLegacy.get(legacyId(payment));
    if (cloud) {
      paymentLocalByLegacy.delete(legacyId(payment));
      paymentCloudByLegacy.delete(legacyId(payment));
      result.exactMatches.push({ entityType: "invoice_payment", cloudUuid: cloudId(cloud), currentLocalLegacyId: legacyId(payment), oldCloudLegacyId: legacyId(cloud), stableIdentifier: "legacy_local_id" });
    }
  });

  // Payment binding pass: a durable payment-UUID binding proves identity, but
  // ONLY when the bound cloud payment still belongs to the SAME resolved parent
  // invoice UUID. A payment bound to a different invoice is blocked, never
  // silently accepted.
  const paymentBindings = bindingMapFor("invoice_payment");
  const paymentCloudById = new Map();
  paymentCloudByLegacy.forEach((cloudPayment) => paymentCloudById.set(cloudId(cloudPayment), cloudPayment));
  [...paymentLocalByLegacy.values()].forEach((payment) => {
    const boundUuid = asText(paymentBindings.get(legacyId(payment)));
    if (!boundUuid) return;
    const cloudPayment = paymentCloudById.get(boundUuid);
    if (!cloudPayment) {
      result.bindingDiagnostics.push({ entityType: "invoice_payment", currentLocalLegacyId: legacyId(payment), reason: "binding_missing_cloud_row" });
      return;
    }
    const parentCloudUuid = asText(resolvedInvoiceIds.get(asText(payment?.invoice_legacy_local_id)));
    if (!parentCloudUuid || asText(cloudPayment?.invoice_id) !== parentCloudUuid) {
      result.protectedConflicts.push({ entityType: "invoice_payment", currentLocalLegacyId: legacyId(payment), candidateCloudUuids: [boundUuid], reason: "binding_conflict" });
      paymentLocalByLegacy.delete(legacyId(payment));
      return;
    }
    result.reconciliations.push({
      entityType: "invoice_payment",
      cloudUuid: cloudId(cloudPayment),
      oldCloudLegacyId: legacyId(cloudPayment),
      currentLocalLegacyId: legacyId(payment),
      stableIdentifier: "asset_binding",
      parentInvoiceUuid: parentCloudUuid,
      confidenceRule: "durable cloud payment UUID binding on the same invoice",
      dependentChildOperations: [],
    });
    paymentLocalByLegacy.delete(legacyId(payment));
    paymentCloudByLegacy.delete(legacyId(cloudPayment));
    paymentCloudById.delete(boundUuid);
  });

  // Group the remaining UNMATCHED payments by their resolved parent invoice UUID
  // so the 1:1 and ambiguity checks can require exactly one payment per side and
  // detect two payments that share the same identity fingerprint.
  const unmatchedLocalPaymentsByParent = new Map();
  paymentLocalByLegacy.forEach((payment) => {
    const parent = asText(resolvedInvoiceIds.get(asText(payment?.invoice_legacy_local_id)));
    if (!parent) return;
    const list = unmatchedLocalPaymentsByParent.get(parent) || [];
    list.push(payment);
    unmatchedLocalPaymentsByParent.set(parent, list);
  });
  const unmatchedCloudPaymentsByParent = new Map();
  paymentCloudByLegacy.forEach((cloudPayment) => {
    const parent = asText(cloudPayment?.invoice_id);
    if (!parent) return;
    const list = unmatchedCloudPaymentsByParent.get(parent) || [];
    list.push(cloudPayment);
    unmatchedCloudPaymentsByParent.set(parent, list);
  });

  const pushPaymentProtectedConflict = (payment, cloudCandidates, reason, missingFields) => {
    result.protectedConflicts.push({
      entityType: "invoice_payment",
      currentLocalLegacyId: legacyId(payment),
      candidateCloudUuids: cloudCandidates.map(cloudId).filter(Boolean),
      reason,
      ...(Array.isArray(missingFields) && missingFields.length ? { missingFields } : {}),
    });
  };

  paymentLocalByLegacy.forEach((payment) => {
    const parentCloudUuid = asText(resolvedInvoiceIds.get(asText(payment?.invoice_legacy_local_id)));
    const competingCloudPayments = parentCloudUuid
      ? (unmatchedCloudPaymentsByParent.get(parentCloudUuid) || [])
      : [];
    if (competingCloudPayments.length === 0) {
      // No cloud counterpart under a resolved parent: a purely local payment.
      result.localOnly.push({ entityType: "invoice_payment", currentLocalLegacyId: legacyId(payment) });
      return;
    }
    // Strict 1:1 under the proven invoice. More than one candidate on either
    // side is ambiguous and stays protected.
    const localPaymentsOnParent = unmatchedLocalPaymentsByParent.get(parentCloudUuid) || [];
    if (localPaymentsOnParent.length !== 1 || competingCloudPayments.length !== 1) {
      pushPaymentProtectedConflict(payment, competingCloudPayments, "payment_identity_ambiguous");
      return;
    }
    const cloudPayment = competingCloudPayments[0];
    const localFingerprint = buildPaymentIdentityFingerprint(payment, parentCloudUuid);
    const cloudFingerprint = buildPaymentIdentityFingerprint(cloudPayment, asText(cloudPayment?.invoice_id));
    if (!localFingerprint.ok || !cloudFingerprint.ok) {
      const missing = [...new Set([...(localFingerprint.missing || []), ...(cloudFingerprint.missing || [])])];
      pushPaymentProtectedConflict(payment, [cloudPayment], "payment_identity_fields_missing", missing);
      return;
    }
    if (localFingerprint.key !== cloudFingerprint.key) {
      pushPaymentProtectedConflict(payment, [cloudPayment], "payment_identity_mismatch");
      return;
    }
    // Proven the same payment by full financial fingerprint. Re-key only the
    // legacy_local_id pointer; every financial value is preserved.
    result.reconciliations.push({
      entityType: "invoice_payment",
      cloudUuid: cloudId(cloudPayment),
      oldCloudLegacyId: legacyId(cloudPayment),
      currentLocalLegacyId: legacyId(payment),
      stableIdentifier: "payment_identity_fingerprint",
      parentInvoiceUuid: parentCloudUuid,
      confidenceRule: "single unmatched local + single unmatched cloud payment on a proven invoice with identical amount, method, status, and paid_at",
      dependentChildOperations: [],
    });
    paymentCloudByLegacy.delete(legacyId(cloudPayment));
  });
  paymentCloudByLegacy.forEach((payment) => {
    result.protectedConflicts.push({ entityType: "invoice_payment", cloudUuid: cloudId(payment), oldCloudLegacyId: legacyId(payment), reason: "unmatched_protected_cloud_payment" });
  });

  const plans = { customer: customerPlan, project: projectPlan, estimate: estimatePlan, invoice: invoicePlan };
  Object.entries(plans).forEach(([entityType, plan]) => {
    result.byEntity[entityType] = plan;
    result.exactMatches.push(...plan.exact_match);
    result.reconciliations.push(...plan.safe_reconciliation);
    result.localOnly.push(...plan.local_only);
    result.cloudOnly.push(...plan.cloud_only);
    result.ambiguous.push(...plan.ambiguous);
    result.bindingDiagnostics.push(...rows(plan.binding_diagnostics));
  });
  const paymentProtectedConflicts = result.protectedConflicts.filter((entry) => entry.entityType === "invoice_payment");
  result.byEntity.invoice_payment = {
    exact_match: result.exactMatches.filter((entry) => entry.entityType === "invoice_payment"),
    safe_reconciliation: result.reconciliations.filter((entry) => entry.entityType === "invoice_payment"),
    ambiguous: [],
    local_only: result.localOnly.filter((entry) => entry.entityType === "invoice_payment"),
    cloud_only: paymentProtectedConflicts.filter((entry) => entry.oldCloudLegacyId),
    protected_conflict: paymentProtectedConflicts,
  };

  return result;
}

export function hasPermanentCloudIdentityConflict(plan) {
  return Boolean(
    rows(plan?.ambiguous).length
    || rows(plan?.protectedConflicts).length
  );
}
