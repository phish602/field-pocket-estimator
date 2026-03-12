// @ts-nocheck
/* eslint-disable */

import { computeTotals } from "../estimator/engine";
import { DEFAULT_STATE } from "../estimator/defaultState";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  INVOICE_STATUSES,
  INVOICE_TYPES,
  createInvoiceDraftFromEstimate,
  createManualInvoiceDraft,
  normalizeInvoiceRecord,
  roundCurrency,
} from "./invoices";

const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const CUSTOMER_EDIT_TARGET_KEY = STORAGE_KEYS.CUSTOMER_EDIT_TARGET;
const PENDING_CUSTOMER_USE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_USE;
const PENDING_CUSTOMER_CREATE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_CREATE;
const PENDING_CUSTOMER_EDIT_KEY = STORAGE_KEYS.PENDING_CUSTOMER_EDIT;
const SELECTED_CUSTOMER_ID_KEY = STORAGE_KEYS.SELECTED_CUSTOMER_ID;
const SELECTED_CUSTOMER_SNAP_KEY = STORAGE_KEYS.SELECTED_CUSTOMER_SNAP;
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const DEV_SAMPLE_REGISTRY_KEY = "estipaid-dev-sample-registry-v1";
const SAMPLE_ID_PREFIX = "sample_";

const SAMPLE_IDS = {
  customers: [
    "sample_customer_olivia_camden",
    "sample_customer_mesa_dental",
    "sample_customer_alvarez_family",
    "sample_customer_red_rock",
    "sample_customer_palo_verde",
  ],
  estimates: [
    "sample_estimate_olivia_interior",
    "sample_estimate_mesa_ti",
    "sample_estimate_red_rock_exterior",
    "sample_estimate_alvarez_exterior",
    "sample_estimate_alvarez_guest_suite",
  ],
  invoices: [
    "sample_invoice_mesa_deposit",
    "sample_invoice_mesa_progress",
    "sample_invoice_alvarez_final",
    "sample_invoice_palo_verde_manual",
  ],
};

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

function readArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeArray(key, records) {
  localStorage.setItem(key, JSON.stringify(Array.isArray(records) ? records : []));
}

function readRegistry() {
  try {
    const raw = localStorage.getItem(DEV_SAMPLE_REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeRegistry(value) {
  try {
    localStorage.setItem(DEV_SAMPLE_REGISTRY_KEY, JSON.stringify(value));
  } catch {}
}

function clearRegistry() {
  try {
    localStorage.removeItem(DEV_SAMPLE_REGISTRY_KEY);
  } catch {}
}

function atLocalTimestamp(dateString, hour = 12, minute = 0) {
  const iso = String(dateString || "").trim();
  if (!iso) return Date.now();
  const parsed = new Date(`${iso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

function joinAddress(address) {
  const street = String(address?.street || "").trim();
  const city = String(address?.city || "").trim();
  const state = String(address?.state || "").trim();
  const zip = String(address?.zip || "").trim();
  const lineTwo = [city, state].filter(Boolean).join(", ");
  return [street, [lineTwo, zip].filter(Boolean).join(" ")].filter(Boolean).join("\n");
}

function toEstimatorFlat(customer) {
  const source = customer && typeof customer === "object" ? customer : {};
  const type = String(source?.type || "residential").toLowerCase();
  if (type === "commercial") {
    const jobsite = source?.jobsite || {};
    const billing = source?.billSameAsJob ? (source?.jobsite || {}) : (source?.billing || {});
    return {
      name: String(source?.companyName || "").trim(),
      phone: String(source?.comPhone || "").trim(),
      email: String(source?.comEmail || "").trim(),
      attn: String(source?.contactName || "").trim(),
      address: joinAddress(jobsite),
      billingAddress: joinAddress(billing),
      city: String(jobsite?.city || "").trim(),
      state: String(jobsite?.state || "").trim(),
      zip: String(jobsite?.zip || "").trim(),
    };
  }

  const service = source?.resService || {};
  const billing = source?.resBillingSame ? (source?.resService || {}) : (source?.resBilling || {});
  return {
    name: String(source?.fullName || "").trim(),
    phone: String(source?.resPhone || "").trim(),
    email: String(source?.resEmail || "").trim(),
    attn: "",
    address: joinAddress(service),
    billingAddress: joinAddress(billing),
    city: String(service?.city || "").trim(),
    state: String(service?.state || "").trim(),
    zip: String(service?.zip || "").trim(),
  };
}

function createResidentialCustomer(config) {
  const updatedAt = atLocalTimestamp(config.updatedOn || "2026-03-01", 14);
  const service = {
    street: String(config?.service?.street || ""),
    city: String(config?.service?.city || ""),
    state: String(config?.service?.state || ""),
    zip: String(config?.service?.zip || ""),
  };
  const billing = config?.billingSame === false
    ? {
        street: String(config?.billing?.street || ""),
        city: String(config?.billing?.city || ""),
        state: String(config?.billing?.state || ""),
        zip: String(config?.billing?.zip || ""),
      }
    : { ...service };

  const customer = {
    id: config.id,
    type: "residential",
    fullName: String(config.fullName || ""),
    resPhone: String(config.phone || ""),
    resEmail: String(config.email || ""),
    resService: service,
    resBillingSame: config?.billingSame !== false,
    resBilling: billing,
    updatedAt,
    lastUsed: updatedAt,
  };
  return {
    ...customer,
    ...toEstimatorFlat(customer),
  };
}

function createCommercialCustomer(config) {
  const updatedAt = atLocalTimestamp(config.updatedOn || "2026-03-01", 14);
  const jobsite = {
    street: String(config?.jobsite?.street || ""),
    city: String(config?.jobsite?.city || ""),
    state: String(config?.jobsite?.state || ""),
    zip: String(config?.jobsite?.zip || ""),
  };
  const billing = config?.billSameAsJob === false
    ? {
        street: String(config?.billing?.street || ""),
        city: String(config?.billing?.city || ""),
        state: String(config?.billing?.state || ""),
        zip: String(config?.billing?.zip || ""),
      }
    : { ...jobsite };

  const customer = {
    id: config.id,
    type: "commercial",
    companyName: String(config.companyName || ""),
    contactName: String(config.contactName || ""),
    contactTitle: String(config.contactTitle || ""),
    comPhone: String(config.phone || ""),
    comEmail: String(config.email || ""),
    apEmail: String(config.apEmail || ""),
    netTermsType: String(config.netTermsType || "DUE_UPON_RECEIPT"),
    netTermsDays: config?.netTermsType === "NET_CUSTOM" ? Number(config.netTermsDays || 0) : config?.netTermsDays ?? null,
    poRequired: !!config.poRequired,
    jobsite,
    billSameAsJob: config?.billSameAsJob !== false,
    billing,
    updatedAt,
    lastUsed: updatedAt,
  };
  return {
    ...customer,
    ...toEstimatorFlat(customer),
  };
}

function createBlankLine(idPrefix, suffix, defaults = {}) {
  return {
    id: `${idPrefix}_${suffix}`,
    ...defaults,
  };
}

function buildFinancialSummary({
  approvedTotal = null,
  totalRevenue = 0,
  totalCost = 0,
  laborRevenue = 0,
  laborCost = 0,
  materialsRevenue = 0,
  materialsCost = 0,
}) {
  const revenue = roundCurrency(totalRevenue);
  const cost = roundCurrency(totalCost);
  const grossProfit = roundCurrency(revenue - cost);
  const marginRatio = revenue > 0 ? roundCurrency(grossProfit / revenue) : 0;
  const marginPercent = roundCurrency(marginRatio * 100);
  const approved = approvedTotal === null || approvedTotal === undefined || approvedTotal === ""
    ? revenue
    : roundCurrency(approvedTotal);
  const normalizedLaborRevenue = roundCurrency(laborRevenue);
  const normalizedLaborCost = roundCurrency(laborCost);
  const normalizedMaterialsRevenue = roundCurrency(materialsRevenue);
  const normalizedMaterialsCost = roundCurrency(materialsCost);

  return {
    approvedTotal: approved,
    totalRevenue: revenue,
    grandTotal: revenue,
    total: revenue,
    totalCost: cost,
    internalCost: cost,
    grossProfit,
    grossMargin: marginRatio,
    grossMarginPct: marginRatio,
    grossProfitMargin: marginRatio,
    margin: marginRatio,
    marginPct: marginPercent,
    marginPercent,
    laborRevenue: normalizedLaborRevenue,
    laborCost: normalizedLaborCost,
    materialsRevenue: normalizedMaterialsRevenue,
    materialsCost: normalizedMaterialsCost,
    financials: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
    totals: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
  };
}

function buildFinancialSummaryFromComputed(computed, approvedTotal = null) {
  const laborRevenue = roundCurrency(
    computed?.labor?.totalRevenue
    ?? computed?.laborAfterAdjustments
    ?? computed?.laborAfterMultiplier
    ?? computed?.labor?.subtotal
    ?? 0
  );
  const laborCost = roundCurrency(
    computed?.labor?.totalCost
    ?? computed?.labor?.internalCost
    ?? computed?.labor?.cost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    computed?.materials?.totalRevenue
    ?? computed?.materials?.totalCharge
    ?? 0
  );
  const materialsCost = roundCurrency(computed?.materials?.totalCost ?? 0);
  const totalRevenue = roundCurrency(
    computed?.totalRevenue
    ?? computed?.grandTotal
    ?? (laborRevenue + materialsRevenue)
  );
  const totalCost = roundCurrency(
    computed?.totalCost
    ?? (laborCost + materialsCost)
  );

  return buildFinancialSummary({
    approvedTotal: approvedTotal === null || approvedTotal === undefined ? totalRevenue : approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
  });
}

function buildEstimateSnapshotWithFinancials(estimate) {
  const source = estimate && typeof estimate === "object" ? estimate : {};
  const approvedTotal = roundCurrency(
    source?.approvedTotal
    ?? source?.financials?.approvedTotal
    ?? source?.totalRevenue
    ?? source?.grandTotal
    ?? source?.total
    ?? 0
  );
  const totalRevenue = roundCurrency(
    source?.financials?.totalRevenue
    ?? source?.totals?.totalRevenue
    ?? source?.totalRevenue
    ?? source?.grandTotal
    ?? source?.total
    ?? approvedTotal
  );
  const totalCost = roundCurrency(
    source?.financials?.totalCost
    ?? source?.totals?.totalCost
    ?? source?.totalCost
    ?? source?.internalCost
    ?? 0
  );
  const laborRevenue = roundCurrency(
    source?.financials?.laborRevenue
    ?? source?.totals?.laborRevenue
    ?? source?.laborRevenue
    ?? 0
  );
  const laborCost = roundCurrency(
    source?.financials?.laborCost
    ?? source?.totals?.laborCost
    ?? source?.laborCost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    source?.financials?.materialsRevenue
    ?? source?.totals?.materialsRevenue
    ?? source?.materialsRevenue
    ?? 0
  );
  const materialsCost = roundCurrency(
    source?.financials?.materialsCost
    ?? source?.totals?.materialsCost
    ?? source?.materialsCost
    ?? 0
  );
  const financialSummary = buildFinancialSummary({
    approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
  });

  return {
    estimateId: String(source?.id || "").trim(),
    estimateNumber: String(source?.estimateNumber || source?.job?.docNumber || "").trim(),
    estimateStatus: String(source?.status || "approved").trim(),
    status: String(source?.status || "approved").trim(),
    customerId: String(source?.customerId || source?.customer?.id || "").trim(),
    customerName: String(source?.customerName || source?.customer?.name || "").trim(),
    projectName: String(source?.projectName || source?.customer?.projectName || "").trim(),
    projectNumber: String(source?.projectNumber || source?.customer?.projectNumber || "").trim(),
    poNumber: String(source?.poNumber || source?.job?.poNumber || "").trim(),
    estimateDate: String(source?.date || source?.job?.date || "").trim(),
    dueDate: String(source?.dueDate || source?.job?.due || "").trim(),
    customer: deepClone(source?.customer || {}),
    job: deepClone(source?.job || {}),
    ...financialSummary,
    summary: {
      total: financialSummary.totalRevenue,
      totalRevenue: financialSummary.totalRevenue,
      totalCost: financialSummary.totalCost,
      grossProfit: financialSummary.grossProfit,
      marginPct: financialSummary.marginPct,
      savedAt: Number(source?.savedAt || 0) || 0,
      updatedAt: Number(source?.updatedAt || 0) || 0,
    },
  };
}

function buildEstimateRecord(config) {
  const customer = config.customer;
  const flat = toEstimatorFlat(customer);
  const createdAt = atLocalTimestamp(config.date, 9, 30);
  const savedAt = atLocalTimestamp(config.date, 16, 15);
  const state = deepClone(DEFAULT_STATE);
  const materialsMode = config?.materialsMode === "blanket" ? "blanket" : "itemized";
  const laborLines = Array.isArray(config?.laborLines) ? config.laborLines.map((line, index) => ({
    ...createBlankLine(config.id, `labor_${index + 1}`),
    role: "",
    label: "",
    qty: 1,
    hours: "",
    rate: "",
    trueRateInternal: "",
    ...line,
  })) : [];

  state.ui = {
    ...(state.ui || {}),
    docType: "estimate",
    materialsMode,
  };
  state.customer = {
    ...(state.customer || {}),
    id: String(customer?.id || ""),
    name: flat.name,
    attn: flat.attn,
    phone: flat.phone,
    email: flat.email,
    netTermsType: String(customer?.netTermsType || ""),
    netTermsDays: customer?.netTermsDays ?? "",
    address: flat.address,
    billingDiff: flat.billingAddress && flat.billingAddress !== flat.address,
    billingAddress: flat.billingAddress,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    projectAddress: flat.address,
    projectSameAsCustomer: true,
  };
  state.job = {
    ...(state.job || {}),
    date: String(config.date || ""),
    due: String(config.dueDate || ""),
    poNumber: String(config.poNumber || ""),
    location: flat.address,
    docNumber: String(config.estimateNumber || ""),
  };
  state.scopeNotes = String(config.scopeNotes || "");
  state.additionalNotes = String(config.additionalNotes || "");
  state.labor = {
    ...(state.labor || {}),
    hazardPct: Number(config.hazardPct || 0),
    riskPct: Number(config.riskPct || 0),
    multiplier: Number(config.multiplier || 1),
    lines: laborLines,
  };

  if (materialsMode === "blanket") {
    state.materials = {
      ...(state.materials || {}),
      blanketCost: String(config.blanketCost ?? ""),
      blanketInternalCost: String(config.blanketInternalCost ?? ""),
      materialsBlanketDescription: String(config.materialsBlanketDescription || ""),
      markupPct: Number(config.materialsMarkupPct || 0),
      items: [createBlankLine(config.id, "material_blank", { desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" })],
    };
  } else {
    state.materials = {
      ...(state.materials || {}),
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: Number(config.materialsMarkupPct || 0),
      items: (Array.isArray(config?.materialItems) ? config.materialItems : []).map((item, index) => ({
        ...createBlankLine(config.id, `material_${index + 1}`),
        desc: "",
        qty: "",
        unitCostInternal: "",
        costInternal: "",
        priceEach: "",
        ...item,
      })),
    };
  }

  const computed = computeTotals(state);
  const total = roundCurrency(computed?.totalRevenue || 0);
  const financialSummary = buildFinancialSummaryFromComputed(computed, total);

  return {
    ...state,
    id: config.id,
    name: String(config.projectName || ""),
    docType: "estimate",
    status: String(config.status || "pending"),
    customerId: String(customer?.id || ""),
    customerName: flat.name,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    estimateNumber: String(config.estimateNumber || ""),
    invoiceNumber: "",
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    poNumber: String(config.poNumber || ""),
    total,
    ...financialSummary,
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    customer: deepClone(state.customer),
    job: deepClone(state.job),
    meta: {
      ...(state.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
    },
  };
}

function createLinkedInvoice(config, estimate, existingInvoices) {
  const createdAt = atLocalTimestamp(config.date, 10, 10);
  const savedAt = atLocalTimestamp(config.date, 15, 20);
  const draftResult = createInvoiceDraftFromEstimate(estimate, existingInvoices, {
    invoiceType: config.invoiceType,
    requestedValue: config.requestedValue,
    invoiceDate: config.date,
    dueDate: config.dueDate,
    note: config.note,
    nowTs: createdAt,
  });

  if (!draftResult?.ok || !draftResult?.draft) {
    throw new Error(draftResult?.message || `Unable to create sample invoice for ${config.id}.`);
  }

  const parentTotals = computeTotals(estimate || {});
  const parentRevenue = roundCurrency(parentTotals?.totalRevenue || estimate?.total || 0);
  const parentInternalCost = roundCurrency(parentTotals?.totalCost || 0);
  const parentInternalRatio = parentRevenue > 0
    ? Math.min(Math.max(parentInternalCost / parentRevenue, 0.4), 0.82)
    : 0.62;
  const invoiceTotal = roundCurrency(draftResult?.draft?.invoiceTotal || draftResult?.draft?.total || 0);
  const invoiceInternalCost = roundCurrency(invoiceTotal * parentInternalRatio);
  const invoiceFinancialSummary = buildFinancialSummary({
    approvedTotal: invoiceTotal,
    totalRevenue: invoiceTotal,
    totalCost: invoiceInternalCost,
    laborRevenue: 0,
    laborCost: 0,
    materialsRevenue: invoiceTotal,
    materialsCost: invoiceInternalCost,
  });

  const payments = Array.isArray(config?.payments) ? config.payments.map((payment, index) => ({
    id: String(payment?.id || `${config.id}_payment_${index + 1}`),
    amount: roundCurrency(payment?.amount || 0),
    paidAt: String(payment?.paidAt || config.date || ""),
    note: String(payment?.note || ""),
    method: String(payment?.method || "manual"),
    order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
  })) : [];

  return normalizeInvoiceRecord({
    ...draftResult.draft,
    id: config.id,
    invoiceNumber: String(config.invoiceNumber || draftResult.draft.invoiceNumber || ""),
    status: String(config.status || INVOICE_STATUSES.DRAFT),
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    additionalNotes: String(config.note || draftResult.draft.additionalNotes || ""),
    amountPaid: payments.reduce((sum, payment) => sum + roundCurrency(payment?.amount), 0),
    payments,
    ...invoiceFinancialSummary,
    sourceEstimateSnapshot: buildEstimateSnapshotWithFinancials(estimate),
    materials: {
      ...(draftResult.draft.materials || {}),
      blanketCost: String(invoiceTotal),
      blanketInternalCost: String(invoiceInternalCost),
      materialsBlanketDescription: String(
        draftResult.draft?.materials?.materialsBlanketDescription
        || config.note
        || `Invoice snapshot for ${String(estimate?.estimateNumber || "").trim()}`
      ),
    },
    job: {
      ...(draftResult.draft.job || {}),
      date: String(config.date || ""),
      due: String(config.dueDate || ""),
      docNumber: String(config.invoiceNumber || draftResult.draft.invoiceNumber || ""),
    },
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    meta: {
      ...(draftResult.draft.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
      ephemeralDraft: false,
    },
  });
}

function createManualInvoice(config) {
  const customer = config.customer;
  const flat = toEstimatorFlat(customer);
  const createdAt = atLocalTimestamp(config.date, 11, 0);
  const savedAt = atLocalTimestamp(config.date, 16, 0);
  const draft = createManualInvoiceDraft([], { invoiceDate: config.date, dueDate: config.dueDate, nowTs: createdAt });
  const paymentStatus = Array.isArray(config?.payments) && config.payments.length > 0 ? "partial" : "unpaid";
  const amountPaid = roundCurrency(
    (Array.isArray(config?.payments) ? config.payments : []).reduce(
      (sum, payment) => sum + roundCurrency(payment?.amount),
      0
    )
  );
  const invoiceTotal = roundCurrency(config.invoiceTotal);
  const invoiceInternalCost = roundCurrency(config?.internalCost ?? (invoiceTotal * 0.66));
  const invoiceFinancialSummary = buildFinancialSummary({
    approvedTotal: invoiceTotal,
    totalRevenue: invoiceTotal,
    totalCost: invoiceInternalCost,
    laborRevenue: 0,
    laborCost: 0,
    materialsRevenue: invoiceTotal,
    materialsCost: invoiceInternalCost,
  });

  return normalizeInvoiceRecord({
    ...draft,
    id: config.id,
    invoiceType: INVOICE_TYPES.MANUAL,
    invoiceNumber: String(config.invoiceNumber || ""),
    status: String(config.status || INVOICE_STATUSES.DRAFT),
    customerId: String(customer?.id || ""),
    customerName: flat.name,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    invoiceTotal,
    total: invoiceTotal,
    amountPaid,
    paymentStatus,
    ...invoiceFinancialSummary,
    payments: (Array.isArray(config?.payments) ? config.payments : []).map((payment, index) => ({
      id: String(payment?.id || `${config.id}_payment_${index + 1}`),
      amount: roundCurrency(payment?.amount || 0),
      paidAt: String(payment?.paidAt || config.date || ""),
      note: String(payment?.note || ""),
      method: String(payment?.method || "manual"),
      order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
    })),
    additionalNotes: String(config.note || ""),
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    job: {
      ...(draft.job || {}),
      date: String(config.date || ""),
      due: String(config.dueDate || ""),
      location: flat.address,
      docNumber: String(config.invoiceNumber || ""),
    },
    customer: {
      ...(draft.customer || {}),
      id: String(customer?.id || ""),
      name: flat.name,
      attn: flat.attn,
      phone: flat.phone,
      email: flat.email,
      netTermsType: String(customer?.netTermsType || ""),
      netTermsDays: customer?.netTermsDays ?? "",
      address: flat.address,
      billingAddress: flat.billingAddress,
      projectName: String(config.projectName || ""),
      projectNumber: String(config.projectNumber || ""),
    },
    ui: {
      ...(draft.ui || {}),
      docType: "invoice",
      materialsMode: "blanket",
    },
    labor: {
      ...(draft.labor || {}),
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [createBlankLine(config.id, "labor_blank", { role: "", hours: "", rate: "", trueRateInternal: "" })],
    },
    materials: {
      ...(draft.materials || {}),
      blanketCost: String(invoiceTotal),
      blanketInternalCost: String(invoiceInternalCost),
      materialsBlanketDescription: String(config.materialsDescription || config.note || ""),
      markupPct: 0,
      items: [createBlankLine(config.id, "material_blank", { desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" })],
    },
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    meta: {
      ...(draft.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
      ephemeralDraft: false,
    },
  });
}

function buildSampleCustomers() {
  return [
    createResidentialCustomer({
      id: "sample_customer_olivia_camden",
      fullName: "Olivia Camden",
      phone: "(480) 555-1128",
      email: "olivia.camden@example.com",
      service: {
        street: "4217 E Desert Willow Dr",
        city: "Phoenix",
        state: "AZ",
        zip: "85048",
      },
      updatedOn: "2026-03-03",
    }),
    createCommercialCustomer({
      id: "sample_customer_mesa_dental",
      companyName: "Mesa Dental Group",
      contactName: "Nicole Ramirez",
      contactTitle: "Office Manager",
      phone: "(480) 555-2674",
      email: "nramirez@mesadentalgroup.com",
      apEmail: "ap@mesadentalgroup.com",
      netTermsType: "NET_30",
      poRequired: true,
      jobsite: {
        street: "1830 S Val Vista Dr, Suite 104",
        city: "Mesa",
        state: "AZ",
        zip: "85204",
      },
      billing: {
        street: "PO Box 81047",
        city: "Mesa",
        state: "AZ",
        zip: "85277",
      },
      billSameAsJob: false,
      updatedOn: "2026-03-02",
    }),
    createResidentialCustomer({
      id: "sample_customer_alvarez_family",
      fullName: "Alvarez Family Trust",
      phone: "(623) 555-4017",
      email: "alvarez.home@example.com",
      service: {
        street: "9823 W Cedar Hollow Ct",
        city: "Peoria",
        state: "AZ",
        zip: "85383",
      },
      updatedOn: "2026-03-06",
    }),
    createCommercialCustomer({
      id: "sample_customer_red_rock",
      companyName: "Red Rock Retail Center",
      contactName: "Darren Lowe",
      contactTitle: "Property Manager",
      phone: "(602) 555-7742",
      email: "dlowe@redrockretail.com",
      apEmail: "billing@redrockretail.com",
      netTermsType: "NET_CUSTOM",
      netTermsDays: 21,
      poRequired: true,
      jobsite: {
        street: "7300 N 7th St",
        city: "Phoenix",
        state: "AZ",
        zip: "85020",
      },
      billing: {
        street: "2550 E Camelback Rd, Floor 5",
        city: "Phoenix",
        state: "AZ",
        zip: "85016",
      },
      billSameAsJob: false,
      updatedOn: "2026-02-26",
    }),
    createCommercialCustomer({
      id: "sample_customer_palo_verde",
      companyName: "Palo Verde HOA",
      contactName: "Shannon Greer",
      contactTitle: "Community Director",
      phone: "(480) 555-9182",
      email: "sgreer@paloverdehoa.com",
      apEmail: "accountspayable@paloverdehoa.com",
      netTermsType: "NET_15",
      poRequired: false,
      jobsite: {
        street: "1151 E Palo Verde Loop",
        city: "Gilbert",
        state: "AZ",
        zip: "85298",
      },
      updatedOn: "2026-03-05",
    }),
  ];
}

function buildSampleEstimates(customersById) {
  return [
    buildEstimateRecord({
      id: "sample_estimate_olivia_interior",
      customer: customersById["sample_customer_olivia_camden"],
      status: "pending",
      estimateNumber: "EST-2401",
      projectName: "Primary Suite Interior Repaint",
      projectNumber: "CAMDEN-PS-01",
      date: "2026-03-02",
      dueDate: "2026-03-16",
      scopeNotes: "Prep and repaint the primary suite, including walls, ceiling, trim, and two closet interiors. Protect flooring, patch minor nail pops, and spot-prime repaired areas.",
      additionalNotes: "Client requested low-odor products and a tight two-day schedule after flooring install.",
      multiplier: 1.08,
      laborLines: [
        { role: "Painter", label: "Lead painter", qty: 1, hours: 18, rate: 80, trueRateInternal: 50 },
        { role: "Painter", label: "Prep technician", qty: 1, hours: 10, rate: 64, trueRateInternal: 37 },
      ],
      materialItems: [
        { desc: "Low-VOC wall paint", qty: 8, priceEach: 60, unitCostInternal: 42 },
        { desc: "Ceiling flat paint", qty: 3, priceEach: 50, unitCostInternal: 34 },
        { desc: "Masking film and paper", qty: 2, priceEach: 34, unitCostInternal: 22 },
        { desc: "Patch compound and sundries", qty: 1, priceEach: 38, unitCostInternal: 26 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_mesa_ti",
      customer: customersById["sample_customer_mesa_dental"],
      status: "approved",
      estimateNumber: "EST-2402",
      projectName: "Operatories TI Repaint and Millwork Refresh",
      projectNumber: "MDG-TI-24-04",
      date: "2026-02-03",
      dueDate: "2026-02-17",
      poNumber: "MDG-8821",
      scopeNotes: "Night work repaint for four operatories, sterilization corridor, and breakroom millwork. Includes wall prep, cabinet degreasing, epoxy floor line touchups, and weekend punch completion.",
      additionalNotes: "Approved after-hours access window is 6:30 PM to 4:00 AM. Maintain dust containment around active treatment rooms.",
      hazardPct: 1,
      riskPct: 1,
      multiplier: 1.06,
      laborLines: [
        { role: "Foreman", label: "Night shift foreman", qty: 1, hours: 22, rate: 84, trueRateInternal: 59 },
        { role: "Painter", label: "Painter crew", qty: 2, hours: 36, rate: 70, trueRateInternal: 48 },
        { role: "Finish tech", label: "Cabinet finish tech", qty: 1, hours: 14, rate: 80, trueRateInternal: 57 },
      ],
      materialItems: [
        { desc: "Scrubbable wall finish", qty: 18, priceEach: 66, unitCostInternal: 50 },
        { desc: "Cabinet urethane topcoat", qty: 6, priceEach: 80, unitCostInternal: 61 },
        { desc: "Bonding primer", qty: 7, priceEach: 60, unitCostInternal: 44 },
        { desc: "Containment plastic and zipper doors", qty: 4, priceEach: 48, unitCostInternal: 30 },
        { desc: "Epoxy floor line kit", qty: 2, priceEach: 146, unitCostInternal: 118 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_red_rock_exterior",
      customer: customersById["sample_customer_red_rock"],
      status: "lost",
      estimateNumber: "EST-2403",
      projectName: "North Elevation Stucco Repair and Repaint",
      projectNumber: "RRRC-NORTH-03",
      date: "2026-01-18",
      dueDate: "2026-01-29",
      poNumber: "RRC-553",
      scopeNotes: "Repair cracked stucco at the north elevation, pressure wash, seal hairline fractures, and apply full elastomeric repaint to the north-facing storefront band.",
      additionalNotes: "Competing bid selected. Keep for benchmark pricing and alternate proposal follow-up.",
      materialsMode: "blanket",
      multiplier: 1.04,
      laborLines: [
        { role: "Repair crew", label: "Stucco repair crew", qty: 2, hours: 20, rate: 74, trueRateInternal: 47 },
        { role: "Painter", label: "Exterior painter", qty: 1, hours: 16, rate: 66, trueRateInternal: 42 },
      ],
      blanketCost: 3840,
      blanketInternalCost: 3265,
      materialsBlanketDescription: "Stucco patch, elastomeric coating, lifts, masking, and sundry exterior materials.",
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_alvarez_exterior",
      customer: customersById["sample_customer_alvarez_family"],
      status: "approved",
      estimateNumber: "EST-2404",
      projectName: "Exterior Repaint with Fascia and Gate Touchups",
      projectNumber: "ALV-EXT-02",
      date: "2026-02-20",
      dueDate: "2026-03-06",
      scopeNotes: "Full exterior repaint including stucco body, fascia, patio beams, courtyard gate, and detached casita trim. Pressure wash, caulk movement joints, and address sun-faded south exposure.",
      additionalNotes: "Repeat customer. Homeowner asked for daily photo updates and gate hardware masking instead of removal.",
      hazardPct: 1,
      riskPct: 0,
      multiplier: 1.08,
      laborLines: [
        { role: "Foreman", label: "Project lead", qty: 1, hours: 18, rate: 84, trueRateInternal: 56 },
        { role: "Painter", label: "Exterior painter", qty: 2, hours: 32, rate: 74, trueRateInternal: 46 },
        { role: "Prep", label: "Wash and prep", qty: 1, hours: 14, rate: 58, trueRateInternal: 34 },
      ],
      materialItems: [
        { desc: "Elastomeric body paint", qty: 16, priceEach: 72, unitCostInternal: 52 },
        { desc: "Trim enamel", qty: 7, priceEach: 62, unitCostInternal: 45 },
        { desc: "Premium caulk and sealant", qty: 6, priceEach: 22, unitCostInternal: 14 },
        { desc: "Masking and paper goods", qty: 4, priceEach: 30, unitCostInternal: 18 },
        { desc: "Rust-inhibiting metal primer", qty: 2, priceEach: 42, unitCostInternal: 30 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_alvarez_guest_suite",
      customer: customersById["sample_customer_alvarez_family"],
      status: "pending",
      estimateNumber: "EST-2405",
      projectName: "Guest Suite Touch-Up and Cabinet Refresh",
      projectNumber: "ALV-GUEST-03",
      date: "2026-03-07",
      dueDate: "2026-03-21",
      scopeNotes: "Touch-up scuffs in the guest suite, refinish vanity cabinetry, repaint bath ceiling, and reset color consistency after plumbing wall access repairs.",
      additionalNotes: "Homeowner wants scheduling coordinated with family visit on March 28. Include low-sheen finish sample before final approval.",
      multiplier: 1.08,
      laborLines: [
        { role: "Painter", label: "Painter", qty: 1, hours: 14, rate: 76, trueRateInternal: 46 },
        { role: "Finish tech", label: "Cabinet touch-up tech", qty: 1, hours: 8, rate: 84, trueRateInternal: 56 },
      ],
      materialItems: [
        { desc: "Cabinet enamel", qty: 2, priceEach: 76, unitCostInternal: 52 },
        { desc: "Ceiling paint", qty: 1, priceEach: 52, unitCostInternal: 34 },
        { desc: "Patch and sanding kit", qty: 1, priceEach: 34, unitCostInternal: 20 },
      ],
      materialsMarkupPct: 0,
    }),
  ];
}

function buildSampleInvoices(estimatesById, customersById) {
  const invoices = [];

  const mesaDeposit = createLinkedInvoice(
    {
      id: "sample_invoice_mesa_deposit",
      invoiceNumber: "INV-2401",
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "25%",
      date: "2026-02-10",
      dueDate: "2026-02-17",
      status: INVOICE_STATUSES.PAID,
      note: "Mobilization deposit covering after-hours setup, containment staging, and initial materials pull.",
      payments: [
        {
          id: "sample_payment_mesa_deposit",
          amount: 0,
          paidAt: "2026-02-14",
          note: "ACH deposit received from Mesa Dental Group.",
          method: "ach",
        },
      ],
    },
    estimatesById["sample_estimate_mesa_ti"],
    invoices
  );
  mesaDeposit.payments = mesaDeposit.payments.map((payment) => ({
    ...payment,
    amount: mesaDeposit.invoiceTotal,
  }));
  invoices.push(normalizeInvoiceRecord(mesaDeposit));

  const mesaProgress = createLinkedInvoice(
    {
      id: "sample_invoice_mesa_progress",
      invoiceNumber: "INV-2402",
      invoiceType: INVOICE_TYPES.PROGRESS,
      requestedValue: "35%",
      date: "2026-02-24",
      dueDate: "2026-03-01",
      status: INVOICE_STATUSES.SENT,
      note: "Second draw after cabinetry topcoat completion and operatory wall finish sign-off.",
    },
    estimatesById["sample_estimate_mesa_ti"],
    invoices
  );
  invoices.push(mesaProgress);

  const alvarezFinal = createLinkedInvoice(
    {
      id: "sample_invoice_alvarez_final",
      invoiceNumber: "INV-2403",
      invoiceType: INVOICE_TYPES.FINAL,
      requestedValue: "4200",
      date: "2026-03-08",
      dueDate: "2026-03-22",
      status: INVOICE_STATUSES.DRAFT,
      note: "Draft final billing for exterior repaint after homeowner punch walk is scheduled.",
    },
    estimatesById["sample_estimate_alvarez_exterior"],
    invoices
  );
  invoices.push(alvarezFinal);

  const paloVerdeManual = createManualInvoice({
    id: "sample_invoice_palo_verde_manual",
    invoiceNumber: "INV-2404",
    customer: customersById["sample_customer_palo_verde"],
    projectName: "Clubhouse Hallway Emergency Spot Repair",
    projectNumber: "PVH-CLUB-07",
    invoiceTotal: 1860,
    date: "2026-03-05",
    dueDate: "2026-03-19",
    status: INVOICE_STATUSES.SENT,
    note: "Manual invoice for water-damage spot repair, weekend mobilization, and odor-blocking sealer application.",
    materialsDescription: "Weekend spot repair invoice including labor, sealer, and containment.",
  });
  invoices.push(paloVerdeManual);

  return invoices.map((invoice) => normalizeInvoiceRecord(invoice));
}

function collectSampleIds(records, explicitIds = []) {
  const collected = new Set(Array.isArray(explicitIds) ? explicitIds : []);
  (Array.isArray(records) ? records : []).forEach((record) => {
    const id = String(record?.id || "").trim();
    if (id && id.startsWith(SAMPLE_ID_PREFIX)) {
      collected.add(id);
    }
  });
  return collected;
}

function filterByIds(records, ids) {
  const set = new Set(ids);
  return (Array.isArray(records) ? records : []).filter((record) => !set.has(String(record?.id || "").trim()));
}

function maybeRemoveDirectKey(key, ids) {
  try {
    const value = String(localStorage.getItem(key) || "").trim();
    if (value && ids.has(value)) localStorage.removeItem(key);
  } catch {}
}

function maybeRemoveJsonKey(key, ids) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const targetId = String(parsed?.id || parsed?.editContext?.id || "").trim();
    if (targetId && ids.has(targetId)) {
      localStorage.removeItem(key);
    }
  } catch {}
}

function emitSeedEvents() {
  try {
    window.dispatchEvent(new Event("estipaid:invoices-changed"));
  } catch {}
  try {
    window.dispatchEvent(new Event("estipaid:navigate-estimates"));
  } catch {}
}

export function clearDevSampleData() {
  const existingCustomers = readArray(CUSTOMERS_KEY);
  const existingEstimates = readArray(ESTIMATES_KEY);
  const existingInvoices = readArray(INVOICES_KEY);
  const registry = readRegistry();

  const customerIds = collectSampleIds(existingCustomers, [
    ...SAMPLE_IDS.customers,
    ...(Array.isArray(registry?.customers) ? registry.customers : []),
  ]);
  const estimateIds = collectSampleIds(existingEstimates, [
    ...SAMPLE_IDS.estimates,
    ...(Array.isArray(registry?.estimates) ? registry.estimates : []),
  ]);
  const invoiceIds = collectSampleIds(existingInvoices, [
    ...SAMPLE_IDS.invoices,
    ...(Array.isArray(registry?.invoices) ? registry.invoices : []),
  ]);
  const anyIds = new Set([...customerIds, ...estimateIds, ...invoiceIds]);

  const nextCustomers = filterByIds(existingCustomers, customerIds);
  const nextEstimates = filterByIds(existingEstimates, estimateIds);
  const nextInvoices = filterByIds(existingInvoices, invoiceIds);

  writeArray(CUSTOMERS_KEY, nextCustomers);
  writeArray(ESTIMATES_KEY, nextEstimates);
  writeArray(INVOICES_KEY, nextInvoices);
  clearRegistry();

  maybeRemoveDirectKey(EDIT_ESTIMATE_TARGET_KEY, estimateIds);
  maybeRemoveDirectKey(EDIT_INVOICE_TARGET_KEY, invoiceIds);
  maybeRemoveDirectKey(SELECTED_CUSTOMER_ID_KEY, customerIds);
  maybeRemoveJsonKey(CUSTOMER_EDIT_TARGET_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_USE_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_EDIT_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_CREATE_KEY, customerIds);
  maybeRemoveJsonKey(ACTIVE_EDIT_CONTEXT_KEY, anyIds);

  try {
    const selectedCustomerId = String(localStorage.getItem(SELECTED_CUSTOMER_ID_KEY) || "").trim();
    if (!selectedCustomerId || customerIds.has(selectedCustomerId)) {
      localStorage.removeItem(SELECTED_CUSTOMER_SNAP_KEY);
    }
  } catch {}

  emitSeedEvents();

  return {
    clearedCustomers: Math.max(existingCustomers.length - nextCustomers.length, 0),
    clearedEstimates: Math.max(existingEstimates.length - nextEstimates.length, 0),
    clearedInvoices: Math.max(existingInvoices.length - nextInvoices.length, 0),
  };
}

export function buildDevSampleDataset() {
  const customers = buildSampleCustomers();
  const customersById = customers.reduce((acc, customer) => {
    acc[String(customer.id)] = customer;
    return acc;
  }, {});

  const estimates = buildSampleEstimates(customersById);
  const estimatesById = estimates.reduce((acc, estimate) => {
    acc[String(estimate.id)] = estimate;
    return acc;
  }, {});

  const invoices = buildSampleInvoices(estimatesById, customersById);

  return {
    customers,
    estimates,
    invoices,
  };
}

export function seedDevSampleData() {
  clearDevSampleData();

  const { customers, estimates, invoices } = buildDevSampleDataset();

  const mergedCustomers = [...customers, ...readArray(CUSTOMERS_KEY)];
  const mergedEstimates = [...estimates, ...readArray(ESTIMATES_KEY)];
  const mergedInvoices = [...invoices, ...readArray(INVOICES_KEY)];

  writeArray(CUSTOMERS_KEY, mergedCustomers);
  writeArray(ESTIMATES_KEY, mergedEstimates);
  writeArray(INVOICES_KEY, mergedInvoices);
  writeRegistry({
    seededAt: Date.now(),
    customers: customers.map((record) => String(record?.id || "").trim()).filter(Boolean),
    estimates: estimates.map((record) => String(record?.id || "").trim()).filter(Boolean),
    invoices: invoices.map((record) => String(record?.id || "").trim()).filter(Boolean),
  });

  emitSeedEvents();

  return {
    customers: customers.length,
    estimates: estimates.length,
    invoices: invoices.length,
  };
}
