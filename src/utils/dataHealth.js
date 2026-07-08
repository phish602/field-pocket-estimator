// @ts-nocheck
/* eslint-disable */

import { INVOICE_STATUSES, normalizeInvoiceLifecycleRecord } from "./invoiceStatus";
import { deriveInvoiceStatus } from "./invoiceStatus";

export const DATA_HEALTH_SEVERITY = Object.freeze({
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
});

export const DATA_HEALTH_CODES = Object.freeze({
  MISSING_ID: "missing_id",
  DUPLICATE_ID: "duplicate_id",
  BROKEN_PROJECT_CUSTOMER_REF: "broken_project_customer_ref",
  BROKEN_ESTIMATE_PROJECT_REF: "broken_estimate_project_ref",
  BROKEN_INVOICE_PROJECT_REF: "broken_invoice_project_ref",
  INVOICE_AMOUNT_GT_TOTAL: "invoice_amount_paid_gt_total",
  INVOICE_BALANCE_MISMATCH: "invoice_balance_mismatch",
  INVOICE_PAID_WITH_BALANCE: "invoice_paid_with_balance",
  INVOICE_VOID_WITH_AMOUNT: "invoice_void_with_amount",
  INVALID_DATE: "invalid_date",
  AUDIT_EVENT_MISSING_FIELDS: "audit_event_missing_fields",
});

function asText(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isValidDateLike(value) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return true;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function toMoney(value) {
  const next = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? Math.round(next * 100) / 100 : null;
}

function safeEntityId(entity, fallbackType, index) {
  const candidate = asText(
    entity?.id
    || entity?.projectId
    || entity?.estimateId
    || entity?.invoiceId
    || entity?.customerId
    || entity?.sourceEstimateId
  );
  return candidate || `${fallbackType}:${index}`;
}

function pushIssue(issues, issue) {
  issues.push({
    id: asText(issue?.id),
    code: asText(issue?.code),
    severity: issue?.severity || DATA_HEALTH_SEVERITY.WARNING,
    entityType: asText(issue?.entityType),
    entityId: asText(issue?.entityId),
    relatedIds: asArray(issue?.relatedIds).map((entry) => asText(entry)).filter(Boolean),
    message: asText(issue?.message),
    evidence: issue?.evidence && typeof issue.evidence === "object" ? issue.evidence : {},
  });
}

function collectEntityIssues({
  issues,
  entities,
  entityType,
  idField = "id",
  referenceChecks = [],
  dateFields = [],
}) {
  const list = asArray(entities);
  const idSeen = new Map();

  list.forEach((record, index) => {
    const entityId = safeEntityId(record, entityType, index);
    const rawId = asText(record?.[idField]);

    if (!rawId) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.MISSING_ID}:${entityType}:${index}`,
        code: DATA_HEALTH_CODES.MISSING_ID,
        severity: DATA_HEALTH_SEVERITY.ERROR,
        entityType,
        entityId,
        relatedIds: [],
        message: `${entityType} is missing a stable id.`,
        evidence: { index },
      });
    } else if (idSeen.has(rawId)) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.DUPLICATE_ID}:${entityType}:${index}`,
        code: DATA_HEALTH_CODES.DUPLICATE_ID,
        severity: DATA_HEALTH_SEVERITY.ERROR,
        entityType,
        entityId: rawId,
        relatedIds: [idSeen.get(rawId), entityId],
        message: `${entityType} id "${rawId}" appears more than once.`,
        evidence: { duplicateId: rawId, firstIndex: idSeen.get(`${rawId}:index`), duplicateIndex: index },
      });
    } else {
      idSeen.set(rawId, entityId);
      idSeen.set(`${rawId}:index`, index);
    }

    referenceChecks.forEach((check) => {
      const refValue = asText(check.getReference(record));
      if (!refValue) return;
      if (!check.hasReference(refValue)) {
        pushIssue(issues, {
          id: `${check.code}:${entityType}:${index}`,
          code: check.code,
          severity: check.severity || DATA_HEALTH_SEVERITY.WARNING,
          entityType,
          entityId: rawId || entityId,
          relatedIds: [refValue],
          message: check.message(refValue, record),
          evidence: { reference: refValue, field: check.field },
        });
      }
    });

    dateFields.forEach((field) => {
      const value = field.path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), record);
      if (!value && value !== 0) return;
      if (!isValidDateLike(value)) {
        pushIssue(issues, {
          id: `${DATA_HEALTH_CODES.INVALID_DATE}:${entityType}:${index}:${field.path}`,
          code: DATA_HEALTH_CODES.INVALID_DATE,
          severity: DATA_HEALTH_SEVERITY.WARNING,
          entityType,
          entityId: rawId || entityId,
          relatedIds: [],
          message: `${entityType} has an invalid ${field.label} value.`,
          evidence: { field: field.path, value },
        });
      }
    });
  });
}

function buildLookupMap(records = []) {
  const map = new Map();
  asArray(records).forEach((record) => {
    const id = asText(record?.id);
    if (id && !map.has(id)) map.set(id, record);
  });
  return map;
}

function buildSummary(issues, counts) {
  const summary = {
    errors: 0,
    warnings: 0,
    info: 0,
    customers: counts.customers,
    projects: counts.projects,
    estimates: counts.estimates,
    invoices: counts.invoices,
  };

  issues.forEach((issue) => {
    if (issue.severity === DATA_HEALTH_SEVERITY.ERROR) summary.errors += 1;
    else if (issue.severity === DATA_HEALTH_SEVERITY.INFO) summary.info += 1;
    else summary.warnings += 1;
  });

  return summary;
}

export function runDataHealthCheck(snapshot = {}, options = {}) {
  const source = asObject(snapshot);
  const customers = asArray(source.customers);
  const projects = asArray(source.projects);
  const estimates = asArray(source.estimates);
  const invoices = asArray(source.invoices);
  const auditEvents = asArray(source.auditEvents);
  const projectMap = buildLookupMap(projects);
  const customerMap = buildLookupMap(customers);
  const issues = [];

  collectEntityIssues({
    issues,
    entities: customers,
    entityType: "customer",
    idField: "id",
    dateFields: [
      { path: "createdAt", label: "createdAt" },
      { path: "updatedAt", label: "updatedAt" },
    ],
  });

  collectEntityIssues({
    issues,
    entities: projects,
    entityType: "project",
    idField: "id",
    referenceChecks: [{
      code: DATA_HEALTH_CODES.BROKEN_PROJECT_CUSTOMER_REF,
      field: "customerId",
      severity: DATA_HEALTH_SEVERITY.WARNING,
      getReference: (record) => record?.customerId,
      hasReference: (customerId) => customerMap.has(customerId),
      message: (customerId) => `Project references missing customer id "${customerId}".`,
    }],
    dateFields: [
      { path: "createdAt", label: "createdAt" },
      { path: "updatedAt", label: "updatedAt" },
    ],
  });

  collectEntityIssues({
    issues,
    entities: estimates,
    entityType: "estimate",
    idField: "id",
    referenceChecks: [{
      code: DATA_HEALTH_CODES.BROKEN_ESTIMATE_PROJECT_REF,
      field: "projectId",
      severity: DATA_HEALTH_SEVERITY.WARNING,
      getReference: (record) => record?.projectId,
      hasReference: (projectId) => projectMap.has(projectId),
      message: (projectId) => `Estimate references missing project id "${projectId}".`,
    }],
    dateFields: [
      { path: "createdAt", label: "createdAt" },
      { path: "updatedAt", label: "updatedAt" },
      { path: "date", label: "date" },
      { path: "dueDate", label: "dueDate" },
      { path: "job.date", label: "job.date" },
      { path: "job.due", label: "job.due" },
    ],
  });

  collectEntityIssues({
    issues,
    entities: invoices,
    entityType: "invoice",
    idField: "id",
    referenceChecks: [{
      code: DATA_HEALTH_CODES.BROKEN_INVOICE_PROJECT_REF,
      field: "projectId",
      severity: DATA_HEALTH_SEVERITY.WARNING,
      getReference: (record) => record?.projectId,
      hasReference: (projectId) => projectMap.has(projectId),
      message: (projectId) => `Invoice references missing project id "${projectId}".`,
    }],
    dateFields: [
      { path: "createdAt", label: "createdAt" },
      { path: "updatedAt", label: "updatedAt" },
      { path: "date", label: "date" },
      { path: "dueDate", label: "dueDate" },
      { path: "job.date", label: "job.date" },
      { path: "job.due", label: "job.due" },
      { path: "paidAt", label: "paidAt" },
    ],
  });

  invoices.forEach((record, index) => {
    const entityId = safeEntityId(record, "invoice", index);
    const invoiceTotal = toMoney(record?.invoiceTotal ?? record?.total);
    const amountPaid = toMoney(record?.amountPaid);
    const balanceRemaining = toMoney(record?.balanceRemaining);
    const status = asText(record?.status).toLowerCase();
    const lifecycle = normalizeInvoiceLifecycleRecord(record);
    const derivedStatus = deriveInvoiceStatus(record, options?.nowTs ?? Date.now());

    if (invoiceTotal !== null && amountPaid !== null && amountPaid > invoiceTotal + 0.005) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.INVOICE_AMOUNT_GT_TOTAL}:${entityId}`,
        code: DATA_HEALTH_CODES.INVOICE_AMOUNT_GT_TOTAL,
        severity: DATA_HEALTH_SEVERITY.ERROR,
        entityType: "invoice",
        entityId,
        relatedIds: [],
        message: "Invoice amountPaid is greater than the invoice total.",
        evidence: { invoiceTotal, amountPaid },
      });
    }

    if (invoiceTotal !== null && amountPaid !== null && balanceRemaining !== null) {
      const expectedBalance = Math.round((invoiceTotal - amountPaid) * 100) / 100;
      if (Math.abs(expectedBalance - balanceRemaining) > 0.01) {
        pushIssue(issues, {
          id: `${DATA_HEALTH_CODES.INVOICE_BALANCE_MISMATCH}:${entityId}`,
          code: DATA_HEALTH_CODES.INVOICE_BALANCE_MISMATCH,
          severity: DATA_HEALTH_SEVERITY.ERROR,
          entityType: "invoice",
          entityId,
          relatedIds: [],
          message: "Invoice balanceRemaining does not match total minus amountPaid.",
          evidence: { invoiceTotal, amountPaid, balanceRemaining, expectedBalance },
        });
      }
    }

    if ((status === INVOICE_STATUSES.PAID || lifecycle.paymentStatus === "paid") && balanceRemaining !== null && balanceRemaining > 0.005) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.INVOICE_PAID_WITH_BALANCE}:${entityId}`,
        code: DATA_HEALTH_CODES.INVOICE_PAID_WITH_BALANCE,
        severity: DATA_HEALTH_SEVERITY.ERROR,
        entityType: "invoice",
        entityId,
        relatedIds: [],
        message: "Invoice is marked paid while a balance remains.",
        evidence: { balanceRemaining, status: derivedStatus, paymentStatus: lifecycle.paymentStatus },
      });
    }

    if (status === INVOICE_STATUSES.VOID && amountPaid !== null && amountPaid > 0.005) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.INVOICE_VOID_WITH_AMOUNT}:${entityId}`,
        code: DATA_HEALTH_CODES.INVOICE_VOID_WITH_AMOUNT,
        severity: DATA_HEALTH_SEVERITY.ERROR,
        entityType: "invoice",
        entityId,
        relatedIds: [],
        message: "Void invoice still has amountPaid recorded.",
        evidence: { amountPaid },
      });
    }
  });

  auditEvents.forEach((event, index) => {
    const eventId = asText(event?.id) || `audit:${index}`;
    const missing = [];
    if (!asText(event?.id)) missing.push("id");
    if (!asText(event?.type)) missing.push("type");
    if (!isValidDateLike(event?.createdAt ?? event?.ts ?? event?.timestamp)) missing.push("createdAt");
    if (missing.length > 0) {
      pushIssue(issues, {
        id: `${DATA_HEALTH_CODES.AUDIT_EVENT_MISSING_FIELDS}:${eventId}`,
        code: DATA_HEALTH_CODES.AUDIT_EVENT_MISSING_FIELDS,
        severity: DATA_HEALTH_SEVERITY.WARNING,
        entityType: "auditEvent",
        entityId: eventId,
        relatedIds: [],
        message: `Audit event is missing required field(s): ${missing.join(", ")}.`,
        evidence: { missing },
      });
    }
  });

  const summary = buildSummary(issues, {
    customers: customers.length,
    projects: projects.length,
    estimates: estimates.length,
    invoices: invoices.length,
  });

  return {
    ok: summary.errors === 0,
    checkedAt: new Date(options?.nowTs ?? Date.now()).toISOString(),
    summary,
    issues,
  };
}
