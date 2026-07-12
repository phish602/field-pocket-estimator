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
} = {}, resolvedCloudIds = new Map()) {
  const result = {
    exact_match: [],
    safe_reconciliation: [],
    ambiguous: [],
    local_only: [],
    cloud_only: [],
    protected_conflict: [],
  };
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

  unmatchedLocal.forEach((local) => {
    const candidates = candidateFinder
      ? candidateFinder(local, unmatchedCloud)
      : oneToOneNumberCandidate(local, unmatchedCloud, secondaryColumn);
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
export function buildCloudIdentityReconciliationPlan({ draft = {}, cloudRowsByTable = {} } = {}) {
  const result = {
    exactMatches: [],
    reconciliations: [],
    localOnly: [],
    cloudOnly: [],
    ambiguous: [],
    protectedConflicts: [],
    byEntity: {},
  };
  const resolvedCustomerIds = new Map();
  const resolvedProjectIds = new Map();
  const resolvedEstimateIds = new Map();
  const resolvedInvoiceIds = new Map();

  const customerPlan = makeCorePlan("customer", draft.customers, cloudRowsByTable.customers, {
    candidateFinder: customerCandidates,
    secondaryColumn: "corroborated_contact",
  }, resolvedCustomerIds);
  rows(customerPlan.exact_match).forEach((entry) => resolvedCustomerIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const projectPlan = makeCorePlan("project", draft.projects, cloudRowsByTable.projects, {
    secondaryColumn: "project_number",
    compatible: (local, cloud) => relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds),
  }, resolvedProjectIds);
  rows(projectPlan.exact_match).forEach((entry) => resolvedProjectIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const estimatePlan = makeCorePlan("estimate", draft.estimates, cloudRowsByTable.estimates, {
    secondaryColumn: "estimate_number",
    compatible: (local, cloud) => (
      relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      && relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
    ),
    childTable: "estimate_line_items",
  }, resolvedEstimateIds);
  rows(estimatePlan.exact_match).forEach((entry) => resolvedEstimateIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  const invoicePlan = makeCorePlan("invoice", draft.invoices, cloudRowsByTable.invoices, {
    secondaryColumn: "invoice_number",
    compatible: (local, cloud) => (
      relationshipCompatible(local?.customer_legacy_local_id, cloud?.customer_id, resolvedCustomerIds)
      && relationshipCompatible(local?.project_legacy_local_id, cloud?.project_id, resolvedProjectIds)
      && relationshipCompatible(local?.source_estimate_legacy_local_id, cloud?.estimate_id || cloud?.source_estimate_id, resolvedEstimateIds)
    ),
    childTable: "invoice_line_items",
  }, resolvedInvoiceIds);
  rows(invoicePlan.exact_match).forEach((entry) => resolvedInvoiceIds.set(entry.currentLocalLegacyId, entry.cloudUuid));

  // Payment identity is financial history. The current schema and mapper do
  // not carry payment_reference, so ID drift cannot be proved safe here.
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
  paymentLocalByLegacy.forEach((payment) => {
    const parentCloudUuid = asText(resolvedInvoiceIds.get(asText(payment?.invoice_legacy_local_id)));
    const competingCloudPayments = [...paymentCloudByLegacy.values()]
      .filter((cloudPayment) => parentCloudUuid && asText(cloudPayment?.invoice_id) === parentCloudUuid);
    if (competingCloudPayments.length === 0) {
      result.localOnly.push({ entityType: "invoice_payment", currentLocalLegacyId: legacyId(payment) });
      return;
    }
    result.protectedConflicts.push({
      entityType: "invoice_payment",
      currentLocalLegacyId: legacyId(payment),
      candidateCloudUuids: competingCloudPayments.map(cloudId).filter(Boolean),
      reason: "payment_identity_not_provable",
    });
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
  });
  result.byEntity.invoice_payment = {
    exact_match: result.exactMatches.filter((entry) => entry.entityType === "invoice_payment"),
    safe_reconciliation: [],
    ambiguous: [],
    local_only: result.protectedConflicts.filter((entry) => entry.currentLocalLegacyId),
    cloud_only: result.protectedConflicts.filter((entry) => entry.oldCloudLegacyId),
    protected_conflict: result.protectedConflicts,
  };

  return result;
}

export function hasPermanentCloudIdentityConflict(plan) {
  return Boolean(
    rows(plan?.ambiguous).length
    || rows(plan?.protectedConflicts).length
  );
}
