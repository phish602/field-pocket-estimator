// @ts-nocheck
/* eslint-disable */

import { deriveInvoiceStatus, normalizeInvoiceRecord } from "./invoices";
import { deriveProjectDisplayStatus, normalizeProjectRecord } from "./projects";
import { createSupportId, normalizeAuditEvent } from "./auditLog";
import { runDataHealthCheck } from "./dataHealth";

const DEFAULT_BUNDLE_SCHEMA_VERSION = "1.0.0";
const DEFAULT_REDACTED_VALUE = "[redacted]";

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

function toTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clonePlain(value) {
  if (Array.isArray(value)) return value.map((entry) => clonePlain(entry));
  if (value && typeof value === "object") {
    const next = {};
    Object.keys(value).forEach((key) => {
      next[key] = clonePlain(value[key]);
    });
    return next;
  }
  return value;
}

function isSensitiveKey(key) {
  return /(email|phone|address|street|notes|scopeNotes|internalNotes)/i.test(String(key || ""));
}

function redactValue(value, includeSensitive) {
  if (includeSensitive) return clonePlain(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, false));
  if (value && typeof value === "object") {
    const next = {};
    Object.keys(value).forEach((key) => {
      if (isSensitiveKey(key)) {
        next[key] = DEFAULT_REDACTED_VALUE;
      } else {
        next[key] = redactValue(value[key], false);
      }
    });
    return next;
  }
  return value;
}

function collectIds(records = []) {
  return asArray(records)
    .map((record) => asText(record?.id))
    .filter(Boolean);
}

function mapById(records = []) {
  const map = new Map();
  asArray(records).forEach((record) => {
    const id = asText(record?.id);
    if (id && !map.has(id)) map.set(id, record);
  });
  return map;
}

function summarizeInvoices(invoices = []) {
  const normalized = asArray(invoices).map((invoice) => normalizeInvoiceRecord(invoice));
  const totals = normalized.reduce((acc, invoice) => {
    const status = deriveInvoiceStatus(invoice);
    acc.count += 1;
    acc.totalInvoiceTotal += Number(invoice?.invoiceTotal || 0);
    acc.totalAmountPaid += Number(invoice?.amountPaid || 0);
    acc.totalBalanceRemaining += Number(invoice?.balanceRemaining || 0);
    acc.byStatus[status] = (acc.byStatus[status] || 0) + 1;
    acc.byPaymentStatus[invoice?.paymentStatus || "unpaid"] = (acc.byPaymentStatus[invoice?.paymentStatus || "unpaid"] || 0) + 1;
    return acc;
  }, {
    count: 0,
    totalInvoiceTotal: 0,
    totalAmountPaid: 0,
    totalBalanceRemaining: 0,
    byStatus: {},
    byPaymentStatus: {},
  });

  return {
    ...totals,
    items: normalized.map((invoice) => ({
      id: asText(invoice?.id),
      invoiceNumber: asText(invoice?.invoiceNumber),
      projectId: asText(invoice?.projectId),
      status: deriveInvoiceStatus(invoice),
      paymentStatus: asText(invoice?.paymentStatus),
      invoiceTotal: Number(invoice?.invoiceTotal || 0),
      amountPaid: Number(invoice?.amountPaid || 0),
      balanceRemaining: Number(invoice?.balanceRemaining || 0),
      dueDate: asText(invoice?.dueDate),
    })),
  };
}

function buildIntegrityGraph(snapshot = {}) {
  const customers = asArray(snapshot.customers);
  const projects = asArray(snapshot.projects);
  const estimates = asArray(snapshot.estimates);
  const invoices = asArray(snapshot.invoices);

  const projectById = mapById(projects);
  const customerById = mapById(customers);

  const customerToProjects = customers.map((customer) => {
    const customerId = asText(customer?.id);
    const projectIds = projects
      .filter((project) => asText(project?.customerId) === customerId)
      .map((project) => asText(project?.id))
      .filter(Boolean);
    return { customerId, projectIds };
  }).filter((entry) => entry.customerId || entry.projectIds.length > 0);

  const projectToEstimates = projects.map((project) => {
    const projectId = asText(project?.id);
    const estimateIds = estimates
      .filter((estimate) => asText(estimate?.projectId) === projectId)
      .map((estimate) => asText(estimate?.id))
      .filter(Boolean);
    return { projectId, estimateIds };
  }).filter((entry) => entry.projectId || entry.estimateIds.length > 0);

  const projectToInvoices = projects.map((project) => {
    const projectId = asText(project?.id);
    const invoiceIds = invoices
      .filter((invoice) => asText(invoice?.projectId) === projectId)
      .map((invoice) => asText(invoice?.id))
      .filter(Boolean);
    return { projectId, invoiceIds };
  }).filter((entry) => entry.projectId || entry.invoiceIds.length > 0);

  const orphanProjects = projects
    .filter((project) => {
      const customerId = asText(project?.customerId);
      return !customerId || !customerById.has(customerId);
    })
    .map((project) => asText(project?.id))
    .filter(Boolean);

  const orphanEstimates = estimates
    .filter((estimate) => {
      const projectId = asText(estimate?.projectId);
      return !projectId || !projectById.has(projectId);
    })
    .map((estimate) => asText(estimate?.id))
    .filter(Boolean);

  const orphanInvoices = invoices
    .filter((invoice) => {
      const projectId = asText(invoice?.projectId);
      return !projectId || !projectById.has(projectId);
    })
    .map((invoice) => asText(invoice?.id))
    .filter(Boolean);

  return {
    customerToProjects,
    projectToEstimates,
    projectToInvoices,
    orphanProjects,
    orphanEstimates,
    orphanInvoices,
  };
}

function buildStatusSnapshots(snapshot = {}, options = {}) {
  const projects = asArray(snapshot.projects).map((project) => {
    const normalized = normalizeProjectRecord(project);
    const estimates = asArray(snapshot.estimates).filter((estimate) => asText(estimate?.projectId) === asText(normalized?.id));
    const invoices = asArray(snapshot.invoices).filter((invoice) => asText(invoice?.projectId) === asText(normalized?.id));
    const derived = deriveProjectDisplayStatus({ project: normalized, estimates, invoices });
    return {
      id: asText(normalized?.id),
      customerId: asText(normalized?.customerId),
      status: asText(normalized?.status),
      derivedStatus: derived?.key || "",
      derivedLabel: derived?.label || "",
      estimateCount: estimates.length,
      invoiceCount: invoices.length,
    };
  });

  const estimates = asArray(snapshot.estimates).map((estimate) => ({
    id: asText(estimate?.id),
    projectId: asText(estimate?.projectId),
    status: asText(estimate?.status),
    customerId: asText(estimate?.customerId),
  }));

  const invoices = asArray(snapshot.invoices).map((invoice) => ({
    id: asText(invoice?.id),
    projectId: asText(invoice?.projectId),
    status: deriveInvoiceStatus(invoice, options?.nowTs ?? Date.now()),
    paymentStatus: asText(invoice?.paymentStatus),
    amountPaid: Number(invoice?.amountPaid || 0),
    balanceRemaining: Number(invoice?.balanceRemaining || 0),
    invoiceTotal: Number(invoice?.invoiceTotal || 0),
    dueDate: asText(invoice?.dueDate),
  }));

  return { projects, estimates, invoices };
}

function buildSourceSnapshots(snapshot = {}, includeSensitive = false) {
  return redactDiagnosticSnapshot({
    companyProfile: snapshot.companyProfile || null,
    customers: snapshot.customers || [],
    projects: snapshot.projects || [],
    estimates: snapshot.estimates || [],
    invoices: snapshot.invoices || [],
    settings: snapshot.settings || null,
    scopeTemplates: snapshot.scopeTemplates || [],
    auditEvents: snapshot.auditEvents || [],
  }, { includeSensitive });
}

export function redactDiagnosticSnapshot(snapshot, options = {}) {
  const includeSensitive = options?.includeSensitive === true;
  return redactValue(snapshot, includeSensitive);
}

export function createDiagnosticBundleMeta(options = {}) {
  const nowTs = toTimestamp(options?.generatedAt ?? options?.nowTs, Date.now());
  return {
    supportId: asText(options?.supportId) || createSupportId(options?.supportPrefix || "SUP", {
      nowTs,
      randomValue: options?.randomValue,
      seed: options?.routeContext || options?.appVersion || "bundle",
    }),
    generatedAt: new Date(nowTs).toISOString(),
    bundleSchemaVersion: asText(options?.bundleSchemaVersion, DEFAULT_BUNDLE_SCHEMA_VERSION),
    appVersion: asText(options?.appVersion),
    routeContext: asText(options?.routeContext),
  };
}

export function buildDiagnosticBundle(snapshot = {}, options = {}) {
  const source = asObject(snapshot);
  const health = runDataHealthCheck(source, options);
  const bundleMeta = createDiagnosticBundleMeta(options);
  const includeSensitive = options?.includeSensitive === true;
  const recentEvents = asArray(source.auditEvents)
    .map((event) => normalizeAuditEvent(event))
    .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
    .slice(0, options?.recentEventLimit ?? 25);

  return {
    bundleMeta,
    healthSummary: {
      ...health.summary,
      ok: health.ok,
      issueCount: health.issues.length,
    },
    recordInventory: {
      companyProfile: source.companyProfile ? { count: 1, ids: [asText(source.companyProfile?.id)] } : { count: 0, ids: [] },
      customers: { count: asArray(source.customers).length, ids: collectIds(source.customers) },
      projects: { count: asArray(source.projects).length, ids: collectIds(source.projects) },
      estimates: { count: asArray(source.estimates).length, ids: collectIds(source.estimates) },
      invoices: { count: asArray(source.invoices).length, ids: collectIds(source.invoices) },
      scopeTemplates: { count: asArray(source.scopeTemplates).length, ids: collectIds(source.scopeTemplates) },
      auditEvents: { count: asArray(source.auditEvents).length, ids: collectIds(source.auditEvents) },
    },
    integrityGraph: buildIntegrityGraph(source),
    statusSnapshots: buildStatusSnapshots(source, options),
    paymentEvidence: summarizeInvoices(source.invoices || []),
    recentEvents,
    sourceSnapshots: buildSourceSnapshots(source, includeSensitive),
    migrationNotes: {
      readyForBackendMigration: false,
      schemaVersion: DEFAULT_BUNDLE_SCHEMA_VERSION,
      notes: [
        "Bundle is read-only and derived from the current local snapshot.",
        "Use this as the canonical support artifact before backend migration work.",
        "Safe repair actions should be previewed against this bundle first.",
      ],
    },
  };
}
