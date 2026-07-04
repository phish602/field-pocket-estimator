import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import {
  extractEstimateNumber,
  repairMissingEstimateNumbers,
} from "../utils/estimateNumbers";

export const LOCAL_DATA_DECISION = Object.freeze({
  SAFE_TO_BACKUP: "safe_to_backup",
  SAFE_TO_RESTORE_EMPTY_DEVICE: "safe_to_restore_empty_device",
  NEEDS_REPAIR_BEFORE_BACKUP: "needs_repair_before_backup",
  LOCAL_CLOUD_MISMATCH: "local_cloud_mismatch",
  CLOUD_UNRESTORABLE: "cloud_unrestorable",
  PARTIAL_LOCAL_DATA: "partial_local_data",
  BACKUP_RUNNING: "backup_running",
  BACKUP_PENDING: "backup_pending",
  BACKUP_FAILED: "backup_failed",
  CLOUD_VERIFIED_CURRENT: "cloud_verified_current",
});

function asText(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => clone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = clone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function countInvoicePayments(invoices) {
  return asArray(invoices).reduce((sum, invoice) => {
    return sum + asArray(invoice?.payments).length;
  }, 0);
}

function normalizeDuplicateKey(value) {
  return asText(value).toUpperCase();
}

function collectDuplicateGroups(records, selector) {
  const groups = new Map();

  asArray(records).forEach((record, index) => {
    const raw = selector(record, index);
    const value = normalizeDuplicateKey(raw);
    if (!value) return;
    const current = groups.get(value) || [];
    current.push({
      id: asText(record?.id) || `${index}`,
      index,
      value: asText(raw),
    });
    groups.set(value, current);
  });

  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedValue, entries]) => ({
      normalizedValue,
      value: asText(entries[0]?.value),
      ids: entries.map((entry) => entry.id).filter(Boolean),
      indexes: entries.map((entry) => entry.index),
      count: entries.length,
    }));
}

function buildIssue(severity, code, message, details = {}) {
  return {
    severity,
    code: asText(code),
    message: asText(message),
    details: asObject(details),
  };
}

function addDuplicateIssues(target, groups, entityType, code, messageBuilder) {
  groups.forEach((group) => {
    target.push(buildIssue(
      "blocker",
      `${code}:${normalizeDuplicateKey(group.value)}`,
      messageBuilder(group),
      {
        entityType,
        duplicateValue: group.value,
        entityIds: group.ids,
        count: group.count,
      }
    ));
  });
}

function buildLocalIds(records) {
  return new Set(
    asArray(records)
      .map((record) => asText(record?.id))
      .filter(Boolean)
  );
}

function extractInvoiceNumber(record) {
  return asText(
    record?.invoiceNumber
    || record?.docNumber
    || record?.documentNumber
    || record?.documentNo
    || record?.number
    || record?.job?.docNumber
  );
}

function extractInvoiceSourceEstimateId(invoice) {
  return asText(
    invoice?.sourceEstimateId
    || invoice?.sourceEstimateLegacyId
    || invoice?.convertedFromEstimateId
    || invoice?.metadata?.sourceEstimateId
    || invoice?.sourceEstimateSnapshot?.estimateId
  );
}

function hasCustomerIdentity(customer) {
  return Boolean(
    asText(customer?.name)
    || asText(customer?.displayName)
    || asText(customer?.companyName)
    || asText(customer?.contactName)
    || asText(customer?.email)
    || asText(customer?.phone)
  );
}

function isMalformedMoneyField(value) {
  if (value === null || value === undefined || value === "") return false;
  const numeric = toNumericOrNull(value);
  return !Number.isFinite(numeric);
}

export function buildLocalSnapshotFromArtifact(artifact) {
  const migration = artifact?.parsedData?.migration || {};
  return {
    companyProfile: migration?.companyProfile?.parsed || null,
    customers: Array.isArray(migration?.customers?.parsed) ? migration.customers.parsed : [],
    projects: Array.isArray(migration?.projects?.parsed) ? migration.projects.parsed : [],
    estimates: Array.isArray(migration?.estimates?.parsed) ? migration.estimates.parsed : [],
    invoices: Array.isArray(migration?.invoices?.parsed) ? migration.invoices.parsed : [],
    settings: migration?.settings?.parsed || null,
    scopeTemplates: Array.isArray(migration?.scopeTemplates?.parsed) ? migration.scopeTemplates.parsed : [],
    auditEvents: Array.isArray(migration?.auditEvents?.parsed) ? migration.auditEvents.parsed : [],
  };
}

export function buildLocalSnapshotFromStorage(storageSnapshot) {
  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  return {
    artifact,
    snapshot: buildLocalSnapshotFromArtifact(artifact),
  };
}

export function scanLocalDataIntegrity(localSnapshot = {}, options = {}) {
  const source = asObject(localSnapshot);
  const customers = asArray(source.customers);
  const projects = asArray(source.projects);
  const estimates = asArray(source.estimates);
  const invoices = asArray(source.invoices);
  const scopeTemplates = asArray(source.scopeTemplates);
  const auditEvents = asArray(source.auditEvents);
  const projectIds = buildLocalIds(projects);
  const customerIds = buildLocalIds(customers);
  const estimateIds = buildLocalIds(estimates);
  const blockers = [];
  const warnings = [];
  const safeRepairs = [];
  const info = [];

  const duplicateCustomerIds = collectDuplicateGroups(customers, (entry) => entry?.id);
  const duplicateProjectIds = collectDuplicateGroups(projects, (entry) => entry?.id);
  const duplicateEstimateIds = collectDuplicateGroups(estimates, (entry) => entry?.id);
  const duplicateInvoiceIds = collectDuplicateGroups(invoices, (entry) => entry?.id);
  const duplicateEstimateNumbers = collectDuplicateGroups(estimates, (entry) => extractEstimateNumber(entry));
  const duplicateInvoiceNumbers = collectDuplicateGroups(invoices, (entry) => extractInvoiceNumber(entry));

  addDuplicateIssues(blockers, duplicateCustomerIds, "customer", "duplicate_customer_id", (group) => {
    return `Customer id "${group.value}" appears more than once locally.`;
  });
  addDuplicateIssues(blockers, duplicateProjectIds, "project", "duplicate_project_id", (group) => {
    return `Project id "${group.value}" appears more than once locally.`;
  });
  addDuplicateIssues(blockers, duplicateEstimateIds, "estimate", "duplicate_estimate_id", (group) => {
    return `Estimate id "${group.value}" appears more than once locally.`;
  });
  addDuplicateIssues(blockers, duplicateInvoiceIds, "invoice", "duplicate_invoice_id", (group) => {
    return `Invoice id "${group.value}" appears more than once locally.`;
  });
  addDuplicateIssues(blockers, duplicateEstimateNumbers, "estimate", "duplicate_estimate_number", (group) => {
    return `Estimate number "${group.value}" appears more than once locally.`;
  });
  addDuplicateIssues(blockers, duplicateInvoiceNumbers, "invoice", "duplicate_invoice_number", (group) => {
    return `Invoice number "${group.value}" appears more than once locally.`;
  });

  const estimatesMissingId = estimates.filter((entry) => !asText(entry?.id));
  const invoicesMissingId = invoices.filter((entry) => !asText(entry?.id));
  const projectsMissingId = projects.filter((entry) => !asText(entry?.id));
  const customersMissingId = customers.filter((entry) => !asText(entry?.id));

  if (customersMissingId.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "customer_id_missing",
      "One or more customers are missing stable ids.",
      { count: customersMissingId.length }
    ));
  }
  if (projectsMissingId.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "project_id_missing",
      "One or more projects are missing stable ids.",
      { count: projectsMissingId.length }
    ));
  }
  if (estimatesMissingId.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "estimate_id_missing",
      "One or more estimates are missing stable ids.",
      { count: estimatesMissingId.length }
    ));
  }
  if (invoicesMissingId.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "invoice_id_missing",
      "One or more invoices are missing stable ids.",
      { count: invoicesMissingId.length }
    ));
  }

  const projectsMissingCustomer = projects.filter((project) => {
    const customerId = asText(project?.customerId);
    return customerId && !customerIds.has(customerId);
  });
  if (projectsMissingCustomer.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "project_customer_missing",
      "One or more projects reference a customer id that is not present locally.",
      {
        entityIds: projectsMissingCustomer.map((entry) => asText(entry?.id)).filter(Boolean),
      }
    ));
  }

  const estimatesMissingProject = estimates.filter((estimate) => {
    const projectId = asText(estimate?.projectId);
    return projectId && !projectIds.has(projectId);
  });
  if (estimatesMissingProject.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "estimate_project_missing",
      "One or more estimates reference a project id that is not present locally.",
      {
        entityIds: estimatesMissingProject.map((entry) => asText(entry?.id)).filter(Boolean),
      }
    ));
  }

  const estimatesMissingCustomer = estimates.filter((estimate) => {
    const customerId = asText(estimate?.customerId);
    return customerId && !customerIds.has(customerId);
  });
  if (estimatesMissingCustomer.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "estimate_customer_missing",
      "One or more estimates reference a customer id that is not present locally.",
      {
        entityIds: estimatesMissingCustomer.map((entry) => asText(entry?.id)).filter(Boolean),
      }
    ));
  }

  const invoicesMissingProject = invoices.filter((invoice) => {
    const projectId = asText(invoice?.projectId || invoice?.project?.id);
    return projectId && !projectIds.has(projectId);
  });
  if (invoicesMissingProject.length > 0) {
    safeRepairs.push(buildIssue(
      "repairable",
      "invoice_project_stale",
      `Safe repair can detach a stale project link on ${invoicesMissingProject.length} invoice${invoicesMissingProject.length === 1 ? "" : "s"} without changing totals, payments, or visible document values.`,
      {
        entityIds: invoicesMissingProject.map((entry) => asText(entry?.id)).filter(Boolean),
        count: invoicesMissingProject.length,
      }
    ));
  }

  const invoicesMissingCustomer = invoices.filter((invoice) => {
    const customerId = asText(invoice?.customerId || invoice?.customer?.id);
    return customerId && !customerIds.has(customerId);
  });
  if (invoicesMissingCustomer.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "invoice_customer_missing",
      "One or more invoices reference a customer id that is not present locally.",
      {
        entityIds: invoicesMissingCustomer.map((entry) => asText(entry?.id)).filter(Boolean),
      }
    ));
  }

  const estimatesMissingNumbers = estimates.filter((estimate) => !extractEstimateNumber(estimate));
  if (estimatesMissingNumbers.length > 0) {
    safeRepairs.push(buildIssue(
      "repairable",
      "estimate_number_missing",
      `Safe repair can generate missing estimate numbers for ${estimatesMissingNumbers.length} estimate${estimatesMissingNumbers.length === 1 ? "" : "s"} before backup.`,
      {
        entityIds: estimatesMissingNumbers.map((entry) => asText(entry?.id)).filter(Boolean),
        count: estimatesMissingNumbers.length,
      }
    ));
  }

  const invoicesMissingNumbers = invoices.filter((invoice) => !extractInvoiceNumber(invoice));
  if (invoicesMissingNumbers.length > 0) {
    blockers.push(buildIssue(
      "blocker",
      "invoice_number_missing",
      "One or more invoices are missing invoice numbers required for backup.",
      {
        entityIds: invoicesMissingNumbers.map((entry) => asText(entry?.id)).filter(Boolean),
        count: invoicesMissingNumbers.length,
      }
    ));
  }

  const staleSourceEstimateInvoices = invoices.filter((invoice) => {
    const sourceEstimateId = extractInvoiceSourceEstimateId(invoice);
    return sourceEstimateId && !estimateIds.has(sourceEstimateId);
  });
  const emptyEstimatesWithInvoices = estimates.length === 0 && staleSourceEstimateInvoices.length > 0;

  if (emptyEstimatesWithInvoices) {
    blockers.push(buildIssue(
      "blocker",
      "empty_estimates_with_invoices",
      "This device has invoices linked to estimates, but local estimates are unexpectedly empty. Cloud backup is blocked to avoid overwriting the cloud from a partial device snapshot.",
      {
        entityIds: staleSourceEstimateInvoices.map((entry) => asText(entry?.id)).filter(Boolean),
        count: staleSourceEstimateInvoices.length,
      }
    ));
  } else if (staleSourceEstimateInvoices.length > 0) {
    safeRepairs.push(buildIssue(
      "repairable",
      "invoice_source_estimate_stale",
      `Safe repair can clear stale source estimate links on ${staleSourceEstimateInvoices.length} invoice${staleSourceEstimateInvoices.length === 1 ? "" : "s"} without changing totals, payments, or visible document values.`,
      {
        entityIds: staleSourceEstimateInvoices.map((entry) => asText(entry?.id)).filter(Boolean),
        count: staleSourceEstimateInvoices.length,
      }
    ));
  }

  const customersMissingIdentity = customers.filter((customer) => !hasCustomerIdentity(customer));
  if (customersMissingIdentity.length > 0) {
    warnings.push(buildIssue(
      "warning",
      "customer_identity_sparse",
      "Some customers are missing a display name, email, and phone.",
      {
        entityIds: customersMissingIdentity.map((entry) => asText(entry?.id)).filter(Boolean),
        count: customersMissingIdentity.length,
      }
    ));
  }

  const malformedEstimateTotals = estimates.filter((estimate) => {
    return isMalformedMoneyField(estimate?.total) || isMalformedMoneyField(estimate?.approvedTotal);
  });
  if (malformedEstimateTotals.length > 0) {
    warnings.push(buildIssue(
      "warning",
      "estimate_total_malformed",
      "Some estimates contain malformed total values.",
      {
        entityIds: malformedEstimateTotals.map((entry) => asText(entry?.id)).filter(Boolean),
        count: malformedEstimateTotals.length,
      }
    ));
  }

  const malformedInvoiceTotals = invoices.filter((invoice) => {
    return isMalformedMoneyField(invoice?.invoiceTotal)
      || isMalformedMoneyField(invoice?.total)
      || isMalformedMoneyField(invoice?.amountPaid)
      || isMalformedMoneyField(invoice?.balanceRemaining);
  });
  if (malformedInvoiceTotals.length > 0) {
    warnings.push(buildIssue(
      "warning",
      "invoice_total_malformed",
      "Some invoices contain malformed total or payment summary values.",
      {
        entityIds: malformedInvoiceTotals.map((entry) => asText(entry?.id)).filter(Boolean),
        count: malformedInvoiceTotals.length,
      }
    ));
  }

  const invoicesWithMalformedPayments = invoices.filter((invoice) => {
    return asArray(invoice?.payments).some((payment) => isMalformedMoneyField(payment?.amount));
  });
  if (invoicesWithMalformedPayments.length > 0) {
    warnings.push(buildIssue(
      "warning",
      "invoice_payment_total_malformed",
      "Some invoice payment entries contain malformed amounts.",
      {
        entityIds: invoicesWithMalformedPayments.map((entry) => asText(entry?.id)).filter(Boolean),
        count: invoicesWithMalformedPayments.length,
      }
    ));
  }

  const cloudVerification = options?.cloudVerification;
  const queueState = options?.queueState;
  const estimateVerification = asArray(cloudVerification?.tableResults).find((result) => result?.table === "estimates") || null;
  const missingRestorePayloadLegacyIds = asArray(estimateVerification?.missingRestorePayloadLegacyIds);
  if (missingRestorePayloadLegacyIds.length > 0) {
    warnings.push(buildIssue(
      "warning",
      "cloud_estimate_restore_payload_missing",
      "Cloud estimates are present but missing restore payloads needed for safe cross-device restore.",
      {
        missingLegacyIds: missingRestorePayloadLegacyIds,
        count: missingRestorePayloadLegacyIds.length,
      }
    ));
  }

  if (cloudVerification?.ok && cloudVerification?.allMatched === false) {
    warnings.push(buildIssue(
      "warning",
      "cloud_local_mismatch",
      "Cloud verification found mismatches between this device and the cloud backup.",
      {}
    ));
  }

  if (queueState?.pending) {
    info.push(buildIssue(
      "info",
      "backup_pending",
      "Local changes are pending cloud backup.",
      { updatedAt: queueState?.updatedAt || null }
    ));
  }

  const counts = {
    customers: customers.length,
    projects: projects.length,
    estimates: estimates.length,
    invoices: invoices.length,
    invoicePayments: countInvoicePayments(invoices),
    scopeTemplates: scopeTemplates.length,
    auditEvents: auditEvents.length,
  };

  const estimateMetrics = {
    total: estimates.length,
    withId: estimates.filter((entry) => asText(entry?.id)).length,
    missingId: estimatesMissingId.length,
    withDocumentNumber: estimates.filter((entry) => extractEstimateNumber(entry)).length,
    missingDocumentNumber: estimatesMissingNumbers.length,
    duplicateIds: duplicateEstimateIds,
    duplicateDocumentNumbers: duplicateEstimateNumbers,
    missingCustomerLinks: estimatesMissingCustomer.length,
    missingProjectLinks: estimatesMissingProject.length,
    malformedTotals: malformedEstimateTotals.length,
  };

  const invoiceMetrics = {
    total: invoices.length,
    withId: invoices.filter((entry) => asText(entry?.id)).length,
    missingId: invoicesMissingId.length,
    withDocumentNumber: invoices.filter((entry) => extractInvoiceNumber(entry)).length,
    missingDocumentNumber: invoicesMissingNumbers.length,
    duplicateIds: duplicateInvoiceIds,
    duplicateDocumentNumbers: duplicateInvoiceNumbers,
    missingCustomerLinks: invoicesMissingCustomer.length,
    missingProjectLinks: invoicesMissingProject.length,
    withSourceEstimateId: invoices.filter((entry) => extractInvoiceSourceEstimateId(entry)).length,
    sourceEstimateFound: invoices.filter((entry) => {
      const sourceEstimateId = extractInvoiceSourceEstimateId(entry);
      return sourceEstimateId && estimateIds.has(sourceEstimateId);
    }).length,
    sourceEstimateMissing: staleSourceEstimateInvoices.length,
    withPayments: invoices.filter((entry) => asArray(entry?.payments).length > 0).length,
    malformedPaymentTotals: invoicesWithMalformedPayments.length,
    malformedTotals: malformedInvoiceTotals.length,
  };

  const projectCustomerMetrics = {
    duplicateCustomerIds,
    duplicateProjectIds,
    projectsMissingCustomerLinks: projectsMissingCustomer.length,
    customersMissingIdentity: customersMissingIdentity.length,
  };

  return {
    counts,
    estimates: estimateMetrics,
    invoices: invoiceMetrics,
    projectCustomer: projectCustomerMetrics,
    duplicateGroups: {
      customers: duplicateCustomerIds,
      projects: duplicateProjectIds,
      estimates: duplicateEstimateIds,
      estimateNumbers: duplicateEstimateNumbers,
      invoices: duplicateInvoiceIds,
      invoiceNumbers: duplicateInvoiceNumbers,
    },
    staleReferences: {
      invoiceSourceEstimateIds: staleSourceEstimateInvoices.map((entry) => ({
        invoiceId: asText(entry?.id),
        sourceEstimateId: extractInvoiceSourceEstimateId(entry),
      })),
      invoiceProjectIds: invoicesMissingProject.map((entry) => ({
        invoiceId: asText(entry?.id),
        projectId: asText(entry?.projectId || entry?.project?.id),
      })),
    },
    blockers,
    warnings,
    safeRepairs,
    info,
    summary: {
      ...counts,
      blockersCount: blockers.length,
      warningsCount: warnings.length,
      repairsAvailableCount: safeRepairs.length,
    },
    backupReadiness: {
      blocked: blockers.length > 0,
      safe: blockers.length === 0 && safeRepairs.length === 0,
      canProceedAfterSafeRepair: blockers.length === 0 && safeRepairs.length > 0,
      firstBlocker: blockers[0] || null,
    },
    restoreReadiness: {
      blocked: blockers.length > 0,
      cloudRestorePayloadCoverageComplete: missingRestorePayloadLegacyIds.length === 0,
      firstBlocker: blockers[0] || null,
    },
  };
}

export function applySafeLocalDataRepairs(localSnapshot = {}) {
  const source = asObject(localSnapshot);
  const nextSnapshot = {
    ...source,
    customers: clone(asArray(source.customers)),
    projects: clone(asArray(source.projects)),
    estimates: clone(asArray(source.estimates)),
    invoices: clone(asArray(source.invoices)),
    scopeTemplates: clone(asArray(source.scopeTemplates)),
    auditEvents: clone(asArray(source.auditEvents)),
  };

  const estimateNumberRepair = repairMissingEstimateNumbers(nextSnapshot.estimates);
  nextSnapshot.estimates = asArray(estimateNumberRepair.estimates);
  const estimateIds = buildLocalIds(nextSnapshot.estimates);
  const projectIds = buildLocalIds(nextSnapshot.projects);
  const invoiceRepairs = [];
  const invoiceProjectRepairs = [];
  let invoicesChanged = false;

  nextSnapshot.invoices = nextSnapshot.invoices.map((invoice) => {
    const sourceEstimateId = extractInvoiceSourceEstimateId(invoice);
    const staleSourceEstimate = Boolean(sourceEstimateId) && estimateIds.size > 0 && !estimateIds.has(sourceEstimateId);
    const projectId = asText(invoice?.projectId || invoice?.project?.id);
    const staleProject = Boolean(projectId) && projectIds.size > 0 && !projectIds.has(projectId);

    if (!staleSourceEstimate && !staleProject) {
      return invoice;
    }

    invoicesChanged = true;
    const nextInvoice = clone(invoice);

    if (staleSourceEstimate) {
      const historicalEstimateNumber = asText(nextInvoice?.estimateNumber || nextInvoice?.sourceEstimateSnapshot?.estimateNumber);
      if (historicalEstimateNumber) nextInvoice.estimateNumber = historicalEstimateNumber;
      nextInvoice.sourceEstimateId = "";
      nextInvoice.sourceEstimateLegacyId = "";
      nextInvoice.convertedFromEstimateId = "";
      if (nextInvoice.metadata && typeof nextInvoice.metadata === "object") {
        nextInvoice.metadata = {
          ...nextInvoice.metadata,
          sourceEstimateId: "",
        };
      }
      nextInvoice.sourceEstimateSnapshot = null;
      invoiceRepairs.push({
        invoiceId: asText(nextInvoice?.id),
        staleSourceEstimateId: sourceEstimateId,
        preservedEstimateNumber: historicalEstimateNumber,
      });
    }

    if (staleProject) {
      nextInvoice.projectId = "";
      if (nextInvoice.project && typeof nextInvoice.project === "object") {
        nextInvoice.project = { ...nextInvoice.project, id: "" };
      }
      invoiceProjectRepairs.push({
        invoiceId: asText(nextInvoice?.id),
        staleProjectId: projectId,
      });
    }

    return nextInvoice;
  });

  return {
    changed: Boolean(estimateNumberRepair.changed || invoicesChanged),
    snapshot: nextSnapshot,
    repairs: {
      estimateNumbers: asArray(estimateNumberRepair.repairs),
      staleInvoiceSourceEstimateIds: invoiceRepairs,
      staleInvoiceProjectIds: invoiceProjectRepairs,
    },
  };
}

function emitStorageChangeEvent(key, value) {
  try {
    window.dispatchEvent(new CustomEvent("pe-localstorage", {
      detail: { key, value },
    }));
  } catch {}
}

export function repairStoredLocalDataIntegrity(storageSnapshot) {
  const { snapshot } = buildLocalSnapshotFromStorage(storageSnapshot);
  const repaired = applySafeLocalDataRepairs(snapshot);

  if (
    repaired.changed
    && storageSnapshot
    && typeof storageSnapshot.setItem === "function"
  ) {
    const estimateValue = JSON.stringify(asArray(repaired.snapshot.estimates));
    const invoiceValue = JSON.stringify(asArray(repaired.snapshot.invoices));
    storageSnapshot.setItem(STORAGE_KEYS.ESTIMATES, estimateValue);
    storageSnapshot.setItem(STORAGE_KEYS.INVOICES, invoiceValue);
    emitStorageChangeEvent(STORAGE_KEYS.ESTIMATES, estimateValue);
    emitStorageChangeEvent(STORAGE_KEYS.INVOICES, invoiceValue);
    try {
      if (repaired.repairs.estimateNumbers.length > 0) {
        window.dispatchEvent(new Event("estipaid:estimates-changed"));
      }
      if (
        repaired.repairs.staleInvoiceSourceEstimateIds.length > 0
        || repaired.repairs.staleInvoiceProjectIds.length > 0
      ) {
        window.dispatchEvent(new Event("estipaid:invoices-changed"));
      }
    } catch {}
  }

  const integrity = scanLocalDataIntegrity(repaired.snapshot);

  return {
    ...repaired,
    integrity,
  };
}

export function buildIntegrityNotices(integrity, options = {}) {
  const includeInfo = Boolean(options?.includeInfo);
  const notices = [];

  asArray(integrity?.blockers).forEach((issue) => {
    notices.push({
      level: "error",
      code: asText(issue?.code),
      message: asText(issue?.message),
      details: asObject(issue?.details),
    });
  });
  asArray(integrity?.warnings).forEach((issue) => {
    notices.push({
      level: "warning",
      code: asText(issue?.code),
      message: asText(issue?.message),
      details: asObject(issue?.details),
    });
  });
  asArray(integrity?.safeRepairs).forEach((issue) => {
    notices.push({
      level: "warning",
      code: asText(issue?.code),
      message: asText(issue?.message),
      details: asObject(issue?.details),
    });
  });
  if (includeInfo) {
    asArray(integrity?.info).forEach((issue) => {
      notices.push({
        level: "info",
        code: asText(issue?.code),
        message: asText(issue?.message),
        details: asObject(issue?.details),
      });
    });
  }

  return notices;
}

export function getCloudDataDecision({
  localIntegrity = null,
  cloudVerification = null,
  queueState = null,
  onboardingStatus = null,
  restorePreview = null,
  workerRunning = false,
  restoredRecently = false,
} = {}) {
  const onboardingState = asText(onboardingStatus?.status);
  const firstBlocker = localIntegrity?.blockers?.[0] || null;
  const firstSafeRepair = localIntegrity?.safeRepairs?.[0] || null;
  const queuePending = Boolean(queueState?.pending);
  const queueFailed = asText(queueState?.status).toLowerCase() === "failed";
  const mismatch = onboardingState === "local_cloud_mismatch"
    || Boolean(cloudVerification?.ok && cloudVerification?.allMatched === false);
  // Rows the cloud has that this device does not (e.g. a cloud-only
  // estimate) are not fatal corruption -- they just mean the normal upsert
  // backup can't silently proceed, so the user gets an explicit choice
  // between restoring cloud data down or deliberately replacing the cloud
  // backup with this device's snapshot.
  const cloudOnlyRowsDetected = asArray(cloudVerification?.tableResults)
    .some((result) => asArray(result?.extraLegacyIds).length > 0);
  // A resolvable mismatch isn't limited to detected cloud-only rows -- a
  // generic verification mismatch (e.g. "Cloud verification found
  // mismatches between local and Supabase data") is just as resolvable via
  // restore or replace as long as local integrity itself is clean. Gating
  // this on cloudOnlyRowsDetected specifically left the generic case with no
  // actions at all. empty_estimates_with_invoices (the partial-local-data
  // danger state) is itself one of the entries in localIntegrity.blockers,
  // so !firstBlocker already rules it out -- no separate check is needed.
  const replaceCloudAvailable = mismatch && !firstBlocker;
  const restoreCloudAvailable = mismatch;
  const restoreAvailable = onboardingState === "cloud_available_empty_device"
    && restorePreview?.eligible !== false
    && !restorePreview?.partial;
  const cloudUnrestorable = onboardingState === "cloud_available_empty_device"
    && Boolean(restorePreview?.partial || asText(restorePreview?.status) === "blocked_unsupported_shape");
  const partialLocalData = asArray(localIntegrity?.blockers).some((issue) => issue?.code === "empty_estimates_with_invoices");
  const verifiedCurrent = (onboardingState === "already_backed_up" || onboardingState === "backup_completed")
    && !firstBlocker
    && !firstSafeRepair
    && !mismatch
    && !cloudUnrestorable;

  let screenState = null;
  if (partialLocalData) {
    screenState = LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA;
  } else if (firstBlocker || firstSafeRepair) {
    screenState = LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP;
  } else if (cloudUnrestorable) {
    screenState = LOCAL_DATA_DECISION.CLOUD_UNRESTORABLE;
  } else if (mismatch) {
    // A resolvable data mismatch (verification ran and reported a
    // difference) must win over a generic "needs_attention"/"error"/
    // queue-failed label -- otherwise a clean-local-integrity mismatch (e.g.
    // the writer's own post-write verification came back not-matching)
    // renders as a dead-end "Cloud backup needs attention" with no restore
    // or replace action, instead of the resolvable mismatch choice card.
    screenState = LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH;
  } else if (onboardingState === "error" || onboardingState === "needs_attention" || queueFailed) {
    screenState = LOCAL_DATA_DECISION.BACKUP_FAILED;
  } else if (workerRunning) {
    screenState = LOCAL_DATA_DECISION.BACKUP_RUNNING;
  } else if (queuePending) {
    screenState = LOCAL_DATA_DECISION.BACKUP_PENDING;
  } else if (restoreAvailable) {
    screenState = LOCAL_DATA_DECISION.SAFE_TO_RESTORE_EMPTY_DEVICE;
  } else if (verifiedCurrent) {
    screenState = LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT;
  } else if (onboardingState === "ready_to_backup") {
    screenState = LOCAL_DATA_DECISION.SAFE_TO_BACKUP;
  }

  let chipState = null;
  if (workerRunning) {
    chipState = LOCAL_DATA_DECISION.BACKUP_RUNNING;
  } else if (firstBlocker || firstSafeRepair || cloudUnrestorable) {
    // A concrete local blocker or repairable issue must surface even if a
    // backup is queued -- otherwise the chip stays stuck on "Pending" while
    // Advanced Settings shows a real blocker underneath it.
    chipState = LOCAL_DATA_DECISION.BACKUP_FAILED;
  } else if (mismatch) {
    // A resolvable mismatch (verification ran fine, local integrity is
    // clean) must win over a generic queue-failed/needs_attention/error
    // label -- otherwise the chip says "Backup issue" with no path forward
    // instead of "Data mismatch" pointing at the restore/replace choice in
    // Advanced Settings.
    chipState = LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH;
  } else if (queueFailed || onboardingState === "error" || onboardingState === "needs_attention") {
    chipState = LOCAL_DATA_DECISION.BACKUP_FAILED;
  } else if (queuePending) {
    chipState = LOCAL_DATA_DECISION.BACKUP_PENDING;
  } else if (restoreAvailable) {
    chipState = LOCAL_DATA_DECISION.SAFE_TO_RESTORE_EMPTY_DEVICE;
  } else if (restoredRecently) {
    chipState = "restored";
  } else if (verifiedCurrent) {
    chipState = LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT;
  }

  const chipAction = chipState === LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH
    || chipState === LOCAL_DATA_DECISION.BACKUP_FAILED
      ? "open_settings"
      : chipState === LOCAL_DATA_DECISION.SAFE_TO_RESTORE_EMPTY_DEVICE
        ? "open_restore"
        : "none";

  return {
    screenState,
    chipState,
    chipAction,
    firstBlocker,
    firstSafeRepair,
    mismatch,
    cloudOnlyRowsDetected,
    replaceCloudAvailable,
    restoreCloudAvailable,
    restoreAvailable,
    cloudUnrestorable,
    partialLocalData,
    verifiedCurrent,
    safeRepairsAvailable: asArray(localIntegrity?.safeRepairs).length > 0,
    blockersCount: Number(localIntegrity?.summary?.blockersCount || 0),
    warningsCount: Number(localIntegrity?.summary?.warningsCount || 0),
    repairsAvailableCount: Number(localIntegrity?.summary?.repairsAvailableCount || 0),
    lastSuccessfulBackupAt: queueState?.lastSuccessfulBackupAt || null,
  };
}
