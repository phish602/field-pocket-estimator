// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { INVOICE_STATUSES, deriveInvoiceStatus } from "./invoiceStatus";

const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = deepClone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function asText(value) {
  return String(value || "").trim();
}

function toNumber(value, fallback = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeTimestamp(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProjectStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "draft" || raw === "estimating" || raw === "active" || raw === "completed" || raw === "archived") return raw;
  if (raw === "complete") return "completed";
  if (raw === "closed" || raw === "inactive") return "archived";
  return "active";
}

const MANUAL_LIFECYCLE_STATUSES = new Set(["draft", "estimating", "completed", "archived"]);

function normalizeTextKey(value) {
  return asText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function projectSignature(source = {}) {
  const customerId = normalizeTextKey(source?.customerId);
  const customerName = normalizeTextKey(source?.customerName);
  const projectNumber = normalizeTextKey(source?.projectNumber);
  const projectName = normalizeTextKey(source?.projectName);
  const siteAddress = normalizeTextKey(source?.siteAddress);
  return [customerId || customerName, projectNumber, projectName, siteAddress].filter(Boolean).join("|");
}

function createProjectId(source = {}, options = {}) {
  const explicitId = asText(options?.id || source?.projectId);
  if (explicitId) return explicitId;
  const fingerprint = projectSignature(source)
    || normalizeTextKey(source?.customerId || source?.customerName || source?.projectName || source?.siteAddress || source?.documentId);
  if (fingerprint) return `proj_${hashText(fingerprint)}`;
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeProjectRecords(existing, incoming) {
  const base = existing && typeof existing === "object" ? existing : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const createdAt = Math.min(
    normalizeTimestamp(base.createdAt || base.savedAt || next.createdAt || next.savedAt, Date.now()),
    normalizeTimestamp(next.createdAt || next.savedAt || base.createdAt || base.savedAt, Date.now())
  ) || normalizeTimestamp(next.createdAt || base.createdAt || Date.now(), Date.now());
  const updatedAt = Math.max(
    normalizeTimestamp(base.updatedAt || base.savedAt || createdAt, createdAt),
    normalizeTimestamp(next.updatedAt || next.savedAt || createdAt, createdAt)
  );

  return normalizeProjectRecord({
    ...base,
    ...next,
    id: asText(base.id || next.id),
    customerId: asText(next.customerId || base.customerId),
    customerName: asText(next.customerName || base.customerName),
    projectNumber: asText(next.projectNumber || base.projectNumber),
    projectName: asText(next.projectName || base.projectName),
    siteAddress: asText(next.siteAddress || base.siteAddress),
    status: normalizeProjectStatus(next.status || base.status),
    notes: asText(next.notes || base.notes),
    scopeSummary: asText(next.scopeSummary || base.scopeSummary || next.notes || base.notes),
    createdAt,
    updatedAt,
  });
}

function sortProjectsByUpdatedAtDesc(a, b) {
  const bTs = normalizeTimestamp(b?.updatedAt || b?.savedAt || b?.createdAt, 0);
  const aTs = normalizeTimestamp(a?.updatedAt || a?.savedAt || a?.createdAt, 0);
  if (bTs !== aTs) return bTs - aTs;
  return asText(b?.projectName).localeCompare(asText(a?.projectName));
}

function shouldMergeProjectsBySignature(existingProject = {}, nextProject = {}) {
  const existingId = asText(existingProject?.id || existingProject?.projectId);
  const nextId = asText(nextProject?.id || nextProject?.projectId);
  if (existingId && nextId && existingId !== nextId) return false;
  return projectSignature(existingProject) === projectSignature(nextProject);
}

function createManualProjectId(existingProjects = []) {
  const existingIds = new Set(
    (Array.isArray(existingProjects) ? existingProjects : []).map((project) => asText(project?.id)).filter(Boolean)
  );
  let id = "";
  do {
    id = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  } while (existingIds.has(id));
  return id;
}

function projectSeedFromSource(source = {}) {
  const customer = source?.customer && typeof source.customer === "object" ? source.customer : {};
  return {
    documentId: asText(
      source?.documentId
      || source?.id
      || source?.estimateId
      || source?.sourceEstimateId
      || source?.estimateNumber
      || source?.invoiceNumber
    ),
    customerId: asText(source?.customerId || customer?.id),
    customerName: asText(source?.customerName || customer?.name || customer?.companyName || customer?.fullName),
    projectNumber: asText(source?.projectNumber || customer?.projectNumber),
    projectName: asText(source?.projectName || customer?.projectName),
    siteAddress: asText(
      source?.siteAddress
      || source?.projectAddress
      || customer?.projectAddress
      || customer?.address
      || source?.job?.location
    ),
    status: asText(source?.status || source?.projectStatus),
    notes: asText(source?.notes || source?.projectNotes),
    scopeSummary: asText(source?.scopeSummary || source?.scopeNotes || source?.additionalNotes || source?.notes),
    createdAt: source?.createdAt ?? source?.savedAt ?? source?.ts,
    updatedAt: source?.updatedAt ?? source?.savedAt ?? source?.ts,
  };
}

function resolveCustomer(source = {}, customerById = new Map()) {
  const customerId = asText(source?.customerId || source?.customer?.id);
  if (customerId && customerById.has(customerId)) return customerById.get(customerId);
  const customerName = normalizeTextKey(
    source?.customerName
    || source?.customer?.name
    || source?.customer?.companyName
    || source?.customer?.fullName
  );
  if (customerName) {
    const matchedByName = [...customerById.values()].find((customer) => {
      const name = normalizeTextKey(customer?.name || customer?.companyName || customer?.fullName);
      return name && name === customerName;
    });
    if (matchedByName) return matchedByName;
  }
  if (source?.customer && typeof source.customer === "object") return source.customer;
  return null;
}

function documentProjectId(source = {}, customer = null) {
  const explicitId = asText(source?.projectId);
  if (explicitId) return explicitId;
  return createProjectRecord({
    ...projectSeedFromSource({
      ...source,
      customer,
    }),
  }).id;
}

export function normalizeProjectRecord(record = {}, options = {}) {
  const source = record && typeof record === "object" ? deepClone(record) : {};
  const { projectId: _projectId, documentId: _documentId, ...rest } = source;
  const id = asText(options?.id || source?.id || source?.projectId) || createProjectId(source, options);
  const customerId = asText(source?.customerId || source?.customer?.id);
  const customerName = asText(source?.customerName || source?.customer?.name || source?.customer?.companyName || source?.customer?.fullName);
  const projectNumber = asText(source?.projectNumber || source?.customer?.projectNumber);
  const projectName = asText(source?.projectName || source?.customer?.projectName);
  const siteAddress = asText(
    source?.siteAddress
    || source?.projectAddress
    || source?.customer?.projectAddress
    || source?.customer?.address
    || source?.job?.location
  );
  const notes = asText(source?.notes || source?.projectNotes);
  const scopeSummary = asText(source?.scopeSummary || source?.scopeNotes || source?.additionalNotes || notes);
  const createdAt = normalizeTimestamp(source?.createdAt || source?.savedAt || options?.createdAt || options?.nowTs, Date.now());
  const updatedAt = normalizeTimestamp(source?.updatedAt || source?.savedAt || options?.updatedAt || options?.nowTs, createdAt);

  return {
    ...rest,
    id,
    customerId,
    customerName,
    projectNumber,
    projectName,
    siteAddress,
    status: normalizeProjectStatus(source?.status || source?.projectStatus),
    notes,
    scopeSummary,
    createdAt,
    updatedAt,
  };
}

export function createProjectRecord(source = {}, options = {}) {
  const seed = projectSeedFromSource(source);
  return normalizeProjectRecord({
    ...deepClone(source),
    id: "",
    projectId: asText(source?.projectId || options?.id),
    customerId: seed.customerId,
    customerName: seed.customerName,
    projectNumber: seed.projectNumber,
    projectName: seed.projectName,
    siteAddress: seed.siteAddress,
    status: seed.status,
    notes: seed.notes,
    scopeSummary: seed.scopeSummary,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
  }, options);
}

export function createManualProject(projects = [], source = {}, options = {}) {
  const arr = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const project = createProjectRecord(source, {
    ...options,
    id: createManualProjectId(arr),
  });
  return {
    project,
    projects: [project, ...arr].sort(sortProjectsByUpdatedAtDesc),
  };
}

function upsertProjectIntoList(projects = [], nextProject = {}) {
  const arr = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const normalized = normalizeProjectRecord(nextProject);
  const matchIndex = arr.findIndex((item) => {
    const itemId = asText(item?.id);
    return itemId === normalized.id || shouldMergeProjectsBySignature(item, normalized);
  });

  if (matchIndex < 0) {
    return [normalized, ...arr].sort(sortProjectsByUpdatedAtDesc);
  }

  const existing = arr[matchIndex];
  const merged = mergeProjectRecords(existing, {
    ...normalized,
    id: asText(existing?.id || normalized.id),
  });
  const next = arr.slice();
  next[matchIndex] = merged;
  return next.sort(sortProjectsByUpdatedAtDesc);
}

export function upsertProject(projects = [], nextProject = {}) {
  return upsertProjectIntoList(projects, nextProject);
}

export function normalizeProjectList(records = []) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  return arr.reduce((list, record) => upsertProjectIntoList(list, record), []).sort(sortProjectsByUpdatedAtDesc);
}

function readStoredCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function readStoredProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeProjectList(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function writeStoredProjects(projects) {
  const next = normalizeProjectList(projects);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  return next;
}

export function updateProjectStoredStatus(projectId, nextStatus) {
  const id = asText(projectId);
  if (!id) return null;

  const projects = readStoredProjects();
  const index = projects.findIndex((entry) => asText(entry?.id) === id);
  if (index < 0) return null;

  const existing = projects[index] && typeof projects[index] === "object" ? projects[index] : null;
  if (!existing) return null;

  const normalizedStatus = normalizeProjectStatus(nextStatus);
  const currentStatus = normalizeProjectStatus(existing.status);
  if (currentStatus === normalizedStatus) return existing;

  const updated = mergeProjectRecords(existing, {
    status: normalizedStatus,
    updatedAt: Date.now(),
  });
  const next = projects.slice();
  next[index] = updated;
  writeStoredProjects(next);
  return updated;
}

export function updateProjectMetadata(projectId, fields) {
  const id = asText(projectId);
  if (!id) return null;
  const projects = readStoredProjects();
  const index = projects.findIndex((p) => asText(p?.id) === id);
  if (index < 0) return null;
  const existing = projects[index];
  if (!existing) return null;
  const updated = mergeProjectRecords(existing, {
    ...fields,
    updatedAt: Date.now(),
  });
  const next = projects.slice();
  next[index] = updated;
  writeStoredProjects(next);
  return updated;
}

function latestTimestampForDoc(doc = {}) {
  return normalizeTimestamp(doc?.updatedAt || doc?.savedAt || doc?.createdAt || doc?.date, 0);
}

function resolveProjectForDocument(doc = {}, customer = null, options = {}) {
  const seed = projectSeedFromSource({
    ...doc,
    customer,
  });
  return createProjectRecord({
    ...seed,
    projectId: asText(doc?.projectId || options?.projectId),
  }, options);
}

export function backfillProjectCollections({
  customers = [],
  projects = [],
  estimates = [],
  invoices = [],
} = {}) {
  const customerList = Array.isArray(customers) ? customers.filter(Boolean) : [];
  const customerById = new Map(customerList.map((customer) => [asText(customer?.id), customer]));
  const projectById = new Map(normalizeProjectList(projects).map((project) => [asText(project?.id), project]));
  const projectBySignature = new Map(
    [...projectById.values()].map((project) => [projectSignature(project), project])
  );
  let changed = false;

  const upsertDerivedProject = (candidate) => {
    const normalized = normalizeProjectRecord(candidate);
    const byId = projectById.get(normalized.id);
    const bySignature = projectBySignature.get(projectSignature(normalized));
    const existing = byId || bySignature || null;
    const preserveExistingStatus = MANUAL_LIFECYCLE_STATUSES.has(normalizeProjectStatus(existing?.status));
    const merged = existing
      ? mergeProjectRecords(existing, {
        ...normalized,
        id: asText(existing?.id || normalized.id),
        status: preserveExistingStatus ? existing.status : normalized.status,
      })
      : normalized;
    if (!existing || JSON.stringify(existing) !== JSON.stringify(merged)) {
      changed = true;
    }
    projectById.set(merged.id, merged);
    projectBySignature.set(projectSignature(merged), merged);
    return merged;
  };

  const normalizeDocs = (docs, docType) => {
    const arr = Array.isArray(docs) ? docs.filter(Boolean) : [];
    return arr.map((doc) => {
      const source = doc && typeof doc === "object" ? deepClone(doc) : {};
      const customer = resolveCustomer(source, customerById);
      const project = resolveProjectForDocument(source, customer, {
        projectId: source?.projectId,
        nowTs: latestTimestampForDoc(source),
      });
      const nextProject = upsertDerivedProject(project);
      const nextDoc = {
        ...source,
        projectId: nextProject.id,
        customerId: asText(source?.customerId || nextProject.customerId),
      };
      if (JSON.stringify(nextDoc) !== JSON.stringify(source)) {
        changed = true;
      }
      return nextDoc;
    });
  };

  const nextEstimates = normalizeDocs(estimates, "estimate");
  const nextInvoices = normalizeDocs(invoices, "invoice");

  return {
    projects: normalizeProjectList([...projectById.values()]),
    estimates: nextEstimates,
    invoices: nextInvoices,
    changed,
  };
}

function sortDocsByLatestActivity(a, b) {
  const bTs = latestTimestampForDoc(b);
  const aTs = latestTimestampForDoc(a);
  if (bTs !== aTs) return bTs - aTs;
  return asText(b?.id).localeCompare(asText(a?.id));
}

function resolveDocumentProjectId(doc = {}, customer = null) {
  return documentProjectId({
    ...doc,
    customer,
  }, customer);
}

const PROJECT_DISPLAY_STATUS_LABELS = {
  draft: "Draft",
  estimating: "Estimating",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

const OPEN_ESTIMATE_STATUSES = new Set(["draft", "pending", "sent"]);
const APPROVED_ESTIMATE_STATUSES = new Set(["approved"]);
const ACTIVE_INVOICE_STATUSES = new Set([INVOICE_STATUSES.DRAFT, INVOICE_STATUSES.SENT, INVOICE_STATUSES.OVERDUE]);
const CLOSED_INVOICE_STATUSES = new Set([INVOICE_STATUSES.PAID, INVOICE_STATUSES.VOID]);

function normalizeProjectDisplayStatusKey(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "draft" || raw === "estimating" || raw === "active" || raw === "completed" || raw === "archived") return raw;
  if (raw === "complete") return "completed";
  if (raw === "closed" || raw === "inactive") return "archived";
  return raw === "archived" ? "archived" : (raw === "draft" ? "draft" : "active");
}

function normalizeDocStatusKey(doc = {}) {
  return asText(doc?.status || doc?.projectStatus).toLowerCase();
}

export function deriveProjectDisplayStatus({ project = null, estimates = [], invoices = [] } = {}) {
  const projectStatus = normalizeProjectDisplayStatusKey(project?.status || project?.projectStatus);
  if (MANUAL_LIFECYCLE_STATUSES.has(projectStatus)) {
    return {
      key: projectStatus,
      label: PROJECT_DISPLAY_STATUS_LABELS[projectStatus] || PROJECT_DISPLAY_STATUS_LABELS.draft,
    };
  }
  const estimateStatuses = Array.isArray(estimates) ? estimates.map((entry) => normalizeDocStatusKey(entry)) : [];
  const invoiceStatuses = Array.isArray(invoices) ? invoices.map((entry) => deriveInvoiceStatus(entry)) : [];

  const hasOpenEstimate = estimateStatuses.some((status) => OPEN_ESTIMATE_STATUSES.has(status));
  const hasApprovedEstimate = estimateStatuses.some((status) => APPROVED_ESTIMATE_STATUSES.has(status));
  const hasAnyInvoice = invoiceStatuses.length > 0;
  const hasPaidInvoice = invoiceStatuses.some((status) => status === INVOICE_STATUSES.PAID);
  const hasOpenInvoice = invoiceStatuses.some((status) => ACTIVE_INVOICE_STATUSES.has(status));
  const allInvoicesClosed = hasAnyInvoice && invoiceStatuses.every((status) => CLOSED_INVOICE_STATUSES.has(status));

  let key = projectStatus || "draft";

  if (hasPaidInvoice && allInvoicesClosed && !hasOpenEstimate) {
    key = "completed";
  } else if (hasOpenEstimate && !hasAnyInvoice && !hasApprovedEstimate) {
    key = "estimating";
  } else if (hasApprovedEstimate || hasOpenInvoice || (hasOpenEstimate && hasAnyInvoice)) {
    key = "active";
  } else if (projectStatus === "active") {
    key = "active";
  }

  return {
    key,
    label: PROJECT_DISPLAY_STATUS_LABELS[key] || PROJECT_DISPLAY_STATUS_LABELS.draft,
  };
}

export function buildNormalizedProjectView({
  project = null,
  projectId = "",
  projects = [],
  customers = [],
  estimates = [],
  invoices = [],
} = {}) {
  const projectList = normalizeProjectList(projects);
  const explicitProject = project && typeof project === "object" ? project : null;
  const resolvedProjectId = asText(projectId || explicitProject?.id || explicitProject?.projectId);
  const projectRecord = explicitProject && explicitProject.id
    ? (projectList.find((entry) => asText(entry?.id) === asText(explicitProject.id)) || normalizeProjectRecord(explicitProject))
    : (resolvedProjectId
      ? (projectList.find((entry) => asText(entry?.id) === resolvedProjectId) || normalizeProjectRecord({ id: resolvedProjectId }))
      : normalizeProjectRecord(explicitProject || {}));
  const customerList = Array.isArray(customers) ? customers.filter(Boolean) : [];
  const customer = customerList.find((entry) => asText(entry?.id) === asText(projectRecord.customerId))
    || customerList.find((entry) => normalizeTextKey(entry?.name || entry?.companyName || entry?.fullName) === normalizeTextKey(projectRecord.customerName))
    || (projectRecord.customerId || projectRecord.customerName ? {
      id: projectRecord.customerId,
      name: projectRecord.customerName,
      companyName: projectRecord.customerName,
      fullName: projectRecord.customerName,
    } : null);

  const filterDocsForProject = (docs) => {
    const arr = Array.isArray(docs) ? docs.filter(Boolean) : [];
    return arr
      .filter((doc) => {
        const source = doc && typeof doc === "object" ? doc : {};
        const explicitDocProjectId = asText(source?.projectId);
        if (explicitDocProjectId) return explicitDocProjectId === projectRecord.id;
        const candidate = resolveProjectForDocument(source, customer, {
          projectId: source?.projectId,
          nowTs: latestTimestampForDoc(source),
        });
        return candidate.id === projectRecord.id || projectSignature(candidate) === projectSignature(projectRecord);
      })
      .map((doc) => ({ ...doc, projectId: projectRecord.id }))
      .sort(sortDocsByLatestActivity);
  };

  const nextEstimates = filterDocsForProject(estimates);
  const nextInvoices = filterDocsForProject(invoices);
  const projectActivityTs = normalizeTimestamp(projectRecord.updatedAt || projectRecord.createdAt, 0);
  const latestActivityAt = [projectActivityTs, ...nextEstimates.map(latestTimestampForDoc), ...nextInvoices.map(latestTimestampForDoc)]
    .reduce((max, value) => Math.max(max, value || 0), 0);

  const estimateTotal = roundMoney(nextEstimates.reduce((sum, estimate) => (
    sum + roundMoney(estimate?.approvedTotal ?? estimate?.total ?? estimate?.grandTotal ?? 0)
  ), 0));
  const invoiceTotal = roundMoney(nextInvoices.reduce((sum, invoice) => (
    sum + roundMoney(invoice?.invoiceTotal ?? invoice?.total ?? 0)
  ), 0));
  const amountPaid = roundMoney(nextInvoices.reduce((sum, invoice) => (
    sum + roundMoney(invoice?.amountPaid ?? 0)
  ), 0));
  const balanceRemaining = roundMoney(nextInvoices.reduce((sum, invoice) => (
    sum + roundMoney(invoice?.balanceRemaining ?? 0)
  ), 0));

  return {
    project: projectRecord,
    customer,
    estimates: nextEstimates,
    invoices: nextInvoices,
    latestActivityAt,
    totals: {
      documentCount: nextEstimates.length + nextInvoices.length,
      estimateCount: nextEstimates.length,
      invoiceCount: nextInvoices.length,
      estimateTotal,
      invoiceTotal,
      amountPaid,
      balanceRemaining,
    },
  };
}

export function resolveProjectNavigationTarget(doc = {}, projects = []) {
  const source = doc && typeof doc === "object" ? doc : {};
  const explicitProjectId = asText(source?.projectId);
  const projectList = normalizeProjectList(projects);

  if (explicitProjectId) {
    const existingExplicitProject = projectList.find((entry) => asText(entry?.id) === explicitProjectId) || null;
    if (existingExplicitProject) {
      return {
        projectId: explicitProjectId,
        project: existingExplicitProject,
        needsBackfill: false,
      };
    }
  }

  const fallbackProject = createProjectRecord(source);
  const existing = explicitProjectId
    ? null
    : (projectList.find((entry) => (
      asText(entry?.id) === asText(fallbackProject.id)
      || shouldMergeProjectsBySignature(entry, fallbackProject)
    )) || null);

  return {
    projectId: asText(existing?.id || fallbackProject.id),
    project: existing || fallbackProject,
    needsBackfill: !existing,
  };
}

export function resolveProjectPersistenceTarget(doc = {}, projects = [], options = {}) {
  const source = doc && typeof doc === "object" ? doc : {};
  const projectList = normalizeProjectList(projects);
  const explicitProjectId = asText(source?.projectId || options?.projectId);
  const seed = projectSeedFromSource(source);
  const candidate = explicitProjectId
    ? normalizeProjectRecord({
      ...seed,
      id: explicitProjectId,
      projectId: explicitProjectId,
    }, options)
    : createProjectRecord(source, options);
  const existing = explicitProjectId
    ? projectList.find((entry) => asText(entry?.id) === explicitProjectId) || null
    : projectList.find((entry) => (
      asText(entry?.id) === asText(candidate.id)
      || projectSignature(entry) === projectSignature(candidate)
    )) || null;
  const existingStatus = normalizeProjectStatus(existing?.status);
  const candidateStatus = normalizeProjectStatus(candidate?.status);
  const shouldPreserveExistingStatus = MANUAL_LIFECYCLE_STATUSES.has(existingStatus) && candidateStatus === "active";
  const project = existing
    ? mergeProjectRecords(existing, shouldPreserveExistingStatus ? { ...candidate, status: existing.status } : candidate)
    : candidate;

  return {
    projectId: asText(existing?.id || candidate.id),
    project,
    needsBackfill: !existing,
  };
}
