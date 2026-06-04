// @ts-nocheck
/* eslint-disable */

export const BACKEND_MAPPING_VERSION = "backend-mapping-v1";

const BACKEND_SOURCE = "local_storage_export";
const EPSILON = 0.005;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  return String(value ?? "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clonePlain(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => clonePlain(entry));
    if (isPlainObject(value)) {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = clonePlain(value[key]);
      });
      return next;
    }
    return value;
  }
}

function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    try {
      return new Date(value).toISOString();
    } catch {
      return "";
    }
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    try {
      return new Date(numeric).toISOString();
    } catch {
      return "";
    }
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  try {
    return new Date(parsed).toISOString();
  } catch {
    return "";
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const next = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : null;
}

function pickText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function normalizeContextValue(value) {
  return asText(value);
}

function normalizeCustomerType(customer = {}) {
  const inferred = asText(customer?.type || (customer?.companyName ? "commercial" : "residential")).toLowerCase();
  return inferred === "commercial" ? "commercial" : "residential";
}

function normalizeProjectStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "draft" || raw === "estimating" || raw === "active" || raw === "completed" || raw === "archived") return raw;
  if (raw === "complete") return "completed";
  if (raw === "closed" || raw === "inactive") return "archived";
  return raw || "active";
}

function normalizeEstimateStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "draft" || raw === "pending" || raw === "approved" || raw === "sent" || raw === "lost") return raw;
  return raw || "pending";
}

function normalizeInvoiceStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "draft" || raw === "sent" || raw === "overdue" || raw === "paid" || raw === "void") return raw;
  return raw || "draft";
}

function normalizePaymentStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === "unpaid" || raw === "partial" || raw === "paid" || raw === "void") return raw;
  return raw || "unpaid";
}

function createBackendRecordIdFallback(context) {
  return asText(context?.companyId || "");
}

function buildLegacyLocalId(record) {
  return asText(record?.id || record?.legacy_local_id || record?.legacyLocalId || "");
}

function buildAuditEventLegacyId(event) {
  return buildLegacyLocalId(event);
}

function mapCommonTimelineFields(source = {}) {
  return {
    created_at: toIsoTimestamp(source?.createdAt || source?.savedAt || source?.ts || ""),
    updated_at: toIsoTimestamp(source?.updatedAt || source?.savedAt || source?.ts || ""),
  };
}

function getLocalSnapshotLists(snapshot = {}) {
  return {
    companyProfile: isPlainObject(snapshot?.companyProfile) ? snapshot.companyProfile : null,
    customers: asArray(snapshot?.customers),
    projects: asArray(snapshot?.projects),
    estimates: asArray(snapshot?.estimates),
    invoices: asArray(snapshot?.invoices),
    settings: isPlainObject(snapshot?.settings) ? snapshot.settings : null,
    scopeTemplates: asArray(snapshot?.scopeTemplates),
    auditEvents: asArray(snapshot?.auditEvents),
  };
}

function collectLocalIds(records = []) {
  return asArray(records).map((record) => asText(record?.id)).filter(Boolean);
}

function collectDuplicateValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

function buildWarning(code, severity, entityType, entityId, message, evidence = {}) {
  return {
    code,
    severity,
    entityType,
    entityId: asText(entityId),
    message,
    evidence: isPlainObject(evidence) ? evidence : {},
  };
}

function extractEstimateNumber(record = {}) {
  return pickText(
    record?.estimateNumber,
    record?.docNumber,
    record?.documentNumber,
    record?.documentNo,
    record?.number,
    record?.job?.docNumber
  );
}

function extractInvoiceNumber(record = {}) {
  return pickText(
    record?.invoiceNumber,
    record?.docNumber,
    record?.documentNumber,
    record?.documentNo,
    record?.number,
    record?.job?.docNumber
  );
}

function extractProjectNumber(record = {}) {
  return pickText(record?.projectNumber, record?.customer?.projectNumber);
}

function extractDocumentLineItems(record = {}, kind = "") {
  const items = [];
  const laborLines = Array.isArray(record?.labor?.lines) ? record.labor.lines : (Array.isArray(record?.laborLines) ? record.laborLines : []);
  const materialItems = Array.isArray(record?.materials?.items) ? record.materials.items : (Array.isArray(record?.materialItems) ? record.materialItems : []);
  const genericItems = Array.isArray(record?.lineItems) ? record.lineItems : (Array.isArray(record?.items) ? record.items : []);

  const mapItem = (item = {}, itemKind = "", index = 0) => {
    const mapped = {
      kind: itemKind || kind || "line_item",
      legacy_local_id: buildLegacyLocalId(item),
      description: pickText(item?.description, item?.name, item?.title, item?.label, item?.notes, item?.text),
      quantity: toNumberOrNull(item?.quantity ?? item?.qty ?? item?.count),
      unit_price: toNumberOrNull(item?.unitPrice ?? item?.rate ?? item?.price),
      unit_cost: toNumberOrNull(item?.unitCost ?? item?.cost ?? item?.costInternal ?? item?.internalCost ?? item?.trueRateInternal),
      total: toNumberOrNull(item?.total ?? item?.amount),
      sort_order: index,
    };
    Object.keys(mapped).forEach((key) => {
      if (mapped[key] === null || mapped[key] === "" || mapped[key] === undefined) delete mapped[key];
    });
    if (Object.keys(mapped).length === 0) return null;
    return mapped;
  };

  laborLines.forEach((item, index) => {
    const mapped = mapItem(item, "labor", index);
    if (mapped) items.push(mapped);
  });
  materialItems.forEach((item, index) => {
    const mapped = mapItem(item, "material", index);
    if (mapped) items.push(mapped);
  });
  genericItems.forEach((item, index) => {
    const mapped = mapItem(item, kind || "line_item", index);
    if (mapped) items.push(mapped);
  });

  return items;
}

function mapEstimateFinancialFields(estimate = {}) {
  const financials = isPlainObject(estimate?.financials) ? estimate.financials : {};
  const totals = isPlainObject(estimate?.totals) ? estimate.totals : {};
  const summary = isPlainObject(estimate?.summary) ? estimate.summary : {};
  const out = {};

  const fields = [
    ["approved_total", estimate?.approvedTotal ?? financials?.approvedTotal ?? totals?.approvedTotal ?? summary?.total],
    ["total_revenue", estimate?.totalRevenue ?? financials?.totalRevenue ?? totals?.totalRevenue],
    ["grand_total", estimate?.grandTotal ?? financials?.grandTotal ?? totals?.grandTotal],
    ["total", estimate?.total ?? financials?.total ?? totals?.total ?? summary?.total],
    ["total_cost", estimate?.totalCost ?? financials?.totalCost ?? totals?.totalCost ?? summary?.totalCost],
    ["internal_cost", estimate?.internalCost ?? financials?.internalCost ?? totals?.internalCost],
    ["gross_profit", estimate?.grossProfit ?? financials?.grossProfit ?? totals?.grossProfit ?? summary?.grossProfit],
    ["gross_margin", estimate?.grossMargin ?? financials?.grossMargin ?? totals?.grossMargin],
    ["gross_margin_pct", estimate?.grossMarginPct ?? financials?.grossMarginPct ?? totals?.grossMarginPct],
    ["gross_profit_margin", estimate?.grossProfitMargin ?? financials?.grossProfitMargin ?? totals?.grossProfitMargin],
    ["margin", estimate?.margin ?? financials?.margin ?? totals?.margin],
    ["margin_pct", estimate?.marginPct ?? financials?.marginPct ?? totals?.marginPct],
    ["margin_percent", estimate?.marginPercent ?? financials?.marginPercent ?? totals?.marginPercent],
    ["labor_revenue", estimate?.laborRevenue ?? financials?.laborRevenue ?? totals?.laborRevenue],
    ["labor_cost", estimate?.laborCost ?? financials?.laborCost ?? totals?.laborCost],
    ["materials_revenue", estimate?.materialsRevenue ?? financials?.materialsRevenue ?? totals?.materialsRevenue],
    ["materials_cost", estimate?.materialsCost ?? financials?.materialsCost ?? totals?.materialsCost],
  ];

  fields.forEach(([key, value]) => {
    const next = toNumberOrNull(value);
    if (next !== null) out[key] = next;
  });

  return out;
}

function mapLocalAuditEventToBackendAuditEvent(event = {}, context) {
  const source = isPlainObject(event) ? event : {};
  const mapped = {
    company_id: context?.companyId || "",
    legacy_local_id: buildAuditEventLegacyId(source),
    type: asText(source?.type),
    actor_id: asText(source?.actorId),
    actor_role: asText(source?.actorRole),
    target_type: asText(source?.targetType),
    target_id: asText(source?.targetId),
    related_ids: asArray(source?.relatedIds).map((entry) => asText(entry)).filter(Boolean),
    source: asText(source?.source),
    reason: asText(source?.reason),
    before_hash: asText(source?.beforeHash),
    after_hash: asText(source?.afterHash),
    created_at: toIsoTimestamp(source?.createdAt),
    metadata: isPlainObject(source?.metadata) ? clonePlain(source.metadata) : {},
  };

  Object.keys(mapped).forEach((key) => {
    if (key === "related_ids" || key === "metadata") return;
    if (mapped[key] === "") delete mapped[key];
  });

  if (!Array.isArray(mapped.related_ids) || mapped.related_ids.length === 0) delete mapped.related_ids;
  if (!isPlainObject(mapped.metadata) || Object.keys(mapped.metadata).length === 0) delete mapped.metadata;

  return mapped;
}

export function createBackendMappingContext(options = {}) {
  return {
    mappingVersion: BACKEND_MAPPING_VERSION,
    companyId: normalizeContextValue(options?.companyId),
    userId: normalizeContextValue(options?.userId),
    generatedAt: normalizeContextValue(options?.generatedAt) || new Date().toISOString(),
    source: BACKEND_SOURCE,
    warnings: [],
  };
}

export function mapLocalCompanyProfileToBackendCompany(companyProfile, context) {
  const source = isPlainObject(companyProfile) ? companyProfile : {};
  const hasSourceFields = Object.keys(source).length > 0;
  if (!hasSourceFields && !asText(context?.companyId)) return null;

  const companyName = pickText(source?.companyName, source?.name, source?.fullName, source?.displayName);
  const mapped = {
    id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    company_name: companyName,
    display_name: companyName,
    phone: pickText(source?.phone, source?.comPhone, source?.resPhone),
    email: pickText(source?.email, source?.comEmail, source?.resEmail),
    address: pickText(source?.address),
    stripe_account_id: pickText(source?.stripeAccountId),
    created_by: asText(context?.userId),
    updated_by: asText(context?.userId),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (mapped[key] === "") delete mapped[key];
  });

  return mapped;
}

export function mapLocalCustomerToBackendCustomer(customer, context) {
  const source = isPlainObject(customer) ? customer : {};
  const customerType = normalizeCustomerType(source);
  const companyName = pickText(source?.companyName, customerType === "commercial" ? source?.name : "", source?.fullName);
  const displayName = customerType === "commercial"
    ? pickText(companyName, source?.name, source?.fullName)
    : pickText(source?.fullName, source?.name, companyName);
  const mapped = {
    company_id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    display_name: displayName,
    company_name: companyName,
    contact_name: pickText(source?.contactName, source?.attn, source?.contact, source?.fullName),
    phone: pickText(source?.phone, source?.comPhone, source?.resPhone),
    email: pickText(source?.email, source?.comEmail, source?.resEmail),
    address: pickText(source?.address),
    billing_address: pickText(source?.billingAddress),
    customer_type: customerType,
    status: pickText(source?.status),
    net_terms_type: pickText(source?.netTermsType),
    net_terms_days: toNumberOrNull(source?.netTermsDays),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalProjectToBackendProject(project, context) {
  const source = isPlainObject(project) ? project : {};
  const mapped = {
    company_id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    customer_legacy_local_id: asText(source?.customerId || source?.customer?.id),
    project_number: extractProjectNumber(source),
    project_name: pickText(source?.projectName, source?.name, source?.customer?.projectName),
    site_address: pickText(source?.siteAddress, source?.projectAddress, source?.customer?.projectAddress, source?.customer?.address),
    status: normalizeProjectStatus(source?.status || source?.projectStatus),
    notes: pickText(source?.notes, source?.projectNotes),
    scope_summary: pickText(source?.scopeSummary, source?.scopeNotes, source?.additionalNotes),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalEstimateToBackendEstimate(estimate, context) {
  const source = isPlainObject(estimate) ? estimate : {};
  const mapped = {
    company_id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    project_legacy_local_id: asText(source?.projectId),
    customer_legacy_local_id: asText(source?.customerId || source?.customer?.id),
    estimate_number: extractEstimateNumber(source),
    status: normalizeEstimateStatus(source?.status),
    doc_type: "estimate",
    customer_name: pickText(source?.customerName, source?.customer?.name, source?.customer?.companyName, source?.customer?.fullName),
    project_name: pickText(source?.projectName, source?.customer?.projectName),
    project_number: extractProjectNumber(source),
    work_title: pickText(source?.workTitle, source?.jobTitle, source?.jobName, source?.job?.title, source?.title),
    converted_invoice_legacy_local_id: asText(source?.invoiceId || source?.convertedInvoiceId || source?.sourceInvoiceId || source?.invoice?.id),
    converted_invoice_number: pickText(source?.invoiceNumber, source?.convertedInvoiceNumber, source?.invoice?.invoiceNumber),
    line_items: extractDocumentLineItems(source, "estimate"),
    ...mapEstimateFinancialFields(source),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (key === "line_items") return;
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalInvoiceToBackendInvoice(invoice, context) {
  const source = isPlainObject(invoice) ? invoice : {};
  const snapshot = isPlainObject(source?.sourceEstimateSnapshot) ? source.sourceEstimateSnapshot : null;
  const mapped = {
    company_id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    project_legacy_local_id: asText(source?.projectId || source?.project?.id || snapshot?.projectId),
    customer_legacy_local_id: asText(source?.customerId || source?.customer?.id || snapshot?.customerId),
    source_estimate_legacy_local_id: asText(source?.sourceEstimateId || snapshot?.estimateId),
    estimate_number: pickText(source?.estimateNumber, snapshot?.estimateNumber),
    invoice_number: extractInvoiceNumber(source),
    doc_type: "invoice",
    status: normalizeInvoiceStatus(source?.status),
    payment_status: normalizePaymentStatus(source?.paymentStatus),
    amount_paid: toNumberOrNull(source?.amountPaid),
    balance_remaining: toNumberOrNull(source?.balanceRemaining),
    total: toNumberOrNull(source?.invoiceTotal ?? source?.total ?? snapshot?.approvedTotal),
    customer_name: pickText(source?.customerName, source?.customer?.name, source?.customer?.companyName, source?.customer?.fullName, snapshot?.customerName),
    project_name: pickText(source?.projectName, source?.project?.name, snapshot?.projectName),
    project_number: extractProjectNumber(source) || pickText(snapshot?.projectNumber),
    work_title: pickText(source?.workTitle, source?.jobTitle, source?.jobName, source?.job?.title, source?.title),
    due_date: pickText(source?.dueDate, source?.job?.due, snapshot?.dueDate),
    invoice_date: pickText(source?.date, source?.job?.date, snapshot?.estimateDate),
    line_items: extractDocumentLineItems(source, "invoice"),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (key === "line_items") return;
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalInvoicePaymentToBackendPayment(payment, invoice, context) {
  const source = isPlainObject(payment) ? payment : {};
  const targetInvoice = isPlainObject(invoice) ? invoice : {};
  const mapped = {
    company_id: asText(context?.companyId),
    invoice_legacy_local_id: buildLegacyLocalId(targetInvoice),
    legacy_local_id: buildLegacyLocalId(source),
    amount: toNumberOrNull(source?.amount),
    method: pickText(source?.method),
    status: normalizePaymentStatus(source?.status),
    paid_at: toIsoTimestamp(source?.paidAt || source?.date),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalScopeTemplateToBackendScopeTemplate(scopeTemplate, context) {
  const source = isPlainObject(scopeTemplate) ? scopeTemplate : {};
  const mapped = {
    company_id: asText(context?.companyId),
    legacy_local_id: buildLegacyLocalId(source),
    name: pickText(source?.name, source?.label),
    scope_text: pickText(source?.scopeText, source?.text, source?.scope, source?.scopeNotes),
    ...mapCommonTimelineFields(source),
  };

  Object.keys(mapped).forEach((key) => {
    if (mapped[key] === "" || mapped[key] === null) delete mapped[key];
  });

  return mapped;
}

export function mapLocalSettingsToBackendSettings(settings, context) {
  if (!isPlainObject(settings)) return null;
  return {
    company_id: asText(context?.companyId),
    data: clonePlain(settings),
  };
}

export function mapLocalAuditEventToBackendDraft(auditEvent, context) {
  return mapLocalAuditEventToBackendAuditEvent(auditEvent, context);
}

function scanDuplicateIds(records = [], entityType = "") {
  const ids = collectLocalIds(records);
  const duplicates = collectDuplicateValues(ids);
  if (duplicates.length === 0) return [];
  return duplicates.map((duplicateId, index) => buildWarning(
    `duplicate_local_id:${entityType}:${duplicateId}`,
    "error",
    entityType,
    duplicateId,
    `Duplicate local ${entityType} id detected.`,
    {
      duplicate_id: duplicateId,
      duplicate_count: ids.filter((id) => id === duplicateId).length,
      entity_type: entityType,
      occurrence_index: index,
    }
  ));
}

function scanDocumentNumberCollisions(records = [], entityType = "") {
  const values = asArray(records).map((record) => (
    entityType === "estimate"
      ? extractEstimateNumber(record)
      : extractInvoiceNumber(record)
  )).filter(Boolean);
  const duplicates = collectDuplicateValues(values);
  if (duplicates.length === 0) return [];
  return duplicates.map((duplicateValue, index) => buildWarning(
    `document_number_collision:${entityType}:${duplicateValue}`,
    "warning",
    entityType,
    duplicateValue,
    `Duplicate ${entityType} document number detected.`,
    {
      document_number: duplicateValue,
      duplicate_count: values.filter((value) => value === duplicateValue).length,
      entity_type: entityType,
      occurrence_index: index,
    }
  ));
}

function scanInvoicePayments(records = []) {
  const warnings = [];
  asArray(records).forEach((invoice) => {
    const invoiceId = buildLegacyLocalId(invoice);
    const payments = asArray(invoice?.payments);
    payments.forEach((payment, index) => {
      if (toNumberOrNull(payment?.amount) === null) {
        warnings.push(buildWarning(
          `invoice_payment_missing_amount:${invoiceId || index}`,
          "error",
          "invoice_payment",
          invoiceId || index,
          "Invoice payment is missing a numeric amount.",
          {
            invoice_legacy_local_id: invoiceId,
            payment_index: index,
          }
        ));
      }
    });
  });
  return warnings;
}

export function collectBackendMappingWarnings(snapshot = {}, options = {}) {
  const source = getLocalSnapshotLists(snapshot);
  const context = createBackendMappingContext(options);
  const warnings = [];

  if (!context.companyId) {
    warnings.push(buildWarning(
      "missing_company_id",
      "warning",
      "company",
      "",
      "Missing companyId in backend mapping context.",
      { source: BACKEND_SOURCE }
    ));
  }
  if (!context.userId) {
    warnings.push(buildWarning(
      "missing_user_id",
      "warning",
      "user",
      "",
      "Missing userId in backend mapping context.",
      { source: BACKEND_SOURCE }
    ));
  }

  source.customers.forEach((customer, index) => {
    const customerId = buildLegacyLocalId(customer);
    if (!customerId) {
      warnings.push(buildWarning(
        `customer_missing_id:${index}`,
        "error",
        "customer",
        index,
        "Customer is missing a local id.",
        { entity_type: "customer", index }
      ));
    }
  });

  source.projects.forEach((project, index) => {
    const projectId = buildLegacyLocalId(project);
    if (!projectId) {
      warnings.push(buildWarning(
        `project_missing_id:${index}`,
        "error",
        "project",
        index,
        "Project is missing a local id.",
        { entity_type: "project", index }
      ));
    }
  });

  source.estimates.forEach((estimate, index) => {
    const estimateId = buildLegacyLocalId(estimate);
    if (!estimateId) {
      warnings.push(buildWarning(
        `estimate_missing_id:${index}`,
        "error",
        "estimate",
        index,
        "Estimate is missing a local id.",
        { entity_type: "estimate", index }
      ));
    }
  });

  source.invoices.forEach((invoice, index) => {
    const invoiceId = buildLegacyLocalId(invoice);
    if (!invoiceId) {
      warnings.push(buildWarning(
        `invoice_missing_id:${index}`,
        "error",
        "invoice",
        index,
        "Invoice is missing a local id.",
        { entity_type: "invoice", index }
      ));
    }
  });

  warnings.push(...scanDuplicateIds(source.customers, "customer"));
  warnings.push(...scanDuplicateIds(source.projects, "project"));
  warnings.push(...scanDuplicateIds(source.estimates, "estimate"));
  warnings.push(...scanDuplicateIds(source.invoices, "invoice"));
  warnings.push(...scanDuplicateIds(source.scopeTemplates, "scope_template"));
  warnings.push(...scanDuplicateIds(source.auditEvents, "audit_event"));

  warnings.push(...scanDocumentNumberCollisions(source.estimates, "estimate"));
  warnings.push(...scanDocumentNumberCollisions(source.invoices, "invoice"));

  const customerIds = new Set(asArray(source.customers).map((customer) => buildLegacyLocalId(customer)).filter(Boolean));
  source.projects.forEach((project, index) => {
    const customerId = asText(project?.customerId);
    if (customerId && !customerIds.has(customerId)) {
      warnings.push(buildWarning(
        `project_customer_ref_missing:${buildLegacyLocalId(project) || index}`,
        "warning",
        "project",
        buildLegacyLocalId(project) || index,
        "Project references a customer id that is not present in the local snapshot.",
        {
          project_legacy_local_id: buildLegacyLocalId(project),
          customer_legacy_local_id: customerId,
        }
      ));
    }
  });

  const estimateIds = new Set(asArray(source.estimates).map((estimate) => buildLegacyLocalId(estimate)).filter(Boolean));
  source.invoices.forEach((invoice, index) => {
    const sourceEstimateId = asText(invoice?.sourceEstimateId || invoice?.sourceEstimateSnapshot?.estimateId);
    if (sourceEstimateId && !estimateIds.has(sourceEstimateId)) {
      warnings.push(buildWarning(
        `invoice_source_estimate_missing:${buildLegacyLocalId(invoice) || index}`,
        "warning",
        "invoice",
        buildLegacyLocalId(invoice) || index,
        "Invoice references a source estimate id that is not present in the local snapshot.",
        {
          invoice_legacy_local_id: buildLegacyLocalId(invoice),
          source_estimate_legacy_local_id: sourceEstimateId,
        }
      ));
    }
  });

  warnings.push(...scanInvoicePayments(source.invoices));

  return warnings;
}

export function mapLocalSnapshotToBackendDraft(snapshot = {}, options = {}) {
  const source = getLocalSnapshotLists(snapshot);
  const context = createBackendMappingContext(options);
  const warnings = collectBackendMappingWarnings(source, context);

  const company = mapLocalCompanyProfileToBackendCompany(source.companyProfile, context);
  const companies = company ? [company] : [];
  const customers = source.customers.map((customer) => mapLocalCustomerToBackendCustomer(customer, context));
  const projects = source.projects.map((project) => mapLocalProjectToBackendProject(project, context));
  const estimates = source.estimates.map((estimate) => mapLocalEstimateToBackendEstimate(estimate, context));
  const invoices = source.invoices.map((invoice) => mapLocalInvoiceToBackendInvoice(invoice, context));
  const invoicePayments = source.invoices.flatMap((invoice) => (
    asArray(invoice?.payments).map((payment) => mapLocalInvoicePaymentToBackendPayment(payment, invoice, context))
  ));
  const scopeTemplates = source.scopeTemplates.map((template) => mapLocalScopeTemplateToBackendScopeTemplate(template, context));
  const settings = mapLocalSettingsToBackendSettings(source.settings, context);
  const auditEvents = source.auditEvents.map((event) => mapLocalAuditEventToBackendDraft(event, context));

  return {
    mappingMeta: {
      mappingVersion: BACKEND_MAPPING_VERSION,
      companyId: context.companyId,
      userId: context.userId,
      generatedAt: context.generatedAt,
      source: context.source,
      warningCount: warnings.length,
      recordCounts: {
        companies: companies.length,
        customers: customers.length,
        projects: projects.length,
        estimates: estimates.length,
        invoices: invoices.length,
        invoicePayments: invoicePayments.length,
        scopeTemplates: scopeTemplates.length,
        auditEvents: auditEvents.length,
      },
    },
    companies,
    customers,
    projects,
    estimates,
    invoices,
    invoicePayments,
    scopeTemplates,
    settings,
    auditEvents,
    warnings,
  };
}
